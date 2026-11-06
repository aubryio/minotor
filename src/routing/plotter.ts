import { StopId } from '../stops/stops.js';
import { durationToString, timeToString } from '../timetable/time.js';
import { routeTypeToString } from '../timetable/timetable.js';
import { Result } from './result.js';
import { resultGraph } from './resultInternals.js';
import {
  AccessEdge,
  RoutingEdge,
  TransferEdge,
  VehicleEdge,
} from './router.js';

/**
 * Configuration for DOT graph styling.
 */
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

/**
 * Type guard to check if an edge is a VehicleEdge.
 */
function isVehicleEdge(edge: RoutingEdge): edge is VehicleEdge {
  return 'routeId' in edge && 'stopIndex' in edge && 'hopOffStopIndex' in edge;
}

/**
 * Type guard to check if an edge is a TransferEdge.
 */
function isTransferEdge(edge: RoutingEdge): edge is TransferEdge {
  return 'from' in edge && 'to' in edge && 'type' in edge;
}

/**
 * Type guard to check if an edge is an AccessEdge (walking access leg).
 */
function isAccessEdge(edge: RoutingEdge): edge is AccessEdge {
  return 'from' in edge && 'duration' in edge;
}

/**
 * Helper class for building DOT graph syntax.
 */
class DotBuilder {
  private lines: string[] = [];

  /**
   * Adds the DOT graph header with default styling.
   */
  addHeader(): this {
    this.lines.push(
      'digraph RoutingGraph {',
      '  graph [overlap=false, splines=true, rankdir=TB, bgcolor=white, nodesep=0.8, ranksep=1.2, concentrate=true];',
      '  node [fontname="Arial" margin=0.1];',
      '  edge [fontname="Arial" fontsize=10];',
    );
    return this;
  }

  /**
   * Adds a comment section to the graph.
   */
  addComment(comment: string): this {
    this.lines.push('', `  // ${comment}`);
    return this;
  }

  /**
   * Adds a node with the given attributes.
   */
  addNode(id: string, attrs: Record<string, string>): this {
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    this.lines.push(`  "${id}" [${attrStr}];`);
    return this;
  }

  /**
   * Adds an edge between two nodes with optional attributes.
   */
  addEdge(from: string, to: string, attrs: Record<string, string> = {}): this {
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${v}"`)
      .join(' ');
    const attrPart = attrStr ? ` [${attrStr}]` : '';
    this.lines.push(`  "${from}" -> "${to}"${attrPart};`);
    return this;
  }

  /**
   * Adds raw lines to the graph.
   */
  addRaw(lines: string[]): this {
    this.lines.push(...lines);
    return this;
  }

  /**
   * Builds the final DOT graph string.
   */
  build(): string {
    this.lines.push('}');
    return this.lines.join('\n');
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
  private readonly edgeIds = new Map<RoutingEdge, number>();

  /**
   * Assign a stable node ID by edge identity within one plot, including
   * non-winning predecessors.
   */
  private edgeId(edge: RoutingEdge): string {
    let id = this.edgeIds.get(edge);
    if (id === undefined) {
      id = this.edgeIds.size;
      this.edgeIds.set(edge, id);
    }
    return `edge_${id}`;
  }

  constructor(result: Result) {
    this.result = result;
  }

  /**
   * Generates a unique node ID for a station.
   */
  private stationNodeId(stopId: StopId): string {
    return `s_${stopId}`;
  }

  /**
   * Generates a unique node ID for a walking access edge oval.
   */
  private accessEdgeNodeId(fromStopId: StopId, toStopId: StopId): string {
    return `access_${fromStopId}_${toStopId}`;
  }

  /**
   * Gets the color for a round based on the configured palette.
   */
  private getRoundColor(round: number): string {
    if (round === 0) {
      return DOT_CONFIG.colors.defaultRound;
    }

    const colorIndex = Math.min(round - 1, DOT_CONFIG.colors.rounds.length - 1);
    return DOT_CONFIG.colors.rounds[colorIndex] ?? '#ee82ee';
  }

  /**
   * Gets the appropriate fill color for a station based on its type.
   */
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

  /**
   * Escapes special characters in DOT strings to prevent syntax errors.
   */
  private escapeDotString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Formats a stop name for display, including platform information.
   */
  private formatStopName(stopId: StopId): string {
    const stop = this.result.stopsIndex.findStopById(stopId);
    if (!stop) {
      return `Unknown Stop (${stopId})`;
    }

    const escapedName = this.escapeDotString(stop.name);
    const escapedPlatform = stop.platform
      ? this.escapeDotString(stop.platform)
      : '';

    return escapedPlatform
      ? `${escapedName}\\nPl. ${escapedPlatform}`
      : escapedName;
  }

  /**
   * Determines station type (origin/destination) information.
   */
  private getStationInfo(stopId: StopId): {
    isOrigin: boolean;
    isDestination: boolean;
  } {
    const { graph, destinations } = this.result[resultGraph]();
    const isOrigin = graph[0]?.[stopId] !== undefined;
    const isDestination = destinations.includes(stopId);
    return { isOrigin, isDestination };
  }

  /**
   * Resolves the actual StopId from a VehicleEdge's stopIndex.
   */
  private getVehicleEdgeFromStopId(edge: VehicleEdge): StopId | undefined {
    const route = this.result.timetable.getRoute(edge.routeId);
    return route?.stopId(edge.stopIndex);
  }

  /**
   * Resolves the actual StopId from a VehicleEdge's hopOffStopIndex.
   */
  private getVehicleEdgeToStopId(edge: VehicleEdge): StopId | undefined {
    const route = this.result.timetable.getRoute(edge.routeId);
    return route?.stopId(edge.hopOffStopIndex);
  }

  /**
   * Creates a DOT node for a station.
   */
  private createStationNode(stopId: StopId): string | null {
    const stop = this.result.stopsIndex.findStopById(stopId);
    if (!stop) {
      return null;
    }

    const displayName = this.formatStopName(stopId);
    const stopIdStr = this.escapeDotString(String(stopId));
    const nodeId = this.stationNodeId(stopId);
    const stationInfo = this.getStationInfo(stopId);
    const fillColor = this.getStationFillColor(
      stationInfo.isOrigin,
      stationInfo.isDestination,
    );

    return `  "${nodeId}" [label="${displayName}\\n${stopIdStr}" shape=box style=filled fillcolor="${fillColor}"];`;
  }

  /**
   * Creates a vehicle edge with route information oval in the middle.
   */
  private createVehicleEdge(edge: VehicleEdge, round: number): string[] {
    const route = this.result.timetable.getRoute(edge.routeId);
    if (!route) {
      return [];
    }

    const fromStopId = route.stopId(edge.stopIndex);
    const toStopId = route.stopId(edge.hopOffStopIndex);
    const fromNodeId = this.stationNodeId(fromStopId);
    const toNodeId = this.stationNodeId(toStopId);
    const roundColor = this.getRoundColor(round);
    const routeOvalId = this.edgeId(edge);

    const serviceRouteInfo = this.result.timetable.getServiceRouteInfo(route);
    const routeName = serviceRouteInfo.name;
    const routeType = routeTypeToString(serviceRouteInfo.type);

    const departureTime = timeToString(
      route.departureFrom(edge.stopIndex, edge.tripIndex),
    );
    const arrivalTime = timeToString(edge.arrival);

    const escapedRouteName = this.escapeDotString(routeName);
    const escapedRouteType = this.escapeDotString(routeType);
    const routeInfo = `${edge.routeId}:${edge.tripIndex}`;
    const ovalLabel = `${escapedRouteType} ${escapedRouteName}\\n${routeInfo}\\n${departureTime} → ${arrivalTime}`;

    return [
      `  "${routeOvalId}" [label="${ovalLabel}" shape=oval style=filled fillcolor="white" color="${roundColor}"];`,
      `  "${fromNodeId}" -> "${routeOvalId}" [color="${roundColor}"];`,
      `  "${routeOvalId}" -> "${toNodeId}" [color="${roundColor}"];`,
    ];
  }

  /**
   * Creates a walking access leg as a dashed oval connecting the query origin
   * to the initial boarding stop.
   */
  private createAccessEdge(edge: AccessEdge): string[] {
    const fromNodeId = this.stationNodeId(edge.from);
    const toNodeId = this.stationNodeId(edge.to);
    const color = DOT_CONFIG.colors.defaultRound;
    const ovalId = this.accessEdgeNodeId(edge.from, edge.to);
    const label = `Walk\\n${durationToString(edge.duration)}`;

    return [
      `  "${ovalId}" [label="${label}" shape=oval style="dashed,filled" fillcolor="white" color="${color}"];`,
      `  "${fromNodeId}" -> "${ovalId}" [color="${color}" style="dashed"];`,
      `  "${ovalId}" -> "${toNodeId}" [color="${color}" style="dashed"];`,
    ];
  }

  /**
   * Creates a transfer edge with transfer information oval in the middle.
   */
  private createTransferEdge(edge: TransferEdge, round: number): string[] {
    const fromNodeId = this.stationNodeId(edge.from);
    const toNodeId = this.stationNodeId(edge.to);
    const roundColor = this.getRoundColor(round);
    const transferOvalId = this.edgeId(edge);

    const transferTime =
      edge.minTransferTime !== undefined
        ? durationToString(edge.minTransferTime)
        : 'N/A';
    const escapedTransferTime = this.escapeDotString(transferTime);
    const ovalLabel = `Transfer\\n${escapedTransferTime}`;

    return [
      `  "${transferOvalId}" [label="${ovalLabel}" shape=oval style="dashed,filled" fillcolor="white" color="${roundColor}"];`,
      `  "${fromNodeId}" -> "${transferOvalId}" [color="${roundColor}" style="dashed"];`,
      `  "${transferOvalId}" -> "${toNodeId}" [color="${roundColor}" style="dashed"];`,
    ];
  }

  /**
   * Creates a continuation edge to visually link trip continuations.
   */
  private createContinuationEdge(
    fromEdge: VehicleEdge,
    toEdge: VehicleEdge,
    round: number,
  ): string[] {
    const fromStopId = this.getVehicleEdgeToStopId(fromEdge);
    const toStopId = this.getVehicleEdgeFromStopId(toEdge);
    if (fromStopId === undefined || toStopId === undefined) {
      return [];
    }

    const fromStationId = this.stationNodeId(fromStopId);
    const toStationId = this.stationNodeId(toStopId);
    const roundColor = this.getRoundColor(round);
    const continuationOvalId = `continuation_${this.edgeId(toEdge)}`;

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

    const escapedFromRouteName = this.escapeDotString(fromRouteName);
    const escapedToRouteName = this.escapeDotString(toRouteName);
    const escapedFromRouteType = this.escapeDotString(fromRouteType);
    const escapedToRouteType = this.escapeDotString(toRouteType);

    const fromRouteInfo = `${fromEdge.routeId}:${fromEdge.tripIndex}`;
    const toRouteInfo = `${toEdge.routeId}:${toEdge.tripIndex}`;

    const ovalLabel = `${escapedFromRouteType} ${escapedFromRouteName} (${fromRouteInfo}) ${fromArrivalTime}\\n↓\\n${escapedToRouteType} ${escapedToRouteName} (${toRouteInfo}) ${toDepartureTime}`;

    const { continuationFill } = DOT_CONFIG.colors;
    const { continuation: penWidth, continuationEdge: edgePenWidth } =
      DOT_CONFIG.penWidth;

    return [
      `  "${continuationOvalId}" [label="${ovalLabel}" shape=oval style="filled,bold" fillcolor="${continuationFill}" color="${roundColor}" penwidth="${penWidth}"];`,
      `  "${fromStationId}" -> "${continuationOvalId}" [color="${roundColor}" style="bold" penwidth="${edgePenWidth}"];`,
      `  "${continuationOvalId}" -> "${toStationId}" [color="${roundColor}" style="bold" penwidth="${edgePenWidth}"];`,
    ];
  }

  /**
   * Collects stations and rendered edges, following predecessors that may not win a stop label.
   */
  private collectGraph(): { stations: Set<StopId>; edges: string[] } {
    const stations = new Set<StopId>();
    const edges: string[] = [];
    const seen = new Set<RoutingEdge>();
    const pending: { edge: RoutingEdge; round: number }[] = [];
    const graph = this.result[resultGraph]().graph;
    for (let round = 0; round < graph.length; round++) {
      for (const edge of graph[round] ?? [])
        if (edge) pending.push({ edge, round });
    }
    for (let i = 0; i < pending.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { edge, round } = pending[i]!;
      if (seen.has(edge)) continue;
      seen.add(edge);
      if (isVehicleEdge(edge)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const route = this.result.timetable.getRoute(edge.routeId)!;
        stations.add(route.stopId(edge.stopIndex));
        stations.add(route.stopId(edge.hopOffStopIndex));
        edges.push(...this.createVehicleEdge(edge, round));
        if (edge.continuationOf)
          edges.push(
            ...this.createContinuationEdge(edge.continuationOf, edge, round),
          );
        pending.push({
          edge: edge.predecessor,
          round: edge.continuationOf ? round : round - 1,
        });
      } else if (isTransferEdge(edge)) {
        stations.add(edge.from);
        stations.add(edge.to);
        edges.push(...this.createTransferEdge(edge, round));
        pending.push({ edge: edge.predecessor, round });
      } else if (isAccessEdge(edge)) {
        stations.add(edge.from);
        stations.add(edge.to);
        edges.push(...this.createAccessEdge(edge));
      } else {
        stations.add(edge.stopId);
      }
    }
    return { stations, edges };
  }

  /**
   * Plots the routing graph as a DOT graph for visualization.
   *
   * @returns A string containing the DOT graph representation.
   */
  plotDotGraph(): string {
    this.edgeIds.clear();
    const { stations, edges } = this.collectGraph();

    const builder = new DotBuilder();
    builder.addHeader();
    builder.addComment('Stations');

    for (const stopId of stations) {
      const stationNode = this.createStationNode(stopId);
      if (stationNode) {
        builder.addRaw([stationNode]);
      }
    }

    builder.addComment('Edges');
    builder.addRaw(edges);

    return builder.build();
  }
}
