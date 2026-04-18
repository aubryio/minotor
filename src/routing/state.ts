/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { StopRouteIndex } from '../timetable/route.js';
import { Duration, Time } from '../timetable/time.js';
import { TransferType, TripStop } from '../timetable/timetable.js';

/**
 * Sentinel value used in the internal arrival-time array to mark stops not yet reached.
 * 0xFFFF = 65 535 minutes ≈ 45.5 days, safely beyond any realistic transit arrival time.
 */
export const UNREACHED_TIME: Time = 0xffff;

/** An origin stop reached at the query departure time, before any transit leg. */
export type OriginNode = { arrival: Time };

/** A boarded transit trip that carries the passenger from one stop to another. */
export type VehicleEdge = TripStop & {
  arrival: Time;
  hopOffStopIndex: StopRouteIndex;
  /** Set when this edge continues directly from another trip (in-seat transfer). */
  continuationOf?: VehicleEdge;
};

/** A walking or guaranteed connection between two stops. */
export type TransferEdge = {
  arrival: Time;
  from: StopId;
  to: StopId;
  type: TransferType;
  minTransferTime?: Duration;
};

export type RoutingEdge = OriginNode | VehicleEdge | TransferEdge;

/** The earliest arrival at a stop together with how many legs were needed to reach it. */
export type Arrival = {
  arrival: Time;
  legNumber: number;
};

/**
 * Encapsulates all mutable state for a single RAPTOR routing query.
 */
export class RoutingState {
  /** Origin stop IDs for this query. */
  readonly origins: StopId[];

  /** Destination stop IDs for this query. */
  readonly destinations: StopId[];

  /**
   * Routing graph: the best edge used to reach each stop, per round.
   * Indexed as graph[round][stopId]. Entries are undefined for stops not
   * reached in that particular round.
   */
  readonly graph: (RoutingEdge | undefined)[][];

  /**
   * Earliest arrival time at each stop (minutes from midnight), indexed by stop ID.
   * Pre-filled with UNREACHED_TIME; updated exclusively through updateArrival().
   * Not readonly so that fromTestData() can replace the arrays directly.
   */
  private earliestArrivalTimes: Uint16Array;

  /**
   * Round number (leg count) in which each stop was first reached, indexed by stop ID.
   * Zero-initialized by the typed array; updated exclusively through updateArrival().
   * Not readonly so that fromTestData() can replace the arrays directly.
   */
  private earliestArrivalLegs: Uint8Array;

  /**
   * Initializes the routing state for a fresh query.
   *
   * All stops start as unreached. Each origin is immediately recorded at the
   * departure time with leg number 0, and a corresponding OriginNode is placed
   * in round 0 of the graph.
   *
   * @param origins      Stop IDs to depart from (may be several equivalent stops).
   * @param destinations Stop IDs that count as the target of the query.
   * @param departureTime Earliest departure time in minutes from midnight.
   * @param nbStops      Total number of stops in the timetable (sets array sizes).
   */
  constructor(
    origins: StopId[],
    destinations: StopId[],
    departureTime: Time,
    nbStops: number,
  ) {
    this.origins = origins;
    this.destinations = destinations;

    const earliestArrivalTimes = new Uint16Array(nbStops).fill(UNREACHED_TIME);
    const earliestArrivalLegs = new Uint8Array(nbStops); // zero-initialized = leg 0
    const graph0 = new Array<RoutingEdge | undefined>(nbStops);

    for (const stop of origins) {
      earliestArrivalTimes[stop] = departureTime;
      graph0[stop] = { arrival: departureTime };
    }

    this.earliestArrivalTimes = earliestArrivalTimes;
    this.earliestArrivalLegs = earliestArrivalLegs;
    this.graph = [graph0];
  }

  /** Total number of stops in the timetable */
  get nbStops(): number {
    return this.earliestArrivalTimes.length;
  }

  /**
   * Returns the earliest known arrival time at a stop.
   * Returns UNREACHED_TIME if the stop has not been reached yet.
   */
  arrivalTime(stop: StopId): Time {
    return this.earliestArrivalTimes[stop]!;
  }

  /**
   * Records a new earliest arrival at a stop.

   *
   * @param stop The stop that was reached.
   * @param time The arrival time in minutes from midnight.
   * @param leg  The round number (number of transit legs taken so far).
   */
  updateArrival(stop: StopId, time: Time, leg: number): void {
    this.earliestArrivalTimes[stop] = time;
    this.earliestArrivalLegs[stop] = leg;
  }

  /**
   * Returns the earliest arrival at a stop as an {@link Arrival} object,
   * or undefined if the stop has not been reached.
   */
  getArrival(stop: StopId): Arrival | undefined {
    const time = this.earliestArrivalTimes[stop]!;
    if (time >= UNREACHED_TIME) return undefined;
    return { arrival: time, legNumber: this.earliestArrivalLegs[stop]! };
  }

  /**
   * Creates a {@link RoutingState} from fully-specified raw data.
   *
   * Use this in tests instead of constructing the object through the production
   * constructor, which is designed for incremental algorithm state.
   *
   * @param nbStops  Total number of stops (sets array sizes).
   * @param origins  Origin stop IDs.
   * @param destinations  Destination stop IDs.
   * @param arrivals  Each entry is `[stop, time, leg]` — the earliest arrival
   *                  time in minutes and the round number for one stop.
   * @param graph  One element per round. Each round is a sparse list of
   *               `[stop, edge]` pairs; stops absent from the list are
   *               left as `undefined` in the dense output array.
   *
   * @internal For use in tests only.
   */
  static fromTestData({
    nbStops,
    origins = [],
    destinations = [],
    arrivals = [],
    graph = [],
  }: {
    nbStops: number;
    origins?: StopId[];
    destinations?: StopId[];
    arrivals?: [stop: StopId, time: Time, leg: number][];
    graph?: [stop: StopId, edge: RoutingEdge][][];
  }): RoutingState {
    const state = new RoutingState(origins, destinations, 0, nbStops);

    // Replace the arrival arrays with freshly built ones so the constructor's
    // origin-seeding doesn't bleed into the test state.
    const earliestArrivalTimes = new Uint16Array(nbStops).fill(UNREACHED_TIME);
    const earliestArrivalLegs = new Uint8Array(nbStops);
    for (const [stop, time, leg] of arrivals) {
      earliestArrivalTimes[stop] = time;
      earliestArrivalLegs[stop] = leg;
    }
    state.earliestArrivalTimes = earliestArrivalTimes;
    state.earliestArrivalLegs = earliestArrivalLegs;

    // Convert the sparse per-round representation to dense arrays and replace
    // the graph in-place.
    const denseRounds = graph.map((round) => {
      const arr = new Array<RoutingEdge | undefined>(nbStops);
      for (const [stop, edge] of round) {
        arr[stop] = edge;
      }
      return arr;
    });
    state.graph.splice(0, state.graph.length, ...denseRounds);

    return state;
  }
}
