import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Duration } from '../../timetable/duration.js';
import { ParsedStopsMap } from '../stops.js';
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

    const stopsMap: ParsedStopsMap = new Map([
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

    const transfers = await parseTransfers(mockedStream, stopsMap);
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

    assert.deepEqual(transfers, expectedTransfers);
  });

  it('should ignore impossible transfer types', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","3","180"\n');
    mockedStream.push('"1100097","8014447","5","240"\n');
    mockedStream.push(null);

    const stopsMap: ParsedStopsMap = new Map([
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

    const transfers = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(transfers, new Map());
  });

  it('should ignore unsupported transfer types between routes', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_route_id,to_route_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440","2","180"\n');
    mockedStream.push(null);

    const stopsMap: ParsedStopsMap = new Map([
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

    const transfers = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(transfers, new Map());
  });

  it('should ignore unsupported transfer types between trips', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440","2","180"\n');
    mockedStream.push(null);

    const stopsMap: ParsedStopsMap = new Map([
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

    const transfers = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(transfers, new Map());
  });

  it('should allow missing minimum transfer time', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","2"\n');
    mockedStream.push(null);

    const stopsMap: ParsedStopsMap = new Map([
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
    const transfers = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(
      transfers,
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
  });

  it('should handle empty transfers', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push(null);

    const stopsMap: ParsedStopsMap = new Map();

    const transfers = await parseTransfers(mockedStream, stopsMap);
    assert.deepEqual(transfers, new Map());
  });
});
