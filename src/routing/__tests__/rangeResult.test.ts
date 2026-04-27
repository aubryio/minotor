import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Timetable } from '../../router.js';
import { Stop, StopId } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHM } from '../../timetable/time.js';
import { ServiceRoute, StopAdjacency } from '../../timetable/timetable.js';
import { ParetoRun, RangeResult } from '../rangeResult.js';
import { Result } from '../result.js';
import { RoutingState, VehicleEdge } from '../router.js';

// Two-stop timetable with two trips on a single route:
//   trip 0: stop 0 departs 09:00, stop 1 arrives 09:30
//   trip 1: stop 0 departs 08:30, stop 1 arrives 09:10
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
];
const stopsIndex = new StopsIndex(stops);

const stopsAdjacency: StopAdjacency[] = [{ routes: [0] }, { routes: [0] }];
const routesAdjacency = [
  Route.of({
    id: 0,
    serviceRouteId: 0,
    trips: [
      {
        stops: [
          {
            id: 0,
            arrivalTime: timeFromHM(9, 0),
            departureTime: timeFromHM(9, 0),
          },
          {
            id: 1,
            arrivalTime: timeFromHM(9, 30),
            departureTime: timeFromHM(9, 30),
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
            arrivalTime: timeFromHM(9, 10),
            departureTime: timeFromHM(9, 10),
          },
        ],
      },
    ],
  }),
];
const serviceRoutes: ServiceRoute[] = [
  { type: 'BUS', name: 'Line 1', routes: [0] },
];
const timetable = new Timetable(stopsAdjacency, routesAdjacency, serviceRoutes);

const DEST = 1;
const DESTINATIONS = new Set([DEST]);

// Run A — later departure (09:00→09:30, 30-minute duration)
const edgeA: VehicleEdge = {
  arrival: timeFromHM(9, 30),
  stopIndex: 0,
  hopOffStopIndex: 1,
  routeId: 0,
  tripIndex: 0,
};
const runA: ParetoRun = {
  departureTime: timeFromHM(9, 0),
  result: new Result(
    DESTINATIONS,
    RoutingState.fromTestData({
      nbStops: 2,
      origins: [0],
      destinations: [DEST],
      arrivals: [
        [0, timeFromHM(9, 0), 0],
        [DEST, timeFromHM(9, 30), 1],
      ],
      graph: [[[0, { stopId: 0, arrival: timeFromHM(9, 0) }]], [[DEST, edgeA]]],
    }),
    stopsIndex,
    timetable,
  ),
};

// Run B — earlier departure (08:30→09:10, 40-minute duration)
const edgeB: VehicleEdge = {
  arrival: timeFromHM(9, 10),
  stopIndex: 0,
  hopOffStopIndex: 1,
  routeId: 0,
  tripIndex: 1,
};
const runB: ParetoRun = {
  departureTime: timeFromHM(8, 30),
  result: new Result(
    DESTINATIONS,
    RoutingState.fromTestData({
      nbStops: 2,
      origins: [0],
      destinations: [DEST],
      arrivals: [
        [0, timeFromHM(8, 30), 0],
        [DEST, timeFromHM(9, 10), 1],
      ],
      graph: [
        [[0, { stopId: 0, arrival: timeFromHM(8, 30) }]],
        [[DEST, edgeB]],
      ],
    }),
    stopsIndex,
    timetable,
  ),
};

// Runs are stored latest-departure-first: [runA, runB]
const rangeResult = new RangeResult([runA, runB], DESTINATIONS);

describe('RangeResult', () => {
  describe('size and destinations', () => {
    it('size reflects the number of Pareto runs', () => {
      assert.strictEqual(rangeResult.size, 2);
    });

    it('destinations returns the resolved destination stop set', () => {
      assert.deepStrictEqual(rangeResult.destinations, DESTINATIONS);
    });
  });

  describe('[Symbol.iterator]', () => {
    it('iterates runs in latest-departure-first order', () => {
      const runs = [...rangeResult];
      assert.strictEqual(runs.length, 2);
      assert.strictEqual(runs[0]?.departureTime, timeFromHM(9, 0));
      assert.strictEqual(runs[1]?.departureTime, timeFromHM(8, 30));
    });
  });

  describe('bestRoute', () => {
    it('returns the route that arrives earliest at the destination', () => {
      const route = rangeResult.bestRoute();
      assert(route);
      assert.strictEqual(route.arrivalTime(), timeFromHM(9, 10));
      assert.strictEqual(route.departureTime(), timeFromHM(8, 30));
    });

    it('accepts a specific stop ID', () => {
      const route = rangeResult.bestRoute(DEST);
      assert(route);
      assert.strictEqual(route.arrivalTime(), timeFromHM(9, 10));
    });

    it('returns undefined for an unreachable stop', () => {
      assert.strictEqual(rangeResult.bestRoute(99), undefined);
    });
  });

  describe('latestDepartureRoute', () => {
    it('returns the route with the latest possible departure', () => {
      const route = rangeResult.latestDepartureRoute();
      assert(route);
      assert.strictEqual(route.departureTime(), timeFromHM(9, 0));
    });

    it('returns undefined for an unreachable stop', () => {
      assert.strictEqual(rangeResult.latestDepartureRoute(99), undefined);
    });
  });

  describe('fastestRoute', () => {
    it('returns the route with the shortest travel duration', () => {
      // runA: 30 min, runB: 40 min
      const route = rangeResult.fastestRoute();
      assert(route);
      assert.strictEqual(route.departureTime(), timeFromHM(9, 0));
      assert.strictEqual(route.totalDuration(), 30);
    });

    it('returns undefined for an unreachable stop', () => {
      assert.strictEqual(rangeResult.fastestRoute(99), undefined);
    });
  });

  describe('getRoutes', () => {
    it('returns all routes ordered earliest-departure-first', () => {
      const routes = rangeResult.getRoutes();
      assert.strictEqual(routes.length, 2);
      assert.strictEqual(routes[0]?.departureTime(), timeFromHM(8, 30));
      assert.strictEqual(routes[1]?.departureTime(), timeFromHM(9, 0));
    });
  });

  describe('earliestArrivalAt', () => {
    it('returns the earliest arrival across all Pareto runs', () => {
      const arrival = rangeResult.earliestArrivalAt(DEST);
      assert(arrival);
      assert.strictEqual(arrival.arrival, timeFromHM(9, 10));
    });

    it('returns undefined for a stop that was never reached', () => {
      assert.strictEqual(rangeResult.earliestArrivalAt(99), undefined);
    });
  });

  describe('shortestDurationTo', () => {
    it('returns the run with the minimum travel duration', () => {
      const result = rangeResult.shortestDurationTo(DEST);
      assert(result);
      assert.strictEqual(result.duration, 30);
      assert.strictEqual(result.arrival, timeFromHM(9, 30));
    });

    it('returns undefined for a stop that was never reached', () => {
      assert.strictEqual(rangeResult.shortestDurationTo(99), undefined);
    });
  });

  describe('allShortestDurations', () => {
    it('maps every reached stop to the shortest duration across all runs', () => {
      const durations = rangeResult.allShortestDurations();
      assert.strictEqual(durations.get(0)?.duration, 0);
      assert.strictEqual(durations.get(DEST)?.duration, 30);
    });
  });

  describe('allEarliestArrivals', () => {
    it('maps every reached stop to the earliest arrival across all runs', () => {
      const arrivals = rangeResult.allEarliestArrivals();
      assert.strictEqual(arrivals.get(0)?.arrival, timeFromHM(8, 30));
      assert.strictEqual(arrivals.get(DEST)?.arrival, timeFromHM(9, 10));
    });
  });

  describe('empty result', () => {
    it('handles an empty Pareto set gracefully', () => {
      const empty = new RangeResult([], DESTINATIONS);
      assert.strictEqual(empty.size, 0);
      assert.strictEqual(empty.bestRoute(), undefined);
      assert.strictEqual(empty.latestDepartureRoute(), undefined);
      assert.strictEqual(empty.fastestRoute(), undefined);
      assert.deepStrictEqual(empty.getRoutes(), []);
      assert.strictEqual(empty.earliestArrivalAt(DEST), undefined);
      assert.strictEqual(empty.shortestDurationTo(DEST), undefined);
      assert.deepStrictEqual(empty.allShortestDurations(), new Map());
      assert.deepStrictEqual(empty.allEarliestArrivals(), new Map());
    });
  });

  describe('no destinations (full-network / isochrone mode)', () => {
    // Same routing data as runA/runB but Result is built with empty destinations,
    // reflecting how RangeRouter constructs results in full-network mode.
    const emptyDests = new Set<StopId>();

    const runAFull: ParetoRun = {
      departureTime: timeFromHM(9, 0),
      result: new Result(
        emptyDests,
        RoutingState.fromTestData({
          nbStops: 2,
          origins: [0],
          destinations: [],
          arrivals: [
            [0, timeFromHM(9, 0), 0],
            [DEST, timeFromHM(9, 30), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHM(9, 0) }]],
            [[DEST, edgeA]],
          ],
        }),
        stopsIndex,
        timetable,
      ),
    };

    const runBFull: ParetoRun = {
      departureTime: timeFromHM(8, 30),
      result: new Result(
        emptyDests,
        RoutingState.fromTestData({
          nbStops: 2,
          origins: [0],
          destinations: [],
          arrivals: [
            [0, timeFromHM(8, 30), 0],
            [DEST, timeFromHM(9, 10), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHM(8, 30) }]],
            [[DEST, edgeB]],
          ],
        }),
        stopsIndex,
        timetable,
      ),
    };

    const fullNetworkResult = new RangeResult([runAFull, runBFull], emptyDests);

    it('destinations is empty', () => {
      assert.strictEqual(fullNetworkResult.destinations.size, 0);
    });

    it('getRoutes returns an empty array', () => {
      // Result was built with empty destinations, so bestRoute() on each inner
      // Result finds no target and getRoutes() collapses to [].
      assert.deepStrictEqual(fullNetworkResult.getRoutes(), []);
    });

    it('bestRoute without an explicit stop returns undefined', () => {
      assert.strictEqual(fullNetworkResult.bestRoute(), undefined);
    });

    it('bestRoute with an explicit stop returns the correct route', () => {
      const route = fullNetworkResult.bestRoute(DEST);
      assert(route);
      // Best route to DEST is via runB (earlier arrival at 09:10).
      assert.strictEqual(route.arrivalTime(), timeFromHM(9, 10));
    });

    it('allEarliestArrivals covers all reachable stops', () => {
      const arrivals = fullNetworkResult.allEarliestArrivals();
      // DEST earliest arrival is 09:10 (from runB).
      assert.strictEqual(arrivals.get(DEST)?.arrival, timeFromHM(9, 10));
    });

    it('allShortestDurations covers all reachable stops', () => {
      const durations = fullNetworkResult.allShortestDurations();
      // runA: 30 min, runB: 40 min → shortest duration to DEST is 30 min.
      assert.strictEqual(durations.get(DEST)?.duration, 30);
    });
  });
});
