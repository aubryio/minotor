import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Timetable } from '../../router.js';
import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHMS, timeFromString } from '../../timetable/time.js';
import {
  RouteTypes,
  ServiceRoute,
  StopAdjacency,
  TransferTypes,
} from '../../timetable/timetable.js';
import { Result } from '../result.js';
import { RoutingState, TransferEdge, VehicleEdge } from '../router.js';

const NB_STOPS = 7;

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
    { type: RouteTypes.RAIL, name: 'Line 1', routes: [0] },
    { type: RouteTypes.RAIL, name: 'Line 2', routes: [1] },
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

  describe('arrivals', () => {
    it('yields reached stops including origins', () => {
      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          arrivals: [
            [0, 480, 0],
            [2, 510, 1],
            [5, 540, 2],
          ],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const expected = [
        { stop: 0, arrival: 480, legNumber: 0 },
        { stop: 2, arrival: 510, legNumber: 1 },
        { stop: 5, arrival: 540, legNumber: 2 },
      ];
      assert.deepStrictEqual([...result.arrivals()], expected);
      assert.deepStrictEqual([...result.arrivals()], expected);
    });

    it('yields nothing when no stops were reached', () => {
      const result = new Result(
        RoutingState.fromTestData({ nbStops: NB_STOPS }),
        mockStopsIndex,
        mockTimetable,
      );

      assert.deepStrictEqual([...result.arrivals()], []);
    });
  });

  describe('bestRoute', () => {
    it('should return undefined when no route exists', () => {
      const result = new Result(
        RoutingState.fromTestData({ nbStops: NB_STOPS, destinations: [2, 3] }),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute();
      assert.strictEqual(route, undefined);
    });

    it('should return undefined for unreachable destination', () => {
      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [2, 3],
          arrivals: [[1, timeFromHMS(8, 30, 0), 0]],
          graph: [[[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]]],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(3); // stop 3 not in arrivals
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

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [2, 3],
          arrivals: [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
            [3, timeFromHMS(9, 30, 0), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [[2, vehicleEdge]], // round 1
          ],
        }),
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

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [2],
          destinations: [4],
          arrivals: [
            [2, timeFromHMS(9, 10, 0), 1],
            [5, timeFromHMS(10, 10, 0), 2],
            [6, timeFromHMS(10, 30, 0), 2],
          ],
          graph: [
            [[2, { stopId: 2, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [
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
            ], // round 1
            [[5, vehicleEdge]], // round 2
          ],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(4);
      assert(route);
      assert.strictEqual(route.legs.length, 2);
      const lastLeg = route.legs[route.legs.length - 1];
      assert(lastLeg);
      assert.strictEqual(lastLeg.to.id, 5); // faster child
    });

    it('should handle simple single-leg route reconstruction', () => {
      const vehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 0, 0),
        stopIndex: 0,
        hopOffStopIndex: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [2],
          arrivals: [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [[2, vehicleEdge]], // round 1
          ],
        }),
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

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [3],
          arrivals: [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
            [3, timeFromHMS(9, 45, 0), 2],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [[2, firstVehicleEdge]], // round 1
            [[3, secondVehicleEdge]], // round 2
          ],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute(3);
      assert(route);
      assert.strictEqual(route.legs.length, 2);
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

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [2],
          arrivals: [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [[2, vehicleEdge]], // round 1
          ],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRouteToSourceStopId('stop3');
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

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [2, 3],
          arrivals: [
            [0, timeFromHMS(8, 0, 0), 0],
            [2, timeFromHMS(9, 0, 0), 1],
            [3, timeFromHMS(9, 45, 0), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [[2, vehicleEdge]], // round 1
          ],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRouteToSourceStopId(new Set(['stop3', 'stop4']));
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const firstLeg = route.legs[0];
      assert(firstLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 2); // stop 2 arrives faster
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

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [2],
          arrivals: [
            [0, timeFromHMS(8, 0, 0), 0],
            [1, timeFromHMS(8, 30, 0), 1],
            [2, timeFromHMS(9, 0, 0), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [
              [1, firstVehicleEdge],
              [2, continuousVehicleEdge],
            ], // round 1
          ],
        }),
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

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [3],
          arrivals: [
            [0, timeFromHMS(8, 0, 0), 0],
            [3, timeFromHMS(9, 45, 0), 1],
          ],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [[3, continuousVehicleEdge]], // round 1
          ],
        }),
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
        type: TransferTypes.RECOMMENDED,
        minTransferTime: 5,
      };
      const secondVehicleEdge: VehicleEdge = {
        arrival: timeFromHMS(9, 15, 0),
        stopIndex: 0,
        hopOffStopIndex: 1,
        routeId: 1,
        tripIndex: 0,
      };

      const state = RoutingState.fromTestData({
        nbStops: NB_STOPS,
        origins: [0],
        destinations: [3],
        arrivals: [
          [0, timeFromHMS(8, 0, 0), 0],
          [1, timeFromHMS(8, 30, 0), 1],
          [2, timeFromHMS(8, 35, 0), 1],
          [3, timeFromHMS(9, 15, 0), 2],
        ],
        graph: [
          [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
          [
            [1, firstVehicleEdge],
            [2, transferEdge],
          ], // round 1
          [[3, secondVehicleEdge]], // round 2
        ],
      });

      const result = new Result(state, mockStopsIndex, mockTimetable);
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
      assert.strictEqual(transferLeg.type, TransferTypes.RECOMMENDED);

      assert.strictEqual(thirdLeg.from.id, 2);
      assert.strictEqual(thirdLeg.to.id, 3);
      assert('departureTime' in thirdLeg);
      assert('route' in thirdLeg);

      // Verify the routing state recorded the correct leg numbers.
      assert.strictEqual(state.getArrival(1)?.legNumber, 1);
      assert.strictEqual(state.getArrival(2)?.legNumber, 1);
      assert.strictEqual(state.getArrival(3)?.legNumber, 2);
    });
  });

  describe('arrivalAt', () => {
    it('should return arrival time for a reachable stop', () => {
      const arrivalTime = { arrival: timeFromHMS(9, 0, 0), legNumber: 1 };

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          destinations: [2],
          arrivals: [[2, timeFromHMS(9, 0, 0), 1]],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(2);
      assert.deepStrictEqual(arrival, arrivalTime);
    });

    it('should return undefined for unreachable stop', () => {
      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          destinations: [2],
          arrivals: [[2, timeFromHMS(9, 0, 0), 1]],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(3);
      assert.strictEqual(arrival, undefined);
    });

    it('should return earliest arrival among equivalent stops', () => {
      const earlierArrival = { arrival: timeFromHMS(9, 0, 0), legNumber: 1 };

      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          destinations: [4],
          arrivals: [
            [5, timeFromHMS(9, 0, 0), 1], // child1 – faster
            [6, timeFromHMS(9, 30, 0), 1], // child2 – slower
          ],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(4);
      assert.deepStrictEqual(arrival, earlierArrival);
    });

    it('should handle non-existent stops', () => {
      const result = new Result(
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          destinations: [2],
          arrivals: [[2, timeFromHMS(9, 0, 0), 1]],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt(324);
      assert.strictEqual(arrival, undefined);
    });
  });

  describe('with transfer limits', () => {
    const ORIGIN = 0;
    const INTERCHANGE = 1;
    const DESTINATION = 2;
    const TRANSFER_ONLY = 3;
    const WALK_ONLY = 4;
    const UNREACHABLE = 5;
    const DESTINATION_STATION = 6;
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
        parent: DESTINATION_STATION,
      },
      {
        id: TRANSFER_ONLY,
        sourceStopId: 'stop3',
        name: 'Transfer-only destination',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
      },
      {
        id: WALK_ONLY,
        sourceStopId: 'stop4',
        name: 'Walk-only destination',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
      },
      {
        id: UNREACHABLE,
        sourceStopId: 'stop5',
        name: 'Unreachable stop',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
      },
      {
        id: DESTINATION_STATION,
        sourceStopId: 'stop6',
        name: 'Destination station',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [DESTINATION],
      },
    ];
    const stopsIndex = new StopsIndex(stops);

    const departureTime = timeFromHMS(8, 0, 0);
    const directArrival = timeFromHMS(9, 10, 0);
    const viaArrival = timeFromHMS(8, 40, 0);
    const timetable = new Timetable(
      [
        { routes: [DIRECT, TO_INTERCHANGE] }, // Origin
        { routes: [TO_INTERCHANGE, FROM_INTERCHANGE, TO_TRANSFER_ONLY] }, // Interchange
        { routes: [DIRECT, FROM_INTERCHANGE] }, // Destination
        { routes: [TO_TRANSFER_ONLY] }, // Transfer-only destination
        { routes: [] }, // Walk-only destination
        { routes: [] }, // Unreachable stop
        { routes: [] }, // Destination station
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
                  arrivalTime: departureTime,
                  departureTime: departureTime,
                },
                {
                  id: DESTINATION,
                  arrivalTime: directArrival,
                  departureTime: directArrival,
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
                  arrivalTime: departureTime,
                  departureTime: departureTime,
                },
                {
                  id: INTERCHANGE,
                  arrivalTime: departureTime + 5,
                  departureTime: departureTime + 5,
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
                  arrivalTime: departureTime + 7,
                  departureTime: departureTime + 7,
                },
                {
                  id: DESTINATION,
                  arrivalTime: viaArrival,
                  departureTime: viaArrival,
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
                  arrivalTime: departureTime + 7,
                  departureTime: departureTime + 7,
                },
                {
                  id: TRANSFER_ONLY,
                  arrivalTime: viaArrival,
                  departureTime: viaArrival,
                },
              ],
            },
          ],
        }),
      ],
      [
        { type: RouteTypes.BUS, name: 'Line 0', routes: [DIRECT] },
        { type: RouteTypes.BUS, name: 'Line 1', routes: [TO_INTERCHANGE] },
        { type: RouteTypes.BUS, name: 'Line 2', routes: [FROM_INTERCHANGE] },
        { type: RouteTypes.BUS, name: 'Line 3', routes: [TO_TRANSFER_ONLY] },
      ],
    );
    const result = new Result(
      RoutingState.fromTestData({
        nbStops: stops.length,
        origins: [ORIGIN],
        destinations: [DESTINATION],
        arrivals: [
          [ORIGIN, departureTime, 0],
          [INTERCHANGE, departureTime + 5, 1],
          [DESTINATION, viaArrival, 2],
          [TRANSFER_ONLY, viaArrival, 2],
          [WALK_ONLY, departureTime + 2, 0],
        ],
        graph: [
          [
            [ORIGIN, { stopId: ORIGIN, arrival: departureTime }],
            [
              WALK_ONLY,
              {
                from: ORIGIN,
                to: WALK_ONLY,
                duration: 2,
                arrival: departureTime + 2,
              },
            ],
          ],
          [
            [
              INTERCHANGE,
              {
                routeId: TO_INTERCHANGE,
                arrival: departureTime + 5,
                tripIndex: 0,
                stopIndex: 0,
                hopOffStopIndex: 1,
              },
            ],
            [
              DESTINATION,
              {
                routeId: DIRECT,
                arrival: directArrival,
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
                arrival: viaArrival,
                tripIndex: 0,
                stopIndex: 0,
                hopOffStopIndex: 1,
              },
            ],
            [
              TRANSFER_ONLY,
              {
                routeId: TO_TRANSFER_ONLY,
                arrival: viaArrival,
                tripIndex: 0,
                stopIndex: 0,
                hopOffStopIndex: 1,
              },
            ],
          ],
        ],
      }),
      stopsIndex,
      timetable,
    );
    describe('arrivals', () => {
      it('should retain direct and access journeys with zero transfers', () => {
        assert.deepStrictEqual(
          [...result.arrivals(0)],
          [
            { stop: ORIGIN, arrival: departureTime, legNumber: 0 },
            { stop: INTERCHANGE, arrival: departureTime + 5, legNumber: 1 },
            { stop: DESTINATION, arrival: directArrival, legNumber: 1 },
            { stop: WALK_ONLY, arrival: departureTime + 2, legNumber: 0 },
          ],
        );
      });
    });

    describe('arrivalAt', () => {
      it('should select a slower direct arrival at an equivalent stop', () => {
        assert.deepStrictEqual(result.arrivalAt(DESTINATION_STATION, 0), {
          arrival: directArrival,
          legNumber: 1,
        });
        assert.deepStrictEqual(result.arrivalAt(DESTINATION_STATION, 1), {
          arrival: viaArrival,
          legNumber: 2,
        });
        assert.deepStrictEqual(result.arrivalAt(DESTINATION_STATION), {
          arrival: viaArrival,
          legNumber: 2,
        });
        assert.deepStrictEqual(result.arrivalAt(DESTINATION_STATION, 100), {
          arrival: viaArrival,
          legNumber: 2,
        });
        assert.strictEqual(result.arrivalAt(TRANSFER_ONLY, 0), undefined);
      });
    });

    describe('bestRoute', () => {
      for (const [name, target] of [
        ['default destinations', undefined],
        ['a stop', DESTINATION],
        ['an equivalent stop', DESTINATION_STATION],
        ['a stop set', new Set([TRANSFER_ONLY, DESTINATION_STATION])],
      ] as const) {
        it(`should apply transfer limits to ${name}`, () => {
          const route = result.bestRoute(target, 0);
          assert(route);
          assert.strictEqual(route.arrivalTime(), directArrival);
          assert.strictEqual(
            route.legs.filter((leg) => 'route' in leg).length,
            1,
          );
          assert.strictEqual(
            result.bestRoute(target, 1)?.arrivalTime(),
            viaArrival,
          );
        });
      }

      it('should return undefined when a destination requires a transfer', () => {
        assert.strictEqual(result.bestRoute(TRANSFER_ONLY, 0), undefined);
      });

      it('should reconstruct an access-only journey with zero transfers', () => {
        const route = result.bestRoute(WALK_ONLY, 0);
        assert(route);
        assert.deepStrictEqual(route.legs, [
          { from: stops[ORIGIN], to: stops[WALK_ONLY], duration: 2 },
        ]);
      });
    });

    describe('bestRouteToSourceStopId', () => {
      it('should apply transfer limits to source IDs and equivalent stops', () => {
        assert.strictEqual(
          result
            .bestRouteToSourceStopId(`stop${DESTINATION_STATION}`, 0)
            ?.arrivalTime(),
          directArrival,
        );
        assert.strictEqual(
          result
            .bestRouteToSourceStopId(
              new Set([`stop${TRANSFER_ONLY}`, `stop${DESTINATION_STATION}`]),
              0,
            )
            ?.arrivalTime(),
          directArrival,
        );
        assert.strictEqual(
          result.bestRouteToSourceStopId(`stop${TRANSFER_ONLY}`, 0),
          undefined,
        );
      });
    });
  });
});
