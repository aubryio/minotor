import assert from 'node:assert';
import { describe, it } from 'node:test';

import { PickUpDropOffTypes, Route } from '../route.js';
import { timeFromHMS } from '../time.js';
import {
  RouteType,
  RouteTypes,
  ServiceRoute,
  StopAdjacency,
  Timetable,
  TransferTypes,
  TripStop,
} from '../timetable.js';
import { encode } from '../tripStopKey.js';

describe('Timetable', () => {
  const stopsAdjacency: StopAdjacency[] = [
    { routes: [] },
    {
      transfers: [{ destination: 2, type: TransferTypes.RECOMMENDED }],
      routes: [0, 1],
    },
    {
      transfers: [
        {
          destination: 1,
          type: TransferTypes.GUARANTEED,
          minTransferTime: 3,
        },
      ],
      routes: [1, 0],
    },
    {
      routes: [],
    },
  ];

  const route1 = Route.of({
    id: 0,
    serviceRouteId: 0,
    trips: [
      {
        stops: [
          {
            id: 1,
            arrivalTime: timeFromHMS(16, 40, 0),
            departureTime: timeFromHMS(16, 50, 0),
          },
          {
            id: 2,
            arrivalTime: timeFromHMS(17, 20, 0),
            departureTime: timeFromHMS(17, 30, 0),
            pickUpType: PickUpDropOffTypes.NOT_AVAILABLE,
          },
        ],
      },
      {
        stops: [
          {
            id: 1,
            arrivalTime: timeFromHMS(18, 0, 0),
            departureTime: timeFromHMS(18, 10, 0),
          },
          {
            id: 2,
            arrivalTime: timeFromHMS(19, 0, 0),
            departureTime: timeFromHMS(19, 10, 0),
            pickUpType: PickUpDropOffTypes.NOT_AVAILABLE,
          },
        ],
      },
    ],
  });
  const route2 = Route.of({
    id: 1,
    serviceRouteId: 1,
    trips: [
      {
        stops: [
          {
            id: 2,
            arrivalTime: timeFromHMS(18, 20, 0),
            departureTime: timeFromHMS(18, 30, 0),
          },
          {
            id: 1,
            arrivalTime: timeFromHMS(19, 0, 0),
            departureTime: timeFromHMS(19, 10, 0),
          },
        ],
      },
      {
        stops: [
          { id: 2, arrivalTime: 1200, departureTime: 1200 },
          { id: 1, arrivalTime: 1240, departureTime: 1240 },
        ],
      },
    ],
  });
  const routesAdjacency = [route1, route2];
  const routes: ServiceRoute[] = [
    { type: RouteTypes.RAIL, name: 'Route 1', routes: [0] },
    { type: RouteTypes.RAIL, name: 'Route 2', routes: [1] },
  ];

  const sampleTimetable: Timetable = new Timetable(
    stopsAdjacency,
    routesAdjacency,
    routes,
    new Map(),
    new Map(),
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
    const tripIndex = route.findEarliestTrip(0);
    assert.strictEqual(tripIndex, 0);
  });

  it('should find the earliest trip for stop1 on route1 after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const afterTime = timeFromHMS(17, 0, 0);
    const tripIndex = route.findEarliestTrip(0, afterTime);
    assert.strictEqual(tripIndex, 1);
  });

  it('should return undefined if no valid trip exists after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const afterTime = timeFromHMS(23, 40, 0);
    const tripIndex = route.findEarliestTrip(0, afterTime);
    assert.strictEqual(tripIndex, undefined);
  });
  describe('findReachableRoutes', () => {
    it('should find reachable routes from a single stop', () => {
      const fromStops = new Set([1]);
      const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
      assert.strictEqual(reachableRoutes.size, 2);
      assert.deepStrictEqual(
        reachableRoutes,
        new Map([
          [route1, 0],
          [route2, 1],
        ]),
      );
    });

    it('should find reachable routes from multiple stops', () => {
      const fromStops = new Set([1, 2]);
      const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
      assert.strictEqual(reachableRoutes.size, 2);

      assert.deepStrictEqual(
        reachableRoutes,
        new Map([
          [route1, 0],
          [route2, 0],
        ]),
      );
    });

    it('should find no reachable routes from stops with no routes', () => {
      const fromStops = new Set([3]); // Stop 3 has no routes in sample timetable
      const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
      assert.strictEqual(reachableRoutes.size, 0);
      assert.deepStrictEqual(reachableRoutes, new Map());
    });

    it('should find no reachable routes from empty stop set', () => {
      const fromStops = new Set<number>();
      const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
      assert.strictEqual(reachableRoutes.size, 0);
      assert.deepStrictEqual(reachableRoutes, new Map());
    });

    it('should find no reachable routes from non-existent stops', () => {
      const fromStops = new Set([999, 1000]); // Non-existent stops
      const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);
      assert.strictEqual(reachableRoutes.size, 0);
      assert.deepStrictEqual(reachableRoutes, new Map());
    });

    it('should filter routes by transport modes correctly', () => {
      const fromStops = new Set([1]);

      const railRoutes = sampleTimetable.findReachableRoutes(
        fromStops,
        new Set<RouteType>([RouteTypes.RAIL]),
      );
      assert.strictEqual(railRoutes.size, 2);
      assert.deepStrictEqual(
        railRoutes,
        new Map([
          [route1, 0],
          [route2, 1],
        ]),
      );

      const busRoutes = sampleTimetable.findReachableRoutes(
        fromStops,
        new Set<RouteType>([RouteTypes.BUS]),
      );
      assert.strictEqual(busRoutes.size, 0);
      assert.deepStrictEqual(busRoutes, new Map());

      const multiModeRoutes = sampleTimetable.findReachableRoutes(
        fromStops,
        new Set<RouteType>([
          RouteTypes.RAIL,
          RouteTypes.BUS,
          RouteTypes.SUBWAY,
        ]),
      );
      assert.strictEqual(multiModeRoutes.size, 2);
    });

    it('should return earliest hop-on stop when route is accessible from multiple stops', () => {
      // Create scenario where same route is accessible from multiple stops in the query
      // route1 has stops [1, 2] in that order, so we need to test with those actual stops
      const fromStops = new Set([1, 2]); // Both stops are on route1
      const reachableRoutes = sampleTimetable.findReachableRoutes(fromStops);

      // route1 should use stop index 0 (stop 1 comes before stop 2 on route1)
      // route2 should use stop index 0 (stop 2 comes before stop 1 on route2)
      assert.strictEqual(reachableRoutes.size, 2);
      assert.deepStrictEqual(
        reachableRoutes,
        new Map([
          [route1, 0], // Stop index 0 (stop 1) comes before stop index 1 (stop 2) on route1
          [route2, 0], // Stop index 0 (stop 2) comes before stop index 1 (stop 1) on route2
        ]),
      );
    });

    describe('getContinuousTrips', () => {
      it('should return empty array when stop has no trip continuations', () => {
        const continuousTrips = sampleTimetable.getContinuousTrips(0, 0, 0);
        assert.deepStrictEqual(continuousTrips, []);
      });

      it('should return empty array when stop has trip continuations but not for the specified trip', () => {
        // Create a timetable with trip continuations that don't match the query
        const tripContinuationsMap = new Map([
          [encode(0, 0, 1), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]], // Different trip index
        ]);

        const stopsWithContinuations: StopAdjacency[] = [
          { routes: [] },
          {
            routes: [0, 1],
          },
          { routes: [1] },
        ];

        const timetableWithContinuations = new Timetable(
          stopsWithContinuations,
          routesAdjacency,
          routes,
          tripContinuationsMap,
        );

        const continuousTrips = timetableWithContinuations.getContinuousTrips(
          0,
          0,
          0,
        ); // Query trip index 0, but continuations are for trip index 1
        assert.deepStrictEqual(continuousTrips, []);
      });

      it('should return trip continuations when they exist for the specified trip', () => {
        const expectedContinuations: TripStop[] = [
          { stopIndex: 0, routeId: 1, tripIndex: 0 },
          { stopIndex: 0, routeId: 1, tripIndex: 1 },
        ];

        const tripContinuationsMap = new Map([
          [encode(0, 0, 0), expectedContinuations],
        ]);

        const stopsWithContinuations: StopAdjacency[] = [
          { routes: [] },
          {
            routes: [0, 1],
          },
          { routes: [1] },
        ];

        const timetableWithContinuations = new Timetable(
          stopsWithContinuations,
          routesAdjacency,
          routes,
          tripContinuationsMap,
        );

        const continuousTrips = timetableWithContinuations.getContinuousTrips(
          0,
          0,
          0,
        );
        assert.deepStrictEqual(continuousTrips, expectedContinuations);
      });

      it('should return empty array when querying with non-matching parameters', () => {
        const continuousTrips = sampleTimetable.getContinuousTrips(999, 0, 0);
        assert.deepStrictEqual(continuousTrips, []);
      });
    });

    describe('getGuaranteedTripTransfers', () => {
      it('should return empty array when stop has no guaranteed trip transfers', () => {
        const guaranteedTransfers = sampleTimetable.getGuaranteedTripTransfers(
          0,
          0,
          0,
        );
        assert.deepStrictEqual(guaranteedTransfers, []);
      });

      it('should return empty array when stop has guaranteed trip transfers but not for the specified trip', () => {
        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 1), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]], // Different trip index
        ]);

        const stopsWithGuaranteedTransfers: StopAdjacency[] = [
          { routes: [] },
          {
            routes: [0, 1],
          },
          { routes: [1] },
        ];

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsWithGuaranteedTransfers,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const guaranteedTransfers =
          timetableWithGuaranteedTransfers.getGuaranteedTripTransfers(0, 0, 0); // Query trip index 0, but transfers are for trip index 1
        assert.deepStrictEqual(guaranteedTransfers, []);
      });

      it('should return guaranteed trip transfers when they exist for the specified trip', () => {
        const expectedTransfers: TripStop[] = [
          { stopIndex: 0, routeId: 1, tripIndex: 0 },
          { stopIndex: 0, routeId: 1, tripIndex: 1 },
        ];

        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 0), expectedTransfers],
        ]);

        const stopsWithGuaranteedTransfers: StopAdjacency[] = [
          { routes: [] },
          {
            routes: [0, 1],
          },
          { routes: [1] },
        ];

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsWithGuaranteedTransfers,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const guaranteedTransfers =
          timetableWithGuaranteedTransfers.getGuaranteedTripTransfers(0, 0, 0);
        assert.deepStrictEqual(guaranteedTransfers, expectedTransfers);
      });

      it('should return empty array when querying with non-matching parameters', () => {
        const guaranteedTransfers = sampleTimetable.getGuaranteedTripTransfers(
          999,
          0,
          0,
        );
        assert.deepStrictEqual(guaranteedTransfers, []);
      });
    });
  });
});

describe('Timetable boarding', () => {
  const routes = [0, 1].map((id) =>
    Route.of({
      id,
      serviceRouteId: 0,
      trips: [0, 1, 2, 3].map((trip) => ({
        stops: [0, 1, 2].map((stop) => ({
          id: stop,
          arrivalTime: 100 + trip * 10 + stop,
          departureTime: 100 + trip * 10 + stop,
          pickUpType:
            stop === 1
              ? PickUpDropOffTypes.NOT_AVAILABLE
              : PickUpDropOffTypes.MUST_PHONE_AGENCY,
        })),
      })),
    }),
  );
  const route = routes[1];
  assert(route);
  /** Build the boarding fixture with an optional pair-specific transfer rule. */
  const makeTimetable = (
    type?: (typeof TransferTypes)[keyof typeof TransferTypes],
    minTransferTime?: number,
  ) =>
    new Timetable(
      [0, 1, 2].map(() => ({ routes: [0, 1] })),
      routes,
      [{ type: RouteTypes.BUS, name: 'Bus', routes: [0, 1] }],
      undefined,
      type === undefined
        ? undefined
        : new Map([
            [
              encode(1, 0, 0),
              [
                {
                  routeId: 1,
                  tripIndex: 0,
                  stopIndex: 0,
                  type,
                  minTransferTime,
                },
              ],
            ],
          ]),
    );
  /**
   * Identify the fixture feeder trip stop and its arrival time for boarding
   * resolution.
   */
  const feeder = (timetable: Timetable) => ({
    tripStopId: timetable.tripTransfers.tripStopId({
      routeId: 0,
      tripIndex: 0,
      stopIndex: 1,
    }),
    arrival: 95,
  });

  describe('findFirstOrdinaryBoarding', () => {
    const search = { genericReady: 100, fallbackTransferDuration: 9 };

    it('selects the earliest eligible trip and skips unavailable pickup', (t) => {
      const timetable = makeTimetable();
      t.mock.method(timetable.tripTransfers, 'tripStopId', () => {
        throw new Error('Unexpected trip stop lookup without a feeder');
      });
      assert.deepStrictEqual(
        timetable.findFirstOrdinaryBoarding(route, 0, search),
        { trip: 0, ready: 100, rule: undefined },
      );
      assert.deepStrictEqual(
        timetable.findFirstOrdinaryBoarding(route, 0, {
          ...search,
          genericReady: 101,
        }),
        { trip: 1, ready: 101, rule: undefined },
      );
    });

    it('excludes exceptional trips even when they are boardable', () => {
      const timetable = makeTimetable(TransferTypes.GUARANTEED);
      const exceptionalRoute = routes[0];
      assert(exceptionalRoute);
      assert(timetable.resolveBoarding(exceptionalRoute, 0, 0, 100, 100, 9));
      assert.deepStrictEqual(
        timetable.findFirstOrdinaryBoarding(exceptionalRoute, 0, search),
        { trip: 1, ready: 100, rule: undefined },
      );
    });

    it('honors exclusive trip bounds and returns undefined without a candidate', () => {
      const timetable = makeTimetable();
      for (const constraints of [
        { beforeTrip: 0 },
        { genericReady: 101, beforeTrip: 1 },
        { genericReady: 131 },
        { genericReady: Infinity },
      ]) {
        assert.strictEqual(
          timetable.findFirstOrdinaryBoarding(route, 0, {
            ...search,
            ...constraints,
          }),
          undefined,
        );
      }
      assert.strictEqual(
        timetable.findFirstOrdinaryBoarding(route, 0, {
          ...search,
          genericReady: 101,
          beforeTrip: 3,
        })?.trip,
        1,
      );
    });

    it('uses inclusive and exclusive departure bounds independently', () => {
      const timetable = makeTimetable();
      for (const [bounds, expectedTrip] of [
        [{ maxDeparture: 100 }, 0],
        [{ maxDeparture: 99 }, undefined],
        [{ beforeDeparture: 100 }, undefined],
        [{ beforeDeparture: 101 }, 0],
        [{ maxDeparture: 100, beforeDeparture: 100 }, undefined],
        [{ maxDeparture: 100, beforeDeparture: 101 }, 0],
        [{ maxDeparture: 99, beforeDeparture: 101 }, undefined],
      ] as const) {
        assert.strictEqual(
          timetable.findFirstOrdinaryBoarding(route, 0, {
            ...search,
            ...bounds,
          })?.trip,
          expectedTrip,
        );
      }
    });

    it('searches from feeder arrival and returns the resolved pair rule', () => {
      for (const type of [
        TransferTypes.GUARANTEED,
        TransferTypes.REQUIRES_MINIMAL_TIME,
      ]) {
        const timetable = makeTimetable(type, 5);
        const source = feeder(timetable);
        for (const genericReady of [120, Infinity]) {
          const result = timetable.findFirstOrdinaryBoarding(route, 0, {
            ...search,
            genericReady,
            source,
          });
          assert(result);
          assert.strictEqual(result.trip, 0);
          assert.strictEqual(
            result.ready,
            type === TransferTypes.GUARANTEED ? 95 : 100,
          );
          assert.strictEqual(result.rule?.type, type);
          assert.strictEqual(result.rule.source, source.tripStopId);
        }
      }
    });

    it('continues after an infeasible pair minimum and preserves generic readiness', () => {
      const timetable = makeTimetable(TransferTypes.REQUIRES_MINIMAL_TIME, 6);
      const source = feeder(timetable);
      assert.deepStrictEqual(
        timetable.findFirstOrdinaryBoarding(route, 0, { ...search, source }),
        { trip: 1, ready: 100, rule: undefined },
      );
      assert.strictEqual(
        timetable.findFirstOrdinaryBoarding(route, 0, {
          ...search,
          genericReady: Infinity,
          source,
        }),
        undefined,
      );
    });
  });

  it('uses generic readiness at the exact departure boundary without a feeder', (t) => {
    const timetable = makeTimetable();
    t.mock.method(timetable.tripTransfers, 'tripStopId', () => {
      throw new Error('Unexpected trip stop lookup');
    });
    t.mock.method(route, 'departureFrom', () => {
      throw new Error('Departure must be reused');
    });
    assert.deepStrictEqual(
      timetable.resolveBoarding(route, 0, 0, 100, 100, 9),
      { ready: 100, rule: undefined },
    );
    assert.strictEqual(
      timetable.resolveBoarding(route, 0, 0, 100, 101, 9),
      undefined,
    );
  });

  it('rejects unavailable pickup even with a matching guarantee', () => {
    const timetable = new Timetable(
      [0, 1, 2].map(() => ({ routes: [0, 1] })),
      routes,
      [],
      undefined,
      new Map([
        [encode(1, 0, 0), [{ routeId: 1, tripIndex: 1, stopIndex: 1 }]],
      ]),
    );
    assert.strictEqual(
      timetable.resolveBoarding(route, 1, 1, 111, 0, 0, feeder(timetable)),
      undefined,
    );
  });

  it('allows conditional public pickup', () => {
    const timetable = makeTimetable();
    assert.strictEqual(
      timetable.resolveBoarding(route, 0, 2, 120, 120, 9)?.ready,
      120,
    );
  });

  it('retains generic readiness when no pair rule exists', () => {
    const timetable = makeTimetable();
    assert.strictEqual(
      timetable.resolveBoarding(route, 0, 0, 100, 99, 20, feeder(timetable))
        ?.ready,
      99,
    );
    assert.strictEqual(
      timetable.resolveBoarding(
        route,
        0,
        0,
        100,
        Infinity,
        0,
        feeder(timetable),
      ),
      undefined,
    );
  });

  for (const [name, type, minimum, ready] of [
    ['guarantee', TransferTypes.GUARANTEED, undefined, 95],
    ['guarantee with explicit minimum', TransferTypes.GUARANTEED, 20, 95],
    ['explicit minimum', TransferTypes.REQUIRES_MINIMAL_TIME, 5, 100],
    ['explicit zero', TransferTypes.REQUIRES_MINIMAL_TIME, 0, 95],
    ['recommended fallback', TransferTypes.RECOMMENDED, undefined, 102],
    ['recommended minimum', TransferTypes.RECOMMENDED, 3, 98],
  ] as const) {
    it(`resolves ${name} from feeder arrival, including without a generic footpath`, () => {
      const timetable = makeTimetable(type, minimum);
      const source = feeder(timetable);
      const result = timetable.resolveBoarding(
        route,
        0,
        0,
        ready,
        Infinity,
        7,
        source,
      );
      assert(result);
      assert.strictEqual(result.ready, ready);
      assert.strictEqual(result.rule?.type, type);
      assert.strictEqual(result.rule.source, source.tripStopId);
      assert.strictEqual(
        result.rule.target,
        timetable.tripTransfers.tripStopId({
          routeId: 1,
          tripIndex: 0,
          stopIndex: 0,
        }),
      );
      assert.strictEqual(
        timetable.resolveBoarding(route, 0, 0, ready - 1, Infinity, 7, source),
        undefined,
      );
    });
  }

  it('matches the full feeder and target trip stops', () => {
    const timetable = makeTimetable(TransferTypes.GUARANTEED);
    const source = feeder(timetable);
    for (const target of [
      { routeId: 0, tripIndex: 0, stopIndex: 0 },
      { routeId: 1, tripIndex: 3, stopIndex: 0 },
      { routeId: 1, tripIndex: 0, stopIndex: 1 },
    ]) {
      const targetRoute = routes[target.routeId];
      assert(targetRoute);
      assert.strictEqual(
        timetable.resolveBoarding(
          targetRoute,
          target.stopIndex,
          target.tripIndex,
          100,
          101,
          0,
          source,
        ),
        undefined,
      );
    }
    for (const position of [
      { routeId: 1, tripIndex: 0, stopIndex: 1 },
      { routeId: 0, tripIndex: 1, stopIndex: 1 },
      { routeId: 0, tripIndex: 0, stopIndex: 0 },
    ]) {
      assert.strictEqual(
        timetable.resolveBoarding(route, 0, 0, 100, 101, 0, {
          arrival: 95,
          tripStopId: timetable.tripTransfers.tripStopId(position),
        }),
        undefined,
      );
    }
  });
});
