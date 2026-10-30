import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Route } from '../route.js';
import { RouteTypes, Timetable, TransferTypes } from '../timetable.js';
import { TripRule, TripTransferIndex } from '../tripTransfers.js';

const routes = [0, 1].map((id) =>
  Route.of({
    id,
    serviceRouteId: 0,
    trips: [0, 1].map((trip) => ({
      stops: [0, 1].map((stop) => ({
        id: stop,
        arrivalTime: 480 + trip * 30 + stop * 10,
        departureTime: 480 + trip * 30 + stop * 10,
      })),
    })),
  }),
);
const first: TripRule = {
  source: 1,
  target: 4,
  type: TransferTypes.GUARANTEED,
};
const second: TripRule = {
  source: 3,
  target: 6,
  type: TransferTypes.REQUIRES_MINIMAL_TIME,
  minTransferTime: 5,
};

describe('canonical transfer index loading', () => {
  it('normalizes raw input and preserves the same index and rules through binary loading', () => {
    const timetable = new Timetable(
      [{ routes: [0, 1] }, { routes: [0, 1] }],
      routes,
      [{ name: 'test', type: RouteTypes.BUS, routes: [0, 1] }],
      undefined,
      undefined,
      [second, first, first],
    );
    assert.deepEqual([...timetable.tripTransfers.all()], [first, second]);
    const binary = timetable.serialize();
    const loaded = Timetable.fromData(binary);
    assert.deepEqual(loaded.tripTransfers, timetable.tripTransfers);
    assert.deepEqual(loaded.serialize(), binary);
    assert.deepEqual(loaded.tripTransfers.exceptionalTrips, [[0, 1], []]);
    assert.deepEqual(loaded.tripTransfers.transfer(3, 6), second);
  });

  it('still rejects malformed and conflicting raw rules', () => {
    for (const rule of [
      { ...first, source: -1 },
      { ...first, target: 8 },
      { ...second, minTransferTime: undefined },
      { ...second, minTransferTime: -1 },
    ]) {
      assert.throws(
        () => TripTransferIndex.fromRaw(routes, [rule]),
        /Invalid trip transfer rule/,
      );
    }
    assert.throws(
      () =>
        TripTransferIndex.fromRaw(routes, [
          second,
          { ...second, minTransferTime: 6 },
        ]),
      /Conflicting trip transfer rules/,
    );
  });

  it('supports empty canonical indexes and refuses unsupported binary versions', () => {
    const index = TripTransferIndex.fromCanonical(routes, []);
    assert.deepEqual([...index.all()], []);
    assert.equal(index.isExceptional(0, 0), false);
    assert.throws(
      () => Timetable.fromData(new Uint8Array()),
      /Unsupported timetable format/,
    );
  });
});
