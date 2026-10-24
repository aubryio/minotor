/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { timeFromHM } from '../../timetable/time.js';
import { RoutingState, UNREACHED_TIME } from '../state.js';

describe('RoutingState', () => {
  describe('arrivals', () => {
    it('yields every reached stop with its arrival time and leg number', () => {
      const state = RoutingState.fromTestData({
        nbStops: 4,
        arrivals: [
          [1, timeFromHM(8, 30), 1],
          [3, timeFromHM(9, 0), 2],
        ],
      });

      const reached = [...state.arrivals()];
      assert.strictEqual(reached.length, 2);
      assert.deepStrictEqual(reached[0], {
        stop: 1,
        arrival: timeFromHM(8, 30),
        legNumber: 1,
      });
      assert.deepStrictEqual(reached[1], {
        stop: 3,
        arrival: timeFromHM(9, 0),
        legNumber: 2,
      });
    });

    it('skips stops still at UNREACHED_TIME', () => {
      const state = RoutingState.fromTestData({
        nbStops: 3,
        arrivals: [[0, timeFromHM(8, 0), 0]],
      });

      const reached = [...state.arrivals()];
      assert.strictEqual(reached.length, 1);
      assert.strictEqual(reached[0]!.stop, 0);
    });

    it('yields nothing when no stop has been reached', () => {
      const state = RoutingState.fromTestData({ nbStops: 3 });
      assert.strictEqual([...state.arrivals()].length, 0);
    });
  });

  describe('destinationBest', () => {
    it('reflects the earliest arrival at any destination', () => {
      const state = RoutingState.fromTestData({
        nbStops: 3,
        destinations: [1, 2],
        arrivals: [
          [1, timeFromHM(9, 30), 1],
          [2, timeFromHM(9, 0), 1],
        ],
      });
      assert.strictEqual(state.destinationBest, timeFromHM(9, 0));
    });

    it('is UNREACHED_TIME when no destination has been reached', () => {
      const state = RoutingState.fromTestData({
        nbStops: 3,
        destinations: [2],
      });
      assert.strictEqual(state.destinationBest, UNREACHED_TIME);
    });
  });

  describe('nbStops', () => {
    it('matches the size passed to fromTestData', () => {
      const state = RoutingState.fromTestData({ nbStops: 7 });
      assert.strictEqual(state.nbStops, 7);
    });
  });
});

describe('RoutingState reuse', () => {
  it('resets repeated improvements and all rounds like a fresh state', () => {
    const access = [{ fromStopId: 0, toStopId: 0, duration: 0 }];
    const state = new RoutingState(100, [2], access, 4, 3, 60);
    state.updateArrival(0, 99, 1);
    state.updateArrival(1, 120, 1);
    state.graph[1]![1] = { stopId: 1, arrival: 120 };
    state.updateArrival(1, 110, 2);
    state.graph[2]![1] = { stopId: 1, arrival: 110 };
    state.updateArrival(2, 130, 3);
    state.graph[3]![2] = { stopId: 2, arrival: 130 };
    for (const departure of [90, 80]) {
      state.resetFor(departure, access);
      const fresh = new RoutingState(departure, [2], access, 4, 3, 60);
      assert.deepStrictEqual([...state.arrivals()], [...fresh.arrivals()]);
      assert.strictEqual(state.destinationBest, fresh.destinationBest);
      assert.strictEqual(state.maxArrivalTime, fresh.maxArrivalTime);
      for (let round = 0; round < state.graph.length; round++) {
        assert.deepStrictEqual(
          Array.from(state.graph[round]!),
          Array.from(fresh.graph[round]!),
        );
      }
      state.updateArrival(1, departure + 10, 1);
      state.graph[1]![1] = { stopId: 1, arrival: departure + 10 };
    }
  });
});
