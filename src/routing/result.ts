import { Timetable } from '../router.js';
import { SourceStopId, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import {
  PickUpDropOffTypeString,
  RawPickUpDropOffType,
  Route as TimetableRoute,
} from '../timetable/route.js';
import { Time } from '../timetable/time.js';
import {
  routeTypeToString,
  TransferTypes,
  transferTypeToString,
  TripStop,
} from '../timetable/timetable.js';
import { EdgeKinds, NO_CELL } from './graph.js';
import {
  Access,
  Leg,
  Route,
  ServiceRouteInfo,
  Transfer,
  VehicleLeg,
} from './route.js';
import { Arrival, RoutingEdge, RoutingState, VehicleEdge } from './state.js';

/**
 * Details about the pickup and drop-off modalities at each stop in each trip of a route.
 */
const pickUpDropOffTypeMap: PickUpDropOffTypeString[] = [
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
 * @returns The corresponding PickUpDropOffTypeString as a string.
 * @throws An error if the numerical type is invalid.
 */
const toPickupDropOffType = (
  rawType: RawPickUpDropOffType,
): PickUpDropOffTypeString => {
  const type = pickUpDropOffTypeMap[rawType];
  if (!type) {
    throw new Error(`Invalid pickup/drop-off type ${rawType}`);
  }
  return type;
};

type VehicleLegBoundary = {
  leg: VehicleLeg;
  boardingEdge: VehicleEdge;
  alightingEdge: VehicleEdge;
  boardingTrip: TripStop;
  alightingTrip: TripStop;
  predecessorCell: number;
};

export class Result {
  private readonly destinations: ReadonlySet<StopId>;
  public readonly routingState: RoutingState;
  public readonly stopsIndex: StopsIndex;
  public readonly timetable: Timetable;

  constructor(
    destinations: ReadonlySet<StopId>,
    routingState: RoutingState,
    stopsIndex: StopsIndex,
    timetable: Timetable,
  ) {
    this.destinations = destinations;
    this.routingState = routingState;
    this.stopsIndex = stopsIndex;
    this.timetable = timetable;
  }

  /**
   * Expands a target stop or stop set to all equivalent concrete stop IDs.
   *
   * When `to` is omitted, defaults to the resolved destinations stored on this
   * result.
   *
   * Equivalent stops are expanded here so destination handling has a single
   * source of truth shared by route reconstruction and arrival lookups.
   */
  private expandDestinations(to?: StopId | Set<StopId>): Set<StopId> {
    const targets: Iterable<StopId> =
      to instanceof Set ? to : to !== undefined ? [to] : this.destinations;

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
   * (to any stop reachable in less time / transfers than this result's
   * destination set)
   *
   * @param to The destination stop. Defaults to this result's resolved
   *   destinations.
   * @returns a route to the destination stop if it exists.
   */
  bestRoute(to?: StopId | Set<StopId>): Route | undefined {
    const destinationStops = this.expandDestinations(to);

    // Find the fastest-reached destination across all equivalent stops.
    let fastestDestination: StopId | undefined = undefined;
    let fastestArrivalTime: Time | undefined = undefined;
    let fastestLegNumber: number | undefined = undefined;
    for (const destination of destinationStops) {
      const arrivalData = this.routingState.getArrival(destination);
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

    // Reconstruct the path by walking backwards through typed graph cells.
    // Keep reconstruction cell-native: RoutingEdge objects are only materialized
    // by edgeAt()/edges() for debugging, plotting, and compatibility.
    const route: Leg[] = [];
    const graph = this.routingState.graph;
    let cell = graph.cell(fastestLegNumber, fastestDestination);
    let previousVehicleBoundary: VehicleLegBoundary | undefined;

    while (cell !== NO_CELL && graph.hasCell(cell)) {
      const kind = graph.kindAtCell(cell);
      let leg: Leg | undefined;
      let nextCell = graph.predecessorCell(cell);

      if (
        kind === EdgeKinds.VEHICLE ||
        kind === EdgeKinds.VEHICLE_CONTINUATION
      ) {
        const vehicle = this.buildVehicleLegFromCell(cell);
        leg = vehicle.leg;

        // Insert a guaranteed transfer leg between consecutive vehicle legs if
        // applicable. Because we are building the array in reverse, the
        // guaranteed transfer is pushed after the alighting leg so that after
        // the final reverse() it sits between the two vehicle legs.
        if (
          previousVehicleBoundary &&
          this.timetable.isTripTransferGuaranteed(
            vehicle.alightingTrip,
            previousVehicleBoundary.boardingTrip,
          )
        ) {
          route.push(
            this.buildGuaranteedTransferLeg(
              vehicle.alightingEdge,
              previousVehicleBoundary.boardingEdge,
            ),
          );
        }
        previousVehicleBoundary = vehicle;
        nextCell = vehicle.predecessorCell;
      } else if (kind === EdgeKinds.TRANSFER) {
        leg = this.buildTransferLegFromCell(cell);
        previousVehicleBoundary = undefined;
      } else if (kind === EdgeKinds.ACCESS) {
        leg = this.buildAccessLegFromCell(cell);
        previousVehicleBoundary = undefined;
      } else {
        break;
      }

      if (leg === undefined) break;
      route.push(leg);
      cell = nextCell;
    }
    return new Route(route.reverse());
  }

  edgeAt(round: number, stop: StopId): RoutingEdge | undefined {
    return this.edgeAtCell(this.routingState.graph.cell(round, stop));
  }

  edgeAtCell(cell: number): RoutingEdge | undefined {
    const graph = this.routingState.graph;
    const kind = graph.kindAtCell(cell);
    if (kind === EdgeKinds.NONE) return undefined;

    const arrival = graph.arrivalAtCell(cell);
    switch (kind) {
      case EdgeKinds.ORIGIN: {
        const originStop = graph.originStopAtCell(cell);
        if (originStop === undefined) return undefined;
        return { stopId: originStop, arrival };
      }
      case EdgeKinds.ACCESS: {
        const access = graph.accessAtCell(cell);
        if (access === undefined) return undefined;
        return {
          arrival,
          from: access.from,
          to: graph.stopOfCell(cell),
          duration: access.duration,
        };
      }
      case EdgeKinds.VEHICLE:
      case EdgeKinds.VEHICLE_CONTINUATION:
        return this.vehicleEdgeAtCell(cell);
      case EdgeKinds.TRANSFER: {
        const transferId = graph.transferIdAtCell(cell);
        if (transferId === undefined) return undefined;
        const transfer = this.timetable.getTransfer(transferId);
        if (transfer === undefined) return undefined;
        return {
          arrival,
          from: transfer.from,
          to: transfer.destination,
          type: transfer.type,
          transferId,
          ...(transfer.minTransferTime !== undefined && {
            minTransferTime: transfer.minTransferTime,
          }),
        };
      }
      default:
        return undefined;
    }
  }

  *edges(): Generator<{
    round: number;
    stop: StopId;
    cell: number;
    edge: RoutingEdge;
  }> {
    const graph = this.routingState.graph;
    for (const cell of graph.occupiedCells()) {
      const edge = this.edgeAtCell(cell);
      if (edge === undefined) continue;
      yield {
        round: graph.roundOfCell(cell),
        stop: graph.stopOfCell(cell),
        cell,
        edge,
      };
    }
  }

  private buildServiceRouteInfo(route: TimetableRoute): ServiceRouteInfo {
    const serviceRouteInfo = this.timetable.getServiceRouteInfo(route);
    return {
      type: routeTypeToString(serviceRouteInfo.type),
      name: serviceRouteInfo.name,
    };
  }

  private buildVehicleLegFromCell(cell: number): VehicleLegBoundary {
    const chainCells = this.vehicleChainCells(cell);
    if (chainCells.length === 0) {
      throw new Error(`Expected vehicle edge at graph cell ${cell}`);
    }

    const boardingCell = chainCells[chainCells.length - 1];
    const alightingCell = chainCells[0];
    if (boardingCell === undefined || alightingCell === undefined) {
      throw new Error(`Expected vehicle edge at graph cell ${cell}`);
    }
    const boardingEdge =
      this.vehicleEdgeAtCellWithoutContinuation(boardingCell);
    const alightingEdge =
      this.vehicleEdgeAtCellWithoutContinuation(alightingCell);
    if (boardingEdge === undefined || alightingEdge === undefined) {
      throw new Error(
        `Expected vehicle payload in graph cell chain at ${cell}`,
      );
    }

    return {
      leg: this.buildVehicleLegFromCells(chainCells),
      boardingEdge,
      alightingEdge,
      boardingTrip: {
        stopIndex: boardingEdge.stopIndex,
        routeId: boardingEdge.routeId,
        tripIndex: boardingEdge.tripIndex,
      },
      alightingTrip: {
        stopIndex: alightingEdge.hopOffStopIndex,
        routeId: alightingEdge.routeId,
        tripIndex: alightingEdge.tripIndex,
      },
      predecessorCell:
        this.routingState.graph.predecessorBeforeVehicleChain(cell),
    };
  }

  private vehicleChainCells(cell: number): number[] {
    const graph = this.routingState.graph;
    if (!graph.isVehicleCell(cell)) return [];

    const cells: number[] = [cell];
    let currentCell = cell;
    while (graph.isVehicleContinuationCell(currentCell)) {
      const previousCell = graph.predecessorCell(currentCell);
      if (previousCell === NO_CELL || !graph.isVehicleCell(previousCell)) break;
      cells.push(previousCell);
      currentCell = previousCell;
    }
    return cells;
  }

  private vehicleEdgeAtCellWithoutContinuation(
    cell: number,
  ): VehicleEdge | undefined {
    const graph = this.routingState.graph;
    const payload = graph.vehiclePayloadAtCell(cell);
    if (payload === undefined) return undefined;

    return {
      arrival: graph.arrivalAtCell(cell),
      routeId: payload.routeId,
      stopIndex: payload.boardStopIndex,
      tripIndex: payload.tripIndex,
      hopOffStopIndex: payload.hopOffStopIndex,
    };
  }

  private vehicleEdgeAtCell(cell: number): VehicleEdge | undefined {
    const graph = this.routingState.graph;
    const payload = graph.vehiclePayloadAtCell(cell);
    if (payload === undefined) return undefined;

    let continuationOf: VehicleEdge | undefined;
    if (graph.kindAtCell(cell) === EdgeKinds.VEHICLE_CONTINUATION) {
      const previousCell = graph.predecessorCell(cell);
      if (previousCell !== NO_CELL && graph.isVehicleCell(previousCell)) {
        continuationOf = this.vehicleEdgeAtCell(previousCell);
      }
    }

    return {
      arrival: graph.arrivalAtCell(cell),
      routeId: payload.routeId,
      stopIndex: payload.boardStopIndex,
      tripIndex: payload.tripIndex,
      hopOffStopIndex: payload.hopOffStopIndex,
      ...(continuationOf !== undefined && { continuationOf }),
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
  private buildVehicleLegFromCells(cells: number[]): VehicleLeg {
    if (cells.length === 0) {
      throw new Error('Cannot build vehicle leg from empty cell chain');
    }

    const graph = this.routingState.graph;
    const firstCell = cells[cells.length - 1];
    const lastCell = cells[0];
    if (firstCell === undefined || lastCell === undefined) {
      throw new Error('Cannot build vehicle leg from empty cell chain');
    }
    const firstPayload = graph.vehiclePayloadAtCell(firstCell);
    const lastPayload = graph.vehiclePayloadAtCell(lastCell);
    if (firstPayload === undefined || lastPayload === undefined) {
      throw new Error('Cannot build vehicle leg from non-vehicle cell chain');
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstRoute = this.timetable.getRoute(firstPayload.routeId)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastRoute = this.timetable.getRoute(lastPayload.routeId)!;
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(
        firstRoute.stopId(firstPayload.boardStopIndex),
      )!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(
        lastRoute.stopId(lastPayload.hopOffStopIndex),
      )!,
      // The route info comes from the first boarded route in case of continuous trips.
      route: this.buildServiceRouteInfo(firstRoute),
      departureTime: firstRoute.departureFrom(
        firstPayload.boardStopIndex,
        firstPayload.tripIndex,
      ),
      arrivalTime: graph.arrivalAtCell(lastCell),
      pickUpType: toPickupDropOffType(
        firstRoute.pickUpTypeFrom(
          firstPayload.boardStopIndex,
          firstPayload.tripIndex,
        ),
      ),
      dropOffType: toPickupDropOffType(
        lastRoute.dropOffTypeAt(
          lastPayload.hopOffStopIndex,
          lastPayload.tripIndex,
        ),
      ),
    };
  }

  /** Builds a transfer leg directly from a typed graph cell. */
  private buildTransferLegFromCell(cell: number): Transfer | undefined {
    const graph = this.routingState.graph;
    const transferId = graph.transferIdAtCell(cell);
    if (transferId === undefined) return undefined;

    const transfer = this.timetable.getTransfer(transferId);
    if (transfer === undefined) return undefined;

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(transfer.from)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(transfer.destination)!,
      minTransferTime: transfer.minTransferTime,
      type: transferTypeToString(transfer.type),
    };
  }

  /** Builds an access leg directly from a typed graph cell. */
  private buildAccessLegFromCell(cell: number): Access | undefined {
    const graph = this.routingState.graph;
    const access = graph.accessAtCell(cell);
    if (access === undefined) return undefined;

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(access.from)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(graph.stopOfCell(cell))!,
      duration: access.duration,
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
      type: transferTypeToString(TransferTypes.GUARANTEED),
    };
  }

  /**
   * Returns the arrival time at any stop reachable in less time / transfers
   * than this result's destination set.
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
      if (
        maxTransfers === undefined ||
        this.routingState.getArrival(equivalentStop.id)?.legNumber ===
          maxTransfers + 1
      ) {
        arrivalTime = this.routingState.getArrival(equivalentStop.id);
      } else {
        // We have no guarantee that the stop was visited in the last round,
        // so we need to check all rounds if it's not found in the last one.
        const graph = this.routingState.graph;
        for (let i = maxTransfers + 1; i >= 0; i--) {
          const cell = graph.cell(i, equivalentStop.id);
          if (graph.hasCell(cell)) {
            arrivalTime = {
              arrival: graph.arrivalAtCell(cell),
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
