import type { StopId } from '../stops/stops.js';
import type { Time } from '../timetable/time.js';
import type { TripStopId } from '../timetable/tripTransfers.js';
import type { RoutingEdge, TransferEdge, VehicleEdge } from './state.js';

export type RoundNumber = number;

export type Boarding = {
  readyAt: Time; // can be inifinity when there are only conditional connections
  edge: RoutingEdge;
};

export type ConditionalBoarding = Boarding & {
  edge: VehicleEdge | (TransferEdge & { predecessor: VehicleEdge });
};

/** Recover the feeder before any generic walking transfer. */
export function boardingFeeder(boarding: ConditionalBoarding): VehicleEdge {
  return 'routeId' in boarding.edge ? boarding.edge : boarding.edge.predecessor;
}

export class RoundLabels {
  readonly ordinary: (Boarding | undefined)[];
  readonly conditional = new Map<
    StopId,
    Map<TripStopId, ConditionalBoarding>
  >();
  readonly markedStops = new Set<StopId>();

  constructor(nbStops: number) {
    this.ordinary = new Array<Boarding | undefined>(nbStops);
  }

  set(stop: StopId, boarding: Boarding): void {
    this.ordinary[stop] = boarding;
    this.markedStops.add(stop);
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
    this.markedStops.add(stop);
  }

  clear(): void {
    for (const stop of this.markedStops) {
      this.ordinary[stop] = undefined;
    }
    this.conditional.clear();
    this.markedStops.clear();
  }
}
