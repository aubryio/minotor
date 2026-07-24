import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Query } from '../../routing/query.js';
import { Router } from '../../routing/router.js';
import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHM } from '../../timetable/time.js';
import {
  RouteTypes,
  ServiceRoute,
  Timetable,
  TransferTypes,
} from '../../timetable/timetable.js';
import { GtfsStopsMap } from '../stops.js';
import {
  addMissingSiblingTransfers,
  ForbiddenTransfersMap,
  TransfersMap,
} from '../transfers.js';
import { buildStopsAdjacencyStructure } from '../trips.js';

const stops: Stop[] = [
  {
    id: 0,
    sourceStopId: 'station',
    name: 'Interchange',
    children: [1, 2],
    locationType: 'STATION',
  },
  {
    id: 1,
    sourceStopId: 'platform-a',
    name: 'Interchange',
    parent: 0,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 2,
    sourceStopId: 'platform-b',
    name: 'Interchange',
    parent: 0,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 3,
    sourceStopId: 'destination',
    name: 'Destination',
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 4,
    sourceStopId: 'origin',
    name: 'Origin',
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
];

const stopsMap: GtfsStopsMap = new Map();
for (const stop of stops) {
  if (stop.sourceStopId === undefined) {
    throw new Error(`Missing source stop ID for stop ${stop.id}`);
  }
  stopsMap.set(stop.sourceStopId, stop);
}

describe('missing sibling transfers', () => {
  it('adds directed fallback transfers between active sibling platforms', () => {
    const transfers: TransfersMap = new Map();

    const added = addMissingSiblingTransfers(
      stopsMap,
      new Set([1, 2]),
      transfers,
    );

    assert.strictEqual(added, 2);
    assert.deepStrictEqual(
      transfers,
      new Map([
        [
          1,
          [
            {
              destination: 2,
              type: TransferTypes.REQUIRES_MINIMAL_TIME,
            },
          ],
        ],
        [
          2,
          [
            {
              destination: 1,
              type: TransferTypes.REQUIRES_MINIMAL_TIME,
            },
          ],
        ],
      ]),
    );
  });

  it('preserves explicit transfers and respects forbidden directions', () => {
    const transfers: TransfersMap = new Map([
      [
        1,
        [
          {
            destination: 2,
            type: TransferTypes.REQUIRES_MINIMAL_TIME,
            minTransferTime: 7,
          },
        ],
      ],
    ]);
    const forbiddenTransfers: ForbiddenTransfersMap = new Map([
      [2, new Set([1])],
    ]);

    const added = addMissingSiblingTransfers(
      stopsMap,
      new Set([1, 2]),
      transfers,
      forbiddenTransfers,
    );

    assert.strictEqual(added, 0);
    assert.deepStrictEqual(transfers.get(1), [
      {
        destination: 2,
        type: TransferTypes.REQUIRES_MINIMAL_TIME,
        minTransferTime: 7,
      },
    ]);
    assert.strictEqual(transfers.has(2), false);
  });

  it('routes through sibling platforms and reconstructs the interchange', () => {
    const routes = [
      Route.of({
        id: 0,
        serviceRouteId: 0,
        trips: [
          {
            stops: [
              {
                id: 4,
                arrivalTime: timeFromHM(8, 0),
                departureTime: timeFromHM(8, 0),
              },
              {
                id: 1,
                arrivalTime: timeFromHM(8, 10),
                departureTime: timeFromHM(8, 10),
              },
            ],
          },
        ],
      }),
      Route.of({
        id: 1,
        serviceRouteId: 1,
        trips: [
          {
            stops: [
              {
                id: 2,
                arrivalTime: timeFromHM(8, 15),
                departureTime: timeFromHM(8, 15),
              },
              {
                id: 3,
                arrivalTime: timeFromHM(8, 30),
                departureTime: timeFromHM(8, 30),
              },
            ],
          },
        ],
      }),
    ];
    const serviceRoutes: ServiceRoute[] = [
      { type: RouteTypes.BUS, name: 'First', routes: [] },
      { type: RouteTypes.BUS, name: 'Second', routes: [] },
    ];
    const activeStops = new Set([1, 2, 3, 4]);
    const transfers: TransfersMap = new Map();
    addMissingSiblingTransfers(stopsMap, activeStops, transfers);
    const adjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routes,
      transfers,
      stops.length,
      activeStops,
    );
    const router = new Router(
      new Timetable(adjacency, routes, serviceRoutes),
      new StopsIndex(stops),
    );

    const result = router.route(
      new Query.Builder()
        .from(4)
        .to(3)
        .departureTime(timeFromHM(8, 0))
        .minTransferTime(2)
        .build(),
    );
    const route = result.bestRoute();

    assert.deepStrictEqual(result.arrivalAt(3), {
      arrival: timeFromHM(8, 30),
      legNumber: 2,
    });
    assert(route);
    assert.strictEqual(route.legs.length, 3);
    const firstLeg = route.legs[0];
    assert(firstLeg);
    assert('route' in firstLeg);
    assert.deepStrictEqual(route.legs[1], {
      from: stops[1],
      to: stops[2],
      minTransferTime: 2,
      type: 'REQUIRES_MINIMAL_TIME',
    });
    const lastLeg = route.legs[2];
    assert(lastLeg);
    assert('route' in lastLeg);
  });
});
