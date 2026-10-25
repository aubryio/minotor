import type {
  AccessEdge,
  RoutingEdge,
  TransferEdge,
  VehicleEdge,
} from './state.js';

/**
 * Type guard to check if an edge is a VehicleEdge.
 */
export function isVehicleEdge(edge: RoutingEdge): edge is VehicleEdge {
  return 'routeId' in edge && 'stopIndex' in edge && 'hopOffStopIndex' in edge;
}

/**
 * Type guard to check if an edge is a TransferEdge.
 */
export function isTransferEdge(edge: RoutingEdge): edge is TransferEdge {
  return 'from' in edge && 'to' in edge && 'type' in edge;
}

/**
 * Type guard to check if an edge is an AccessEdge (walking access leg).
 */
export function isAccessEdge(edge: RoutingEdge): edge is AccessEdge {
  return 'from' in edge && 'duration' in edge;
}
