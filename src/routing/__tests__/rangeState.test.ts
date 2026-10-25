import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { timeFromHM } from '../../timetable/time.js';
import { tripKey } from '../../timetable/tripStopId.js';
import { RangeRaptorState } from '../rangeState.js';
import { RoutingState, UNREACHED_TIME } from '../state.js';

const NB_STOPS = 4;
const emptyRun = () =>
  RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [3] });

describe('RangeRaptorState', () => {
  it('keeps normalized access times consistent in the destination bound', () => {
    const state = new RangeRaptorState();
    state.setCurrentRun(
      new RoutingState(
        80,
        [3],
        [{ fromStopId: 0, toStopId: 3, duration: 6 }],
        NB_STOPS,
        3,
      ),
    );
    assert.equal(state.destinationBest, 86);
    assert.equal(state.arrivalTime(3), 86);
    assert.equal(state.graph[0]?.[3]?.arrival, 86);
  });

  it('keeps the best destination arrival across runs, including access arrivals', () => {
    const state = new RangeRaptorState();
    state.setCurrentRun(emptyRun());
    assert.equal(state.destinationBest, UNREACHED_TIME);
    state.updateArrival(1, 50, 1);
    assert.equal(state.destinationBest, UNREACHED_TIME);
    state.updateArrival(3, 100, 2);
    state.setCurrentRun(emptyRun());
    assert.equal(state.arrivalTime(3), UNREACHED_TIME);
    assert.equal(state.destinationBest, 100);
    state.updateArrival(3, 110, 1);
    assert.equal(state.destinationBest, 100);
    const accessRun = new RoutingState(
      80,
      [3],
      [{ fromStopId: 0, toStopId: 3, duration: 5 }],
      NB_STOPS,
      3,
    );
    state.setCurrentRun(accessRun);
    assert.equal(state.destinationBest, 85);
    assert.equal(state.arrivalTime(3), 85);
    assert.equal(state.graph, accessRun.graph);
    assert.deepEqual(state.origins, accessRun.origins);
    state.setCurrentRun(emptyRun());
    assert.equal(state.destinationBest, 85);
  });

  it('keeps boarding and walking eligibility separate from aggregate arrivals', () => {
    const state = new RangeRaptorState();
    state.setCurrentRun(emptyRun());
    state.updateArrival(1, 50, 1);
    assert.equal(state.improveOrdinaryLabel(2, 1, 100, false), true);
    assert.equal(state.improveOrdinaryLabel(2, 1, 100, true), true);
    state.setCurrentRun(emptyRun());
    assert.equal(state.improveOrdinaryLabel(3, 1, 100, false), false);
    assert.equal(state.improveOrdinaryLabel(3, 1, 101, true), false);
    assert.equal(state.improveOrdinaryLabel(3, 1, 100, false), false);
    assert.equal(state.improveOrdinaryLabel(3, 1, 100, true), false);
    assert.equal(state.improveOrdinaryLabel(3, 1, 99, false), true);
    assert.equal(state.improveOrdinaryLabel(3, 1, 99, true), true);
    // An equal arrival with fewer legs is still useful.
    assert.equal(state.improveOrdinaryLabel(1, 1, 100, false), true);
    assert.equal(state.improveOrdinaryLabel(1, 1, 100, true), true);
    assert.equal(state.improveOrdinaryLabel(2, 2, 100, false), true);
  });

  it('prunes only the same trip at a dominated position and leg count', () => {
    const state = new RangeRaptorState();
    const trip = tripKey(0, 0);
    const otherTrip = tripKey(0, 1);
    state.setCurrentRun(emptyRun());
    assert.equal(state.tripBoardingBound(2, trip), Infinity);
    assert.equal(state.improveTripBoarding(2, trip, 3), true);
    state.setCurrentRun(emptyRun());
    assert.equal(state.improveTripBoarding(3, trip, 3), false);
    assert.equal(state.improveTripBoarding(3, trip, 4), false);
    assert.equal(state.improveTripBoarding(3, trip, 2), true);
    assert.equal(state.tripBoardingBound(2, trip), 3);
    assert.equal(state.tripBoardingBound(3, trip), 2);
    assert.equal(state.improveTripBoarding(1, trip, 3), true);
    assert.equal(state.improveTripBoarding(3, otherTrip, 4), true);
  });

  describe('updateArrival aggregate overwrite behavior', () => {
    it('does not overwrite the current run aggregate with a later arrival from a higher round', () => {
      const state = new RangeRaptorState();
      const run = RoutingState.fromTestData({
        nbStops: NB_STOPS,
        destinations: [2],
        arrivals: [[2, timeFromHM(8, 30), 1]],
      });
      state.setCurrentRun(run);

      state.updateArrival(2, timeFromHM(8, 45), 2);

      assert.deepStrictEqual(run.getArrival(2), {
        arrival: timeFromHM(8, 30),
        legNumber: 1,
      });
    });

    it('does not overwrite the current run aggregate with an equal-time arrival using more legs', () => {
      const state = new RangeRaptorState();
      const run = RoutingState.fromTestData({
        nbStops: NB_STOPS,
        destinations: [2],
        arrivals: [[2, timeFromHM(8, 30), 2]],
      });
      state.setCurrentRun(run);

      state.updateArrival(2, timeFromHM(8, 30), 3);

      assert.deepStrictEqual(run.getArrival(2), {
        arrival: timeFromHM(8, 30),
        legNumber: 2,
      });
    });

    it('prefers fewer legs for the current run aggregate when arrival time is equal', () => {
      const state = new RangeRaptorState();
      const run = RoutingState.fromTestData({
        nbStops: NB_STOPS,
        destinations: [2],
        arrivals: [[2, timeFromHM(8, 30), 3]],
      });
      state.setCurrentRun(run);

      state.updateArrival(2, timeFromHM(8, 30), 2);

      assert.deepStrictEqual(run.getArrival(2), {
        arrival: timeFromHM(8, 30),
        legNumber: 2,
      });
    });

    it('still updates the current run aggregate when the new arrival is earlier', () => {
      const state = new RangeRaptorState();
      const run = RoutingState.fromTestData({
        nbStops: NB_STOPS,
        destinations: [2],
        arrivals: [[2, timeFromHM(8, 45), 1]],
      });
      state.setCurrentRun(run);

      state.updateArrival(2, timeFromHM(8, 30), 3);

      assert.deepStrictEqual(run.getArrival(2), {
        arrival: timeFromHM(8, 30),
        legNumber: 3,
      });
    });
  });
});
