import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

import { TripId } from '../routing/route.js';
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
import { Route, RouteId } from './route.js';

export type TransferType =
  | 'RECOMMENDED'
  | 'GUARANTEED'
  | 'REQUIRES_MINIMAL_TIME'
  | 'IN_SEAT';

export type Transfer = {
  destination: StopId;
  type: TransferType;
  minTransferTime?: Duration;
  fromServiceRoute?: ServiceRouteId;
  toServiceRoute?: ServiceRouteId;
  fromTrip?: TripId;
  toTrip?: TripId;
};

export type StopsAdjacency = Map<
  StopId,
  {
    transfers: Transfer[];
    routes: RouteId[];
  }
>;

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
type ServiceRoute = {
  type: RouteType;
  name: string;
  description: string;
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

export const CURRENT_VERSION = '0.0.5';

/**
 * The internal transit timetable format.
 */
export class Timetable {
  private readonly stopsAdjacency: StopsAdjacency;
  private readonly routesAdjacency: Route[];
  private readonly serviceRoutes: ServiceRoute[];

  constructor(
    stopsAdjacency: StopsAdjacency,
    routesAdjacency: Route[],
    serviceRoutes: ServiceRoute[],
  ) {
    this.stopsAdjacency = stopsAdjacency;
    this.routesAdjacency = routesAdjacency;
    this.serviceRoutes = serviceRoutes;
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
      routes: serializeServiceRoutesMap(this.serviceRoutes),
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
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      deserializeStopsAdjacency(protoTimetable.stopsAdjacency!),
      deserializeRoutesAdjacency(protoTimetable.routesAdjacency),
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      deserializeServiceRoutesMap(protoTimetable.routes!),
    );
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
   * @param stopId - The ID of the stop to get transfers for.
   * @param fromServiceRoute - Optional service route ID to filter transfers from.
   * @param fromTrip - Optional trip ID to filter transfers from.
   * @returns An array of transfer options available at the stop, filtered by the specified criteria.
   */
  getTransfers(
    stopId: StopId,
    fromServiceRoute?: ServiceRouteId,
    fromTrip?: TripId,
  ): Transfer[] {
    return (
      this.stopsAdjacency.get(stopId)?.transfers.filter((transfer) => {
        if (
          transfer.fromTrip === undefined &&
          transfer.fromServiceRoute === undefined
        ) {
          return true;
        }
        if (transfer.fromTrip !== undefined && transfer.fromTrip === fromTrip) {
          return true;
        }
        if (
          transfer.fromServiceRoute !== undefined &&
          transfer.fromServiceRoute === fromServiceRoute
        ) {
          return true;
        }
        return false;
      }) ?? []
    );
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
  routesPassingThrough(stopId: StopId): Route[] {
    const stopData = this.stopsAdjacency.get(stopId);
    if (!stopData) {
      return [];
    }
    const routes: Route[] = [];
    for (const routeId of stopData.routes) {
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
   * Each stop is mapped to its trip constraints if any (if one or more trip appears in the Set,
   * the stop is reachable only on those trips).
   */
  findReachableRoutes(
    fromStops: Set<MarkedStop>,
    transportModes: Set<RouteType> = ALL_TRANSPORT_MODES,
  ): Map<Route, StopId> {
    const reachableRoutes = new Map<Route, StopId>();
    for (const originStop of fromStops) {
      const validRoutes = this.routesPassingThrough(originStop.stopId).filter(
        (route) => {
          if (
            // check if the previous transfer allowed to hop on the route
            originStop.toServiceRoute !== undefined &&
            originStop.toServiceRoute !== route.serviceRoute()
          ) {
            return false;
          }
          if (transportModes.size === 0) {
            return true;
          }
          const serviceRoute = this.getServiceRouteInfo(route);
          return transportModes.has(serviceRoute.type);
        },
      );
      for (const route of validRoutes) {
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
