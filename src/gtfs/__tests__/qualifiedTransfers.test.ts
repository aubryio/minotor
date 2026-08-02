import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Route } from '../../timetable/route.js';
import { durationFromSeconds, timeFromHM } from '../../timetable/time.js';
import {
  MinimumTimeTripTransfers,
  RouteTypes,
  Timetable,
  TripTransfers,
} from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopId.js';
import { GtfsStopsMap } from '../stops.js';
import {
  buildMinimumTimeTripTransfers,
  GtfsMinimumTimeTripTransfer,
  parseTransfers,
  QualifiedMinimumTimeTripTransfer,
  resolveMinimumTimeTripTransfers,
} from '../transfers.js';
import { GtfsTripIdsMap, TripsMapping } from '../trips.js';

const stops: GtfsStopsMap = new Map([
  [
    'from',
    {
      id: 0,
      sourceStopId: 'from',
      name: 'From',
      children: [],
      locationType: 'SIMPLE_STOP_OR_PLATFORM',
    },
  ],
  [
    'to',
    {
      id: 1,
      sourceStopId: 'to',
      name: 'To',
      children: [],
      locationType: 'SIMPLE_STOP_OR_PLATFORM',
    },
  ],
]);

const routes = [
  Route.of({
    id: 0,
    serviceRouteId: 10,
    trips: [
      {
        stops: [
          {
            id: 0,
            arrivalTime: timeFromHM(8, 20),
            departureTime: timeFromHM(8, 20),
          },
        ],
      },
    ],
  }),
  Route.of({
    id: 1,
    serviceRouteId: 11,
    trips: [
      {
        stops: [
          {
            id: 1,
            arrivalTime: timeFromHM(8, 21),
            departureTime: timeFromHM(8, 21),
          },
        ],
      },
      {
        stops: [
          {
            id: 1,
            arrivalTime: timeFromHM(8, 26),
            departureTime: timeFromHM(8, 26),
          },
        ],
      },
    ],
  }),
];

const timetable = (
  guaranteed?: TripTransfers,
  minimumTimes?: MinimumTimeTripTransfers,
) =>
  new Timetable(
    [{ routes: [0] }, { routes: [1] }],
    routes,
    [
      { type: RouteTypes.BUS, name: 'From route', routes: [0] },
      { type: RouteTypes.BUS, name: 'To route', routes: [1] },
    ],
    undefined,
    guaranteed,
    minimumTimes,
  );

describe('qualified type-2 transfers', () => {
  it('parses exact trip pairs with raw GTFS route qualifiers and keeps unqualified rows as stop transfers', async () => {
    const stream = Readable.from([
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,from_route_id,to_route_id,transfer_type,min_transfer_time\n',
      'from,to,trip-a,trip-b,gtfs-a,gtfs-b,2,60\n',
      'from,to,,,,,2,120\n',
      'from,to,trip-a,,,,2,180\n',
    ]);

    const result = await parseTransfers(stream, stops, new Set());

    assert.deepStrictEqual(result.minimumTimeTripTransfers, [
      {
        fromStop: 0,
        fromTrip: 'trip-a',
        fromRoute: 'gtfs-a',
        toStop: 1,
        toTrip: 'trip-b',
        toRoute: 'gtfs-b',
        minTransferTime: 1,
      },
    ]);
    assert.deepStrictEqual(result.transfers.get(0), [
      { destination: 1, type: 3, minTransferTime: 2 },
    ]);
  });

  it('resolves valid service routes and skips unknown trips, inactive routes, and qualifier mismatches', () => {
    const tripIds: GtfsTripIdsMap = new Map([
      ['trip-a', 'gtfs-a'],
      ['trip-b', 'gtfs-b'],
    ]);
    const tripsMapping: TripsMapping = new Map([
      ['trip-a', { routeId: 0, tripRouteIndex: 0 }],
      ['trip-b', { routeId: 1, tripRouteIndex: 0 }],
    ]);
    const base: GtfsMinimumTimeTripTransfer = {
      fromStop: 0,
      fromTrip: 'trip-a',
      toStop: 1,
      toTrip: 'trip-b',
      minTransferTime: 1,
    };

    const result = resolveMinimumTimeTripTransfers(
      [
        { ...base, fromRoute: 'gtfs-a', toRoute: 'gtfs-b' },
        { ...base, fromTrip: 'unknown' },
        { ...base, toRoute: 'wrong-route' },
      ],
      tripIds,
      new Map([
        ['gtfs-a', 10],
        ['gtfs-b', 11],
      ]),
      tripsMapping,
      timetable(),
    );

    assert.deepStrictEqual(result, [
      {
        ...base,
        fromRoute: 10,
        toRoute: 11,
      },
    ]);
    assert.deepStrictEqual(
      resolveMinimumTimeTripTransfers(
        [base],
        tripIds,
        new Map([['gtfs-a', 10]]),
        tripsMapping,
        timetable(),
      ),
      [],
    );
  });

  it('preserves minimum times while resolving exact trips and stop indices', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip-a', { routeId: 0, tripRouteIndex: 0 }],
      ['trip-b', { routeId: 1, tripRouteIndex: 0 }],
    ]);
    const transfer: QualifiedMinimumTimeTripTransfer = {
      fromStop: 0,
      fromTrip: 'trip-a',
      fromRoute: 10,
      toStop: 1,
      toTrip: 'trip-b',
      toRoute: 11,
      minTransferTime: 1,
    };

    assert.deepStrictEqual(
      buildMinimumTimeTripTransfers(
        tripsMapping,
        [transfer],
        timetable(),
        new Set([0, 1]),
      ),
      new Map([
        [
          encode(0, 0, 0),
          [{ stopIndex: 0, routeId: 1, tripIndex: 0, minTransferTime: 1 }],
        ],
      ]),
    );
  });

  it('uses the exact-pair minimum, keeps query fallback for other pairs, and gives guarantees priority', () => {
    const origin = { stopIndex: 0, routeId: 0, tripIndex: 0 };
    const toRoute = routes[1];
    assert(toRoute);
    const exact = new Map([
      [
        encode(0, 0, 0),
        [{ stopIndex: 0, routeId: 1, tripIndex: 0, minTransferTime: 1 }],
      ],
    ]);

    assert.strictEqual(
      timetable(undefined, exact).findFirstBoardableTrip(
        0,
        toRoute,
        0,
        timeFromHM(8, 20),
        undefined,
        origin,
        durationFromSeconds(300),
      ),
      0,
    );
    assert.strictEqual(
      timetable(undefined, exact).findFirstBoardableTrip(
        0,
        toRoute,
        0,
        timeFromHM(8, 20),
        undefined,
        { ...origin, tripIndex: 1 },
        durationFromSeconds(300),
      ),
      1,
    );

    const restrictive = new Map([
      [
        encode(0, 0, 0),
        [{ stopIndex: 0, routeId: 1, tripIndex: 0, minTransferTime: 10 }],
      ],
    ]);
    assert.strictEqual(
      timetable(undefined, restrictive).findFirstBoardableTrip(
        0,
        toRoute,
        0,
        timeFromHM(8, 20),
        undefined,
        origin,
        durationFromSeconds(300),
      ),
      1,
    );
    const missingMinimum = new Map([
      [encode(0, 0, 0), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]],
    ]);
    assert.strictEqual(
      timetable(undefined, missingMinimum).findFirstBoardableTrip(
        0,
        toRoute,
        0,
        timeFromHM(8, 20),
        undefined,
        origin,
        durationFromSeconds(300),
      ),
      1,
    );

    const guaranteed = new Map([
      [encode(0, 0, 0), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]],
    ]);
    assert.strictEqual(
      timetable(guaranteed, restrictive).findFirstBoardableTrip(
        0,
        toRoute,
        0,
        timeFromHM(8, 20),
        undefined,
        origin,
        durationFromSeconds(300),
      ),
      0,
    );
  });

  it('round-trips minimum-time trip transfers through protobuf', () => {
    const minimumTimes = new Map([
      [
        encode(0, 0, 0),
        [
          { stopIndex: 0, routeId: 1, tripIndex: 0, minTransferTime: 1 },
          { stopIndex: 0, routeId: 1, tripIndex: 1 },
        ],
      ],
    ]);

    const decoded = Timetable.fromData(
      timetable(undefined, minimumTimes).serialize(),
    );
    assert.deepStrictEqual(decoded.getMinimumTimeTripTransfers(0, 0, 0), [
      { stopIndex: 0, routeId: 1, tripIndex: 0, minTransferTime: 1 },
      {
        stopIndex: 0,
        routeId: 1,
        tripIndex: 1,
        minTransferTime: undefined,
      },
    ]);
  });
});
