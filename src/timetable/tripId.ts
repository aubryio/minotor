import { RouteId, TripRouteIndex } from './route.js';

// const ROUTE_ID_BITS = 17;
const TRIP_INDEX_BITS = 15;
const TRIP_INDEX_MASK = (1 << TRIP_INDEX_BITS) - 1;

// A TripId encodes a route ID and trip index into a value
export type TripId = number;

export type Trip = {
  routeId: RouteId;
  tripIndex: TripRouteIndex;
};

/**
 * Encodes a route ID and trip index into a single trip ID.
 * @param routeId - The route identifier, needs to fit on 17 bits
 * @param tripIndex - The index of the trip within the route, needs to fit on 15 bits
 * @returns The encoded trip ID
 */
export const encode = (routeId: RouteId, tripIndex: TripRouteIndex): TripId => {
  return (routeId << TRIP_INDEX_BITS) | tripIndex;
};

/**
 * Decodes a trip ID back into its constituent route ID and trip index.
 * @param tripId - The encoded trip ID
 * @returns A tuple containing the route ID and trip index
 */
export const decode = (tripId: TripId): [RouteId, TripRouteIndex] => {
  const routeId = tripId >>> TRIP_INDEX_BITS;
  const tripIndex = tripId & TRIP_INDEX_MASK;
  return [routeId, tripIndex];
};
