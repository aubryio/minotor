/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

import { StopId } from '../stops/stops.js';
import {
  deserializeRoutesAdjacency,
  deserializeServiceRoutesMap,
  deserializeStopsAdjacency,
  deserializeTripTransfers,
  serializeRoutesAdjacency,
  serializeServiceRoutesMap,
  serializeStopsAdjacency,
  serializeTripTransfers,
} from './io.js';
import { Timetable as ProtoTimetable } from './proto/v1/timetable.js';
import { NOT_AVAILABLE } from './route.js';
import { Route, RouteId, StopRouteIndex, TripRouteIndex } from './route.js';
import { Duration, DURATION_ZERO, Time, TIME_ORIGIN } from './time.js';
import { encode, TripStopId } from './tripStopId.js';

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

export type TripStop = {
  stopIndex: StopRouteIndex;
  routeId: RouteId;
  tripIndex: TripRouteIndex;
};

export type StopAdjacency = {
  transfers?: Transfer[];
  routes: RouteId[];
};

export type TripTransfers = Map<TripStopId, TripStop[]>;

export type ServiceRouteId = number;

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

// A service refers to a collection of trips that are displayed to riders as a single service.
// As opposed to a route which consists of the subset of trips from a service which shares the same list of stops.
// Service is here a synonym for route in the GTFS sense.
export type ServiceRoute = {
  type: RouteType;
  name: string;
  routes: RouteId[];
};
export type ServiceRouteInfo = Omit<ServiceRoute, 'routes'>;

export const ALL_TRANSPORT_MODES: Set<RouteType> = new Set([
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
]);

const EMPTY_TRIP_BOARDINGS: TripStop[] = [];

/**
 * The internal transit timetable format.
 */
export class Timetable {
  private readonly stopsAdjacency: StopAdjacency[];
  private readonly routesAdjacency: Route[];
  private readonly serviceRoutes: ServiceRoute[];
  private readonly tripContinuations?: TripTransfers;
  private readonly guaranteedTripTransfers?: TripTransfers;
  private readonly activeStops: Set<StopId>;

  constructor(
    stopsAdjacency: StopAdjacency[],
    routesAdjacency: Route[],
    routes: ServiceRoute[],
    tripContinuations?: TripTransfers,
    guaranteedTripTransfers?: TripTransfers,
  ) {
    this.stopsAdjacency = stopsAdjacency;
    this.routesAdjacency = routesAdjacency;
    this.serviceRoutes = routes;
    this.tripContinuations = tripContinuations;
    this.guaranteedTripTransfers = guaranteedTripTransfers;
    this.activeStops = new Set<StopId>();
    for (let i = 0; i < stopsAdjacency.length; i++) {
      const stop = stopsAdjacency[i]!;
      if (
        stop.routes.length > 0 ||
        (stop.transfers && stop.transfers.length > 0)
      ) {
        this.activeStops.add(i);
      }
    }
  }

  /**
   * Serializes the Timetable into a binary array.
   *
   * @returns The serialized binary data.
   */
  serialize(): Uint8Array {
    const protoTimetable = {
      stopsAdjacency: serializeStopsAdjacency(this.stopsAdjacency),
      routesAdjacency: serializeRoutesAdjacency(this.routesAdjacency),
      serviceRoutes: serializeServiceRoutesMap(this.serviceRoutes),
      tripContinuations: serializeTripTransfers(
        this.tripContinuations || new Map<TripStopId, TripStop[]>(),
      ),
      guaranteedTripTransfers: serializeTripTransfers(
        this.guaranteedTripTransfers || new Map<TripStopId, TripStop[]>(),
      ),
    };
    const writer = new BinaryWriter();
    ProtoTimetable.encode(protoTimetable, writer);
    return writer.finish();
  }

  /**
   * Deserializes a binary protobuf into a Timetable object.
   *
   * @param data - The binary data to deserialize.
   * @returns The deserialized Timetable object.
   */
  static fromData(data: Uint8Array): Timetable {
    const reader = new BinaryReader(data);
    const protoTimetable = ProtoTimetable.decode(reader);
    return new Timetable(
      deserializeStopsAdjacency(protoTimetable.stopsAdjacency),
      deserializeRoutesAdjacency(protoTimetable.routesAdjacency),
      deserializeServiceRoutesMap(protoTimetable.serviceRoutes),
      deserializeTripTransfers(protoTimetable.tripContinuations),
      deserializeTripTransfers(protoTimetable.guaranteedTripTransfers),
    );
  }

  /**
   * Checks if the given stop is active on the timetable.
   * An active stop is a stop reached by a route that is active on the timetable
   * or by a transfer reachable from an active route.
   *
   * @param stopId - The ID of the stop to check.
   * @returns True if the stop is active, false otherwise.
   */
  isActive(stopId: StopId): boolean {
    return this.activeStops.has(stopId);
  }

  /**
   * Returns the total number of stops in the timetable.
   */
  nbStops(): number {
    return this.stopsAdjacency.length;
  }

  /**
   * Retrieves the route associated with the given route ID.
   *
   * @param routeId - The ID of the route to be retrieved.
   * @returns The route corresponding to the provided ID,
   * or undefined if no such route exists.
   */
  getRoute(routeId: RouteId): Route | undefined {
    return this.routesAdjacency[routeId];
  }

  /**
   * Retrieves all transfer options available at the specified stop.
   *
   * @param stopId - The ID of the stop to get transfers for.
   * @returns An array of transfer options available at the stop.
   */
  getTransfers(stopId: StopId): Transfer[] {
    const stopAdjacency = this.stopsAdjacency[stopId];
    if (!stopAdjacency) {
      throw new Error(`Stop ID ${stopId} not found`);
    }
    return stopAdjacency.transfers || [];
  }

  /**
   * Retrieves all trip continuation options available at the specified stop for a given trip.
   *
   * @param stopIndex - The index in the route of the stop to get trip continuations for.
   * @param routeId - The ID of the route to get continuations for.
   * @param tripIndex - The index of the trip to get continuations for.
   * @returns An array of trip continuation options available at the stop for the specified trip.
   */
  getContinuousTrips(
    stopIndex: StopRouteIndex,
    routeId: RouteId,
    tripIndex: TripRouteIndex,
  ): TripStop[] {
    const tripContinuations = this.tripContinuations?.get(
      encode(stopIndex, routeId, tripIndex),
    );
    if (!tripContinuations) {
      return EMPTY_TRIP_BOARDINGS;
    }
    return tripContinuations;
  }

  /**
   * Retrieves the service route associated with the given route.
   * A service route refers to a collection of trips that are displayed
   * to riders as a single service.
   *
   * @param route - The route for which the service route is to be retrieved.
   * @returns The service route corresponding to the provided route.
   */
  getServiceRouteInfo(route: Route): ServiceRouteInfo {
    const serviceRoute = this.serviceRoutes[route.serviceRoute()];
    if (!serviceRoute) {
      throw new Error(
        `Service route not found for route ID: ${route.serviceRoute()}`,
      );
    }
    return { type: serviceRoute.type, name: serviceRoute.name };
  }

  /**
   * Finds all routes passing through a stop.
   *
   * @param stopId - The ID of the stop to find routes for.
   * @returns An array of routes passing through the specified stop.
   */
  routesPassingThrough(stopId: StopId): Route[] {
    const stopData = this.stopsAdjacency[stopId];
    if (!stopData) {
      return [];
    }
    const routes: Route[] = [];
    for (let i = 0; i < stopData.routes.length; i++) {
      const routeId = stopData.routes[i]!;
      const route = this.routesAdjacency[routeId];
      if (route) {
        routes.push(route);
      }
    }
    return routes;
  }

  /**
   * Finds routes that are reachable from a set of stop IDs.
   * Also identifies the first stop index available to hop on each route among
   * the input stops.
   *
   * @param fromStops - The set of stop IDs to find reachable routes from.
   * @param transportModes - The set of transport modes to consider for reachable routes.
   * @returns A map of reachable routes to the first stop index available to hop on each route.
   */
  findReachableRoutes(
    fromStops: Set<StopId>,
    transportModes: Set<RouteType> = ALL_TRANSPORT_MODES,
  ): Map<Route, StopRouteIndex> {
    const reachableRoutes = new Map<Route, StopRouteIndex>();
    // Skip the per-route mode check entirely when all modes are allowed,
    // which is the common case.
    const filterByMode = transportModes !== ALL_TRANSPORT_MODES;

    for (const originStop of fromStops) {
      const stopData = this.stopsAdjacency[originStop];
      if (!stopData) continue;

      for (let i = 0; i < stopData.routes.length; i++) {
        const route = this.routesAdjacency[stopData.routes[i]!];
        if (!route) continue;

        if (filterByMode) {
          const serviceRoute = this.serviceRoutes[route.serviceRoute()];
          if (!serviceRoute || !transportModes.has(serviceRoute.type)) continue;
        }

        const originStopIndex = route.stopRouteIndices(originStop)[0]!;
        const existingHopOnStopIndex = reachableRoutes.get(route);
        if (existingHopOnStopIndex !== undefined) {
          if (originStopIndex < existingHopOnStopIndex) {
            reachableRoutes.set(route, originStopIndex);
          }
        } else {
          reachableRoutes.set(route, originStopIndex);
        }
      }
    }
    return reachableRoutes;
  }

  /**
   * Checks if a trip transfer is guaranteed for a given trip boarding.
   *
   * @param fromTripStop - The trip stop for the trip transfer origin.
   * @param toTripStop - The trip stop to check if it's guaranteed.
   * @returns True if the trip transfer is guaranteed, false otherwise.
   */
  isTripTransferGuaranteed(
    fromTripStop: TripStop,
    toTripStop: TripStop,
  ): boolean {
    const tripBoardingId = encode(
      fromTripStop.stopIndex,
      fromTripStop.routeId,
      fromTripStop.tripIndex,
    );
    const guaranteedTransfers =
      this.guaranteedTripTransfers?.get(tripBoardingId);
    if (!guaranteedTransfers) {
      return false;
    }
    for (let i = 0; i < guaranteedTransfers.length; i++) {
      const transfer = guaranteedTransfers[i]!;
      if (
        transfer.stopIndex === toTripStop.stopIndex &&
        transfer.routeId === toTripStop.routeId &&
        transfer.tripIndex === toTripStop.tripIndex
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Finds the first trip on `route` at `stopIndex` that can be boarded, starting
   * from `earliestTrip` and respecting pickup availability, transfer guarantees,
   * and minimum transfer times.
   *
   * @param stopIndex     Stop at which boarding is attempted.
   * @param route         The route to search.
   * @param earliestTrip  First trip index to consider.
   * @param after         Earliest time after which boarding is allowed.
   * @param beforeTrip    Exclusive upper bound on the trip index (omit to search all).
   * @param fromTripStop  The alighted trip stop when transferring from another trip;
   *                      `undefined` when boarding from a walk or origin.
   * @param transferTime  Minimum transfer time required between trips.
   * @returns The index of the first boardable trip, or `undefined` if none found.
   */
  findFirstBoardableTrip(
    stopIndex: StopRouteIndex,
    route: Route,
    earliestTrip: TripRouteIndex,
    after: Time = TIME_ORIGIN,
    beforeTrip?: TripRouteIndex,
    fromTripStop?: TripStop,
    transferTime: Duration = DURATION_ZERO,
  ): TripRouteIndex | undefined {
    const nbTrips = route.getNbTrips();

    for (let t = earliestTrip; t < (beforeTrip ?? nbTrips); t++) {
      const pickup = route.pickUpTypeFrom(stopIndex, t);
      if (pickup === NOT_AVAILABLE) {
        continue;
      }
      if (fromTripStop === undefined) {
        return t;
      }

      const isGuaranteed = this.isTripTransferGuaranteed(fromTripStop, {
        stopIndex,
        routeId: route.id,
        tripIndex: t,
      });
      if (isGuaranteed) {
        return t;
      }
      const departure = route.departureFrom(stopIndex, t);
      const requiredTime = after + transferTime;
      if (departure >= requiredTime) {
        return t;
      }
    }
    return undefined;
  }

  /**
   * Retrieves all guaranteed trip transfer options available at the specified stop for a given trip.
   *
   * @param stopIndex - The index in the route of the stop to get guaranteed trip transfers for.
   * @param routeId - The ID of the route to get guaranteed transfers for.
   * @param tripIndex - The index of the trip to get guaranteed transfers for.
   * @returns An array of trip boarding options that are guaranteed for the specified trip.
   */
  getGuaranteedTripTransfers(
    stopIndex: StopRouteIndex,
    routeId: RouteId,
    tripIndex: TripRouteIndex,
  ): TripStop[] {
    const guaranteedTripTransfers = this.guaranteedTripTransfers?.get(
      encode(stopIndex, routeId, tripIndex),
    );
    if (!guaranteedTripTransfers) {
      return EMPTY_TRIP_BOARDINGS;
    }
    return guaranteedTripTransfers;
  }
}
