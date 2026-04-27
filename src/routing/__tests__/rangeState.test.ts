/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { timeFromHM } from '../../timetable/time.js';
import { RangeRaptorState } from '../rangeState.js';
import { RoutingState, UNREACHED_TIME } from '../state.js';

const NB_STOPS = 4;
const MAX_ROUNDS = 3;

describe('RangeRaptorState', () => {
  describe('constructor', () => {
    it('creates roundLabels of length maxRounds + 2', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      assert.strictEqual(state.roundLabels.length, MAX_ROUNDS + 2);
    });

    it('initialized all roundLabels to UNREACHED_TIME', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      for (const round of state.roundLabels) {
        for (const val of round) {
          assert.strictEqual(val, UNREACHED_TIME);
        }
      }
    });

    it('stores latestDeparture', () => {
      const latest = timeFromHM(11, 30);
      const state = new RangeRaptorState(MAX_ROUNDS, NB_STOPS, latest);
      assert.strictEqual(state.latestDeparture, latest);
    });
  });

  describe('setCurrentRun', () => {
    it('seeds round-0 shared labels from origin nodes', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [1],
          graph: [[[1, { stopId: 1, arrival: timeFromHM(9, 0) }]]],
        }),
      );
      assert.strictEqual(state.roundLabels[0]![1], timeFromHM(9, 0));
    });

    it('skips an origin that has no edge in round 0', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [1],
          graph: [[]],
        }),
      );
      assert.strictEqual(state.roundLabels[0]![1], UNREACHED_TIME);
    });

    it('delegates origins and graph getters to the active run', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      const run = RoutingState.fromTestData({
        nbStops: NB_STOPS,
        origins: [0, 2],
        graph: [[]],
      });
      state.setCurrentRun(run);
      assert.deepStrictEqual(state.origins, [0, 2]);
      assert.strictEqual(state.graph, run.graph);
    });
  });

  describe('improvementBound', () => {
    it('returns the cross-run shared label, tighter than the per-run arrival', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );

      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [2] }),
      );
      state.updateArrival(2, timeFromHM(9, 30), 1);

      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [2] }),
      );

      assert.strictEqual(state.arrivalTime(2), UNREACHED_TIME);
      assert.strictEqual(state.improvementBound(1, 2), timeFromHM(9, 30));
    });
  });

  describe('updateArrival', () => {
    it('improves the shared roundLabel for the given round and stop', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [2] }),
      );
      state.updateArrival(2, timeFromHM(9, 0), 1);
      assert.strictEqual(state.roundLabels[1]![2], timeFromHM(9, 0));
    });

    it('does not worsen a shared roundLabel that is already tight', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [2] }),
      );
      state.updateArrival(2, timeFromHM(9, 0), 1);
      state.updateArrival(2, timeFromHM(9, 30), 1);
      assert.strictEqual(state.roundLabels[1]![2], timeFromHM(9, 0));
    });

    it('updates destinationBest when a destination stop is first reached', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [3] }),
      );
      assert.strictEqual(state.destinationBest, UNREACHED_TIME);
      state.updateArrival(3, timeFromHM(10, 0), 1);
      assert.strictEqual(state.destinationBest, timeFromHM(10, 0));
    });

    it('destinationBest persists when the run is swapped', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [3] }),
      );
      state.updateArrival(3, timeFromHM(10, 0), 1);

      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [3] }),
      );
      assert.strictEqual(state.destinationBest, timeFromHM(10, 0));
    });
  });

  describe('initRound', () => {
    it('propagates the round k-1 label into round k for changed stops', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [2] }),
      );
      state.updateArrival(2, timeFromHM(9, 0), 1);
      state.initRound(2);
      assert.strictEqual(state.roundLabels[2]![2], timeFromHM(9, 0));
    });

    it('does not overwrite a tighter label already present in round k', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [2] }),
      );
      state.updateArrival(2, timeFromHM(8, 30), 2);
      state.updateArrival(2, timeFromHM(9, 0), 1);
      state.initRound(2);
      assert.strictEqual(state.roundLabels[2]![2], timeFromHM(8, 30));
    });

    it('is a no-op when no stop changed in the previous round', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(RoutingState.fromTestData({ nbStops: NB_STOPS }));
      state.initRound(1);
      for (const val of state.roundLabels[1]!) {
        assert.strictEqual(val, UNREACHED_TIME);
      }
    });

    it('clears the changed-stop list so a subsequent call propagates nothing new', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(RoutingState.fromTestData({ nbStops: NB_STOPS }));
      state.updateArrival(2, timeFromHM(9, 0), 0);
      state.initRound(1);
      state.initRound(2);
      assert.strictEqual(state.roundLabels[2]![2], UNREACHED_TIME);
    });
  });

  describe('isDestination', () => {
    it('delegates to the current run', () => {
      const state = new RangeRaptorState(
        MAX_ROUNDS,
        NB_STOPS,
        timeFromHM(12, 0),
      );
      state.setCurrentRun(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [3] }),
      );
      assert.strictEqual(state.isDestination(3), true);
      assert.strictEqual(state.isDestination(0), false);
    });
  });
});
