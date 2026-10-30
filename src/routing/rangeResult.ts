import { StopId } from '../stops/stops.js';
import { Duration, Time } from '../timetable/time.js';
import { Result } from './result.js';
import { resultDestinations } from './resultInternals.js';
import { Route } from './route.js';
import type { RoutingResult, StopArrival } from './routingResult.js';
import { Arrival } from './state.js';

/**
 * A single departure-time iteration that produced at least one Pareto-optimal
 * journey to this result's destination set.
 */
export type ParetoRun = {
  /** Departure time from the origin (minutes from midnight) for this run. */
  readonly departureTime: Time;
  /** Full RAPTOR result for this departure time — use it to reconstruct routes. */
  readonly result: Result;
};

/**
 * An {@link Arrival} enriched with the travel duration from the origin.
 *
 * Returned by duration-based methods on {@link RangeResult} so callers
 * receive both the absolute arrival time with transfer count *and* the total
 * travel time that was optimized over.
 */
export type ArrivalWithDuration = Arrival & {
  /** Total travel time from origin departure to stop arrival (minutes). */
  readonly duration: Duration;
};

/**
 * The result of a Range RAPTOR query.
 *
 * Contains the complete Pareto-optimal set of journeys for a resolved
 * destination set, **or** the full per-departure-time routing state when no
 * destinations were provided (full-network / isochrone mode).
 *
 * **Pareto dominance**: journey J1 dominates J2 iff
 *   `τdep(J1) ≥ τdep(J2)  AND  τarr(J1) ≤ τarr(J2)`
 * (with at least one strict inequality).
 *
 * Runs are ordered **latest-departure-first**: each successive run departs
 * strictly earlier *and* arrives strictly earlier than the previous one,
 * forming the classic staircase Pareto frontier.
 *
 * **Full-network mode** (no query destinations): when no destinations are
 * supplied to the range query every departure slot in the window becomes its
 * own run, because destination-based Pareto pruning cannot be applied.
 * In this mode the destination-specific helpers ({@link routes},
 * {@link bestRoute}, {@link latestDepartureRoute}, {@link fastestRoute})
 * return empty results; use {@link arrivals},
 * {@link shortestDurations}, {@link arrivalAt}, or
 * {@link shortestDurationTo} instead.
 *
 * Destination handling is delegated to {@link Result}, which expands
 * equivalent stops when reconstructing routes or looking up arrivals.
 */
export class RangeResult implements RoutingResult {
  private readonly _runs: readonly ParetoRun[];

  constructor(runs: ParetoRun[]) {
    this._runs = runs;
  }

  private normalizeTargets(to?: StopId | Set<StopId>): Set<StopId> {
    if (to instanceof Set) {
      return new Set(to);
    }
    if (to !== undefined) {
      return new Set([to]);
    }
    return new Set(this._runs[0]?.result[resultDestinations]());
  }

  /**
   * Lazily yields all non-dominated routes to this result's default destination set,
   * ordered from the earliest departure to the latest departure.
   *
   * Each route in the list departs strictly later *and* arrives strictly
   * later than its predecessor.
   *
   * Yields nothing when no destinations were provided (full-network
   * mode). Use {@link arrivals} or {@link shortestDurations}
   * to query individual stops in that case.
   */
  *routes(): Generator<Route> {
    for (let index = this._runs.length - 1; index >= 0; index--) {
      const run = this._runs[index];
      if (run === undefined) {
        continue;
      }
      const route = run.result.bestRoute();
      if (route !== undefined) {
        yield route;
      }
    }
  }

  /**
   * The route that arrives **earliest** at the given stop(s) across all
   * Pareto-optimal runs.
   *
   * When two runs achieve the same arrival time at the target, the one with
   * the **later departure** is preferred — you wait at the origin rather than
   * at a transit stop.
   *
   * Defaults to this result's own destination stop(s) when `to` is omitted.
   * Always pass an explicit `to` stop when operating in full-network mode
   * (no destinations), otherwise `undefined` is returned.
   *
   * @param to Optional destination stop ID or set of stop IDs.
   * @param maxTransfers Optional transfer limit within retained data.
   * @returns The reconstructed {@link Route} with the earliest arrival,
   *          or `undefined` if the target is unreachable in every run.
   */
  bestRoute(
    to?: StopId | Set<StopId>,
    maxTransfers?: number,
  ): Route | undefined {
    const targetStops = this.normalizeTargets(to);

    let bestRun: ParetoRun | undefined;
    let bestArrival: Time | undefined;

    for (const run of this._runs) {
      for (const stopId of targetStops) {
        const arrival = run.result.arrivalAt(stopId, maxTransfers);
        if (arrival === undefined) {
          continue;
        }
        if (bestArrival === undefined || arrival.arrival < bestArrival) {
          bestArrival = arrival.arrival;
          bestRun = run;
        }
      }
    }

    return bestRun?.result.bestRoute(targetStops, maxTransfers);
  }

  /**
   * The route with the **latest possible departure** from the origin among all
   * Pareto-optimal journeys in the window.
   *
   * This is the journey that lets you leave the origin as late as possible.
   * It does **not** necessarily achieve the earliest arrival — for that, use
   * {@link bestRoute}. For the shortest travel duration, use
   * {@link fastestRoute}.
   *
   * Defaults to this result's own destination stop(s) when `to` is omitted.
   * Always pass an explicit `to` stop when operating in full-network mode
   * (no destinations), otherwise `undefined` is returned.
   *
   * @param to Optional destination stop ID or set of stop IDs.
   * @param maxTransfers Optional transfer limit within retained data.
   * @returns The reconstructed {@link Route} with the latest departure,
   *          or `undefined` if the target is unreachable in every run.
   */
  latestDepartureRoute(
    to?: StopId | Set<StopId>,
    maxTransfers?: number,
  ): Route | undefined {
    const targetStops = this.normalizeTargets(to);
    for (const { result } of this._runs) {
      const route = result.bestRoute(targetStops, maxTransfers);
      if (route !== undefined) {
        return route;
      }
    }
    return undefined;
  }

  /**
   * Reconstructs the **fastest** route to the given stop(s) — the journey with
   * the shortest travel duration (arrival time − origin departure time) across
   * all Pareto-optimal runs.
   *
   * When durations tie, the earliest departure is preferred.
   * Unlike {@link bestRoute}, which minimizes arrival time, this method
   * minimizes total time spent traveling.
   *
   * Defaults to this result's own destination stop(s) when `to` is omitted.
   * Always pass an explicit `to` stop when operating in full-network mode
   * (no destinations), otherwise `undefined` is returned.
   *
   * @param to Optional destination stop ID or set of stop IDs.
   * @param maxTransfers Optional transfer limit within retained data.
   * @returns The reconstructed fastest {@link Route}, or `undefined` if the
   *          target is unreachable in every run.
   */
  fastestRoute(
    to?: StopId | Set<StopId>,
    maxTransfers?: number,
  ): Route | undefined {
    const targetStops = this.normalizeTargets(to);

    let fastestRun: ParetoRun | undefined;
    let shortestDuration = Infinity;

    for (const run of this._runs) {
      for (const stopId of targetStops) {
        const arrival = run.result.arrivalAt(stopId, maxTransfers);
        if (arrival === undefined) {
          continue;
        }
        const duration = arrival.arrival - run.departureTime;
        if (
          duration < shortestDuration ||
          (duration === shortestDuration &&
            fastestRun !== undefined &&
            run.departureTime < fastestRun.departureTime)
        ) {
          shortestDuration = duration;
          fastestRun = run;
        }
      }
    }

    return fastestRun?.result.bestRoute(targetStops, maxTransfers);
  }

  /** Number of Pareto-optimal journeys found. */
  get size(): number {
    return this._runs.length;
  }

  /**
   * Earliest achievable arrival at a stop across all Pareto-optimal runs.
   *
   * Useful for isochrone / accessibility analysis: given this result's
   * departure-time frontier, how early can you reach stop `s` regardless of
   * which specific trip you take?
   *
   * Equivalent stops are handled by {@link Result.arrivalAt}.
   *
   * @param stop         The target stop ID.
   * @param maxTransfers Optional transfer limit within retained data.
   */
  arrivalAt(stop: StopId, maxTransfers?: number): Arrival | undefined {
    let best: Arrival | undefined;
    for (const { result } of this._runs) {
      const arrival = result.arrivalAt(stop, maxTransfers);
      if (
        arrival !== undefined &&
        (best === undefined || arrival.arrival < best.arrival)
      ) {
        best = arrival;
      }
    }
    return best;
  }

  /**
   * Shortest travel duration to reach a stop across all Pareto-optimal runs.
   *
   * For each run, duration is measured from the run's origin departure time to
   * the earliest arrival at `stop` within that run. The minimum across all
   * runs is returned.
   *
   * Equivalent stops are handled by {@link Result.arrivalAt}.
   *
   * Duration is **not** monotone along the Pareto frontier — a run that
   * departs later may still travel faster — so every run is checked. In
   * practice the Pareto frontier is small, so this is O(runs).
   *
   * Returns `undefined` if `stop` is unreachable in every run.
   *
   * @param stop         The target stop ID.
   * @param maxTransfers Optional transfer limit within retained data.
   */
  shortestDurationTo(
    stop: StopId,
    maxTransfers?: number,
  ): ArrivalWithDuration | undefined {
    let shortest: ArrivalWithDuration | undefined;
    for (const { departureTime, result } of this._runs) {
      const arrival = result.arrivalAt(stop, maxTransfers);
      if (arrival === undefined) {
        continue;
      }
      const duration = arrival.arrival - departureTime;
      if (shortest === undefined || duration < shortest.duration) {
        shortest = { ...arrival, duration };
      }
    }
    return shortest;
  }

  /**
   * Shortest travel duration to every retained stop across all
   * Pareto-optimal runs, yielding the stop ID and arrival with duration.
   * Destination pruning can omit stops; omit destinations for full-network results.
   * All runs are aggregated before the first value is yielded. Ties retain
   * the first run's arrival and leg count.
   * @param maxTransfers Optional transfer limit within retained data.
   */
  *shortestDurations(
    maxTransfers?: number,
  ): Generator<StopArrival & { duration: Duration }> {
    const durations = new Map<StopId, ArrivalWithDuration>();
    for (const { departureTime, result } of this._runs) {
      for (const { stop, arrival, legNumber } of result.arrivals(
        maxTransfers,
      )) {
        const duration = arrival - departureTime;
        const existing = durations.get(stop);
        if (existing === undefined || duration < existing.duration) {
          durations.set(stop, { arrival, legNumber, duration });
        }
      }
    }
    for (const [stop, arrival] of durations) {
      yield { stop, ...arrival };
    }
  }

  /**
   * Earliest retained arrival at each stop across all
   * Pareto-optimal runs, yielding the stop ID and arrival.
   * Destination pruning can omit stops; omit destinations for full-network results.
   * All runs are aggregated before the first value is yielded. Ties retain
   * the first run's arrival and leg count.
   * @param maxTransfers Optional transfer limit within retained data.
   */
  *arrivals(maxTransfers?: number): Generator<StopArrival> {
    const arrivals = new Map<StopId, Arrival>();
    for (const { result } of this._runs) {
      for (const { stop, arrival, legNumber } of result.arrivals(
        maxTransfers,
      )) {
        const existing = arrivals.get(stop);
        if (existing === undefined || arrival < existing.arrival) {
          arrivals.set(stop, { arrival, legNumber });
        }
      }
    }
    for (const [stop, arrival] of arrivals) {
      yield { stop, ...arrival };
    }
  }

  /**
   * Iterates over all Pareto-optimal `(departureTime, result)` pairs,
   * ordered from the latest departure to the earliest departure.
   */
  [Symbol.iterator](): IterableIterator<ParetoRun> {
    return this._runs[Symbol.iterator]() as IterableIterator<ParetoRun>;
  }
}
