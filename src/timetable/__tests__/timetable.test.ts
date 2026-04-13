import assert from 'node:assert';
import { describe, it } from 'node:test';

import { NOT_AVAILABLE, Route } from '../route.js';
import { timeFromHMS } from '../time.js';
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
            pickUpType: NOT_AVAILABLE,
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

    describe('isTripTransferGuaranteed', () => {
      it('should return false when no guaranteed transfers exist', () => {
        const fromTripStop: TripStop = {
          stopIndex: 0,
          routeId: 0,
          tripIndex: 0,
        };
        const toTripStop: TripStop = { stopIndex: 0, routeId: 1, tripIndex: 0 };

        const result = sampleTimetable.isTripTransferGuaranteed(
          fromTripStop,
          toTripStop,
        );
        assert.strictEqual(result, false);
      });

      it('should return false when guaranteed transfers exist but not for the specified trip', () => {
        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 1), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]], // Transfers for trip index 1
        ]);

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsAdjacency,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const fromTripStop: TripStop = {
          stopIndex: 0,
          routeId: 0,
          tripIndex: 0,
        }; // Query trip index 0
        const toTripStop: TripStop = { stopIndex: 0, routeId: 1, tripIndex: 0 };

        const result =
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            toTripStop,
          );
        assert.strictEqual(result, false);
      });

      it('should return true when the transfer is guaranteed', () => {
        const guaranteedTransfer: TripStop = {
          stopIndex: 0,
          routeId: 1,
          tripIndex: 0,
        };
        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 0), [guaranteedTransfer]],
        ]);

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsAdjacency,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const fromTripStop: TripStop = {
          stopIndex: 0,
          routeId: 0,
          tripIndex: 0,
        };
        const toTripStop: TripStop = { stopIndex: 0, routeId: 1, tripIndex: 0 };

        const result =
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            toTripStop,
          );
        assert.strictEqual(result, true);
      });

      it('should return false when transfer destination does not match any guaranteed transfer', () => {
        const guaranteedTransfer: TripStop = {
          stopIndex: 0,
          routeId: 1,
          tripIndex: 0,
        };
        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 0), [guaranteedTransfer]],
        ]);

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsAdjacency,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const fromTripStop: TripStop = {
          stopIndex: 0,
          routeId: 0,
          tripIndex: 0,
        };
        const nonMatchingToTripStop: TripStop = {
          stopIndex: 1,
          routeId: 1,
          tripIndex: 0,
        }; // Different stopIndex

        const result =
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            nonMatchingToTripStop,
          );
        assert.strictEqual(result, false);
      });

      it('should return true when transfer matches one of multiple guaranteed transfers', () => {
        const guaranteedTransfers: TripStop[] = [
          { stopIndex: 0, routeId: 1, tripIndex: 0 },
          { stopIndex: 0, routeId: 1, tripIndex: 1 },
          { stopIndex: 1, routeId: 1, tripIndex: 0 },
        ];
        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 0), guaranteedTransfers],
        ]);

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsAdjacency,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const fromTripStop: TripStop = {
          stopIndex: 0,
          routeId: 0,
          tripIndex: 0,
        };

        // Test matching the second guaranteed transfer
        const toTripStop: TripStop = { stopIndex: 0, routeId: 1, tripIndex: 1 };
        const result =
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            toTripStop,
          );
        assert.strictEqual(result, true);

        // Test matching the third guaranteed transfer
        const toTripStop2: TripStop = {
          stopIndex: 1,
          routeId: 1,
          tripIndex: 0,
        };
        const result2 =
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            toTripStop2,
          );
        assert.strictEqual(result2, true);
      });

      it('should return false for invalid trip data (non-existent route)', () => {
        const guaranteedTransfer: TripStop = {
          stopIndex: 0,
          routeId: 1,
          tripIndex: 0,
        };
        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 0), [guaranteedTransfer]],
        ]);

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsAdjacency,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const fromTripStop: TripStop = {
          stopIndex: 0,
          routeId: 999,
          tripIndex: 0,
        }; // Non-existent route
        const toTripStop: TripStop = { stopIndex: 0, routeId: 1, tripIndex: 0 };

        const result =
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            toTripStop,
          );
        assert.strictEqual(result, false);
      });

      it('should correctly distinguish between different stopIndex values', () => {
        const guaranteedTransfer: TripStop = {
          stopIndex: 0,
          routeId: 1,
          tripIndex: 0,
        };
        const guaranteedTripTransfersMap = new Map([
          [encode(0, 0, 0), [guaranteedTransfer]],
        ]);

        const timetableWithGuaranteedTransfers = new Timetable(
          stopsAdjacency,
          routesAdjacency,
          routes,
          new Map(),
          guaranteedTripTransfersMap,
        );

        const fromTripStop: TripStop = {
          stopIndex: 0,
          routeId: 0,
          tripIndex: 0,
        };

        // Exact match should return true
        const exactMatch: TripStop = { stopIndex: 0, routeId: 1, tripIndex: 0 };
        assert.strictEqual(
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            exactMatch,
          ),
          true,
        );

        // Different stopIndex should return false
        const differentStopIndex: TripStop = {
          stopIndex: 1,
          routeId: 1,
          tripIndex: 0,
        };
        assert.strictEqual(
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            differentStopIndex,
          ),
          false,
        );

        // Different routeId should return false
        const differentRouteId: TripStop = {
          stopIndex: 0,
          routeId: 0,
          tripIndex: 0,
        };
        assert.strictEqual(
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            differentRouteId,
          ),
          false,
        );

        // Different tripIndex should return false
        const differentTripIndex: TripStop = {
          stopIndex: 0,
          routeId: 1,
          tripIndex: 1,
        };
        assert.strictEqual(
          timetableWithGuaranteedTransfers.isTripTransferGuaranteed(
            fromTripStop,
            differentTripIndex,
          ),
          false,
        );
      });
    });
  });
});
