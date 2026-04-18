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
      const stopsFromContinuations = new Set<StopId>();
      while (continuations.length > 0) {
        stopsFromContinuations.clear();
        for (const continuation of continuations) {
          const route = this.timetable.getRoute(continuation.routeId)!;
          const routeScanResults = this.scanRouteContinuation(
            route,
            continuation.stopIndex,
            round,
            routingState,
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
   * Scans a route for an in-seat trip continuation.
   *
   * The boarded trip and entry stop are fixed, so there is no need to probe for
   * earlier boardings.
   *
   * @param route The route to scan
   * @param hopOnStopIndex The stop index where the continuation begins
   * @param round The current RAPTOR round
   * @param routingState Current routing state
   * @param tripContinuation The in-seat continuation descriptor
   */
  private scanRouteContinuation(
    route: Route,
    hopOnStopIndex: StopRouteIndex,
    round: Round,
    routingState: RoutingState,
    tripContinuation: TripContinuation,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    const edgesAtCurrentRound = routingState.graph[round]!;
    const earliestArrivalAtAnyDestination =
      this.earliestArrivalAtAnyStop(routingState);

    const nbStops = route.getNbStops();
    const routeId = route.id;
    const tripIndex = tripContinuation.tripIndex;
    const tripStopOffset = route.tripStopOffset(tripIndex);
    const previousEdge = tripContinuation.previousEdge;

    for (
      let currentStopIndex = hopOnStopIndex;
      currentStopIndex < nbStops;
      currentStopIndex++
    ) {
      const currentStop: StopId = route.stops[currentStopIndex]!;
      const arrivalTime = route.arrivalAtOffset(
        currentStopIndex,
        tripStopOffset,
      );
      const dropOffType = route.dropOffTypeAtOffset(
        currentStopIndex,
        tripStopOffset,
      );
      const earliestArrivalAtCurrentStop =
        routingState.arrivalTime(currentStop);
      if (
        dropOffType !== NOT_AVAILABLE &&
        arrivalTime < earliestArrivalAtCurrentStop &&
        arrivalTime < earliestArrivalAtAnyDestination
      ) {
        edgesAtCurrentRound[currentStop] = {
          routeId,
          stopIndex: hopOnStopIndex,
          tripIndex,
          arrival: arrivalTime,
          hopOffStopIndex: currentStopIndex,
          continuationOf: previousEdge,
        };
        routingState.updateArrival(currentStop, arrivalTime, round);
        newlyMarkedStops.add(currentStop);
      }
    }
    return newlyMarkedStops;
  }

  /**
   * Scans a route using the standard RAPTOR boarding logic.
   *
   * Iterates through all stops from the hop-on point, maintaining the current
   * best trip and improving arrival times when possible. At each marked stop it
   * also checks whether an earlier (or first) trip can be boarded, upgrading the
   * active trip when one is found.
   *
   * @param route The route to scan
   * @param hopOnStopIndex The stop index where passengers can first board
   * @param round The current RAPTOR round
   * @param routingState Current routing state
   * @param options Query options (minTransferTime, etc.)
   */
  private scanRoute(
    route: Route,
    hopOnStopIndex: StopRouteIndex,
    round: Round,
    routingState: RoutingState,
    options: QueryOptions,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    const edgesAtCurrentRound = routingState.graph[round]!;
    const edgesAtPreviousRound = routingState.graph[round - 1]!;
    const earliestArrivalAtAnyDestination =
      this.earliestArrivalAtAnyStop(routingState);

    const nbStops = route.getNbStops();
    const routeId = route.id;
    let activeTripIndex: TripRouteIndex | undefined;
    let activeTripBoardStopIndex = hopOnStopIndex;
    // tripStopOffset = activeTripIndex * nbStops, precomputed when the trip changes.
    // Only valid while activeTripIndex !== undefined.
    let activeTripStopOffset = 0;

    for (
      let currentStopIndex = hopOnStopIndex;
      currentStopIndex < nbStops;
      currentStopIndex++
    ) {
      const currentStop: StopId = route.stops[currentStopIndex]!;

      // If on a trip, check whether alighting here improves the global best.
      if (activeTripIndex !== undefined) {
        const arrivalTime = route.arrivalAtOffset(
          currentStopIndex,
          activeTripStopOffset,
        );
        const dropOffType = route.dropOffTypeAtOffset(
          currentStopIndex,
          activeTripStopOffset,
        );
        const earliestArrivalAtCurrentStop =
          routingState.arrivalTime(currentStop);
        if (
          dropOffType !== NOT_AVAILABLE &&
          arrivalTime < earliestArrivalAtCurrentStop &&
          arrivalTime < earliestArrivalAtAnyDestination
        ) {
          edgesAtCurrentRound[currentStop] = {
            routeId,
            stopIndex: activeTripBoardStopIndex,
            tripIndex: activeTripIndex,
            arrival: arrivalTime,
            hopOffStopIndex: currentStopIndex,
          };
          routingState.updateArrival(currentStop, arrivalTime, round);
          newlyMarkedStops.add(currentStop);
        }
      }

      // Check whether we can board an earlier (or first) trip at this stop.
      const previousEdge = edgesAtPreviousRound[currentStop];
      const earliestArrivalOnPreviousRound = previousEdge?.arrival;
      if (
        earliestArrivalOnPreviousRound !== undefined &&
        (activeTripIndex === undefined ||
          earliestArrivalOnPreviousRound <=
            route.departureFrom(currentStopIndex, activeTripIndex))
      ) {
        const earliestTrip = route.findEarliestTrip(
          currentStopIndex,
          earliestArrivalOnPreviousRound,
          activeTripIndex,
        );
        if (earliestTrip === undefined) {
          continue;
        }

        const firstBoardableTrip = this.findFirstBoardableTrip(
          currentStopIndex,
          route,
          earliestTrip,
          earliestArrivalOnPreviousRound,
          activeTripIndex,
          // provide the previous edge only if it was a vehicle leg
          previousEdge && 'routeId' in previousEdge ? previousEdge : undefined,
          options.minTransferTime,
        );

        if (firstBoardableTrip !== undefined) {
          activeTripIndex = firstBoardableTrip;
          activeTripBoardStopIndex = currentStopIndex;
          activeTripStopOffset = route.tripStopOffset(firstBoardableTrip);
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
