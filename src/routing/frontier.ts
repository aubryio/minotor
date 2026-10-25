import type { StopId } from '../stops/stops.js';
import type { Time } from '../timetable/time.js';
import type { TripStopId } from '../timetable/tripStopId.js';
import type { RoutingEdge, VehicleEdge } from './state.js';

export type BoardingLabel = { edge: RoutingEdge; ready: Time } & (
  | { source?: undefined; sourceId?: undefined }
  | { source: VehicleEdge; sourceId: TripStopId }
);
/** Improved boarding labels for one round; stops is the paper’s marked-stop set. */
export class Frontier {
  readonly ordinary: (BoardingLabel | undefined)[];
  // Different incoming trips need not dominate one another, even at the same stop.
  readonly conditional = new Map<StopId, Map<TripStopId, BoardingLabel>>();
  readonly stops = new Set<StopId>();
  readonly sources: VehicleEdge[] = [];

  constructor(nbStops: number) {
    this.ordinary = new Array<BoardingLabel | undefined>(nbStops);
  }

  clear(): void {
    for (const stop of this.stops) {
      this.ordinary[stop] = undefined;
    }
    this.stops.clear();
    this.conditional.clear();
    this.sources.length = 0;
  }
}
