import { SourceStopId, StopId } from '../stops/stops.js';
import { SerializedRoute } from '../timetable/io.js';
import {
  MUST_COORDINATE_WITH_DRIVER,
  MUST_PHONE_AGENCY,
  NOT_AVAILABLE,
  REGULAR,
  Route,
  RouteId,
} from '../timetable/route.js';
import {
  RoutesAdjacency,
  ServiceRouteId,
  ServiceRoutesMap,
  StopsAdjacency,
} from '../timetable/timetable.js';
import { ServiceId, ServiceIds } from './services.js';
import { ParsedStopsMap } from './stops.js';
import { GtfsTime, toTime } from './time.js';
import { TransfersMap } from './transfers.js';
import { hashIds, parseCsv } from './utils.js';

export type TripId = string;

export type TripIdsMap = Map<TripId, ServiceRouteId>;

type TripEntry = {
  route_id: ServiceRouteId;
  service_id: ServiceId;
  trip_id: TripId;
};

export type GtfsPickupDropOffType =
  | '' // Not specified
  | '0' // Regularly scheduled
  | '1' // Not available
  | '2' // Must phone agency
  | '3'; // Must coordinate with driver

type StopTimeEntry = {
  trip_id: TripId;
  arrival_time?: GtfsTime;
  departure_time?: GtfsTime;
  stop_id: SourceStopId;
  stop_sequence: number;
  pickup_type?: GtfsPickupDropOffType;
  drop_off_type?: GtfsPickupDropOffType;
};

export type SerializedPickUpDropOffType = 0 | 1 | 2 | 3;

/**
 * Intermediate data structure for building routes during parsing
 */
type RouteBuilder = {
  serviceRouteId: ServiceRouteId;
  stops: StopId[];
  trips: Array<{
    firstDeparture: number;
    arrivalTimes: number[];
    departureTimes: number[];
    pickUpTypes: SerializedPickUpDropOffType[];
    dropOffTypes: SerializedPickUpDropOffType[];
  }>;
};

/**
 * Encodes pickup/drop-off types into a Uint8Array using 2 bits per value.
 * Layout per byte: [drop_off_1][pickup_1][drop_off_0][pickup_0] for stops 0 and 1
 */
export const encodePickUpDropOffTypes = (
  pickUpTypes: SerializedPickUpDropOffType[],
  dropOffTypes: SerializedPickUpDropOffType[],
): Uint8Array => {
  const stopsCount = pickUpTypes.length;
  // Each byte stores 2 pickup/drop-off pairs (4 bits each)
  const arraySize = Math.ceil(stopsCount / 2);
  const encoded = new Uint8Array(arraySize);

  for (let i = 0; i < stopsCount; i++) {
    const byteIndex = Math.floor(i / 2);
    const isSecondPair = i % 2 === 1;
    const dropOffType = dropOffTypes[i];
    const pickUpType = pickUpTypes[i];

    if (
      dropOffType !== undefined &&
      pickUpType !== undefined &&
      byteIndex < encoded.length
    ) {
      if (isSecondPair) {
        // Second pair: upper 4 bits
        const currentByte = encoded[byteIndex];
        if (currentByte !== undefined) {
          encoded[byteIndex] =
            currentByte | (dropOffType << 4) | (pickUpType << 6);
        }
      } else {
        // First pair: lower 4 bits
        const currentByte = encoded[byteIndex];
        if (currentByte !== undefined) {
          encoded[byteIndex] = currentByte | dropOffType | (pickUpType << 2);
        }
      }
    }
  }
  return encoded;
};

/**
 * Sorts trips by departure time and creates optimized typed arrays
 */
const finalizeRouteFromBuilder = (builder: RouteBuilder): SerializedRoute => {
  builder.trips.sort((a, b) => a.firstDeparture - b.firstDeparture);

  const stopsCount = builder.stops.length;
  const tripsCount = builder.trips.length;
  const stopsArray = new Uint32Array(builder.stops);
  const stopTimesArray = new Uint16Array(stopsCount * tripsCount * 2);
  const allPickUpTypes: SerializedPickUpDropOffType[] = [];
  const allDropOffTypes: SerializedPickUpDropOffType[] = [];

  for (let tripIndex = 0; tripIndex < tripsCount; tripIndex++) {
    const trip = builder.trips[tripIndex];
    if (!trip) {
      throw new Error(`Missing trip data at index ${tripIndex}`);
    }
    const baseIndex = tripIndex * stopsCount * 2;

    for (let stopIndex = 0; stopIndex < stopsCount; stopIndex++) {
      const timeIndex = baseIndex + stopIndex * 2;
      const arrivalTime = trip.arrivalTimes[stopIndex];
      const departureTime = trip.departureTimes[stopIndex];
      const pickUpType = trip.pickUpTypes[stopIndex];
      const dropOffType = trip.dropOffTypes[stopIndex];

      if (
        arrivalTime === undefined ||
        departureTime === undefined ||
        pickUpType === undefined ||
        dropOffType === undefined
      ) {
        throw new Error(
          `Missing trip data for trip ${tripIndex} at stop ${stopIndex}`,
        );
      }

      stopTimesArray[timeIndex] = arrivalTime;
      stopTimesArray[timeIndex + 1] = departureTime;
      allDropOffTypes.push(dropOffType);
      allPickUpTypes.push(pickUpType);
    }
  }
  // Use 2-bit encoding for pickup/drop-off types
  const pickUpDropOffTypesArray = encodePickUpDropOffTypes(
    allPickUpTypes,
    allDropOffTypes,
  );
  return {
    serviceRouteId: builder.serviceRouteId,
    stops: stopsArray,
    stopTimes: stopTimesArray,
    pickUpDropOffTypes: pickUpDropOffTypesArray,
  };
};

/**
 * Parses the trips.txt file from a GTFS feed
 *
 * @param tripsStream The readable stream containing the trips data.
 * @param serviceIds A mapping of service IDs to corresponding route IDs.
 * @param routeIds A mapping of route IDs to route details.
 * @returns A mapping of trip IDs to corresponding route IDs.
 */
export const parseTrips = async (
  tripsStream: NodeJS.ReadableStream,
  serviceIds: ServiceIds,
  routeIds: ServiceRoutesMap,
): Promise<TripIdsMap> => {
  const trips: TripIdsMap = new Map();
  for await (const rawLine of parseCsv(tripsStream, ['stop_sequence'])) {
    const line = rawLine as TripEntry;
    if (!serviceIds.has(line.service_id)) {
      // The trip doesn't correspond to an active service
      continue;
    }
    if (!routeIds.get(line.route_id)) {
      // The trip doesn't correspond to a supported route
      continue;
    }
    trips.set(line.trip_id, line.route_id);
  }
  return trips;
};

export const buildStopsAdjacencyStructure = (
  validStops: Set<StopId>,
  routes: RoutesAdjacency,
  transfersMap: TransfersMap,
): StopsAdjacency => {
  const stopsAdjacency: StopsAdjacency = new Map();
  for (const routeId of routes.keys()) {
    const route = routes.get(routeId);
    if (!route) {
      throw new Error(`Route ${routeId} not found`);
    }
    for (const stop of route.stopsIterator()) {
      if (!stopsAdjacency.get(stop) && validStops.has(stop)) {
        stopsAdjacency.set(stop, { routes: [], transfers: [] });
      }

      stopsAdjacency.get(stop)?.routes.push(routeId);
    }
  }
  for (const [stop, transfers] of transfersMap) {
    const s = stopsAdjacency.get(stop);
    if (s) {
      for (const transfer of transfers) {
        if (validStops.has(transfer.destination)) {
          s.transfers.push(transfer);
        }
      }
    }
  }
  return stopsAdjacency;
};

/**
 * Parses the stop_times.txt data from a GTFS feed.
 *
 * @param stopTimesStream The readable stream containing the stop times data.
 * @param stopsMap A map of parsed stops from the GTFS feed.
 * @param validTripIds A map of valid trip IDs to corresponding route IDs.
 * @param validStopIds A set of valid stop IDs.
 * @returns A mapping of route IDs to route details. The routes returned correspond to the set of trips from GTFS that share the same stop list.
 */
export const parseStopTimes = async (
  stopTimesStream: NodeJS.ReadableStream,
  stopsMap: ParsedStopsMap,
  validTripIds: TripIdsMap,
  validStopIds: Set<StopId>,
): Promise<RoutesAdjacency> => {
  /**
   * Adds a trip to the appropriate route builder
   */
  const addTrip = (currentTripId: TripId) => {
    const gtfsRouteId = validTripIds.get(currentTripId);

    if (!gtfsRouteId || stops.length === 0) {
      stops = [];
      arrivalTimes = [];
      departureTimes = [];
      pickUpTypes = [];
      dropOffTypes = [];
      return;
    }

    const routeId = `${gtfsRouteId}_${hashIds(stops)}`;

    const firstDeparture = departureTimes[0];
    if (firstDeparture === undefined) {
      console.warn(`Empty trip ${currentTripId}`);
      stops = [];
      arrivalTimes = [];
      departureTimes = [];
      pickUpTypes = [];
      dropOffTypes = [];
      return;
    }

    let routeBuilder = routeBuilders.get(routeId);
    if (!routeBuilder) {
      routeBuilder = {
        serviceRouteId: gtfsRouteId,
        stops: [...stops],
        trips: [],
      };
      routeBuilders.set(routeId, routeBuilder);
      for (const stop of stops) {
        validStopIds.add(stop);
      }
    }

    routeBuilder.trips.push({
      firstDeparture,
      arrivalTimes: [...arrivalTimes],
      departureTimes: [...departureTimes],
      pickUpTypes: [...pickUpTypes],
      dropOffTypes: [...dropOffTypes],
    });

    stops = [];
    arrivalTimes = [];
    departureTimes = [];
    pickUpTypes = [];
    dropOffTypes = [];
  };

  const routeBuilders: Map<RouteId, RouteBuilder> = new Map();

  let previousSeq = 0;
  let stops: StopId[] = [];
  let arrivalTimes: number[] = [];
  let departureTimes: number[] = [];
  let pickUpTypes: SerializedPickUpDropOffType[] = [];
  let dropOffTypes: SerializedPickUpDropOffType[] = [];
  let currentTripId: TripId | undefined = undefined;

  for await (const rawLine of parseCsv(stopTimesStream, ['stop_sequence'])) {
    const line = rawLine as StopTimeEntry;
    if (line.trip_id === currentTripId && line.stop_sequence <= previousSeq) {
      console.warn(
        `Stop sequences not increasing for trip ${line.trip_id}: ${line.stop_sequence} > ${previousSeq}.`,
      );
      continue;
    }
    if (!line.arrival_time && !line.departure_time) {
      console.warn(
        `Missing arrival or departure time for ${line.trip_id} at stop ${line.stop_id}.`,
      );
      continue;
    }
    if (line.pickup_type === '1' && line.drop_off_type === '1') {
      continue;
    }
    if (currentTripId && line.trip_id !== currentTripId && stops.length > 0) {
      addTrip(currentTripId);
    }
    currentTripId = line.trip_id;

    const stopData = stopsMap.get(line.stop_id);
    if (!stopData) {
      console.warn(`Unknown stop ID: ${line.stop_id}`);
      continue;
    }
    stops.push(stopData.id);

    const departure = line.departure_time ?? line.arrival_time;
    const arrival = line.arrival_time ?? line.departure_time;

    if (!arrival || !departure) {
      console.warn(
        `Missing time data for ${line.trip_id} at stop ${line.stop_id}`,
      );
      continue;
    }
    arrivalTimes.push(toTime(arrival).toMinutes());
    departureTimes.push(toTime(departure).toMinutes());
    pickUpTypes.push(parsePickupDropOffType(line.pickup_type));
    dropOffTypes.push(parsePickupDropOffType(line.drop_off_type));

    previousSeq = line.stop_sequence;
  }
  if (currentTripId) {
    addTrip(currentTripId);
  }

  const routesAdjacency: RoutesAdjacency = new Map<RouteId, Route>();
  for (const [routeId, routeBuilder] of routeBuilders) {
    const routeData = finalizeRouteFromBuilder(routeBuilder);
    routesAdjacency.set(
      routeId,
      new Route(
        routeData.stopTimes,
        routeData.pickUpDropOffTypes,
        routeData.stops,
        routeData.serviceRouteId,
      ),
    );
  }
  return routesAdjacency;
};

const parsePickupDropOffType = (
  gtfsType?: GtfsPickupDropOffType,
): SerializedPickUpDropOffType => {
  switch (gtfsType) {
    default:
      return REGULAR;
    case '0':
      return REGULAR;
    case '1':
      return NOT_AVAILABLE;
    case '2':
      return MUST_PHONE_AGENCY;
    case '3':
      return MUST_COORDINATE_WITH_DRIVER;
  }
};
