import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StopId } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { Duration, Time } from '../../timetable/time.js';
import {
  RouteTypes,
  Timetable,
  TransferTypes,
} from '../../timetable/timetable.js';
import { Query, RangeQuery } from '../query.js';
import { Router } from '../router.js';

/** Independent direct services make destination dominance visible without transfers. */
const makeRouter = (
  services: [StopId[], Time[]][],
  accessDuration?: Duration,
): Router => {
  const routes = services.map(([stops, times], id) =>
    Route.of({
      id,
      serviceRouteId: 0,
      trips: [
        {
          stops: stops.map((stop, position) => {
            const time = times[position];
            assert.ok(time !== undefined);
            return { id: stop, arrivalTime: time, departureTime: time };
          }),
        },
      ],
    }),
  );
  const stops = [0, 1, 2].map((id) => ({
    id,
    sourceStopId: String(id),
    name: String(id),
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM' as const,
  }));
  return new Router(
    new Timetable(
      stops.map(({ id }) => ({
        transfers:
          id === 0 && accessDuration !== undefined
            ? [
                {
                  destination: 1,
                  type: TransferTypes.REQUIRES_MINIMAL_TIME,
                  minTransferTime: accessDuration,
                },
              ]
            : undefined,
        routes: routes
          .filter((route) => [...route.stops].includes(id))
          .map((route) => route.id),
      })),
      routes,
      [
        {
          name: 'test',
          type: RouteTypes.BUS,
          routes: routes.map((route) => route.id),
        },
      ],
    ),
    new StopsIndex(stops),
  );
};

const point = (destinations: StopId[]) =>
  new Query.Builder()
    .from(0)
    .to(new Set(destinations))
    .departureTime(480)
    .build();

const range = (boundary: boolean, destinations = [1, 2]) =>
  new RangeQuery.Builder()
    .from(0)
    .to(new Set(destinations))
    .departureTime(470)
    .lastDepartureTime(490)
    .rangeOptions({ optimizeBeyondLatestDeparture: boundary })
    .build();

describe('alternative destinations', () => {
  it('does not need to reach a slower destination on the same vehicle', () => {
    const result = makeRouter([
      [
        [0, 1, 2],
        [480, 490, 500],
      ],
    ]).route(point([1, 2]));
    assert.equal(result.bestRoute()?.arrivalTime(), 490);
    assert.equal(result.arrivalAt(2), undefined);
  });

  it('continues after the first discovery to find a better destination arrival', () => {
    const result = makeRouter([
      [
        [0, 1],
        [480, 520],
      ],
      [
        [0, 2],
        [485, 500],
      ],
    ]).route(point([1, 2]));
    assert.equal(result.bestRoute()?.arrivalTime(), 500);
  });

  it('accepts one destination when alternatives have equal arrival times', () => {
    const result = makeRouter([
      [
        [0, 1],
        [480, 500],
      ],
      [
        [0, 2],
        [480, 500],
      ],
    ]).route(point([1, 2]));
    assert.equal(result.bestRoute()?.arrivalTime(), 500);
  });

  it('uses an origin destination without exploring slower alternatives', () => {
    const router = makeRouter([
      [
        [0, 2],
        [480, 500],
      ],
    ]);
    const result = router.route(point([0, 2]));
    assert.equal(result.arrivalAt(0)?.arrival, 480);
    assert.equal(result.arrivalAt(2), undefined);
    const runs = [...router.rangeRoute(range(false, [0, 2]))];
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.result.arrivalAt(2), undefined);
  });

  it('keeps a departure/arrival frontier across destinations, not one per destination', () => {
    const router = makeRouter([
      [
        [0, 1],
        [480, 520],
      ],
      [
        [0, 2],
        [490, 510],
      ],
      [
        [0, 1],
        [470, 500],
      ],
      [
        [0, 2],
        [500, 505],
      ],
    ]);
    for (const boundary of [false, true]) {
      const runs = [...router.rangeRoute(range(boundary))];
      assert.deepEqual(
        runs.map(({ departureTime, result }) => [
          departureTime,
          result.bestRoute()?.arrivalTime(),
        ]),
        boundary
          ? [[470, 500]]
          : [
              [490, 510],
              [470, 500],
            ],
      );
    }
  });

  it('keeps an earlier fast transit option after retaining a walking alternative', () => {
    const router = makeRouter(
      [
        [
          [0, 2],
          [480, 485],
        ],
        [
          [0, 2],
          [490, 520],
        ],
        // Include the walking access path in the departure slot at 490.
        [
          [1, 2],
          [500, 530],
        ],
      ],
      10,
    );
    const runs = [...router.rangeRoute(range(false))];
    assert.deepEqual(
      runs.map(({ departureTime, result }) => [
        departureTime,
        Math.min(
          result.arrivalAt(1)?.arrival ?? Infinity,
          result.arrivalAt(2)?.arrival ?? Infinity,
        ),
      ]),
      [
        [490, 500],
        [480, 485],
      ],
    );
  });

  it('prefers a later departure when different destinations have equal arrival times', () => {
    const router = makeRouter([
      [
        [0, 1],
        [480, 510],
      ],
      [
        [0, 2],
        [490, 510],
      ],
    ]);
    const runs = [...router.rangeRoute(range(false))];
    assert.deepEqual(
      runs.map(({ departureTime }) => departureTime),
      [490],
    );
  });

  it('still explores all reachable stops when no destination is specified', () => {
    const router = makeRouter([
      [
        [0, 1, 2],
        [480, 490, 500],
      ],
    ]);
    const result = router.route(point([]));
    assert.equal(result.arrivalAt(1)?.arrival, 490);
    assert.equal(result.arrivalAt(2)?.arrival, 500);
    const runs = [...router.rangeRoute(range(false, []))];
    assert.equal(runs[0]?.result.arrivalAt(2)?.arrival, 500);
  });
});
