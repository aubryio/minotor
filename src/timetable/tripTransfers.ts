/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Route } from './route.js';
import {
  TransferType,
  TransferTypes,
  TripStop,
  TripTransfers,
} from './transfer.js';
import { decode } from './tripStopId.js';

export type TripRule = {
  source: number;
  target: number;
  type: TransferType;
  minTransferTime?: number;
};

/** Dense trip/occurrence identities and sparse, sorted transfer adjacency. */
export class TripTransferIndex {
  readonly tripBases: Uint32Array;
  readonly occurrenceBases: Uint32Array;
  readonly exceptionalTrips: number[][];
  private readonly exceptional: Uint8Array;
  private readonly sources: Uint32Array;
  private readonly offsets: Uint32Array;
  private readonly targets: Uint32Array;
  private readonly kinds: Uint8Array;
  private readonly minimums: Int32Array;

  constructor(
    private readonly routes: Route[],
    rules: TripRule[] = [],
    continuations?: TripTransfers,
    transfers?: TripTransfers,
  ) {
    this.tripBases = new Uint32Array(routes.length + 1);
    this.occurrenceBases = new Uint32Array(routes.length + 1);
    let trips = 0,
      occurrences = 0;
    for (const [routeId, route] of routes.entries()) {
      if (route.id !== routeId)
        throw new Error('Route IDs must match their array positions');
      this.tripBases[route.id] = trips;
      this.occurrenceBases[route.id] = occurrences;
      trips += route.getNbTrips();
      occurrences += route.getNbTrips() * route.getNbStops();
      if (trips > 0xffffffff || occurrences > 0xffffffff)
        throw new Error('Timetable exceeds uint32 identity capacity');
    }
    this.tripBases[routes.length] = trips;
    this.occurrenceBases[routes.length] = occurrences;
    const entries = [...rules];
    for (const [map, kind] of [
      [continuations, TransferTypes.IN_SEAT],
      [transfers, TransferTypes.GUARANTEED],
    ] as const) {
      for (const [key, destinations] of map ?? []) {
        const [stopIndex, routeId, tripIndex] = decode(key);
        const source = this.occurrence({ stopIndex, routeId, tripIndex });
        for (const destination of destinations)
          entries.push({
            source,
            target: this.occurrence(destination),
            type: destination.type ?? kind,
            minTransferTime: destination.minTransferTime,
          });
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
        rule.source >= occurrences ||
        !Number.isInteger(rule.target) ||
        rule.target < 0 ||
        rule.target >= occurrences ||
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
        if (last.minTransferTime !== rule.minTransferTime)
          throw new Error('Conflicting trip transfer rules');
      } else unique.push(rule);
    }
    const sources: number[] = [],
      offsets: number[] = [];
    this.targets = new Uint32Array(unique.length);
    this.kinds = new Uint8Array(unique.length);
    this.minimums = new Int32Array(unique.length).fill(-1);
    const special = routes.map(() => new Set<number>());
    this.exceptional = new Uint8Array(trips);
    unique.forEach((rule, i) => {
      if (sources[sources.length - 1] !== rule.source) {
        sources.push(rule.source);
        offsets.push(i);
        const source = this.position(rule.source);
        special[source.routeId]!.add(source.tripIndex);
        this.exceptional[this.tripId(source.routeId, source.tripIndex)] = 1;
      }
      this.targets[i] = rule.target;
      this.kinds[i] = rule.type;
      this.minimums[i] = rule.minTransferTime ?? -1;
    });
    offsets.push(unique.length);
    this.sources = new Uint32Array(sources);
    this.offsets = new Uint32Array(offsets);
    this.exceptionalTrips = special.map((set) =>
      [...set].sort((a, b) => a - b),
    );
  }

  isExceptional(routeId: number, tripIndex: number): boolean {
    return this.exceptional[this.tripId(routeId, tripIndex)] === 1;
  }

  tripId(routeId: number, tripIndex: number): number {
    return this.tripBases[routeId]! + tripIndex;
  }

  tryOccurrence(position: TripStop): number | undefined {
    const route = this.routes[position.routeId];
    if (
      !route ||
      !Number.isInteger(position.tripIndex) ||
      position.tripIndex < 0 ||
      position.tripIndex >= route.getNbTrips() ||
      !Number.isInteger(position.stopIndex) ||
      position.stopIndex < 0 ||
      position.stopIndex >= route.getNbStops()
    )
      return undefined;
    return (
      this.occurrenceBases[position.routeId]! +
      position.tripIndex * route.getNbStops() +
      position.stopIndex
    );
  }

  occurrence(position: TripStop): number {
    const id = this.tryOccurrence(position);
    if (id === undefined) throw new Error('Invalid trip occurrence');
    return id;
  }

  position(id: number): TripStop {
    if (
      !Number.isInteger(id) ||
      id < 0 ||
      id >= this.occurrenceBases[this.routes.length]!
    )
      throw new Error('Invalid trip occurrence ID');
    let lo = 0,
      hi = this.routes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.occurrenceBases[mid + 1]! <= id) lo = mid + 1;
      else hi = mid;
    }
    const route = this.routes[lo];
    if (!route || id < 0) throw new Error('Invalid trip occurrence ID');
    const offset = id - this.occurrenceBases[lo]!;
    return {
      routeId: lo,
      tripIndex: Math.floor(offset / route.getNbStops()),
      stopIndex: offset % route.getNbStops(),
    };
  }

  private row(source: number): number {
    let lo = 0,
      hi = this.sources.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sources[mid]! < source) lo = mid + 1;
      else hi = mid;
    }
    return this.sources[lo] === source ? lo : -1;
  }

  private rule(source: number, i: number): TripRule {
    return {
      source,
      target: this.targets[i]!,
      type: this.kinds[i]! as TransferType,
      ...(this.minimums[i]! >= 0 && { minTransferTime: this.minimums[i]! }),
    };
  }

  *outgoing(source: number): Generator<TripRule> {
    const row = this.row(source);
    if (row < 0) return;
    for (let i = this.offsets[row]!; i < this.offsets[row + 1]!; i++)
      yield this.rule(source, i);
  }

  transfer(source: number, target: number): TripRule | undefined {
    const row = this.row(source);
    if (row < 0) return undefined;
    let lo = this.offsets[row]!,
      hi = this.offsets[row + 1]!;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.targets[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    for (
      let i = lo;
      i < this.offsets[row + 1]! && this.targets[i] === target;
      i++
    ) {
      if (this.kinds[i] !== TransferTypes.IN_SEAT) return this.rule(source, i);
    }
    return undefined;
  }

  *all(): Generator<TripRule> {
    for (const source of this.sources) yield* this.outgoing(source);
  }
}
