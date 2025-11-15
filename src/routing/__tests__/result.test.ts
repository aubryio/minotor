import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Timetable } from '../../router.js';
import { Stop, StopId } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Duration } from '../../timetable/duration.js';
import { Route } from '../../timetable/route.js';
import { Time } from '../../timetable/time.js';
import { ServiceRoute, StopAdjacency } from '../../timetable/timetable.js';
import { Query } from '../query.js';
import { Result } from '../result.js';
import { Arrival, RoutingEdge, TransferEdge, VehicleEdge } from '../router.js';

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
              arrivalTime: Time.fromString('08:00:00'),
              departureTime: Time.fromString('08:05:00'),
            },
            {
              id: 1,
              arrivalTime: Time.fromString('08:30:00'),
              departureTime: Time.fromString('08:35:00'),
            },
            {
              id: 2,
              arrivalTime: Time.fromString('09:00:00'),
              departureTime: Time.fromString('09:05:00'),
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
              arrivalTime: Time.fromString('09:10:00'),
              departureTime: Time.fromString('09:15:00'),
            },
            {
              id: 3,
              arrivalTime: Time.fromString('09:45:00'),
              departureTime: Time.fromString('09:50:00'),
            },
            {
              id: 5,
              arrivalTime: Time.fromString('10:10:00'),
              departureTime: Time.fromString('10:15:00'),
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
    .from('stop1')
    .to(new Set(['stop3', 'stop4']))
    .departureTime(Time.fromHMS(8, 0, 0))
    .build();

  describe('bestRoute', () => {
    it('should return undefined when no route exists', () => {
      const earliestArrivals = new Map<StopId, Arrival>();
      const graph: Map<StopId, RoutingEdge>[] = [];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2, 3],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute();
      assert.strictEqual(route, undefined);
    });

    it('should return undefined for unreachable destination', () => {
      const earliestArrivals = new Map([
        [1, { arrival: Time.fromHMS(8, 30, 0), legNumber: 0 }],
      ]);
      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2, 3],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute('stop4'); // stop4 not in earliestArrivals
      assert.strictEqual(route, undefined);
    });

    it('should return route to closest destination when multiple destinations exist', () => {
      const earliestArrivals = new Map([
        [0, { arrival: Time.fromHMS(8, 0, 0), legNumber: 0 }], // origin
        [2, { arrival: Time.fromHMS(9, 0, 0), legNumber: 1 }], // faster destination
        [3, { arrival: Time.fromHMS(9, 30, 0), legNumber: 1 }], // slower destination
      ]);

      const vehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 0, 0),
        from: 0,
        to: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([[2, vehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2, 3],
        },
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
      const earliestArrivals = new Map([
        [2, { arrival: Time.fromHMS(9, 10, 0), legNumber: 1 }], // intermediate stop
        [5, { arrival: Time.fromHMS(10, 10, 0), legNumber: 2 }], // child1 - faster
        [6, { arrival: Time.fromHMS(10, 30, 0), legNumber: 2 }], // child2 - slower
      ]);

      const vehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(10, 10, 0),
        from: 2,
        to: 5,
        routeId: 1,
        tripIndex: 0,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[2, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([
          [
            2,
            {
              arrival: Time.fromHMS(9, 10, 0),
              from: 0,
              to: 2,
              routeId: 0,
              tripIndex: 0,
            },
          ],
        ]), // Round 1
        new Map<StopId, RoutingEdge>([[5, vehicleEdge]]), // Round 2
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [4], // parent stop
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute('parent');
      assert(route);
      assert.strictEqual(route.legs.length, 2);
      const lastLeg = route.legs[route.legs.length - 1];
      assert(lastLeg);
      assert.strictEqual(lastLeg.to.id, 5); // should route to faster child
    });

    it('should handle simple single-leg route reconstruction', () => {
      const earliestArrivals = new Map([
        [0, { arrival: Time.fromHMS(8, 0, 0), legNumber: 0 }], // origin
        [2, { arrival: Time.fromHMS(9, 0, 0), legNumber: 1 }], // destination
      ]);

      const vehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 0, 0),
        from: 0,
        to: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([[2, vehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute('stop3');
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const firstLeg = route.legs[0];
      assert(firstLeg);
      assert.strictEqual(firstLeg.from.id, 0);
      assert.strictEqual(firstLeg.to.id, 2);
    });

    it('should handle multi-leg route with transfer', () => {
      const earliestArrivals = new Map([
        [0, { arrival: Time.fromHMS(8, 0, 0), legNumber: 0 }], // origin
        [2, { arrival: Time.fromHMS(9, 0, 0), legNumber: 1 }], // intermediate stop
        [3, { arrival: Time.fromHMS(9, 45, 0), legNumber: 2 }], // final destination
      ]);

      const firstVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 0, 0),
        from: 0,
        to: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const secondVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 45, 0),
        from: 2,
        to: 3,
        routeId: 1,
        tripIndex: 0,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([[2, firstVehicleEdge]]), // Round 1
        new Map<StopId, RoutingEdge>([[3, secondVehicleEdge]]), // Round 2
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [3],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute('stop4');
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

  describe('continuous trips', () => {
    it('should handle single continuous trip correctly', () => {
      const earliestArrivals = new Map([
        [0, { arrival: Time.fromHMS(8, 0, 0), legNumber: 0 }], // origin
        [1, { arrival: Time.fromHMS(8, 30, 0), legNumber: 1 }], // intermediate stop
        [2, { arrival: Time.fromHMS(9, 0, 0), legNumber: 1 }], // final destination via continuous trip
      ]);

      const firstVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(8, 30, 0),
        from: 0,
        to: 1,
        routeId: 0,
        tripIndex: 0,
      };

      const continuousVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 0, 0),
        from: 1,
        to: 2,
        routeId: 0,
        tripIndex: 0,
        continuationOf: firstVehicleEdge,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([
          [1, firstVehicleEdge],
          [2, continuousVehicleEdge],
        ]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute('stop3');
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      const leg = route.legs[0];
      assert(leg);
      assert.strictEqual(leg.from.id, 0);
      assert.strictEqual(leg.to.id, 2);
    });

    it('should handle continuous trips with route change mid-journey', () => {
      const earliestArrivals = new Map([
        [0, { arrival: Time.fromHMS(8, 0, 0), legNumber: 0 }], // origin
        [3, { arrival: Time.fromHMS(9, 45, 0), legNumber: 1 }], // destination via continuous trip to route 1
      ]);

      const firstVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 0, 0),
        from: 0,
        to: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const continuousVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 45, 0),
        from: 2,
        to: 3,
        routeId: 1,
        tripIndex: 0,
        continuationOf: firstVehicleEdge,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([[3, continuousVehicleEdge]]), // Round 1
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [3],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute('stop4');
      assert(route);
      assert.strictEqual(route.legs.length, 1);

      const leg = route.legs[0];
      assert(leg);
      assert.strictEqual(leg.from.id, 0);
      assert.strictEqual(leg.to.id, 3);
    });
    it('should handle route reconstruction with actual transfer edges', () => {
      const earliestArrivals = new Map([
        [0, { arrival: Time.fromHMS(8, 0, 0), legNumber: 0 }], // origin
        [1, { arrival: Time.fromHMS(8, 30, 0), legNumber: 1 }], // first vehicle leg destination
        [2, { arrival: Time.fromHMS(8, 35, 0), legNumber: 1 }], // after transfer (same round as transfer doesn't advance round)
        [3, { arrival: Time.fromHMS(9, 15, 0), legNumber: 2 }], // final destination
      ]);

      const firstVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(8, 30, 0),
        from: 0,
        to: 1,
        routeId: 0,
        tripIndex: 0,
      };
      const transferEdge: TransferEdge = {
        arrival: Time.fromHMS(8, 35, 0),
        from: 1,
        to: 2,
        type: 'RECOMMENDED',
        minTransferTime: Duration.fromMinutes(5),
      };
      const secondVehicleEdge: VehicleEdge = {
        arrival: Time.fromHMS(9, 15, 0),
        from: 2,
        to: 3,
        routeId: 1,
        tripIndex: 0,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([
          [1, firstVehicleEdge], // First vehicle leg
          [2, transferEdge], // Transfer happens in same round as vehicle leg
        ]), // Round 1
        new Map<StopId, RoutingEdge>([[3, secondVehicleEdge]]), // Round 2 - second vehicle leg
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [3],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const route = result.bestRoute('stop4');
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

      assert.strictEqual(earliestArrivals.get(1)?.legNumber, 1);
      assert.strictEqual(earliestArrivals.get(2)?.legNumber, 1);
      assert.strictEqual(earliestArrivals.get(3)?.legNumber, 2);
    });
  });

  describe('arrivalAt', () => {
    it('should return arrival time for a reachable stop', () => {
      const arrivalTime = {
        arrival: Time.fromHMS(9, 0, 0),
        legNumber: 1,
      };
      const earliestArrivals = new Map([[2, arrivalTime]]);
      const graph: Map<StopId, RoutingEdge>[] = [];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt('stop3');
      assert.deepStrictEqual(arrival, arrivalTime);
    });

    it('should return undefined for unreachable stop', () => {
      const earliestArrivals = new Map([
        [2, { arrival: Time.fromHMS(9, 0, 0), legNumber: 1 }],
      ]);
      const graph: Map<StopId, RoutingEdge>[] = [];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt('stop4');
      assert.strictEqual(arrival, undefined);
    });

    it('should return earliest arrival among equivalent stops', () => {
      const earlierArrival = {
        arrival: Time.fromHMS(9, 0, 0),
        legNumber: 1,
      };
      const laterArrival = {
        arrival: Time.fromHMS(9, 30, 0),
        legNumber: 1,
      };

      const earliestArrivals = new Map([
        [5, earlierArrival], // child1 - faster
        [6, laterArrival], // child2 - slower
      ]);
      const graph: Map<StopId, RoutingEdge>[] = [];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [4], // parent stop
        },
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt('parent');
      assert.deepStrictEqual(arrival, earlierArrival);
    });

    it('should respect maxTransfers constraint', () => {
      const directArrival = {
        arrival: Time.fromHMS(9, 30, 0),
        legNumber: 1,
      };
      const transferArrival = {
        arrival: Time.fromHMS(9, 0, 0),
        legNumber: 2,
      };

      const earliestArrivals = new Map([
        [2, transferArrival], // Best overall arrival with transfer
      ]);

      const vehicleEdge1: VehicleEdge = {
        arrival: Time.fromHMS(9, 30, 0),
        from: 0,
        to: 2,
        routeId: 0,
        tripIndex: 0,
      };

      const vehicleEdge2: VehicleEdge = {
        arrival: Time.fromHMS(9, 0, 0),
        from: 0,
        to: 2,
        routeId: 1,
        tripIndex: 0,
      };

      const graph: Map<StopId, RoutingEdge>[] = [
        new Map<StopId, RoutingEdge>([[0, { arrival: Time.fromHMS(8, 0, 0) }]]), // Round 0 - origins
        new Map<StopId, RoutingEdge>([[2, vehicleEdge1]]), // Round 1 - direct route (no transfers)
        new Map<StopId, RoutingEdge>([[2, vehicleEdge2]]), // Round 2 - route with 1 transfer
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const arrivalWithLimit = result.arrivalAt('stop3', 0);
      assert.deepStrictEqual(arrivalWithLimit, directArrival);

      const arrivalWithoutLimit = result.arrivalAt('stop3');
      assert.deepStrictEqual(arrivalWithoutLimit, transferArrival);
    });

    it('should handle non-existent stops', () => {
      const earliestArrivals = new Map([
        [2, { arrival: Time.fromHMS(9, 0, 0), legNumber: 1 }],
      ]);
      const graph: Map<StopId, RoutingEdge>[] = [];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals,
          graph,
          destinations: [2],
        },
        mockStopsIndex,
        mockTimetable,
      );

      const arrival = result.arrivalAt('nonexistent');
      assert.strictEqual(arrival, undefined);
    });
  });
});
