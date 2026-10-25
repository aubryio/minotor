/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Raptor } from '../../routing/raptor.js';
import { RoutingState } from '../../routing/state.js';
import {
  ALL_TRANSPORT_MODES,
  RouteTypes,
  Timetable,
} from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopId.js';
import { FrequenciesMap } from '../frequencies.js';
import { GtfsStopsMap } from '../stops.js';
import { buildMinimumTripTransfers, buildTripTransfers } from '../transfers.js';
import { parseStopTimes } from '../trips.js';

type Trip = { id: string; times: [number, number][]; drops?: number[] };
const stops: GtfsStopsMap = new Map(
  [0, 1, 2].map((id) => [
    String(id),
    {
      id,
      sourceStopId: String(id),
      name: String(id),
      children: [],
      locationType: 'SIMPLE_STOP_OR_PLATFORM',
    },
  ]),
);
const clock = (time: number) => `${Math.floor(time / 60)}:${time % 60}:00`;
async function parse(trips: Trip[], frequencies?: FrequenciesMap) {
  const rows = trips.flatMap((trip) =>
    trip.times.map(
      ([arrival, departure], index) =>
        `${trip.id},${clock(arrival)},${clock(departure)},${index},${index + 1},0,${trip.drops?.[index] ?? 0}\n`,
    ),
  );
  const parsed = await parseStopTimes(
    Readable.from([
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
      ...rows,
    ]),
    stops,
    new Map(trips.map((trip) => [trip.id, 'service'])),
    new Set(),
    frequencies,
  );
  const timetable = new Timetable(
    [0, 1, 2].map((id) => ({
      routes: parsed.routes
        .filter((route) => route.stops.includes(id))
        .map((route) => route.id),
    })),
    parsed.routes,
    [
      {
        name: 'service',
        type: RouteTypes.BUS,
        routes: parsed.routes.map((route) => route.id),
      },
    ],
  );
  return { ...parsed, timetable };
}
function arrival(timetable: Timetable, stop = 1) {
  const state = new RoutingState(
    0,
    [stop],
    [{ fromStopId: 0, toStopId: 0, duration: 0 }],
    3,
    1,
  );
  new Raptor(timetable).run(
    {
      maxTransfers: 0,
      minTransferTime: 0,
      transportModes: ALL_TRANSPORT_MODES,
    },
    state,
  );
  return state.getArrival(stop)?.arrival;
}

describe('RAPTOR route grouping', () => {
  it('keeps a later trip with a usable drop-off reachable', async () => {
    const { routes, timetable } = await parse([
      {
        id: 'restricted',
        times: [
          [10, 10],
          [30, 30],
        ],
        drops: [0, 1],
      },
      {
        id: 'usable',
        times: [
          [20, 20],
          [40, 40],
        ],
      },
      {
        id: 'compatible',
        times: [
          [25, 25],
          [45, 45],
        ],
      },
    ]);
    assert.equal(routes.length, 2);
    assert.equal(routes[1]!.getNbTrips(), 2);
    assert.equal(arrival(timetable), 40);
  });

  it('partitions overtaking trips and preserves mappings after sorting', async () => {
    const { routes, tripsMapping, timetable } = await parse([
      {
        id: 'last',
        times: [
          [25, 25],
          [45, 45],
        ],
      },
      {
        id: 'slow',
        times: [
          [10, 10],
          [40, 40],
        ],
      },
      {
        id: 'fast',
        times: [
          [20, 20],
          [30, 30],
        ],
      },
    ]);
    assert.equal(routes.length, 2);
    assert.equal(arrival(timetable), 30);
    for (const [id, expected] of [
      ['slow', 10],
      ['fast', 20],
      ['last', 25],
    ] as const) {
      const mapping = tripsMapping.get(id)!;
      assert.equal(
        routes[mapping.routeId]!.departureFrom(0, mapping.tripRouteIndex),
        expected,
      );
    }
    const slow = tripsMapping.get('slow')!;
    const last = tripsMapping.get('last')!;
    const entries = [
      {
        fromStop: 0,
        fromTrip: 'slow',
        toStop: 0,
        toTrip: 'last',
        minTransferTime: 2,
      },
    ];
    const key = encode(0, slow.routeId, slow.tripRouteIndex);
    const target = {
      routeId: last.routeId,
      tripIndex: last.tripRouteIndex,
      stopIndex: 0,
    };
    // The same builder supplies guaranteed connections and in-seat continuations.
    assert.deepEqual(
      buildTripTransfers(tripsMapping, entries, timetable, new Set([0])).get(
        key,
      ),
      [target],
    );
    assert.deepEqual(
      buildMinimumTripTransfers(
        tripsMapping,
        entries,
        timetable,
        new Set([0]),
      ).get(key),
      [{ ...target, minTransferTime: 2 }],
    );
  });

  it('checks downstream departures as well as arrivals, including tied first departures', async () => {
    const { routes } = await parse([
      {
        id: 'a',
        times: [
          [10, 10],
          [20, 30],
          [40, 40],
        ],
      },
      {
        id: 'b',
        times: [
          [10, 10],
          [21, 25],
          [41, 41],
        ],
      },
      {
        id: 'c',
        times: [
          [11, 11],
          [22, 31],
          [42, 42],
        ],
      },
    ]);
    assert.deepEqual(
      routes.map((route) => route.getNbTrips()),
      [2, 1],
    );
  });

  it('partitions frequency-expanded trips and preserves their mappings', async () => {
    const { routes, tripsMapping, timetable } = await parse(
      [
        {
          id: 'slow',
          times: [
            [10, 10],
            [40, 40],
          ],
        },
        {
          id: 'fast',
          times: [
            [20, 20],
            [30, 30],
          ],
        },
      ],
      new Map([['fast', [{ startTime: 20, endTime: 31, headwayMins: 10 }]]]),
    );
    assert.equal(routes.length, 2);
    assert.equal(arrival(timetable), 30);
    for (const departure of [20, 30]) {
      const mapping = tripsMapping.get(`fast:freq:${departure}`)!;
      assert.equal(
        routes[mapping.routeId]!.departureFrom(0, mapping.tripRouteIndex),
        departure,
      );
    }
  });
});
