import { StopsIndex } from '../stops/stopsIndex.js';
import { Timetable } from '../timetable/timetable.js';
import { AccessFinder } from './access.js';
import { Query } from './query.js';
import { Raptor } from './raptor.js';
import { Result } from './result.js';
import { RoutingState } from './state.js';

export class PlainRouter {
  private readonly timetable: Timetable;
  private readonly stopsIndex: StopsIndex;
  private readonly accessFinder: AccessFinder;
  private readonly raptor: Raptor;

  constructor(
    timetable: Timetable,
    stopsIndex: StopsIndex,
    accessFinder: AccessFinder,
    raptor: Raptor,
  ) {
    this.timetable = timetable;
    this.stopsIndex = stopsIndex;
    this.accessFinder = accessFinder;
    this.raptor = raptor;
  }

  /**
   * Standard RAPTOR: finds the earliest-arrival journey from `query.from` to
   * `query.to` for the given departure time.
   *
   * @param query The routing query.
   * @returns A {@link Result} that can reconstruct the best route and arrival times.
   */
  route(query: Query): Result {
    const accessLegs = this.accessFinder.collectAccessPaths(
      query.from,
      query.options.minTransferTime,
    );

    const destinations = Array.from(query.to)
      .flatMap((destination) => this.stopsIndex.equivalentStops(destination))
      .map((destination) => destination.id);

    const routingState = new RoutingState(
      query.departureTime,
      destinations,
      accessLegs,
      this.timetable.nbStops(),
      query.options.maxTransfers + 1,
      query.options.maxDuration,
    );

    this.raptor.run(query.options, routingState);
    return new Result(
      new Set(destinations),
      routingState,
      this.stopsIndex,
      this.timetable,
    );
  }
}
