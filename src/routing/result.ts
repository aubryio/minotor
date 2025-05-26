import { SourceStopId, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Query } from './query.js';
import { Leg, Route } from './route.js';
import { ReachingTime, TripLeg } from './router.js';

export class Result {
  private readonly query: Query;
  public readonly earliestArrivals: Map<StopId, ReachingTime>;
  public readonly earliestArrivalsPerRound: Map<StopId, TripLeg>[];
  private readonly stopsIndex: StopsIndex;

  constructor(
    query: Query,
    earliestArrivals: Map<StopId, ReachingTime>,
    earliestArrivalsPerRound: Map<StopId, TripLeg>[],
    stopsIndex: StopsIndex,
  ) {
    this.query = query;
    this.earliestArrivals = earliestArrivals;
    this.earliestArrivalsPerRound = earliestArrivalsPerRound;
    this.stopsIndex = stopsIndex;
  }

  /**
   * Reconstructs the best route to a stop.
   * (to any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param to The destination stop. Defaults to the destination of the original query.
   * @returns a route to the destination stop if it exists.
   */
  bestRoute(to?: SourceStopId | SourceStopId[]): Route | undefined {
    const destinationList = Array.isArray(to) ? to : to ? [to] : this.query.to;
    const destinations = destinationList.flatMap((destination) =>
      this.stopsIndex.equivalentStops(destination),
    );

    let fastestDestination: StopId | undefined = undefined;
    let fastestTime: ReachingTime | undefined = undefined;
    for (const destination of destinations) {
      const arrivalTime = this.earliestArrivals.get(destination.id);
      if (arrivalTime !== undefined) {
        if (
          fastestTime === undefined ||
          arrivalTime.time.toSeconds() < fastestTime.time.toSeconds()
        ) {
          fastestDestination = destination.id;
          fastestTime = arrivalTime;
        }
      }
    }
    if (!fastestDestination || !fastestTime) {
      return undefined;
    }

    const route: Leg[] = [];
    let currentStop = fastestDestination;
    let round = fastestTime.legNumber;
    while (fastestTime.origin !== currentStop) {
      const tripLeg = this.earliestArrivalsPerRound[round]?.get(currentStop);
      if (!tripLeg?.leg) {
        throw new Error(
          `No leg found for a trip leg: start stop=${
            tripLeg?.leg?.from.id ?? 'unknown'
          }, end stop=${currentStop}, round=${round}, origin=${fastestTime.origin}`,
        );
      }
      route.unshift(tripLeg.leg);
      currentStop = tripLeg.leg.from.id;
      if ('route' in tripLeg.leg) {
        round -= 1;
      }
    }
    return new Route(route);
  }

  /**
   * Returns the arrival time at any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param stop The target stop for which to return the arrival time.
   * @param maxTransfers The optional maximum number of transfers allowed.
   * @returns The arrival time if the target stop is reachable, otherwise undefined.
   */
  arrivalAt(
    stop: SourceStopId,
    maxTransfers?: number,
  ): ReachingTime | undefined {
    const equivalentStops = this.stopsIndex.equivalentStops(stop);
    let earliestArrival: ReachingTime | undefined = undefined;

    const relevantArrivals =
      maxTransfers !== undefined
        ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          this.earliestArrivalsPerRound[maxTransfers - 1]!
        : this.earliestArrivals;

    for (const equivalentStop of equivalentStops) {
      const arrivalTime = relevantArrivals.get(equivalentStop.id);
      if (arrivalTime !== undefined) {
        if (
          earliestArrival === undefined ||
          arrivalTime.time.toSeconds() < earliestArrival.time.toSeconds()
        ) {
          earliestArrival = arrivalTime;
        }
      }
    }

    return earliestArrival;
  }
}
