import { RouteId, StopRouteIndex, TripRouteIndex } from './route.js';

/** Construction-only key. Timetable lookups use dense numeric trip stop IDs. */
export type TripStopKey = string;

/**
 * Encode nonnegative safe-integer stop, route, and trip indices as a
 * construction-only key.
 */
export const encode = (
  stopIndex: StopRouteIndex,
  routeId: RouteId,
  tripIndex: TripRouteIndex,
): TripStopKey => {
  for (const value of [stopIndex, routeId, tripIndex]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid trip stop');
  }
  return `${stopIndex}:${routeId}:${tripIndex}`;
};

/**
 * Decode a construction key into stop, route, and trip indices, rejecting
 * invalid numeric components.
 */
export const decode = (
  id: TripStopKey,
): [StopRouteIndex, RouteId, TripRouteIndex] => {
  const values = id.split(':').map(Number);
  if (
    values.length !== 3 ||
    values.some((v) => !Number.isSafeInteger(v) || v < 0)
  ) {
    throw new Error('Invalid trip stop');
  }
  return values as [StopRouteIndex, RouteId, TripRouteIndex];
};
/** Extract the route-local stop index from a construction key. */
export const getStopIndex = (id: TripStopKey): StopRouteIndex => decode(id)[0];
/** Extract the route ID from a construction key. */
export const getRouteId = (id: TripStopKey): RouteId => decode(id)[1];
/** Extract the route-local trip index from a construction key. */
export const getTripIndex = (id: TripStopKey): TripRouteIndex => decode(id)[2];
