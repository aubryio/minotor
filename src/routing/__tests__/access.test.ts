/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHM } from '../../timetable/time.js';
import {
  ServiceRoute,
  StopAdjacency,
  Timetable,
} from '../../timetable/timetable.js';
import { AccessFinder, AccessPoint } from '../access.js';

// Timetable: stop 0 is an isolated origin; stop 1 is a boarding stop on route 0;
// stop 2 is a second stop served by route 0.
// Stop 0 has a REQUIRES_MINIMAL_TIME transfer to stop 1 (5 min)
//         and a GUARANTEED transfer to stop 2 (must be ignored).
const stopsAdjacency: StopAdjacency[] = [
  {
    transfers: [
      { destination: 1, type: 'REQUIRES_MINIMAL_TIME', minTransferTime: 5 },
      { destination: 2, type: 'GUARANTEED' },
    ],
    routes: [],
  },
  { routes: [0] },
  { routes: [0] },
];

const routesAdjacency = [
  Route.of({
    id: 0,
    serviceRouteId: 0,
    trips: [
      {
        stops: [
          {
            id: 1,
            arrivalTime: timeFromHM(8, 10),
            departureTime: timeFromHM(8, 10),
          },
          {
            id: 2,
            arrivalTime: timeFromHM(8, 20),
            departureTime: timeFromHM(8, 20),
          },
        ],
      },
      {
        stops: [
          {
            id: 1,
            arrivalTime: timeFromHM(8, 40),
            departureTime: timeFromHM(8, 40),
          },
          {
            id: 2,
            arrivalTime: timeFromHM(8, 50),
            departureTime: timeFromHM(8, 50),
          },
        ],
      },
    ],
  }),
];

const serviceRoutes: ServiceRoute[] = [
  { type: 'BUS', name: 'Line 1', routes: [0] },
];

const stops: Stop[] = [
  {
    id: 0,
    sourceStopId: 'A',
    name: 'Stop A',
    lat: 0,
    lon: 0,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 1,
    sourceStopId: 'B',
    name: 'Stop B',
    lat: 0,
    lon: 0,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 2,
    sourceStopId: 'C',
    name: 'Stop C',
    lat: 0,
    lon: 0,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
];

const timetable = new Timetable(stopsAdjacency, routesAdjacency, serviceRoutes);
const stopsIndex = new StopsIndex(stops);
const finder = new AccessFinder(timetable, stopsIndex);

describe('AccessFinder', () => {
  describe('collectAccessPaths', () => {
    it('returns the origin itself as a zero-cost access path', () => {
      const paths = finder.collectAccessPaths(0, 2);
      const selfPath = paths.find((p) => p.toStopId === 0);
      assert(selfPath);
      assert.strictEqual(selfPath.duration, 0);
    });

    it('includes REQUIRES_MINIMAL_TIME transfers with the specified duration', () => {
      const paths = finder.collectAccessPaths(0, 2);
      const walkPath = paths.find((p) => p.toStopId === 1);
      assert(walkPath);
      assert.strictEqual(walkPath.duration, 5);
      assert.strictEqual(walkPath.fromStopId, 0);
    });

    it('uses the fallback transfer time when the timetable specifies none', () => {
      // Temporarily use a timetable where the transfer has no minTransferTime.
      const adj: StopAdjacency[] = [
        {
          transfers: [{ destination: 1, type: 'REQUIRES_MINIMAL_TIME' }],
          routes: [],
        },
        { routes: [0] },
        { routes: [0] },
      ];
      const localTimetable = new Timetable(adj, routesAdjacency, serviceRoutes);
      const localFinder = new AccessFinder(localTimetable, stopsIndex);
      const paths = localFinder.collectAccessPaths(0, 3); // fallback = 3 min
      const walkPath = paths.find((p) => p.toStopId === 1);
      assert(walkPath);
      assert.strictEqual(walkPath.duration, 3);
    });

    it('does not include GUARANTEED transfers', () => {
      const paths = finder.collectAccessPaths(0, 2);
      const guaranteedPath = paths.find((p) => p.toStopId === 2);
      assert.strictEqual(guaranteedPath, undefined);
    });

    it('keeps the shortest walk when multiple equivalent origins can reach the same stop', () => {
      // Parent stop 3 with two children: stop 4 (8-min walk to stop 1)
      // and stop 5 (3-min walk to stop 1).
      const adj: StopAdjacency[] = [
        { routes: [] },
        { routes: [0] },
        { routes: [0] },
        { routes: [] },
        {
          transfers: [
            {
              destination: 1,
              type: 'REQUIRES_MINIMAL_TIME',
              minTransferTime: 8,
            },
          ],
          routes: [],
        },
        {
          transfers: [
            {
              destination: 1,
              type: 'REQUIRES_MINIMAL_TIME',
              minTransferTime: 3,
            },
          ],
          routes: [],
        },
      ];
      const extraStops: Stop[] = [
        ...stops,
        {
          id: 3,
          sourceStopId: 'parent',
          name: 'Parent',
          lat: 0,
          lon: 0,
          children: [4, 5],
          locationType: 'STATION',
        },
        {
          id: 4,
          sourceStopId: 'child1',
          name: 'Child 1',
          lat: 0,
          lon: 0,
          children: [],
          parent: 3,
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 5,
          sourceStopId: 'child2',
          name: 'Child 2',
          lat: 0,
          lon: 0,
          children: [],
          parent: 3,
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];
      const localTimetable = new Timetable(adj, routesAdjacency, serviceRoutes);
      const localStopsIndex = new StopsIndex(extraStops);
      const localFinder = new AccessFinder(localTimetable, localStopsIndex);

      // Origin is child stop 4; equivalentStops(4) = [4, 5] (siblings).
      const paths = localFinder.collectAccessPaths(4, 2);
      const walkToStop1 = paths.find((p) => p.toStopId === 1);
      assert(walkToStop1);
      assert.strictEqual(walkToStop1.duration, 3); // shorter walk wins
      assert.strictEqual(walkToStop1.fromStopId, 5);
    });
  });

  describe('collectDepartureTimes', () => {
    it('returns slots sorted latest-departure-first', () => {
      const paths: AccessPoint[] = [
        { fromStopId: 0, toStopId: 1, duration: 0 },
      ];
      const slots = finder.collectDepartureTimes(
        paths,
        timeFromHM(8, 0),
        timeFromHM(8, 45),
      );
      assert.strictEqual(slots.length, 2);
      assert.strictEqual(slots[0]?.depTime, timeFromHM(8, 40));
      assert.strictEqual(slots[1]?.depTime, timeFromHM(8, 10));
    });

    it('excludes trips departing outside the query window', () => {
      const paths: AccessPoint[] = [
        { fromStopId: 0, toStopId: 1, duration: 0 },
      ];
      const slots = finder.collectDepartureTimes(
        paths,
        timeFromHM(8, 0),
        timeFromHM(8, 30),
      );
      assert.strictEqual(slots.length, 1);
      assert.strictEqual(slots[0]?.depTime, timeFromHM(8, 10));
    });

    it('returns empty when no trip falls within the window', () => {
      const paths: AccessPoint[] = [
        { fromStopId: 0, toStopId: 1, duration: 0 },
      ];
      const slots = finder.collectDepartureTimes(
        paths,
        timeFromHM(9, 0),
        timeFromHM(10, 0),
      );
      assert.strictEqual(slots.length, 0);
    });

    it('zero-duration paths to stops with routes generate slots at exact trip departure times', () => {
      // The self-path (stop 0, duration 0) has no routes in this timetable,
      // so it contributes no slots. The walk path (stop 1, duration 5) has
      // trips at 08:10 and 08:40; with the window ending at 08:05 only the
      // 08:10 trip is reachable, producing a single slot at 08:05 (= 08:10 - 5).
      const equivalentPath: AccessPoint = {
        fromStopId: 0,
        toStopId: 0,
        duration: 0,
      };
      const walkPath: AccessPoint = {
        fromStopId: 0,
        toStopId: 1,
        duration: 5,
      };

      const slots = finder.collectDepartureTimes(
        [equivalentPath, walkPath],
        timeFromHM(8, 0),
        timeFromHM(8, 5),
      );

      assert.strictEqual(slots.length, 1);
      assert.strictEqual(slots[0]!.depTime, timeFromHM(8, 5));
      const legIds = slots[0]!.legs.map((l) => l.toStopId);
      assert(legIds.includes(1), 'walk path must appear in its own slot');
      assert(
        !legIds.includes(0),
        'equivalent path without routes must not appear in a slot it did not generate',
      );
    });
  });
});
