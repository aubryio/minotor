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

it('exposes readonly adjacency equivalent to object iteration', () => {
  const index = TripTransferIndex.fromRaw(routes, [first, second]);
  assert.deepEqual(index.rulesFrom(0), []);
  for (const source of [1, 3]) {
    assert.deepEqual(index.rulesFrom(source), [...index.outgoing(source)]);
  }
});

it('isolates stored rules from mutations to input and returned records', () => {
  for (const canonical of [false, true]) {
    const input = { ...second };
    const index = canonical
      ? TripTransferIndex.fromCanonical(routes, [input])
      : TripTransferIndex.fromRaw(routes, [input]);
    input.target = 0;
    input.minTransferTime = 99;

    const transfer = index.transfer(second.source, second.target);
    assert.deepEqual(transfer, second);
    assert.ok(transfer);
    transfer.minTransferTime = 0;
    for (const rule of index.outgoing(second.source)) rule.target = 0;
    for (const rule of index.all()) rule.type = TransferTypes.IN_SEAT;

    assert.deepEqual([...index.all()], [second]);
    assert.deepEqual(index.transfer(second.source, second.target), second);
  }
});

it('rejects format 2 rather than interpreting per-trip patterns as shared', async () => {
  const { Timetable: WireTimetable } = await import('../proto/v1/timetable.js');
  const binary = WireTimetable.encode(
    WireTimetable.fromPartial({ formatVersion: 2 }),
  ).finish();
  assert.throws(() => Timetable.fromData(binary), /regenerate/);
});

it('round-trips every transfer type and preserves absent, zero, and positive minimums', () => {
  for (const type of Object.values(TransferTypes)) {
    for (const minTransferTime of [undefined, 0, 5]) {
      if (
        type === TransferTypes.REQUIRES_MINIMAL_TIME &&
        minTransferTime === undefined
      ) {
        continue;
      }
      const rule: TripRule = {
        source: 1,
        target: 4,
        type,
        ...(minTransferTime !== undefined && { minTransferTime }),
      };
      const timetable = new Timetable(
        [{ routes: [0, 1] }, { routes: [0, 1] }],
        routes,
        [{ name: 'test', type: RouteTypes.BUS, routes: [0, 1] }],
        undefined,
        undefined,
        [rule],
      );
      const binary = timetable.serialize();
      const loaded = Timetable.fromData(binary);
      assert.deepEqual([...loaded.tripTransfers.all()], [rule]);
      assert.deepEqual(loaded.serialize(), binary);
    }
  }
});

it('finds trip stop zero and keeps optional and throwing lookup contracts distinct', () => {
  const index = TripTransferIndex.fromRaw(routes);
  assert.equal(
    index.findTripStopId({ routeId: 0, tripIndex: 0, stopIndex: 0 }),
    0,
  );
  for (const position of [
    { routeId: 2, tripIndex: 0, stopIndex: 0 },
    { routeId: 0, tripIndex: -1, stopIndex: 0 },
    { routeId: 0, tripIndex: 2, stopIndex: 0 },
    { routeId: 0, tripIndex: 0.5, stopIndex: 0 },
    { routeId: 0, tripIndex: 0, stopIndex: -1 },
    { routeId: 0, tripIndex: 0, stopIndex: 2 },
    { routeId: 0, tripIndex: 0, stopIndex: NaN },
  ]) {
    assert.equal(index.findTripStopId(position), undefined);
    assert.throws(() => index.tripStopId(position), /Invalid trip stop/);
  }
});
