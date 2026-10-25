import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import {
  MinimumTripTransfers,
  RouteTypes,
  Timetable,
  TransferTypes,
  TripTransfers,
} from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopId.js';
import { Query, RangeQuery } from '../query.js';
import { Router } from '../router.js';

const line = (id: number, times: [number, number][]) =>
  Route.of({
    id,
    serviceRouteId: id,
    trips: times.map(([departure, arrival]) => ({
      stops: [
        { id, arrivalTime: departure, departureTime: departure },
        { id: id + 1, arrivalTime: arrival, departureTime: arrival },
      ],
    })),
  });

const makeRouter = (
  routes: Route[],
  minimum?: MinimumTripTransfers,
  guaranteed?: TripTransfers,
  continuations?: TripTransfers,
) => {
  const stops = Array.from({ length: routes.length + 1 }, (_, id) => ({
    id,
    sourceStopId: String(id),
    name: String(id),
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM' as const,
  }));
  return new Router(
    new Timetable(
      stops.map(({ id }) => ({
        routes: routes
          .filter((route) => route.stops.includes(id))
          .map((r) => r.id),
      })),
      routes,
      routes.map(({ id }) => ({
        type: RouteTypes.BUS,
        name: String(id),
        routes: [id],
      })),
      continuations,
      guaranteed,
      minimum,
    ),
    new StopsIndex(stops),
  );
};

describe('special-trip routing', () => {
  for (const [minimum, fallback, expectedArrival] of [
    [5, 1, 40],
    [0, 5, 30],
  ] as const) {
    it(`preserves an exact-pair minimum of ${minimum} with fallback ${fallback}`, () => {
      const router = makeRouter(
        [
          line(0, [[10, 20]]),
          line(1, [
            [22, 30],
            [30, 40],
          ]),
        ],
        new Map([
          [
            encode(1, 0, 0),
            [
              {
                routeId: 1,
                tripIndex: 0,
                stopIndex: 0,
                minTransferTime: minimum,
              },
            ],
          ],
        ]),
      );
      const query = new Query.Builder()
        .from(0)
        .to(2)
        .departureTime(9)
        .minTransferTime(fallback)
        .build();
      const first = router.route(query);
      const route = first.bestRoute();
      assert.ok(route);
      assert.equal(route.arrivalTime(), expectedArrival);
      assert.equal(first.arrivalAt(2)?.legNumber, 2);
      const range = router.rangeRoute(
        new RangeQuery.Builder()
          .from(0)
          .to(2)
          .departureTime(9)
          .lastDepartureTime(11)
          .minTransferTime(fallback)
          .build(),
      );
      assert.deepEqual(range.getRoutes(), [route]);
      assert.deepEqual(first.bestRoute(), route);
    });
  }

  it('retains a later arrival whose guaranteed connection beats the earlier arrival', () => {
    const router = makeRouter(
      [
        line(0, [
          [10, 20],
          [11, 21],
        ]),
        line(1, [
          [22, 30],
          [30, 40],
        ]),
      ],
      new Map([
        [
          encode(1, 0, 0),
          [{ routeId: 1, tripIndex: 0, stopIndex: 0, minTransferTime: 5 }],
        ],
      ]),
      new Map([
        [encode(1, 0, 1), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    const first = router.route(
      new Query.Builder()
        .from(0)
        .to(2)
        .departureTime(9)
        .minTransferTime(5)
        .build(),
    );
    const route = first.bestRoute();
    assert.ok(route);
    assert.equal(route.departureTime(), 11);
    assert.equal(route.arrivalTime(), 30);
    assert.equal(first.arrivalAt(2)?.legNumber, 2);
    const transfer = route.legs[1];
    assert.ok(transfer && 'type' in transfer);
    assert.equal(transfer.type, TransferTypes.GUARANTEED);
    const range = router.rangeRoute(
      new RangeQuery.Builder()
        .from(0)
        .to(2)
        .departureTime(9)
        .lastDepartureTime(11)
        .minTransferTime(5)
        .build(),
    );
    assert.deepEqual(range.getRoutes(), [route]);
    assert.deepEqual(first.bestRoute(), route);
  });

  it('preserves continuation chains in one transit round', () => {
    const router = makeRouter(
      [line(0, [[10, 20]]), line(1, [[21, 30]]), line(2, [[31, 40]])],
      undefined,
      undefined,
      new Map([
        [encode(1, 0, 0), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
        [encode(1, 1, 0), [{ routeId: 2, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    const first = router.route(
      new Query.Builder()
        .from(0)
        .to(3)
        .departureTime(9)
        .maxTransfers(0)
        .build(),
    );
    const route = first.bestRoute();
    assert.ok(route);
    assert.equal(route.arrivalTime(), 40);
    assert.equal(first.arrivalAt(3)?.legNumber, 1);
    const range = router.rangeRoute(
      new RangeQuery.Builder()
        .from(0)
        .to(3)
        .departureTime(9)
        .lastDepartureTime(11)
        .maxTransfers(0)
        .build(),
    );
    assert.deepEqual(range.getRoutes(), [route]);
    assert.deepEqual(first.bestRoute(), route);
  });
});
