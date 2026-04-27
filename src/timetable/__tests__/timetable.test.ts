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
  TripTransfers,
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

    describe('findFirstBoardableTrip', () => {
      const BOARDING_STOP_INDEX = 0;
      const FFBT_ROUTE_ID = 2;

      const ffbtRoute = Route.of({
        id: FFBT_ROUTE_ID,
        serviceRouteId: 2,
        trips: [
          {
            stops: [
              {
                id: 0,
                arrivalTime: timeFromHMS(8, 0, 0),
                departureTime: timeFromHMS(8, 0, 0),
              },
              {
                id: 1,
                arrivalTime: timeFromHMS(8, 30, 0),
                departureTime: timeFromHMS(8, 30, 0),
              },
            ],
          },
          {
            stops: [
              {
                id: 0,
                arrivalTime: timeFromHMS(9, 0, 0),
                departureTime: timeFromHMS(9, 0, 0),
                pickUpType: NOT_AVAILABLE,
              },
              {
                id: 1,
                arrivalTime: timeFromHMS(9, 30, 0),
                departureTime: timeFromHMS(9, 30, 0),
              },
            ],
          },
          {
            stops: [
              {
                id: 0,
                arrivalTime: timeFromHMS(10, 0, 0),
                departureTime: timeFromHMS(10, 0, 0),
              },
              {
                id: 1,
                arrivalTime: timeFromHMS(10, 30, 0),
                departureTime: timeFromHMS(10, 30, 0),
              },
            ],
          },
          {
            stops: [
              {
                id: 0,
                arrivalTime: timeFromHMS(11, 0, 0),
                departureTime: timeFromHMS(11, 0, 0),
              },
              {
                id: 1,
                arrivalTime: timeFromHMS(11, 30, 0),
                departureTime: timeFromHMS(11, 30, 0),
              },
            ],
          },
        ],
      });

      const ffbtStopsAdjacency: StopAdjacency[] = [
        { routes: [FFBT_ROUTE_ID] },
        { routes: [FFBT_ROUTE_ID] },
      ];

      const ffbtServiceRoutes = [
        { type: 'BUS' as const, name: 'Route 2', routes: [FFBT_ROUTE_ID] },
      ];

      const ffbtTimetable = new Timetable(
        ffbtStopsAdjacency,
        [ffbtRoute],
        ffbtServiceRoutes,
      );

      describe('without fromTripStop', () => {
        it('returns the first trip with an available pickup', () => {
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
          );
          assert.strictEqual(result, 0);
        });

        it('skips trips with NOT_AVAILABLE pickup', () => {
          // Start scanning from trip 1 (NOT_AVAILABLE) → must return trip 2.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            1,
          );
          assert.strictEqual(result, 2);
        });

        it('starts scanning at earliestTrip', () => {
          // Even though trip 0 is valid, scanning starts at trip 2.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            2,
          );
          assert.strictEqual(result, 2);
        });

        it('respects the beforeTrip exclusive upper bound', () => {
          // beforeTrip=1 means only trip 0 is in scope.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            0,
            1,
          );
          assert.strictEqual(result, 0);
        });

        it('returns undefined when the only trip in range has a NOT_AVAILABLE pickup', () => {
          // [1, 2) contains only trip 1, which is NOT_AVAILABLE.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            1,
            0,
            2,
          );
          assert.strictEqual(result, undefined);
        });

        it('returns undefined when earliestTrip is past all trips', () => {
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            99,
          );
          assert.strictEqual(result, undefined);
        });

        it('returns undefined when beforeTrip equals earliestTrip (empty range)', () => {
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            2,
            0,
            2,
          );
          assert.strictEqual(result, undefined);
        });
      });

      describe('with fromTripStop', () => {
        const fromTripStop: TripStop = {
          routeId: 99,
          stopIndex: 0,
          tripIndex: 0,
        };

        it('returns the first trip whose departure satisfies after + transferTime', () => {
          // after=09:30, transferTime=30 → requiredTime=10:00.
          // trip 0 (08:00) < 10:00 → skip.
          // trip 1 (09:00) NOT_AVAILABLE → skip.
          // trip 2 (10:00) ≥ 10:00 → returned.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            timeFromHMS(9, 30, 0),
            undefined,
            fromTripStop,
            30,
          );
          assert.strictEqual(result, 2);
        });

        it('treats departure exactly equal to after as satisfying (transferTime=0)', () => {
          // after=10:00, transferTime=0 → requiredTime=10:00.
          // trip 0 (08:00) < 10:00 → skip.
          // trip 1 (09:00) NOT_AVAILABLE → skip.
          // trip 2 (10:00) ≥ 10:00 → returned.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            timeFromHMS(10, 0, 0),
            undefined,
            fromTripStop,
            0,
          );
          assert.strictEqual(result, 2);
        });

        it('returns undefined when all trips depart before after + transferTime', () => {
          // after=11:00, transferTime=30 → requiredTime=11:30.
          // trip 3 (11:00) < 11:30 → skip. No further trips.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            timeFromHMS(11, 0, 0),
            undefined,
            fromTripStop,
            30,
          );
          assert.strictEqual(result, undefined);
        });

        it('returns undefined when beforeTrip excludes all trips that would satisfy the requirement', () => {
          // Only trips 0 and 1 are in scope (beforeTrip=2).
          // after=09:00, transferTime=30 → requiredTime=09:30.
          // trip 0 (08:00) < 09:30 → skip.
          // trip 1 (09:00) NOT_AVAILABLE → skip.
          // beforeTrip reached → undefined.
          const result = ffbtTimetable.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            timeFromHMS(9, 0, 0),
            2,
            fromTripStop,
            30,
          );
          assert.strictEqual(result, undefined);
        });
      });

      describe('guaranteed connection', () => {
        it('bypasses the after + transferTime departure check', () => {
          const fromTripStop: TripStop = {
            routeId: 99,
            stopIndex: 0,
            tripIndex: 0,
          };
          const guaranteedTransfers: TripTransfers = new Map([
            [
              encode(
                fromTripStop.stopIndex,
                fromTripStop.routeId,
                fromTripStop.tripIndex,
              ),
              [
                {
                  stopIndex: BOARDING_STOP_INDEX,
                  routeId: FFBT_ROUTE_ID,
                  tripIndex: 0,
                },
              ],
            ],
          ]);
          const timetableWithGuarantee = new Timetable(
            ffbtStopsAdjacency,
            [ffbtRoute],
            ffbtServiceRoutes,
            new Map(),
            guaranteedTransfers,
          );

          // after=07:00, transferTime=120 → requiredTime=09:00; trip 0 (08:00) is below
          // that threshold but the guarantee returns it immediately.
          const result = timetableWithGuarantee.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            timeFromHMS(7, 0, 0),
            undefined,
            fromTripStop,
            120,
          );
          assert.strictEqual(result, 0);
        });

        it('does not bypass a NOT_AVAILABLE pickup', () => {
          const fromTripStop: TripStop = {
            routeId: 99,
            stopIndex: 0,
            tripIndex: 0,
          };
          const guaranteedTransfers: TripTransfers = new Map([
            [
              encode(
                fromTripStop.stopIndex,
                fromTripStop.routeId,
                fromTripStop.tripIndex,
              ),
              [
                {
                  stopIndex: BOARDING_STOP_INDEX,
                  routeId: FFBT_ROUTE_ID,
                  tripIndex: 1,
                },
              ],
            ],
          ]);
          const timetableWithGuarantee = new Timetable(
            ffbtStopsAdjacency,
            [ffbtRoute],
            ffbtServiceRoutes,
            new Map(),
            guaranteedTransfers,
          );

          // after=08:30, transferTime=60 → requiredTime=09:30.
          // trip 0 (08:00): not guaranteed for trip 0, 08:00 < 09:30 → skip.
          // trip 1 (09:00): NOT_AVAILABLE → skip (guarantee is irrelevant).
          // trip 2 (10:00): no guarantee, but 10:00 ≥ 09:30 → first boardable.
          const result = timetableWithGuarantee.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            timeFromHMS(8, 30, 0),
            undefined,
            fromTripStop,
            60,
          );
          assert.strictEqual(result, 2);
        });

        it('applies only to its declared target trip index', () => {
          const fromTripStop: TripStop = {
            routeId: 99,
            stopIndex: 0,
            tripIndex: 0,
          };
          const guaranteedTransfers: TripTransfers = new Map([
            [
              encode(
                fromTripStop.stopIndex,
                fromTripStop.routeId,
                fromTripStop.tripIndex,
              ),
              [
                {
                  stopIndex: BOARDING_STOP_INDEX,
                  routeId: FFBT_ROUTE_ID,
                  tripIndex: 2,
                },
              ],
            ],
          ]);
          const timetableWithGuarantee = new Timetable(
            ffbtStopsAdjacency,
            [ffbtRoute],
            ffbtServiceRoutes,
            new Map(),
            guaranteedTransfers,
          );

          // after=09:30, transferTime=120 → requiredTime=11:30.
          // trip 0 (08:00): not guaranteed, 08:00 < 11:30 → skip.
          // trip 1 (09:00): NOT_AVAILABLE → skip.
          // trip 2 (10:00): guaranteed → returned immediately despite 10:00 < 11:30.
          const result = timetableWithGuarantee.findFirstBoardableTrip(
            BOARDING_STOP_INDEX,
            ffbtRoute,
            0,
            timeFromHMS(9, 30, 0),
            undefined,
            fromTripStop,
            120,
          );
          assert.strictEqual(result, 2);
        });
      });
    });
  });
});
