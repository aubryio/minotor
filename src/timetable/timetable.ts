/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

import { StopId } from '../stops/stops.js';
import {
  deserializeRoutesAdjacency,
  deserializeServiceRoutesMap,
  deserializeStopsAdjacency,
  deserializeTripRules,
  serializeRoutesAdjacency,
  serializeServiceRoutesMap,
  serializeStopsAdjacency,
  serializeTripRules,
} from './io.js';
import { Timetable as ProtoTimetable } from './proto/v1/timetable.js';
import {
  PickUpDropOffTypes,
  Route,
  RouteId,
  StopRouteIndex,
  TripRouteIndex,
} from './route.js';
import { Duration, Time } from './time.js';
import {
  Transfer,
  TransferType,
  TransferTypes,
  TransferTypeString,
  TripStop,
  TripTransfers,
} from './transfer.js';
import { TripRule, TripStopId, TripTransferIndex } from './tripTransfers.js';

export type {
  Transfer,
  TransferType,
  TransferTypeString,
  TripPosition,
  TripStop,
  TripTransferDestination,
  TripTransfers,
} from './transfer.js';
export { TransferTypes } from './transfer.js';

/** Feeder identity and actual arrival, independent of routing graph labels. */
export type BoardingSource = {
  tripStopId: TripStopId;
  arrival: Time;
};

export type ResolvedBoarding = {
  ready: Time;
  rule?: TripRule;
};

/** Timetable lookup constraints, independent of routing labels and rounds. */
export type BoardingSearch = {
  genericReady: Time;
  fallbackTransferDuration: Duration;
  source?: BoardingSource;
  /** Exclusive trip index bound; omitted means all trips. */
  beforeTrip?: TripRouteIndex;
  /** Inclusive departure ceiling; omitted means unrestricted. */
  maxDeparture?: Time;
  /** Exclusive departure ceiling; omitted means unrestricted. */
  beforeDeparture?: Time;
};

export type StopAdjacency = {
  transfers?: Transfer[];
  routes: RouteId[];
};

export type ServiceRouteId = number;

export const RouteTypes = {
  TRAM: 1,
  SUBWAY: 2,
  RAIL: 3,
  BUS: 4,
  FERRY: 5,
  CABLE_TRAM: 6,
  AERIAL_LIFT: 7,
  FUNICULAR: 8,
  TROLLEYBUS: 9,
  MONORAIL: 10,
} as const;

export type RouteType = (typeof RouteTypes)[keyof typeof RouteTypes];

export type RouteTypeString = keyof typeof RouteTypes;

// A service refers to a collection of trips that are displayed to riders as a single service.
// As opposed to a route which consists of the subset of trips from a service which shares the same list of stops.
// Service is here a synonym for route in the GTFS sense.
export type ServiceRoute = {
  type: RouteType;
  name: string;
  routes: RouteId[];
};
export type ServiceRouteInfo = Omit<ServiceRoute, 'routes'>;

export const ALL_TRANSPORT_MODES: Set<RouteType> = new Set(
  Object.values(RouteTypes),
);

/**
 * The internal transit timetable format.
 */
export class Timetable {
  private readonly stopsAdjacency: StopAdjacency[];
  private readonly routesAdjacency: Route[];
  private readonly serviceRoutes: ServiceRoute[];
  readonly tripTransfers: TripTransferIndex;
  private readonly activeStops: Set<StopId>;

  /**
   * Build timetable adjacency and transfer storage; raw rules are normalized
   * while a supplied index is reused.
   */
  constructor(
    stopsAdjacency: StopAdjacency[],
    routesAdjacency: Route[],
    routes: ServiceRoute[],
    tripContinuations?: TripTransfers,
    tripTransfers?: TripTransfers,
    rules: TripRule[] | TripTransferIndex = [],
  ) {
    this.stopsAdjacency = stopsAdjacency;
    this.routesAdjacency = routesAdjacency;
    this.serviceRoutes = routes;
    this.tripTransfers =
      rules instanceof TripTransferIndex
        ? rules
        : TripTransferIndex.fromRaw(
            routesAdjacency,
            rules,
            tripContinuations,
            tripTransfers,
          );
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
      formatVersion: 3,
      tripRules: serializeTripRules(this.tripTransfers.all()),
    };
    const writer = new BinaryWriter();
    ProtoTimetable.encode(protoTimetable, writer);
    return writer.finish();
  }

  /**
   * Loads a binary produced by a compatible Minotor serializer.
   * Transfer rules must already be canonical; raw-input validation is not repeated.
   *
   * @param data - The binary data to deserialize.
   * @returns The deserialized Timetable object.
   */
  static fromData(data: Uint8Array): Timetable {
    const reader = new BinaryReader(data);
    const protoTimetable = ProtoTimetable.decode(reader);
    if (protoTimetable.formatVersion !== 3) {
      throw new Error(
        'Unsupported timetable format; regenerate the dataset with this version of minotor.',
      );
    }
    const routes = deserializeRoutesAdjacency(protoTimetable.routesAdjacency);
    return new Timetable(
      deserializeStopsAdjacency(protoTimetable.stopsAdjacency),
      routes,
      deserializeServiceRoutesMap(protoTimetable.serviceRoutes),
      undefined,
      undefined,
      TripTransferIndex.fromCanonical(
        routes,
        deserializeTripRules(protoTimetable.tripRules),
      ),
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
    const source = this.tripTransfers.findTripStopId({
      stopIndex,
      routeId,
      tripIndex,
    });
    if (source === undefined) {
      return [];
    }
    return [...this.tripTransfers.outgoing(source)]
      .filter((rule) => rule.type === TransferTypes.IN_SEAT)
      .map((rule) => this.tripTransfers.position(rule.target));
  }

  /** Scalar mode lookup for scans, without allocating display metadata. */
  getServiceRouteType(route: Route): RouteType {
    const serviceRoute = this.serviceRoutes[route.serviceRoute()];
    if (!serviceRoute) {
      throw new Error(
        `Service route not found for route ID: ${route.serviceRoute()}`,
      );
    }
    return serviceRoute.type;
  }

  /** Display metadata for reconstructed journeys. */
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
      if (!stopData) {
        continue;
      }

      for (let i = 0; i < stopData.routes.length; i++) {
        const route = this.routesAdjacency[stopData.routes[i]!];
        if (!route) {
          continue;
        }

        if (filterByMode) {
          const serviceRoute = this.serviceRoutes[route.serviceRoute()];
          if (!serviceRoute || !transportModes.has(serviceRoute.type)) {
            continue;
          }
        }

        const originStopIndex = route.firstStopRouteIndex(originStop)!;
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
   * Find the first eligible trip without outgoing trip-specific rules.
   * The caller supplies departure bounds; no routing state is retained.
   */
  findFirstOrdinaryBoarding(
    route: Route,
    stopIndex: StopRouteIndex,
    search: BoardingSearch,
  ): (ResolvedBoarding & { trip: TripRouteIndex }) | undefined {
    if (route.pickUpTypeFrom(stopIndex) === PickUpDropOffTypes.NOT_AVAILABLE)
      return undefined;
    // A pair-specific minimum can permit boarding before generic readiness.
    const earliest = route.findEarliestTrip(
      stopIndex,
      search.source?.arrival ?? search.genericReady,
      search.beforeTrip,
    );
    if (earliest === undefined) return undefined;

    const beforeTrip = Math.min(
      search.beforeTrip ?? route.getNbTrips(),
      route.getNbTrips(),
    );
    const maxDeparture = search.maxDeparture ?? Infinity;
    const beforeDeparture = search.beforeDeparture ?? Infinity;
    for (let trip = earliest; trip < beforeTrip; trip++) {
      const departure = route.departureFrom(stopIndex, trip);
      // Departures are ordered, so no later candidate can meet these bounds.
      if (departure > maxDeparture || departure >= beforeDeparture) break;
      if (this.tripTransfers.isExceptional(route.id, trip)) continue;
      const resolved = this.resolveBoarding(
        route,
        stopIndex,
        trip,
        departure,
        search.genericReady,
        search.fallbackTransferDuration,
        search.source,
      );
      if (resolved) return { trip, ...resolved };
    }
    return undefined;
  }

  /**
   * Resolve pickup and departure eligibility using the departure already read by
   * the scan. Without a matching pair rule, generic readiness is unchanged.
   * Pair guarantees use feeder arrival directly; other pair rules add their
   * explicit minimum or the fallback to that arrival. Only feeder-based
   * boardings need trip stop lookup. Query bounds remain the caller's concern.
   */
  resolveBoarding(
    route: Route,
    stopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
    departure: Time,
    genericReady: Time,
    fallbackTransferDuration: Duration,
    source?: BoardingSource,
  ): ResolvedBoarding | undefined {
    if (route.pickUpTypeFrom(stopIndex) === PickUpDropOffTypes.NOT_AVAILABLE) {
      return undefined;
    }
    let ready = genericReady;
    let rule: TripRule | undefined;
    if (source) {
      rule = this.tripTransfers.findTransfer(
        source.tripStopId,
        this.tripTransfers.tripStopId({
          routeId: route.id,
          stopIndex,
          tripIndex,
        }),
      );
      if (rule) {
        ready =
          source.arrival +
          (rule.type === TransferTypes.GUARANTEED
            ? 0
            : (rule.minTransferTime ?? fallbackTransferDuration));
      }
    }
    return departure >= ready ? { ready, rule } : undefined;
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
    const source = this.tripTransfers.findTripStopId({
      stopIndex,
      routeId,
      tripIndex,
    });
    if (source === undefined) {
      return [];
    }
    return [...this.tripTransfers.outgoing(source)]
      .filter((rule) => rule.type === TransferTypes.GUARANTEED)
      .map((rule) => this.tripTransfers.position(rule.target));
  }
}

export const routeTypeToString = (type: RouteType): RouteTypeString => {
  switch (type) {
    case RouteTypes.TRAM:
      return 'TRAM';
    case RouteTypes.SUBWAY:
      return 'SUBWAY';
    case RouteTypes.RAIL:
      return 'RAIL';
    case RouteTypes.BUS:
      return 'BUS';
    case RouteTypes.FERRY:
      return 'FERRY';
    case RouteTypes.CABLE_TRAM:
      return 'CABLE_TRAM';
    case RouteTypes.AERIAL_LIFT:
      return 'AERIAL_LIFT';
    case RouteTypes.FUNICULAR:
      return 'FUNICULAR';
    case RouteTypes.TROLLEYBUS:
      return 'TROLLEYBUS';
    case RouteTypes.MONORAIL:
      return 'MONORAIL';
  }
};

export const transferTypeToString = (
  type: TransferType,
): TransferTypeString => {
  switch (type) {
    case TransferTypes.RECOMMENDED:
      return 'RECOMMENDED';
    case TransferTypes.GUARANTEED:
      return 'GUARANTEED';
    case TransferTypes.REQUIRES_MINIMAL_TIME:
      return 'REQUIRES_MINIMAL_TIME';
    case TransferTypes.IN_SEAT:
      return 'IN_SEAT';
  }
};
