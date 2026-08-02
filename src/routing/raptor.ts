/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import {
  PickUpDropOffTypes,
  Route,
  StopRouteIndex,
  TripRouteIndex,
} from '../timetable/route.js';
import { Duration, DURATION_ZERO, Time } from '../timetable/time.js';
import {
  QualifiedTripTransferDestination,
  QualifiedTripTransferOrigin,
  Timetable,
  TransferTypes,
  TripStop,
} from '../timetable/timetable.js';
import { QueryOptions } from './query.js';
import {
  BoardingTransferEdge,
  RoutingEdge,
  TransferEdge,
  VehicleEdge,
} from './state.js';

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
  previousEdge: VehicleEdge;
};

type QualifiedTransferBoarding = QualifiedTripTransferDestination & {
  previousEdge: VehicleEdge;
  fromStop: StopId;
  toStop: StopId;
};

type QualifiedTransferScanResult = {
  markedStops: Set<StopId>;
  nextBoardings: QualifiedTransferBoarding[];
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
    let pendingQualifiedBoardings = new Map<
      string,
      QualifiedTransferBoarding
    >();

    for (let round = 1; round <= options.maxTransfers + 1; round++) {
      state.initRound(round);

      const edgesAtCurrentRound = state.graph[round]!;
      const qualifiedTransferBoardings = Array.from(
        pendingQualifiedBoardings.values(),
      );
      pendingQualifiedBoardings = new Map();
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
        this.enqueueQualifiedBoardings(
          pendingQualifiedBoardings,
          this.findQualifiedTransfersFromRoute(route, round, state, options),
        );
      }

      for (const boarding of qualifiedTransferBoardings) {
        const route = this.timetable.getRoute(boarding.routeId);
        if (!route) continue;
        const serviceRoute = this.timetable.getServiceRouteInfo(route);
        if (!options.transportModes.has(serviceRoute.type)) continue;
        const scanResult = this.scanQualifiedTransfer(
          route,
          round,
          state,
          options,
          boarding,
        );
        for (const stop of scanResult.markedStops) {
          markedStops.add(stop);
        }
        this.enqueueQualifiedBoardings(
          pendingQualifiedBoardings,
          scanResult.nextBoardings,
        );
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
          const scanResult = this.scanRouteContinuation(
            route,
            continuation.stopIndex,
            round,
            state,
            continuation,
          );
          for (const stop of scanResult.markedStops) {
            stopsFromContinuations.add(stop);
            markedStops.add(stop);
          }
          this.enqueueQualifiedBoardings(
            pendingQualifiedBoardings,
            scanResult.nextBoardings,
          );
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

      if (markedStops.size === 0 && pendingQualifiedBoardings.size === 0) break;
    }
  }

  /**
   * Evaluates the sparse set of trips on a reachable route that own qualified
   * transfers. These trips are checked independently of stop-label dominance.
   */
  private findQualifiedTransfersFromRoute(
    route: Route,
    round: Round,
    state: IRaptorState,
    options: QueryOptions,
  ): QualifiedTransferBoarding[] {
    const boardings: QualifiedTransferBoarding[] = [];
    const edgesAtPreviousRound = state.graph[round - 1]!;

    for (const origin of this.timetable.getQualifiedTripTransferOrigins(
      route.id,
    )) {
      if (
        route.dropOffTypeAt(origin.stopIndex, origin.tripIndex) ===
        PickUpDropOffTypes.NOT_AVAILABLE
      ) {
        continue;
      }
      const sourceArrival = route.arrivalAt(origin.stopIndex, origin.tripIndex);
      if (sourceArrival > state.maxArrivalTime) continue;

      for (
        let boardStopIndex = 0;
        boardStopIndex < origin.stopIndex;
        boardStopIndex++
      ) {
        const boardStop = route.stops[boardStopIndex]!;
        const previousEdge = edgesAtPreviousRound[boardStop];
        if (!previousEdge) continue;
        const fromTripStop =
          'routeId' in previousEdge
            ? {
                stopIndex: previousEdge.hopOffStopIndex,
                routeId: previousEdge.routeId,
                tripIndex: previousEdge.tripIndex,
              }
            : undefined;
        const departure = route.departureFrom(boardStopIndex, origin.tripIndex);
        if (fromTripStop === undefined && departure < previousEdge.arrival) {
          continue;
        }
        const boardableTrip = this.timetable.findFirstBoardableTrip(
          boardStopIndex,
          route,
          origin.tripIndex,
          previousEdge.arrival,
          origin.tripIndex + 1,
          fromTripStop,
          options.minTransferTime,
        );
        if (boardableTrip !== origin.tripIndex) continue;

        const exceedsInitialWait =
          round === 1 &&
          options.maxInitialWaitingTime !== undefined &&
          departure - previousEdge.arrival > options.maxInitialWaitingTime;
        if (exceedsInitialWait || departure > state.maxArrivalTime) continue;

        const sourceEdge: VehicleEdge = {
          routeId: route.id,
          stopIndex: boardStopIndex,
          tripIndex: origin.tripIndex,
          arrival: sourceArrival,
          hopOffStopIndex: origin.stopIndex,
        };
        boardings.push(
          ...this.createQualifiedTransferBoardings(sourceEdge, origin),
        );
        break;
      }
    }

    return boardings;
  }

  /**
   * Scans the exact destination trip of a qualified transfer, delegating the
   * guarantee and minimum-time decision to findFirstBoardableTrip.
   */
  private scanQualifiedTransfer(
    route: Route,
    round: Round,
    state: IRaptorState,
    options: QueryOptions,
    boarding: QualifiedTransferBoarding,
  ): QualifiedTransferScanResult {
    const newlyMarkedStops = new Set<StopId>();
    const nextBoardings: QualifiedTransferBoarding[] = [];
    const tripIndex = this.timetable.findFirstBoardableTrip(
      boarding.stopIndex,
      route,
      boarding.tripIndex,
      boarding.previousEdge.arrival,
      boarding.tripIndex + 1,
      {
        stopIndex: boarding.previousEdge.hopOffStopIndex,
        routeId: boarding.previousEdge.routeId,
        tripIndex: boarding.previousEdge.tripIndex,
      },
      options.minTransferTime,
    );
    if (tripIndex !== boarding.tripIndex) {
      return { markedStops: newlyMarkedStops, nextBoardings };
    }

    const departure = route.departureFrom(boarding.stopIndex, tripIndex);
    if (departure > state.maxArrivalTime) {
      return { markedStops: newlyMarkedStops, nextBoardings };
    }

    const effectiveTransferTime =
      boarding.type === TransferTypes.GUARANTEED
        ? DURATION_ZERO
        : (boarding.minTransferTime ?? options.minTransferTime);
    const boardingTransfer: BoardingTransferEdge = {
      arrival: boarding.previousEdge.arrival + effectiveTransferTime,
      from: boarding.fromStop,
      to: boarding.toStop,
      type: boarding.type,
      previousEdge: boarding.previousEdge,
      ...(effectiveTransferTime !== DURATION_ZERO && {
        minTransferTime: effectiveTransferTime,
      }),
    };
    const edgesAtCurrentRound = state.graph[round]!;
    const tripStopOffset = route.tripStopOffset(tripIndex);

    for (
      let currentStopIndex = boarding.stopIndex + 1;
      currentStopIndex < route.getNbStops();
      currentStopIndex++
    ) {
      const currentStop = route.stops[currentStopIndex]!;
      const arrivalTime = route.arrivalAtOffset(
        currentStopIndex,
        tripStopOffset,
      );
      const dropOffType = route.dropOffTypeAtOffset(
        currentStopIndex,
        tripStopOffset,
      );
      if (
        dropOffType === PickUpDropOffTypes.NOT_AVAILABLE ||
        arrivalTime > state.maxArrivalTime
      ) {
        continue;
      }

      const sourceEdge: VehicleEdge = {
        routeId: route.id,
        stopIndex: boarding.stopIndex,
        tripIndex,
        arrival: arrivalTime,
        hopOffStopIndex: currentStopIndex,
        boardingTransfer,
      };
      const destinations = this.timetable.getQualifiedTripTransfers(
        currentStopIndex,
        route.id,
        tripIndex,
      );
      if (destinations.length > 0) {
        nextBoardings.push(
          ...this.createQualifiedTransferBoardings(sourceEdge, {
            routeId: route.id,
            tripIndex,
            stopIndex: currentStopIndex,
            destinations,
          }),
        );
      }

      if (
        arrivalTime < state.improvementBound(round, currentStop) &&
        arrivalTime < state.destinationBest
      ) {
        edgesAtCurrentRound[currentStop] = sourceEdge;
        state.updateArrival(currentStop, arrivalTime, round);
        newlyMarkedStops.add(currentStop);
      }
    }

    return { markedStops: newlyMarkedStops, nextBoardings };
  }

  private createQualifiedTransferBoardings(
    previousEdge: VehicleEdge,
    origin: QualifiedTripTransferOrigin,
  ): QualifiedTransferBoarding[] {
    const fromRoute = this.timetable.getRoute(previousEdge.routeId);
    if (!fromRoute) return [];
    const boardings: QualifiedTransferBoarding[] = [];

    for (const destination of origin.destinations) {
      const toRoute = this.timetable.getRoute(destination.routeId);
      if (!toRoute) continue;
      boardings.push({
        ...destination,
        previousEdge,
        fromStop: fromRoute.stopId(previousEdge.hopOffStopIndex),
        toStop: toRoute.stopId(destination.stopIndex),
      });
    }
    return boardings;
  }

  private enqueueQualifiedBoardings(
    target: Map<string, QualifiedTransferBoarding>,
    boardings: QualifiedTransferBoarding[],
  ): void {
    for (const boarding of boardings) {
      const source = boarding.previousEdge;
      const key = `${source.hopOffStopIndex}:${source.routeId}:${source.tripIndex}>${boarding.stopIndex}:${boarding.routeId}:${boarding.tripIndex}`;
      if (!target.has(key)) target.set(key, boarding);
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
  ): QualifiedTransferScanResult {
    const newlyMarkedStops = new Set<StopId>();
    const nextBoardings: QualifiedTransferBoarding[] = [];
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
        currentStopIndex > hopOnStopIndex &&
        dropOffType !== PickUpDropOffTypes.NOT_AVAILABLE &&
        arrivalTime <= state.maxArrivalTime
      ) {
        const destinations = this.timetable.getQualifiedTripTransfers(
          currentStopIndex,
          route.id,
          tripIndex,
        );
        if (destinations.length > 0) {
          const sourceEdge: VehicleEdge = {
            routeId,
            stopIndex: hopOnStopIndex,
            tripIndex,
            arrival: arrivalTime,
            hopOffStopIndex: currentStopIndex,
            continuationOf: previousEdge,
          };
          nextBoardings.push(
            ...this.createQualifiedTransferBoardings(sourceEdge, {
              routeId,
              tripIndex,
              stopIndex: currentStopIndex,
              destinations,
            }),
          );
        }
      }

      if (
        dropOffType !== PickUpDropOffTypes.NOT_AVAILABLE &&
        arrivalTime <= state.maxArrivalTime &&
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
    return { markedStops: newlyMarkedStops, nextBoardings };
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
          dropOffType !== PickUpDropOffTypes.NOT_AVAILABLE &&
          arrivalTime <= state.maxArrivalTime &&
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
   * at destination stops.
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
        } else if (transfer.type === TransferTypes.IN_SEAT) {
          transferTime = DURATION_ZERO;
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer = currentArrival.arrival + transferTime;

        if (
          arrivalAfterTransfer <= state.maxArrivalTime &&
          arrivalAfterTransfer <
            state.improvementBound(round, transfer.destination) &&
          arrivalAfterTransfer < state.destinationBest
        ) {
          arrivalsAtCurrentRound[transfer.destination] = {
            arrival: arrivalAfterTransfer,
            from: stop,
            to: transfer.destination, // TODO needed?
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
