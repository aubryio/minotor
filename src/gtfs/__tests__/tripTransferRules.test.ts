/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Route } from '../../timetable/route.js';
import { Timetable } from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopId.js';
import { GtfsStopsMap } from '../stops.js';
import {
  buildMinimumTripTransfers,
  buildTripTransfers,
  parseTransfers,
} from '../transfers.js';
import { TripsMapping } from '../trips.js';

const stops: GtfsStopsMap = new Map(
  ['a', 'b'].map((sourceStopId, id) => [
    sourceStopId,
    {
      id,
      sourceStopId,
      name: sourceStopId,
      children: [],
      locationType: 'SIMPLE_STOP_OR_PLATFORM',
    },
  ]),
);
const csv = (rows: string[]) =>
  Readable.from([
    'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time,service_id\n',
    ...rows.map((row) => row + '\n'),
  ]);

describe('trip-specific minimum transfer import', () => {
  it('parses both trip IDs, filters service dates, and preserves minute rounding and zero', async () => {
    const parsed = await parseTransfers(
      csv([
        'a,b,A,B,2,60,active',
        'a,b,A,C,2,0,',
        'a,b,A,D,2,89,',
        'a,b,A,E,2,90,',
        'a,b,A,F,2,60,inactive',
      ]),
      stops,
      new Set(['active']),
    );
    assert.deepEqual(
      parsed.minimumTripTransfers.map((r) => [r.toTrip, r.minTransferTime]),
      [
        ['B', 1],
        ['C', 0],
        ['D', 1],
        ['E', 2],
      ],
    );
    assert.equal(parsed.transfers.size, 0);
    assert.equal(parsed.guaranteedTripTransfers.length, 0);
  });

  it('rejects missing and invalid minima, unknown stops, and partial trip constraints', async () => {
    const parsed = await parseTransfers(
      csv([
        'a,b,A,B,2,,',
        'a,b,A,B,2,-1,',
        'a,b,A,B,2,Infinity,',
        'a,b,A,B,2,NaN,',
        'missing,b,A,B,2,60,',
        'a,b,A,,2,60,',
        'a,b,A,,1,,',
      ]),
      stops,
      new Set(),
    );
    assert.deepEqual(parsed.minimumTripTransfers, []);
    assert.equal(parsed.transfers.size, 0);
    assert.deepEqual(parsed.guaranteedTripTransfers, []);
  });

  const mapping: TripsMapping = new Map([
    ['A', { routeId: 0, tripRouteIndex: 0 }],
    ['B', { routeId: 1, tripRouteIndex: 0 }],
  ]);
  const route = (id: number, ids: number[], times: number[]) =>
    Route.of({
      id,
      serviceRouteId: id,
      trips: [
        {
          stops: ids.map((stop, index) => ({
            id: stop,
            arrivalTime: times[index]!,
            departureTime: times[index]!,
          })),
        },
      ],
    });
  const entry = {
    fromStop: 0,
    toStop: 1,
    fromTrip: 'A',
    toTrip: 'B',
    minTransferTime: 3,
  };
  const timetable = new Timetable(
    [],
    [route(0, [0], [10]), route(1, [1, 1], [11, 15])],
    [],
  );

  it('resolves repeated stops to the closest pair satisfying the minimum', () => {
    assert.deepEqual(
      buildMinimumTripTransfers(
        mapping,
        [entry],
        timetable,
        new Set([0, 1]),
      ).get(encode(0, 0, 0)),
      [{ routeId: 1, tripIndex: 0, stopIndex: 1, minTransferTime: 3 }],
    );
  });

  it('retains an infeasible rule to prevent fallback boarding from bypassing its minimum', () => {
    assert.deepEqual(
      buildMinimumTripTransfers(
        mapping,
        [{ ...entry, minTransferTime: 9 }],
        timetable,
        new Set([0, 1]),
      ).get(encode(0, 0, 0)),
      [{ routeId: 1, tripIndex: 0, stopIndex: 0, minTransferTime: 9 }],
    );
  });

  it('skips inactive stops and trips', () => {
    assert.equal(
      buildMinimumTripTransfers(mapping, [entry], timetable, new Set([0])).size,
      0,
    );
    assert.equal(
      buildMinimumTripTransfers(new Map(), [entry], timetable, new Set([0, 1]))
        .size,
      0,
    );
  });

  it('allows equal-time guarantees and zero-minimum connections', () => {
    const equal = new Timetable(
      [],
      [route(0, [0], [10]), route(1, [1], [10])],
      [],
    );
    assert.equal(
      buildTripTransfers(mapping, [entry], equal, new Set([0, 1])).size,
      1,
    );
    assert.equal(
      buildMinimumTripTransfers(
        mapping,
        [{ ...entry, minTransferTime: 0 }],
        equal,
        new Set([0, 1]),
      ).size,
      1,
    );
  });
});

it('filters inactive trip pairs during parsing without removing ordinary stop transfers', async () => {
  const parsed = await parseTransfers(
    csv([
      'a,b,A,B,2,60,',
      'a,b,A,inactive,2,60,',
      'a,b,inactive,B,1,,',
      'a,b,A,inactive,4,,',
      'a,b,A,B,1,,',
      'a,b,A,B,4,,',
      'a,b,,,2,120,',
    ]),
    stops,
    new Set(),
    new Map([
      ['A', 0],
      ['B', 1],
    ]),
  );
  assert.equal(parsed.minimumTripTransfers.length, 1);
  assert.equal(parsed.guaranteedTripTransfers.length, 1);
  assert.equal(parsed.tripContinuations.length, 1);
  assert.equal(parsed.transfers.get(0)?.length, 1);
  const empty = await parseTransfers(
    csv(['a,b,A,B,2,60,']),
    stops,
    new Set(),
    new Set(),
  );
  assert.deepEqual(empty.minimumTripTransfers, []);
});
