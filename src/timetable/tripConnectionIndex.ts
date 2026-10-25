import type { RouteId, StopRouteIndex, TripRouteIndex } from './route.js';
import type {
  MinimumTripTransfers,
  TripConnections,
  TripStop,
  TripTransferRule,
  TripTransfers,
} from './transfers.js';
import { TransferTypes } from './transfers.js';
import {
  decode,
  encode,
  type TripKey,
  tripKey,
  type TripStopId,
} from './tripStopId.js';

const EMPTY_TRIP_BOARDINGS: readonly TripStop[] = [];
const EMPTY_RULES: readonly TripTransferRule[] = [];
const EMPTY_TRIPS: readonly TripRouteIndex[] = [];

/** Sparse derived indexes. Raw transfer collections remain owned by Timetable.
 * Minimum rules overwrite guaranteed rules for routing; raw getters retain their semantics.
 */
export class TripConnectionIndex {
  private readonly tripTransferRules = new Map<
    TripStopId,
    Map<TripStopId, TripTransferRule>
  >();
  private readonly connectionsByTrip = new Map<
    TripKey,
    Map<StopRouteIndex, TripConnections>
  >();
  private readonly specialTrips = new Map<RouteId, TripRouteIndex[]>();

  constructor(
    tripContinuations: TripTransfers | undefined,
    guaranteedTripTransfers: TripTransfers | undefined,
    minimumTripTransfers: MinimumTripTransfers,
  ) {
    const special = new Map<RouteId, Set<TripRouteIndex>>();
    const mark = (origin: TripStopId) => {
      const [, routeId, tripIndex] = decode(origin);
      const trips = special.get(routeId) ?? new Set<TripRouteIndex>();
      trips.add(tripIndex);
      special.set(routeId, trips);
    };
    const addRule = (origin: TripStopId, rule: TripTransferRule) => {
      const rules =
        this.tripTransferRules.get(origin) ??
        new Map<TripStopId, TripTransferRule>();
      rules.set(encode(rule.stopIndex, rule.routeId, rule.tripIndex), rule);
      this.tripTransferRules.set(origin, rules);
      mark(origin);
    };
    for (const [origin, destinations] of guaranteedTripTransfers ?? []) {
      for (const destination of destinations) {
        addRule(origin, { ...destination, type: TransferTypes.GUARANTEED });
      }
    }
    for (const [origin, destinations] of minimumTripTransfers) {
      for (const destination of destinations) {
        addRule(origin, {
          ...destination,
          type: TransferTypes.REQUIRES_MINIMAL_TIME,
        });
      }
    }
    // Every continuation origin is special, including predecessors of chains.
    for (const origin of tripContinuations?.keys() ?? []) {
      mark(origin);
    }
    for (const [routeId, trips] of special) {
      this.specialTrips.set(
        routeId,
        [...trips].sort((a, b) => a - b),
      );
    }
    for (const origin of new Set([
      ...this.tripTransferRules.keys(),
      ...(tripContinuations?.keys() ?? []),
    ])) {
      const [stopIndex, routeId, tripIndex] = decode(origin);
      const trip = tripKey(routeId, tripIndex);
      const connections =
        this.connectionsByTrip.get(trip) ??
        new Map<StopRouteIndex, TripConnections>();
      connections.set(stopIndex, {
        rules: [...(this.tripTransferRules.get(origin)?.values() ?? [])],
        continuations: tripContinuations?.get(origin) ?? EMPTY_TRIP_BOARDINGS,
      });
      this.connectionsByTrip.set(trip, connections);
    }
  }

  getConnections(
    routeId: RouteId,
    tripIndex: TripRouteIndex,
  ): ReadonlyMap<StopRouteIndex, TripConnections> | undefined {
    return this.connectionsByTrip.get(tripKey(routeId, tripIndex));
  }

  getSpecialTrips(routeId: RouteId): readonly TripRouteIndex[] {
    return this.specialTrips.get(routeId) ?? EMPTY_TRIPS;
  }

  getRules(from: TripStop): readonly TripTransferRule[] {
    return (
      this.getConnections(from.routeId, from.tripIndex)?.get(from.stopIndex)
        ?.rules ?? EMPTY_RULES
    );
  }

  getRule(from: TripStop, to: TripStop): TripTransferRule | undefined {
    return this.tripTransferRules
      .get(encode(from.stopIndex, from.routeId, from.tripIndex))
      ?.get(encode(to.stopIndex, to.routeId, to.tripIndex));
  }
}
