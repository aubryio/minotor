import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Duration } from '../../timetable/duration.js';
import { Route } from '../../timetable/route.js';
import { Time } from '../../timetable/time.js';
import {
  ServiceRoute,
  StopAdjacency,
  Timetable,
  TripTransfers,
} from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopId.js';
import { Query } from '../query.js';
import { Result } from '../result.js';
import { Router } from '../router.js';

describe('Router', () => {
  describe('with a single route', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: A single route (Line 1) serving 3 stops in sequence
      // Route 0: stop1 (depart 08:10) -> stop2 (08:15-08:25) -> stop3 (arrive 08:35)
      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0] }, // stop 0 (stop1)
        { routes: [0] }, // stop 1 (stop2)
        { routes: [0] }, // stop 2 (stop3)
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1 -> 2
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:15:00'),
                  departureTime: Time.fromString('08:25:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:35:00'),
                  departureTime: Time.fromString('08:45:00'),
                },
              ],
            },
          ],
        }),
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

      // Should find a single-leg direct route on Line 1: stop1 -> stop3
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

      // No route exists to a non-existent stop
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

      // Route 0 arrives at stop3 at 08:35
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
      // Setup: Two routes that share stop2, enabling a same-stop transfer (route change)
      // Route 0 (Line 1): stop1 (depart 08:15) -> stop2 (08:30-08:45) -> stop3 (09:00)
      // Route 1 (Line 2): stop4 (depart 08:20) -> stop2 (09:00-09:15) -> stop5 (09:20)
      // Both routes serve stop2, allowing transfer without walking
      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0] }, // stop 0 (stop1)
        { routes: [0, 1] }, // stop 1 (stop2) - shared by both routes
        { routes: [0] }, // stop 2 (stop3)
        { routes: [1] }, // stop 3 (stop4)
        { routes: [1] }, // stop 4 (stop5)
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1 -> 2
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:15:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:30:00'),
                  departureTime: Time.fromString('08:45:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('09:00:00'),
                  departureTime: Time.fromString('09:10:00'),
                },
              ],
            },
          ],
        }),
        // Route 1: stops 3 -> 1 -> 4
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 3,
                  arrivalTime: Time.fromString('08:05:00'),
                  departureTime: Time.fromString('08:20:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('09:00:00'),
                  departureTime: Time.fromString('09:15:00'),
                },
                {
                  id: 4,
                  arrivalTime: Time.fromString('09:20:00'),
                  departureTime: Time.fromString('09:35:00'),
                },
              ],
            },
          ],
        }),
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

      // Should find a route with 2 legs:
      // 1. Line 1: stop1 -> stop2 (arrive 08:30)
      // 2. Line 2: stop2 -> stop5 (depart 09:15, arrive 09:20)
      // Transfer at stop2 with 30 minutes to spare (default minTransferTime is 2 min)
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

      // Line 2 arrives at stop5 at 09:20
      assert.strictEqual(
        timeToStop5?.arrival.toMinutes(),
        Time.fromString('09:20:00').toMinutes(),
      );
    });
  });

  describe('with a walking transfer', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: Two routes that don't share any stops, connected by a walking transfer
      // Route 0 (Line 1): stop1 (depart 08:15) -> stop2 (08:25-08:35) -> stop3 (08:45)
      // Route 1 (Line 2): stop4 (depart 08:20) -> stop5 (08:40-08:50) -> stop6 (09:10)
      // Walking transfer from stop2 to stop5 with 5 minute minTransferTime
      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0] }, // stop 0 (stop1)
        {
          transfers: [
            {
              destination: 4,
              type: 'REQUIRES_MINIMAL_TIME',
              minTransferTime: Duration.fromSeconds(300), // 5 minutes walking
            },
          ],
          routes: [0],
        }, // stop 1 (stop2) - has walking transfer to stop5
        { routes: [0] }, // stop 2 (stop3)
        { routes: [1] }, // stop 3 (stop4)
        { routes: [1] }, // stop 4 (stop5)
        { routes: [1] }, // stop 5 (stop6)
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1 -> 2
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:15:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:25:00'),
                  departureTime: Time.fromString('08:35:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:45:00'),
                  departureTime: Time.fromString('08:55:00'),
                },
              ],
            },
          ],
        }),
        // Route 1: stops 3 -> 4 -> 5
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 3,
                  arrivalTime: Time.fromString('08:10:00'),
                  departureTime: Time.fromString('08:20:00'),
                },
                {
                  id: 4,
                  arrivalTime: Time.fromString('08:40:00'),
                  departureTime: Time.fromString('08:50:00'),
                },
                {
                  id: 5,
                  arrivalTime: Time.fromString('09:10:00'),
                  departureTime: Time.fromString('09:10:00'),
                },
              ],
            },
          ],
        }),
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

    it('should find a route with a walking transfer', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop6')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // Should find a route with 3 legs:
      // 1. Line 1: stop1 -> stop2 (arrive 08:25)
      // 2. Walking transfer: stop2 -> stop5 (5 min walk, arrive 08:30)
      // 3. Line 2: stop5 -> stop6 (depart 08:50, arrive 09:10)
      assert.strictEqual(bestRoute?.legs.length, 3);
    });

    it('should correctly calculate the arrival time at intermediate stop', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop6')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);
      const timeToStop5 = result.arrivalAt('stop5');

      // Arrive at stop2 at 08:25, walk 5 min to stop5, arrive at 08:30
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
      // Setup: Three routes where Route 2 is direct but slower than Route 0 + Route 1 with a change
      // Route 0 (Line 1): stop1 (08:15) -> stop2 (08:30-08:45) -> stop3 (09:00)
      // Route 1 (Line 2): stop4 (08:25) -> stop2 (08:50-09:05) -> stop5 (09:10)
      // Route 2 (Line 3): stop1 (08:15) -> stop5 (09:45) - direct but slower
      // The router should prefer Route 0 + Route 1 (arrive 09:10) over Route 2 (arrive 09:45)
      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0, 2] }, // stop 0 (stop1) - served by Line 1 and Line 3
        { routes: [0, 1] }, // stop 1 (stop2) - transfer point
        { routes: [0] }, // stop 2 (stop3)
        { routes: [1] }, // stop 3 (stop4)
        { routes: [1, 2] }, // stop 4 (stop5) - destination
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1 -> 2
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:15:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:30:00'),
                  departureTime: Time.fromString('08:45:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('09:00:00'),
                  departureTime: Time.fromString('09:15:00'),
                },
              ],
            },
          ],
        }),
        // Route 1: stops 3 -> 1 -> 4
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 3,
                  arrivalTime: Time.fromString('08:10:00'),
                  departureTime: Time.fromString('08:25:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:50:00'),
                  departureTime: Time.fromString('09:05:00'),
                },
                {
                  id: 4,
                  arrivalTime: Time.fromString('09:10:00'),
                  departureTime: Time.fromString('09:25:00'),
                },
              ],
            },
          ],
        }),
        // Route 2: stops 0 -> 4 (direct but slow)
        Route.of({
          id: 2,
          serviceRouteId: 2,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:15:00'),
                },
                {
                  id: 4,
                  arrivalTime: Time.fromString('09:45:00'),
                  departureTime: Time.fromString('10:00:00'),
                },
              ],
            },
          ],
        }),
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

    it('should prefer a faster route with a change over a slower direct route', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop5')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // Should prefer the 2-leg route (Line 1 + Line 2, arrive 09:10)
      // over the 1-leg direct route (Line 3, arrive 09:45)
      assert.strictEqual(bestRoute?.legs.length, 2);
    });
  });

  describe('with route continuation (in-seat transfer)', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: Route 0 continues as Route 1 at stop2 (same vehicle, different route number)
      // This is an "in-seat transfer" where passengers can stay on the vehicle
      // Route 0 (Line 1): stop1 (depart 08:10) -> stop2 (08:15-08:25)
      // Route 1 (Line 2): stop2 (08:15-08:25) -> stop3 (08:35) -> stop4 (08:55)
      // Trip continuation: Route 0 trip 0 at stop2 continues as Route 1 trip 0
      // encode(1, 0, 0) = stop index 1 on route 0, trip 0 (where the continuation starts)
      const tripContinuations: TripTransfers = new Map([
        [encode(1, 0, 0), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]],
      ]);

      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0] }, // stop 0 (stop1)
        { routes: [0, 1] }, // stop 1 (stop2) - continuation point
        { routes: [1] }, // stop 2 (stop3)
        { routes: [1] }, // stop 3 (stop4)
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:15:00'),
                  departureTime: Time.fromString('08:25:00'),
                },
              ],
            },
          ],
        }),
        // Route 1: stops 1 -> 2 -> 3 (continuation from route 0)
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:15:00'),
                  departureTime: Time.fromString('08:25:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:35:00'),
                  departureTime: Time.fromString('08:45:00'),
                },
                {
                  id: 3,
                  arrivalTime: Time.fromString('08:55:00'),
                  departureTime: Time.fromString('09:05:00'),
                },
              ],
            },
          ],
        }),
      ];

      const routes: ServiceRoute[] = [
        {
          type: 'BUS',
          name: 'Line 1',
          routes: [0],
        },
        {
          type: 'BUS',
          name: 'Line 2',
          routes: [1],
        },
      ];

      timetable = new Timetable(
        stopsAdjacency,
        routesAdjacency,
        routes,
        tripContinuations,
      );

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
      ];

      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should find a route using continuation (in-seat transfer)', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop4')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // Should find a route with only 1 leg because the continuation allows
      // staying on the same vehicle when it changes route numbers
      assert.strictEqual(bestRoute?.legs.length, 1);
    });

    it('should correctly calculate arrival time with continuation', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop4')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);
      const timeToStop4 = result.arrivalAt('stop4');

      // Route 1 (continuation of Route 0) arrives at stop4 at 08:55
      assert.strictEqual(
        timeToStop4?.arrival.toMinutes(),
        Time.fromString('08:55:00').toMinutes(),
      );
    });
  });

  describe('with guaranteed trip transfers', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: Route 0 trip 0 has a guaranteed transfer to Route 1 trip 0 at stop2
      // The transfer time is only 1 minute (60 seconds), less than the 5-minute minTransferTime
      // But since it's guaranteed, it should still be considered
      // Route 0: stop1 (depart 08:10) -> stop2 (arrive 08:20)
      // Route 1: stop2 (depart 08:21) -> stop3 (arrive 08:40)
      // encode(1, 0, 0) = stop index 1 on route 0, trip 0 (where we alight)
      // destination { stopIndex: 0, routeId: 1, tripIndex: 0 } = stop index 0 on route 1, trip 0 (where we board)
      const guaranteedTripTransfers: TripTransfers = new Map([
        [encode(1, 0, 0), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]],
      ]);

      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0] }, // stop 0 (stop1)
        { routes: [0, 1] }, // stop 1 (stop2) - both routes serve this stop
        { routes: [1] }, // stop 2 (stop3)
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:20:00'),
                  departureTime: Time.fromString('08:30:00'),
                },
              ],
            },
          ],
        }),
        // Route 1: stops 1 -> 2
        // Departure at 08:21, only 1 minute after arrival from route 0
        // Without the guaranteed transfer, this would be missed with a 5-minute minTransferTime
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:15:00'),
                  departureTime: Time.fromString('08:21:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:40:00'),
                  departureTime: Time.fromString('08:50:00'),
                },
              ],
            },
          ],
        }),
      ];

      const routes: ServiceRoute[] = [
        {
          type: 'BUS',
          name: 'Line 1',
          routes: [0],
        },
        {
          type: 'BUS',
          name: 'Line 2',
          routes: [1],
        },
      ];

      timetable = new Timetable(
        stopsAdjacency,
        routesAdjacency,
        routes,
        undefined, // no trip continuations
        guaranteedTripTransfers,
      );

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

    it('should consider guaranteed transfer even with less time than minTransferTime', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop3')
        .departureTime(Time.fromString('08:00:00'))
        .minTransferTime(Duration.fromSeconds(300)) // 5 minutes, but transfer only has 1 minute
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // Should find a route with 3 legs:
      // 1. Vehicle leg (route 0)
      // 2. Guaranteed transfer leg (shown as type: 'GUARANTEED')
      // 3. Vehicle leg (route 1)
      assert.ok(bestRoute);
      assert.strictEqual(bestRoute.legs.length, 3);

      // The middle leg should be the guaranteed transfer
      const transferLeg = bestRoute.legs[1];
      assert.ok(transferLeg && 'type' in transferLeg);
      assert.strictEqual(transferLeg.type, 'GUARANTEED');

      // Should arrive at 08:40 because the guaranteed transfer allows catching
      // the 08:21 departure despite only having 1 minute of transfer time
      assert.strictEqual(
        result.arrivalAt('stop3')?.arrival.toMinutes(),
        Time.fromString('08:40:00').toMinutes(),
      );
    });
  });

  describe('with non-guaranteed transfers and minTransferTime', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: Same-stop transfer (route change) without guaranteed transfer
      // Both routes serve stop2, so this is a route change at the same stop
      // The query's minTransferTime should be respected
      // Route 0: stop1 (depart 08:10) -> stop2 (arrive 08:20)
      // Route 1 trip 0: stop2 (depart 08:21) -> stop3 (arrive 08:35) - NOT catchable with 5 min minTransferTime
      // Route 1 trip 1: stop2 (depart 08:26) -> stop3 (arrive 08:45) - catchable with 5 min minTransferTime
      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0] }, // stop 0 (stop1)
        { routes: [0, 1] }, // stop 1 (stop2) - both routes serve this stop
        { routes: [1] }, // stop 2 (stop3)
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:20:00'),
                  departureTime: Time.fromString('08:30:00'),
                },
              ],
            },
          ],
        }),
        // Route 1: stops 1 -> 2
        // Trip 0: Departure at 08:21, only 1 minute after arrival - should NOT be catchable with 5 min minTransferTime
        // Trip 1: Departure at 08:26, 6 minutes after arrival - should be catchable with 5 min minTransferTime
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:15:00'),
                  departureTime: Time.fromString('08:21:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:35:00'),
                  departureTime: Time.fromString('08:45:00'),
                },
              ],
            },
            {
              stops: [
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:20:00'),
                  departureTime: Time.fromString('08:26:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:45:00'),
                  departureTime: Time.fromString('08:55:00'),
                },
              ],
            },
          ],
        }),
      ];

      const routes: ServiceRoute[] = [
        {
          type: 'BUS',
          name: 'Line 1',
          routes: [0],
        },
        {
          type: 'BUS',
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
      ];

      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should not consider transfer with less time than minTransferTime', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop3')
        .departureTime(Time.fromString('08:00:00'))
        .minTransferTime(Duration.fromSeconds(300)) // 5 minutes required for transfer
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // Should find a route with 2 legs (same-stop transfer, no walking):
      // 1. Vehicle leg on route 0 (stop1 -> stop2)
      // 2. Vehicle leg on route 1 (stop2 -> stop3)
      assert.strictEqual(bestRoute?.legs.length, 2);

      // Arrival at stop2 is 08:20, with 5 min minTransferTime we need departure >= 08:25
      // Trip 0 of route 1 departs at 08:21 - NOT catchable (only 1 minute transfer time)
      // Trip 1 of route 1 departs at 08:26 - catchable (6 minutes transfer time)
      // So we should arrive at stop3 at 08:45 (trip 1 arrival), not 08:35 (trip 0 arrival)
      assert.strictEqual(
        result.arrivalAt('stop3')?.arrival.toMinutes(),
        Time.fromString('08:45:00').toMinutes(),
      );
    });
  });

  describe('with maxTransfers constraint', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: Three routes where reaching stop4 requires 2 transfers
      // Route 0: stop1 -> stop2
      // Route 1: stop2 -> stop3
      // Route 2: stop3 -> stop4
      // With maxTransfers=1, stop4 should not be reachable
      // With maxTransfers=2, stop4 should be reachable
      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0] }, // stop 0 (stop1)
        { routes: [0, 1] }, // stop 1 (stop2)
        { routes: [1, 2] }, // stop 2 (stop3)
        { routes: [2] }, // stop 3 (stop4)
      ];

      const routesAdjacency = [
        // Route 0: stops 0 -> 1
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:20:00'),
                  departureTime: Time.fromString('08:30:00'),
                },
              ],
            },
          ],
        }),
        // Route 1: stops 1 -> 2
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:25:00'),
                  departureTime: Time.fromString('08:35:00'),
                },
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:45:00'),
                  departureTime: Time.fromString('08:55:00'),
                },
              ],
            },
          ],
        }),
        // Route 2: stops 2 -> 3
        Route.of({
          id: 2,
          serviceRouteId: 2,
          trips: [
            {
              stops: [
                {
                  id: 2,
                  arrivalTime: Time.fromString('08:50:00'),
                  departureTime: Time.fromString('09:00:00'),
                },
                {
                  id: 3,
                  arrivalTime: Time.fromString('09:10:00'),
                  departureTime: Time.fromString('09:20:00'),
                },
              ],
            },
          ],
        }),
      ];

      const routes: ServiceRoute[] = [
        { type: 'BUS', name: 'Line 1', routes: [0] },
        { type: 'BUS', name: 'Line 2', routes: [1] },
        { type: 'BUS', name: 'Line 3', routes: [2] },
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
      ];

      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should not find route when maxTransfers is too low', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop4')
        .departureTime(Time.fromString('08:00:00'))
        .maxTransfers(1) // Only allows 1 transfer, but we need 2
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // Should not find a route because reaching stop4 requires 2 transfers
      assert.strictEqual(bestRoute, undefined);
    });

    it('should find route when maxTransfers is sufficient', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop4')
        .departureTime(Time.fromString('08:00:00'))
        .maxTransfers(2) // Allows 2 transfers, which is exactly what we need
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // Should find a route with 3 legs (2 transfers)
      assert.strictEqual(bestRoute?.legs.length, 3);
    });

    it('should find intermediate stops even with low maxTransfers', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop4')
        .departureTime(Time.fromString('08:00:00'))
        .maxTransfers(1)
        .build();

      const result: Result = router.route(query);

      // stop3 should still be reachable with 1 transfer (stop1 -> stop2 -> stop3)
      const arrivalAtStop3 = result.arrivalAt('stop3');
      assert.ok(arrivalAtStop3);
      assert.strictEqual(
        arrivalAtStop3.arrival.toMinutes(),
        Time.fromString('08:45:00').toMinutes(),
      );
    });
  });

  describe('with transport mode filtering', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: Two routes to the same destination with different transport modes
      // Route 0 (BUS): stop1 -> stop2, arrives 08:30
      // Route 1 (RAIL): stop1 -> stop2, arrives 08:20 (faster)
      // When filtering to BUS only, should use the slower bus route
      const stopsAdjacency: StopAdjacency[] = [
        { routes: [0, 1] }, // stop 0 (stop1) - served by both routes
        { routes: [0, 1] }, // stop 1 (stop2) - served by both routes
      ];

      const routesAdjacency = [
        // Route 0 (BUS): stops 0 -> 1, slower
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:30:00'),
                  departureTime: Time.fromString('08:40:00'),
                },
              ],
            },
          ],
        }),
        // Route 1 (RAIL): stops 0 -> 1, faster
        Route.of({
          id: 1,
          serviceRouteId: 1,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:20:00'),
                  departureTime: Time.fromString('08:30:00'),
                },
              ],
            },
          ],
        }),
      ];

      const routes: ServiceRoute[] = [
        { type: 'BUS', name: 'Bus Line', routes: [0] },
        { type: 'RAIL', name: 'Rail Line', routes: [1] },
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
      ];

      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should use fastest route when all modes allowed', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop2')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      // Should use the faster RAIL route, arriving at 08:20
      assert.strictEqual(
        result.arrivalAt('stop2')?.arrival.toMinutes(),
        Time.fromString('08:20:00').toMinutes(),
      );
    });

    it('should only use allowed transport modes', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop2')
        .departureTime(Time.fromString('08:00:00'))
        .transportModes(new Set(['BUS'] as const))
        .build();

      const result: Result = router.route(query);

      // Should use the slower BUS route since RAIL is excluded, arriving at 08:30
      assert.strictEqual(
        result.arrivalAt('stop2')?.arrival.toMinutes(),
        Time.fromString('08:30:00').toMinutes(),
      );
    });

    it('should return no route when no matching transport mode', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop2')
        .departureTime(Time.fromString('08:00:00'))
        .transportModes(new Set(['FERRY'] as const)) // Neither route is a ferry
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // No route should be found since neither BUS nor RAIL is allowed
      assert.strictEqual(bestRoute, undefined);
    });
  });

  describe('with timing edge cases', () => {
    let router: Router;
    let timetable: Timetable;

    beforeEach(() => {
      // Setup: A single route with multiple trips at different times
      // Trip 0: departs 08:10, arrives 08:30
      // Trip 1: departs 09:10, arrives 09:30
      const stopsAdjacency: StopAdjacency[] = [
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
                  id: 0,
                  arrivalTime: Time.fromString('08:00:00'),
                  departureTime: Time.fromString('08:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('08:30:00'),
                  departureTime: Time.fromString('08:40:00'),
                },
              ],
            },
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: Time.fromString('09:00:00'),
                  departureTime: Time.fromString('09:10:00'),
                },
                {
                  id: 1,
                  arrivalTime: Time.fromString('09:30:00'),
                  departureTime: Time.fromString('09:40:00'),
                },
              ],
            },
          ],
        }),
      ];

      const routes: ServiceRoute[] = [
        { type: 'BUS', name: 'Line 1', routes: [0] },
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
      ];

      const stopsIndex = new StopsIndex(stops);
      router = new Router(timetable, stopsIndex);
    });

    it('should find first available trip after departure time', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop2')
        .departureTime(Time.fromString('08:00:00'))
        .build();

      const result: Result = router.route(query);

      // Should catch the first trip (08:10), arriving at 08:30
      assert.strictEqual(
        result.arrivalAt('stop2')?.arrival.toMinutes(),
        Time.fromString('08:30:00').toMinutes(),
      );
    });

    it('should skip trips that have already departed', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop2')
        .departureTime(Time.fromString('08:15:00')) // After first trip departs
        .build();

      const result: Result = router.route(query);

      // Should catch the second trip (09:10), arriving at 09:30
      assert.strictEqual(
        result.arrivalAt('stop2')?.arrival.toMinutes(),
        Time.fromString('09:30:00').toMinutes(),
      );
    });

    it('should return no route when departing after all trips', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop2')
        .departureTime(Time.fromString('10:00:00')) // After all trips have departed
        .build();

      const result: Result = router.route(query);
      const bestRoute = result.bestRoute();

      // No route should be found since all trips have departed
      assert.strictEqual(bestRoute, undefined);
    });

    it('should catch trip when departure time exactly matches', () => {
      const query = new Query.Builder()
        .from('stop1')
        .to('stop2')
        .departureTime(Time.fromString('08:10:00')) // Exactly when first trip departs
        .build();

      const result: Result = router.route(query);

      // Should still catch the first trip
      assert.strictEqual(
        result.arrivalAt('stop2')?.arrival.toMinutes(),
        Time.fromString('08:30:00').toMinutes(),
      );
    });
  });
});
