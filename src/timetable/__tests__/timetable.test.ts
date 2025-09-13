import assert from 'node:assert';
import { describe, it } from 'node:test';

import { encodePickUpDropOffTypes } from '../../gtfs/trips.js';
import { Duration } from '../duration.js';
import { NOT_AVAILABLE, REGULAR, Route } from '../route.js';
import { Time } from '../time.js';
import {
  RouteType,
  ServiceRoutesMap,
  StopsAdjacency,
  Timetable,
} from '../timetable.js';

describe('Timetable', () => {
  const stopsAdjacency: StopsAdjacency = new Map([
    [
      1,
      {
        transfers: [{ destination: 2, type: 'RECOMMENDED' }],
        routes: [0, 1],
      },
    ],
    [
      2,
      {
        transfers: [
          {
            destination: 1,
            type: 'GUARANTEED',
            minTransferTime: Duration.fromMinutes(3),
          },
        ],
        routes: [1, 0],
      },
    ],
    [
      3,
      {
        transfers: [],
        routes: [],
      },
    ],
  ]);

  const route1 = new Route(
    new Uint16Array([
      Time.fromHMS(16, 40, 0).toMinutes(),
      Time.fromHMS(16, 50, 0).toMinutes(),
      Time.fromHMS(17, 20, 0).toMinutes(),
      Time.fromHMS(17, 30, 0).toMinutes(),
      Time.fromHMS(18, 0, 0).toMinutes(),
      Time.fromHMS(18, 10, 0).toMinutes(),
      Time.fromHMS(19, 0, 0).toMinutes(),
      Time.fromHMS(19, 10, 0).toMinutes(),
    ]),
    encodePickUpDropOffTypes(
      [REGULAR, NOT_AVAILABLE, REGULAR, REGULAR],
      [REGULAR, REGULAR, REGULAR, REGULAR],
    ),
    new Uint32Array([1, 2]),
    'gtfs1',
  );
  const route2 = new Route(
    new Uint16Array([
      Time.fromHMS(18, 20, 0).toMinutes(),
      Time.fromHMS(18, 30, 0).toMinutes(),
      Time.fromHMS(23, 20, 0).toMinutes(),
      Time.fromHMS(23, 30, 0).toMinutes(),
    ]),
    encodePickUpDropOffTypes([REGULAR, REGULAR], [REGULAR, REGULAR]),
    new Uint32Array([2, 1]),
    'gtfs2',
  );
  const routesAdjacency = [route1, route2];
  const routes: ServiceRoutesMap = new Map([
    ['gtfs1', { type: 'RAIL', name: 'Route 1', routes: [0] }],
    ['gtfs2', { type: 'RAIL', name: 'Route 2', routes: [1] }],
  ]);

  const sampleTimetable: Timetable = new Timetable(
    stopsAdjacency,
    routesAdjacency,
    routes,
  );

  it('should serialize a timetable to a Uint8Array', () => {
    const serializedData = sampleTimetable.serialize();
    assert(serializedData instanceof Uint8Array);
    assert(serializedData.length > 0);
  });
  it('should deserialize a Uint8Array to a timetable', () => {
    const serializedData = sampleTimetable.serialize();
    const deserializedTimetable = Timetable.fromData(serializedData);
    assert.deepStrictEqual(deserializedTimetable, sampleTimetable);
  });

  it('should find the earliest trip for stop1 on route1', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const tripIndex = route.findEarliestTrip(1);
    assert.strictEqual(tripIndex, 0);
  });

  it('should find the earliest trip for stop1 on route1 after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const afterTime = Time.fromHMS(17, 0, 0);
    const tripIndex = route.findEarliestTrip(1, afterTime);
    assert.strictEqual(tripIndex, 1);
  });

  it('should return undefined if no valid trip exists after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const afterTime = Time.fromHMS(23, 40, 0);
    const tripIndex = route.findEarliestTrip(1, afterTime);
    assert.strictEqual(tripIndex, undefined);
  });
  it('should return undefined if the stop on a trip has pick up not available', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const tripIndex = route.findEarliestTrip(2);
    assert.strictEqual(tripIndex, 1);
  });
  it('should find reachable routes from a set of stop IDs', () => {
    const fromStops = new Set([1]);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
    assert.strictEqual(reachableRoutes.size, 2);
    assert.deepStrictEqual(
      reachableRoutes,
      new Map([
        [route1, 1],
        [route2, 1],
      ]),
    );
  });

  it('should find no reachable routes if starting from a non-existent stop', () => {
    const fromStops = new Set([3]);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
    assert.strictEqual(reachableRoutes.size, 0);
  });

  it('should find reachable routes filtered by transport modes', () => {
    const fromStops = new Set([1]);
    const reachableRoutes = sampleTimetable.findReachableRoutes(
      fromStops,
      new Set<RouteType>(['BUS']),
    );
    assert.strictEqual(reachableRoutes.size, 0);
  });
});
