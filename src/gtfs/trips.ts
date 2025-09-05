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
  | 0 // Regularly scheduled
  | 1 // Not available
  | 2 // Must phone agency
  | 3; // Must coordinate with driver

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
   * Inserts a trip at the right place in the routes adjacency structure.
   */
  const addTrip = (currentTripId: TripId) => {
    const gtfsRouteId = validTripIds.get(currentTripId);
    if (!gtfsRouteId) {
      stops = [];
      arrivalTimes = [];
      departureTimes = [];
      pickUpTypes = [];
      dropOffTypes = [];
      return;
    }
    const routeId = `${gtfsRouteId}_${hashIds(stops)}`;

    let route = routes.get(routeId);
    if (!route) {
      const stopsCount = stops.length;
      const stopsArray = new Uint32Array(stops);
      const stopTimesArray = new Uint16Array(stopsCount * 2);
      for (let i = 0; i < stopsCount; i++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        stopTimesArray[i * 2] = arrivalTimes[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        stopTimesArray[i * 2 + 1] = departureTimes[i]!;
      }
      const pickUpDropOffTypesArray = new Uint8Array(stopsCount * 2);
      for (let i = 0; i < stopsCount; i++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        pickUpDropOffTypesArray[i * 2] = pickUpTypes[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        pickUpDropOffTypesArray[i * 2 + 1] = dropOffTypes[i]!;
      }
      route = {
        serviceRouteId: gtfsRouteId,
        stops: stopsArray,
        stopTimes: stopTimesArray,
        pickUpDropOffTypes: pickUpDropOffTypesArray,
      };
      routes.set(routeId, route);
      for (const stop of stops) {
        validStopIds.add(stop);
      }
    } else {
      const tripFirstStopDeparture = departureTimes[0];
      if (tripFirstStopDeparture === undefined) {
        throw new Error(`Empty trip ${currentTripId}`);
      }

      // Find the correct position to insert the new trip
      const stopsCount = stops.length;
      let insertPosition = 0;
      const existingTripsCount = route.stopTimes.length / (stopsCount * 2);

      for (let tripIndex = 0; tripIndex < existingTripsCount; tripIndex++) {
        const currentDeparture =
          route.stopTimes[tripIndex * stopsCount * 2 + 1];
        if (currentDeparture && tripFirstStopDeparture > currentDeparture) {
          insertPosition = (tripIndex + 1) * stopsCount;
        } else {
          break;
        }
      }

      // insert data for the new trip at the right place
      const newStopTimesLength = route.stopTimes.length + stopsCount * 2;
      const newStopTimes = new Uint16Array(newStopTimesLength);
      const newPickUpDropOffTypes = new Uint8Array(newStopTimesLength);

      newStopTimes.set(route.stopTimes.slice(0, insertPosition * 2), 0);
      newPickUpDropOffTypes.set(
        route.pickUpDropOffTypes.slice(0, insertPosition * 2),
        0,
      );
      for (let i = 0; i < stopsCount; i++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        newStopTimes[(insertPosition + i) * 2] = arrivalTimes[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        newStopTimes[(insertPosition + i) * 2 + 1] = departureTimes[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        newPickUpDropOffTypes[(insertPosition + i) * 2] = pickUpTypes[i]!;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        newPickUpDropOffTypes[(insertPosition + i) * 2 + 1] = dropOffTypes[i]!;
      }
      const afterInsertionSlice = route.stopTimes.slice(insertPosition * 2);
      newStopTimes.set(afterInsertionSlice, (insertPosition + stopsCount) * 2);
      const afterInsertionTypesSlice = route.pickUpDropOffTypes.slice(
        insertPosition * 2,
      );
      newPickUpDropOffTypes.set(
        afterInsertionTypesSlice,
        (insertPosition + stopsCount) * 2,
      );

      route.stopTimes = newStopTimes;
      route.pickUpDropOffTypes = newPickUpDropOffTypes;
    }
    stops = [];
    arrivalTimes = [];
    departureTimes = [];
    pickUpTypes = [];
    dropOffTypes = [];
  };

  const routes: Map<RouteId, SerializedRoute> = new Map();

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
      console.warn(`Stop sequences not increasing for trip ${line.trip_id}.`);
      continue;
    }
    if (!line.arrival_time && !line.departure_time) {
      console.warn(
        `Missing arrival or departure time for ${line.trip_id} at stop ${line.stop_id}.`,
      );
      continue;
    }
    if (line.pickup_type === 1 && line.drop_off_type === 1) {
      continue;
    }
    if (currentTripId && line.trip_id !== currentTripId && stops.length > 0) {
      addTrip(currentTripId);
    }
    currentTripId = line.trip_id;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    stops.push(stopsMap.get(line.stop_id)!.id);
    const departure = line.departure_time ?? line.arrival_time;
    const arrival = line.arrival_time ?? line.departure_time;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    arrivalTimes.push(toTime(arrival!).toMinutes());
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    departureTimes.push(toTime(departure!).toMinutes());
    pickUpTypes.push(parsePickupDropOffType(line.pickup_type));
    dropOffTypes.push(parsePickupDropOffType(line.drop_off_type));

    previousSeq = line.stop_sequence;
  }
  if (currentTripId) {
    addTrip(currentTripId);
  }

  const routesAdjacency: RoutesAdjacency = new Map<RouteId, Route>();
  for (const [routeId, routeData] of routes) {
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
    case 0:
      return REGULAR;
    case 1:
      return NOT_AVAILABLE;
    case 2:
      return MUST_PHONE_AGENCY;
    case 3:
      return MUST_COORDINATE_WITH_DRIVER;
  }
};
