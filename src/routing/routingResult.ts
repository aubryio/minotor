import type { StopId } from '../stops/stops.js';
import type { Route } from './route.js';
import type { Arrival } from './state.js';

export type StopArrival = Arrival & { stop: StopId };

/**
 * Common earliest-arrival operations for single-departure and range results.
 */
export interface RoutingResult {
  /**
   * Earliest arrival at a stop or an equivalent stop, optionally limited by
   * transfer count. Returns undefined when no matching stop was reached.
   */
  arrivalAt(stop: StopId, maxTransfers?: number): Arrival | undefined;

  /**
   * Iterates once over each reached concrete stop and its earliest arrival.
   * Destination pruning may limit coverage. Each call returns a fresh iterator.
   * @param maxTransfers Optional transfer limit within retained data.
   */
  arrivals(maxTransfers?: number): IterableIterator<StopArrival>;

  /**
   * Reconstructs the earliest-arriving route to the given or default
   * destinations. Returns undefined when none
   * were reached or when no destinations were provided.
   * @param maxTransfers Optional transfer limit within retained data.
   */
  bestRoute(
    to?: StopId | Set<StopId>,
    maxTransfers?: number,
  ): Route | undefined;
}
