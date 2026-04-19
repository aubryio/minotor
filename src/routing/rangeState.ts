/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { Time } from '../timetable/time.js';
import { UNREACHED_TIME } from './state.js';

/**
 * Shared state for the Range RAPTOR algorithm.
 *
 * Standard RAPTOR re-initialises the full routing state for every query.
 * Range RAPTOR instead keeps one set of *round-specific* arrival-time arrays
 * that carry over from one departure-time iteration to the next (latest → earliest).
 *
 * Concretely, `roundLabels[k][p]` is the best known arrival at stop `p` using
 * at most `k` transit legs, across **all departure times tried so far**.
 * Because we iterate from the latest departure to the earliest, every label
 * that was set by an earlier iteration (later departure) represents a journey
 * that departs no earlier — so it is a valid Pareto upper bound for the current
 * iteration and may be used to prune dominated arrivals.
 *
 * ### Improvement guard
 * The scan methods compare candidate arrivals against `roundLabels[k][p]`
 * (the round-specific label), **not** against the global minimum τ*(p).
 * Using τ*(p) would be incorrect because it may include an arrival from a
 * *different* round (fewer transfers), which would prevent the current round
 * from ever setting its own label — breaking the boarding logic for subsequent
 * rounds.  The paper's Range RAPTOR section explicitly calls this out.
 *
 * ### Round initialisation
 * At the start of each round `k`, `initRound(k)` must be called.  It copies
 * `roundLabels[k-1]` into `roundLabels[k]` wherever it improves, so that stops
 * reachable with *fewer* legs from any previous departure are automatically
 * considered when pruning in round `k`.
 *
 * @see https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
export class RangeRaptorSharedState {
  /**
   * `roundLabels[k]` is a flat `Uint16Array` of size `nbStops`.
   * `roundLabels[k][p]` = best arrival time (minutes from midnight) at stop `p`
   * in round `k`, across all departure-time iterations processed so far.
   * Pre-filled with `UNREACHED_TIME`; updated in-place as better arrivals are found.
   */
  readonly roundLabels: Uint16Array[];

  /**
   * Global best arrival at any destination stop across all runs and rounds.
   * Used for destination-pruning inside scan methods so that routes that cannot
   * beat the already-known best are skipped early.
   */
  private _destinationBest: Time = UNREACHED_TIME;

  constructor(maxRounds: number, nbStops: number) {
    // maxRounds + 2: index 0 = origin/walk legs, indices 1…maxRounds+1 = transit rounds
    this.roundLabels = Array.from(
      { length: maxRounds + 2 },
      () => new Uint16Array(nbStops).fill(UNREACHED_TIME),
    );
  }

  /** Best arrival at any query destination seen across all runs so far. */
  get destinationBest(): Time {
    return this._destinationBest;
  }

  /**
   * Tightens the global destination bound.
   * Called whenever a scan method improves a destination stop.
   */
  improveDestinationBest(time: Time): void {
    if (time < this._destinationBest) {
      this._destinationBest = time;
    }
  }

  /**
   * Initialises round `k` from round `k-1`: τk(p) ← min(τk(p), τk-1(p)).
   *
   * Must be called at the very start of each RAPTOR round before routes are
   * scanned.  After this call, `roundLabels[k][p]` is the minimum arrival at
   * stop `p` achievable with **at most** k transit legs from any departure time
   * tried so far — which is exactly the tightest valid pruning bound for round k.
   */
  initRound(round: number): void {
    const prev = this.roundLabels[round - 1]!;
    const curr = this.roundLabels[round]!;
    for (let i = 0; i < curr.length; i++) {
      if (prev[i]! < curr[i]!) {
        curr[i] = prev[i]!;
      }
    }
  }

  /**
   * Returns the shared label τk(p) for the given round and stop.
   */
  get(round: number, stop: StopId): Time {
    return this.roundLabels[round]![stop]!;
  }

  /**
   * Attempts to improve the shared label for round `k` at stop `p`.
   * Returns `true` if the label was updated (i.e. `time` was strictly better).
   */
  tryImprove(round: number, stop: StopId, time: Time): boolean {
    if (time < this.roundLabels[round]![stop]!) {
      this.roundLabels[round]![stop] = time;
      return true;
    }
    return false;
  }
}
