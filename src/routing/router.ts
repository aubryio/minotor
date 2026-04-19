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
import { Query, QueryOptions, RangeQuery } from './query.js';
import { ParetoRun, RangeResult } from './rangeResult.js';
import { RangeRaptorSharedState } from './rangeState.js';
import { Result } from './result.js';
import {
  RoutingEdge,
  RoutingState,
  TransferEdge,
  UNREACHED_TIME,
  VehicleEdge,
} from './state.js';

export type { ParetoRun } from './rangeResult.js';
export { RangeResult } from './rangeResult.js';
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
 * A public transportation router implementing the RAPTOR and Range RAPTOR
 * algorithms.
 *
 * - `route(query)` — standard RAPTOR: finds the earliest-arrival journey for
 *   a single departure time.
 * - `rangeRoute(query)` — Range RAPTOR: finds all Pareto-optimal journeys
 *   within a departure-time window, sharing round-specific labels across
 *   iterations to avoid redundant work.
 *
 * @see https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
export class Router {
  private readonly timetable: Timetable;
  private readonly stopsIndex: StopsIndex;

  constructor(timetable: Timetable, stopsIndex: StopsIndex) {
    this.timetable = timetable;
    this.stopsIndex = stopsIndex;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Standard RAPTOR: finds the earliest-arrival journey from `query.from` to
   * `query.to` for the given departure time.
   *
   * @param query The routing query.
   * @returns A {@link Result} that can reconstruct the best route and arrival times.
   */
  route(query: Query): Result {
    const routingState = this.initRoutingState(query);
    this.runRaptor(query, routingState);
    return new Result(query, routingState, this.stopsIndex, this.timetable);
  }

  /**
   * Range RAPTOR: finds all Pareto-optimal journeys within the departure-time
   * window `[query.departureTime, query.lastDepartureTime]`.
   *
   * Requires a {@link RangeQuery} — a {@link Query} whose `lastDepartureTime`
   * is guaranteed to be set.  Build one with the query builder and narrow it
   * via {@link isRangeQuery} or a one-time `as RangeQuery` cast:
   *
   * ```ts
   * const q = new Query.Builder()
   *   .from(stop).to(dest)
   *   .departureTime(earliest)
   *   .lastDepartureTime(latest)
   *   .build() as RangeQuery;
   *
   * const result = router.rangeRoute(q);
   * result.paretoOptimalRoutes();
   * ```
   *
   * Iterations run from the **latest** departure to the **earliest**, sharing
   * round-specific arrival-time labels (`τk(p)`) across iterations.  Each
   * label τk(p) carries the best known arrival at stop `p` using at most `k`
   * transit legs from any departure time tried so far, providing tight pruning
   * for subsequent (earlier) iterations without reinitialising the state.
   *
   * A journey is Pareto-optimal iff no journey departing no earlier arrives no
   * later.  Runs are ordered latest-departure-first in the returned result.
   *
   * @param query A {@link RangeQuery} with both `departureTime` and `lastDepartureTime` set.
   * @returns A {@link RangeResult} exposing the full Pareto frontier.
   */
  rangeRoute(query: RangeQuery): RangeResult {
    const { departureTime: earliest, lastDepartureTime: latest } = query;

    // Origin stops (equivalents of query.from).
    const originStops = this.stopsIndex
      .equivalentStops(query.from)
      .map((s) => s.id);

    // Widen to stops reachable by an initial walk so we don't miss trips that
    // depart from a nearby stop within the window.
    const boardingStops = this.collectBoardingStops(originStops);

    // All actual trip departure times in [earliest, latest], latest-first.
    // Iterating over real trip times (not every minute) keeps the outer loop
    // tight: at most one RAPTOR run per distinct departure time.
    const departureTimes = this.collectDepartureTimes(
      boardingStops,
      earliest,
      latest,
    );
    if (departureTimes.length === 0) return new RangeResult([], query);

    const maxRounds = query.options.maxTransfers + 1;

    // Shared τk(p) labels — the core of Range RAPTOR.
    // Never reset between iterations; only improved (lowered) in place.
    const shared = new RangeRaptorSharedState(
      maxRounds,
      this.timetable.nbStops(),
    );

    const paretoRuns: ParetoRun[] = [];
    // Tracks the best destination arrival that justified adding a run to the
    // Pareto front.  A new run is Pareto-optimal iff it strictly beats this.
    let paretoDestBest: Time = UNREACHED_TIME;

    for (const depTime of departureTimes) {
      // Per-run query: same options, different departure time.
      const runQuery = new Query.Builder()
        .from(query.from)
        .to(query.to)
        .departureTime(depTime)
        .maxTransfers(query.options.maxTransfers)
        .minTransferTime(query.options.minTransferTime)
        .transportModes(query.options.transportModes)
        .build();

      // Fresh edge graph for journey reconstruction.
      // The shared labels provide cross-run pruning; this graph records which
      // specific trips and transfers were used in *this* run.
      const routingState = this.initRoutingState(runQuery);

      // Seed the shared round-0 labels with this run's departure time.
      // Since we iterate latest→earliest, depTime is ≤ any previously seen
      // departure, so tryImprove always succeeds (or is a harmless no-op for
      // a repeated time).
      for (const origin of routingState.origins) {
        shared.tryImprove(0, origin, depTime);
        // Edge case: origin is also a destination (from = to).
        if (routingState.isDestination(origin)) {
          shared.improveDestinationBest(depTime);
        }
      }

      this.runRaptor(runQuery, routingState, shared);

      // A run is Pareto-optimal iff it found a strictly better destination
      // arrival than any run with a later departure time.
      const runDestBest = this.earliestArrivalAtAnyStop(routingState);
      if (runDestBest < paretoDestBest) {
        paretoDestBest = runDestBest;
        paretoRuns.push({
          departureTime: depTime,
          result: new Result(
            runQuery,
            routingState,
            this.stopsIndex,
            this.timetable,
          ),
        });
      }
    }

    return new RangeResult(paretoRuns, query);
  }

  // ---------------------------------------------------------------------------
  // Core algorithm
  // ---------------------------------------------------------------------------

  /**
   * Executes the RAPTOR algorithm for a single departure time.
   *
   * When `shared` is provided (Range RAPTOR mode), the improvement guards in
   * all scan methods use `shared.get(round, stop)` — the round-specific label
   * that carries over from previous departure-time iterations — instead of the
   * local global minimum `τ*(p)`.  This is the key correctness requirement
   * from the Range RAPTOR paper: using `τ*(p)` would incorrectly prevent a
   * round from setting its own label, breaking the boarding logic for later
   * rounds.
   *
   * @param query        The routing query for this run.
   * @param routingState Fresh per-run state (edge graph for reconstruction).
   * @param shared       Optional shared state for Range RAPTOR mode.
   */
  private runRaptor(
    query: Query,
    routingState: RoutingState,
    shared?: RangeRaptorSharedState,
  ): void {
    const markedStops = new Set<StopId>(routingState.origins);

    // Initial walk transfers from origins (round 0).
    const newlyMarkedAfterWalk = this.considerTransfers(
      query,
      0,
      markedStops,
      routingState,
      shared,
    );
    for (const stop of newlyMarkedAfterWalk) {
      markedStops.add(stop);
    }

    for (let round = 1; round <= query.options.maxTransfers + 1; round++) {
      // Range RAPTOR: propagate the best labels from round k-1 into round k
      // before scanning routes.  This ensures the improvement guard for round
      // k accounts for stops reachable with fewer legs from any earlier run.
      shared?.initRound(round);

      const edgesAtCurrentRound: (RoutingEdge | undefined)[] = new Array<
        RoutingEdge | undefined
      >(routingState.nbStops);
      routingState.graph.push(edgesAtCurrentRound);

      const reachableRoutes = this.timetable.findReachableRoutes(
        markedStops,
        query.options.transportModes,
      );
      markedStops.clear();

      for (const [route, hopOnStopIndex] of reachableRoutes) {
        const newlyMarked = this.scanRoute(
          route,
          hopOnStopIndex,
          round,
          routingState,
          query.options,
          shared,
        );
        for (const stop of newlyMarked) {
          markedStops.add(stop);
        }
      }

      // Process in-seat trip continuations.
      let continuations = this.findTripContinuations(
        markedStops,
        edgesAtCurrentRound,
      );
      const stopsFromContinuations = new Set<StopId>();
      while (continuations.length > 0) {
        stopsFromContinuations.clear();
        for (const continuation of continuations) {
          const route = this.timetable.getRoute(continuation.routeId)!;
          const results = this.scanRouteContinuation(
            route,
            continuation.stopIndex,
            round,
            routingState,
            continuation,
            shared,
          );
          for (const stop of results) {
            stopsFromContinuations.add(stop);
          }
        }
        for (const stop of stopsFromContinuations) {
          markedStops.add(stop);
        }
        continuations = this.findTripContinuations(
          stopsFromContinuations,
          edgesAtCurrentRound,
        );
      }

      const newlyMarkedAfterTransfers = this.considerTransfers(
        query,
        round,
        markedStops,
        routingState,
        shared,
      );
      for (const stop of newlyMarkedAfterTransfers) {
        markedStops.add(stop);
      }

      if (markedStops.size === 0) break;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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
   * @param shared Optional shared state for Range RAPTOR mode
   */
  private scanRouteContinuation(
    route: Route,
    hopOnStopIndex: StopRouteIndex,
    round: Round,
    routingState: RoutingState,
    tripContinuation: TripContinuation,
    shared?: RangeRaptorSharedState,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    const edgesAtCurrentRound = routingState.graph[round]!;
    const earliestArrivalAtAnyDestination =
      shared?.destinationBest ?? this.earliestArrivalAtAnyStop(routingState);

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

      // In Range RAPTOR mode: compare against the round-specific shared label
      // τk(p), not the global minimum τ*(p).  Using τ*(p) would incorrectly
      // prevent this round from recording its own label (needed for round k+1
      // boarding) when a different round already has a better time.
      const improvementBound =
        shared?.get(round, currentStop) ??
        routingState.arrivalTime(currentStop);

      if (
        dropOffType !== NOT_AVAILABLE &&
        arrivalTime < improvementBound &&
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

        if (shared) {
          shared.tryImprove(round, currentStop, arrivalTime);
          if (routingState.isDestination(currentStop)) {
            shared.improveDestinationBest(arrivalTime);
          }
        }
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
   * @param shared Optional shared state for Range RAPTOR mode
   */
  private scanRoute(
    route: Route,
    hopOnStopIndex: StopRouteIndex,
    round: Round,
    routingState: RoutingState,
    options: QueryOptions,
    shared?: RangeRaptorSharedState,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    const edgesAtCurrentRound = routingState.graph[round]!;
    const edgesAtPreviousRound = routingState.graph[round - 1]!;

    // Destination pruning: skip arrivals that cannot beat the best known
    // destination time.  In Range RAPTOR mode this uses the cross-run shared
    // bound (tighter); in standard mode it uses the current-run local minimum.
    const earliestArrivalAtAnyDestination =
      shared?.destinationBest ?? this.earliestArrivalAtAnyStop(routingState);

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

        // Improvement guard: use the round-specific shared label in Range RAPTOR
        // mode (never τ*(p) = min over all rounds), or the local global minimum
        // in standard RAPTOR mode.
        const improvementBound =
          shared?.get(round, currentStop) ??
          routingState.arrivalTime(currentStop);

        if (
          dropOffType !== NOT_AVAILABLE &&
          arrivalTime < improvementBound &&
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

          if (shared) {
            shared.tryImprove(round, currentStop, arrivalTime);
            if (routingState.isDestination(currentStop)) {
              shared.improveDestinationBest(arrivalTime);
            }
          }
        }
      }

      // Check whether we can board an earlier (or first) trip at this stop.
      // The boarding check always uses the *current run's* previous-round edge,
      // never the shared label.  This is intentional: any boarding opportunity
      // that only exists via a shared label (from a previous iteration's
      // arrival at this stop) would lead to a journey dominated by that earlier
      // iteration, so skipping it is both correct and efficient.
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
   * @param markedStops The set of currently marked stops
   * @param routingState The current routing state containing arrival times and marked stops
   * @param shared Optional shared state for Range RAPTOR mode
   */
  private considerTransfers(
    query: Query,
    round: number,
    markedStops: Set<StopId>,
    routingState: RoutingState,
    shared?: RangeRaptorSharedState,
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

        // In Range RAPTOR mode, compare against the round-specific shared label
        // for this stop and round.  In standard mode, compare against the
        // current-run global minimum.
        const improvementBound =
          shared?.get(round, transfer.destination) ??
          routingState.arrivalTime(transfer.destination);

        if (arrivalAfterTransfer < improvementBound) {
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

          if (shared) {
            shared.tryImprove(
              round,
              transfer.destination,
              arrivalAfterTransfer,
            );
            if (routingState.isDestination(transfer.destination)) {
              shared.improveDestinationBest(arrivalAfterTransfer);
            }
          }
        }
      }
    }
    return newlyMarkedStops;
  }

  /**
   * Collects all actual trip departure times from the given stops within the
   * window `[from, to]` (inclusive), sorted **latest-first**.
   *
   * Enumerating real trip times (rather than every minute) keeps the Range
   * RAPTOR outer loop tight: at most one RAPTOR run per distinct departure.
   * The binary search in `Route.findEarliestTrip` makes each stop/route pair
   * O(log trips + trips_in_window).
   *
   * @param boardingStops Stops to collect departure times from.
   * @param from Earliest departure time (inclusive).
   * @param to Latest departure time (inclusive).
   */
  private collectDepartureTimes(
    boardingStops: StopId[],
    from: Time,
    to: Time,
  ): Time[] {
    const times = new Set<Time>();
    for (const stopId of boardingStops) {
      for (const route of this.timetable.routesPassingThrough(stopId)) {
        for (const stopIndex of route.stopRouteIndices(stopId)) {
          let tripIndex = route.findEarliestTrip(stopIndex, from);
          if (tripIndex === undefined) continue;
          const nbTrips = route.getNbTrips();
          while (tripIndex < nbTrips) {
            const dep = route.departureFrom(stopIndex, tripIndex);
            if (dep > to) break;
            if (route.pickUpTypeFrom(stopIndex, tripIndex) !== NOT_AVAILABLE) {
              times.add(dep);
            }
            tripIndex++;
          }
        }
      }
    }
    // Sort descending so the outer loop processes latest departures first.
    return Array.from(times).sort((a, b) => b - a);
  }

  /**
   * Returns the union of `origins` and all stops reachable from them by a
   * single walking transfer (non-IN_SEAT).
   *
   * Including walking-reachable stops in the departure-time enumeration
   * ensures we do not miss trips that depart from a stop adjacent to the
   * origin but not from the origin stop itself.
   *
   * @param origins Origin stop IDs.
   */
  private collectBoardingStops(origins: StopId[]): StopId[] {
    const stops = new Set<StopId>(origins);
    for (const origin of origins) {
      for (const transfer of this.timetable.getTransfers(origin)) {
        if (transfer.type !== 'IN_SEAT') {
          stops.add(transfer.destination);
        }
      }
    }
    return Array.from(stops);
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
