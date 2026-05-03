import { StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Time } from '../timetable/time.js';
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
   * A journey is Pareto-optimal iff no journey departing no earlier arrives no
   * later. Runs are ordered latest-departure-first in the returned result.
   *
   * @param query A {@link RangeQuery} with both `departureTime` and `lastDepartureTime` set.
   * @returns A {@link RangeResult} exposing the full Pareto frontier.
   */
  rangeRoute(query: RangeQuery): RangeResult {
    const { departureTime: earliest, lastDepartureTime: latest } = query;

    const destinations = Array.from(query.to)
      .flatMap((destination) => this.stopsIndex.equivalentStops(destination))
      .map((destination) => destination.id);

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
      return new RangeResult([], new Set(destinations));
    }

    const maxRounds = query.options.maxTransfers + 1;

    const rangeState = new RangeRaptorState(
      maxRounds,
      this.timetable.nbStops(),
      latest,
    );

    const paretoRuns: ParetoRun[] = [];

    const paretoDestBest = new Map<StopId, Time>();
    for (const dest of destinations) {
      paretoDestBest.set(dest, UNREACHED_TIME);
    }

    const trivialDests = new Set(
      accessLegs
        .map((leg) => leg.toStopId)
        .filter((id) => destinations.includes(id)),
    );
    const trivialDestCovered = new Set<StopId>();

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
      if (!noDestinations) {
        for (const dest of destinations) {
          const t = routingState.arrivalTime(dest);
          if (t < (paretoDestBest.get(dest) ?? UNREACHED_TIME))
            paretoDestBest.set(dest, t);
        }
      }
    }

    for (const { depTime, legs } of departureSlots) {
      if (!noDestinations && trivialDestCovered.size === destinations.length) {
        break;
      }

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

      let isParetoOptimal = noDestinations;
      if (!noDestinations) {
        for (const dest of destinations) {
          const arrival = routingState.arrivalTime(dest);
          if (arrival >= (paretoDestBest.get(dest) ?? UNREACHED_TIME)) {
            continue;
          }

          if (trivialDests.has(dest) && trivialDestCovered.has(dest)) {
            paretoDestBest.set(dest, arrival);
            continue;
          }

          paretoDestBest.set(dest, arrival);
          if (trivialDests.has(dest)) {
            trivialDestCovered.add(dest);
          }
          isParetoOptimal = true;
        }
      }

      if (isParetoOptimal) {
        paretoRuns.push({
          departureTime: depTime,
          result: new Result(
            new Set(destinations),
            routingState,
            this.stopsIndex,
            this.timetable,
          ),
        });
        routingState = null;
      }
    }

    return new RangeResult(paretoRuns, new Set(destinations));
  }
}
