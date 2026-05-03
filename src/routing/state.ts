/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { StopRouteIndex } from '../timetable/route.js';
import { Duration, Time } from '../timetable/time.js';
import { TransferType, TripStop } from '../timetable/timetable.js';
import { AccessPoint } from './access.js';
import type { IRaptorState } from './raptor.js';

/**
 * Sentinel value used in the internal arrival-time array to mark stops not yet reached.
 * 0xFFFF = 65 535 minutes ≈ 45.5 days, safely beyond any realistic transit arrival time.
 */
export const UNREACHED_TIME: Time = 0xffff;

export type OriginNode = { stopId: StopId; arrival: Time };

export type AccessEdge = {
  arrival: Time;
  from: StopId;
  to: StopId;
  duration: Duration;
};

/** A boarded transit trip that carries the passenger from one stop to another. */
export type VehicleEdge = TripStop & {
  arrival: Time;
  hopOffStopIndex: StopRouteIndex;
  /** modeling in-seat transfer */
  continuationOf?: VehicleEdge;
};

/** A walking or guaranteed connection between two stops. */
export type TransferEdge = {
  arrival: Time;
  from: StopId;
  to: StopId; // TODO remove
  type: TransferType;
  minTransferTime?: Duration;
};

export type RoutingEdge = OriginNode | AccessEdge | VehicleEdge | TransferEdge;

/** The earliest arrival at a stop together with how many legs were needed to reach it. */
export type Arrival = {
  arrival: Time;
  legNumber: number;
};

/**
 * Encapsulates all mutable state for a single RAPTOR routing query.
 */
export class RoutingState implements IRaptorState {
  /** Origin stop IDs for this query. */
  origins: StopId[];

  /** Destination stop IDs for this query. */
  readonly destinations: StopId[];

  /**
   * Routing graph: the best edge used to reach each stop, per round.
   * Indexed as graph[round][stopId]. Entries are undefined for stops not
   * reached in that particular round.
   */
  // TODO do not expose
  readonly graph: (RoutingEdge | undefined)[][];
  // TODO Can use typed arrays to represent the graph
  // Uint32 [(alightStopId -> ? =index/to), boardingStopId (stopIndex,from),
  // RouteId/TransferId, TripId (if not transfer), (previous_round, previous_stop
  // -> allows to reconstruct transfers incl. continuous]
  // TODO should try to reuse them in range raptor and use only one init

  // TODO take out arrival times from Graph
  // private arrivalTimes: Uint16Array[];

  /**
   * Earliest arrival time at each stop (minutes from midnight), indexed by stop ID.
   * Pre-filled with UNREACHED_TIME; updated exclusively through updateArrival().
   * Not readonly so that fromTestData() can replace the arrays directly.
   */
  private earliestArrivalTimes: Uint16Array;

  /**
   * Round number (leg count) in which each stop was first reached, indexed by stop ID.
   * Zero-initialized by the typed array; updated exclusively through updateArrival().
   * Not readonly so that fromTestData() can replace the arrays directly.
   */
  private earliestArrivalLegs: Uint8Array;

  /**
   * Fast O(1) membership test for destination stops.
   * Built once at construction time from the `destinations` array.
   */
  private readonly destinationSet: Set<StopId>;

  /**
   * Cached best arrival time at any destination stop, kept up-to-date by
   * {@link updateArrival} so that destination pruning is always O(1).
   */
  private _destinationBest: Time = UNREACHED_TIME;

  /**
   * Maximum arrival time allowed for this run. Defaults to UNREACHED_TIME when
   * the query has no maxDuration limit.
   */
  maxArrivalTime: Time = UNREACHED_TIME;

  /**
   * Query-level maximum duration, retained so resetFor() can recompute the
   * absolute max arrival time for each departure-time iteration.
   */
  private readonly maxDuration?: Duration;

  /**
   * Every stop that has received an arrival improvement during the current run,
   * in the order the improvements occurred.  Used by {@link resetFor} to clear
   * only the touched entries instead of scanning the entire array.
   */
  private readonly reachedStops: StopId[] = [];

  constructor(
    departureTime: Time,
    destinations: StopId[],
    accessPaths: AccessPoint[],
    nbStops: number,
    maxRounds: number = 0,
    maxDuration?: Duration,
  ) {
    this.destinations = destinations;
    this.maxDuration = maxDuration;
    this.maxArrivalTime =
      maxDuration === undefined ? UNREACHED_TIME : departureTime + maxDuration;
    this.destinationSet = new Set(destinations);
    this.earliestArrivalTimes = new Uint16Array(nbStops).fill(UNREACHED_TIME);
    this.earliestArrivalLegs = new Uint8Array(nbStops);
    this.origins = []; // overwritten by seedAccessPaths below
    this.graph = [new Array<RoutingEdge | undefined>(nbStops)];
    for (let r = 1; r <= maxRounds; r++) {
      this.graph.push(new Array<RoutingEdge | undefined>(nbStops));
    }
    this.seedAccessPaths(departureTime, accessPaths);
  }

  /**
   * Seeds round-0 arrivals and {@link origins} from a set of access paths.
   * Called by the constructor and by {@link resetFor}.
   * Assumes {@link earliestArrivalTimes} and {@link graph}[0] are already
   * allocated and in their "cleared" state (all entries at UNREACHED_TIME /
   * undefined) before this method runs.
   */
  private seedAccessPaths(depTime: Time, accessPaths: AccessPoint[]): void {
    const seededOrigins = new Set<StopId>();
    for (const access of accessPaths) {
      const arrival = depTime + access.duration;
      if (arrival > this.maxArrivalTime) continue;
      const edge: OriginNode | AccessEdge =
        access.duration === 0
          ? { stopId: access.fromStopId, arrival: depTime }
          : {
              arrival,
              from: access.fromStopId,
              to: access.toStopId,
              duration: access.duration,
            };
      const stop = access.toStopId;
      if (arrival < this.earliestArrivalTimes[stop]!) {
        this.earliestArrivalTimes[stop] = arrival;
        this.graph[0]![stop] = edge;
      }
      seededOrigins.add(stop);
    }
    for (const stop of seededOrigins) {
      this.reachedStops.push(stop);
    }
    this.origins = Array.from(seededOrigins);
    for (let i = 0; i < this.destinations.length; i++) {
      const t = this.earliestArrivalTimes[this.destinations[i]!]!;
      if (t < this._destinationBest) this._destinationBest = t;
    }
  }

  /** Total number of stops in the timetable */
  get nbStops(): number {
    return this.earliestArrivalTimes.length;
  }

  /**
   * Returns the earliest known arrival time at a stop.
   * Returns UNREACHED_TIME if the stop has not been reached yet.
   */
  arrivalTime(stop: StopId): Time {
    return this.earliestArrivalTimes[stop]!;
  }

  /**
   * Earliest arrival at any destination stop; {@link UNREACHED_TIME} if none
   * has been reached yet. Updated automatically by {@link updateArrival}. O(1).
   */
  get destinationBest(): Time {
    return this._destinationBest;
  }

  /**
   * In standard RAPTOR the improvement bound is simply the per-run earliest
   * arrival; the `round` argument is ignored.
   */
  improvementBound(_round: number, stop: StopId): Time {
    return this.arrivalTime(stop);
  }

  /** No-op in standard RAPTOR — there are no shared cross-run labels to propagate. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initRound(_round: number): void {}

  /**
   * Records a new earliest arrival at a stop.
   *
   * @param stop The stop that was reached.
   * @param time The arrival time in minutes from midnight.
   * @param leg  The round number (number of transit legs taken so far).
   */
  updateArrival(stop: StopId, time: Time, leg: number): void {
    this.reachedStops.push(stop);
    this.earliestArrivalTimes[stop] = time;
    this.earliestArrivalLegs[stop] = leg;
    if (this.destinationSet.has(stop) && time < this._destinationBest) {
      this._destinationBest = time;
    }
  }

  /**
   * Resets this state for a new departure-time iteration **without
   * reallocating** the underlying arrays.
   *
   * Only the stops recorded in {@link reachedStops} are touched — all other
   * entries are already at their initial bound values.
   *
   * After this call the state is equivalent to a freshly constructed
   * {@link RoutingState} for the given `depTime` and `accessPaths`.
   *
   * @param depTime     New origin departure time.
   * @param accessPaths Access legs for this departure-time slot.
   */
  resetFor(depTime: Time, accessPaths: AccessPoint[]): void {
    for (const stop of this.reachedStops) {
      this.earliestArrivalTimes[stop] = UNREACHED_TIME;
      this.earliestArrivalLegs[stop] = 0;
      for (let r = 0; r < this.graph.length; r++) {
        this.graph[r]![stop] = undefined;
      }
    }
    this.reachedStops.length = 0;
    this._destinationBest = UNREACHED_TIME;
    this.maxArrivalTime =
      this.maxDuration === undefined
        ? UNREACHED_TIME
        : depTime + this.maxDuration;
    this.seedAccessPaths(depTime, accessPaths);
  }

  /**
   * Iterates over every stop that has been reached, yielding its stop ID,
   * earliest arrival time, and the number of legs taken to reach it.
   *
   * Unreached stops (those still at UNREACHED_TIME) are skipped entirely.
   *
   * @example
   * ```ts
   * for (const { stop, arrival, legNumber } of routingState.arrivals()) {
   *   console.log(`Stop ${stop}: arrived at ${arrival} after ${legNumber} leg(s)`);
   * }
   * ```
   */
  *arrivals(): Generator<{ stop: StopId; arrival: Time; legNumber: number }> {
    for (let stop = 0; stop < this.earliestArrivalTimes.length; stop++) {
      const time = this.earliestArrivalTimes[stop]!;
      if (time < UNREACHED_TIME) {
        yield {
          stop,
          arrival: time,
          legNumber: this.earliestArrivalLegs[stop]!,
        };
      }
    }
  }

  /**
   * Finds the earliest arrival time at any stop from a given set of destinations.
   *
   * @param routingState The routing state containing arrival times and destinations.
   * @returns The earliest arrival time among the provided destinations.
   */
  earliestArrivalAtAnyDestination(): Time {
    return this._destinationBest;
  }

  /**
   * Returns the earliest arrival at a stop as an {@link Arrival} object,
   * or undefined if the stop has not been reached.
   */
  getArrival(stop: StopId): Arrival | undefined {
    const time = this.earliestArrivalTimes[stop]!;
    if (time >= UNREACHED_TIME) return undefined;
    return { arrival: time, legNumber: this.earliestArrivalLegs[stop]! };
  }

  /**
   * Returns `true` if `stop` is one of the query's destination stops.
   * O(1) — backed by a `Set` built at construction time.
   */
  isDestination(stop: StopId): boolean {
    return this.destinationSet.has(stop);
  }

  /**
   * Creates a {@link RoutingState} from fully-specified raw data.
   *
   * Use this in tests instead of constructing the object through the production
   * constructor, which is designed for incremental algorithm state.
   *
   * @param nbStops  Total number of stops (sets array sizes).
   * @param origins  Origin stop IDs.
   * @param destinations  Destination stop IDs.
   * @param arrivals  Each entry is `[stop, time, leg]` — the earliest arrival
   *                  time in minutes and the round number for one stop.
   * @param graph  One element per round. Each round is a sparse list of
   *               `[stop, edge]` pairs; stops absent from the list are
   *               left as `undefined` in the dense output array.
   *
   * @internal For use in tests only.
   */
  static fromTestData({
    nbStops,
    origins = [],
    destinations = [],
    arrivals = [],
    graph = [],
  }: {
    nbStops: number;
    origins?: StopId[];
    destinations?: StopId[];
    arrivals?: [stop: StopId, time: Time, leg: number][];
    graph?: [stop: StopId, edge: RoutingEdge][][];
  }): RoutingState {
    const state = new RoutingState(
      0,
      destinations,
      origins.map((stop) => ({
        fromStopId: stop,
        toStopId: stop,
        duration: 0,
      })),
      nbStops,
    );

    // Replace the arrival arrays with freshly built ones so the constructor's
    // origin-seeding doesn't bleed into the test state.
    const earliestArrivalTimes = new Uint16Array(nbStops).fill(UNREACHED_TIME);
    const earliestArrivalLegs = new Uint8Array(nbStops);
    for (const [stop, time, leg] of arrivals) {
      earliestArrivalTimes[stop] = time;
      earliestArrivalLegs[stop] = leg;
    }
    state.earliestArrivalTimes = earliestArrivalTimes;
    state.earliestArrivalLegs = earliestArrivalLegs;

    // Recompute _destinationBest from the test data since we bypassed updateArrival.
    // fromTestData is a static method of RoutingState, so private access is allowed.
    state._destinationBest = UNREACHED_TIME;
    for (const dest of destinations) {
      const t = earliestArrivalTimes[dest];
      if (t !== undefined && t < state._destinationBest)
        state._destinationBest = t;
    }

    // Convert the sparse per-round representation to dense arrays and replace
    // the graph in-place.
    const denseRounds = graph.map((round) => {
      const arr = new Array<RoutingEdge | undefined>(nbStops);
      for (const [stop, edge] of round) {
        arr[stop] = edge;
      }
      return arr;
    });
    state.graph.splice(0, state.graph.length, ...denseRounds);

    return state;
  }
}
