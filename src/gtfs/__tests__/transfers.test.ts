import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Duration } from '../../timetable/duration.js';
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

    const transfers = await parseTransfers(mockedStream);
    const expectedTransfers = new Map([
      [
        '1100084',
        [
          {
            destination: '8014440:0:1',
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: Duration.fromSeconds(180),
          },
        ],
      ],
      [
        '1100097',
        [
          {
            destination: '8014447',
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

    const transfers = await parseTransfers(mockedStream);
    assert.deepEqual(transfers, new Map());
  });

  it('should ignore unsupported transfer types between routes', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_route_id,to_route_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440","2","180"\n');
    mockedStream.push(null);

    const transfers = await parseTransfers(mockedStream);
    assert.deepEqual(transfers, new Map());
  });

  it('should ignore unsupported transfer types between trips', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440","2","180"\n');
    mockedStream.push(null);

    const transfers = await parseTransfers(mockedStream);
    assert.deepEqual(transfers, new Map());
  });

  it('should allow missing minimum transfer time', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","2"\n');
    mockedStream.push(null);

    const transfers = await parseTransfers(mockedStream);
    assert.deepEqual(
      transfers,
      new Map([
        [
          '1100084',
          [
            {
              destination: '8014440:0:1',
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

    const transfers = await parseTransfers(mockedStream);
    assert.deepEqual(transfers, new Map());
  });
});
