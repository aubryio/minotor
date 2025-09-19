import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Duration } from '../../timetable/duration.js';
import { REGULAR, Route } from '../../timetable/route.js';
import { Time } from '../../timetable/time.js';
import {
  ServiceRoute,
  StopAdjacency,
  Timetable,
} from '../../timetable/timetable.js';
import { Query } from '../query.js';
import { Result } from '../result.js';
import { Router } from '../router.js';

describe('Router', () => {
  describe('with a single route', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      const stopsAdjacency: StopAdjacency[] = [
        { transfers: [], routes: [0] },
        { transfers: [], routes: [0] },
        { transfers: [], routes: [0] },
      ];

      const routesAdjacency = [
        new Route(
          new Uint16Array([
            Time.fromString('08:00:00').toMinutes(),
            Time.fromString('08:10:00').toMinutes(),
            Time.fromString('08:15:00').toMinutes(),
            Time.fromString('08:25:00').toMinutes(),
            Time.fromString('08:35:00').toMinutes(),
            Time.fromString('08:45:00').toMinutes(),
          ]),
          new Uint8Array([
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
          ]),
          new Uint32Array([0, 1, 2]),
          0,
        ),
      ];

      const routes: ServiceRoute[] = [
        {
          type: 'BUS',
          name: 'Line 1',
          routes: [0],
        },
      ];

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);
      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          lat: 1.0,
          lon: 1.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          lat: 2.0,
          lon: 2.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          lat: 3.0,
          lon: 3.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];
      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should find a direct route', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop3')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const bestRoute = result.bestRoute();
      assert.strictEqual(bestRoute?.legs.length, 1);
    });
    it('should return an empty result when no route is possible', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('nonexistentStop')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const bestRoute = result.bestRoute();
      assert.strictEqual(bestRoute, undefined);
    });

    it('should correctly calculate the arrival time to a stop', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop3')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const timeToStop3 = result.arrivalAt('stop3');
      assert.strictEqual(
        timeToStop3?.arrival.toMinutes(),
        Time.fromString('08:35:00').toMinutes(),
      );
    });
  });
  describe('with a route change', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      const stopsAdjacency: StopAdjacency[] = [
        { transfers: [], routes: [0] },
        { transfers: [], routes: [0, 1] },
        { transfers: [], routes: [0] },
        { transfers: [], routes: [1] },
        { transfers: [], routes: [1] },
      ];
      const routesAdjacency = [
        new Route(
          new Uint16Array([
            Time.fromString('08:00:00').toMinutes(),
            Time.fromString('08:15:00').toMinutes(),
            Time.fromString('08:30:00').toMinutes(),
            Time.fromString('08:45:00').toMinutes(),
            Time.fromString('09:00:00').toMinutes(),
            Time.fromString('09:10:00').toMinutes(),
          ]),
          new Uint8Array([
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
          ]),
          new Uint32Array([0, 1, 2]),
          0,
        ),
        new Route(
          new Uint16Array([
            Time.fromString('08:05:00').toMinutes(),
            Time.fromString('08:20:00').toMinutes(),
            Time.fromString('09:00:00').toMinutes(),
            Time.fromString('09:15:00').toMinutes(),
            Time.fromString('09:20:00').toMinutes(),
            Time.fromString('09:35:00').toMinutes(),
          ]),
          new Uint8Array([
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
          ]),
          new Uint32Array([3, 1, 4]),
          1,
        ),
      ];

      const routes: ServiceRoute[] = [
        {
          type: 'BUS',
          name: 'Line 1',
          routes: [0],
        },
        {
          type: 'RAIL',
          name: 'Line 2',
          routes: [1],
        },
      ];

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);

      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          lat: 1.0,
          lon: 1.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          lat: 2.0,
          lon: 2.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          lat: 3.0,
          lon: 3.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 3,
          sourceStopId: 'stop4',
          name: 'Stop 4',
          lat: 4.0,
          lon: 4.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 4,
          sourceStopId: 'stop5',
          name: 'Stop 5',
          lat: 5.0,
          lon: 5.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];

      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should find a route with a change', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop5')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const bestRoute = result.bestRoute();
      assert.strictEqual(bestRoute?.legs.length, 2);
    });

    it('should correctly calculate the arrival time to a stop', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop5')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const timeToStop5 = result.arrivalAt('stop5');
      assert.strictEqual(
        timeToStop5?.arrival.toMinutes(),
        Time.fromString('09:20:00').toMinutes(),
      );
    });
  });
  describe('with a transfer', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      const stopsAdjacency: StopAdjacency[] = [
        { transfers: [], routes: [0] },
        {
          transfers: [
            {
              destination: 4,
              type: 'REQUIRES_MINIMAL_TIME',
              minTransferTime: Duration.fromSeconds(300),
            },
          ],
          routes: [0],
        },
        { transfers: [], routes: [0] },
        { transfers: [], routes: [1] },
        { transfers: [], routes: [1] },
        { transfers: [], routes: [1] },
      ];

      const routesAdjacency = [
        new Route(
          new Uint16Array([
            Time.fromString('08:00:00').toMinutes(),
            Time.fromString('08:15:00').toMinutes(),
            Time.fromString('08:25:00').toMinutes(),
            Time.fromString('08:35:00').toMinutes(),
            Time.fromString('08:45:00').toMinutes(),
            Time.fromString('08:55:00').toMinutes(),
          ]),
          new Uint8Array([
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
          ]),
          new Uint32Array([0, 1, 2]),
          0,
        ),
        new Route(
          new Uint16Array([
            Time.fromString('08:10:00').toMinutes(),
            Time.fromString('08:20:00').toMinutes(),
            Time.fromString('08:40:00').toMinutes(),
            Time.fromString('08:50:00').toMinutes(),
            Time.fromString('09:00:00').toMinutes(),
            Time.fromString('09:10:00').toMinutes(),
          ]),
          new Uint8Array([
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
          ]),
          new Uint32Array([3, 4, 5]),
          1,
        ),
      ];

      const routes: ServiceRoute[] = [
        {
          type: 'BUS',
          name: 'Line 1',
          routes: [0],
        },
        {
          type: 'RAIL',
          name: 'Line 2',
          routes: [1],
        },
      ];

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);
      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          lat: 1.0,
          lon: 1.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          lat: 2.0,
          lon: 2.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          lat: 3.0,
          lon: 3.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 3,
          sourceStopId: 'stop4',
          name: 'Stop 4',
          lat: 4.0,
          lon: 4.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 4,
          sourceStopId: 'stop5',
          name: 'Stop 5',
          lat: 5.0,
          lon: 5.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 5,
          sourceStopId: 'stop6',
          name: 'Stop 6',
          lat: 6.0,
          lon: 6.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];
      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should find a route with a transfer', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop6')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const bestRoute = result.bestRoute();
      assert.strictEqual(bestRoute?.legs.length, 3);
    });

    it('should correctly calculate the time to a stop', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop6')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const timeToStop5 = result.arrivalAt('stop5');
      assert.strictEqual(
        timeToStop5?.arrival.toMinutes(),
        Time.fromString('08:30:00').toMinutes(),
      );
    });
  });
  describe('with a faster change', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      const stopsAdjacency: StopAdjacency[] = [
        { transfers: [], routes: [0, 2] },
        { transfers: [], routes: [0, 1] },
        { transfers: [], routes: [0] },
        { transfers: [], routes: [1] },
        { transfers: [], routes: [1, 2] },
      ];

      const routesAdjacency = [
        new Route(
          new Uint16Array([
            Time.fromString('08:00:00').toMinutes(),
            Time.fromString('08:15:00').toMinutes(),
            Time.fromString('08:30:00').toMinutes(),
            Time.fromString('08:45:00').toMinutes(),
            Time.fromString('09:00:00').toMinutes(),
            Time.fromString('09:15:00').toMinutes(),
          ]),
          new Uint8Array([
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
          ]),
          new Uint32Array([0, 1, 2]),
          0,
        ),
        new Route(
          new Uint16Array([
            Time.fromString('08:10:00').toMinutes(),
            Time.fromString('08:25:00').toMinutes(),
            Time.fromString('08:50:00').toMinutes(),
            Time.fromString('09:05:00').toMinutes(),
            Time.fromString('09:10:00').toMinutes(),
            Time.fromString('09:25:00').toMinutes(),
          ]),
          new Uint8Array([
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
            REGULAR,
          ]),
          new Uint32Array([3, 1, 4]),
          1,
        ),
        new Route(
          new Uint16Array([
            Time.fromString('08:00:00').toMinutes(),
            Time.fromString('08:15:00').toMinutes(),
            Time.fromString('09:45:00').toMinutes(),
            Time.fromString('10:00:00').toMinutes(),
          ]),
          new Uint8Array([REGULAR, REGULAR, REGULAR, REGULAR]),
          new Uint32Array([0, 4]),
          2,
        ),
      ];

      const routes: ServiceRoute[] = [
        {
          type: 'BUS',
          name: 'Line 1',
          routes: [0],
        },
        {
          type: 'RAIL',
          name: 'Line 2',
          routes: [1],
        },
        {
          type: 'FERRY',
          name: 'Line 3',
          routes: [2],
        },
      ];

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);
      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          lat: 1.0,
          lon: 1.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          lat: 2.0,
          lon: 2.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          lat: 3.0,
          lon: 3.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 3,
          sourceStopId: 'stop4',
          name: 'Stop 4',
          lat: 4.0,
          lon: 4.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 4,
          sourceStopId: 'stop5',
          name: 'Stop 5',
          lat: 5.0,
          lon: 5.0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];
      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should find a faster route with a change', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop5')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      const bestRoute = result.bestRoute();
      assert.strictEqual(bestRoute?.legs.length, 2);
    });
  });
});
