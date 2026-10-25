import { Timetable } from '../router.js';
import { SourceStopId, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Route as TimetableRoute } from '../timetable/route.js';
import { Time } from '../timetable/time.js';
import { TransferTypes } from '../timetable/timetable.js';
import { resultDestinations, resultGraph } from './resultInternals.js';
import {
  Access,
  Leg,
  Route,
  ServiceRouteInfo,
  Transfer,
  VehicleLeg,
} from './route.js';
import { Arrival, RoutingState, TransferEdge, VehicleEdge } from './router.js';
import type { RoutingResult, StopArrival } from './routingResult.js';
import { AccessEdge } from './state.js';

/**
 * A single-departure routing result.
 */
export class Result implements RoutingResult {
  readonly #routingState: RoutingState;
  public readonly stopsIndex: StopsIndex;
  public readonly timetable: Timetable;

  constructor(
    routingState: RoutingState,
    stopsIndex: StopsIndex,
    timetable: Timetable,
  ) {
    this.#routingState = routingState;
    this.stopsIndex = stopsIndex;
    this.timetable = timetable;
  }

  /** @internal Default query destinations for range result selection. */
  [resultDestinations](): readonly StopId[] {
    return this.#routingState.destinations;
  }

  /** @internal Routing graph and destination metadata for the graph plotter. */
  [resultGraph](): Pick<RoutingState, 'graph' | 'destinations'> {
    return {
      graph: this.#routingState.graph,
      destinations: this.#routingState.destinations,
    };
  }

  /**
   * Iterates over reached stops, yielding each concrete stop ID, its earliest
   * arrival time, and the number of legs taken to reach it. Unreached stops
   * are omitted. Destination pruning may limit which stops were reached.
   * @param maxTransfers Optional transfer limit within retained data; see {@link Result}.
   */
  *arrivals(maxTransfers?: number): Generator<StopArrival> {
    for (const reached of this.#routingState.arrivals()) {
      if (maxTransfers === undefined) {
        yield reached;
      } else {
        const arrival = this.concreteArrivalAt(reached.stop, maxTransfers);
        if (arrival !== undefined) yield { stop: reached.stop, ...arrival };
      }
    }
  }

  /** Looks up one concrete stop without expanding equivalent stops. */
  private concreteArrivalAt(
    stop: StopId,
    maxTransfers?: number,
  ): Arrival | undefined {
    const best = this.#routingState.getArrival(stop);
    if (
      maxTransfers === undefined ||
      (best !== undefined && best.legNumber <= maxTransfers + 1)
    ) {
      return best;
    }

    let earliest: Arrival | undefined;
    const lastRound = Math.min(
      maxTransfers + 1,
      this.#routingState.graph.length - 1,
    );
    for (let round = lastRound; round >= 0; round--) {
      const edge = this.#routingState.graph[round]?.[stop];
      if (
        edge !== undefined &&
        (earliest === undefined || edge.arrival < earliest.arrival)
      ) {
        earliest = { arrival: edge.arrival, legNumber: round };
      }
    }
    return earliest;
  }

  /**
   * Expands a target stop or stop set to all equivalent concrete stop IDs.
   *
   * When `to` is omitted, defaults to the resolved destinations in the
   * routing state.
   *
   * Equivalent stops are expanded here so destination handling has a single
   * source of truth shared by route reconstruction and arrival lookups.
   */
  private expandDestinations(to?: StopId | Set<StopId>): Set<StopId> {
    const targets: Iterable<StopId> =
      to instanceof Set
        ? to
        : to !== undefined
          ? [to]
          : this.#routingState.destinations;

    const expanded = new Set<StopId>();
    for (const target of targets) {
      for (const equivalentStop of this.stopsIndex.equivalentStops(target)) {
        expanded.add(equivalentStop.id);
      }
    }
    return expanded;
  }

  /**
   * Reconstructs the best route to a stop by SourceStopId.
   * (to any stop reachable in less time / transfers than this result's
   * destination set)
   *
   * @param to The destination stop by SourceStopId.
   * @param maxTransfers Optional transfer limit within retained data; see {@link Result}.
   * @returns a route to the destination stop if it exists.
   */
  bestRouteToSourceStopId(
    to: SourceStopId | Set<SourceStopId>,
    maxTransfers?: number,
  ): Route | undefined {
    if (to instanceof Set) {
      const stopIds = new Set<StopId>();
      for (const sourceId of to) {
        const found = this.stopsIndex.findStopBySourceStopId(sourceId);
        if (found !== undefined) stopIds.add(found.id);
      }
      return stopIds.size === 0
        ? undefined
        : this.bestRoute(stopIds, maxTransfers);
    }
    const stopId = this.stopsIndex.findStopBySourceStopId(to)?.id;
    return stopId === undefined
      ? undefined
      : this.bestRoute(stopId, maxTransfers);
  }

  /**
   * Reconstructs the best route to a stop.
   * (to any stop reachable in less time / transfers than this result's
   * destination set)
   *
   * @param to The destination stop. Defaults to this result's resolved
   *   destinations.
   * @param maxTransfers Optional transfer limit within retained data; see {@link Result}.
   * @returns a route to the destination stop if it exists.
   */
  bestRoute(
    to?: StopId | Set<StopId>,
    maxTransfers?: number,
  ): Route | undefined {
    const destinationStops = this.expandDestinations(to);

    // Find the fastest-reached destination across all equivalent stops.
    let fastestDestination: StopId | undefined = undefined;
    let fastestArrivalTime: Time | undefined = undefined;
    let fastestLegNumber: number | undefined = undefined;
    for (const destination of destinationStops) {
      const arrivalData = this.concreteArrivalAt(destination, maxTransfers);
      if (
        arrivalData !== undefined &&
        (fastestArrivalTime === undefined ||
          arrivalData.arrival < fastestArrivalTime)
      ) {
        fastestDestination = destination;
        fastestArrivalTime = arrivalData.arrival;
        fastestLegNumber = arrivalData.legNumber;
      }
    }
    if (fastestDestination === undefined || fastestLegNumber === undefined) {
      return undefined;
    }

    // Reconstruct the path by walking backwards through the routing graph.
    const route: Leg[] = [];
    let currentStop = fastestDestination;
    let round = fastestLegNumber;
    let previousVehicleEdge: VehicleEdge | undefined;

    while (round >= 0) {
      const edge = this.#routingState.graph[round]?.[currentStop];
      if (!edge) {
        if (round === 0) break;
        throw new Error(
          `No edge arriving at stop ${currentStop} at round ${round}`,
        );
      }
      let leg: Leg;
      if ('routeId' in edge) {
        // Walk the continuationOf chain to find the earliest (boarding) edge.
        let boardingEdge: VehicleEdge;
        let vehicleLeg: VehicleLeg;
        if (!edge.continuationOf) {
          boardingEdge = edge;
          vehicleLeg = this.buildVehicleLeg([edge]);
        } else {
          let vehicleEdge: VehicleEdge = edge;
          const chainedEdges: VehicleEdge[] = [vehicleEdge];
          while (vehicleEdge.continuationOf) {
            chainedEdges.push(vehicleEdge.continuationOf);
            vehicleEdge = vehicleEdge.continuationOf;
          }
          boardingEdge = vehicleEdge;
          vehicleLeg = this.buildVehicleLeg(chainedEdges);
        }
        leg = vehicleLeg;

        // Insert a guaranteed transfer leg between consecutive vehicle legs if
        // applicable. Because we are building the array in reverse, the
        // guaranteed transfer is pushed after the alighting leg so that after
        // the final reverse() it sits between the two vehicle legs.
        if (
          previousVehicleEdge &&
          this.timetable.isTripTransferGuaranteed(
            {
              stopIndex: boardingEdge.hopOffStopIndex,
              routeId: boardingEdge.routeId,
              tripIndex: boardingEdge.tripIndex,
            },
            {
              stopIndex: previousVehicleEdge.stopIndex,
              routeId: previousVehicleEdge.routeId,
              tripIndex: previousVehicleEdge.tripIndex,
            },
          )
        ) {
          route.push(
            this.buildGuaranteedTransferLeg(boardingEdge, previousVehicleEdge),
          );
        }
        previousVehicleEdge = boardingEdge;
      } else if ('type' in edge) {
        leg = this.buildTransferLeg(edge);
        previousVehicleEdge = undefined;
      } else if ('duration' in edge) {
        leg = this.buildAccessLeg(edge);
        previousVehicleEdge = undefined;
      } else {
        break;
      }
      route.push(leg);
      currentStop = leg.from.id;
      if ('routeId' in edge) {
        round -= 1;
      }
    }
    return new Route(route.reverse());
  }

  private buildServiceRouteInfo(route: TimetableRoute): ServiceRouteInfo {
    const serviceRouteInfo = this.timetable.getServiceRouteInfo(route);
    return {
      type: serviceRouteInfo.type,
      name: serviceRouteInfo.name,
    };
  }

  /**
   * Builds a vehicle leg from a chain of vehicle edges.
   *
   * @param edges Array of vehicle edges representing continuous trips on transit vehicles.
   *   edges[0] is the alighting edge (last in the journey); edges[length-1] is the
   *   boarding edge (first in the journey).
   * @returns A vehicle leg with departure/arrival information and route details
   * @throws Error if the edges array is empty
   */
  private buildVehicleLeg(edges: VehicleEdge[]): VehicleLeg {
    if (edges.length === 0) {
      throw new Error('Cannot build vehicle leg from empty edges');
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstEdge = edges[edges.length - 1]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastEdge = edges[0]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstRoute = this.timetable.getRoute(firstEdge.routeId)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastRoute = this.timetable.getRoute(lastEdge.routeId)!;
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(
        firstRoute.stopId(firstEdge.stopIndex),
      )!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(
        lastRoute.stopId(lastEdge.hopOffStopIndex),
      )!,
      // The route info comes from the first boarded route in case of continuous trips
      route: this.buildServiceRouteInfo(firstRoute),
      departureTime: firstRoute.departureFrom(
        firstEdge.stopIndex,
        firstEdge.tripIndex,
      ),
      arrivalTime: lastEdge.arrival,
      pickUpType: firstRoute.pickUpTypeFrom(
        firstEdge.stopIndex,
        firstEdge.tripIndex,
      ),
      dropOffType: lastRoute.dropOffTypeAt(
        lastEdge.hopOffStopIndex,
        lastEdge.tripIndex,
      ),
    };
  }

  /**
   * Builds a transfer leg from a transfer edge.
   *
   * @param edge Transfer edge representing a walking connection between stops
   * @returns A transfer leg with from/to stops and transfer details
   */
  private buildTransferLeg(edge: TransferEdge): Transfer {
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(edge.from)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(edge.to)!,
      minTransferTime: edge.minTransferTime,
      type: edge.type,
    };
  }

  /**
   * Builds a transfer leg from a transfer edge.
   *
   * @param edge Transfer edge representing a walking connection between stops
   * @returns A transfer leg with from/to stops and transfer details
   */
  private buildAccessLeg(edge: AccessEdge): Access {
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(edge.from)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(edge.to)!,
      duration: edge.duration,
    };
  }

  /**
   * Builds a guaranteed transfer leg between two consecutive vehicle legs.
   *
   * @param fromEdge The vehicle edge we're alighting from
   * @param toEdge The vehicle edge we're boarding
   * @returns A transfer leg with type 'GUARANTEED'
   */
  private buildGuaranteedTransferLeg(
    fromEdge: VehicleEdge,
    toEdge: VehicleEdge,
  ): Transfer {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fromRoute = this.timetable.getRoute(fromEdge.routeId)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const toRoute = this.timetable.getRoute(toEdge.routeId)!;
    const fromStopId = fromRoute.stopId(fromEdge.hopOffStopIndex);
    const toStopId = toRoute.stopId(toEdge.stopIndex);

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(fromStopId)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(toStopId)!,
      type: TransferTypes.GUARANTEED,
    };
  }

  /**
   * Returns the arrival time at any stop reachable in less time / transfers
   * than this result's destination set.
   *
   * @param stop The target stop for which to return the arrival time.
   * @param maxTransfers Optional transfer limit within retained data; see {@link Result}.
   * @returns The arrival time if the target stop is reachable, otherwise undefined.
   */
  arrivalAt(stop: StopId, maxTransfers?: number): Arrival | undefined {
    const equivalentStops = this.stopsIndex.equivalentStops(stop);
    let earliestArrival: Arrival | undefined = undefined;

    for (const equivalentStop of equivalentStops) {
      const arrivalTime = this.concreteArrivalAt(
        equivalentStop.id,
        maxTransfers,
      );
      if (arrivalTime !== undefined) {
        if (
          earliestArrival === undefined ||
          arrivalTime.arrival < earliestArrival.arrival
        ) {
          earliestArrival = arrivalTime;
        }
      }
    }

    return earliestArrival;
  }
}
