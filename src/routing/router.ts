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
import {
  Timetable,
  TransferType,
  TripBoarding,
} from '../timetable/timetable.js';
import { Query } from './query.js';
import { Result } from './result.js';

const UNREACHED = Time.infinity();

export type OriginNode = { arrival: Time };

export type VehicleEdge = {
  arrival: Time;
  from: StopRouteIndex;
  to: StopRouteIndex;
  routeId: RouteId;
  tripIndex: TripRouteIndex;
  continuationOf?: VehicleEdge;
};
export type TransferEdge = {
  arrival: Time;
  from: StopId;
  to: StopId;
  type: TransferType;
  minTransferTime?: Duration;
};
export type RoutingEdge = OriginNode | VehicleEdge | TransferEdge;

type TripContinuation = TripBoarding & {
  previousEdge: VehicleEdge;
};

export type Arrival = {
  arrival: Time;
  legNumber: number;
};

type Round = number;

export type RoutingState = {
  earliestArrivals: Map<StopId, Arrival>;
  graph: Map<StopId, RoutingEdge>[];
  destinations: StopId[];
};

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
    const markedStops = new Set<StopId>();
    for (const originStop of routingState.graph[0]!.keys()) {
      markedStops.add(originStop);
    }
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
      const edgesAtCurrentRound = new Map<StopId, RoutingEdge>();
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
            continuation.hopOnStopIndex,
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
   * @param edgesAtCurrentRound The map of edges at the current round.
   * @returns An array of trip continuations.
   */
  private findTripContinuations(
    markedStops: Set<StopId>,
    edgesAtCurrentRound: Map<StopId, RoutingEdge>,
  ): TripContinuation[] {
    const continuations: TripContinuation[] = [];
    for (const stopId of markedStops) {
      const arrival = edgesAtCurrentRound.get(stopId);
      if (!arrival || !('routeId' in arrival)) continue;

      const continuousTrips = this.timetable.getContinuousTrips(
        arrival.to,
        arrival.routeId,
        arrival.tripIndex,
      );
      for (let i = 0; i < continuousTrips.length; i++) {
        const trip = continuousTrips[i]!;
        continuations.push({
          routeId: trip.routeId,
          hopOnStopIndex: trip.hopOnStopIndex,
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

    const earliestArrivals = new Map<StopId, Arrival>();
    const earliestArrivalsWithoutAnyLeg = new Map<StopId, RoutingEdge>();
    const earliestArrivalsPerRound = [earliestArrivalsWithoutAnyLeg];

    const initialState = {
      arrival: departureTime,
      legNumber: 0,
    };
    for (const originStop of origins) {
      earliestArrivals.set(originStop, initialState);
      earliestArrivalsWithoutAnyLeg.set(originStop, initialState);
    }
    return {
      destinations,
      earliestArrivals,
      graph: earliestArrivalsPerRound,
    };
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
    tripContinuation?: TripContinuation,
  ): Set<StopId> {
    const newlyMarkedStops = new Set<StopId>();
    let activeTrip: TripBoarding | undefined = tripContinuation
      ? {
          routeId: route.id,
          hopOnStopIndex,
          tripIndex: tripContinuation.tripIndex,
        }
      : undefined;
    const edgesAtCurrentRound = routingState.graph[round]!;
    const edgesAtPreviousRound = routingState.graph[round - 1]!;
    // Compute target pruning criteria only once per route
    const earliestArrivalAtAnyDestination = this.earliestArrivalAtAnyStop(
      routingState.earliestArrivals,
      routingState.destinations,
    );
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
          routingState.earliestArrivals.get(currentStop)?.arrival ?? UNREACHED;
        if (
          dropOffType !== 'NOT_AVAILABLE' &&
          arrivalTime.isBefore(earliestArrivalAtCurrentStop) &&
          arrivalTime.isBefore(earliestArrivalAtAnyDestination)
        ) {
          const edge = {
            arrival: arrivalTime,
            routeId: route.id,
            tripIndex: activeTrip.tripIndex,
            from: activeTrip.hopOnStopIndex,
            to: currentStopIndex,
          } as VehicleEdge;
          if (tripContinuation) {
            // In case of continuous trip, we set a pointer to the previous edge
            edge.continuationOf = tripContinuation.previousEdge;
          }
          edgesAtCurrentRound.set(currentStop, edge);

          routingState.earliestArrivals.set(currentStop, {
            arrival: arrivalTime,
            legNumber: round,
          });
          newlyMarkedStops.add(currentStop);
        }
      }
      if (tripContinuation) {
        // If it's a trip continuation, no need to check for earlier trips
        continue;
      }
      // check if we can board an earlier trip at the current stop
      // if there was no current trip, find the first one reachable
      const earliestArrivalOnPreviousRound =
        edgesAtPreviousRound.get(currentStop)?.arrival;
      // TODO if the last edge is not a transfer, and if there is no trip continuation of type 1 (guaranteed)
      // Add the minTransferTime to make sure there's at least 2 minutes to transfer.
      // If platforms are collapsed, make sure to apply the station level transfer time
      // (or later at route reconstruction time)
      if (
        earliestArrivalOnPreviousRound !== undefined &&
        (activeTrip === undefined ||
          earliestArrivalOnPreviousRound.isBefore(
            route.departureFrom(currentStopIndex, activeTrip.tripIndex),
          ) ||
          earliestArrivalOnPreviousRound.equals(
            route.departureFrom(currentStopIndex, activeTrip.tripIndex),
          ))
      ) {
        const earliestTrip = route.findEarliestTrip(
          currentStopIndex,
          earliestArrivalOnPreviousRound,
          activeTrip?.tripIndex,
        );
        if (earliestTrip !== undefined) {
          activeTrip = {
            routeId: route.id,
            tripIndex: earliestTrip,
            hopOnStopIndex: currentStopIndex,
          };
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
      const currentArrival = arrivalsAtCurrentRound.get(stop);
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
          transferTime = Duration.zero();
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer = currentArrival.arrival.plus(transferTime);
        const originalArrival =
          routingState.earliestArrivals.get(transfer.destination)?.arrival ??
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
    return newlyMarkedStops;
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
