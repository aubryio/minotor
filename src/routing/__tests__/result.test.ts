import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Stop, StopId } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Time } from '../../timetable/time.js';
import { Query } from '../query.js';
import { Result } from '../result.js';
import { ReachingTime, TripLeg } from '../router.js';

describe('Result', () => {
  const stop1: Stop = {
    id: 1,
    sourceStopId: 'stop1',
    name: 'Lausanne',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stop2: Stop = {
    id: 2,
    sourceStopId: 'stop2',
    name: 'Fribourg',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stop3: Stop = {
    id: 3,
    sourceStopId: 'stop3',
    name: 'Bern',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stop4: Stop = {
    id: 4,
    sourceStopId: 'stop4',
    name: 'Olten',
    lat: 0,
    lon: 0,
    children: [],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const parentStop: Stop = {
    id: 6,
    sourceStopId: 'parent',
    name: 'Basel',
    lat: 0,
    lon: 0,
    children: [7, 8],
    parent: undefined,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const childStop1: Stop = {
    id: 7,
    sourceStopId: 'child1',
    name: 'Basel Pl. 1',
    lat: 0,
    lon: 0,
    children: [],
    parent: 6,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const childStop2: Stop = {
    id: 8,
    sourceStopId: 'child2',
    name: 'Basel Pl. 2',
    lat: 0,
    lon: 0,
    children: [],
    parent: 6,
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stopsMap = new Map([
    [1, stop1],
    [2, stop2],
    [3, stop3],
    [4, stop4],
    [6, parentStop],
    [7, childStop1],
    [8, childStop2],
  ]);

  const mockStopsIndex = new StopsIndex(stopsMap);

  const mockQuery = new Query.Builder()
    .from('stop1')
    .to(new Set(['stop3', 'stop4']))
    .departureTime(Time.fromHMS(8, 0, 0))
    .build();

  describe('bestRoute', () => {
    it('should return undefined when no route exists', () => {
      const earliestArrivals = new Map<StopId, ReachingTime>();
      const earliestArrivalsPerRound: Map<StopId, TripLeg>[] = [];

      const result = new Result(
        mockQuery,
        earliestArrivals,
        earliestArrivalsPerRound,
        mockStopsIndex,
      );

      const route = result.bestRoute();
      assert.strictEqual(route, undefined);
    });

    it('should return undefined for unreachable destination', () => {
      const earliestArrivals = new Map([
        [2, { arrival: Time.fromHMS(8, 30, 0), legNumber: 0, origin: 1 }],
      ]);
      const earliestArrivalsPerRound: Map<StopId, TripLeg>[] = [];

      const result = new Result(
        mockQuery,
        earliestArrivals,
        earliestArrivalsPerRound,
        mockStopsIndex,
      );

      const route = result.bestRoute('stop4'); // stop4 not in earliestArrivals
      assert.strictEqual(route, undefined);
    });

    it('should return route to closest destination when multiple destinations exist', () => {
      const earliestArrivals = new Map([
        [3, { arrival: Time.fromHMS(9, 0, 0), legNumber: 0, origin: 1 }], // faster
        [4, { arrival: Time.fromHMS(9, 30, 0), legNumber: 0, origin: 1 }], // slower
      ]);

      const vehicleLegTo3 = {
        from: stop1,
        to: stop3,
        route: { type: 'BUS', name: 'Bus 101' },
        departureTime: Time.fromHMS(8, 0, 0),
        arrivalTime: Time.fromHMS(9, 0, 0),
      };

      const earliestArrivalsPerRound = [
        new Map([
          [
            3,
            {
              arrival: Time.fromHMS(9, 0, 0),
              legNumber: 0,
              origin: 1,
              leg: vehicleLegTo3,
            } as TripLeg,
          ],
        ]),
      ];

      const result = new Result(
        mockQuery,
        earliestArrivals,
        earliestArrivalsPerRound,
        mockStopsIndex,
      );

      const route = result.bestRoute();
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      assert.deepStrictEqual(route.legs[0], vehicleLegTo3);
    });

    it('should return route to fastest child stop when parent stop is queried', () => {
      const vehicleLegToChild1 = {
        from: stop1,
        to: childStop1,
        route: { type: 'BUS', name: 'Bus 101' },
        departureTime: Time.fromHMS(8, 0, 0),
        arrivalTime: Time.fromHMS(9, 0, 0),
      };

      const earliestArrivals = new Map([
        [7, { arrival: Time.fromHMS(9, 0, 0), legNumber: 0, origin: 1 }], // child1 - faster
        [8, { arrival: Time.fromHMS(9, 30, 0), legNumber: 0, origin: 1 }], // child2 - slower
      ]);

      const earliestArrivalsPerRound = [
        new Map([
          [
            7,
            {
              arrival: Time.fromHMS(9, 0, 0),
              legNumber: 0,
              origin: 1,
              leg: vehicleLegToChild1,
            } as TripLeg,
          ],
        ]),
      ];

      const result = new Result(
        mockQuery,
        earliestArrivals,
        earliestArrivalsPerRound,
        mockStopsIndex,
      );

      const route = result.bestRoute('parent');
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      assert.deepStrictEqual(route.legs[0], vehicleLegToChild1);
    });

    it('should handle simple single-leg route reconstruction', () => {
      const vehicleLeg = {
        from: stop1,
        to: stop3,
        route: { type: 'BUS', name: 'Bus 101' },
        departureTime: Time.fromHMS(8, 0, 0),
        arrivalTime: Time.fromHMS(9, 0, 0),
      };

      // Simple case: origin stop 1, destination stop 3, direct connection
      const earliestArrivals = new Map([
        [3, { arrival: Time.fromHMS(9, 0, 0), legNumber: 0, origin: 1 }],
      ]);

      const earliestArrivalsPerRound = [
        new Map([
          [
            3,
            {
              arrival: Time.fromHMS(9, 0, 0),
              legNumber: 0,
              origin: 1,
              leg: vehicleLeg,
            } as TripLeg,
          ],
        ]),
      ];

      const result = new Result(
        mockQuery,
        earliestArrivals,
        earliestArrivalsPerRound,
        mockStopsIndex,
      );

      const route = result.bestRoute('stop3');
      assert(route);
      assert.strictEqual(route.legs.length, 1);
      assert.deepStrictEqual(route.legs[0], vehicleLeg);
    });
  });

  describe('arrivalAt', () => {
    it('should return arrival time for a reachable stop', () => {
      const arrivalTime = {
        arrival: Time.fromHMS(9, 0, 0),
        legNumber: 1,
        origin: 1,
      };
      const earliestArrivals = new Map([[3, arrivalTime]]);

      const result = new Result(
        mockQuery,
        earliestArrivals,
        [],
        mockStopsIndex,
      );

      const arrival = result.arrivalAt('stop3');
      assert.deepStrictEqual(arrival, arrivalTime);
    });

    it('should return undefined for unreachable stop', () => {
      const earliestArrivals = new Map([
        [3, { arrival: Time.fromHMS(9, 0, 0), legNumber: 1, origin: 1 }],
      ]);

      const result = new Result(
        mockQuery,
        earliestArrivals,
        [],
        mockStopsIndex,
      );

      const arrival = result.arrivalAt('stop4');
      assert.strictEqual(arrival, undefined);
    });

    it('should return earliest arrival among equivalent stops', () => {
      const earlierArrival = {
        arrival: Time.fromHMS(9, 0, 0),
        legNumber: 1,
        origin: 1,
      };
      const laterArrival = {
        arrival: Time.fromHMS(9, 30, 0),
        legNumber: 1,
        origin: 1,
      };

      const earliestArrivals = new Map([
        [7, earlierArrival], // child1 - faster
        [8, laterArrival], // child2 - slower
      ]);

      const result = new Result(
        mockQuery,
        earliestArrivals,
        [],
        mockStopsIndex,
      );

      const arrival = result.arrivalAt('parent');
      assert.deepStrictEqual(arrival, earlierArrival);
    });

    it('should respect maxTransfers constraint', () => {
      const tripLeg1 = {
        arrival: Time.fromHMS(8, 30, 0),
        legNumber: 0,
        origin: 1,
      };
      const tripLeg2 = {
        arrival: Time.fromHMS(9, 0, 0),
        legNumber: 1,
        origin: 1,
      };
      const tripLeg3 = {
        arrival: Time.fromHMS(9, 30, 0),
        legNumber: 2,
        origin: 1,
      };

      const earliestArrivals = new Map([
        [3, tripLeg2], // 1 transfer
      ]);

      const earliestArrivalsPerRound = [
        new Map([[3, tripLeg1]]), // Round 0 (start)
        new Map([[3, tripLeg3]]), // Round 1 (no transfers)
        new Map([[3, tripLeg2]]), // Round 2 (1 transfers)
      ];

      const result = new Result(
        mockQuery,
        earliestArrivals,
        earliestArrivalsPerRound,
        mockStopsIndex,
      );

      const arrivalWithLimit = result.arrivalAt('stop3', 0);
      assert.deepStrictEqual(arrivalWithLimit, tripLeg3);

      const arrivalWithoutLimit = result.arrivalAt('stop3', 1);
      assert.deepStrictEqual(arrivalWithoutLimit, tripLeg2);
    });

    it('should handle non-existent stops', () => {
      const earliestArrivals = new Map([
        [
          3,
          {
            arrival: Time.fromHMS(9, 0, 0),
            legNumber: 1,
            origin: 1,
          } as ReachingTime,
        ],
      ]);

      const result = new Result(
        mockQuery,
        earliestArrivals,
        [],
        mockStopsIndex,
      );

      const arrival = result.arrivalAt('nonexistent');
      assert.strictEqual(arrival, undefined);
    });
  });
});
