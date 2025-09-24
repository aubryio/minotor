/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Duration } from '../timetable/duration.js';
import {
  Route,
  RouteId,
  StopRouteIndex,
  TripRouteIndex,
} from '../timetable/route.js';
import { Time } from '../timetable/time.js';
import { Timetable, TransferType } from '../timetable/timetable.js';
import { Query } from './query.js';
import { Result } from './result.js';

const UNREACHED = Time.infinity();

export type RoutingNode =
  | { arrival: Time } // Origin node
  | {
      arrival: Time;
      from: StopRouteIndex;
      to: StopRouteIndex;
      routeId: RouteId;
      tripId: TripRouteIndex;
    } // PT Node
  | {
      arrival: Time;
      from: StopId;
      to: StopId;
      type: TransferType;
      minTransferTime?: Duration;
    }; // Transfer node;

export type Arrival = {
  arrival: Time;
  legNumber: number;
};

type ActiveTrip = {
  tripRouteIndex: TripRouteIndex;
  hopOnStop: StopId;
};

export type RoutingState = {
  earliestArrivals: Map<StopId, Arrival>;
  earliestArrivalsPerRound: Map<StopId, RoutingNode>[];
  markedStops: Set<StopId>;
  origins: StopId[];
  destinations: StopId[];
};

/**
 * A public transportation network router implementing the RAPTOR algorithm for
 * efficient journey planning and routing. For more information on the RAPTOR
 * algorithm, refer to its detailed explanation in the research paper:
 * https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
export class Router {
  private readonly timetable: Timetable;
  private readonly stopsIndex: StopsIndex;

  constructor(timetable: Timetable, stopsIndex: StopsIndex) {
    this.timetable = timetable;
    this.stopsIndex = stopsIndex;
  }

  /**
   * The main Raptor algorithm implementation.
   *
   * @param query The query containing the main parameters for the routing.
   * @returns A result object containing data structures allowing to reconstruct routes and .
   */
  route(query: Query): Result {
    const routingState = this.initRoutingState(query);
    // Initial transfer consideration for origins
    this.considerTransfers(query, 0, routingState);

    for (let round = 1; round <= query.options.maxTransfers + 1; round++) {
      const arrivalsAtCurrentRound = new Map<StopId, RoutingNode>();
      routingState.earliestArrivalsPerRound.push(arrivalsAtCurrentRound);
      const reachableRoutes = this.timetable.findReachableRoutes(
        routingState.markedStops,
        query.options.transportModes,
      );
      routingState.markedStops.clear();
      // for each route that can be reached with at least round - 1 trips
      for (const [route, hopOnStop] of reachableRoutes) {
        this.scanRoute(route, hopOnStop, round, routingState);
      }
      // process in-seat trip continuations
      for (const stopId of routingState.markedStops) {
        const arrival = arrivalsAtCurrentRound.get(stopId);
        if (!arrival || !('routeId' in arrival)) continue;
        const continuations = this.timetable.getContinuousTrips(
          stopId,
          arrival.tripId,
        );
        for (const continuation of continuations) {
          const route = this.timetable.getRoute(continuation.onRoute)!;
          this.scanRoute(
            route,
            continuation.atStop,
            round,
            routingState,
            continuation.onTrip,
          );
        }
      }
      this.considerTransfers(query, round, routingState);
      if (routingState.markedStops.size === 0) break;
    }
    return new Result(query, routingState, this.stopsIndex);
  }

  /**
   * Initializes the routing state for the RAPTOR algorithm.
   *
   * This method sets up the initial data structures needed for route planning,
   * including origin and destination stops (considering equivalent stops),
   * earliest arrival times, and marked stops for processing.
   *
   * @param query The routing query containing origin, destination, and departure time
   * @returns The initialized routing state with all necessary data structures
   */
  private initRoutingState(query: Query): RoutingState {
    const { from, to, departureTime } = query;
    // Consider children or siblings of the "from" stop as potential origins
    const origins = this.stopsIndex
      .equivalentStops(from)
      .map((origin) => origin.id);
    // Consider children or siblings of the "to" stop(s) as potential destinations
    const destinations = Array.from(to)
      .flatMap((destination) => this.stopsIndex.equivalentStops(destination))
      .map((origin) => origin.id);

    const earliestArrivals = new Map<StopId, Arrival>();
    const earliestArrivalsWithoutAnyLeg = new Map<StopId, RoutingNode>();
    const earliestArrivalsPerRound = [earliestArrivalsWithoutAnyLeg];
    const markedStops = new Set<StopId>();

    for (const originStop of origins) {
      markedStops.add(originStop);
      const initialState = {
        arrival: departureTime,
        legNumber: 0,
      };
      earliestArrivals.set(originStop, initialState);
      earliestArrivalsWithoutAnyLeg.set(originStop, initialState);
    }

    return {
      origins,
      destinations,
      earliestArrivals,
      earliestArrivalsPerRound,
      markedStops,
    };
  }

  /**
   * Scans a route to find the earliest possible trips and updates arrival times.
   *
   * This method implements the core route scanning logic of the RAPTOR algorithm.
   * It iterates through all stops on a given route starting from the hop-on stop,
   * maintaining the current best trip and updating arrival times when improvements
   * are found. The method also handles boarding new trips when earlier departures
   * are available.
   *
   * @param route The route to scan for possible trips
   * @param hopOnStop The stop ID where passengers can board the route
   * @param round The current round number in the RAPTOR algorithm
   * @param routingState The current routing state containing arrival times and marked stops
   */
  private scanRoute(
    route: Route,
    hopOnStop: StopId,
    round: number,
    routingState: RoutingState,
    // TODO pass optional trip
  ) {
    const arrivalsAtCurrentRound =
      routingState.earliestArrivalsPerRound[round]!;
    const arrivalsAtPreviousRound =
      routingState.earliestArrivalsPerRound[round - 1]!;
    let trip: ActiveTrip | undefined = undefined;
    const startIndex = route.stopIndex(hopOnStop);
    // Compute target pruning criteria only once per route
    const earliestArrivalAtAnyDestination = this.earliestArrivalAtAnyStop(
      routingState.earliestArrivals,
      routingState.destinations,
    );
    for (let j = startIndex; j < route.getNbStops(); j++) {
      const currentStop = route.stops[j]!;
      // If we're currently on a trip,
      // check if arrival at the stop improves the earliest arrival time
      if (trip !== undefined) {
        const arrivalTime = route.arrivalAt(currentStop, trip.tripRouteIndex);
        const dropOffType = route.dropOffTypeAt(
          currentStop,
          trip.tripRouteIndex,
        );
        const earliestArrivalAtCurrentStop =
          routingState.earliestArrivals.get(currentStop)?.arrival ?? UNREACHED;
        if (
          dropOffType !== 'NOT_AVAILABLE' &&
          arrivalTime.isBefore(earliestArrivalAtCurrentStop) &&
          arrivalTime.isBefore(earliestArrivalAtAnyDestination)
        ) {
          arrivalsAtCurrentRound.set(currentStop, {
            arrival: arrivalTime,
            routeId: route.id,
            tripId: trip.tripRouteIndex,
            from: trip.hopOnStop,
            to: currentStop,
          });
          routingState.earliestArrivals.set(currentStop, {
            arrival: arrivalTime,
            legNumber: round,
          });
          routingState.markedStops.add(currentStop);
        }
      }
      // check if we can board an earlier trip at the current stop
      // if there was no current trip, find the first one reachable
      const earliestArrivalOnPreviousRound =
        arrivalsAtPreviousRound.get(currentStop)?.arrival;
      if (
        earliestArrivalOnPreviousRound !== undefined &&
        (trip === undefined ||
          earliestArrivalOnPreviousRound.isBefore(
            route.departureFrom(currentStop, trip.tripRouteIndex),
          ) ||
          earliestArrivalOnPreviousRound.equals(
            route.departureFrom(currentStop, trip.tripRouteIndex),
          ))
      ) {
        const earliestTrip = route.findEarliestTrip(
          currentStop,
          earliestArrivalOnPreviousRound,
          trip?.tripRouteIndex,
        );
        if (earliestTrip !== undefined) {
          trip = {
            tripRouteIndex: earliestTrip,
            hopOnStop: currentStop,
          };
        }
      }
    }
  }

  /**
   * Processes all currently marked stops to find available transfers
   * and determines if using these transfers would result in earlier arrival times
   * at destination stops. It handles different transfer types including in-seat
   * transfers and walking transfers with appropriate minimum transfer times.
   *
   * @param query The routing query containing transfer options and constraints
   * @param round The current round number in the RAPTOR algorithm
   * @param routingState The current routing state containing arrival times and marked stops
   */
  private considerTransfers(
    query: Query,
    round: number,
    routingState: RoutingState,
  ): void {
    const { options } = query;
    const arrivalsAtCurrentRound =
      routingState.earliestArrivalsPerRound[round]!;
    const newlyMarkedStops: Set<StopId> = new Set();
    const markedStopsArray = Array.from(routingState.markedStops);
    for (let i = 0; i < markedStopsArray.length; i++) {
      const stop = markedStopsArray[i]!;
      const currentArrival = arrivalsAtCurrentRound.get(stop);
      // Skip transfers if the last leg was also a transfer
      if (!currentArrival || 'transferType' in currentArrival) continue;
      const transfers = this.timetable.getTransfers(stop);
      for (let j = 0; j < transfers.length; j++) {
        const transfer = transfers[j]!;
        let transferTime: Duration;
        if (transfer.minTransferTime) {
          transferTime = transfer.minTransferTime;
        } else if (transfer.type === 'IN_SEAT') {
          transferTime = Duration.zero();
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer = currentArrival.arrival.plus(transferTime);
        const originalArrival =
          arrivalsAtCurrentRound.get(transfer.destination)?.arrival ??
          UNREACHED;
        if (arrivalAfterTransfer.isBefore(originalArrival)) {
          arrivalsAtCurrentRound.set(transfer.destination, {
            arrival: arrivalAfterTransfer,
            from: stop,
            to: transfer.destination,
            minTransferTime: transfer.minTransferTime,
            type: transfer.type,
          });
          routingState.earliestArrivals.set(transfer.destination, {
            arrival: arrivalAfterTransfer,
            legNumber: round,
          });
          newlyMarkedStops.add(transfer.destination);
        }
      }
    }
    const newlyMarkedStopsArray = Array.from(newlyMarkedStops);
    for (let i = 0; i < newlyMarkedStopsArray.length; i++) {
      const newStop = newlyMarkedStopsArray[i]!;
      routingState.markedStops.add(newStop);
    }
  }

  /**
   * Finds the earliest arrival time at any stop from a given set of destinations.
   *
   * @param earliestArrivals A map of stops to their earliest reaching times.
   * @param destinations An array of destination stops to evaluate.
   * @returns The earliest arrival time among the provided destinations.
   */
  private earliestArrivalAtAnyStop(
    earliestArrivals: Map<StopId, Arrival>,
    destinations: StopId[],
  ): Time {
    let earliestArrivalAtAnyDestination = UNREACHED;
    for (let i = 0; i < destinations.length; i++) {
      const destination = destinations[i]!;
      const arrival = earliestArrivals.get(destination)?.arrival ?? UNREACHED;
      earliestArrivalAtAnyDestination = Time.min(
        earliestArrivalAtAnyDestination,
        arrival,
      );
    }
    return earliestArrivalAtAnyDestination;
  }
}
