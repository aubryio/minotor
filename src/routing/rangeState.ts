/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { Time } from '../timetable/time.js';
import type { IRaptorState } from './raptor.js';
import { RoutingEdge, RoutingState, UNREACHED_TIME } from './state.js';

/**
 * RAPTOR state for Range RAPTOR mode, implementing {@link IRaptorState}.
 *
 * Holds both the cross-run shared labels (carried over from one departure-time
 * iteration to the next, latest → earliest) and a reference to the current
 * per-iteration {@link RoutingState} (swapped via {@link setCurrentRun}).
 *
 * Concretely, `roundLabels[k][p]` is the best known arrival at stop `p` using
 * at most `k` transit legs, across **all departure times tried so far**.
 *
 * @see https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
export class RangeRaptorState implements IRaptorState {
  /**
   * `roundLabels[k]` is a flat `Uint16Array` of size `nbStops`.
   * `roundLabels[k][p]` = best arrival time (minutes from midnight) at stop `p`
   * in round `k`, across all departure-time iterations processed so far.
   * Pre-filled with `UNREACHED_TIME`; updated in-place as better arrivals are found.
   */
  readonly roundLabels: Uint16Array[];

  /**
   * The latest departure time of the range query.
   */
  readonly latestDeparture: Time;

  /**
   * Global best arrival at any destination stop across all runs and rounds.
   * Used for destination-pruning inside scan methods so that routes that cannot
   * beat the already-known best are skipped early.
   */
  private _destinationBest: Time = UNREACHED_TIME;

  /**
   * Sparse change-tracking for `initRound`.
   *
   * `changedInRound[k]` is the list of stops whose round-k label was improved
   * (via `tryImprove`) since the last call to `initRound(k + 1)`.  When
   * `initRound(k + 1)` runs, it only visits these stops instead of scanning
   * all `nbStops` entries, reducing the work from O(nbStops × rounds ×
   * departureTimes) to O(changedStops × rounds × departureTimes).
   *
   * Duplicates are allowed and harmless — a stop that appears twice merely
   * receives a redundant (no-op) min-update on the second visit.  The list is
   * cleared inside `initRound` immediately after processing.
   */
  private readonly changedInRound: StopId[][];

  private currentRun!: RoutingState;

  constructor(maxRounds: number, nbStops: number, latestDeparture: Time) {
    this.latestDeparture = latestDeparture;
    // maxRounds + 2: index 0 = origin/walk legs, indices 1…maxRounds+1 = transit rounds
    this.roundLabels = Array.from({ length: maxRounds + 2 }, () =>
      new Uint16Array(nbStops).fill(UNREACHED_TIME),
    );
    this.changedInRound = Array.from({ length: maxRounds + 2 }, () => []);
  }

  /**
   * Swaps in a fresh {@link RoutingState} for the next departure-time iteration
   * and seeds the shared round-0 labels from its access arrivals.
   *
   * Must be called before every `runRaptor` invocation.
   */
  setCurrentRun(routingState: RoutingState): void {
    this.currentRun = routingState;
    // Propagate round-0 access arrivals into the shared labels so that
    // initRound(1) can tighten round-1 pruning bounds correctly.
    const round0 = routingState.graph[0]!;
    for (const stop of routingState.origins) {
      const edge = round0[stop];
      if (!edge) continue;
      this.updateArrival(stop, edge.arrival, 0);
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
   * Uses the cross-run shared label for `round`, which is always at least as
   * tight as the per-run arrival and therefore provides stronger pruning.
   */
  improvementBound(round: number, stop: StopId): Time {
    return this.roundLabels[round]![stop]!;
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

  isDestination(stop: StopId): boolean {
    return this.currentRun.isDestination(stop);
  }

  /** Updates the per-run aggregate best when improved, and always considers the cross-run shared label. */
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

    if (time < this.roundLabels[round]![stop]!) {
      this.roundLabels[round]![stop] = time;
      this.changedInRound[round]!.push(stop);
      if (this.currentRun.isDestination(stop) && time < this._destinationBest) {
        this._destinationBest = time;
      }
    }
  }

  /**
   * initialized round `k` from round `k-1`: τk(p) ← min(τk(p), τk-1(p)).
   *
   * Must be called at the very start of each RAPTOR round before routes are
   * scanned.  After this call, `roundLabels[k][p]` is the minimum arrival at
   * stop `p` achievable with **at most** k transit legs from any departure time
   * tried so far — which is exactly the tightest valid pruning bound for round k.
   */
  initRound(round: number): void {
    const changed = this.changedInRound[round - 1]!;
    if (changed.length === 0) return;

    const prev = this.roundLabels[round - 1]!;
    const curr = this.roundLabels[round]!;
    for (let i = 0; i < changed.length; i++) {
      const stop = changed[i]!;
      if (prev[stop]! < curr[stop]!) {
        curr[stop] = prev[stop]!;
      }
    }
    changed.length = 0;
  }
}
