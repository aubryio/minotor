import { RouteId, StopRouteIndex, TripRouteIndex } from './route.js';

/** Construction-only key. Timetable lookups use dense numeric occurrence IDs. */
export type TripStopId = string;

export const encode = (
  stopIndex: StopRouteIndex,
  routeId: RouteId,
  tripIndex: TripRouteIndex,
): TripStopId => {
  for (const value of [stopIndex, routeId, tripIndex]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid trip occurrence');
  }
  return `${stopIndex}:${routeId}:${tripIndex}`;
};

export const decode = (
  id: TripStopId,
): [StopRouteIndex, RouteId, TripRouteIndex] => {
  const values = id.split(':').map(Number);
  if (
    values.length !== 3 ||
    values.some((v) => !Number.isSafeInteger(v) || v < 0)
  ) {
    throw new Error('Invalid trip occurrence');
  }
  return values as [StopRouteIndex, RouteId, TripRouteIndex];
};
export const getStopIndex = (id: TripStopId): StopRouteIndex => decode(id)[0];
export const getRouteId = (id: TripStopId): RouteId => decode(id)[1];
export const getTripIndex = (id: TripStopId): TripRouteIndex => decode(id)[2];
