/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import {
  NOT_AVAILABLE,
  Route,
  StopRouteIndex,
  TripRouteIndex,
} from '../timetable/route.js';
import {
  Duration,
  DURATION_ZERO,
  Time,
  TIME_ORIGIN,
} from '../timetable/time.js';
import { Timetable, TripStop } from '../timetable/timetable.js';
import { Query, QueryOptions } from './query.js';
import { Result } from './result.js';
import {
  RoutingEdge,
  RoutingState,
  TransferEdge,
  UNREACHED_TIME,
  VehicleEdge,
} from './state.js';

export type {
  Arrival,
  OriginNode,
  RoutingEdge,
  TransferEdge,
  VehicleEdge,
} from './state.js';
export { RoutingState, UNREACHED_TIME } from './state.js';

type TripContinuation = TripStop & {
  previousEdge: VehicleEdge;
};

type Round = number;

/**
 * A public transportation router implementing the RAPTOR algorithm.
 * For more information on the RAPTOR algorithm,
 * refer to its detailed explanation in the research paper:
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
    const markedStops = new Set<StopId>(routingState.origins);
    // Initial transfer consideration for origins
    const newlyMarkedStops = this.considerTransfers(
      query,
      0,
      markedStops,
      routingState,
    );
    for (const newStop of newlyMarkedStops) {
      markedStops.add(newStop);
    }
    for (let round = 1; round <= query.options.maxTransfers + 1; round++) {
      const edgesAtCurrentRound: (RoutingEdge | undefined)[] = new Array<
        RoutingEdge | undefined
      >(routingState.nbStops);
      routingState.graph.push(edgesAtCurrentRound);
      const reachableRoutes = this.timetable.findReachableRoutes(
        markedStops,
        query.options.transportModes,
      );
      markedStops.clear();
      // for each route that can be reached with at least round - 1 trips
      for (const [route, hopOnStopIndex] of reachableRoutes) {
        const newlyMarkedStops = this.scanRoute(
          route,
          hopOnStopIndex,
          round,
          routingState,
          query.options,
        );
        for (const newStop of newlyMarkedStops) {
          markedStops.add(newStop);
        }
      }
      // process in-seat trip continuations
      let continuations = this.findTripContinuations(
        markedStops,
        edgesAtCurrentRound,
      );
      while (continuations.length > 0) {
        const stopsFromContinuations: Set<StopId> = new Set();
        for (const continuation of continuations) {
          const route = this.timetable.getRoute(continuation.routeId)!;
          const routeScanResults = this.scanRoute(
            route,
            continuation.stopIndex,
            round,
            routingState,
            query.options,
            continuation,
          );
          for (const newStop of routeScanResults) {
            stopsFromContinuations.add(newStop);
          }
        }
        for (const newStop of stopsFromContinuations) {
          markedStops.add(newStop);
        }
        continuations = this.findTripContinuations(
          stopsFromContinuations,
          edgesAtCurrentRound,
        );
      }
      const newlyMarkedStops = this.considerTransfers(
        query,
        round,
        markedStops,
        routingState,
      );
      for (const newStop of newlyMarkedStops) {
        markedStops.add(newStop);
      }

      if (markedStops.size === 0) break;
    }
    return new Result(query, routingState, this.stopsIndex, this.timetable);
  }

  /**
   * Finds trip continuations for the given marked stops and edges at the current round.
   * @param markedStops The set of marked stops.
   * @param edgesAtCurrentRound The array of edges at the current round, indexed by stop ID.
   * @returns An array of trip continuations.
   */
  private findTripContinuations(
    markedStops: Set<StopId>,
    edgesAtCurrentRound: (RoutingEdge | undefined)[],
  ): TripContinuation[] {
    const continuations: TripContinuation[] = [];
    for (const stopId of markedStops) {
      const arrival = edgesAtCurrentRound[stopId];
      if (!arrival || !('routeId' in arrival)) continue;

      const continuousTrips = this.timetable.getContinuousTrips(
        arrival.hopOffStopIndex,
        arrival.routeId,
        arrival.tripIndex,
      );
      for (let i = 0; i < continuousTrips.length; i++) {
        const trip = continuousTrips[i]!;
        continuations.push({
          routeId: trip.routeId,
          stopIndex: trip.stopIndex,
          tripIndex: trip.tripIndex,
          previousEdge: arrival,
        });
      }
    }
    return continuations;
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
      .map((destination) => destination.id);
    return new RoutingState(
      origins,
      destinations,
      departureTime,
      this.timetable.nbStops(),
    );
  }

  /**
   * Scans a route to find the earliest possible trips (if not provided) and updates arrival times.
   *
   * This method implements the core route scanning logic of the RAPTOR algorithm.
   * It iterates through all stops on a given route starting from the hop-on stop,
   * maintaining the current best trip and updating arrival times when improvements
   * are found. The method also handles boarding new trips when earlier departures
   * are available if no given trip is provided as a parameter.
   *
   * @param route The route to scan for possible trips
   * @param hopOnStopIndex The stop index where passengers can board the route
   * @param round The current round number in the RAPTOR algorithm
   * @param routingState The current routing state containing arrival times and marked stops
   */
  private scanRoute(
    route: Route,
    hopOnStopIndex: StopRouteIndex,
    round: Round,
    routingState: RoutingState,
    options: QueryOptions,
    tripContinuation?: TripContinuation,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    let activeTrip: TripStop | undefined = tripContinuation
      ? {
          routeId: route.id,
          stopIndex: hopOnStopIndex,
          tripIndex: tripContinuation.tripIndex,
        }
      : undefined;
    const edgesAtCurrentRound = routingState.graph[round]!;
    const edgesAtPreviousRound = routingState.graph[round - 1]!;
    // Compute target pruning criteria only once per route
    const earliestArrivalAtAnyDestination =
      this.earliestArrivalAtAnyStop(routingState);
    for (
      let currentStopIndex = hopOnStopIndex;
      currentStopIndex < route.getNbStops();
      currentStopIndex++
    ) {
      const currentStop: StopId = route.stops[currentStopIndex]!;
      // If we're currently on a trip,
      // check if arrival at the stop improves the earliest arrival time
      if (activeTrip !== undefined) {
        const arrivalTime = route.arrivalAt(
          currentStopIndex,
          activeTrip.tripIndex,
        );
        const dropOffType = route.dropOffTypeAt(
          currentStopIndex,
          activeTrip.tripIndex,
        );
        const earliestArrivalAtCurrentStop =
          routingState.arrivalTime(currentStop);
        if (
          dropOffType !== NOT_AVAILABLE &&
          arrivalTime < earliestArrivalAtCurrentStop &&
          arrivalTime < earliestArrivalAtAnyDestination
        ) {
          const edge: VehicleEdge = {
            routeId: activeTrip.routeId,
            stopIndex: activeTrip.stopIndex,
            tripIndex: activeTrip.tripIndex,
            arrival: arrivalTime,
            hopOffStopIndex: currentStopIndex,
          };
          if (tripContinuation) {
            // In case of continuous trip, we set a pointer to the previous edge
            edge.continuationOf = tripContinuation.previousEdge;
          }
          edgesAtCurrentRound[currentStop] = edge;

          routingState.updateArrival(currentStop, arrivalTime, round);
          newlyMarkedStops.add(currentStop);
        }
      }
      if (tripContinuation) {
        // If it's a trip continuation, no need to check for earlier trips
        continue;
      }
      // check if we can board an earlier trip at the current stop
      // if there was no current trip, find the first one reachable
      const previousEdge = edgesAtPreviousRound[currentStop];
      const earliestArrivalOnPreviousRound = previousEdge?.arrival;
      if (
        earliestArrivalOnPreviousRound !== undefined &&
        (activeTrip === undefined ||
          earliestArrivalOnPreviousRound <=
            route.departureFrom(currentStopIndex, activeTrip.tripIndex))
      ) {
        const earliestTrip = route.findEarliestTrip(
          currentStopIndex,
          earliestArrivalOnPreviousRound,
          activeTrip?.tripIndex,
        );
        if (earliestTrip === undefined) {
          continue;
        }

        const firstBoardableTrip = this.findFirstBoardableTrip(
          currentStopIndex,
          route,
          earliestTrip,
          earliestArrivalOnPreviousRound,
          activeTrip?.tripIndex,
          // provide the previous trip if the previous edge was a vehicle
          previousEdge && 'routeId' in previousEdge ? previousEdge : undefined,
          options.minTransferTime,
        );

        if (firstBoardableTrip !== undefined) {
          activeTrip = {
            routeId: route.id,
            tripIndex: firstBoardableTrip,
            stopIndex: currentStopIndex,
          };
        }
      }
    }
    return newlyMarkedStops;
  }

  /**
   * Finds the first boardable trip on a route at a given stop that meets transfer requirements.
   *
   * This method searches through trips on a route starting from the earliest trip index reachable
   * from the previous edge to find the first trip that can be effectively boarded,
   * considering pickup availability, transfer guarantees, and minimum transfer times.
   *
   * @param stopIndex The index in the route of the stop where boarding is attempted
   * @param route The route to search for boardable trips
   * @param earliestTrip The earliest trip index to start searching from
   * @param after The earliest time after which boarding can occur
   * @param beforeTrip Optional upper bound trip index to limit search
   * @param previousTrip The previous trip taken (for transfer guarantee checks)
   * @param transferTime Minimum time required for transfers between trips
   * @returns The trip index of the first boardable trip, or undefined if none found
   */
  private findFirstBoardableTrip(
    stopIndex: StopRouteIndex,
    route: Route,
    earliestTrip: TripRouteIndex,
    after: Time = TIME_ORIGIN,
    beforeTrip?: TripRouteIndex,
    previousTrip?: VehicleEdge,
    transferTime: Duration = DURATION_ZERO,
  ): TripRouteIndex | undefined {
    const nbTrips = route.getNbTrips();

    for (let t = earliestTrip; t < (beforeTrip ?? nbTrips); t++) {
      const pickup = route.pickUpTypeFrom(stopIndex, t);
      if (pickup === NOT_AVAILABLE) {
        continue;
      }
      if (previousTrip === undefined) {
        return t;
      }

      const isGuaranteed = this.timetable.isTripTransferGuaranteed(
        {
          stopIndex: previousTrip.hopOffStopIndex,
          routeId: previousTrip.routeId,
          tripIndex: previousTrip.tripIndex,
        },
        { stopIndex, routeId: route.id, tripIndex: t },
      );
      if (isGuaranteed) {
        return t;
      }
      const departure = route.departureFrom(stopIndex, t);
      const requiredTime = after + transferTime;
      if (departure >= requiredTime) {
        return t;
      }
    }
    return undefined;
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
    markedStops: Set<StopId>,
    routingState: RoutingState,
  ): Set<StopId> {
    const { options } = query;
    const arrivalsAtCurrentRound = routingState.graph[round]!;
    const newlyMarkedStops: Set<StopId> = new Set();
    for (const stop of markedStops) {
      const currentArrival = arrivalsAtCurrentRound[stop];
      // Skip transfers if the last leg was also a transfer
      if (!currentArrival || 'type' in currentArrival) continue;
      const transfers = this.timetable.getTransfers(stop);
      for (let j = 0; j < transfers.length; j++) {
        const transfer = transfers[j]!;
        let transferTime: Duration;
        if (transfer.minTransferTime) {
          transferTime = transfer.minTransferTime;
        } else if (transfer.type === 'IN_SEAT') {
          // TODO not needed anymore now that trip continuations are handled separately
          transferTime = DURATION_ZERO;
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer = currentArrival.arrival + transferTime;
        const originalArrival = routingState.arrivalTime(transfer.destination);
        if (arrivalAfterTransfer < originalArrival) {
          arrivalsAtCurrentRound[transfer.destination] = {
            arrival: arrivalAfterTransfer,
            from: stop,
            to: transfer.destination,
            minTransferTime: transfer.minTransferTime,
            type: transfer.type,
          } as TransferEdge;
          routingState.updateArrival(
            transfer.destination,
            arrivalAfterTransfer,
            round,
          );
          newlyMarkedStops.add(transfer.destination);
        }
      }
    }
    return newlyMarkedStops;
  }

  /**
   * Finds the earliest arrival time at any stop from a given set of destinations.
   *
   * @param routingState The routing state containing arrival times and destinations.
   * @returns The earliest arrival time among the provided destinations.
   */
  private earliestArrivalAtAnyStop(routingState: RoutingState): Time {
    let earliestArrivalAtAnyDestination: Time = UNREACHED_TIME;
    for (let i = 0; i < routingState.destinations.length; i++) {
      const arrival = routingState.arrivalTime(routingState.destinations[i]!);
      if (arrival < earliestArrivalAtAnyDestination) {
        earliestArrivalAtAnyDestination = arrival;
      }
    }
    return earliestArrivalAtAnyDestination;
  }
}
