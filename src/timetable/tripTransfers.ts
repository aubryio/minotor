/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Route, RouteId, TripRouteIndex } from './route.js';
import { Duration } from './time.js';
import {
  TransferType,
  TransferTypes,
  TripPosition,
  TripTransfers,
} from './transfer.js';
import { decode } from './tripStopKey.js';

/** Dense identities across the whole timetable, not route-local positions. */
export type TripId = number;
/** A timetable-wide identity for one stop position on one trip. */
export type TripStopId = number;

export type TripRule = {
  source: TripStopId;
  target: TripStopId;
  type: TransferType;
  minTransferTime?: Duration;
};

const NO_RULES: readonly TripRule[] = [];

/** Dense trip/trip stop identities and transfers grouped by source. */
export class TripTransferIndex {
  readonly tripBases: Uint32Array;
  readonly tripStopBases: Uint32Array;
  readonly exceptionalTrips: TripRouteIndex[][] = [];
  private exceptional!: Uint8Array;
  private readonly rulesBySource = new Map<TripStopId, TripRule[]>();

  /**
   * Assign dense trip and trip stop bases in route order, rejecting IDs
   * outside uint32 capacity.
   */
  private constructor(private readonly routes: Route[]) {
    this.tripBases = new Uint32Array(routes.length + 1);
    this.tripStopBases = new Uint32Array(routes.length + 1);
    let trips = 0,
      tripStopCount = 0;
    for (const [routeId, route] of routes.entries()) {
      if (route.id !== routeId) {
        throw new Error('Route IDs must match their array positions');
      }
      this.tripBases[route.id] = trips;
      this.tripStopBases[route.id] = tripStopCount;
      trips += route.getNbTrips();
      tripStopCount += route.getNbTrips() * route.getNbStops();
      if (trips > 0xffffffff || tripStopCount > 0xffffffff) {
        throw new Error('Timetable exceeds uint32 identity capacity');
      }
    }
    this.tripBases[routes.length] = trips;
    this.tripStopBases[routes.length] = tripStopCount;
    this.exceptional = new Uint8Array(trips);
  }

  /** Validate and normalize caller-built rules before constructing routing storage. */
  static fromRaw(
    routes: Route[],
    rules: TripRule[] = [],
    continuations?: TripTransfers,
    transfers?: TripTransfers,
  ): TripTransferIndex {
    const index = new TripTransferIndex(routes);
    const tripStopCount = index.tripStopBases[routes.length]!;
    const entries = [...rules];
    for (const [map, kind] of [
      [continuations, TransferTypes.IN_SEAT],
      [transfers, TransferTypes.GUARANTEED],
    ] as const) {
      for (const [key, destinations] of map ?? []) {
        const [stopIndex, routeId, tripIndex] = decode(key);
        const source = index.tripStopId({ stopIndex, routeId, tripIndex });
        for (const destination of destinations) {
          entries.push({
            source,
            target: index.tripStopId(destination),
            type: destination.type ?? kind,
            minTransferTime: destination.minTransferTime,
          });
        }
      }
    }
    entries.sort(
      (a, b) => a.source - b.source || a.target - b.target || a.type - b.type,
    );
    const unique: TripRule[] = [];
    for (const rule of entries) {
      if (
        !Number.isInteger(rule.source) ||
        rule.source < 0 ||
        rule.source >= tripStopCount ||
        !Number.isInteger(rule.target) ||
        rule.target < 0 ||
        rule.target >= tripStopCount ||
        !Object.values(TransferTypes).includes(rule.type) ||
        (rule.minTransferTime !== undefined &&
          (!Number.isInteger(rule.minTransferTime) ||
            rule.minTransferTime < 0 ||
            rule.minTransferTime > 0x7fffffff)) ||
        (rule.type === TransferTypes.REQUIRES_MINIMAL_TIME &&
          rule.minTransferTime === undefined)
      ) {
        throw new Error('Invalid trip transfer rule');
      }
      const last = unique[unique.length - 1];
      if (
        last?.source === rule.source &&
        last.target === rule.target &&
        last.type === rule.type
      ) {
        if (last.minTransferTime !== rule.minTransferTime) {
          throw new Error('Conflicting trip transfer rules');
        }
      } else {
        unique.push(rule);
      }
    }
    index.initializeRules(unique);
    return index;
  }

  /** Rules from a compatible serializer are already sorted, unique, and valid. */
  static fromCanonical(routes: Route[], rules: TripRule[]): TripTransferIndex {
    const index = new TripTransferIndex(routes);
    index.initializeRules(rules);
    return index;
  }

  /**
   * Copy canonical rules into source adjacency and index trips with outgoing
   * rules; input must be sorted and unique.
   */
  private initializeRules(rules: TripRule[]): void {
    for (let routeId = 0; routeId < this.routes.length; routeId++) {
      this.exceptionalTrips.push([]);
    }
    let routeId: RouteId = 0;
    for (const rule of rules) {
      let outgoing = this.rulesBySource.get(rule.source);
      if (!outgoing) {
        outgoing = [];
        this.rulesBySource.set(rule.source, outgoing);
        while (this.tripStopBases[routeId + 1]! <= rule.source) routeId++;
        const tripIndex = Math.floor(
          (rule.source - this.tripStopBases[routeId]!) /
            this.routes[routeId]!.getNbStops(),
        );
        const trips = this.exceptionalTrips[routeId]!;
        if (trips[trips.length - 1] !== tripIndex) {
          trips.push(tripIndex);
          this.exceptional[this.tripId(routeId, tripIndex)] = 1;
        }
      }
      // Copy caller-owned records so later mutations cannot change the index.
      outgoing.push({
        source: rule.source,
        target: rule.target,
        type: rule.type,
        ...(rule.minTransferTime !== undefined && {
          minTransferTime: rule.minTransferTime,
        }),
      });
    }
  }

  /**
   * Return whether the trip has outgoing rules requiring a separate scan from
   * ordinary trips.
   */
  isExceptional(routeId: RouteId, tripIndex: TripRouteIndex): boolean {
    return this.exceptional[this.tripId(routeId, tripIndex)] === 1;
  }

  /** Convert a valid route-local trip index into a timetable-wide dense trip ID. */
  tripId(routeId: RouteId, tripIndex: TripRouteIndex): TripId {
    return this.tripBases[routeId]! + tripIndex;
  }

  /**
   * Return the dense trip stop ID for a valid trip position, or undefined
   * when it is outside the timetable.
   */
  findTripStopId(position: TripPosition): TripStopId | undefined {
    const route = this.routes[position.routeId];
    if (
      !route ||
      !Number.isInteger(position.tripIndex) ||
      position.tripIndex < 0 ||
      position.tripIndex >= route.getNbTrips() ||
      !Number.isInteger(position.stopIndex) ||
      position.stopIndex < 0 ||
      position.stopIndex >= route.getNbStops()
    ) {
      return undefined;
    }
    return (
      this.tripStopBases[position.routeId]! +
      position.tripIndex * route.getNbStops() +
      position.stopIndex
    );
  }

  /**
   * Resolve a trip position to its dense trip stop ID, throwing when the
   * position is invalid.
   */
  tripStopId(position: TripPosition): TripStopId {
    const id = this.findTripStopId(position);
    if (id === undefined) {
      throw new Error('Invalid trip stop');
    }
    return id;
  }

  /**
   * Decode a dense trip stop ID by locating its route base, rejecting IDs
   * outside the timetable.
   */
  position(id: TripStopId): TripPosition {
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= this.tripStopBases[this.routes.length]!
    ) {
      throw new Error('Invalid trip stop ID');
    }
    let lo = 0,
      hi = this.routes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.tripStopBases[mid + 1]! <= id) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const route = this.routes[lo];
    if (!route || id < 0) {
      throw new Error('Invalid trip stop ID');
    }
    const offset = id - this.tripStopBases[lo]!;
    return {
      routeId: lo,
      tripIndex: Math.floor(offset / route.getNbStops()),
      stopIndex: offset % route.getNbStops(),
    };
  }

  /**
   * Return a borrowed readonly rule list without allocating; callers must not
   * mutate the stored records.
   */
  rulesFrom(source: TripStopId): readonly Readonly<TripRule>[] {
    return this.rulesBySource.get(source) ?? NO_RULES;
  }

  /**
   * Yield copies of outgoing rules so callers can modify them without changing
   * the index.
   */
  *outgoing(source: TripStopId): Generator<TripRule> {
    for (const rule of this.rulesFrom(source)) yield { ...rule };
  }

  /**
   * Return a copy of the first non-continuation rule for this trip stop pair,
   * if present.
   */
  transfer(source: TripStopId, target: TripStopId): TripRule | undefined {
    const rule = this.rulesBySource
      .get(source)
      ?.find(
        (rule) => rule.target === target && rule.type !== TransferTypes.IN_SEAT,
      );
    return rule && { ...rule };
  }

  /** Yield copies of every rule in canonical source order. */
  *all(): Generator<TripRule> {
    for (const source of this.rulesBySource.keys())
      yield* this.outgoing(source);
  }
}
