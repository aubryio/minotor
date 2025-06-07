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
import { Route, RouteId } from './route.js';

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

export const CURRENT_VERSION = '0.0.3';

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
   * Serializes the Timetable into a binary array.
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

  getServiceRoute(route: Route): ServiceRoute {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.routes.get(route.serviceRoute())!;
  }

  routesPassingThrough(stopId: StopId): Route[] {
    return (
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.stopsAdjacency
        .get(stopId)!
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .routes.map((routeId) => this.routesAdjacency.get(routeId)!)
    );
  }

  /**
   * Finds routes that are reachable from a set of stop IDs.
   * Also identifies the first stop available to hop on each route among
   * the input stops.
   */
  findReachableRoutes(
    fromStops: Set<StopId>,
    transportModes: RouteType[] = ALL_TRANSPORT_MODES,
  ): Map<Route, StopId> {
    const reachableRoutes = new Map<Route, StopId>();
    for (const originStop of fromStops) {
      const validRoutes = this.routesPassingThrough(originStop).filter(
        (route) => {
          const serviceRoute = this.getServiceRoute(route);
          return transportModes.includes(serviceRoute.type);
        },
      );
      for (const route of validRoutes) {
        const hopOnStop = reachableRoutes.get(route);
        if (hopOnStop) {
          if (route.isBefore(originStop, hopOnStop)) {
            // if the current stop is before the existing hop on stop, replace it
            reachableRoutes.set(route, originStop);
          }
        } else {
          reachableRoutes.set(route, originStop);
        }
      }
    }
    return reachableRoutes;
  }
}
