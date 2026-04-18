import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Timetable } from '../../router.js';
import { Stop, StopId } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHMS, timeFromString } from '../../timetable/time.js';
import { ServiceRoute, StopAdjacency } from '../../timetable/timetable.js';
import { Query } from '../query.js';
import { Result } from '../result.js';
import {
  RoutingEdge,
  RoutingState,
  TransferEdge,
  UNREACHED_TIME,
  VehicleEdge,
} from '../router.js';

const NB_STOPS = 7;

/** Builds the earliestArrivalTimes / earliestArrivalLegs arrays from a list of [stopId, arrivalTime, legNumber] tuples. */
function makeArrivals(entries: [StopId, number, number][]): {
  earliestArrivalTimes: Uint16Array;
  earliestArrivalLegs: Uint8Array;
} {
  const earliestArrivalTimes = new Uint16Array(NB_STOPS).fill(UNREACHED_TIME);
  const earliestArrivalLegs = new Uint8Array(NB_STOPS);
  for (const [stopId, time, leg] of entries) {
    earliestArrivalTimes[stopId] = time;
    earliestArrivalLegs[stopId] = leg;
  }
  return { earliestArrivalTimes, earliestArrivalLegs };
}

/** Builds one round of the routing graph from a list of [stopId, edge] pairs. */
function makeRound(
  entries: [StopId, RoutingEdge][],
): (RoutingEdge | undefined)[] {
  const round = new Array<RoutingEdge | undefined>(NB_STOPS);
  for (const [stopId, edge] of entries) {
    round[stopId] = edge;
  }
  return round;
}

/**
 * Builds a RoutingState instance from test fixtures.
 * Replaces the old plain-object pattern now that RoutingState is a class.
 */
function makeRoutingState(
  origins: StopId[],
  destinations: StopId[],
  arrivals: [StopId, number, number][],
  graph: (RoutingEdge | undefined)[][],
): RoutingState {
  const state = new RoutingState(origins, destinations, 0, NB_STOPS);
  // Undo the constructor's initialization of origin arrivals so that stops
  // not explicitly listed in `arrivals` stay at UNREACHED_TIME.
  for (const origin of origins) {
    state.updateArrival(origin, UNREACHED_TIME, 0);
  }
  // Apply the test-specific arrivals.
  for (const [stopId, time, leg] of arrivals) {
    state.updateArrival(stopId, time, leg);
  }
  // Replace the graph entirely (splice mutates the array in-place, preserving
  // the readonly reference required by the RoutingState class).
  state.graph.splice(0, state.graph.length, ...graph);
  return state;
}

describe('Result', () => {
  const stop1: Stop = {
    id: 0,
    sourceStopId: 'stop1',
    name: 'Lausanne',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stop2: Stop = {
    id: 1,
    sourceStopId: 'stop2',
    name: 'Fribourg',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stop3: Stop = {
    id: 2,
    sourceStopId: 'stop3',
    name: 'Bern',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stop4: Stop = {
    id: 3,
    sourceStopId: 'stop4',
    name: 'Olten',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const parentStop: Stop = {
    id: 4,
    sourceStopId: 'parent',
    name: 'Basel',
    lat: 0,
    lon: 0,
    children: [5, 6],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const childStop1: Stop = {
    id: 5,
    sourceStopId: 'child1',
    name: 'Basel Pl. 1',
    lat: 0,
    lon: 0,
    children: [],
    parent: 4,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const childStop2: Stop = {
    id: 6,
    sourceStopId: 'child2',
    name: 'Basel Pl. 2',
    lat: 0,
    lon: 0,
    children: [],
    parent: 4,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stopsAdjacency: StopAdjacency[] = [
    { routes: [0] },
    { routes: [0] },
    { routes: [0, 1] },
    { routes: [1] },
    { routes: [1] },
    { routes: [1] },
    { routes: [1] },
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
              arrivalTime: timeFromString('08:00:00'),
              departureTime: timeFromString('08:05:00'),
            },
            {
              id: 1,
              arrivalTime: timeFromString('08:30:00'),
              departureTime: timeFromString('08:35:00'),
            },
            {
              id: 2,
              arrivalTime: timeFromString('09:00:00'),
              departureTime: timeFromString('09:05:00'),
            },
          ],
        },
      ],
    }),
    Route.of({
      id: 1,
      serviceRouteId: 1,
      trips: [
        {
          stops: [
            {
              id: 2,
              arrivalTime: timeFromString('09:10:00'),
              departureTime: timeFromString('09:15:00'),
            },
            {
              id: 3,
              arrivalTime: timeFromString('09:45:00'),
              departureTime: timeFromString('09:50:00'),
            },
            {
              id: 5,
              arrivalTime: timeFromString('10:10:00'),
              departureTime: timeFromString('10:15:00'),
            },
          ],
        },
      ],
    }),
  ];

  const routes: ServiceRoute[] = [
    {
      type: 'RAIL',
      name: 'Line 1',
      routes: [0],
    },
    {
      type: 'RAIL',
      name: 'Line 2',
      routes: [1],
    },
  ];

  const mockStopsIndex = new StopsIndex([
    stop1,
    stop2,
    stop3,
    stop4,
    parentStop,
    childStop1,
    childStop2,
  ]);
  const mockTimetable = new Timetable(stopsAdjacency, routesAdjacency, routes);

  const mockQuery = new Query.Builder()
    .from(0)
    .to(new Set([2, 3]))
    .departureTime(timeFromHMS(8, 0, 0))
    .build();

  describe('bestRoute', () => {
    it('should return undefined when no route exists', () => {
      const graph: (RoutingEdge | undefined)[][] = [];

      const result = new Result(
        mockQuery,
        makeRoutingState([], [2, 3], [], graph),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute();
      assert.strictEqual(route, undefined);
    });

    it('should return undefined for unreachable destination', () => {
      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState([0], [2, 3], [[1, timeFromHMS(8, 30, 0), 0]], graph),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(3); // stop4 not in earliestArrivals
      assert.strictEqual(route, undefined);
    });

    it('should return route to closest destination when multiple destinations exist', () => {
      const vehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([[2, vehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [2, 3],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
            [3, timeFromHMS(9, 30, 0), 1],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute();
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const firstLeg = route.legs[0];
      assert(firstLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 2);
    });

    it('should return route to fastest child stop when parent stop is queried', () => {
      const vehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(10, 10, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 1,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[2, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([
          [
            2,
            {
              arrival: timeFromHMS(9, 10, 0),
              stopIndex: 0,
              hopOffStopIndex: 2,
              routeId: 0,
              tripIndex: 0,
            },
          ],
        ]), // Round 1
        makeRound([[5, vehicleEdge]]), // Round 2
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [2],
          [4],
          [
            [2, timeFromHMS(9, 10, 0), 1],
            [5, timeFromHMS(10, 10, 0), 2],
            [6, timeFromHMS(10, 30, 0), 2],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(4);
      assert(route);
      assert.strictEqual(route.legs.length, 2);
      const lastLeg = route.legs[route.legs.length - 1];
      assert(lastLeg);
      assert.strictEqual(lastLeg.to.id, 5); // should route to faster child
    });

    it('should handle simple single-leg route reconstruction', () => {
      const vehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([[2, vehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [2],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(2);
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const firstLeg = route.legs[0];
      assert(firstLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 2);
    });

    it('should handle multi-leg route with transfer', () => {
      const firstVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const secondVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 45, 0),
        stopIndex: 0,
        hopOffStopIndex: 1,
        routeId: 1,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([[2, firstVehicleEdge]]), // Round 1
        makeRound([[3, secondVehicleEdge]]), // Round 2
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [3],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
            [3, timeFromHMS(9, 45, 0), 2],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(3);
      assert(route);
      assert.strictEqual(route.legs.length, 2); // two vehicle legs (transfer is implicit in route change)
      const firstLeg = route.legs[0];
      const secondLeg = route.legs[1];
      assert(firstLeg);
      assert(secondLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 2);
      assert.strictEqual(secondLeg.from.id, 2);
      assert.strictEqual(secondLeg.to.id, 3);
    });
  });

  describe('bestRouteToStopId', () => {
    it('should return route when given a single SourceStopId', () => {
      const vehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([[2, vehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [2],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRouteToSourceStopId('stop3'); // Using SourceStopId instead of StopId
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const firstLeg = route.legs[0];
      assert(firstLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 2);
    });

    it('should return route to closest destination when given a Set of SourceStopIds', () => {
      const vehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([[2, vehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [2, 3],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
            [3, timeFromHMS(9, 45, 0), 1],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRouteToSourceStopId(new Set(['stop3', 'stop4'])); // Using Set of SourceStopIds
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const firstLeg = route.legs[0];
      assert(firstLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 2); // Should route to stop 2 (faster arrival)
    });
  });

  describe('continuous trips', () => {
    it('should handle single continuous trip correctly', () => {
      const firstVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(8, 30, 0),
        stopIndex: 0,
        hopOffStopIndex: 1,
        routeId: 0,
        tripIndex: 0,
      };

      const continuousVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 1,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
        continuationOf: firstVehicleEdge,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([
          [1, firstVehicleEdge],
          [2, continuousVehicleEdge],
        ]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [2],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [1, timeFromHMS(8, 30, 0), 1],
            [2, timeFromHMS(9, 0, 0), 1],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(2);
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const leg = route.legs[0];
      assert(leg);
      assert.strictEqual(leg.from.id, 0);
      assert.strictEqual(leg.to.id, 2);
    });

    it('should handle continuous trips with route change mid-journey', () => {
      const firstVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const continuousVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 45, 0),
        stopIndex: 0,
        hopOffStopIndex: 1,
        routeId: 1,
        tripIndex: 0,
        continuationOf: firstVehicleEdge,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([[3, continuousVehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [3],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [3, timeFromHMS(9, 45, 0), 1],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(3);
      assert(route);
      assert.strictEqual(route.legs.length, 1);

      const leg = route.legs[0];
      assert(leg);
      assert.strictEqual(leg.from.id, 0);
      assert.strictEqual(leg.to.id, 3);
    });
    it('should handle route reconstruction with actual transfer edges', () => {
      const { earliestArrivalLegs } = makeArrivals([
        [0, timeFromHMS(8, 0, 0), 0], // origin
        [1, timeFromHMS(8, 30, 0), 1], // first vehicle leg destination
        [2, timeFromHMS(8, 35, 0), 1], // after transfer (same round as transfer doesn't advance round)
        [3, timeFromHMS(9, 15, 0), 2], // final destination
      ]);

      const firstVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(8, 30, 0),
        stopIndex: 0,
        hopOffStopIndex: 1,
        routeId: 0,
        tripIndex: 0,
      };
      const transferEdge: TransferEdge = {
        arrival: timeFromHMS(8, 35, 0),
        from: 1,
        to: 2,
        type: 'RECOMMENDED',
        minTransferTime: 5,
      };
      const secondVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 15, 0),
        stopIndex: 0,
        hopOffStopIndex: 1,
        routeId: 1,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([
          [1, firstVehicleEdge],
          [2, transferEdge],
        ]), // Round 1
        makeRound([[3, secondVehicleEdge]]), // Round 2 - second vehicle leg
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [0],
          [3],
          [
            [0, timeFromHMS(8, 0, 0), 0],
            [1, timeFromHMS(8, 30, 0), 1],
            [2, timeFromHMS(8, 35, 0), 1],
            [3, timeFromHMS(9, 15, 0), 2],
          ],
          graph,
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(3);
      assert(route);

      assert.strictEqual(
        route.legs.length,
        3,
        'Route should have vehicle + transfer + vehicle legs',
      );

      const firstLeg = route.legs[0];
      const transferLeg = route.legs[1];
      const thirdLeg = route.legs[2];

      assert(firstLeg);
      assert(transferLeg);
      assert(thirdLeg);

      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 1);
      assert('departureTime' in firstLeg);
      assert('route' in firstLeg);

      assert.strictEqual(transferLeg.from.id, 1);
      assert.strictEqual(transferLeg.to.id, 2);
      assert('type' in transferLeg);
      assert('minTransferTime' in transferLeg);
      assert.strictEqual(transferLeg.type, 'RECOMMENDED');

      assert.strictEqual(thirdLeg.from.id, 2);
      assert.strictEqual(thirdLeg.to.id, 3);
      assert('departureTime' in thirdLeg);
      assert('route' in thirdLeg);

      assert.strictEqual(earliestArrivalLegs[1], 1);
      assert.strictEqual(earliestArrivalLegs[2], 1);
      assert.strictEqual(earliestArrivalLegs[3], 2);
    });
  });

  describe('arrivalAt', () => {
    it('should return arrival time for a reachable stop', () => {
      const arrivalTime = {
        arrival: timeFromHMS(9, 0, 0),
        legNumber: 1,
      };

      const result = new Result(
        mockQuery,
        makeRoutingState([], [2], [[2, timeFromHMS(9, 0, 0), 1]], []),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(2);
      assert.deepStrictEqual(arrival, arrivalTime);
    });

    it('should return undefined for unreachable stop', () => {
      const result = new Result(
        mockQuery,
        makeRoutingState([], [2], [[2, timeFromHMS(9, 0, 0), 1]], []),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(3);
      assert.strictEqual(arrival, undefined);
    });

    it('should return earliest arrival among equivalent stops', () => {
      const earlierArrival = {
        arrival: timeFromHMS(9, 0, 0),
        legNumber: 1,
      };

      const result = new Result(
        mockQuery,
        makeRoutingState(
          [],
          [4],
          [
            [5, timeFromHMS(9, 0, 0), 1],
            [6, timeFromHMS(9, 30, 0), 1],
          ],
          [],
        ),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(4);
      assert.deepStrictEqual(arrival, earlierArrival);
    });

    it('should respect maxTransfers constraint', () => {
      const directArrival = {
        arrival: timeFromHMS(9, 30, 0),
        legNumber: 1,
      };
      const transferArrival = {
        arrival: timeFromHMS(9, 0, 0),
        legNumber: 2,
      };

      const vehicleEdge1: VehicleEdge = {
        arrival: timeFromHMS(9, 30, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const vehicleEdge2: VehicleEdge = {
        arrival: timeFromHMS(9, 45, 0),
        stopIndex: 0,
        hopOffStopIndex: 1,
        routeId: 1,
        tripIndex: 0,
      };

      const graph = [
        makeRound([[0, { arrival: timeFromHMS(8, 0, 0) }]]), // Round 0 - origins
        makeRound([[2, vehicleEdge1]]), // Round 1 - direct route (no transfers)
        makeRound([[2, vehicleEdge2]]), // Round 2 - route with 1 transfer
      ];

      const result = new Result(
        mockQuery,
        makeRoutingState([0], [2], [[2, timeFromHMS(9, 0, 0), 2]], graph),
        mockStopsIndex,
        mockTimetable,
      );

      const arrivalWithLimit = result.arrivalAt(2, 0);
      assert.deepStrictEqual(arrivalWithLimit, directArrival);

      const arrivalWithoutLimit = result.arrivalAt(2);
      assert.deepStrictEqual(arrivalWithoutLimit, transferArrival);
    });

    it('should handle non-existent stops', () => {
      const result = new Result(
        mockQuery,
        makeRoutingState([], [2], [[2, timeFromHMS(9, 0, 0), 1]], []),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(324);
      assert.strictEqual(arrival, undefined);
    });
  });
});
