/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';

import { Stop, StopId } from '../stops/stops.js';
import { Duration } from './duration.js';
import {
  deserializeParentStationTransferTimes,
  deserializeRoutesAdjacency,
  deserializeServiceRoutesMap,
  deserializeStopsAdjacency,
  deserializeTripTransfers,
  ParentStationTransferTimes,
  serializeParentStationTransferTimes,
  serializeRoutesAdjacency,
  serializeServiceRoutesMap,
  serializeStopsAdjacency,
  serializeTripTransfers,
} from './io.js';
import { Timetable as ProtoTimetable } from './proto/timetable.js';
import { Route, RouteId, StopRouteIndex, TripRouteIndex } from './route.js';
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

export const CURRENT_VERSION = '0.0.10';

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
  /**
   * Flag indicating whether parent station mode is enabled.
   * When true, routing uses parent stations instead of individual child stops.
   */
  private readonly useParentStations: boolean;
  /**
   * Inferred transfer times at parent stations (median of child-to-child transfers).
   * Only populated when useParentStations is true and there are multiple children
   * with explicit transfer times defined between them.
   * Map: stationId -> transfer time in seconds
   */
  private readonly parentStationTransferTimes: ParentStationTransferTimes;

  constructor(
    stopsAdjacency: StopAdjacency[],
    routesAdjacency: Route[],
    routes: ServiceRoute[],
    tripContinuations?: TripTransfers,
    guaranteedTripTransfers?: TripTransfers,
    useParentStations: boolean = false,
    parentStationTransferTimes: ParentStationTransferTimes = new Map(),
  ) {
    this.stopsAdjacency = stopsAdjacency;
    this.routesAdjacency = routesAdjacency;
    this.serviceRoutes = routes;
    this.tripContinuations = tripContinuations;
    this.guaranteedTripTransfers = guaranteedTripTransfers;
    this.useParentStations = useParentStations;
    this.parentStationTransferTimes = parentStationTransferTimes;
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
      version: CURRENT_VERSION,
      stopsAdjacency: serializeStopsAdjacency(this.stopsAdjacency),
      routesAdjacency: serializeRoutesAdjacency(this.routesAdjacency),
      serviceRoutes: serializeServiceRoutesMap(this.serviceRoutes),
      tripContinuations: serializeTripTransfers(
        this.tripContinuations || new Map<TripStopId, TripStop[]>(),
      ),
      guaranteedTripTransfers: serializeTripTransfers(
        this.guaranteedTripTransfers || new Map<TripStopId, TripStop[]>(),
      ),
      useParentStations: this.useParentStations,
      parentStationTransferTimes: serializeParentStationTransferTimes(
        this.parentStationTransferTimes,
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
    if (protoTimetable.version !== CURRENT_VERSION) {
      throw new Error(
        `Unsupported timetable version ${protoTimetable.version}`,
      );
    }
    return new Timetable(
      deserializeStopsAdjacency(protoTimetable.stopsAdjacency),
      deserializeRoutesAdjacency(protoTimetable.routesAdjacency),
      deserializeServiceRoutesMap(protoTimetable.serviceRoutes),
      deserializeTripTransfers(protoTimetable.tripContinuations),
      deserializeTripTransfers(protoTimetable.guaranteedTripTransfers),
      protoTimetable.useParentStations,
      deserializeParentStationTransferTimes(
        protoTimetable.parentStationTransferTimes,
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
   * Checks if parent station mode is enabled for this timetable.
   *
   * @returns True if parent station mode is enabled, false otherwise.
   */
  isUsingParentStations(): boolean {
    return this.useParentStations;
  }

  /**
   * Gets the inferred transfer time at a parent station.
   * Returns undefined if no transfer time is defined for this station.
   *
   * @param stationId - The ID of the parent station.
   * @returns The transfer time in seconds, or undefined if not defined.
   */
  getParentStationTransferTime(stationId: StopId): number | undefined {
    return this.parentStationTransferTimes.get(stationId);
  }

  /**
   * Gets the effective stop ID for routing.
   * When parent station mode is enabled, returns the parent station ID if the stop has one.
   * Otherwise returns the original stop ID.
   *
   * @param stop - The stop to get the effective ID for.
   * @returns The effective stop ID for routing.
   */
  getEffectiveStopId(stop: Stop): StopId {
    if (this.useParentStations && stop.parent !== undefined) {
      return stop.parent;
    }
    return stop.id;
  }

  /**
   * Gets the effective transfer time for boarding at a stop.
   * When parent station mode is enabled, uses the precomputed median transfer time
   * for the station if available, otherwise falls back to the default transfer time.
   *
   * @param stopId - The stop ID (parent station ID in parent station mode)
   * @param defaultTransferTime - The default minimum transfer time from query options
   * @returns The effective transfer time duration
   */
  getEffectiveTransferTime(
    stopId: StopId,
    defaultTransferTime: Duration,
  ): Duration {
    if (!this.useParentStations) {
      return defaultTransferTime;
    }

    const stationTransferTime = this.parentStationTransferTimes.get(stopId);
    if (stationTransferTime !== undefined) {
      return Duration.fromSeconds(stationTransferTime);
    }

    return defaultTransferTime;
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
    const fromStopsArray = Array.from(fromStops);
    for (let i = 0; i < fromStopsArray.length; i++) {
      const originStop = fromStopsArray[i]!;
      const validRoutes = this.routesPassingThrough(originStop).filter(
        (route) => {
          const serviceRoute = this.getServiceRouteInfo(route);
          return transportModes.has(serviceRoute.type);
        },
      );
      for (let j = 0; j < validRoutes.length; j++) {
        const route = validRoutes[j]!;
        const originStopIndices = route.stopRouteIndices(originStop);
        const originStopIndex = originStopIndices[0]!;

        const existingHopOnStopIndex = reachableRoutes.get(route);
        if (existingHopOnStopIndex !== undefined) {
          if (originStopIndex < existingHopOnStopIndex) {
            // if the current stop is before the existing hop on stop, replace it
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
    return guaranteedTransfers.some(
      (transfer) =>
        transfer.stopIndex === toTripStop.stopIndex &&
        transfer.routeId === toTripStop.routeId &&
        transfer.tripIndex === toTripStop.tripIndex,
    );
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
