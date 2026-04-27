import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHM } from '../../timetable/time.js';
import {
  ServiceRoute,
  StopAdjacency,
  Timetable,
} from '../../timetable/timetable.js';
import { Query, RangeQuery } from '../query.js';
import { RangeResult } from '../rangeResult.js';
import { Result } from '../result.js';
import { Router } from '../router.js';

// Minimal two-stop timetable used by all tests in this file.
const stopsAdjacency: StopAdjacency[] = [{ routes: [0] }, { routes: [0] }];
const routesAdjacency = [
  Route.of({
    id: 0,
    serviceRouteId: 0,
    trips: [
      {
        stops: [
          {
            id: 0,
            arrivalTime: timeFromHM(8, 0),
            departureTime: timeFromHM(8, 10),
          },
          {
            id: 1,
            arrivalTime: timeFromHM(8, 30),
            departureTime: timeFromHM(8, 30),
          },
        ],
      },
    ],
  }),
];
const serviceRoutes: ServiceRoute[] = [
  { type: 'BUS', name: 'Line 1', routes: [0] },
];
const stops: Stop[] = [
  {
    id: 0,
    sourceStopId: 'A',
    name: 'Stop A',
    lat: 0,
    lon: 0,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 1,
    sourceStopId: 'B',
    name: 'Stop B',
    lat: 0,
    lon: 0,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
];
const timetable = new Timetable(stopsAdjacency, routesAdjacency, serviceRoutes);
const stopsIndex = new StopsIndex(stops);
const router = new Router(timetable, stopsIndex);

describe('Router', () => {
  it('route() returns a Result with the correct earliest arrival', () => {
    const query = new Query.Builder()
      .from(0)
      .to(1)
      .departureTime(timeFromHM(8, 0))
      .build();
    const result = router.route(query);
    assert(result instanceof Result);
    assert.strictEqual(result.arrivalAt(1)?.arrival, timeFromHM(8, 30));
  });

  it('rangeRoute() returns a RangeResult covering all Pareto-optimal departures in the window', () => {
    const query = new RangeQuery.Builder()
      .from(0)
      .to(1)
      .departureTime(timeFromHM(8, 0))
      .lastDepartureTime(timeFromHM(9, 0))
      .build();
    const result = router.rangeRoute(query);
    assert(result instanceof RangeResult);
    assert.strictEqual(result.size, 1);
    assert.strictEqual(result.bestRoute()?.arrivalTime(), timeFromHM(8, 30));
  });
});
