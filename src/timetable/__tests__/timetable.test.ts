import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Duration } from '../duration.js';
import { NOT_AVAILABLE, Route } from '../route.js';
import { Time } from '../time.js';
import {
  RouteType,
  ServiceRoute,
  StopAdjacency,
  Timetable,
  TripStop,
} from '../timetable.js';
import { encode } from '../tripStopId.js';

describe('Timetable', () => {
  const stopsAdjacency: StopAdjacency[] = [
    { routes: [] },
    {
      transfers: [{ destination: 2, type: 'RECOMMENDED' }],
      routes: [0, 1],
    },
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
            arrivalTime: Time.fromHMS(16, 40, 0),
            departureTime: Time.fromHMS(16, 50, 0),
          },
          {
            id: 2,
            arrivalTime: Time.fromHMS(17, 20, 0),
            departureTime: Time.fromHMS(17, 30, 0),
            pickUpType: NOT_AVAILABLE,
          },
        ],
      },
      {
        stops: [
          {
            id: 1,
            arrivalTime: Time.fromHMS(18, 0, 0),
            departureTime: Time.fromHMS(18, 10, 0),
          },
          {
            id: 2,
            arrivalTime: Time.fromHMS(19, 0, 0),
            departureTime: Time.fromHMS(19, 10, 0),
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
            arrivalTime: Time.fromHMS(18, 20, 0),
            departureTime: Time.fromHMS(18, 30, 0),
          },
          {
            id: 1,
            arrivalTime: Time.fromHMS(19, 0, 0),
            departureTime: Time.fromHMS(19, 10, 0),
          },
        ],
      },
    ],
  });
  const routesAdjacency = [route1, route2];
  const routes: ServiceRoute[] = [
    { type: 'RAIL', name: 'Route 1', routes: [0] },
    { type: 'RAIL', name: 'Route 2', routes: [1] },
  ];

  const sampleTimetable: Timetable = new Timetable(
    stopsAdjacency,
    routesAdjacency,
    routes,
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
    const afterTime = Time.fromHMS(17, 0, 0);
    const tripIndex = route.findEarliestTrip(0, afterTime);
    assert.strictEqual(tripIndex, 1);
  });

  it('should return undefined if no valid trip exists after a specific time', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const afterTime = Time.fromHMS(23, 40, 0);
    const tripIndex = route.findEarliestTrip(0, afterTime);
    assert.strictEqual(tripIndex, undefined);
  });
  it('should return undefined if the stop on a trip has pick up not available', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const route = sampleTimetable.getRoute(0)!;
    const tripIndex = route.findEarliestTrip(1);
    assert.strictEqual(tripIndex, 1);
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
        new Set<RouteType>(['RAIL']),
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
        new Set<RouteType>(['BUS']),
      );
      assert.strictEqual(busRoutes.size, 0);
      assert.deepStrictEqual(busRoutes, new Map());

      const multiModeRoutes = sampleTimetable.findReachableRoutes(
        fromStops,
        new Set<RouteType>(['RAIL', 'BUS', 'SUBWAY']),
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
          [encode(0, 0, 1), [{ hopOnStopIndex: 0, routeId: 1, tripIndex: 0 }]], // Different trip index
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
  });
});
