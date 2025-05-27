import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Duration } from '../duration.js';
import { Time } from '../time.js';
import {
  RoutesAdjacency,
  ServiceRoutesMap,
  StopsAdjacency,
  Timetable,
} from '../timetable.js';

describe('timetable io', () => {
  const stopsAdjacency: StopsAdjacency = new Map([
    [
      1,
      {
        transfers: [{ destination: 2, type: 'RECOMMENDED' }],
        routes: ['route1'],
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
        routes: ['route2'],
      },
    ],
  ]);
  const routesAdjacency: RoutesAdjacency = new Map([
    [
      'route1',
      {
        stopTimes: new Uint16Array([
          Time.fromHMS(16, 40, 0).toMinutes(),
          Time.fromHMS(16, 50, 0).toMinutes(),
          Time.fromHMS(17, 20, 0).toMinutes(),
          Time.fromHMS(17, 30, 0).toMinutes(),
          Time.fromHMS(18, 0, 0).toMinutes(),
          Time.fromHMS(18, 10, 0).toMinutes(),
          Time.fromHMS(19, 0, 0).toMinutes(),
          Time.fromHMS(19, 10, 0).toMinutes(),
        ]),
        pickUpDropOffTypes: new Uint8Array([
          0,
          0, // REGULAR
          1,
          0, // NOT_AVAILABLE, REGULAR
          0,
          0, // REGULAR
          0,
          0, // REGULAR
        ]),
        stops: new Uint32Array([1, 2]),
        stopIndices: new Map([
          [1, 0],
          [2, 1],
        ]),
        serviceRouteId: 'gtfs1',
      },
    ],
    [
      'route2',
      {
        stopTimes: new Uint16Array([
          Time.fromHMS(18, 20, 0).toMinutes(),
          Time.fromHMS(18, 30, 0).toMinutes(),
          Time.fromHMS(23, 20, 0).toMinutes(),
          Time.fromHMS(23, 30, 0).toMinutes(),
        ]),
        pickUpDropOffTypes: new Uint8Array([
          0,
          0, // REGULAR
          0,
          0, // REGULAR
        ]),
        stops: new Uint32Array([2, 1]),
        stopIndices: new Map([
          [2, 0],
          [1, 1],
        ]),
        serviceRouteId: 'gtfs2',
      },
    ],
  ]);
  const routes: ServiceRoutesMap = new Map([
    ['gtfs1', { type: 'RAIL', name: 'Route 1' }],
    ['gtfs2', { type: 'RAIL', name: 'Route 2' }],
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
    const route = sampleTimetable.getRoute('route1')!;
    const tripIndex = sampleTimetable.findEarliestTrip(route, 1);
    assert.strictEqual(tripIndex, 0);
  });

  it('should find the earliest trip for stop1 on route1 after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute('route1')!;
    const afterTime = Time.fromHMS(17, 0, 0);
    const tripIndex = sampleTimetable.findEarliestTrip(
      route,
      1,
      undefined,
      afterTime,
    );
    assert.strictEqual(tripIndex, 1);
  });

  it('should return undefined if no valid trip exists after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute('route1')!;
    const afterTime = Time.fromHMS(23, 40, 0);
    const tripIndex = sampleTimetable.findEarliestTrip(
      route,
      1,
      undefined,
      afterTime,
    );
    assert.strictEqual(tripIndex, undefined);
  });
  it('should return undefined if the stop on a trip has pick up not available', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute('route1')!;
    const tripIndex = sampleTimetable.findEarliestTrip(route, 2);
    assert.strictEqual(tripIndex, 1);
  });
  it('should find reachable routes from a set of stop IDs', () => {
    const fromStops = new Set([1]);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
    assert.strictEqual(reachableRoutes.size, 1);
    assert.strictEqual(reachableRoutes.get('route1'), 1);
  });

  it('should find no reachable routes if starting from a non-existent stop', () => {
    const fromStops = new Set([5]);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
    assert.strictEqual(reachableRoutes.size, 0);
  });

  it('should find reachable routes filtered by transport modes', () => {
    const fromStops = new Set([1]);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops, [
      'BUS',
    ]);
    assert.strictEqual(reachableRoutes.size, 0);
  });
});
