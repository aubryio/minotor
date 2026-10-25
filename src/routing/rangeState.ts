import { StopId } from '../stops/stops.js';
import { Time } from '../timetable/time.js';
import { TripKey } from '../timetable/tripStopId.js';
import type { IRaptorState } from './raptorState.js';
import { RoutingEdge, RoutingState, UNREACHED_TIME } from './state.js';

/**
 * RAPTOR state for Range RAPTOR mode, implementing {@link IRaptorState}.
 *
 * Holds both the cross-run shared labels (carried over from one departure-time
 * iteration to the next, latest → earliest) and a reference to the current
 * per-iteration {@link RoutingState} (swapped via {@link setCurrentRun}).
 *
 * Boarding, walking, and exact-trip bounds retain their distinct eligibility.
 *
 * @see https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
export class RangeRaptorState implements IRaptorState {
  /**
   * Global best arrival at any destination stop across all runs and rounds.
   * Used for destination-pruning inside scan methods so that routes that cannot
   * beat the already-known best are skipped early.
   */
  private _destinationBest: Time = UNREACHED_TIME;

  private currentRun!: RoutingState;

  /** Earliest boarding position on each trip, by transit-leg count. */
  private readonly tripBoardings: Map<TripKey, number>[] = [];

  improveTripBoarding(
    round: number,
    trip: TripKey,
    stopIndex: number,
  ): boolean {
    if (this.tripBoardingBound(round, trip) <= stopIndex) {
      return false;
    }
    const boardings = (this.tripBoardings[round] ??= new Map());
    boardings.set(trip, stopIndex);
    return true;
  }

  tripBoardingBound(round: number, trip: TripKey): number {
    // A later departure with no more boardings dominates the same trip’s suffix.
    let earliest = Infinity;
    for (let k = 1; k <= round; k++) {
      earliest = Math.min(
        earliest,
        this.tripBoardings[k]?.get(trip) ?? Infinity,
      );
    }
    return earliest;
  }

  // Stop-only result bounds cannot dominate a label with different eligibility.
  // These separate tables contain only unrestricted boarding and walking labels.
  private readonly boardingTimes: Uint16Array[] = [];
  private readonly walkingTimes: Uint16Array[] = [];

  improveOrdinaryLabel(
    round: number,
    stop: StopId,
    time: Time,
    walking: boolean,
  ): boolean {
    // Compare rounds <= k: a faster label using more boardings does not dominate.
    if (time >= UNREACHED_TIME) {
      return false;
    }
    const labels = walking ? this.walkingTimes : this.boardingTimes;
    for (let k = 1; k <= round; k++) {
      if ((labels[k]?.[stop] ?? Infinity) <= time) {
        return false;
      }
    }
    const current = (labels[round] ??= new Uint16Array(
      this.currentRun.nbStops,
    ).fill(UNREACHED_TIME));
    current[stop] = time;
    return true;
  }

  /** Attach a departure run and include destinations reached by access alone. */
  setCurrentRun(routingState: RoutingState): void {
    this.currentRun = routingState;
    for (const stop of routingState.origins) {
      const edge = routingState.graph[0]?.[stop];
      if (edge && routingState.isDestination(stop)) {
        // Access edges and aggregate labels both use normalized integer minutes.
        this._destinationBest = Math.min(this._destinationBest, edge.arrival);
      }
    }
  }

  get origins(): StopId[] {
    return this.currentRun.origins;
  }

  get graph(): (RoutingEdge | undefined)[][] {
    return this.currentRun.graph;
  }

  arrivalTime(stop: StopId): Time {
    return this.currentRun.arrivalTime(stop);
  }

  /**
   * Global best arrival at any destination across all departure-time iterations.
   * Always at least as tight as the per-run `destinationBest`.
   */
  get destinationBest(): Time {
    return this._destinationBest;
  }

  get maxArrivalTime(): Time {
    return this.currentRun.maxArrivalTime;
  }

  /** Update the per-run aggregate and the cross-run destination bound. */
  publishArrival(stop: StopId, edge: RoutingEdge, round: number): void {
    // The graph records round-local discoveries; aggregate labels can be better.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    this.graph[round]![stop] = edge;
    this.updateArrival(stop, edge.arrival, round);
  }

  updateArrival(stop: StopId, time: Time, round: number): void {
    const currentRunArrival = this.currentRun.getArrival(stop);
    const improvesCurrentRunAggregate =
      currentRunArrival === undefined ||
      time < currentRunArrival.arrival ||
      (time === currentRunArrival.arrival &&
        round < currentRunArrival.legNumber);

    if (improvesCurrentRunAggregate) {
      this.currentRun.updateArrival(stop, time, round);
    }

    if (this.currentRun.isDestination(stop) && time < this._destinationBest) {
      this._destinationBest = time;
    }
  }
}
