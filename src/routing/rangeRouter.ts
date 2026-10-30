import { StopsIndex } from '../stops/stopsIndex.js';
import { Timetable } from '../timetable/timetable.js';
import { AccessFinder } from './access.js';
import { RangeQuery } from './query.js';
import { ParetoRun, RangeResult } from './rangeResult.js';
import { RangeRaptorState } from './rangeState.js';
import { Raptor } from './raptor.js';
import { Result } from './result.js';
import { RoutingState, UNREACHED_TIME } from './state.js';

export class RangeRouter {
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
   * Range RAPTOR: finds all Pareto-optimal journeys within the departure-time
   * window `[query.departureTime, query.lastDepartureTime]`.
   *
   * Destinations are alternatives. An earlier departure must arrive earlier to remain
   * on the departure/arrival frontier; transfer count is only a query constraint.
   * Runs are ordered latest-departure-first. Access-only answers are retained once.
   *
   * @param query A {@link RangeQuery} with both `departureTime` and `lastDepartureTime` set.
   * @returns A {@link RangeResult} exposing the full Pareto frontier.
   */
  rangeRoute(query: RangeQuery): RangeResult {
    const { departureTime: earliest, lastDepartureTime: latest } = query;

    const destinations = Array.from(query.to).flatMap((destination) =>
      this.stopsIndex.equivalentStops(destination).map((stop) => stop.id),
    );

    const noDestinations = destinations.length === 0;

    const accessLegs = this.accessFinder.collectAccessPaths(
      query.from,
      query.options.minTransferTime,
    );

    const departureSlots = this.accessFinder.collectDepartureTimes(
      accessLegs,
      earliest,
      latest,
    );
    if (departureSlots.length === 0) {
      return new RangeResult([]);
    }

    const maxRounds = query.options.maxTransfers + 1;

    const rangeState = new RangeRaptorState(
      maxRounds,
      this.timetable.nbStops(),
      latest,
    );

    const paretoRuns: ParetoRun[] = [];

    // Later departures are processed first; an earlier run must arrive sooner.
    let bestDestinationArrival = UNREACHED_TIME;
    let retainedAccessJourney = false;
    const trivialDestinations = new Set(
      accessLegs
        .map((leg) => leg.toStopId)
        .filter((stop) => destinations.includes(stop)),
    );

    let routingState: RoutingState | null = null;

    if (query.rangeOptions.optimizeBeyondLatestDeparture) {
      routingState = new RoutingState(
        latest + 1,
        destinations,
        accessLegs,
        this.timetable.nbStops(),
        maxRounds,
        query.options.maxDuration,
      );
      rangeState.setCurrentRun(routingState);
      this.raptor.run(
        {
          ...query.options,
          maxInitialWaitingTime: undefined,
        },
        rangeState,
      );
      bestDestinationArrival = routingState.destinationBest;
    }

    for (const { depTime, legs } of departureSlots) {
      if (routingState === null) {
        routingState = new RoutingState(
          depTime,
          destinations,
          legs,
          this.timetable.nbStops(),
          maxRounds,
          query.options.maxDuration,
        );
      } else {
        routingState.resetFor(depTime, legs);
      }
      rangeState.setCurrentRun(routingState);
      this.raptor.run(
        {
          ...query.options,
          maxInitialWaitingTime: 0,
        },
        rangeState,
      );

      const arrival = routingState.destinationBest;
      const isParetoOptimal =
        noDestinations || arrival < bestDestinationArrival;
      const accessGraph = routingState.graph[0];
      const reachedByAccess = destinations.some(
        (stop) =>
          trivialDestinations.has(stop) &&
          accessGraph?.[stop]?.arrival === arrival,
      );
      bestDestinationArrival = Math.min(bestDestinationArrival, arrival);

      if (isParetoOptimal && (!reachedByAccess || !retainedAccessJourney)) {
        paretoRuns.push({
          departureTime: depTime,
          result: new Result(routingState, this.stopsIndex, this.timetable),
        });
        routingState = null;
        // Represent access-only answers once, but keep looking for faster transit.
        retainedAccessJourney ||= reachedByAccess;
        if (reachedByAccess && arrival === depTime) {
          break;
        }
      }
    }

    return new RangeResult(paretoRuns);
  }
}
