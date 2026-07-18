import assert from 'node:assert';
import { describe, it } from 'node:test';

import { timeFromHM } from '../../timetable/time.js';
import { RouteTypes } from '../../timetable/timetable.js';
import { Query, RangeQuery } from '../query.js';
import { RangeResult } from '../rangeResult.js';
import { Result } from '../result.js';
import { routingScenario } from './helpers/routingScenario.js';

const { router } = routingScenario({
  stops: ['A', 'B'],
  routes: [
    {
      name: 'Line 1',
      mode: RouteTypes.BUS,
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
    },
  ],
});

describe('Router', () => {
  it('route returns a Result with the correct earliest arrival', () => {
    const query = new Query.Builder()
      .from(0)
      .to(1)
      .departureTime(timeFromHM(8, 0))
      .build();

    const result = router.route(query);

    assert(result instanceof Result);
    assert.strictEqual(result.arrivalAt(1)?.arrival, timeFromHM(8, 30));
  });

  it('rangeRoute returns a RangeResult with the Pareto frontier', () => {
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
