/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

import { MarkedStop } from '../routing/router.js';
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
import { Route, RouteId, TripId } from './route.js';

export type TransferType =
  | 'RECOMMENDED'
  | 'GUARANTEED'
  | 'REQUIRES_MINIMAL_TIME'
  | 'NOT_POSSIBLE'
  | 'IN_SEAT'
  | 'REQUIRES_ALIGHTING_AND_REBOARDING';

export type Transfer = {
  destination: StopId;
  type: TransferType;
  minTransferTime?: Duration;
  toServiceRoute?: ServiceRouteId;
  toTrip?: TripId;
};

export type StopAdjacency = {
  stopTransfers?: Transfer[];
  routeTransfers?: Map<ServiceRouteId, Transfer[]>;
  tripTransfers?: Map<TripId, Transfer[]>;
  routes: RouteId[];
};

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

export const CURRENT_VERSION = '0.0.7';

const EMPTY_TRANSFERS: ReadonlyArray<Transfer> = Object.freeze([]);
const EMPTY_ROUTES: ReadonlyArray<Route> = Object.freeze([]);

/**
 * The internal transit timetable format.
 */
export class Timetable {
  private readonly stopsAdjacency: ReadonlyArray<StopAdjacency>;
  private readonly routesAdjacency: ReadonlyArray<Route>;
  private readonly serviceRoutes: ReadonlyArray<ServiceRoute>;
  private readonly activeStops: ReadonlySet<StopId>;

  constructor(
    stopsAdjacency: ReadonlyArray<StopAdjacency>,
    routesAdjacency: ReadonlyArray<Route>,
    routes: ReadonlyArray<ServiceRoute>,
  ) {
    this.stopsAdjacency = stopsAdjacency;
    this.routesAdjacency = routesAdjacency;
    this.serviceRoutes = routes;
    const activeStops = new Set<StopId>();
    for (let i = 0; i < stopsAdjacency.length; i++) {
      const stop = stopsAdjacency[i]!;
      if (
        stop.routes.length > 0 ||
        (stop.stopTransfers !== undefined && stop.stopTransfers.length > 0) ||
        (stop.routeTransfers !== undefined && stop.routeTransfers.size > 0) ||
        (stop.tripTransfers !== undefined && stop.tripTransfers.size > 0)
      ) {
        activeStops.add(i);
      }
    }
    this.activeStops = activeStops;
  }

  /**
   * Serializes the Timetable into a binary array.
   *
   * @returns The serialized binary data.
   */
  serialize(): Uint8Array {
    const protoTimetable = {
      version: CURRENT_VERSION,
      stopsAdjacency: serializeStopsAdjacency(this.stopsAdjacency),
      routesAdjacency: serializeRoutesAdjacency(this.routesAdjacency),
      serviceRoutes: serializeServiceRoutesMap(this.serviceRoutes),
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
    if (protoTimetable.version !== CURRENT_VERSION) {
      throw new Error(
        `Unsupported timetable version ${protoTimetable.version}`,
      );
    }
    return new Timetable(
      deserializeStopsAdjacency(protoTimetable.stopsAdjacency),
      deserializeRoutesAdjacency(protoTimetable.routesAdjacency),

      deserializeServiceRoutesMap(protoTimetable.serviceRoutes),
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
   * Retrieves transfer options available at the specified stop, optionally filtered
   * by the originating service route or trip.
   *
   * @param stopId - The ID of the stop to retrieve transfers from.
   * @param fromServiceRoute - Optional service route ID to filter transfers from.
   * @param fromTrip - Optional trip ID to filter transfers from.
   * @returns An array of transfer options available at the stop, filtered by the specified criteria.
   */
  getTransfers(
    stopId: StopId,
    fromServiceRoute?: ServiceRouteId,
    fromTrip?: TripId,
  ): ReadonlyArray<Transfer> {
    const stop = this.stopsAdjacency[stopId];
    if (!stop) return EMPTY_TRANSFERS;
    const transfers: Transfer[] = [];

    if (stop.stopTransfers) {
      transfers.push(...stop.stopTransfers);
    }

    if (fromServiceRoute !== undefined && stop.routeTransfers) {
      const routeTransfers = stop.routeTransfers.get(fromServiceRoute);
      if (routeTransfers) {
        transfers.push(...routeTransfers);
      }
    }

    if (fromTrip !== undefined && stop.tripTransfers) {
      const tripTransfers = stop.tripTransfers.get(fromTrip);
      if (tripTransfers) {
        transfers.push(...tripTransfers);
      }
    }

    return transfers;
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { routes, ...serviceRouteInfo } = serviceRoute;
    return serviceRouteInfo;
  }

  /**
   * Finds all routes passing through a stop.
   *
   * @param stopId - The ID of the stop to find routes for.
   * @returns An array of routes passing through the specified stop.
   */
  routesPassingThrough(stopId: StopId): ReadonlyArray<Route> {
    const stopData = this.stopsAdjacency[stopId];
    if (!stopData) {
      return EMPTY_ROUTES;
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
   * Also identifies the first stop available to hop on each route among
   * the input stops.
   *
   * @param fromStops - The set of stop IDs to find reachable routes from.
   * @param transportModes - The set of transport modes to consider for reachable routes.
   * @returns A map of reachable routes to the first stop available to hop on each route.
   */
  findReachableRoutes(
    fromStops: Set<MarkedStop>,
    transportModes: Set<RouteType> = ALL_TRANSPORT_MODES,
  ): Map<Route, StopId> {
    const reachableRoutes = new Map<Route, StopId>();
    const fromStopsArray = Array.from(fromStops);
    for (let i = 0; i < fromStopsArray.length; i++) {
      const originStop = fromStopsArray[i]!;
      const routesPassingThrough = this.routesPassingThrough(originStop.stopId);
      for (let j = 0; j < routesPassingThrough.length; j++) {
        const route = routesPassingThrough[j]!;

        // Check if the transport mode is allowed
        if (transportModes.size > 0) {
          const serviceRoute = this.getServiceRouteInfo(route);
          if (!transportModes.has(serviceRoute.type)) {
            continue;
          }
        }

        const hopOnStop = reachableRoutes.get(route);
        if (hopOnStop) {
          if (route.isBefore(originStop.stopId, hopOnStop)) {
            // if the current stop is before the existing hop on stop, replace it
            reachableRoutes.set(route, originStop.stopId);
          }
        } else {
          reachableRoutes.set(route, originStop.stopId);
        }
      }
    }
    return reachableRoutes;
  }
}
