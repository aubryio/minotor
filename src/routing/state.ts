/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { Duration, Time } from '../timetable/time.js';
import { AccessPoint } from './access.js';
import { DenseRoutingGraph, UNREACHED_TIME } from './graph.js';
import type { IRaptorState } from './raptor.js';

export { UNREACHED_TIME } from './graph.js';

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
   * Typed routing graph: the best edge used to reach each stop, per round.
   * Indexed internally as `round * nbStops + stopId`.
   */
  readonly graph: DenseRoutingGraph;

  /**
   * Earliest arrival time at each stop (minutes from midnight), indexed by stop ID.
   * Pre-filled with UNREACHED_TIME; updated exclusively through updateArrival().
   */
  private readonly earliestArrivalTimes: Uint16Array;

  /**
   * Round number (leg count) in which each stop was first reached, indexed by stop ID.
   * Zero-initialized by the typed array; updated exclusively through updateArrival().
   */
  private readonly earliestArrivalLegs: Uint8Array;

  /**
   * Fast O(1) membership test for destination stops.
   * Built once at construction time from the `destinations` array.
   */
  private readonly destinationMask: Uint8Array;

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
    this.destinationMask = new Uint8Array(nbStops);
    for (const destination of destinations) {
      this.destinationMask[destination] = 1;
    }
    this.earliestArrivalTimes = new Uint16Array(nbStops).fill(UNREACHED_TIME);
    this.earliestArrivalLegs = new Uint8Array(nbStops);
    this.origins = []; // overwritten by seedAccessPaths below
    this.graph = new DenseRoutingGraph(nbStops, maxRounds);
    this.seedAccessPaths(departureTime, accessPaths);
  }

  /**
   * Seeds round-0 arrivals and {@link origins} from a set of access paths.
   * Called by the constructor and by {@link resetFor}.
   * Assumes {@link earliestArrivalTimes} and {@link graph} are already
   * allocated and in their "cleared" state before this method runs.
   */
  private seedAccessPaths(depTime: Time, accessPaths: AccessPoint[]): void {
    const seededOrigins = new Set<StopId>();
    for (const access of accessPaths) {
      const arrival = depTime + access.duration;
      if (arrival > this.maxArrivalTime) continue;
      const stop = access.toStopId;
      if (arrival < this.earliestArrivalTimes[stop]!) {
        this.earliestArrivalTimes[stop] = arrival;
        if (access.duration === 0) {
          this.graph.setOrigin(stop, depTime, access.fromStopId);
        } else {
          this.graph.setAccess(
            stop,
            arrival,
            access.fromStopId,
            access.duration,
          );
        }
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
    if (this.destinationMask[stop] === 1 && time < this._destinationBest) {
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
    }
    this.graph.clearTouched();
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
   * O(1) — backed by a typed-array mask built at construction time.
   */
  isDestination(stop: StopId): boolean {
    return this.destinationMask[stop] === 1;
  }
}
