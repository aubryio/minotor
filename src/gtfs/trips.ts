import { StopId } from '../stops/stops.js';
import {
  PickUpDropOffType,
  Route,
  RouteId,
  RoutesAdjacency,
  ServiceRouteId,
  ServiceRoutesMap,
  StopsAdjacency,
  StopTimes,
} from '../timetable/timetable.js';
import { ServiceIds } from './services.js';
import { StopIds } from './stops.js';
import { GtfsTime, toTime } from './time.js';
import { TransfersMap } from './transfers.js';
import { hash, parseCsv } from './utils.js';

export type TripId = string;

export type TripIdsMap = Map<TripId, ServiceRouteId>;

type TripEntry = {
  route_id: RouteId;
  service_id: ServiceRouteId;
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
  stop_id: StopId;
  stop_sequence: number;
  pickup_type?: GtfsPickupDropOffType;
  drop_off_type?: GtfsPickupDropOffType;
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
  for await (const rawLine of parseCsv(tripsStream)) {
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
  validStops: StopIds,
  routes: RoutesAdjacency,
  transfersMap: TransfersMap,
): StopsAdjacency => {
  const stopsAdjacency: StopsAdjacency = new Map();
  for (const routeId of routes.keys()) {
    const route = routes.get(routeId) as Route;
    for (const stop of route.stops) {
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
 * @param validTripIds A map of valid trip IDs to corresponding route IDs.
 * @param validStopIds A map of valid stop IDs.
 * @returns A mapping of route IDs to route details. The routes return corresponds to the set of trips from GTFS that share the same stop list.
 */
export const parseStopTimes = async (
  stopTimesStream: NodeJS.ReadableStream,
  validTripIds: TripIdsMap,
  validStopIds: StopIds,
): Promise<RoutesAdjacency> => {
  const addTrip = (currentTripId: TripId) => {
    const gtfsRouteId = validTripIds.get(currentTripId);
    if (!gtfsRouteId) {
      stops = [];
      stopTimes = [];
      return;
    }
    const routeId = `${gtfsRouteId}_${hash(stops.join('$'))}`;

    let route = routes.get(routeId);
    if (!route) {
      route = {
        serviceRouteId: gtfsRouteId,
        stops: [...stops],
        stopIndices: new Map(stops.map((stop, i) => [stop, i])),
        stopTimes: [...stopTimes],
      };
      routes.set(routeId, route);
      for (const stop of stops) {
        validStopIds.add(stop);
      }
    } else {
      const tripFirstStop = stopTimes[0];
      if (!tripFirstStop) {
        throw new Error(`Empty trip ${currentTripId}`);
      }
      // insert the stopTimes at the right position
      let stopTimesIndex = 0;
      for (let i = 0; i < route.stopTimes.length; i += stops.length) {
        const currentDeparture = route.stopTimes[i];
        if (
          currentDeparture &&
          tripFirstStop.departure > currentDeparture.departure
        ) {
          stopTimesIndex = i + stops.length;
        } else {
          break;
        }
      }
      route.stopTimes.splice(stopTimesIndex, 0, ...stopTimes);
    }
    stops = [];
    stopTimes = [];
  };

  const routes: RoutesAdjacency = new Map();

  let previousSeq = 0;
  let stops: StopId[] = [];
  let stopTimes: StopTimes[] = [];
  let currentTripId: TripId | undefined = undefined;

  for await (const rawLine of parseCsv(stopTimesStream)) {
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
    if (
      currentTripId &&
      line.trip_id !== currentTripId &&
      stops.length > 0 &&
      stopTimes.length > 0
    ) {
      addTrip(currentTripId);
    }
    currentTripId = line.trip_id;
    stops.push(line.stop_id);
    const departure = line.departure_time ?? line.arrival_time;
    const arrival = line.arrival_time ?? line.departure_time;
    stopTimes.push({
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      departure: toTime(departure!),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      arrival: toTime(arrival!),
      pickUpType: parsePickupDropOffType(line.pickup_type),
      dropOffType: parsePickupDropOffType(line.drop_off_type),
    });
    previousSeq = line.stop_sequence;
  }
  if (currentTripId) {
    addTrip(currentTripId);
  }

  return routes;
};

const parsePickupDropOffType = (
  gtfsType?: GtfsPickupDropOffType,
): PickUpDropOffType => {
  switch (gtfsType) {
    default:
      console.warn(`Unknown pickup/drop-off type ${gtfsType}`);
      return 'REGULAR';
    case 0:
      return 'REGULAR';
    case 1:
      return 'NOT_AVAILABLE';
    case 2:
      return 'MUST_PHONE_AGENCY';
    case 3:
      return 'MUST_COORDINATE_WITH_DRIVER';
  }
};
