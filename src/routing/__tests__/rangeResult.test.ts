import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Timetable } from '../../router.js';
import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHM } from '../../timetable/time.js';
import {
  RouteTypes,
  ServiceRoute,
  StopAdjacency,
} from '../../timetable/timetable.js';
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
  { type: RouteTypes.BUS, name: 'Line 1', routes: [0] },
];
const timetable = new Timetable(stopsAdjacency, routesAdjacency, serviceRoutes);

const DEST = 1;

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
const rangeResult = new RangeResult([runA, runB]);

describe('RangeResult', () => {
  describe('size', () => {
    it('size reflects the number of Pareto runs', () => {
      assert.strictEqual(rangeResult.size, 2);
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

  describe('routes', () => {
    it('returns all routes ordered earliest-departure-first', () => {
      const routes = [...rangeResult.routes()];
      assert.strictEqual(routes.length, 2);
      assert.strictEqual(routes[0]?.departureTime(), timeFromHM(8, 30));
      assert.strictEqual(routes[1]?.departureTime(), timeFromHM(9, 0));
      assert.deepStrictEqual(
        [...rangeResult.routes()].map((route) => route.departureTime()),
        [timeFromHM(8, 30), timeFromHM(9, 0)],
      );
      assert.deepStrictEqual([...rangeResult], [runA, runB]);
    });

    it('yields access-only routes without requiring vehicle times', () => {
      const result = new Result(
        RoutingState.fromTestData({
          nbStops: 2,
          origins: [0],
          destinations: [DEST],
          arrivals: [[DEST, timeFromHM(9, 2), 0]],
          graph: [
            [
              [0, { stopId: 0, arrival: timeFromHM(9, 0) }],
              [
                DEST,
                { from: 0, to: DEST, duration: 2, arrival: timeFromHM(9, 2) },
              ],
            ],
          ],
        }),
        stopsIndex,
        timetable,
      );
      const range = new RangeResult([
        { departureTime: timeFromHM(9, 0), result },
      ]);
      assert.deepStrictEqual(
        [...range.routes()].map((route) => route.legs),
        [[{ from: stops[0], to: stops[DEST], duration: 2 }]],
      );
    });

    it('skips runs without routes', () => {
      const emptyRun = {
        departureTime: runB.departureTime,
        result: new Result(
          RoutingState.fromTestData({ nbStops: 2 }),
          stopsIndex,
          timetable,
        ),
      };
      const result = new RangeResult([runA, emptyRun]);
      assert.deepStrictEqual(
        [...result.routes()].map((route) => route.departureTime()),
        [runA.departureTime],
      );
    });
  });

  describe('arrivalAt', () => {
    it('returns the earliest arrival across all Pareto runs', () => {
      const arrival = rangeResult.arrivalAt(DEST);
      assert(arrival);
      assert.strictEqual(arrival.arrival, timeFromHM(9, 10));
    });

    it('returns undefined for a stop that was never reached', () => {
      assert.strictEqual(rangeResult.arrivalAt(99), undefined);
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

  describe('arrivals and shortestDurations', () => {
    it('includes origins and aggregates all reached stops', () => {
      assert.deepStrictEqual(
        [...rangeResult.arrivals()],
        [
          { stop: 0, arrival: timeFromHM(8, 30), legNumber: 0 },
          { stop: DEST, arrival: timeFromHM(9, 10), legNumber: 1 },
        ],
      );
      assert.deepStrictEqual(
        [...rangeResult.shortestDurations()],
        [
          { stop: 0, arrival: timeFromHM(9, 0), legNumber: 0, duration: 0 },
          {
            stop: DEST,
            arrival: timeFromHM(9, 30),
            legNumber: 1,
            duration: 30,
          },
        ],
      );
    });

    const runs = [
      { departureTime: 500, arrival: 540, legNumber: 2 },
      { departureTime: 490, arrival: 515, legNumber: 1 },
      { departureTime: 480, arrival: 505, legNumber: 3 },
      { departureTime: 470, arrival: 505, legNumber: 4 },
    ].map(({ departureTime, arrival, legNumber }) => ({
      departureTime,
      result: new Result(
        RoutingState.fromTestData({
          nbStops: 2,
          arrivals: [[DEST, arrival, legNumber]],
        }),
        stopsIndex,
        timetable,
      ),
    }));
    const result = new RangeResult(runs);

    it('yields final earliest arrivals and retains the first run on ties', () => {
      const expected = [{ stop: DEST, arrival: 505, legNumber: 3 }];
      assert.deepStrictEqual([...result.arrivals()], expected);
      assert.deepStrictEqual([...result.arrivals()], expected);
    });

    it('yields final shortest durations and retains the first run on ties', () => {
      const expected = [
        { stop: DEST, arrival: 515, legNumber: 1, duration: 25 },
      ];
      assert.deepStrictEqual([...result.shortestDurations()], expected);
      assert.deepStrictEqual([...result.shortestDurations()], expected);
    });
  });

  describe('empty result', () => {
    it('handles an empty Pareto set gracefully', () => {
      const empty = new RangeResult([]);
      assert.strictEqual(empty.size, 0);
      assert.strictEqual(empty.bestRoute(), undefined);
      assert.strictEqual(empty.latestDepartureRoute(), undefined);
      assert.strictEqual(empty.fastestRoute(), undefined);
      assert.deepStrictEqual([...empty.routes()], []);
      assert.strictEqual(empty.arrivalAt(DEST), undefined);
      assert.strictEqual(empty.shortestDurationTo(DEST), undefined);
      assert.deepStrictEqual([...empty.shortestDurations()], []);
      assert.deepStrictEqual([...empty.arrivals()], []);
      assert.deepStrictEqual([...empty.arrivals(0)], []);
      assert.deepStrictEqual([...empty.shortestDurations(0)], []);
      assert.strictEqual(empty.bestRoute(undefined, 0), undefined);
      assert.strictEqual(empty.latestDepartureRoute(undefined, 0), undefined);
      assert.strictEqual(empty.fastestRoute(undefined, 0), undefined);
    });
  });

  describe('no destinations (full-network / isochrone mode)', () => {
    // Same routing data as runA/runB but Result is built with empty destinations,
    // reflecting how RangeRouter constructs results in full-network mode.

    const runAFull: ParetoRun = {
      departureTime: timeFromHM(9, 0),
      result: new Result(
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

    const fullNetworkResult = new RangeResult([runAFull, runBFull]);

    it('has no default route targets when the routing states have no destinations', () => {
      assert.strictEqual(fullNetworkResult.latestDepartureRoute(), undefined);
      assert.strictEqual(fullNetworkResult.fastestRoute(), undefined);
    });

    it('routes yields nothing', () => {
      // Result was built with empty destinations, so bestRoute() on each inner
      // Result finds no target and routes() yields nothing.
      assert.deepStrictEqual([...fullNetworkResult.routes()], []);
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

    it('arrivals covers all reachable stops', () => {
      const arrivals = [...fullNetworkResult.arrivals()];
      // DEST earliest arrival is 09:10 (from runB).
      assert.strictEqual(
        arrivals.find(({ stop }) => stop === DEST)?.arrival,
        timeFromHM(9, 10),
      );
    });

    it('shortestDurations covers all reachable stops', () => {
      const durations = [...fullNetworkResult.shortestDurations()];
      // runA: 30 min, runB: 40 min → shortest duration to DEST is 30 min.
      assert.strictEqual(
        durations.find(({ stop }) => stop === DEST)?.duration,
        30,
      );
    });
  });

  describe('with transfer limits', () => {
    const ORIGIN = 0;
    const INTERCHANGE = 1;
    const DESTINATION = 2;
    const TRANSFER_ONLY = 3;
    const DIRECT = 0;
    const TO_INTERCHANGE = 1;
    const FROM_INTERCHANGE = 2;
    const TO_TRANSFER_ONLY = 3;

    const stops: Stop[] = [
      {
        id: ORIGIN,
        sourceStopId: 'stop0',
        name: 'Origin',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
      },
      {
        id: INTERCHANGE,
        sourceStopId: 'stop1',
        name: 'Interchange',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
      },
      {
        id: DESTINATION,
        sourceStopId: 'stop2',
        name: 'Destination',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
      },
      {
        id: TRANSFER_ONLY,
        sourceStopId: 'stop3',
        name: 'Transfer-only destination',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
      },
    ];
    const stopsIndex = new StopsIndex(stops);

    const early: ParetoRun = {
      departureTime: timeFromHM(8, 0),
      result: new Result(
        RoutingState.fromTestData({
          nbStops: stops.length,
          origins: [ORIGIN],
          destinations: [DESTINATION],
          arrivals: [
            [ORIGIN, timeFromHM(8, 0), 0],
            [INTERCHANGE, timeFromHM(8, 5), 1],
            [DESTINATION, timeFromHM(8, 40), 2],
            [TRANSFER_ONLY, timeFromHM(8, 40), 2],
          ],
          graph: [
            [[ORIGIN, { stopId: ORIGIN, arrival: timeFromHM(8, 0) }]],
            [
              [
                INTERCHANGE,
                {
                  routeId: TO_INTERCHANGE,
                  arrival: timeFromHM(8, 5),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
              [
                DESTINATION,
                {
                  routeId: DIRECT,
                  arrival: timeFromHM(9, 10),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
            ],
            [
              [
                DESTINATION,
                {
                  routeId: FROM_INTERCHANGE,
                  arrival: timeFromHM(8, 40),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
              [
                TRANSFER_ONLY,
                {
                  routeId: TO_TRANSFER_ONLY,
                  arrival: timeFromHM(8, 40),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
            ],
          ],
        }),
        stopsIndex,
        new Timetable(
          [
            { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
            { routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY] }, // Interchange
            { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
            { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
          ],
          [
            Route.of({
              id: DIRECT,
              serviceRouteId: DIRECT,
              trips: [
                {
                  stops: [
                    {
                      id: ORIGIN,
                      arrivalTime: timeFromHM(8, 0),
                      departureTime: timeFromHM(8, 0),
                    },
                    {
                      id: DESTINATION,
                      arrivalTime: timeFromHM(9, 10),
                      departureTime: timeFromHM(9, 10),
                    },
                  ],
                },
              ],
            }),
            Route.of({
              id: TO_INTERCHANGE,
              serviceRouteId: TO_INTERCHANGE,
              trips: [
                {
                  stops: [
                    {
                      id: ORIGIN,
                      arrivalTime: timeFromHM(8, 0),
                      departureTime: timeFromHM(8, 0),
                    },
                    {
                      id: INTERCHANGE,
                      arrivalTime: timeFromHM(8, 5),
                      departureTime: timeFromHM(8, 5),
                    },
                  ],
                },
              ],
            }),
            Route.of({
              id: FROM_INTERCHANGE,
              serviceRouteId: FROM_INTERCHANGE,
              trips: [
                {
                  stops: [
                    {
                      id: INTERCHANGE,
                      arrivalTime: timeFromHM(8, 7),
                      departureTime: timeFromHM(8, 7),
                    },
                    {
                      id: DESTINATION,
                      arrivalTime: timeFromHM(8, 40),
                      departureTime: timeFromHM(8, 40),
                    },
                  ],
                },
              ],
            }),
            Route.of({
              id: TO_TRANSFER_ONLY,
              serviceRouteId: TO_TRANSFER_ONLY,
              trips: [
                {
                  stops: [
                    {
                      id: INTERCHANGE,
                      arrivalTime: timeFromHM(8, 7),
                      departureTime: timeFromHM(8, 7),
                    },
                    {
                      id: TRANSFER_ONLY,
                      arrivalTime: timeFromHM(8, 40),
                      departureTime: timeFromHM(8, 40),
                    },
                  ],
                },
              ],
            }),
          ],
          [
            { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
            { type: RouteTypes.BUS, name: 'Line 1', routes: [TO_INTERCHANGE] },
            {
              type: RouteTypes.BUS,
              name: 'Line 2',
              routes: [FROM_INTERCHANGE],
            },
            {
              type: RouteTypes.BUS,
              name: 'Line 3',
              routes: [TO_TRANSFER_ONLY],
            },
          ],
        ),
      ),
    };
    const late: ParetoRun = {
      departureTime: timeFromHM(8, 15),
      result: new Result(
        RoutingState.fromTestData({
          nbStops: stops.length,
          origins: [ORIGIN],
          destinations: [DESTINATION],
          arrivals: [
            [ORIGIN, timeFromHM(8, 15), 0],
            [INTERCHANGE, timeFromHM(8, 20), 1],
            [DESTINATION, timeFromHM(8, 50), 2],
            [TRANSFER_ONLY, timeFromHM(8, 50), 2],
          ],
          graph: [
            [[ORIGIN, { stopId: ORIGIN, arrival: timeFromHM(8, 15) }]],
            [
              [
                INTERCHANGE,
                {
                  routeId: TO_INTERCHANGE,
                  arrival: timeFromHM(8, 20),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
              [
                DESTINATION,
                {
                  routeId: DIRECT,
                  arrival: timeFromHM(9, 0),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
            ],
            [
              [
                DESTINATION,
                {
                  routeId: FROM_INTERCHANGE,
                  arrival: timeFromHM(8, 50),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
              [
                TRANSFER_ONLY,
                {
                  routeId: TO_TRANSFER_ONLY,
                  arrival: timeFromHM(8, 50),
                  tripIndex: 0,
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                },
              ],
            ],
          ],
        }),
        stopsIndex,
        new Timetable(
          [
            { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
            { routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY] }, // Interchange
            { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
            { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
          ],
          [
            Route.of({
              id: DIRECT,
              serviceRouteId: DIRECT,
              trips: [
                {
                  stops: [
                    {
                      id: ORIGIN,
                      arrivalTime: timeFromHM(8, 15),
                      departureTime: timeFromHM(8, 15),
                    },
                    {
                      id: DESTINATION,
                      arrivalTime: timeFromHM(9, 0),
                      departureTime: timeFromHM(9, 0),
                    },
                  ],
                },
              ],
            }),
            Route.of({
              id: TO_INTERCHANGE,
              serviceRouteId: TO_INTERCHANGE,
              trips: [
                {
                  stops: [
                    {
                      id: ORIGIN,
                      arrivalTime: timeFromHM(8, 15),
                      departureTime: timeFromHM(8, 15),
                    },
                    {
                      id: INTERCHANGE,
                      arrivalTime: timeFromHM(8, 20),
                      departureTime: timeFromHM(8, 20),
                    },
                  ],
                },
              ],
            }),
            Route.of({
              id: FROM_INTERCHANGE,
              serviceRouteId: FROM_INTERCHANGE,
              trips: [
                {
                  stops: [
                    {
                      id: INTERCHANGE,
                      arrivalTime: timeFromHM(8, 22),
                      departureTime: timeFromHM(8, 22),
                    },
                    {
                      id: DESTINATION,
                      arrivalTime: timeFromHM(8, 50),
                      departureTime: timeFromHM(8, 50),
                    },
                  ],
                },
              ],
            }),
            Route.of({
              id: TO_TRANSFER_ONLY,
              serviceRouteId: TO_TRANSFER_ONLY,
              trips: [
                {
                  stops: [
                    {
                      id: INTERCHANGE,
                      arrivalTime: timeFromHM(8, 22),
                      departureTime: timeFromHM(8, 22),
                    },
                    {
                      id: TRANSFER_ONLY,
                      arrivalTime: timeFromHM(8, 50),
                      departureTime: timeFromHM(8, 50),
                    },
                  ],
                },
              ],
            }),
          ],
          [
            { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
            { type: RouteTypes.BUS, name: 'Line 1', routes: [TO_INTERCHANGE] },
            {
              type: RouteTypes.BUS,
              name: 'Line 2',
              routes: [FROM_INTERCHANGE],
            },
            {
              type: RouteTypes.BUS,
              name: 'Line 3',
              routes: [TO_TRANSFER_ONLY],
            },
          ],
        ),
      ),
    };
    const range = new RangeResult([late, early]);

    for (const method of [
      'bestRoute',
      'fastestRoute',
      'latestDepartureRoute',
    ] as const) {
      describe(method, () => {
        it('selects and reconstructs a qualifying run', () => {
          const route = range[method](undefined, 0);
          assert(route);
          assert.strictEqual(route.departureTime(), timeFromHM(8, 15));
          assert.strictEqual(route.arrivalTime(), timeFromHM(9, 0));
          assert.strictEqual(
            route.legs.filter((leg) => 'route' in leg).length,
            1,
          );
          assert.strictEqual(range[method](TRANSFER_ONLY, 0), undefined);
        });
      });
    }

    it('skips a latest departure without a qualifying route', () => {
      const result = new RangeResult([
        {
          departureTime: timeFromHM(8, 15),
          result: new Result(
            RoutingState.fromTestData({
              nbStops: stops.length,
              origins: [ORIGIN],
              destinations: [DESTINATION],
              arrivals: [
                [ORIGIN, timeFromHM(8, 15), 0],
                [INTERCHANGE, timeFromHM(8, 20), 1],
                [DESTINATION, timeFromHM(8, 50), 2],
                [TRANSFER_ONLY, timeFromHM(8, 50), 2],
              ],
              graph: [
                [[ORIGIN, { stopId: ORIGIN, arrival: timeFromHM(8, 15) }]],
                [
                  [
                    INTERCHANGE,
                    {
                      routeId: TO_INTERCHANGE,
                      arrival: timeFromHM(8, 20),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
                [
                  [
                    DESTINATION,
                    {
                      routeId: FROM_INTERCHANGE,
                      arrival: timeFromHM(8, 50),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    TRANSFER_ONLY,
                    {
                      routeId: TO_TRANSFER_ONLY,
                      arrival: timeFromHM(8, 50),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
              ],
            }),
            stopsIndex,
            new Timetable(
              [
                { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
                {
                  routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY],
                }, // Interchange
                { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
                { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
              ],
              [
                Route.of({
                  id: DIRECT,
                  serviceRouteId: DIRECT,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 15),
                          departureTime: timeFromHM(8, 15),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(9, 20),
                          departureTime: timeFromHM(9, 20),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_INTERCHANGE,
                  serviceRouteId: TO_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 15),
                          departureTime: timeFromHM(8, 15),
                        },
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 20),
                          departureTime: timeFromHM(8, 20),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: FROM_INTERCHANGE,
                  serviceRouteId: FROM_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 22),
                          departureTime: timeFromHM(8, 22),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(8, 50),
                          departureTime: timeFromHM(8, 50),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_TRANSFER_ONLY,
                  serviceRouteId: TO_TRANSFER_ONLY,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 22),
                          departureTime: timeFromHM(8, 22),
                        },
                        {
                          id: TRANSFER_ONLY,
                          arrivalTime: timeFromHM(8, 50),
                          departureTime: timeFromHM(8, 50),
                        },
                      ],
                    },
                  ],
                }),
              ],
              [
                { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 1',
                  routes: [TO_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 2',
                  routes: [FROM_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 3',
                  routes: [TO_TRANSFER_ONLY],
                },
              ],
            ),
          ),
        },
        early,
      ]);
      assert.strictEqual(
        result.latestDepartureRoute(undefined, 0)?.departureTime(),
        timeFromHM(8, 0),
      );
    });

    it('aggregates only qualifying arrivals', () => {
      assert.deepStrictEqual(range.arrivalAt(DESTINATION, 0), {
        arrival: timeFromHM(9, 0),
        legNumber: 1,
      });
      assert.deepStrictEqual(
        [...range.arrivals(0)],
        [
          { stop: ORIGIN, arrival: timeFromHM(8, 0), legNumber: 0 },
          { stop: INTERCHANGE, arrival: timeFromHM(8, 5), legNumber: 1 },
          { stop: DESTINATION, arrival: timeFromHM(9, 0), legNumber: 1 },
        ],
      );
    });

    it('aggregates only qualifying durations', () => {
      assert.deepStrictEqual(range.shortestDurationTo(DESTINATION, 0), {
        arrival: timeFromHM(9, 0),
        legNumber: 1,
        duration: 45,
      });
      assert.deepStrictEqual(
        [...range.shortestDurations(0)],
        [
          {
            stop: ORIGIN,
            arrival: timeFromHM(8, 15),
            legNumber: 0,
            duration: 0,
          },
          {
            stop: INTERCHANGE,
            arrival: timeFromHM(8, 20),
            legNumber: 1,
            duration: 5,
          },
          {
            stop: DESTINATION,
            arrival: timeFromHM(9, 0),
            legNumber: 1,
            duration: 45,
          },
        ],
      );
    });

    it('prefers the later departure when constrained arrival times tie', () => {
      const result = new RangeResult([
        {
          departureTime: timeFromHM(8, 10),
          result: new Result(
            RoutingState.fromTestData({
              nbStops: stops.length,
              origins: [ORIGIN],
              destinations: [DESTINATION],
              arrivals: [
                [ORIGIN, timeFromHM(8, 10), 0],
                [INTERCHANGE, timeFromHM(8, 15), 1],
                [DESTINATION, timeFromHM(8, 40), 2],
                [TRANSFER_ONLY, timeFromHM(8, 40), 2],
              ],
              graph: [
                [[ORIGIN, { stopId: ORIGIN, arrival: timeFromHM(8, 10) }]],
                [
                  [
                    INTERCHANGE,
                    {
                      routeId: TO_INTERCHANGE,
                      arrival: timeFromHM(8, 15),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    DESTINATION,
                    {
                      routeId: DIRECT,
                      arrival: timeFromHM(9, 0),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
                [
                  [
                    DESTINATION,
                    {
                      routeId: FROM_INTERCHANGE,
                      arrival: timeFromHM(8, 40),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    TRANSFER_ONLY,
                    {
                      routeId: TO_TRANSFER_ONLY,
                      arrival: timeFromHM(8, 40),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
              ],
            }),
            stopsIndex,
            new Timetable(
              [
                { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
                {
                  routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY],
                }, // Interchange
                { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
                { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
              ],
              [
                Route.of({
                  id: DIRECT,
                  serviceRouteId: DIRECT,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 10),
                          departureTime: timeFromHM(8, 10),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(9, 0),
                          departureTime: timeFromHM(9, 0),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_INTERCHANGE,
                  serviceRouteId: TO_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 10),
                          departureTime: timeFromHM(8, 10),
                        },
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 15),
                          departureTime: timeFromHM(8, 15),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: FROM_INTERCHANGE,
                  serviceRouteId: FROM_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 17),
                          departureTime: timeFromHM(8, 17),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(8, 40),
                          departureTime: timeFromHM(8, 40),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_TRANSFER_ONLY,
                  serviceRouteId: TO_TRANSFER_ONLY,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 17),
                          departureTime: timeFromHM(8, 17),
                        },
                        {
                          id: TRANSFER_ONLY,
                          arrivalTime: timeFromHM(8, 40),
                          departureTime: timeFromHM(8, 40),
                        },
                      ],
                    },
                  ],
                }),
              ],
              [
                { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 1',
                  routes: [TO_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 2',
                  routes: [FROM_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 3',
                  routes: [TO_TRANSFER_ONLY],
                },
              ],
            ),
          ),
        },
        {
          departureTime: timeFromHM(8, 0),
          result: new Result(
            RoutingState.fromTestData({
              nbStops: stops.length,
              origins: [ORIGIN],
              destinations: [DESTINATION],
              arrivals: [
                [ORIGIN, timeFromHM(8, 0), 0],
                [INTERCHANGE, timeFromHM(8, 5), 1],
                [DESTINATION, timeFromHM(8, 30), 2],
                [TRANSFER_ONLY, timeFromHM(8, 30), 2],
              ],
              graph: [
                [[ORIGIN, { stopId: ORIGIN, arrival: timeFromHM(8, 0) }]],
                [
                  [
                    INTERCHANGE,
                    {
                      routeId: TO_INTERCHANGE,
                      arrival: timeFromHM(8, 5),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    DESTINATION,
                    {
                      routeId: DIRECT,
                      arrival: timeFromHM(9, 0),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
                [
                  [
                    DESTINATION,
                    {
                      routeId: FROM_INTERCHANGE,
                      arrival: timeFromHM(8, 30),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    TRANSFER_ONLY,
                    {
                      routeId: TO_TRANSFER_ONLY,
                      arrival: timeFromHM(8, 30),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
              ],
            }),
            stopsIndex,
            new Timetable(
              [
                { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
                {
                  routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY],
                }, // Interchange
                { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
                { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
              ],
              [
                Route.of({
                  id: DIRECT,
                  serviceRouteId: DIRECT,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 0),
                          departureTime: timeFromHM(8, 0),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(9, 0),
                          departureTime: timeFromHM(9, 0),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_INTERCHANGE,
                  serviceRouteId: TO_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 0),
                          departureTime: timeFromHM(8, 0),
                        },
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 5),
                          departureTime: timeFromHM(8, 5),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: FROM_INTERCHANGE,
                  serviceRouteId: FROM_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 7),
                          departureTime: timeFromHM(8, 7),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(8, 30),
                          departureTime: timeFromHM(8, 30),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_TRANSFER_ONLY,
                  serviceRouteId: TO_TRANSFER_ONLY,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 7),
                          departureTime: timeFromHM(8, 7),
                        },
                        {
                          id: TRANSFER_ONLY,
                          arrivalTime: timeFromHM(8, 30),
                          departureTime: timeFromHM(8, 30),
                        },
                      ],
                    },
                  ],
                }),
              ],
              [
                { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 1',
                  routes: [TO_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 2',
                  routes: [FROM_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 3',
                  routes: [TO_TRANSFER_ONLY],
                },
              ],
            ),
          ),
        },
      ]);
      assert.strictEqual(result.bestRoute(undefined, 0)?.departureTime(), 490);
    });

    it('prefers the earlier departure when constrained route durations tie', () => {
      const result = new RangeResult([
        {
          departureTime: timeFromHM(8, 10),
          result: new Result(
            RoutingState.fromTestData({
              nbStops: stops.length,
              origins: [ORIGIN],
              destinations: [DESTINATION],
              arrivals: [
                [ORIGIN, timeFromHM(8, 10), 0],
                [INTERCHANGE, timeFromHM(8, 15), 1],
                [DESTINATION, timeFromHM(8, 40), 2],
                [TRANSFER_ONLY, timeFromHM(8, 40), 2],
              ],
              graph: [
                [[ORIGIN, { stopId: ORIGIN, arrival: timeFromHM(8, 10) }]],
                [
                  [
                    INTERCHANGE,
                    {
                      routeId: TO_INTERCHANGE,
                      arrival: timeFromHM(8, 15),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    DESTINATION,
                    {
                      routeId: DIRECT,
                      arrival: timeFromHM(9, 10),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
                [
                  [
                    DESTINATION,
                    {
                      routeId: FROM_INTERCHANGE,
                      arrival: timeFromHM(8, 40),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    TRANSFER_ONLY,
                    {
                      routeId: TO_TRANSFER_ONLY,
                      arrival: timeFromHM(8, 40),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
              ],
            }),
            stopsIndex,
            new Timetable(
              [
                { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
                {
                  routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY],
                }, // Interchange
                { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
                { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
              ],
              [
                Route.of({
                  id: DIRECT,
                  serviceRouteId: DIRECT,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 10),
                          departureTime: timeFromHM(8, 10),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(9, 10),
                          departureTime: timeFromHM(9, 10),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_INTERCHANGE,
                  serviceRouteId: TO_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 10),
                          departureTime: timeFromHM(8, 10),
                        },
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 15),
                          departureTime: timeFromHM(8, 15),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: FROM_INTERCHANGE,
                  serviceRouteId: FROM_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 17),
                          departureTime: timeFromHM(8, 17),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(8, 40),
                          departureTime: timeFromHM(8, 40),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_TRANSFER_ONLY,
                  serviceRouteId: TO_TRANSFER_ONLY,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 17),
                          departureTime: timeFromHM(8, 17),
                        },
                        {
                          id: TRANSFER_ONLY,
                          arrivalTime: timeFromHM(8, 40),
                          departureTime: timeFromHM(8, 40),
                        },
                      ],
                    },
                  ],
                }),
              ],
              [
                { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 1',
                  routes: [TO_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 2',
                  routes: [FROM_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 3',
                  routes: [TO_TRANSFER_ONLY],
                },
              ],
            ),
          ),
        },
        {
          departureTime: timeFromHM(8, 0),
          result: new Result(
            RoutingState.fromTestData({
              nbStops: stops.length,
              origins: [ORIGIN],
              destinations: [DESTINATION],
              arrivals: [
                [ORIGIN, timeFromHM(8, 0), 0],
                [INTERCHANGE, timeFromHM(8, 5), 1],
                [DESTINATION, timeFromHM(8, 30), 2],
                [TRANSFER_ONLY, timeFromHM(8, 30), 2],
              ],
              graph: [
                [[ORIGIN, { stopId: ORIGIN, arrival: timeFromHM(8, 0) }]],
                [
                  [
                    INTERCHANGE,
                    {
                      routeId: TO_INTERCHANGE,
                      arrival: timeFromHM(8, 5),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    DESTINATION,
                    {
                      routeId: DIRECT,
                      arrival: timeFromHM(9, 0),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
                [
                  [
                    DESTINATION,
                    {
                      routeId: FROM_INTERCHANGE,
                      arrival: timeFromHM(8, 30),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                  [
                    TRANSFER_ONLY,
                    {
                      routeId: TO_TRANSFER_ONLY,
                      arrival: timeFromHM(8, 30),
                      tripIndex: 0,
                      stopIndex: 0,
                      hopOffStopIndex: 1,
                    },
                  ],
                ],
              ],
            }),
            stopsIndex,
            new Timetable(
              [
                { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
                {
                  routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY],
                }, // Interchange
                { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
                { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
              ],
              [
                Route.of({
                  id: DIRECT,
                  serviceRouteId: DIRECT,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 0),
                          departureTime: timeFromHM(8, 0),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(9, 0),
                          departureTime: timeFromHM(9, 0),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_INTERCHANGE,
                  serviceRouteId: TO_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: ORIGIN,
                          arrivalTime: timeFromHM(8, 0),
                          departureTime: timeFromHM(8, 0),
                        },
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 5),
                          departureTime: timeFromHM(8, 5),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: FROM_INTERCHANGE,
                  serviceRouteId: FROM_INTERCHANGE,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 7),
                          departureTime: timeFromHM(8, 7),
                        },
                        {
                          id: DESTINATION,
                          arrivalTime: timeFromHM(8, 30),
                          departureTime: timeFromHM(8, 30),
                        },
                      ],
                    },
                  ],
                }),
                Route.of({
                  id: TO_TRANSFER_ONLY,
                  serviceRouteId: TO_TRANSFER_ONLY,
                  trips: [
                    {
                      stops: [
                        {
                          id: INTERCHANGE,
                          arrivalTime: timeFromHM(8, 7),
                          departureTime: timeFromHM(8, 7),
                        },
                        {
                          id: TRANSFER_ONLY,
                          arrivalTime: timeFromHM(8, 30),
                          departureTime: timeFromHM(8, 30),
                        },
                      ],
                    },
                  ],
                }),
              ],
              [
                { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 1',
                  routes: [TO_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 2',
                  routes: [FROM_INTERCHANGE],
                },
                {
                  type: RouteTypes.BUS,
                  name: 'Line 3',
                  routes: [TO_TRANSFER_ONLY],
                },
              ],
            ),
          ),
        },
      ]);
      assert.strictEqual(
        result.fastestRoute(undefined, 0)?.departureTime(),
        480,
      );
    });
  });
});
