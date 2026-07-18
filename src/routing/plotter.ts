import { StopId } from '../stops/stops.js';
import { StopRouteIndex } from '../timetable/route.js';
import {
  Duration,
  durationToString,
  Time,
  timeToString,
} from '../timetable/time.js';
import {
  routeTypeToString,
  TransferId,
  TransferType,
  TripStop,
} from '../timetable/timetable.js';
import { CellId, EdgeKinds, NO_CELL } from './graph.js';
import { Result } from './result.js';

type RoutingEntryBase = {
  cell: CellId;
  round: number;
  stop: StopId;
  arrival: Time;
};

type OriginNode = RoutingEntryBase & {
  kind: 'origin';
  stopId: StopId;
};

type AccessEdge = RoutingEntryBase & {
  kind: 'access';
  from: StopId;
  to: StopId;
  duration: Duration;
};

type VehicleEdge = RoutingEntryBase &
  TripStop & {
    kind: 'vehicle';
    hopOffStopIndex: StopRouteIndex;
    continuationOf?: VehicleEdge;
  };

type TransferEdge = RoutingEntryBase & {
  kind: 'transfer';
  from: StopId;
  to: StopId;
  type: TransferType;
  minTransferTime?: Duration;
  transferId?: TransferId;
};

type RoutingEntry = OriginNode | AccessEdge | VehicleEdge | TransferEdge;

type DotAttributeValue = string | number;

const DOT_CONFIG = {
  colors: {
    rounds: [
      '#60a5fa', // Round 1 - Blue
      '#ff9800', // Round 2 - Orange
      '#14b8a6', // Round 3 - Teal
      '#fb7185', // Round 4 - Pink
      '#ffdf00', // Round 5 - Yellow
      '#b600ff', // Round 6 - Purple
      '#ee82ee', // Round 7+ - Violet
    ],
    defaultRound: '#888888',
    originStation: '#60a5fa',
    destinationStation: '#ee82ee',
    defaultStation: 'white',
    continuationFill: '#ffffcc',
  },
  penWidth: {
    default: 1,
    continuation: 2,
    continuationEdge: 3,
  },
} as const;

class DotBuilder {
  private readonly lines: string[] = [];

  addHeader(): this {
    this.lines.push(
      'digraph RoutingGraph {',
      '  graph [overlap=false, splines=true, rankdir=TB, bgcolor=white, nodesep=0.8, ranksep=1.2, concentrate=true];',
      '  node [fontname="Arial" margin=0.1];',
      '  edge [fontname="Arial" fontsize=10];',
    );
    return this;
  }

  addComment(comment: string): this {
    this.lines.push('', `  // ${comment}`);
    return this;
  }

  addNode(id: string, attrs: Record<string, DotAttributeValue>): this {
    const attrStr = this.formatAttributes(attrs);
    this.lines.push(`  "${this.escapeDotString(id)}" [${attrStr}];`);
    return this;
  }

  addEdge(
    from: string,
    to: string,
    attrs: Record<string, DotAttributeValue> = {},
  ): this {
    const attrStr = this.formatAttributes(attrs);
    const attrPart = attrStr ? ` [${attrStr}]` : '';
    this.lines.push(
      `  "${this.escapeDotString(from)}" -> "${this.escapeDotString(to)}"${attrPart};`,
    );
    return this;
  }

  addRaw(lines: string[]): this {
    this.lines.push(...lines);
    return this;
  }

  build(): string {
    return [...this.lines, '}'].join('\n');
  }

  private formatAttributes(attrs: Record<string, DotAttributeValue>): string {
    return Object.entries(attrs)
      .map(([key, value]) => `${key}="${this.escapeDotString(String(value))}"`)
      .join(' ');
  }

  private escapeDotString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }
}

/**
 * Generates DOT graph visualizations of routing results.
 *
 * The generated graph shows:
 * - Stations as rectangular nodes (origin=blue, destination=violet)
 * - Vehicle edges as ovals with route info
 * - Transfer edges as dashed ovals
 * - Continuation edges (same-station transfers) as bold yellow ovals
 *
 * @example
 * ```typescript
 * const plotter = new Plotter(routingResult);
 * const dotGraph = plotter.plotDotGraph();
 * // Use with Graphviz: dot -Tpng -o graph.png
 * ```
 */
export class Plotter {
  private result: Result;

  constructor(result: Result) {
    this.result = result;
  }

  private stationNodeId(stopId: StopId): string {
    return `s_${stopId}`;
  }

  private vehicleEdgeNodeId(cell: CellId): string {
    return `e_vehicle_${cell}`;
  }

  private transferEdgeNodeId(cell: CellId): string {
    return `e_transfer_${cell}`;
  }

  private accessEdgeNodeId(cell: CellId): string {
    return `e_access_${cell}`;
  }

  private continuationNodeId(
    fromEdge: VehicleEdge,
    toEdge: VehicleEdge,
  ): string {
    return `e_continuation_${fromEdge.cell}_${toEdge.cell}`;
  }

  private entryBaseAtCell(cell: CellId): RoutingEntryBase {
    const graph = this.result.routingState.graph;
    return {
      cell,
      round: graph.roundOfCell(cell),
      stop: graph.stopOfCell(cell),
      arrival: graph.arrivalAtCell(cell),
    };
  }

  private entryAtCell(cell: CellId): RoutingEntry | undefined {
    const graph = this.result.routingState.graph;
    const kind = graph.kindAtCell(cell);
    if (kind === EdgeKinds.NONE) return undefined;

    const base = this.entryBaseAtCell(cell);
    switch (kind) {
      case EdgeKinds.ORIGIN: {
        const originStop = graph.originStopAtCell(cell);
        if (originStop === undefined) return undefined;
        return { ...base, kind: 'origin', stopId: originStop };
      }
      case EdgeKinds.ACCESS: {
        const access = graph.accessAtCell(cell);
        if (access === undefined) return undefined;
        return {
          ...base,
          kind: 'access',
          from: access.from,
          to: graph.stopOfCell(cell),
          duration: access.duration,
        };
      }
      case EdgeKinds.VEHICLE:
      case EdgeKinds.VEHICLE_CONTINUATION:
        return this.vehicleEntryAtCell(cell);
      case EdgeKinds.TRANSFER: {
        const transferId = graph.transferIdAtCell(cell);
        if (transferId === undefined) return undefined;
        const transfer = this.result.timetable.getTransfer(transferId);
        if (transfer === undefined) return undefined;
        return {
          ...base,
          kind: 'transfer',
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

  private vehicleEntryAtCell(cell: CellId): VehicleEdge | undefined {
    const graph = this.result.routingState.graph;
    const payload = graph.vehiclePayload(cell);
    if (payload === undefined) return undefined;

    let continuationOf: VehicleEdge | undefined;
    if (graph.kindAtCell(cell) === EdgeKinds.VEHICLE_CONTINUATION) {
      const previousCell = graph.predecessorCell(cell);
      if (previousCell !== NO_CELL && graph.isVehicleCell(previousCell)) {
        continuationOf = this.vehicleEntryAtCell(previousCell);
      }
    }

    return {
      ...this.entryBaseAtCell(cell),
      kind: 'vehicle',
      routeId: payload.routeId,
      stopIndex: payload.boardStopIndex,
      tripIndex: payload.tripIndex,
      hopOffStopIndex: payload.hopOffStopIndex,
      ...(continuationOf !== undefined && { continuationOf }),
    };
  }

  private *entries(): Generator<RoutingEntry> {
    const graph = this.result.routingState.graph;
    for (const cell of graph.occupiedCells()) {
      const entry = this.entryAtCell(cell);
      if (entry === undefined) continue;
      yield entry;
    }
  }

  private getRoundColor(round: number): string {
    if (round === 0) {
      return DOT_CONFIG.colors.defaultRound;
    }

    const colorIndex = Math.min(round - 1, DOT_CONFIG.colors.rounds.length - 1);
    return DOT_CONFIG.colors.rounds[colorIndex] ?? '#ee82ee';
  }

  private getStationFillColor(
    isOrigin: boolean,
    isDestination: boolean,
  ): string {
    if (isOrigin) {
      return DOT_CONFIG.colors.originStation;
    }
    if (isDestination) {
      return DOT_CONFIG.colors.destinationStation;
    }
    return DOT_CONFIG.colors.defaultStation;
  }

  private formatStopName(stopId: StopId): string {
    const stop = this.result.stopsIndex.findStopById(stopId);
    if (!stop) {
      return `Unknown Stop (${stopId})`;
    }

    return stop.platform ? `${stop.name}\nPl. ${stop.platform}` : stop.name;
  }

  private getStationInfo(stopId: StopId): {
    isOrigin: boolean;
    isDestination: boolean;
  } {
    const graph = this.result.routingState.graph;
    let isOrigin = false;
    for (const cell of graph.occupiedCells()) {
      if (
        graph.kindAtCell(cell) === EdgeKinds.ORIGIN &&
        graph.originStopAtCell(cell) === stopId
      ) {
        isOrigin = true;
        break;
      }
    }

    const isDestination =
      this.result.routingState.destinations.includes(stopId);
    return { isOrigin, isDestination };
  }

  private getVehicleEdgeFromStopId(edge: VehicleEdge): StopId | undefined {
    const route = this.result.timetable.getRoute(edge.routeId);
    return route?.stopId(edge.stopIndex);
  }

  private getVehicleEdgeToStopId(edge: VehicleEdge): StopId | undefined {
    const route = this.result.timetable.getRoute(edge.routeId);
    return route?.stopId(edge.hopOffStopIndex);
  }

  private addStationNode(builder: DotBuilder, stopId: StopId): void {
    const stop = this.result.stopsIndex.findStopById(stopId);
    if (!stop) {
      return;
    }

    const stationInfo = this.getStationInfo(stopId);
    const fillColor = this.getStationFillColor(
      stationInfo.isOrigin,
      stationInfo.isDestination,
    );

    builder.addNode(this.stationNodeId(stopId), {
      label: `${this.formatStopName(stopId)}\n${String(stopId)}`,
      shape: 'box',
      style: 'filled',
      fillcolor: fillColor,
    });
  }

  private addVehicleEdge(builder: DotBuilder, edge: VehicleEdge): void {
    const route = this.result.timetable.getRoute(edge.routeId);
    if (!route) {
      return;
    }

    const fromStopId = route.stopId(edge.stopIndex);
    const toStopId = route.stopId(edge.hopOffStopIndex);
    const fromNodeId = this.stationNodeId(fromStopId);
    const toNodeId = this.stationNodeId(toStopId);
    const roundColor = this.getRoundColor(edge.round);
    const routeOvalId = this.vehicleEdgeNodeId(edge.cell);

    const serviceRouteInfo = this.result.timetable.getServiceRouteInfo(route);
    const routeName = serviceRouteInfo.name;
    const routeType = routeTypeToString(serviceRouteInfo.type);

    const departureTime = timeToString(
      route.departureFrom(edge.stopIndex, edge.tripIndex),
    );
    const arrivalTime = timeToString(edge.arrival);

    const routeInfo = `${edge.routeId}:${edge.tripIndex}`;
    const ovalLabel = `${routeType} ${routeName}\n${routeInfo}\n${departureTime} → ${arrivalTime}`;

    builder
      .addNode(routeOvalId, {
        label: ovalLabel,
        shape: 'oval',
        style: 'filled',
        fillcolor: 'white',
        color: roundColor,
      })
      .addEdge(fromNodeId, routeOvalId, { color: roundColor })
      .addEdge(routeOvalId, toNodeId, { color: roundColor });
  }

  private addAccessEdge(builder: DotBuilder, edge: AccessEdge): void {
    const fromNodeId = this.stationNodeId(edge.from);
    const toNodeId = this.stationNodeId(edge.to);
    const color = DOT_CONFIG.colors.defaultRound;
    const ovalId = this.accessEdgeNodeId(edge.cell);
    const label = `Walk\n${durationToString(edge.duration)}`;

    builder
      .addNode(ovalId, {
        label,
        shape: 'oval',
        style: 'dashed,filled',
        fillcolor: 'white',
        color,
      })
      .addEdge(fromNodeId, ovalId, { color, style: 'dashed' })
      .addEdge(ovalId, toNodeId, { color, style: 'dashed' });
  }

  private addTransferEdge(builder: DotBuilder, edge: TransferEdge): void {
    const fromNodeId = this.stationNodeId(edge.from);
    const toNodeId = this.stationNodeId(edge.to);
    const roundColor = this.getRoundColor(edge.round);
    const transferOvalId = this.transferEdgeNodeId(edge.cell);

    const transferTime =
      edge.minTransferTime !== undefined
        ? durationToString(edge.minTransferTime)
        : 'N/A';
    const ovalLabel = `Transfer\n${transferTime}`;

    builder
      .addNode(transferOvalId, {
        label: ovalLabel,
        shape: 'oval',
        style: 'dashed,filled',
        fillcolor: 'white',
        color: roundColor,
      })
      .addEdge(fromNodeId, transferOvalId, {
        color: roundColor,
        style: 'dashed',
      })
      .addEdge(transferOvalId, toNodeId, {
        color: roundColor,
        style: 'dashed',
      });
  }

  private addContinuationEdge(
    builder: DotBuilder,
    fromEdge: VehicleEdge,
    toEdge: VehicleEdge,
  ): void {
    const fromStopId = this.getVehicleEdgeToStopId(fromEdge);
    const toStopId = this.getVehicleEdgeFromStopId(toEdge);
    if (fromStopId === undefined || toStopId === undefined) {
      return;
    }

    const fromStationId = this.stationNodeId(fromStopId);
    const toStationId = this.stationNodeId(toStopId);
    const roundColor = this.getRoundColor(toEdge.round);
    const continuationOvalId = this.continuationNodeId(fromEdge, toEdge);

    const fromRoute = this.result.timetable.getRoute(fromEdge.routeId);
    const toRoute = this.result.timetable.getRoute(toEdge.routeId);

    const fromServiceRouteInfo = fromRoute
      ? this.result.timetable.getServiceRouteInfo(fromRoute)
      : null;
    const toServiceRouteInfo = toRoute
      ? this.result.timetable.getServiceRouteInfo(toRoute)
      : null;

    const fromRouteName =
      fromServiceRouteInfo?.name ?? `Route ${String(fromEdge.routeId)}`;
    const toRouteName =
      toServiceRouteInfo?.name ?? `Route ${String(toEdge.routeId)}`;

    const fromRouteType = fromServiceRouteInfo
      ? routeTypeToString(fromServiceRouteInfo.type)
      : 'UNKNOWN';
    const toRouteType = toServiceRouteInfo
      ? routeTypeToString(toServiceRouteInfo.type)
      : 'UNKNOWN';

    const fromArrivalTime = timeToString(fromEdge.arrival);
    const toDepartureTime = toRoute
      ? timeToString(toRoute.departureFrom(toEdge.stopIndex, toEdge.tripIndex))
      : 'N/A';

    const fromRouteInfo = `${fromEdge.routeId}:${fromEdge.tripIndex}`;
    const toRouteInfo = `${toEdge.routeId}:${toEdge.tripIndex}`;

    const ovalLabel = `${fromRouteType} ${fromRouteName} (${fromRouteInfo}) ${fromArrivalTime}\n↓\n${toRouteType} ${toRouteName} (${toRouteInfo}) ${toDepartureTime}`;

    const { continuationFill } = DOT_CONFIG.colors;
    const { continuation: penWidth, continuationEdge: edgePenWidth } =
      DOT_CONFIG.penWidth;

    builder
      .addNode(continuationOvalId, {
        label: ovalLabel,
        shape: 'oval',
        style: 'filled,bold',
        fillcolor: continuationFill,
        color: roundColor,
        penwidth: penWidth,
      })
      .addEdge(fromStationId, continuationOvalId, {
        color: roundColor,
        style: 'bold',
        penwidth: edgePenWidth,
      })
      .addEdge(continuationOvalId, toStationId, {
        color: roundColor,
        style: 'bold',
        penwidth: edgePenWidth,
      });
  }

  private collectStations(): Set<StopId> {
    const stations = new Set<StopId>();
    for (const entry of this.entries()) {
      stations.add(entry.stop);

      switch (entry.kind) {
        case 'origin':
          stations.add(entry.stopId);
          break;
        case 'access':
        case 'transfer':
          stations.add(entry.from);
          stations.add(entry.to);
          break;
        case 'vehicle': {
          const fromStopId = this.getVehicleEdgeFromStopId(entry);
          const toStopId = this.getVehicleEdgeToStopId(entry);
          if (fromStopId !== undefined) stations.add(fromStopId);
          if (toStopId !== undefined) stations.add(toStopId);
          break;
        }
      }
    }

    return stations;
  }

  private addContinuationChain(builder: DotBuilder, edge: VehicleEdge): void {
    let currentEdge = edge;
    let previousEdge = edge.continuationOf;

    while (previousEdge) {
      this.addContinuationEdge(builder, previousEdge, currentEdge);

      currentEdge = previousEdge;
      previousEdge = previousEdge.continuationOf;
    }
  }

  private addEdges(builder: DotBuilder): void {
    const continuationEdges: VehicleEdge[] = [];

    for (const entry of this.entries()) {
      switch (entry.kind) {
        case 'origin':
          break;
        case 'access':
          this.addAccessEdge(builder, entry);
          break;
        case 'vehicle':
          this.addVehicleEdge(builder, entry);

          if (entry.continuationOf) {
            continuationEdges.push(entry);
          }
          break;
        case 'transfer':
          this.addTransferEdge(builder, entry);
          break;
      }
    }

    for (const edge of continuationEdges) {
      this.addContinuationChain(builder, edge);
    }
  }

  /**
   * Plots the routing graph as a DOT graph for visualization.
   *
   * @returns A string containing the DOT graph representation.
   */
  plotDotGraph(): string {
    const stations = this.collectStations();

    const builder = new DotBuilder();
    builder.addHeader();
    builder.addComment('Stations');

    for (const stopId of stations) {
      this.addStationNode(builder, stopId);
    }

    builder.addComment('Edges');
    this.addEdges(builder);

    return builder.build();
  }
}
