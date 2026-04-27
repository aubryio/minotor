import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { durationFromSeconds, timeFromHM } from '../../timetable/time.js';
import {
  ServiceRoute,
  StopAdjacency,
  Timetable,
} from '../../timetable/timetable.js';
import { AccessFinder } from '../access.js';
import { RangeQuery } from '../query.js';
import { RangeRouter } from '../rangeRouter.js';
import { Raptor } from '../raptor.js';

describe('RangeRouter', () => {
  describe('with initial walking access', () => {
    let router: RangeRouter;

    beforeEach(() => {
      const stopsAdjacency: StopAdjacency[] = [
        {
          routes: [],
          transfers: [{ destination: 1, type: 'REQUIRES_MINIMAL_TIME' }],
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
                  arrivalTime: timeFromHM(8, 5),
                  departureTime: timeFromHM(8, 5),
                },
                {
                  id: 2,
                  arrivalTime: timeFromHM(8, 20),
                  departureTime: timeFromHM(8, 20),
                },
              ],
            },
          ],
        }),
      ];

      const serviceRoutes: ServiceRoute[] = [
        { type: 'BUS', name: 'Line 1', routes: [0] },
      ];

      const timetable = new Timetable(
        stopsAdjacency,
        routesAdjacency,
        serviceRoutes,
      );

      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'origin',
          name: 'Origin',
          lat: 0,
          lon: 0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'boarding',
          name: 'Boarding',
          lat: 1,
          lon: 1,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 2,
          sourceStopId: 'destination',
          name: 'Destination',
          lat: 2,
          lon: 2,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];

      const stopsIndex = new StopsIndex(stops);
      const accessFinder = new AccessFinder(timetable, stopsIndex);
      const raptor = new Raptor(timetable);
      router = new RangeRouter(timetable, stopsIndex, accessFinder, raptor);
    });

    it('should reconstruct the initial access leg with the fallback transfer time', () => {
      const query = new RangeQuery.Builder()
        .from(0)
        .to(2)
        .departureTime(timeFromHM(8, 0))
        .lastDepartureTime(timeFromHM(8, 0))
        .minTransferTime(durationFromSeconds(300))
        .build();

      const result = router.rangeRoute(query);
      const route = result.bestRoute();

      assert(route);
      assert.strictEqual(route.legs.length, 2);
      assert.strictEqual(route.departureTime(), timeFromHM(8, 0));
      assert.strictEqual(route.arrivalTime(), timeFromHM(8, 20));
      const firstLeg = route.legs[0];
      assert(firstLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 1);
    });
  });

  describe('with multiple Pareto-optimal runs', () => {
    // Base timetable: two-stop network, one route with two trips.
    //   trip 0: stop 0 departs 08:00, stop 1 arrives 08:30
    //   trip 1: stop 0 departs 08:30, stop 1 arrives 09:00
    // Neither trip dominates the other (trip 1 departs later but arrives later).
    let timetable: Timetable;
    let router: RangeRouter;

    beforeEach(() => {
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
                  arrivalTime: timeFromHM(8, 0),
                  departureTime: timeFromHM(8, 0),
                },
                {
                  id: 1,
                  arrivalTime: timeFromHM(8, 30),
                  departureTime: timeFromHM(8, 30),
                },
              ],
            },
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: timeFromHM(8, 30),
                  departureTime: timeFromHM(8, 30),
                },
                {
                  id: 1,
                  arrivalTime: timeFromHM(9, 0),
                  departureTime: timeFromHM(9, 0),
                },
              ],
            },
          ],
        }),
      ];

      const serviceRoutes: ServiceRoute[] = [
        { type: 'BUS', name: 'Line 1', routes: [0] },
      ];

      timetable = new Timetable(stopsAdjacency, routesAdjacency, serviceRoutes);

      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'origin',
          name: 'Origin',
          lat: 0,
          lon: 0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'dest',
          name: 'Destination',
          lat: 0,
          lon: 0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];

      const stopsIndex = new StopsIndex(stops);
      const accessFinder = new AccessFinder(timetable, stopsIndex);
      const raptor = new Raptor(timetable);
      router = new RangeRouter(timetable, stopsIndex, accessFinder, raptor);
    });

    it('returns one run per non-dominated departure', () => {
      const query = new RangeQuery.Builder()
        .from(0)
        .to(1)
        .departureTime(timeFromHM(8, 0))
        .lastDepartureTime(timeFromHM(8, 30))
        .build();

      const result = router.rangeRoute(query);

      // Both trips are Pareto-optimal.
      assert.strictEqual(result.size, 2);

      // The latest departure route leaves at 08:30.
      const latest = result.latestDepartureRoute();
      assert(latest);
      assert.strictEqual(latest.departureTime(), timeFromHM(8, 30));
      assert.strictEqual(latest.arrivalTime(), timeFromHM(9, 0));

      // The best route (earliest arrival) leaves at 08:00.
      const best = result.bestRoute();
      assert(best);
      assert.strictEqual(best.arrivalTime(), timeFromHM(8, 30));
      assert.strictEqual(best.departureTime(), timeFromHM(8, 0));
    });

    it('excludes a departure dominated by a later trip', () => {
      // Rebuild with a timetable where:
      //   trip 0: departs 08:00 → arrives 09:00 (slower)
      //   trip 1: departs 08:30 → arrives 08:50 (faster; dominates trip 0)
      const dominatingAdj: StopAdjacency[] = [{ routes: [0] }, { routes: [0] }];

      const dominatingRoutes = [
        Route.of({
          id: 0,
          serviceRouteId: 0,
          trips: [
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: timeFromHM(8, 0),
                  departureTime: timeFromHM(8, 0),
                },
                {
                  id: 1,
                  arrivalTime: timeFromHM(9, 0),
                  departureTime: timeFromHM(9, 0),
                },
              ],
            },
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: timeFromHM(8, 30),
                  departureTime: timeFromHM(8, 30),
                },
                {
                  id: 1,
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

      const dominatingTimetable = new Timetable(
        dominatingAdj,
        dominatingRoutes,
        serviceRoutes,
      );

      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'origin',
          name: 'Origin',
          lat: 0,
          lon: 0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'dest',
          name: 'Destination',
          lat: 0,
          lon: 0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];

      const stopsIndex = new StopsIndex(stops);
      const accessFinder = new AccessFinder(dominatingTimetable, stopsIndex);
      const raptor = new Raptor(dominatingTimetable);
      const dominatingRouter = new RangeRouter(
        dominatingTimetable,
        stopsIndex,
        accessFinder,
        raptor,
      );

      const query = new RangeQuery.Builder()
        .from(0)
        .to(1)
        .departureTime(timeFromHM(8, 0))
        .lastDepartureTime(timeFromHM(8, 30))
        .build();

      const result = dominatingRouter.rangeRoute(query);

      // Only trip 1 (08:30 → 08:50) is Pareto-optimal; trip 0 (08:00 → 09:00)
      // is dominated because it departs earlier yet arrives later.
      assert.strictEqual(result.size, 1);
      const route = result.bestRoute();
      assert(route);
      assert.strictEqual(route.departureTime(), timeFromHM(8, 30));
      assert.strictEqual(route.arrivalTime(), timeFromHM(8, 50));
    });

    it('returns empty result when no trip falls in the window', () => {
      const query = new RangeQuery.Builder()
        .from(0)
        .to(1)
        .departureTime(timeFromHM(10, 0))
        .lastDepartureTime(timeFromHM(11, 0))
        .build();

      const result = router.rangeRoute(query);

      assert.strictEqual(result.size, 0);
      assert.strictEqual(result.bestRoute(), undefined);
    });
  });

  describe('same-stop query (origin equals destination)', () => {
    // Network: two stops, one route with two trips both departing from stop 0.
    // The query goes from stop 0 to stop 0, so the destination is trivially
    // reachable in round 0 with zero duration for every departure slot.
    // Without the trivial-destination guard, every slot would be stored as a
    // Pareto-optimal run (O(trips) runs). With the fix, only one run is kept.
    let router: RangeRouter;

    beforeEach(() => {
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
                  arrivalTime: timeFromHM(8, 0),
                  departureTime: timeFromHM(8, 0),
                },
                {
                  id: 1,
                  arrivalTime: timeFromHM(8, 30),
                  departureTime: timeFromHM(8, 30),
                },
              ],
            },
            {
              stops: [
                {
                  id: 0,
                  arrivalTime: timeFromHM(8, 30),
                  departureTime: timeFromHM(8, 30),
                },
                {
                  id: 1,
                  arrivalTime: timeFromHM(9, 0),
                  departureTime: timeFromHM(9, 0),
                },
              ],
            },
          ],
        }),
      ];

      const serviceRoutes: ServiceRoute[] = [
        { type: 'BUS', name: 'Line 1', routes: [0] },
      ];

      const timetable = new Timetable(
        stopsAdjacency,
        routesAdjacency,
        serviceRoutes,
      );

      const stops: Stop[] = [
        {
          id: 0,
          sourceStopId: 'stop',
          name: 'Stop',
          lat: 0,
          lon: 0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
        {
          id: 1,
          sourceStopId: 'other',
          name: 'Other',
          lat: 0,
          lon: 0,
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ];

      const stopsIndex = new StopsIndex(stops);
      const accessFinder = new AccessFinder(timetable, stopsIndex);
      const raptor = new Raptor(timetable);
      router = new RangeRouter(timetable, stopsIndex, accessFinder, raptor);
    });

    it('produces exactly one Pareto run even when multiple departure slots fall in the window', () => {
      // The window covers both trips departing from stop 0 (08:00 and 08:30),
      // so collectDepartureTimes generates two slots. Without the guard each
      // would be stored as Pareto-optimal (arrival = depTime for same-stop).
      const query = new RangeQuery.Builder()
        .from(0)
        .to(0)
        .departureTime(timeFromHM(8, 0))
        .lastDepartureTime(timeFromHM(8, 30))
        .build();

      const result = router.rangeRoute(query);

      assert.strictEqual(result.size, 1);
    });

    it('stores the latest-departing trivial run', () => {
      const query = new RangeQuery.Builder()
        .from(0)
        .to(0)
        .departureTime(timeFromHM(8, 0))
        .lastDepartureTime(timeFromHM(8, 30))
        .build();

      const result = router.rangeRoute(query);

      // ParetoRun.departureTime is the origin departure; the reconstructed
      // Route has no vehicle legs so route.departureTime() is not available.
      const [run] = result;
      assert(run);
      assert.strictEqual(run.departureTime, timeFromHM(8, 30));
    });
  });
});
