/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { TransferTypes } from '../../timetable/timetable.js';
import { GtfsStopsMap } from '../stops.js';
import { parseTransfers } from '../transfers.js';
import { parseStopTimes } from '../trips.js';

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
const csv = (rows: string[]) => Readable.from([rows.join('\n') + '\n']);

describe('transfer and route preprocessing invariants', () => {
  it('retains trip minima including zero and validates trip/route membership', async () => {
    const result = await parseTransfers(
      csv([
        'from_stop_id,to_stop_id,from_trip_id,to_trip_id,from_route_id,to_route_id,transfer_type,min_transfer_time',
        '0,1,a,b,A,B,2,0',
        '0,1,a,b,A,B,2,3600',
        '0,1,a,b,WRONG,B,2,120',
        '0,1,a,b,A,B,2,',
      ]),
      stops,
      new Set(),
      new Map([
        ['a', 'A'],
        ['b', 'B'],
      ]),
    );
    assert.equal(result.transfers.size, 0);
    assert.deepEqual(
      result.tripTransfers.map((rule) => [rule.type, rule.minTransferTime]),
      [
        [TransferTypes.REQUIRES_MINIMAL_TIME, 0],
        [TransferTypes.REQUIRES_MINIMAL_TIME, 60],
      ],
    );
  });

  it('splits overtaking and pickup/drop-off patterns and retains non-public occurrences', async () => {
    const rows = [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type',
    ];
    const add = (trip: string, times: string[], pickup = 0, dropoff = 0) => {
      times.forEach((time, i) =>
        rows.push(
          `${trip},${time}:00,${time}:00,${i},${i + 1},${i === 1 ? pickup : 0},${i === 1 ? dropoff : 0}`,
        ),
      );
    };
    add('a', ['08:00', '08:20', '08:40']);
    add('b', ['08:05', '08:15', '08:30']); // overtakes a
    add('c', ['08:10', '08:25', '08:45']); // can follow a
    add('d', ['08:15', '08:30', '08:50'], 0, 1);
    add('e', ['08:20', '08:35', '08:55'], 1, 0);
    add('f', ['08:25', '08:40', '09:00'], 1, 1);
    const result = await parseStopTimes(
      csv(rows),
      stops,
      new Map(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id, 'R'])),
      new Set(),
    );
    assert.equal(result.routes.length, 5);
    assert.equal(
      result.tripsMapping.get('a')!.routeId,
      result.tripsMapping.get('c')!.routeId,
    );
    assert.notEqual(
      result.tripsMapping.get('a')!.routeId,
      result.tripsMapping.get('b')!.routeId,
    );
    const nonPublic = result.routes[result.tripsMapping.get('f')!.routeId]!;
    assert.equal(nonPublic.getNbStops(), 3);
    assert.equal(nonPublic.pickUpTypeFrom(1, 0), 1);
    assert.equal(nonPublic.dropOffTypeAt(1, 0), 1);
    for (const r of result.routes)
      for (let trip = 1; trip < r.getNbTrips(); trip++)
        for (let stop = 0; stop < r.getNbStops(); stop++) {
          assert(r.arrivalAt(stop, trip - 1) <= r.arrivalAt(stop, trip));
          assert(
            r.departureFrom(stop, trip - 1) <= r.departureFrom(stop, trip),
          );
          assert.equal(
            r.pickUpTypeFrom(stop, trip - 1),
            r.pickUpTypeFrom(stop, trip),
          );
          assert.equal(
            r.dropOffTypeAt(stop, trip - 1),
            r.dropOffTypeAt(stop, trip),
          );
        }
  });
});
