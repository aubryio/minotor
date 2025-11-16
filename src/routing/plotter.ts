import { StopId } from '../stops/stops.js';
import { Result } from './result.js';
import { RoutingEdge, TransferEdge, VehicleEdge } from './router.js';

export class Plotter {
  private result: Result;
  private readonly ROUND_COLORS = [
    '#60a5fa', // Round 1
    '#ff9800', // Round 2
    '#14b8a6', // Round 3
    '#fb7185', // Round 4
    '#ffdf00', // Round 5
    '#b600ff', // Round 6
    '#ee82ee', // Round 7+
  ];

  constructor(result: Result) {
    this.result = result;
  }

  /**
   * Gets the color for a round based on the specified palette.
   */
  private getRoundColor(round: number): string {
    if (round === 0) return '#888888';

    const colorIndex = Math.min(round - 1, this.ROUND_COLORS.length - 1);
    return this.ROUND_COLORS[colorIndex] ?? '#ee82ee';
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
   * Determines station type (origin/destination) information.
   */
  private getStationInfo(stopId: StopId): {
    isOrigin: boolean;
    isDestination: boolean;
  } {
    const isOrigin = this.result.routingState.graph[0]?.has(stopId) ?? false;
    const isDestination =
      this.result.routingState.destinations.includes(stopId);
    return { isOrigin, isDestination };
  }

  /**
   * Formats a stop name for display, including platform information.
   */
  private formatStopName(stopId: StopId): string {
    const stop = this.result.stopsIndex.findStopById(stopId);
    if (!stop) return `Unknown Stop (${stopId})`;

    const escapedName = this.escapeDotString(stop.name);
    const escapedPlatform = stop.platform
      ? this.escapeDotString(stop.platform)
      : '';
    return escapedPlatform
      ? `${escapedName}\\nPl. ${escapedPlatform}`
      : escapedName;
  }

  /**
   * Gets the appropriate fill color for a station based on its type.
   */
  private getStationFillColor(
    isOrigin: boolean,
    isDestination: boolean,
  ): string {
    if (isOrigin) return '#60a5fa';
    if (isDestination) return '#ee82ee';
    return 'white';
  }

  /**
   * Creates a DOT node for a station.
   */
  private createStationNode(stopId: StopId): string {
    const stop = this.result.stopsIndex.findStopById(stopId);
    if (!stop) return '';

    const displayName = this.formatStopName(stopId);
    const stopIdStr = this.escapeDotString(String(stopId));
    const nodeId = `s_${stopId}`;
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
    const fromNodeId = `s_${edge.stopIndex}`;
    const toNodeId = `s_${edge.hopOffStopIndex}`;
    const roundColor = this.getRoundColor(round);
    const routeOvalId = `e_${edge.stopIndex}_${edge.hopOffStopIndex}_${edge.routeId}_${round}`;

    const route = this.result.timetable.getRoute(edge.routeId);
    const serviceRouteInfo = route
      ? this.result.timetable.getServiceRouteInfo(route)
      : null;

    const routeName = serviceRouteInfo?.name ?? `Route ${String(edge.routeId)}`;
    const routeType = serviceRouteInfo?.type || 'UNKNOWN';

    const departureTime = route
      ? route.departureFrom(edge.stopIndex, edge.tripIndex).toString()
      : 'N/A';
    const arrivalTime = edge.arrival.toString();

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
   * Creates a transfer edge with transfer information oval in the middle.
   */
  private createTransferEdge(edge: TransferEdge, round: number): string[] {
    const fromNodeId = `s_${edge.from}`;
    const toNodeId = `s_${edge.to}`;
    const roundColor = this.getRoundColor(round);
    const transferOvalId = `e_${edge.from}_${edge.to}_${round}`;

    const transferTime = edge.minTransferTime?.toString() || 'N/A';
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
    const fromStationId = `s_${fromEdge.hopOffStopIndex}`;
    const toStationId = `s_${toEdge.stopIndex}`;
    const roundColor = this.getRoundColor(round);
    const continuationOvalId = `continuation_${fromEdge.hopOffStopIndex}_${toEdge.stopIndex}_${round}`;

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

    const fromRouteType = fromServiceRouteInfo?.type || 'UNKNOWN';
    const toRouteType = toServiceRouteInfo?.type || 'UNKNOWN';

    const fromArrivalTime = fromEdge.arrival.toString();
    const toDepartureTime = toRoute
      ? toRoute.departureFrom(toEdge.stopIndex, toEdge.tripIndex).toString()
      : 'N/A';

    const escapedFromRouteName = this.escapeDotString(fromRouteName);
    const escapedToRouteName = this.escapeDotString(toRouteName);
    const escapedFromRouteType = this.escapeDotString(fromRouteType);
    const escapedToRouteType = this.escapeDotString(toRouteType);

    const fromRouteInfo = `${fromEdge.routeId}:${fromEdge.tripIndex}`;
    const toRouteInfo = `${toEdge.routeId}:${toEdge.tripIndex}`;

    const ovalLabel = `${escapedFromRouteType} ${escapedFromRouteName} (${fromRouteInfo}) ${fromArrivalTime}\\n↓\\n${escapedToRouteType} ${escapedToRouteName} (${toRouteInfo}) ${toDepartureTime}`;

    return [
      `  "${continuationOvalId}" [label="${ovalLabel}" shape=oval style="filled,bold" fillcolor="#ffffcc" color="${roundColor}" penwidth="2"];`,
      `  "${fromStationId}" -> "${continuationOvalId}" [color="${roundColor}" style="bold" penwidth="3"];`,
      `  "${continuationOvalId}" -> "${toStationId}" [color="${roundColor}" style="bold" penwidth="3"];`,
    ];
  }

  /**
   * Collects all stations and edges for the graph.
   */
  private collectGraphData(): {
    stations: Set<StopId>;
    edges: string[];
  } {
    const stations = new Set<StopId>();
    const edges: string[] = [];
    const continuationEdges: string[] = [];
    const graph: Map<StopId, RoutingEdge>[] = this.result.routingState.graph;

    // Collect all stops that appear in the graph
    graph.forEach((roundMap) => {
      roundMap.forEach((edge, stopId) => {
        stations.add(stopId);
        if ('stopIndex' in edge && 'hopOffStopIndex' in edge) {
          stations.add(edge.stopIndex);
          stations.add(edge.hopOffStopIndex);
        }
      });
    });

    // Create edges for each round
    graph.forEach((roundMap, round) => {
      if (round === 0) {
        // Skip round 0 as it contains only origin nodes
        return;
      }

      roundMap.forEach((edge) => {
        if ('stopIndex' in edge && 'hopOffStopIndex' in edge) {
          if ('routeId' in edge) {
            const vehicleEdgeParts = this.createVehicleEdge(edge, round);
            edges.push(...vehicleEdgeParts);
            if (edge.continuationOf) {
              let currentEdge = edge;
              let previousEdge: VehicleEdge | undefined = edge.continuationOf;

              while (previousEdge) {
                const continuationEdgeParts = this.createContinuationEdge(
                  previousEdge,
                  currentEdge,
                  round,
                );
                continuationEdges.push(...continuationEdgeParts);

                currentEdge = previousEdge;
                previousEdge = previousEdge.continuationOf;
              }
            }
          } else {
            const transferEdgeParts = this.createTransferEdge(edge, round);
            edges.push(...transferEdgeParts);
          }
        }
      });
    });
    edges.push(...continuationEdges);

    return { stations, edges };
  }

  /**
   * Plots the routing graph as a DOT graph for visualization.
   */
  plotDotGraph(): string {
    const { stations, edges } = this.collectGraphData();

    const dotParts = [
      'digraph RoutingGraph {',
      '  graph [overlap=false, splines=true, rankdir=TB, bgcolor=white, nodesep=0.8, ranksep=1.2, concentrate=true];',
      '  node [fontname="Arial" margin=0.1];',
      '  edge [fontname="Arial" fontsize=10];',
      '',
      '  // Stations',
    ];

    stations.forEach((stopId) => {
      const stationNode = this.createStationNode(stopId);
      if (stationNode) {
        dotParts.push(stationNode);
      }
    });

    dotParts.push('', '  // Edges');
    dotParts.push(...edges);

    dotParts.push('}');
    return dotParts.join('\n');
  }
}
