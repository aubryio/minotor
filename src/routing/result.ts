import { Timetable } from '../router.js';
import { SourceStopId, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { RawPickUpDropOffType } from '../timetable/route.js';
import { Query } from './query.js';
import { Leg, Route, Transfer, VehicleLeg } from './route.js';
import { Arrival, RoutingState, TransferEdge, VehicleEdge } from './router.js';

/**
 * Details about the pickup and drop-off modalities at each stop in each trip of a route.
 */
export type PickUpDropOffType =
  | 'REGULAR'
  | 'NOT_AVAILABLE'
  | 'MUST_PHONE_AGENCY'
  | 'MUST_COORDINATE_WITH_DRIVER';

const pickUpDropOffTypeMap: PickUpDropOffType[] = [
  'REGULAR',
  'NOT_AVAILABLE',
  'MUST_PHONE_AGENCY',
  'MUST_COORDINATE_WITH_DRIVER',
];

/**
 * Converts a numerical representation of a pick-up/drop-off type
 * into its corresponding string representation.
 *
 * @param numericalType - The numerical value representing the pick-up/drop-off type.
 * @returns The corresponding PickUpDropOffType as a string.
 * @throws An error if the numerical type is invalid.
 */
const toPickupDropOffType = (
  rawType: RawPickUpDropOffType,
): PickUpDropOffType => {
  const type = pickUpDropOffTypeMap[rawType];
  if (!type) {
    throw new Error(`Invalid pickup/drop-off type ${rawType}`);
  }
  return type;
};

export class Result {
  private readonly query: Query;
  public readonly routingState: RoutingState;
  public readonly stopsIndex: StopsIndex;
  public readonly timetable: Timetable;

  constructor(
    query: Query,
    routingState: RoutingState,
    stopsIndex: StopsIndex,
    timetable: Timetable,
  ) {
    this.query = query;
    this.routingState = routingState;
    this.stopsIndex = stopsIndex;
    this.timetable = timetable;
  }

  /**
   * Reconstructs the best route to a stop by SourceStopId.
   * (to any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param to The destination stop by SourceStopId.
   * @returns a route to the destination stop if it exists.
   */
  bestRouteToSourceStopId(
    to: SourceStopId | Set<SourceStopId>,
  ): Route | undefined {
    if (to instanceof Set) {
      const stopIds = new Set<StopId>();
      for (const sourceId of to) {
        const found = this.stopsIndex.findStopBySourceStopId(sourceId);
        if (found !== undefined) stopIds.add(found.id);
      }
      return stopIds.size === 0 ? undefined : this.bestRoute(stopIds);
    }
    const stopId = this.stopsIndex.findStopBySourceStopId(to)?.id;
    return stopId === undefined ? undefined : this.bestRoute(stopId);
  }

  /**
   * Reconstructs the best route to a stop.
   * (to any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param to The destination stop. Defaults to the destination of the original query.
   * @returns a route to the destination stop if it exists.
   */
  bestRoute(to?: StopId | Set<StopId>): Route | undefined {
    const destinationIterable: Iterable<StopId> =
      to instanceof Set ? to : to ? [to] : this.query.to;

    // Find the fastest-reached destination across all equivalent stops.
    let fastestDestination: StopId | undefined = undefined;
    let fastestTime: Arrival | undefined = undefined;
    for (const sourceDestination of destinationIterable) {
      const equivalentStops =
        this.stopsIndex.equivalentStops(sourceDestination);
      for (const destination of equivalentStops) {
        const arrivalTime = this.routingState.earliestArrivals.get(
          destination.id,
        );
        if (arrivalTime !== undefined) {
          if (
            fastestTime === undefined ||
            arrivalTime.arrival < fastestTime.arrival
          ) {
            fastestDestination = destination.id;
            fastestTime = arrivalTime;
          }
        }
      }
    }
    if (!fastestDestination || !fastestTime) {
      return undefined;
    }

    // Reconstruct the path by walking backwards through the routing graph.
    const route: Leg[] = [];
    let currentStop = fastestDestination;
    let round = fastestTime.legNumber;
    let previousVehicleEdge: VehicleEdge | undefined;
    while (round > 0) {
      const edge = this.routingState.graph[round]?.get(currentStop);
      if (!edge) {
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
      route: this.timetable.getServiceRouteInfo(firstRoute),
      departureTime: firstRoute.departureFrom(
        firstEdge.stopIndex,
        firstEdge.tripIndex,
      ),
      arrivalTime: lastEdge.arrival,
      pickUpType: toPickupDropOffType(
        firstRoute.pickUpTypeFrom(firstEdge.stopIndex, firstEdge.tripIndex),
      ),
      dropOffType: toPickupDropOffType(
        lastRoute.dropOffTypeAt(lastEdge.hopOffStopIndex, lastEdge.tripIndex),
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
      type: 'GUARANTEED',
    };
  }

  /**
   * Returns the arrival time at any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param stop The target stop for which to return the arrival time.
   * @param maxTransfers The optional maximum number of transfers allowed.
   * @returns The arrival time if the target stop is reachable, otherwise undefined.
   */
  arrivalAt(stop: StopId, maxTransfers?: number): Arrival | undefined {
    const equivalentStops = this.stopsIndex.equivalentStops(stop);
    let earliestArrival: Arrival | undefined = undefined;

    for (const equivalentStop of equivalentStops) {
      let arrivalTime;
      if (maxTransfers === undefined) {
        arrivalTime = this.routingState.earliestArrivals.get(equivalentStop.id);
      } else {
        // We have no guarantee that the stop was visited in the last round,
        // so we need to check all rounds if it's not found in the last one.
        for (let i = maxTransfers + 1; i >= 0; i--) {
          const arrivalEdge = this.routingState.graph[i]?.get(
            equivalentStop.id,
          );
          if (arrivalEdge !== undefined) {
            arrivalTime = {
              arrival: arrivalEdge.arrival,
              legNumber: i,
            };
            break;
          }
        }
      }
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
