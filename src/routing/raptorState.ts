import type { StopId } from '../stops/stops.js';
import type { StopRouteIndex } from '../timetable/route.js';
import type { Time } from '../timetable/time.js';
import type { TripKey } from '../timetable/tripStopId.js';
import type { RoutingEdge } from './state.js';

export interface IRaptorState extends RangeDominance {
  /** Origin stop IDs for this run. */
  readonly origins: StopId[];

  /** Per-round routing graph; `graph[round][stop]` is the best edge used to reach `stop`. */
  readonly graph: (RoutingEdge | undefined)[][];

  /** Per-run best arrival across rounds (the paper’s tau*); bounds published results. */
  arrivalTime(stop: StopId): Time;

  /**
   * Best known arrival time at any destination.
   */
  readonly destinationBest: Time;

  /** Latest arrival time allowed by the current query/run. */
  readonly maxArrivalTime: Time;

  /** Publish a reconstruction edge and update aggregate arrivals atomically. */
  publishArrival(stop: StopId, edge: RoutingEdge, round: number): void;
}

/** Optional bounds retained across departure runs. */
export interface RangeDominance {
  /** Cross-run bounds distinguish unrestricted boarding from a vehicle arrival eligible to walk. */
  improveOrdinaryLabel?(
    round: number,
    stop: StopId,
    time: Time,
    walking: boolean,
  ): boolean;

  /** Earliest already-reached position on this trip, across later departure runs. */
  tripBoardingBound?(round: number, trip: TripKey): StopRouteIndex;

  /** Optional cross-run dominance once aboard the exact same scheduled trip. */
  improveTripBoarding?(
    round: number,
    trip: TripKey,
    stopIndex: StopRouteIndex,
  ): boolean;
}
