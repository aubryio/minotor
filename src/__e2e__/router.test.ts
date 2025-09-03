import assert from 'node:assert';
import { describe, it } from 'node:test';

import fs from 'fs';

import { Query, Router, StopsIndex, Time, Timetable } from '../router.js';

const routes = [
  {
    from: 'Parent8504100', // Fribourg/Freiburg
    to: 'Parent8504748', // Le Moléson
    at: '08:30',
    route: [
      {
        from: '8504100:0:2', // Fribourg/Freiburg, Pl. 2
        to: '8504086:0:2', // Bulle, Pl. 2
        departure: '08:34',
        arrival: '09:11',
        route: {
          type: 'RAIL',
          name: 'RE2',
        },
      },
      {
        from: '8504086:0:2', // Bulle, Pl. 2
        to: '8504086:0:4', // Bulle, Pl. 4
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '03:00',
      },
      {
        from: '8504086:0:4', // Bulle, Pl. 4
        to: '8504077:0:1', // Gruyères, Pl. 1
        departure: '09:20',
        arrival: '09:28',
        route: {
          type: 'RAIL',
          name: 'S51',
        },
      },
      {
        from: '8504077:0:1', // Gruyères, Pl. 1
        to: '8577737', // Gruyères, gare
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '02:00',
      },
      {
        from: '8577737', // Gruyères, gare
        to: '8504880', // Moléson-sur-Gruyères
        departure: '09:33',
        arrival: '09:44',
        route: {
          type: 'BUS',
          name: '263',
        },
      },
      {
        from: '8504880', // Moléson-sur-Gruyères
        to: '8530024', // Moléson-sur-Gruyères (funi)
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '02:00',
      },
      {
        from: '8530024', // Moléson-sur-Gruyères (funi)
        to: '8504749', // Plan-Francey
        departure: '10:00',
        arrival: '10:05',
        route: {
          type: 'FUNICULAR',
          name: 'FUN',
        },
      },
      {
        from: '8504749', // Plan-Francey
        to: '8531209', // Plan-Francey (téléphérique)
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '02:00',
      },
      {
        from: '8531209', // Plan-Francey (téléphérique)
        to: '8504748', // Le Moléson
        departure: '10:10',
        arrival: '10:15',
        route: {
          type: 'AERIAL_LIFT',
          name: 'PB',
        },
      },
    ],
  },
  {
    from: 'Parent8507000', // Bern
    to: 'Parent8509253', // St. Moritz
    at: '12:30',
    route: [
      {
        from: '8507000:0:8', // Bern, Pl.8
        to: '8503000:0:33', // Zürich HB, Pl. 33
        departure: '12:31',
        arrival: '13:28',
        route: {
          type: 'RAIL',
          name: 'IC1',
        },
      },
      {
        from: '8503000:0:33', // Zürich HB, Pl. 33
        to: '8503000:0:9', // Zürich HB, Pl. 9
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '07:00',
      },
      {
        from: '8503000:0:9', // Zürich HB, Pl. 9
        to: '8509000:0:9', // Chur, Pl. 9
        departure: '13:38',
        arrival: '14:52',
        route: {
          type: 'RAIL',
          name: 'IC3',
        },
      },
      {
        from: '8509000:0:9', // Chur, Pl. 9
        to: '8509000:0:10', // Chur, Pl. 10
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '03:00',
      },
      {
        from: '8509000:0:10', // Chur, Pl. 10
        to: '8509253:0:2', // St-Moritz,  Pl. 2
        departure: '14:58',
        arrival: '16:56',
        route: {
          type: 'RAIL',
          name: 'IR38',
        },
      },
    ],
  },
  {
    // Cross-border train as two routes (TODO, check if there is an in-seat transfer modeled for it)
    from: 'Parent8500010', // Basel SBB
    to: 'Parent8721202', // Strasbourg
    at: '16:50',
    route: [
      {
        from: '8500010:0:31', // Basel SBB, Pl. 31
        to: '8718213', // Saint-Louis (Haut-Rhin)
        departure: '16:50',
        arrival: '16:58',
        route: {
          type: 'RAIL',
          name: 'TER',
        },
      },
      {
        from: '8718213', // Saint-Louis (Haut-Rhin)
        to: '8721202', // Strasbourg
        departure: '16:59',
        arrival: '18:09',
        route: {
          type: 'RAIL',
          name: 'K200',
        },
      },
    ],
  },
];

const stopsPath = new URL('./timetable/stops.bin', import.meta.url).pathname;
const timetablePath = new URL('./timetable/timetable.bin', import.meta.url)
  .pathname;

describe('E2E Tests for Transit Router', () => {
  const stopsIndex = StopsIndex.fromData(fs.readFileSync(stopsPath));
  const timetable = Timetable.fromData(fs.readFileSync(timetablePath));

  const router = new Router(timetable, stopsIndex);

  routes.forEach(({ from, to, at, route }) => {
    it(`Route from ${from} to ${to} at ${at}`, () => {
      const fromStop = stopsIndex.findStopBySourceStopId(from);
      const toStop = stopsIndex.findStopBySourceStopId(to);

      assert.ok(fromStop, `Stop not found: ${from}`);
      assert.ok(toStop, `Stop not found: ${to}`);

      const departureTime = Time.fromString(at);

      const queryObject = new Query.Builder()
        .from(fromStop.sourceStopId)
        .to(toStop.sourceStopId)
        .departureTime(departureTime)
        .maxTransfers(5)
        .build();

      const result = router.route(queryObject);
      const bestRoute = result.bestRoute(toStop.sourceStopId);

      assert.ok(bestRoute, 'No route found');
      const actualRoute = bestRoute.asJson();

      assert.deepStrictEqual(
        actualRoute,
        route,
        `Route mismatch for query from ${from} to ${to} at ${at}`,
      );
    });
  });
});
