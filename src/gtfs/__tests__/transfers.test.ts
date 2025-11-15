import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Duration } from '../../timetable/duration.js';
import { GtfsStopsMap } from '../stops.js';
import { parseTransfers } from '../transfers.js';

describe('GTFS transfers parser', () => {
  it('should correctly parse valid transfers', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","2","180"\n');
    mockedStream.push('"1100097","8014447","2","240"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        '1100084',
        {
          id: 0,
          sourceStopId: '1100084',
          name: 'Test Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '8014440:0:1',
        {
          id: 1,
          sourceStopId: '8014440:0:1',
          name: 'Test Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '1100097',
        {
          id: 2,
          sourceStopId: '1100097',
          name: 'Test Stop 3',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '8014447',
        {
          id: 3,
          sourceStopId: '8014447',
          name: 'Test Stop 4',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);
    const expectedTransfers = new Map([
      [
        0, // Internal ID for stop '1100084'
        [
          {
            destination: 1, // Internal ID for stop '8014440:0:1'
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: Duration.fromSeconds(180),
          },
        ],
      ],
      [
        2, // Internal ID for stop '1100097'
        [
          {
            destination: 3, // Internal ID for stop '8014447'
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: Duration.fromSeconds(240),
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should ignore impossible transfer types', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","3","180"\n');
    mockedStream.push('"1100097","8014447","5","240"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        '1100084',
        {
          id: 0,
          sourceStopId: '1100084',
          name: 'Test Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '8014440:0:1',
        {
          id: 1,
          sourceStopId: '8014440:0:1',
          name: 'Test Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '1100097',
        {
          id: 2,
          sourceStopId: '1100097',
          name: 'Test Stop 3',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '8014447',
        {
          id: 3,
          sourceStopId: '8014447',
          name: 'Test Stop 4',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should ignore unsupported transfer types between routes', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_route_id,to_route_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440","2","180"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        '1100084',
        {
          id: 0,
          sourceStopId: '1100084',
          name: 'Test Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '8014440',
        {
          id: 1,
          sourceStopId: '8014440',
          name: 'Test Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should ignore unsupported transfer types between trips', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440","2","180"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        '1100084',
        {
          id: 0,
          sourceStopId: '1100084',
          name: 'Test Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '8014440',
        {
          id: 1,
          sourceStopId: '8014440',
          name: 'Test Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should allow missing minimum transfer time', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","2"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        '1100084',
        {
          id: 0,
          sourceStopId: '1100084',
          name: 'Test Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        '8014440:0:1',
        {
          id: 1,
          sourceStopId: '8014440:0:1',
          name: 'Test Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);
    const result = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(
      result.transfers,
      new Map([
        [
          0, // Internal ID for stop '1100084'
          [
            {
              destination: 1, // Internal ID for stop '8014440:0:1'
              type: 'REQUIRES_MINIMAL_TIME',
            },
          ],
        ],
      ]),
    );
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should handle empty transfers', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map();

    const result = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should correctly parse valid trip continuations (in-seat transfers)', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type\n',
    );
    mockedStream.push('"stop1","stop2","trip1","trip2","4"\n');
    mockedStream.push('"stop3","stop4","trip3","trip4","4"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        'stop1',
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop2',
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop3',
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop4',
        {
          id: 3,
          sourceStopId: 'stop4',
          name: 'Stop 4',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);

    const expectedTripContinuations = new Map([
      [
        0, // from_stop_id 'stop1' -> internal ID 0
        [
          {
            fromTrip: 'trip1',
            toTrip: 'trip2',
            hopOnStop: 1, // to_stop_id 'stop2' -> internal ID 1
          },
        ],
      ],
      [
        2, // from_stop_id 'stop3' -> internal ID 2
        [
          {
            fromTrip: 'trip3',
            toTrip: 'trip4',
            hopOnStop: 3, // to_stop_id 'stop4' -> internal ID 3
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, expectedTripContinuations);
  });

  it('should handle multiple trip continuations from the same stop', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type\n',
    );
    mockedStream.push('"stop1","stop2","trip1","trip2","4"\n');
    mockedStream.push('"stop1","stop3","trip1","trip3","4"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        'stop1',
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop2',
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop3',
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);

    const expectedTripContinuations = new Map([
      [
        0, // from_stop_id 'stop1' -> internal ID 0
        [
          {
            fromTrip: 'trip1',
            toTrip: 'trip2',
            hopOnStop: 1, // to_stop_id 'stop2' -> internal ID 1
          },
          {
            fromTrip: 'trip1',
            toTrip: 'trip3',
            hopOnStop: 2, // to_stop_id 'stop3' -> internal ID 2
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, expectedTripContinuations);
  });

  it('should mix regular transfers and trip continuations correctly', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"stop1","stop2","","","2","120"\n'); // Regular transfer
    mockedStream.push('"stop1","stop3","trip1","trip2","4",""\n'); // Trip continuation
    mockedStream.push('"stop2","stop3","","","0",""\n'); // Regular transfer
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        'stop1',
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop2',
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop3',
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);

    const expectedTransfers = new Map([
      [
        0, // from_stop_id 'stop1' -> internal ID 0
        [
          {
            destination: 1, // to_stop_id 'stop2' -> internal ID 1
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: Duration.fromSeconds(120),
          },
        ],
      ],
      [
        1, // from_stop_id 'stop2' -> internal ID 1
        [
          {
            destination: 2, // to_stop_id 'stop3' -> internal ID 2
            type: 'RECOMMENDED',
          },
        ],
      ],
    ]);

    const expectedTripContinuations = new Map([
      [
        0, // from_stop_id 'stop1' -> internal ID 0
        [
          {
            fromTrip: 'trip1',
            toTrip: 'trip2',
            hopOnStop: 2, // to_stop_id 'stop3' -> internal ID 2
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, expectedTripContinuations);
  });

  it('should ignore trip continuations with undefined trip IDs', async () => {
    const mockedStream = new Readable();
    mockedStream.push('from_stop_id,to_stop_id,transfer_type\n');
    mockedStream.push('"stop1","stop2","4"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        'stop1',
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop2',
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should ignore trip continuations with empty string trip IDs', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type\n',
    );
    mockedStream.push('"stop1","stop2","trip1","","4"\n');
    mockedStream.push('"stop3","stop4","","trip4","4"\n');
    mockedStream.push('"stop5","stop6","","","4"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        'stop1',
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop2',
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop3',
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop4',
        {
          id: 3,
          sourceStopId: 'stop4',
          name: 'Stop 4',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop5',
        {
          id: 4,
          sourceStopId: 'stop5',
          name: 'Stop 5',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop6',
        {
          id: 5,
          sourceStopId: 'stop6',
          name: 'Stop 6',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, new Map());
  });

  it('should handle complex scenario with multiple transfer types from same stop', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"stop1","stop2","","","2","120"\n'); // Regular transfer to stop2
    mockedStream.push('"stop1","stop3","trip1","trip2","4",""\n'); // Trip continuation to stop3
    mockedStream.push('"stop1","stop4","","","0",""\n'); // Another regular transfer to stop4
    mockedStream.push('"stop1","stop5","trip3","trip4","4",""\n'); // Another trip continuation to stop5
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
      [
        'stop1',
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop2',
        {
          id: 1,
          sourceStopId: 'stop2',
          name: 'Stop 2',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop3',
        {
          id: 2,
          sourceStopId: 'stop3',
          name: 'Stop 3',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop4',
        {
          id: 3,
          sourceStopId: 'stop4',
          name: 'Stop 4',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
      [
        'stop5',
        {
          id: 4,
          sourceStopId: 'stop5',
          name: 'Stop 5',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
        },
      ],
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);

    const expectedTransfers = new Map([
      [
        0, // from_stop_id 'stop1' -> internal ID 0
        [
          {
            destination: 1, // to_stop_id 'stop2' -> internal ID 1
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: Duration.fromSeconds(120),
          },
          {
            destination: 3, // to_stop_id 'stop4' -> internal ID 3
            type: 'RECOMMENDED',
          },
        ],
      ],
    ]);

    const expectedTripContinuations = new Map([
      [
        0, // from_stop_id 'stop1' -> internal ID 0
        [
          {
            fromTrip: 'trip1',
            toTrip: 'trip2',
            hopOnStop: 2, // to_stop_id 'stop3' -> internal ID 2
          },
          {
            fromTrip: 'trip3',
            toTrip: 'trip4',
            hopOnStop: 4, // to_stop_id 'stop5' -> internal ID 4
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, expectedTripContinuations);
  });
});
