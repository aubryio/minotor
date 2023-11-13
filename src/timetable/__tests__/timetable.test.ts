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
      'stop1',
      {
        transfers: [{ destination: 'stop2', type: 'RECOMMENDED' }],
        routes: ['route1'],
      },
    ],
    [
      'stop2',
      {
        transfers: [
          {
            destination: 'stop1',
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
        stopTimes: [
          {
            arrival: Time.fromHMS(0, 16, 40),
            departure: Time.fromHMS(0, 16, 50),
            pickUpType: 'REGULAR',
            dropOffType: 'REGULAR',
          },
          {
            arrival: Time.fromHMS(0, 33, 20),
            departure: Time.fromHMS(0, 33, 30),
            pickUpType: 'NOT_AVAILABLE',
            dropOffType: 'REGULAR',
          },
          {
            arrival: Time.fromHMS(0, 50, 0),
            departure: Time.fromHMS(0, 50, 10),
            pickUpType: 'REGULAR',
            dropOffType: 'REGULAR',
          },
          {
            arrival: Time.fromHMS(1, 10, 0),
            departure: Time.fromHMS(1, 10, 10),
            pickUpType: 'REGULAR',
            dropOffType: 'REGULAR',
          },
        ],
        stops: ['stop1', 'stop2'],
        stopIndices: new Map([
          ['stop1', 0],
          ['stop2', 1],
        ]),
        serviceRouteId: 'gtfs1',
      },
    ],
    [
      'route2',
      {
        stopTimes: [
          {
            arrival: Time.fromHMS(1, 6, 40),
            departure: Time.fromHMS(1, 6, 50),
            pickUpType: 'REGULAR',
            dropOffType: 'REGULAR',
          },
          {
            arrival: Time.fromHMS(1, 23, 20),
            departure: Time.fromHMS(1, 23, 30),
            pickUpType: 'REGULAR',
            dropOffType: 'REGULAR',
          },
        ],
        stops: ['stop2', 'stop1'],
        stopIndices: new Map([
          ['stop2', 0],
          ['stop1', 1],
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
    const tripIndex = sampleTimetable.findEarliestTrip(route, 'stop1');
    assert.strictEqual(tripIndex, 0);
  });

  it('should find the earliest trip for stop1 on route1 after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute('route1')!;
    const afterTime = Time.fromHMS(0, 25, 0);
    const tripIndex = sampleTimetable.findEarliestTrip(
      route,
      'stop1',
      undefined,
      afterTime,
    );
    assert.strictEqual(tripIndex, 1);
  });

  it('should return undefined if no valid trip exists after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute('route1')!;
    const afterTime = Time.fromHMS(0, 58, 20);
    const tripIndex = sampleTimetable.findEarliestTrip(
      route,
      'stop1',
      undefined,
      afterTime,
    );
    assert.strictEqual(tripIndex, undefined);
  });
  it('should return undefined if the stop on a trip has pick up not available', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute('route1')!;
    const tripIndex = sampleTimetable.findEarliestTrip(route, 'stop2');
    assert.strictEqual(tripIndex, 1);
  });
  it('should find reachable routes from a set of stop IDs', () => {
    const fromStops = new Set(['stop1']);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
    assert.strictEqual(reachableRoutes.size, 1);
    assert.strictEqual(reachableRoutes.get('route1'), 'stop1');
  });

  it('should find no reachable routes if starting from a non-existent stop', () => {
    const fromStops = new Set(['non_existent_stop']);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
    assert.strictEqual(reachableRoutes.size, 0);
  });

  it('should find reachable routes filtered by transport modes', () => {
    const fromStops = new Set(['stop1']);
    const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops, [
      'BUS',
    ]);
    assert.strictEqual(reachableRoutes.size, 0);
  });
});
