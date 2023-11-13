import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

import { StopId } from '../stops/stops.js';
import { Duration } from './duration.js';
import {
  deserializeRoutesAdjacency,
  deserializeServiceRoutesMap,
  deserializeStopsAdjacency,
  serializeRoutesAdjacency,
  serializeServiceRoutesMap,
  serializeStopsAdjacency,
} from './io.js';
import { Timetable as ProtoTimetable } from './proto/timetable.js';
import { Time } from './time.js';

export type PickUpDropOffType =
  | 'REGULAR'
  | 'NOT_AVAILABLE'
  | 'MUST_PHONE_AGENCY'
  | 'MUST_COORDINATE_WITH_DRIVER';

export type StopTimes = {
  arrival: Time;
  departure: Time;
  pickUpType: PickUpDropOffType;
  dropOffType: PickUpDropOffType;
};
export type RouteId = string;

export type IndexedStopId = {
  stopId: StopId;
  index: number;
};
export type Route = {
  stopTimes: StopTimes[];
  stops: StopId[];
  stopIndices: Map<StopId, number>;
  serviceRouteId: ServiceRouteId;
};
export type RoutesAdjacency = Map<RouteId, Route>;

export type TransferType =
  | 'RECOMMENDED'
  | 'GUARANTEED'
  | 'REQUIRES_MINIMAL_TIME'
  | 'IN_SEAT';

export type Transfer = {
  destination: StopId;
  type: TransferType;
  minTransferTime?: Duration;
};

export type StopsAdjacency = Map<
  StopId,
  {
    transfers: Transfer[];
    routes: RouteId[];
  }
>;

export type ServiceRouteId = string;

export type RouteType =
  | 'TRAM'
  | 'SUBWAY'
  | 'RAIL'
  | 'BUS'
  | 'FERRY'
  | 'CABLE_TRAM'
  | 'AERIAL_LIFT'
  | 'FUNICULAR'
  | 'TROLLEYBUS'
  | 'MONORAIL';

export type ServiceRoute = {
  type: RouteType;
  name: string;
};

// A service refers to a collection of trips that are displayed to riders as a single service.
// As opposed to a route which consists of the subset of trips from a service which shares the same list of stops.
// Service is here a synonym for route in the GTFS sense.
export type ServiceRoutesMap = Map<ServiceRouteId, ServiceRoute>;

// a trip index corresponds to the index of the
// first stop time in the trip modulo the number of stops
// in the given route
type TripIndex = number;

export const ALL_TRANSPORT_MODES: RouteType[] = [
  'TRAM',
  'SUBWAY',
  'RAIL',
  'BUS',
  'FERRY',
  'CABLE_TRAM',
  'AERIAL_LIFT',
  'FUNICULAR',
  'TROLLEYBUS',
  'MONORAIL',
];

export const CURRENT_VERSION = '0.0.1';

/**
 * The internal transit timetable format
 * reuses some GTFS concepts for the sake of simplicity for now.
 */
export class Timetable {
  private readonly stopsAdjacency: StopsAdjacency;
  private readonly routesAdjacency: RoutesAdjacency;
  private readonly routes: ServiceRoutesMap;

  constructor(
    stopsAdjacency: StopsAdjacency,
    routesAdjacency: RoutesAdjacency,
    routes: ServiceRoutesMap,
  ) {
    this.stopsAdjacency = stopsAdjacency;
    this.routesAdjacency = routesAdjacency;
    this.routes = routes;
  }

  /**
   * Serializes the Timetable into a binary protobuf.
   *
   * @returns {Uint8Array} - The serialized binary data.
   */
  serialize(): Uint8Array {
    const protoTimetable = {
      version: CURRENT_VERSION,
      stopsAdjacency: serializeStopsAdjacency(this.stopsAdjacency),
      routesAdjacency: serializeRoutesAdjacency(this.routesAdjacency),
      routes: serializeServiceRoutesMap(this.routes),
    };
    const writer = new BinaryWriter();
    ProtoTimetable.encode(protoTimetable, writer);
    return writer.finish();
  }

  /**
   * Deserializes a binary protobuf into a Timetable object.
   *
   * @param {Uint8Array} data - The binary data to deserialize.
   * @returns {Timetable} - The deserialized Timetable object.
   */
  static fromData(data: Uint8Array): Timetable {
    const reader = new BinaryReader(data);
    const protoTimetable = ProtoTimetable.decode(reader);
    if (protoTimetable.version !== CURRENT_VERSION) {
      throw new Error(
        `Unsupported timetable version ${protoTimetable.version}`,
      );
    }
    return new Timetable(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      deserializeStopsAdjacency(protoTimetable.stopsAdjacency!),
      deserializeRoutesAdjacency(
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        protoTimetable.routesAdjacency!,
      ),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      deserializeServiceRoutesMap(protoTimetable.routes!),
    );
  }

  getRoute(routeId: RouteId): Route | undefined {
    return this.routesAdjacency.get(routeId);
  }

  getTransfers(stopId: StopId): Transfer[] {
    return this.stopsAdjacency.get(stopId)?.transfers ?? [];
  }

  /**
   * Finds routes that are reachable from a set of stop IDs.
   * Also identifies the first stop available to hop on each route among
   * the input stops.
   */
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  findReachableRoutes(
    fromStops: Set<StopId>,
    transportModes: RouteType[] = ALL_TRANSPORT_MODES,
  ): Map<RouteId, StopId> {
    const reachableRoutes = new Map<RouteId, StopId>();
    for (const stop of fromStops) {
      const validRoutes = this.stopsAdjacency
        .get(stop)
        ?.routes.filter((routeId) => {
          const serviceRoute = this.getServiceRouteFromRouteId(routeId);
          if (!serviceRoute) {
            return false;
          }
          return transportModes.includes(serviceRoute.type);
        });
      for (const routeId of validRoutes || []) {
        const hopOnStop = reachableRoutes.get(routeId);
        if (hopOnStop) {
          // Checks if the existing hop on stop is before the current stop
          const routeStopIndices =
            this.routesAdjacency.get(routeId)!.stopIndices;
          const stopIndex = routeStopIndices.get(stop)!;
          const hopOnStopIndex = routeStopIndices.get(hopOnStop)!;
          if (stopIndex < hopOnStopIndex) {
            // if the current stop is before the existing hop on stop, replace it
            reachableRoutes.set(routeId, stop);
          }
        } else {
          reachableRoutes.set(routeId, stop);
        }
      }
    }
    return reachableRoutes;
  }

  getServiceRouteFromRouteId(routeId: RouteId): ServiceRoute | undefined {
    const route = this.routesAdjacency.get(routeId);
    if (!route) {
      console.warn(`Route ${routeId} not found.`);
      return undefined;
    }
    return this.routes.get(route.serviceRouteId);
  }

  getServiceRoute(serviceRouteId: ServiceRouteId): ServiceRoute | undefined {
    return this.routes.get(serviceRouteId);
  }

  /**
   * Finds the earliest trip that can be taken from a specific stop on a given route,
   * optionally constrained by a latest trip index and a time before which the trip
   * should not depart.
   */
  findEarliestTrip(
    route: Route,
    stopId: StopId,
    beforeTrip?: TripIndex,
    after: Time = Time.origin(),
  ): TripIndex | undefined {
    const stopIndex = route.stopIndices.get(stopId)!;

    const stopsNumber = route.stops.length;

    if (beforeTrip === undefined) {
      for (
        let tripIndex = 0;
        tripIndex < route.stopTimes.length / stopsNumber;
        tripIndex++
      ) {
        const stopTimeIndex = tripIndex * stopsNumber + stopIndex;
        const stopTime = route.stopTimes[stopTimeIndex]!;
        if (
          stopTime.departure > after &&
          stopTime.pickUpType !== 'NOT_AVAILABLE'
        ) {
          return tripIndex;
        }
      }
      return undefined;
    } else {
      let earliestTripIndex: TripIndex | undefined;
      let earliestDeparture: Time | undefined;
      for (
        let tripIndex = beforeTrip; // ?? route.stopTimes.length / stopsNumber - 1;
        tripIndex >= 0;
        tripIndex--
      ) {
        const stopTimeIndex = tripIndex * stopsNumber + stopIndex;
        const stopTime = route.stopTimes[stopTimeIndex]!;
        if (stopTime.departure <= after) {
          break;
        }
        if (
          stopTime.pickUpType !== 'NOT_AVAILABLE' &&
          (earliestDeparture === undefined ||
            stopTime.departure < earliestDeparture)
        ) {
          earliestTripIndex = tripIndex;
          earliestDeparture = stopTime.departure;
        }
      }
      return earliestTripIndex;
    }
  }
}
