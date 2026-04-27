import { StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { NOT_AVAILABLE } from '../timetable/route.js';
import { Duration, Time } from '../timetable/time.js';
import { Timetable } from '../timetable/timetable.js';

/**
 * An access path from the query origin to an initial boarding stop.
 *
 * Equivalent origin stops (reached at zero cost) have no `duration`.
 * Stops reachable via a timed walking transfer carry a `duration` in minutes.
 */
export type AccessPoint = {
  fromStopId: StopId;
  toStopId: StopId;
  duration: Duration;
};

/**
 * Collects access paths from a query origin and resolves the set of
 * distinct departure-time slots for Range RAPTOR.
 */
export class AccessFinder {
  private readonly timetable: Timetable;
  private readonly stopsIndex: StopsIndex;

  constructor(timetable: Timetable, stopsIndex: StopsIndex) {
    this.timetable = timetable;
    this.stopsIndex = stopsIndex;
  }

  /**
   * Returns every initial access path from the query origin: equivalent stops
   * (no duration) plus every stop reachable via a single timed walking transfer
   * (REQUIRES_MINIMAL_TIME), keeping the shortest walk when multiple origins
   * can reach the same stop.
   *
   * @param origin                  Origin stop ID.
   * @param fallbackMinTransferTime Transfer time used when a walking transfer
   *                                has no explicit `minTransferTime` in the timetable data.
   */
  collectAccessPaths(
    queryOrigin: StopId,
    fallbackMinTransferTime: Duration,
  ): AccessPoint[] {
    const equivalentOrigins = this.stopsIndex
      .equivalentStops(queryOrigin)
      .map((stop) => stop.id);

    const accessPaths = new Map<StopId, AccessPoint>();
    for (const origin of equivalentOrigins) {
      const existingAccess = accessPaths.get(origin);
      if (existingAccess === undefined || existingAccess.duration > 0) {
        accessPaths.set(origin, {
          fromStopId: origin,
          toStopId: origin,
          duration: 0,
        });
      }
      for (const transfer of this.timetable.getTransfers(origin)) {
        if (transfer.type === 'REQUIRES_MINIMAL_TIME') {
          const duration = transfer.minTransferTime ?? fallbackMinTransferTime;
          const existingAccess = accessPaths.get(transfer.destination);
          // Keep the shortest walk to maximize the set of reachable trips.
          if (
            existingAccess === undefined ||
            (existingAccess.duration && duration < existingAccess.duration)
          ) {
            accessPaths.set(transfer.destination, {
              fromStopId: origin,
              toStopId: transfer.destination,
              duration,
            });
          }
        }
      }
    }
    return Array.from(accessPaths.values());
  }

  /**
   * Collects all distinct origin departure times within `[from, to]`
   * (inclusive) and, for each slot, the specific access paths that directly
   * induce it — i.e. paths whose boarded stop has a boardable trip departing
   * at exactly `depTime + path.duration`.
   *
   * Returned array is sorted **latest-first**. The Range RAPTOR outer loop
   * seeds only the responsible paths for each slot, avoiding redundant
   * exploration of access stops whose boarding opportunities belong to a
   * later slot and whose journeys would therefore be dominated by it.
   *

   * @param accessPaths Access paths from the origin to initial boarding stops.
   * @param from        Earliest origin departure time (inclusive).
   * @param to          Latest origin departure time (inclusive).
   */
  collectDepartureTimes(
    accessPaths: AccessPoint[],
    from: Time,
    to: Time,
  ): { depTime: Time; legs: AccessPoint[] }[] {
    // Map from origin-departure-time → the set of access paths that induce it.
    const slotMap = new Map<Time, Set<AccessPoint>>();

    for (const path of accessPaths) {
      const { toStopId } = path;
      // Trips from this stop must depart in [from + duration, to + duration]
      // so that the corresponding origin departure (dep - duration) falls in
      // [from, to].
      const searchFrom = from + path.duration;
      const searchTo = to + path.duration;
      for (const route of this.timetable.routesPassingThrough(toStopId)) {
        for (const stopIndex of route.stopRouteIndices(toStopId)) {
          let tripIndex = route.findEarliestTrip(stopIndex, searchFrom);
          if (tripIndex === undefined) continue;
          const nbTrips = route.getNbTrips();
          while (tripIndex < nbTrips) {
            const dep = route.departureFrom(stopIndex, tripIndex);
            if (dep > searchTo) break;
            if (route.pickUpTypeFrom(stopIndex, tripIndex) !== NOT_AVAILABLE) {
              const t = dep - path.duration;
              let paths = slotMap.get(t);
              if (paths === undefined) {
                slotMap.set(t, (paths = new Set<AccessPoint>()));
              }
              paths.add(path);
            }
            tripIndex++;
          }
        }
      }
    }

    if (slotMap.size === 0) return [];

    // Sort descending so the outer loop processes latest departures first.
    const sorted = Array.from(slotMap.entries()).sort(([a], [b]) => b - a);

    return sorted.map(([depTime, paths]) => ({
      depTime,
      legs: Array.from(paths),
    }));
  }
}
