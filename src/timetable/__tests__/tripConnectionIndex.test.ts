import assert from 'node:assert/strict';
import { it } from 'node:test';

import { Route } from '../route.js';
import { RouteTypes, Timetable, TransferTypes } from '../timetable.js';
import { encode } from '../tripStopId.js';

it('preserves routing precedence, raw guarantees, and continuations through serialization', () => {
  const route = Route.of({
    id: 0,
    serviceRouteId: 0,
    trips: [0, 10].map((time) => ({
      stops: [0, 1].map((id) => ({
        id,
        arrivalTime: time + id,
        departureTime: time + id,
      })),
    })),
  });
  const from = { routeId: 0, tripIndex: 0, stopIndex: 1 };
  const to = { routeId: 0, tripIndex: 1, stopIndex: 0 };
  const origin = encode(1, 0, 0);
  const guaranteed = [to];
  const continuations = [{ routeId: 0, tripIndex: 0, stopIndex: 0 }];
  const timetable = new Timetable(
    [{ routes: [0] }, { routes: [0] }],
    [route],
    [{ type: RouteTypes.BUS, name: 'test', routes: [0] }],
    new Map([[encode(1, 0, 1), continuations]]),
    new Map([[origin, guaranteed]]),
    new Map([[origin, [{ ...to, minTransferTime: 0 }]]]),
  );
  // Public raw getters preserve identity and original guarantee information.
  assert.equal(timetable.getGuaranteedTripTransfers(1, 0, 0), guaranteed);
  assert.equal(timetable.getContinuousTrips(1, 0, 1), continuations);
  for (const value of [timetable, Timetable.fromData(timetable.serialize())]) {
    assert.equal(value.isTripTransferGuaranteed(from, to), true);
    assert.deepEqual(value.getTripTransferRule(from, to), {
      ...to,
      type: TransferTypes.REQUIRES_MINIMAL_TIME,
      minTransferTime: 0,
    });
    assert.equal(value.tripTransferReadyTime(from, to, 5, 15), 5);
    assert.deepEqual(value.getSpecialTrips(0), [0, 1]);
    assert.deepEqual(
      value.getTripConnections(0, 1)?.get(1)?.continuations,
      continuations,
    );
    assert.equal(
      value.getTripConnections(0, 0)?.get(1)?.rules[0],
      value.getTripTransferRule(from, to),
    );
    assert.deepEqual(value.getSpecialTrips(1), []);
    assert.equal(value.getTripConnections(0, 2), undefined);
    assert.deepEqual(value.serialize(), timetable.serialize());
  }
});
