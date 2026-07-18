import { RouteId } from '../../route.js';
import { StopAdjacency, TransferId } from '../../timetable.js';

export const stopAdjacency = (
  routeIds: Iterable<RouteId> = [],
  transferIds: Iterable<TransferId> = [],
): StopAdjacency => ({
  routeIds: Uint32Array.from(routeIds),
  transferIds: Uint32Array.from(transferIds),
});
