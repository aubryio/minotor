import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { normalizeMinutes } from '../../timetable/time.js';
import {
  ALL_TRANSPORT_MODES,
  RouteTypes,
  Timetable,
  TransferTypes,
} from '../../timetable/timetable.js';
import { Query, RangeQuery } from '../query.js';
import { RangeRaptorState } from '../rangeState.js';
import { Raptor } from '../raptor.js';
import { Router } from '../router.js';
import { RoutingState, UNREACHED_TIME } from '../state.js';

const options = {
  maxTransfers: 1,
  minTransferTime: 0,
  transportModes: ALL_TRANSPORT_MODES,
};
const line = (id: number, times: number[]) =>
  Route.of({
    id,
    serviceRouteId: 0,
    trips: [
      {
        stops: times.map((time, index) => ({
          id: index,
          arrivalTime: time,
          departureTime: time,
        })),
      },
    ],
  });

describe('integer minute routing', () => {
  it('normalizes a copy of builder options and leaves optional limits absent', () => {
    const builder = new Query.Builder()
      .from(0)
      .departureTime(0)
      .minTransferTime(1.5);
    const query = builder.build();
    assert.equal(builder.optionsValue.minTransferTime, 1.5);
    assert.equal(query.options.minTransferTime, 2);
    builder.minTransferTime(9).maxDuration(10);
    assert.equal(query.options.minTransferTime, 2);
    assert.equal('maxDuration' in query.options, false);
    assert.equal('maxInitialWaitingTime' in query.options, false);
  });

  it('rejects invalid values in every query time field', () => {
    for (const field of [
      'departureTime',
      'lastDepartureTime',
      'minTransferTime',
      'maxDuration',
      'maxInitialWaitingTime',
    ] as const) {
      for (const value of [
        -0.1,
        NaN,
        -Infinity,
        Infinity,
        65534.5,
        65535,
        65536,
      ]) {
        const builder = new RangeQuery.Builder()
          .from(0)
          .departureTime(0)
          .lastDepartureTime(1);
        builder[field](value);
        assert.throws(() => builder.build(), RangeError);
      }
    }
    assert.equal(normalizeMinutes(0), 0);
    assert.equal(normalizeMinutes(65534), 65534);
  });

  it('routes at the last representable minute without an overflowing boundary run', () => {
    const timetable = new Timetable(
      [{ routes: [0] }, { routes: [0] }],
      [line(0, [65534, 65534])],
      [{ name: 'test', type: RouteTypes.BUS, routes: [0] }],
    );
    const stops = new StopsIndex(
      [0, 1].map((id) => ({
        id,
        sourceStopId: String(id),
        name: String(id),
        children: [],
        locationType: 'SIMPLE_STOP_OR_PLATFORM' as const,
      })),
    );
    const router = new Router(timetable, stops);
    const query = new RangeQuery.Builder()
      .from(0)
      .to(1)
      .departureTime(65534)
      .lastDepartureTime(65534)
      .build();
    assert.equal(router.rangeRoute(query).arrivalAt(1)?.arrival, 65534);
  });

  it('rounds minute inputs and rejects invalid or unrepresentable values', () => {
    assert.deepEqual([1.49, 1.5, 1.51].map(normalizeMinutes), [1, 2, 2]);
    for (const value of [-0.1, NaN, Infinity, 65534.5, 65536]) {
      assert.throws(() => normalizeMinutes(value), RangeError);
    }
    const query = new RangeQuery.Builder()
      .from(0)
      .to(1)
      .departureTime(10.5)
      .lastDepartureTime(20.5)
      .minTransferTime(1.5)
      .maxDuration(30.5)
      .maxInitialWaitingTime(2.5)
      .build();
    assert.equal(query.departureTime, 11);
    assert.equal(query.lastDepartureTime, 21);
    assert.equal(query.options.minTransferTime, 2);
    assert.equal(query.options.maxDuration, 31);
    assert.equal(query.options.maxInitialWaitingTime, 3);
  });

  it('keeps access edges, aggregate arrivals, and range bounds identical', () => {
    const query = new Query.Builder().from(0).to(1).departureTime(10.5).build();
    const state = new RoutingState(
      query.departureTime,
      [1],
      [{ fromStopId: 0, toStopId: 1, duration: 2 }],
      2,
      2,
    );
    const range = new RangeRaptorState(2, 3, 65534);
    range.setCurrentRun(state);
    assert.equal(state.parents[0]?.[1]?.arrival, 13);
    assert.equal(state.arrivalTime(1), 13);
    assert.equal(range.destinationBest, 13);
    state.resetFor(21, [{ fromStopId: 0, toStopId: 1, duration: 1 }]);
    assert.equal(state.parents[0][1].arrival, 22);
    assert.equal(state.arrivalTime(1), 22);
  });

  it('uses normalized walking durations and reuses clean Uint16 buffers', () => {
    const timetable = new Timetable(
      [
        { routes: [0] },
        {
          routes: [0],
          transfers: [
            {
              destination: 2,
              type: TransferTypes.REQUIRES_MINIMAL_TIME,
              minTransferTime: 1,
            },
          ],
        },
        { routes: [] },
      ],
      [line(0, [10, 20])],
      [{ name: 'test', type: RouteTypes.BUS, routes: [0] }],
    );
    const raptor = new Raptor(timetable);
    for (let i = 0; i < 2; i++) {
      const state = new RoutingState(
        0,
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        3,
        2,
      );
      raptor.run(options, state);
      assert.equal(state.arrivalTime(2), 21);
      assert.equal(state.parents[1]?.[2]?.arrival, 21);
    }
  });

  it('does not wrap overflowing access or transfer times into reachable labels', () => {
    const state = new RoutingState(
      65530,
      [],
      [{ fromStopId: 0, toStopId: 0, duration: 10 }],
      3,
      2,
      100,
    );
    assert.deepEqual(state.origins, []);
    assert.equal(state.arrivalTime(0), UNREACHED_TIME);
    const timetable = new Timetable(
      [
        { routes: [0] },
        {
          routes: [0],
          transfers: [
            {
              destination: 2,
              type: TransferTypes.REQUIRES_MINIMAL_TIME,
              minTransferTime: 10,
            },
          ],
        },
        { routes: [] },
      ],
      [line(0, [65530, 65534])],
      [{ name: 'test', type: RouteTypes.BUS, routes: [0] }],
    );
    const reachable = new RoutingState(
      65530,
      [],
      [{ fromStopId: 0, toStopId: 0, duration: 0 }],
      3,
      2,
    );
    new Raptor(timetable).run({ ...options, minTransferTime: 10 }, reachable);
    assert.equal(reachable.arrivalTime(1), 65534);
    assert.equal(reachable.arrivalTime(2), UNREACHED_TIME);
    const range = new RangeRaptorState(2, 3, 65534);
    range.setCurrentRun(reachable);
    assert.equal(range.boardingBound(1, 0), UNREACHED_TIME);
  });
});
