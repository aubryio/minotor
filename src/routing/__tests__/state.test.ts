import assert from 'node:assert';
import { describe, it } from 'node:test';

import { StopId } from '../../stops/stops.js';
import { Duration, timeFromHM } from '../../timetable/time.js';
import { AccessPoint } from '../access.js';
import { EdgeKinds } from '../graph.js';
import { UNREACHED_TIME } from '../state.js';
import { expectArrival, expectNoArrival } from './helpers/routingAssertions.js';
import { routingState } from './helpers/routingStateForGraph.js';

const access = (
  toStopId: StopId,
  duration: Duration,
  fromStopId: StopId = 0,
): AccessPoint => ({ fromStopId, toStopId, duration });

describe('RoutingState', () => {
  describe('constructor access seeding', () => {
    it('seeds a zero-duration access path as an origin graph cell', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        accessPaths: [access(1, 0)],
      });

      assert.deepStrictEqual(state.origins, [1]);
      expectArrival(state, 1, timeFromHM(8, 0), 0);
      assert.strictEqual(state.graph.kindAt(0, 1), EdgeKinds.ORIGIN);
      assert.strictEqual(
        state.graph.originStopAtCell(state.graph.cell(0, 1)),
        0,
      );
    });

    it('seeds a non-zero access path as a walking access graph cell', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        accessPaths: [access(2, 7)],
      });

      assert.deepStrictEqual(state.origins, [2]);
      expectArrival(state, 2, timeFromHM(8, 7), 0);
      assert.strictEqual(state.graph.kindAt(0, 2), EdgeKinds.ACCESS);
      assert.deepStrictEqual(state.graph.accessAtCell(state.graph.cell(0, 2)), {
        from: 0,
        duration: 7,
      });
    });

    it('keeps the earliest duplicate access path and unique origin', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        accessPaths: [access(2, 9), access(2, 4, 1)],
      });

      assert.deepStrictEqual(state.origins, [2]);
      expectArrival(state, 2, timeFromHM(8, 4), 0);
      assert.deepStrictEqual(state.graph.accessAtCell(state.graph.cell(0, 2)), {
        from: 1,
        duration: 4,
      });
    });

    it('ignores access paths that exceed maxDuration', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        accessPaths: [access(1, 11), access(2, 10)],
        maxDuration: 10,
      });

      assert.deepStrictEqual(state.origins, [2]);
      expectNoArrival(state, 1);
      expectArrival(state, 2, timeFromHM(8, 10), 0);
    });

    it('initializes destinationBest when access reaches a destination', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        destinations: [1, 2],
        accessPaths: [access(1, 9), access(2, 4)],
      });

      assert.strictEqual(state.destinationBest, timeFromHM(8, 4));
    });
  });

  describe('updateArrival', () => {
    it('updates arrival, leg number, destinationBest, and improvementBound', () => {
      const state = routingState({ destinations: [3] });

      state.updateArrival(3, timeFromHM(9, 0), 2);

      expectArrival(state, 3, timeFromHM(9, 0), 2);
      assert.strictEqual(state.arrivalTime(3), timeFromHM(9, 0));
      assert.strictEqual(state.destinationBest, timeFromHM(9, 0));
      assert.strictEqual(state.improvementBound(2, 3), timeFromHM(9, 0));
      assert.strictEqual(state.isDestination(3), true);
      assert.strictEqual(state.isDestination(0), false);
    });

    it('leaves destinationBest unchanged for non-destination arrivals', () => {
      const state = routingState({ destinations: [3] });

      state.updateArrival(2, timeFromHM(8, 30), 1);

      assert.strictEqual(state.destinationBest, UNREACHED_TIME);
    });
  });

  describe('arrivals', () => {
    it('yields every reached stop with its arrival time and leg number', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        accessPaths: [access(0, 0)],
      });
      state.updateArrival(1, timeFromHM(8, 30), 1);
      state.updateArrival(3, timeFromHM(9, 0), 2);

      assert.deepStrictEqual(
        [...state.arrivals()],
        [
          { stop: 0, arrival: timeFromHM(8, 0), legNumber: 0 },
          { stop: 1, arrival: timeFromHM(8, 30), legNumber: 1 },
          { stop: 3, arrival: timeFromHM(9, 0), legNumber: 2 },
        ],
      );
    });

    it('yields nothing when no stop has been reached', () => {
      const state = routingState();
      assert.deepStrictEqual([...state.arrivals()], []);
    });
  });

  describe('resetFor', () => {
    it('clears touched arrivals and graph cells before reseeding access paths', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        accessPaths: [access(0, 0)],
      });
      state.updateArrival(2, timeFromHM(8, 40), 1);
      state.graph.setVehicle(
        1,
        2,
        timeFromHM(8, 40),
        0,
        0,
        0,
        1,
        state.graph.cell(0, 0),
      );

      state.resetFor(timeFromHM(9, 0), [access(1, 5)]);

      expectNoArrival(state, 0);
      expectNoArrival(state, 2);
      assert.strictEqual(state.graph.kindAt(0, 0), EdgeKinds.NONE);
      assert.strictEqual(state.graph.kindAt(1, 2), EdgeKinds.NONE);
      assert.deepStrictEqual(state.origins, [1]);
      assert.deepStrictEqual(
        [...state.arrivals()],
        [{ stop: 1, arrival: timeFromHM(9, 5), legNumber: 0 }],
      );
    });

    it('recomputes maxArrivalTime and destinationBest for the new departure', () => {
      const state = routingState({
        departureTime: timeFromHM(8, 0),
        destinations: [2],
        accessPaths: [access(2, 5)],
        maxDuration: 30,
      });

      assert.strictEqual(state.maxArrivalTime, timeFromHM(8, 30));
      assert.strictEqual(state.destinationBest, timeFromHM(8, 5));

      state.resetFor(timeFromHM(9, 0), [access(2, 40)]);

      assert.strictEqual(state.maxArrivalTime, timeFromHM(9, 30));
      assert.strictEqual(state.destinationBest, UNREACHED_TIME);
      expectNoArrival(state, 2);
    });
  });

  describe('nbStops', () => {
    it('matches the constructor stop count', () => {
      const state = routingState({ nbStops: 7 });
      assert.strictEqual(state.nbStops, 7);
    });
  });
});
