import type { StopId } from '../stops/stops.js';
import type { Time } from '../timetable/time.js';
import type { TripStopId } from '../timetable/tripTransfers.js';
import type { RoutingEdge, TransferEdge, VehicleEdge } from './state.js';

export type RoundNumber = number;

export type Boarding = {
  /**
   * Readiness without a pair rule; Infinity when only a trip-specific
   * connection exists.
   */
  readyAt: Time;
  edge: RoutingEdge;
};

export type ConditionalBoarding = Boarding & {
  edge: VehicleEdge | (TransferEdge & { predecessor: VehicleEdge });
};

/** Recover the feeder before any generic walking transfer. */
export function boardingFeeder(boarding: ConditionalBoarding): VehicleEdge {
  return 'routeId' in boarding.edge ? boarding.edge : boarding.edge.predecessor;
}

export class Frontier {
  readonly ordinary: (Boarding | undefined)[];
  readonly conditional = new Map<
    StopId,
    Map<TripStopId, ConditionalBoarding>
  >();
  readonly stops = new Set<StopId>();

  constructor(nbStops: number) {
    this.ordinary = new Array<Boarding | undefined>(nbStops);
  }

  set(stop: StopId, boarding: Boarding): void {
    this.ordinary[stop] = boarding;
    this.stops.add(stop);
  }

  setConditional(
    stop: StopId,
    sourceTripStopId: TripStopId,
    boarding: ConditionalBoarding,
  ): void {
    let boardings = this.conditional.get(stop);
    if (!boardings) {
      boardings = new Map();
      this.conditional.set(stop, boardings);
    }
    boardings.set(sourceTripStopId, boarding);
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
