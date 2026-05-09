/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import {
  PickUpDropOffTypes,
  Route,
  StopRouteIndex,
  TripRouteIndex,
} from '../timetable/route.js';
import { Duration, DURATION_ZERO, Time } from '../timetable/time.js';
import { Timetable, TransferTypes, TripStop } from '../timetable/timetable.js';
import { DenseRoutingGraph, EdgeKinds, NO_CELL } from './graph.js';
import { QueryOptions } from './query.js';

/**
 * Common interface for all variants of RAPTOR routing.
 */
export interface IRaptorState {
  /** Origin stop IDs for this run. */
  readonly origins: StopId[];

  /** Per-round routing graph; `graph.cell(round, stop)` is the best edge used to reach `stop`. */
  readonly graph: DenseRoutingGraph;

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

  /** Latest arrival time allowed by the current query/run. */
  readonly maxArrivalTime: Time;

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
  previousCell: number;
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

      const currentRoundOffset = state.graph.roundOffset(round);
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
        currentRoundOffset,
        state.graph,
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
          currentRoundOffset,
          state.graph,
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
   * Finds trip continuations for the given marked stops and current-round graph cells.
   * @param markedStops The set of marked stops.
   * @param currentRoundOffset Offset of the current round in the flattened graph.
   * @param graph The typed state graph.
   * @returns An array of trip continuations.
   */
  private findTripContinuations(
    markedStops: Set<StopId>,
    currentRoundOffset: number,
    graph: DenseRoutingGraph,
  ): TripContinuation[] {
    const continuations: TripContinuation[] = [];
    for (const stopId of markedStops) {
      const cell = currentRoundOffset + stopId;
      if (!graph.isVehicleCell(cell)) continue;

      const continuousTrips = this.timetable.getContinuousTrips(
        graph.vehicleHopOffStopIndexAtCell(cell),
        graph.vehicleRouteIdAtCell(cell),
        graph.vehicleTripIndexAtCell(cell),
      );
      for (const trip of continuousTrips) {
        continuations.push({
          routeId: trip.routeId,
          stopIndex: trip.stopIndex,
          tripIndex: trip.tripIndex,
          previousCell: cell,
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
    const graph = state.graph;

    const nbStops = route.getNbStops();
    const routeId = route.id;
    const tripIndex = tripContinuation.tripIndex;
    const tripStopOffset = route.tripStopOffset(tripIndex);
    const previousCell = tripContinuation.previousCell;

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
        dropOffType !== PickUpDropOffTypes.NOT_AVAILABLE &&
        arrivalTime <= state.maxArrivalTime &&
        arrivalTime < state.improvementBound(round, currentStop) &&
        arrivalTime < state.destinationBest
      ) {
        graph.setVehicleContinuation(
          round,
          currentStop,
          arrivalTime,
          routeId,
          hopOnStopIndex,
          tripIndex,
          currentStopIndex,
          previousCell,
        );
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
    const graph = state.graph;
    const previousRoundOffset = graph.roundOffset(round - 1);

    const nbStops = route.getNbStops();
    const routeId = route.id;
    let activeTripIndex: TripRouteIndex | undefined;
    let activeTripBoardStopIndex = hopOnStopIndex;
    let activeTripPrevCell = NO_CELL;
    // tripStopOffset = activeTripIndex * nbStops, precomputed when the trip changes.
    let activeTripStopOffset = 0;

    for (
      let currentStopIndex = hopOnStopIndex;
      currentStopIndex < nbStops;
      currentStopIndex++
    ) {
      const currentStop: StopId = route.stops[currentStopIndex]!;
      const previousCell = previousRoundOffset + currentStop;

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
          dropOffType !== PickUpDropOffTypes.NOT_AVAILABLE &&
          arrivalTime <= state.maxArrivalTime &&
          arrivalTime < state.improvementBound(round, currentStop) &&
          arrivalTime < state.destinationBest
        ) {
          graph.setVehicle(
            round,
            currentStop,
            arrivalTime,
            routeId,
            activeTripBoardStopIndex,
            activeTripIndex,
            currentStopIndex,
            activeTripPrevCell,
          );
          state.updateArrival(currentStop, arrivalTime, round);
          newlyMarkedStops.add(currentStop);
        }
      }

      // Check whether we can board an earlier (or first) trip at this stop.
      const previousKind = graph.kindAtCellUnchecked(previousCell);
      const earliestArrivalOnPreviousRound = graph.arrivalAtCell(previousCell);
      if (
        previousKind !== EdgeKinds.NONE &&
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

        const fromTripStop = graph.vehicleTripAtCell(previousCell);
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
          const departureTime = route.departureFrom(
            currentStopIndex,
            firstBoardableTrip,
          );
          // At round 1, enforce maxInitialWaitingTime: skip boarding if the
          // traveler would have to wait longer than the allowed threshold at
          // the first boarding stop.
          const exceedsInitialWait =
            round === 1 &&
            options.maxInitialWaitingTime !== undefined &&
            departureTime - earliestArrivalOnPreviousRound >
              options.maxInitialWaitingTime;
          const exceedsMaxDuration = departureTime > state.maxArrivalTime;

          if (!exceedsInitialWait && !exceedsMaxDuration) {
            activeTripIndex = firstBoardableTrip;
            activeTripBoardStopIndex = currentStopIndex;
            activeTripPrevCell = previousCell;
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
    const graph = state.graph;
    const currentRoundOffset = graph.roundOffset(round);
    for (const stop of markedStops) {
      const currentCell = currentRoundOffset + stop;
      // Skip transfers if the last leg was also a transfer
      if (
        !graph.hasCellUnchecked(currentCell) ||
        graph.isTransferCell(currentCell)
      )
        continue;
      const transferIds = this.timetable.getTransferIds(stop);
      for (let i = 0; i < transferIds.length; i++) {
        const transferId = transferIds[i]!;
        const transfer = this.timetable.getTransfer(transferId);
        if (transfer === undefined) continue;
        let transferTime: Duration;
        if (transfer.minTransferTime) {
          transferTime = transfer.minTransferTime;
        } else if (transfer.type === TransferTypes.IN_SEAT) {
          transferTime = DURATION_ZERO;
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer =
          graph.arrivalAtCell(currentCell) + transferTime;

        if (
          arrivalAfterTransfer <= state.maxArrivalTime &&
          arrivalAfterTransfer <
            state.improvementBound(round, transfer.destination) &&
          arrivalAfterTransfer < state.destinationBest
        ) {
          graph.setTransfer(
            round,
            transfer.destination,
            arrivalAfterTransfer,
            transferId,
            currentCell,
          );
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
