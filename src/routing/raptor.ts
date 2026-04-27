/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import {
  NOT_AVAILABLE,
  Route,
  StopRouteIndex,
  TripRouteIndex,
} from '../timetable/route.js';
import { Duration, DURATION_ZERO, Time } from '../timetable/time.js';
import { Timetable, TripStop } from '../timetable/timetable.js';
import { QueryOptions } from './query.js';
import { RoutingEdge, TransferEdge, VehicleEdge } from './state.js';

/**
 * Common interface for all variants of RAPTOR routing.
 */
export interface IRaptorState {
  /** Origin stop IDs for this run. */
  readonly origins: StopId[];

  /** Per-round routing graph; `graph[round][stop]` is the best edge used to reach `stop`. */
  readonly graph: (RoutingEdge | undefined)[][];

  /** Per-run earliest arrival at a stop. Used for boarding decisions. */
  arrivalTime(stop: StopId): Time;

  /**
   * Tightest known upper bound on the arrival time at `stop` in `round`.
   */
  improvementBound(round: number, stop: StopId): Time;

  /**
   * Best known arrival time at any destination.
   */
  readonly destinationBest: Time;

  /** Returns `true` if `stop` is one of the query's destination stops. */
  isDestination(stop: StopId): boolean;

  /**
   * Records a new arrival at `stop`, updating all relevant state.
   *
   * In Range RAPTOR mode this also updates the cross-run shared labels.
   */
  updateArrival(stop: StopId, time: Time, round: number): void;

  /**
   * Propagates labels from round `k-1` into round `k` before routes are scanned.
   * No-op in standard RAPTOR mode.
   */
  initRound(round: number): void;
}

type TripContinuation = TripStop & {
  previousEdge: VehicleEdge;
};

type Round = number;

/**
 * Encapsulates the core RAPTOR algorithm, operating on a {@link Timetable} and
 * an {@link IRaptorState} provided by the caller.
 *
 * @see https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
export class Raptor {
  private readonly timetable: Timetable;

  constructor(timetable: Timetable) {
    this.timetable = timetable;
  }

  run(options: QueryOptions, state: IRaptorState): void {
    const markedStops = new Set<StopId>(state.origins);

    for (let round = 1; round <= options.maxTransfers + 1; round++) {
      state.initRound(round);

      const edgesAtCurrentRound = state.graph[round]!;
      const reachableRoutes = this.timetable.findReachableRoutes(
        markedStops,
        options.transportModes,
      );
      markedStops.clear();

      for (const [route, hopOnStopIndex] of reachableRoutes) {
        for (const stop of this.scanRoute(
          route,
          hopOnStopIndex,
          round,
          state,
          options,
        )) {
          markedStops.add(stop);
        }
      }

      let continuations = this.findTripContinuations(
        markedStops,
        edgesAtCurrentRound,
      );
      const stopsFromContinuations = new Set<StopId>();
      while (continuations.length > 0) {
        stopsFromContinuations.clear();
        for (const continuation of continuations) {
          const route = this.timetable.getRoute(continuation.routeId)!;
          for (const stop of this.scanRouteContinuation(
            route,
            continuation.stopIndex,
            round,
            state,
            continuation,
          )) {
            stopsFromContinuations.add(stop);
            markedStops.add(stop);
          }
        }
        continuations = this.findTripContinuations(
          stopsFromContinuations,
          edgesAtCurrentRound,
        );
      }

      for (const stop of this.considerTransfers(
        options,
        round,
        markedStops,
        state,
      )) {
        markedStops.add(stop);
      }

      if (markedStops.size === 0) break;
    }
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
      for (const trip of continuousTrips) {
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
   * @param shared Optional shared state for Range RAPTOR mode
   */
  private scanRouteContinuation(
    route: Route,
    hopOnStopIndex: StopRouteIndex,
    round: Round,
    state: IRaptorState,
    tripContinuation: TripContinuation,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    const edgesAtCurrentRound = state.graph[round]!;

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

      if (
        dropOffType !== NOT_AVAILABLE &&
        arrivalTime < state.improvementBound(round, currentStop) &&
        arrivalTime < state.destinationBest
      ) {
        edgesAtCurrentRound[currentStop] = {
          routeId,
          stopIndex: hopOnStopIndex,
          tripIndex,
          arrival: arrivalTime,
          hopOffStopIndex: currentStopIndex,
          continuationOf: previousEdge,
        };
        state.updateArrival(currentStop, arrivalTime, round);
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
   * @param state Current routing state
   * @param options Query options (minTransferTime, etc.)
   */
  private scanRoute(
    route: Route,
    hopOnStopIndex: StopRouteIndex,
    round: Round,
    state: IRaptorState,
    options: QueryOptions,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    const edgesAtCurrentRound = state.graph[round]!;
    const edgesAtPreviousRound = state.graph[round - 1]!;

    const nbStops = route.getNbStops();
    const routeId = route.id;
    let activeTripIndex: TripRouteIndex | undefined;
    let activeTripBoardStopIndex = hopOnStopIndex;
    // tripStopOffset = activeTripIndex * nbStops, precomputed when the trip changes.
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

        if (
          dropOffType !== NOT_AVAILABLE &&
          arrivalTime < state.improvementBound(round, currentStop) &&
          arrivalTime < state.destinationBest
        ) {
          edgesAtCurrentRound[currentStop] = {
            routeId,
            stopIndex: activeTripBoardStopIndex,
            tripIndex: activeTripIndex,
            arrival: arrivalTime,
            hopOffStopIndex: currentStopIndex,
          };
          state.updateArrival(currentStop, arrivalTime, round);
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
            route.departureAtOffset(currentStopIndex, activeTripStopOffset))
      ) {
        const earliestTrip = route.findEarliestTrip(
          currentStopIndex,
          earliestArrivalOnPreviousRound,
          activeTripIndex,
        );
        if (earliestTrip === undefined) {
          continue;
        }

        const fromTripStop =
          previousEdge && 'routeId' in previousEdge
            ? {
                stopIndex: previousEdge.hopOffStopIndex,
                routeId: previousEdge.routeId,
                tripIndex: previousEdge.tripIndex,
              }
            : undefined;
        const firstBoardableTrip = this.timetable.findFirstBoardableTrip(
          currentStopIndex,
          route,
          earliestTrip,
          earliestArrivalOnPreviousRound,
          activeTripIndex,
          fromTripStop,
          options.minTransferTime,
        );

        if (firstBoardableTrip !== undefined) {
          // At round 1, enforce maxInitialWaitingTime: skip boarding if the
          // traveler would have to wait longer than the allowed threshold at
          // the first boarding stop.
          const exceedsInitialWait =
            round === 1 &&
            options.maxInitialWaitingTime !== undefined &&
            route.departureFrom(currentStopIndex, firstBoardableTrip) -
              earliestArrivalOnPreviousRound >
              options.maxInitialWaitingTime;

          if (!exceedsInitialWait) {
            activeTripIndex = firstBoardableTrip;
            activeTripBoardStopIndex = currentStopIndex;
            activeTripStopOffset = route.tripStopOffset(firstBoardableTrip);
          }
        }
      }
    }
    return newlyMarkedStops;
  }

  /**
   * Processes all currently marked stops to find available transfers
   * and determines if using these transfers would result in earlier arrival times
   * at destination stops. It handles different transfer types including in-seat
   * transfers and walking transfers with appropriate minimum transfer times.
   *
   * @param options  Query options (minTransferTime, etc.)
   * @param round The current round number in the RAPTOR algorithm
   * @param markedStops The set of currently marked stops
   * @param state Current routing state
   */
  private considerTransfers(
    options: QueryOptions,
    round: number,
    markedStops: Set<StopId>,
    state: IRaptorState,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    const arrivalsAtCurrentRound = state.graph[round]!;
    for (const stop of markedStops) {
      const currentArrival = arrivalsAtCurrentRound[stop];
      // Skip transfers if the last leg was also a transfer
      if (!currentArrival || 'type' in currentArrival) continue;
      const transfers = this.timetable.getTransfers(stop);
      for (const transfer of transfers) {
        let transferTime: Duration;
        if (transfer.minTransferTime) {
          transferTime = transfer.minTransferTime;
        } else if (transfer.type === 'IN_SEAT') {
          transferTime = DURATION_ZERO;
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer = currentArrival.arrival + transferTime;

        if (
          arrivalAfterTransfer <
            state.improvementBound(round, transfer.destination) &&
          arrivalAfterTransfer < state.destinationBest
        ) {
          arrivalsAtCurrentRound[transfer.destination] = {
            arrival: arrivalAfterTransfer,
            from: stop,
            to: transfer.destination,
            minTransferTime: transferTime || undefined,
            type: transfer.type,
          } as TransferEdge;
          state.updateArrival(
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
}
