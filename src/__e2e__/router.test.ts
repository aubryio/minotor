import assert from 'node:assert';
import { describe, it } from 'node:test';

import fs from 'fs';

import { Query, Router, StopsIndex, Time, Timetable } from '../router.js';

const routes = [
  {
    from: 'Parent8504100',
    to: 'Parent8504880',
    at: '08:30',
    route: [
      {
        from: '8504100:0:2',
        to: '8504086:0:2',
        departure: '08:34',
        arrival: '09:11',
        route: { type: 'RAIL', name: 'RE2' },
      },
      {
        from: '8504086:0:2',
        to: '8504086:0:4',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '03:00',
      },
      {
        from: '8504086:0:4',
        to: '8504077:0:1',
        departure: '09:20',
        arrival: '09:28',
        route: { type: 'RAIL', name: 'S51' },
      },
      {
        from: '8504077:0:1',
        to: '8577737',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '02:00',
      },
      {
        from: '8577737',
        to: '8504880',
        departure: '09:33',
        arrival: '09:44',
        route: { type: 'BUS', name: '263' },
      },
    ],
  },
  {
    from: 'Parent8507000',
    to: 'Parent8509253',
    at: '12:30',
    route: [
      {
        from: '8507000:0:8',
        to: '8503000:0:33',
        departure: '12:31',
        arrival: '13:28',
        route: { type: 'RAIL', name: 'IC1' },
      },
      {
        from: '8503000:0:33',
        to: '8503000:0:9',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '07:00',
      },
      {
        from: '8503000:0:9',
        to: '8509002:0:2',
        departure: '13:38',
        arrival: '14:41',
        route: { type: 'RAIL', name: 'IC3' },
      },
      {
        from: '8509002:0:2',
        to: '8509002:0:6',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '04:00',
      },
      {
        from: '8509002:0:6',
        to: '8509269:0:3',
        departure: '14:49',
        arrival: '15:52',
        route: { type: 'RAIL', name: 'RE24' },
      },
      {
        from: '8509269:0:3',
        to: '8509269:0:4',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '01:00',
      },
      {
        from: '8509269:0:4',
        to: '8509251:0:3',
        departure: '15:54',
        arrival: '16:43',
        route: { type: 'RAIL', name: 'R15' },
      },
      {
        from: '8509251:0:3',
        to: '8509251:0:2',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '01:00',
      },
      {
        from: '8509251:0:2',
        to: '8509253:0:1',
        departure: '16:48',
        arrival: '17:00',
        route: { type: 'RAIL', name: 'IR38' },
      },
    ],
  },
  {
    from: 'Parent8500010',
    to: 'Parent8721202',
    at: '16:50',
    route: [
      {
        from: '8500010:0:33',
        to: '8718213',
        departure: '17:08',
        arrival: '17:15',
        route: { type: 'RAIL', name: 'TER' },
      },
      {
        from: '8718213',
        to: '8721202',
        departure: '17:30',
        arrival: '18:39',
        route: { type: 'RAIL', name: 'K200' },
      },
    ],
  },
  {
    from: 'Parent8504100',
    to: 'Parent8509073',
    at: '08:30',
    route: [
      {
        from: '8504100:0:3',
        to: '8503000:0:33',
        departure: '09:03',
        arrival: '10:28',
        route: { type: 'RAIL', name: 'IC1' },
      },
      {
        from: '8503000:0:33',
        to: '8503000:0:10',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '07:00',
      },
      {
        from: '8503000:0:10',
        to: '8509002:0:2',
        departure: '10:38',
        arrival: '11:41',
        route: { type: 'RAIL', name: 'IC3' },
      },
      {
        from: '8509002:0:2',
        to: '8509002:0:6',
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: '04:00',
      },
      {
        from: '8509002:0:6',
        to: '8509073:0:1',
        departure: '11:49',
        arrival: '13:03',
        route: { type: 'RAIL', name: 'RE24' },
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
