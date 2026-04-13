import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Route } from '../../timetable/route.js';
import { durationFromSeconds, timeFromHM } from '../../timetable/time.js';
import { Timetable } from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopId.js';
import { GtfsStopsMap } from '../stops.js';
import {
  buildTripTransfers,
  GtfsTripTransfer,
  parseTransfers,
} from '../transfers.js';
import { TripsMapping } from '../trips.js';

describe('GTFS transfers parser', () => {
  it('should correctly parse valid transfers', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","2","180"\n');
    mockedStream.push('"1100097","8014447","0","240"\n');
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
            minTransferTime: durationFromSeconds(180),
          },
        ],
      ],
      [
        2, // Internal ID for stop '1100097'
        [
          {
            destination: 3, // Internal ID for stop '8014447'
            type: 'RECOMMENDED',
            minTransferTime: durationFromSeconds(240),
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should ignore impossible transfer types (3 and 5)', async () => {
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
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should ignore transfers with missing stop IDs', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push(',"8014440:0:1","2","180"\n');
    mockedStream.push('"1100097",,"0","240"\n');
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map([
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
    ]);

    const result = await parseTransfers(mockedStream, stopsMap);

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should correctly parse in-seat transfers (type 4)', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","trip1","trip2","4","0"\n');
    mockedStream.push('"1100097","8014447","trip3","trip4","4","0"\n');
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

    const expectedTripContinuations = [
      {
        fromStop: 0,
        fromTrip: 'trip1',
        toStop: 1,
        toTrip: 'trip2',
      },
      {
        fromStop: 2,
        fromTrip: 'trip3',
        toStop: 3,
        toTrip: 'trip4',
      },
    ];

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, expectedTripContinuations);
    assert.deepEqual(result.guaranteedTripTransfers, []);
  });

  it('should correctly parse guaranteed transfers (type 1) with trip IDs', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","tripA","tripB","1","0"\n');
    mockedStream.push('"1100097","8014447","tripC","tripD","1","60"\n');
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

    const expectedGuaranteedTripTransfers = [
      {
        fromStop: 0,
        fromTrip: 'tripA',
        toStop: 1,
        toTrip: 'tripB',
      },
      {
        fromStop: 2,
        fromTrip: 'tripC',
        toStop: 3,
        toTrip: 'tripD',
      },
    ];

    // Guaranteed transfers with trip IDs should go to guaranteedTripTransfers, not transfers
    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, []);
    assert.deepEqual(
      result.guaranteedTripTransfers,
      expectedGuaranteedTripTransfers,
    );
  });

  it('should differentiate guaranteed transfers with and without trip IDs', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    // Type 1 with trip IDs -> goes to guaranteedTripTransfers
    mockedStream.push('"1100084","8014440:0:1","tripA","tripB","1","0"\n');
    // Type 1 without trip IDs -> goes to transfers as stop-to-stop
    mockedStream.push('"1100097","8014447","","","1","120"\n');
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

    // Type 1 with trip IDs -> guaranteedTripTransfers
    const expectedGuaranteedTripTransfers = [
      {
        fromStop: 0,
        fromTrip: 'tripA',
        toStop: 1,
        toTrip: 'tripB',
      },
    ];

    // Type 1 without trip IDs -> transfers (stop-to-stop)
    const expectedTransfers = new Map([
      [
        2,
        [
          {
            destination: 3,
            type: 'GUARANTEED',
            minTransferTime: durationFromSeconds(120),
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, []);
    assert.deepEqual(
      result.guaranteedTripTransfers,
      expectedGuaranteedTripTransfers,
    );
  });

  it('should ignore in-seat transfers with missing trip IDs', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1",,"trip2","4","0"\n');
    mockedStream.push('"1100097","8014447","trip3",,"4","0"\n');
    mockedStream.push('"1100098","8014448","","trip5","4","0"\n');
    mockedStream.push('"1100099","8014449","trip6","","4","0"\n');
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
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should ignore unsupported transfer types between trips', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","trip1","trip2","1","0"\n');
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

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should ignore unsupported transfer types between routes', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_route_id,to_route_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","route1","route2","1","0"\n');
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

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should handle transfers without minimum transfer time', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","2"\n');
    mockedStream.push('"1100097","8014447","1","0"\n');
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
        0,
        [
          {
            destination: 1,
            type: 'REQUIRES_MINIMAL_TIME',
          },
        ],
      ],
      [
        2,
        [
          {
            destination: 3,
            type: 'GUARANTEED',
            minTransferTime: durationFromSeconds(0),
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should handle mixed transfers and trip continuations', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"1100084","8014440:0:1","","","1","120"\n');
    mockedStream.push('"1100097","8014447","trip1","trip2","4","0"\n');
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
        0,
        [
          {
            destination: 1,
            type: 'GUARANTEED',
            minTransferTime: durationFromSeconds(120),
          },
        ],
      ],
    ]);

    const expectedTripContinuations = [
      {
        fromStop: 2,
        fromTrip: 'trip1',
        toStop: 3,
        toTrip: 'trip2',
      },
    ];

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, expectedTripContinuations);
  });

  it('should handle empty transfers file', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push(null);

    const stopsMap: GtfsStopsMap = new Map();

    const result = await parseTransfers(mockedStream, stopsMap);

    assert.deepEqual(result.transfers, new Map());
    assert.deepEqual(result.tripContinuations, []);
  });

  it('should ignore transfers with non-existent stops', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n',
    );
    mockedStream.push('"unknown_stop","8014440:0:1","0","120"\n');
    mockedStream.push('"1100084","unknown_stop","1","60"\n');
    mockedStream.push('"1100084","8014440:0:1","2","180"\n');
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

    const expectedTransfers = new Map([
      [
        0,
        [
          {
            destination: 1,
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: durationFromSeconds(180),
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, []);
  });
});

describe('buildTripTransfers', () => {
  it('should build trip transfers for valid data', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
    ];

    const mockFromRoute = {
      stopRouteIndices: () => [0],
      arrivalAt: () => timeFromHM(1, 0), // 1:00
    } as unknown as Route;

    const mockToRoute = {
      stopRouteIndices: () => [1],
      departureFrom: () => timeFromHM(1, 15), // 1:15
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    const expectedTripBoardingId = encode(0, 0, 0);
    const transfers = result.get(expectedTripBoardingId);

    assert(transfers);
    assert.strictEqual(transfers.length, 1);
    assert.deepEqual(transfers[0], {
      stopIndex: 1,
      routeId: 1,
      tripIndex: 0,
    });
  });

  it('should ignore transfers with inactive stops', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100, // inactive stop
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
    ];

    const mockTimetable = {} as unknown as Timetable;
    const activeStopIds = new Set([200]); // only toStop is active

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should ignore transfers with unknown trip IDs', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100,
        fromTrip: 'unknown_trip', // not in tripsMapping
        toStop: 200,
        toTrip: 'trip1',
      },
    ];

    const mockTimetable = {} as unknown as Timetable;
    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should ignore transfers with unknown routes', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
    ];

    const mockTimetable = {
      getRoute: () => undefined, // no routes found
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should ignore transfers with no valid timing', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
    ];

    const mockFromRoute = {
      stopRouteIndices: () => [0],
      arrivalAt: () => timeFromHM(1, 15), // 1:15 - arrives AFTER departure
    } as unknown as Route;

    const mockToRoute = {
      stopRouteIndices: () => [1],
      departureFrom: () => timeFromHM(1, 0), // 1:00 - departs BEFORE arrival
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should handle multiple transfers from same trip boarding', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
      ['trip3', { routeId: 2, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 300,
        toTrip: 'trip3',
      },
    ];

    const mockFromRoute = {
      stopRouteIndices: () => [0],
      arrivalAt: () => timeFromHM(1, 0),
    } as unknown as Route;

    const mockToRoute1 = {
      stopRouteIndices: () => [1],
      departureFrom: () => timeFromHM(1, 10),
    } as unknown as Route;

    const mockToRoute2 = {
      stopRouteIndices: () => [2],
      departureFrom: () => timeFromHM(1, 20),
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) => {
        if (routeId === 0) return mockFromRoute;
        if (routeId === 1) return mockToRoute1;
        if (routeId === 2) return mockToRoute2;
        return undefined;
      },
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200, 300]);

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    const expectedTripBoardingId = encode(0, 0, 0);
    const transfers = result.get(expectedTripBoardingId);

    assert(transfers);
    assert.strictEqual(transfers.length, 2);
    assert.deepEqual(transfers[0], {
      stopIndex: 1,
      routeId: 1,
      tripIndex: 0,
    });
    assert.deepEqual(transfers[1], {
      stopIndex: 2,
      routeId: 2,
      tripIndex: 0,
    });
  });

  it('should handle empty input gracefully', () => {
    const tripsMapping: TripsMapping = new Map();
    const tripTransfers: GtfsTripTransfer[] = [];
    const mockTimetable = {} as unknown as Timetable;
    const activeStopIds = new Set<number>();

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should disambiguate transfers when routes visit same stop multiple times', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100, // This stop appears multiple times in the route
        fromTrip: 'trip1',
        toStop: 200, // This stop also appears multiple times
        toTrip: 'trip2',
      },
    ];

    // Mock route that visits stop 100 at indices 0 and 3 (circular route)
    const mockFromRoute = {
      stopRouteIndices: () => [0, 3], // Stop 100 appears twice
      arrivalAt: (stopIndex: number) => {
        // First visit at 1:00, second visit at 2:00
        return stopIndex === 0 ? timeFromHM(1, 0) : timeFromHM(2, 0);
      },
    } as unknown as Route;

    // Mock route that visits stop 200 at indices 1 and 4
    const mockToRoute = {
      stopRouteIndices: () => [1, 4], // Stop 200 appears twice
      departureFrom: (stopIndex: number) => {
        // First departure at 1:10, second departure at 2:30
        return stopIndex === 1 ? timeFromHM(1, 10) : timeFromHM(2, 30);
      },
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    // Should pick the best timing: arrive at stop 0 (1:00) -> depart from stop 1 (1:10)
    // This is better than arrive at stop 3 (2:00) -> depart from stop 4 (2:30)
    const expectedTripBoardingId = encode(0, 0, 0); // stopIndex=0, routeId=0, tripIndex=0
    const transfers = result.get(expectedTripBoardingId);

    assert(transfers);
    assert.strictEqual(transfers.length, 1);
    assert.deepEqual(transfers[0], {
      stopIndex: 1, // Best to-stop index
      routeId: 1,
      tripIndex: 0,
    });
  });

  it('should handle case where no valid transfer timing exists between duplicate stops', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripTransfers: GtfsTripTransfer[] = [
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
    ];

    // Mock route where all arrivals are AFTER all departures (impossible transfer)
    const mockFromRoute = {
      stopRouteIndices: () => [0, 3], // Stop 100 appears twice
      arrivalAt: (stopIndex: number) => {
        // Both arrivals are late: 2:00 and 3:00
        return stopIndex === 0 ? timeFromHM(2, 0) : timeFromHM(3, 0);
      },
    } as unknown as Route;

    const mockToRoute = {
      stopRouteIndices: () => [1, 4], // Stop 200 appears twice
      departureFrom: (stopIndex: number) => {
        // Both departures are early: 1:00 and 1:30
        return stopIndex === 1 ? timeFromHM(1, 0) : timeFromHM(1, 30);
      },
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripTransfers,
      mockTimetable,
      activeStopIds,
    );

    // Should find no valid transfers since all departures are before arrivals
    assert.strictEqual(result.size, 0);
  });
});
