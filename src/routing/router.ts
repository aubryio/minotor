import { StopsIndex } from '../stops/stopsIndex.js';
import { Timetable } from '../timetable/timetable.js';
import { AccessFinder } from './access.js';
import { PlainRouter } from './plainRouter.js';
import { Query, RangeQuery } from './query.js';
import { RangeResult } from './rangeResult.js';
import { RangeRouter } from './rangeRouter.js';
import { Raptor } from './raptor.js';
import { Result } from './result.js';

export type { ArrivalWithDuration, ParetoRun } from './rangeResult.js';
export { RangeResult } from './rangeResult.js';
export type {
  AccessEdge,
  Arrival,
  OriginNode,
  RoutingEdge,
  TransferEdge,
  VehicleEdge,
} from './state.js';
export { RoutingState, UNREACHED_TIME } from './state.js';

/**
 * A public transportation router implementing the RAPTOR and Range RAPTOR
 * algorithms.
 *
 * Thin facade over {@link PlainRouter} and {@link RangeRouter}: constructs the
 * shared {@link Raptor} engine and {@link AccessFinder} once and delegates each
 * query to the appropriate router.
 *
 * @see https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
export class Router {
  private readonly plainRouter: PlainRouter;
  private readonly rangeRouter: RangeRouter;

  constructor(timetable: Timetable, stopsIndex: StopsIndex) {
    const raptor = new Raptor(timetable);
    const accessFinder = new AccessFinder(timetable, stopsIndex);
    this.plainRouter = new PlainRouter(
      timetable,
      stopsIndex,
      accessFinder,
      raptor,
    );
    this.rangeRouter = new RangeRouter(
      timetable,
      stopsIndex,
      accessFinder,
      raptor,
    );
  }

  /**
   * Standard RAPTOR: finds the earliest-arrival journey from `query.from` to
   * `query.to` for the given departure time.
   */
  route(query: Query): Result {
    return this.plainRouter.route(query);
  }

  /**
   * Range RAPTOR: finds all Pareto-optimal journeys within the departure-time
   * window `[query.departureTime, query.lastDepartureTime]`.
   */
  rangeRoute(query: RangeQuery): RangeResult {
    return this.rangeRouter.rangeRoute(query);
  }
}
