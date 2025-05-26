import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { StopsMap } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Duration } from '../../timetable/duration.js';
import { Time } from '../../timetable/time.js';
import {
  RoutesAdjacency,
  ServiceRoutesMap,
  StopsAdjacency,
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
      const stopsAdjacency: StopsAdjacency = new Map([
        [0, { transfers: [], routes: ['route1'] }],
        [1, { transfers: [], routes: ['route1'] }],
        [2, { transfers: [], routes: ['route1'] }],
      ]);

      const routesAdjacency: RoutesAdjacency = new Map([
        [
          'route1',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:00:00').toSeconds(),
              Time.fromString('08:10:00').toSeconds(),
              Time.fromString('08:15:00').toSeconds(),
              Time.fromString('08:25:00').toSeconds(),
              Time.fromString('08:35:00').toSeconds(),
              Time.fromString('08:45:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0,
              0, // REGULAR
              0,
              0, // REGULAR
              0,
              0, // REGULAR
            ]),
            stops: new Uint32Array([0, 1, 2]),
            stopIndices: new Map([
              [0, 0],
              [1, 1],
              [2, 2],
            ]),
            serviceRouteId: 'service_route1',
          },
        ],
      ]);

      const routes: ServiceRoutesMap = new Map([
        [
          'service_route1',
          {
            type: 'BUS',
            name: 'Line 1',
          },
        ],
      ]);

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);
      const stopsMap: StopsMap = new Map([
        [
          0,
          {
            id: 0,
            sourceStopId: 'stop1',
            name: 'Stop 1',
            lat: 1.0,
            lon: 1.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          1,
          {
            id: 1,
            sourceStopId: 'stop2',
            name: 'Stop 2',
            lat: 2.0,
            lon: 2.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          2,
          {
            id: 2,
            sourceStopId: 'stop3',
            name: 'Stop 3',
            lat: 3.0,
            lon: 3.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
      ]);
      const stopsIndex = new StopsIndex(stopsMap);
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
        timeToStop3?.time.toSeconds(),
        Time.fromString('08:35:00').toSeconds(),
      );
    });
  });
  describe('with a route change', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      const stopsAdjacency: StopsAdjacency = new Map([
        [0, { transfers: [], routes: ['route1'] }],
        [1, { transfers: [], routes: ['route1', 'route2'] }],
        [2, { transfers: [], routes: ['route1'] }],
        [3, { transfers: [], routes: ['route2'] }],
        [4, { transfers: [], routes: ['route2'] }],
      ]);
      const routesAdjacency: RoutesAdjacency = new Map([
        [
          'route1',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:00:00').toSeconds(),
              Time.fromString('08:15:00').toSeconds(),
              Time.fromString('08:30:00').toSeconds(),
              Time.fromString('08:45:00').toSeconds(),
              Time.fromString('09:00:00').toSeconds(),
              Time.fromString('09:10:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
            ]),
            stops: new Uint32Array([0, 1, 2]),
            stopIndices: new Map([
              [0, 0],
              [1, 1],
              [2, 2],
            ]),
            serviceRouteId: 'service_route1',
          },
        ],
        [
          'route2',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:05:00').toSeconds(),
              Time.fromString('08:20:00').toSeconds(),
              Time.fromString('09:00:00').toSeconds(),
              Time.fromString('09:15:00').toSeconds(),
              Time.fromString('09:20:00').toSeconds(),
              Time.fromString('09:35:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
            ]),
            stops: new Uint32Array([3, 1, 4]),
            stopIndices: new Map([
              [3, 0],
              [1, 1],
              [4, 2],
            ]),
            serviceRouteId: 'service_route2',
          },
        ],
      ]);

      const routes: ServiceRoutesMap = new Map([
        [
          'service_route1',
          {
            type: 'BUS',
            name: 'Line 1',
          },
        ],
        [
          'service_route2',
          {
            type: 'RAIL',
            name: 'Line 2',
          },
        ],
      ]);

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);

      const stopsMap: StopsMap = new Map([
        [
          0,
          {
            id: 0,
            sourceStopId: 'stop1',
            name: 'Stop 1',
            lat: 1.0,
            lon: 1.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          1,
          {
            id: 1,
            sourceStopId: 'stop2',
            name: 'Stop 2',
            lat: 2.0,
            lon: 2.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          2,
          {
            id: 2,
            sourceStopId: 'stop3',
            name: 'Stop 3',
            lat: 3.0,
            lon: 3.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          3,
          {
            id: 3,
            sourceStopId: 'stop4',
            name: 'Stop 4',
            lat: 4.0,
            lon: 4.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          4,
          {
            id: 4,
            sourceStopId: 'stop5',
            name: 'Stop 5',
            lat: 5.0,
            lon: 5.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
      ]);

      const stopsIndex = new StopsIndex(stopsMap);
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
        timeToStop5?.time.toSeconds(),
        Time.fromString('09:20:00').toSeconds(),
      );
    });
  });
  describe('with a transfer', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      const stopsAdjacency: StopsAdjacency = new Map([
        [0, { transfers: [], routes: ['route1'] }],
        [
          1,
          {
            transfers: [
              {
                destination: 4,
                type: 'REQUIRES_MINIMAL_TIME',
                minTransferTime: Duration.fromSeconds(300),
              },
            ],
            routes: ['route1'],
          },
        ],
        [2, { transfers: [], routes: ['route1'] }],
        [3, { transfers: [], routes: ['route2'] }],
        [4, { transfers: [], routes: ['route2'] }],
        [5, { transfers: [], routes: ['route2'] }],
      ]);

      const routesAdjacency: RoutesAdjacency = new Map([
        [
          'route1',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:00:00').toSeconds(),
              Time.fromString('08:15:00').toSeconds(),
              Time.fromString('08:25:00').toSeconds(),
              Time.fromString('08:35:00').toSeconds(),
              Time.fromString('08:45:00').toSeconds(),
              Time.fromString('08:55:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
            ]),
            stops: new Uint32Array([0, 1, 2]),
            stopIndices: new Map([
              [0, 0],
              [1, 1],
              [2, 2],
            ]),
            serviceRouteId: 'service_route1',
          },
        ],
        [
          'route2',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:10:00').toSeconds(),
              Time.fromString('08:20:00').toSeconds(),
              Time.fromString('08:40:00').toSeconds(),
              Time.fromString('08:50:00').toSeconds(),
              Time.fromString('09:00:00').toSeconds(),
              Time.fromString('09:10:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
            ]),
            stops: new Uint32Array([3, 4, 5]),
            stopIndices: new Map([
              [3, 0],
              [4, 1],
              [5, 2],
            ]),
            serviceRouteId: 'service_route2',
          },
        ],
      ]);

      const routes: ServiceRoutesMap = new Map([
        [
          'service_route1',
          {
            type: 'BUS',
            name: 'Line 1',
          },
        ],
        [
          'service_route2',
          {
            type: 'RAIL',
            name: 'Line 2',
          },
        ],
      ]);

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);
      const stopsMap: StopsMap = new Map([
        [
          0,
          {
            id: 0,
            sourceStopId: 'stop1',
            name: 'Stop 1',
            lat: 1.0,
            lon: 1.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          1,
          {
            id: 1,
            sourceStopId: 'stop2',
            name: 'Stop 2',
            lat: 2.0,
            lon: 2.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          2,
          {
            id: 2,
            sourceStopId: 'stop3',
            name: 'Stop 3',
            lat: 3.0,
            lon: 3.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          3,
          {
            id: 3,
            sourceStopId: 'stop4',
            name: 'Stop 4',
            lat: 4.0,
            lon: 4.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          4,
          {
            id: 4,
            sourceStopId: 'stop5',
            name: 'Stop 5',
            lat: 5.0,
            lon: 5.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          5,
          {
            id: 5,
            sourceStopId: 'stop6',
            name: 'Stop 6',
            lat: 6.0,
            lon: 6.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
      ]);
      const stopsIndex = new StopsIndex(stopsMap);
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
        timeToStop5?.time.toSeconds(),
        Time.fromString('08:30:00').toSeconds(),
      );
    });
  });
  describe('with a faster change', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      const stopsAdjacency: StopsAdjacency = new Map([
        [0, { transfers: [], routes: ['route1'] }],
        [1, { transfers: [], routes: ['route1', 'route2'] }],
        [2, { transfers: [], routes: ['route1'] }],
        [3, { transfers: [], routes: ['route2'] }],
        [4, { transfers: [], routes: ['route2'] }],
      ]);

      const routesAdjacency: RoutesAdjacency = new Map([
        [
          'route1',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:00:00').toSeconds(),
              Time.fromString('08:15:00').toSeconds(),
              Time.fromString('08:30:00').toSeconds(),
              Time.fromString('08:45:00').toSeconds(),
              Time.fromString('09:00:00').toSeconds(),
              Time.fromString('09:15:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
            ]),
            stops: new Uint32Array([0, 1, 2]),
            stopIndices: new Map([
              [0, 0],
              [1, 1],
              [2, 2],
            ]),
            serviceRouteId: 'service_route1',
          },
        ],
        [
          'route2',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:10:00').toSeconds(),
              Time.fromString('08:25:00').toSeconds(),
              Time.fromString('08:50:00').toSeconds(),
              Time.fromString('09:05:00').toSeconds(),
              Time.fromString('09:10:00').toSeconds(),
              Time.fromString('09:25:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
            ]),
            stops: new Uint32Array([3, 1, 4]),
            stopIndices: new Map([
              [3, 0],
              [1, 1],
              [4, 2],
            ]),
            serviceRouteId: 'service_route2',
          },
        ],
        [
          'route3',
          {
            stopTimes: new Uint32Array([
              Time.fromString('08:00:00').toSeconds(),
              Time.fromString('08:15:00').toSeconds(),
              Time.fromString('09:45:00').toSeconds(),
              Time.fromString('10:00:00').toSeconds(),
            ]),
            pickUpDropOffTypes: new Uint8Array([
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
              0, // REGULAR
            ]),
            stops: new Uint32Array([0, 4]),
            stopIndices: new Map([
              [0, 0],
              [4, 1],
            ]),
            serviceRouteId: 'service_route3',
          },
        ],
      ]);

      const routes: ServiceRoutesMap = new Map([
        [
          'service_route1',
          {
            type: 'BUS',
            name: 'Line 1',
          },
        ],
        [
          'service_route2',
          {
            type: 'RAIL',
            name: 'Line 2',
          },
        ],
        [
          'service_route3',
          {
            type: 'FERRY',
            name: 'Line 3',
          },
        ],
      ]);

      timetable = new Timetable(stopsAdjacency, routesAdjacency, routes);
      const stopsMap: StopsMap = new Map([
        [
          0,
          {
            id: 0,
            sourceStopId: 'stop1',
            name: 'Stop 1',
            lat: 1.0,
            lon: 1.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          1,
          {
            id: 1,
            sourceStopId: 'stop2',
            name: 'Stop 2',
            lat: 2.0,
            lon: 2.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          2,
          {
            id: 2,
            sourceStopId: 'stop3',
            name: 'Stop 3',
            lat: 3.0,
            lon: 3.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          3,
          {
            id: 3,
            sourceStopId: 'stop4',
            name: 'Stop 4',
            lat: 4.0,
            lon: 4.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
        [
          4,
          {
            id: 4,
            sourceStopId: 'stop5',
            name: 'Stop 5',
            lat: 5.0,
            lon: 5.0,
            children: [],
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
          },
        ],
      ]);
      const stopsIndex = new StopsIndex(stopsMap);
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
