import { StopId } from '../stops/stops.js';
import { Time } from '../timetable/time.js';
import { RangeQuery } from './query.js';
import { Result } from './result.js';
import { Route } from './route.js';
import { Arrival } from './state.js';

/**
 * A single departure-time iteration that produced at least one Pareto-optimal
 * journey to the query destination(s).
 */
export type ParetoRun = {
  /** Departure time from the origin (minutes from midnight) for this run. */
  readonly departureTime: Time;
  /** Full RAPTOR result for this departure time — use it to reconstruct routes. */
  readonly result: Result;
};

/**
 * The result of a Range RAPTOR query.
 *
 * Contains the complete Pareto-optimal set of journeys within the departure-time
 * window `[query.departureTime, query.lastDepartureTime]`.
 *
 * **Pareto dominance**: journey J1 dominates J2 iff
 *   `τdep(J1) ≥ τdep(J2)  AND  τarr(J1) ≤ τarr(J2)`
 * (with at least one strict inequality).
 *
 * Runs are ordered **latest-departure-first**: each successive run departs
 * strictly earlier *and* arrives strictly earlier than the previous one,
 * forming the classic staircase Pareto frontier.
 */
export class RangeResult {
  private readonly _runs: readonly ParetoRun[];

  constructor(
    runs: ParetoRun[],
    private readonly _query: RangeQuery,
  ) {
    this._runs = runs;
  }

  /**
   * The original query that produced this result, including the departure-time
   * window (`departureTime` … `lastDepartureTime`).
   */
  get query(): RangeQuery {
    return this._query;
  }

  /**
   * Returns all non-dominated routes to the query's destination(s), ordered
   * from the latest departure to the earliest departure.
   *
   * Each route in the list departs strictly earlier *and* arrives strictly
   * earlier than its predecessor.
   */
  paretoOptimalRoutes(): Route[] {
    const routes: Route[] = [];
    for (const { result } of this._runs) {
      const route = result.bestRoute();
      if (route !== undefined) routes.push(route);
    }
    return routes;
  }

  /**
   * The route with the **latest possible departure** from the origin that still
   * achieves the minimum arrival time within the window.
   *
   * Equivalent to calling `router.route()` with `departureTime = lastDepartureTime`.
   * Returns `undefined` if no journey was found in the window.
   */
  bestRoute(): Route | undefined {
    return this._runs[0]?.result.bestRoute();
  }

  /**
   * Earliest achievable arrival at any stop across all Pareto-optimal runs.
   *
   * Useful for isochrone / accessibility analysis: given a departure-time window,
   * how early can you reach stop `s` regardless of which specific trip you take?
   *
   * @param stop        The target stop ID.
   * @param maxTransfers Optional upper bound on the number of transfers.
   */
  bestArrivalAt(stop: StopId, maxTransfers?: number): Arrival | undefined {
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

  /** Number of Pareto-optimal journeys found within the window. */
  get size(): number {
    return this._runs.length;
  }

  /**
   * Iterates over all Pareto-optimal `(departureTime, result)` pairs,
   * ordered from the latest departure to the earliest departure.
   */
  [Symbol.iterator](): IterableIterator<ParetoRun> {
    return this._runs[Symbol.iterator]() as IterableIterator<ParetoRun>;
  }
}
