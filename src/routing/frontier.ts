import type { StopId } from '../stops/stops.js';
import type { Time } from '../timetable/time.js';
import type { OccurrenceId } from '../timetable/tripTransfers.js';
import type { RoutingEdge, VehicleEdge } from './state.js';

/** Zero is unrestricted; other contexts identify a feeder occurrence plus one. */
export type BoardingContext = number;
export type RoundNumber = number;

export type Boarding = {
  ready: Time;
  edge: RoutingEdge;
  source?: VehicleEdge;
  occurrence?: OccurrenceId;
};

/** Ordinary labels stay dense; only trip-dependent boarding rights need maps. */
export class Frontier {
  readonly ordinary: (Boarding | undefined)[];
  readonly conditional = new Map<StopId, Map<BoardingContext, Boarding>>();
  readonly stops = new Set<StopId>();

  constructor(nbStops: number) {
    this.ordinary = new Array<Boarding | undefined>(nbStops);
  }

  set(stop: StopId, context: BoardingContext, boarding: Boarding): void {
    if (context === 0) {
      this.ordinary[stop] = boarding;
    } else {
      let labels = this.conditional.get(stop);
      if (!labels) {
        labels = new Map();
        this.conditional.set(stop, labels);
      }
      labels.set(context, boarding);
    }
    this.stops.add(stop);
  }

  clear(): void {
    for (const stop of this.stops) {
      this.ordinary[stop] = undefined;
    }
    this.conditional.clear();
    this.stops.clear();
  }
}
