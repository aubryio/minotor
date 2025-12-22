import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Duration } from '../../timetable/duration.js';
import { Route } from '../../timetable/route.js';
import { Time } from '../../timetable/time.js';
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
            minTransferTime: Duration.fromSeconds(180),
          },
        ],
      ],
      [
        2, // Internal ID for stop '1100097'
        [
          {
            destination: 3, // Internal ID for stop '8014447'
            type: 'RECOMMENDED',
            minTransferTime: Duration.fromSeconds(240),
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
            minTransferTime: Duration.fromSeconds(0),
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
            minTransferTime: Duration.fromSeconds(120),
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
            minTransferTime: Duration.fromSeconds(180),
          },
        ],
      ],
    ]);

    assert.deepEqual(result.transfers, expectedTransfers);
    assert.deepEqual(result.tripContinuations, []);
  });
});

describe('buildTripContinuations', () => {
  it('should build trip continuations for valid data', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripContinuations = [
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
    ];

    // Mock route with simple stops and timing
    const mockFromRoute = {
      stopRouteIndices: () => [0],
      arrivalAt: () => Time.fromMinutes(60), // 1:00
    } as unknown as Route;

    const mockToRoute = {
      stopRouteIndices: () => [1],
      departureFrom: () => Time.fromMinutes(75), // 1:15
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    const expectedTripBoardingId = encode(0, 0, 0);
    const continuations = result.get(expectedTripBoardingId);

    assert(continuations);
    assert.strictEqual(continuations.length, 1);
    assert.deepEqual(continuations[0], {
      hopOnStopIndex: 1,
      routeId: 1,
      tripIndex: 0,
    });
  });

  it('should ignore trip continuations with inactive stops', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripContinuations = [
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
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should ignore trip continuations with unknown trip IDs', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
    ]);

    const tripContinuations = [
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
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should ignore trip continuations with unknown routes', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripContinuations = [
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
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should ignore trip continuations with no valid timing', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripContinuations = [
      {
        fromStop: 100,
        fromTrip: 'trip1',
        toStop: 200,
        toTrip: 'trip2',
      },
    ];

    const mockFromRoute = {
      stopRouteIndices: () => [0],
      arrivalAt: () => Time.fromMinutes(75), // 1:15 - arrives AFTER departure
    } as unknown as Route;

    const mockToRoute = {
      stopRouteIndices: () => [1],
      departureFrom: () => Time.fromMinutes(60), // 1:00 - departs BEFORE arrival
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    assert.strictEqual(result.size, 0);
  });

  it('should handle multiple continuations from same trip boarding', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
      ['trip3', { routeId: 2, tripRouteIndex: 0 }],
    ]);

    const tripContinuations = [
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
      arrivalAt: () => Time.fromMinutes(60),
    } as unknown as Route;

    const mockToRoute1 = {
      stopRouteIndices: () => [1],
      departureFrom: () => Time.fromMinutes(70),
    } as unknown as Route;

    const mockToRoute2 = {
      stopRouteIndices: () => [2],
      departureFrom: () => Time.fromMinutes(80),
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
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    const expectedTripBoardingId = encode(0, 0, 0);
    const continuations = result.get(expectedTripBoardingId);

    assert(continuations);
    assert.strictEqual(continuations.length, 2);
    assert.deepEqual(continuations[0], {
      hopOnStopIndex: 1,
      routeId: 1,
      tripIndex: 0,
    });
    assert.deepEqual(continuations[1], {
      hopOnStopIndex: 2,
      routeId: 2,
      tripIndex: 0,
    });
  });

  it('should handle empty input gracefully', () => {
    const tripsMapping: TripsMapping = new Map();
    const tripContinuations: GtfsTripTransfer[] = [];
    const mockTimetable = {} as unknown as Timetable;
    const activeStopIds = new Set<number>();

    const result = buildTripTransfers(
      tripsMapping,
      tripContinuations,
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

    const tripContinuations = [
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
        return stopIndex === 0 ? Time.fromMinutes(60) : Time.fromMinutes(120);
      },
    } as unknown as Route;

    // Mock route that visits stop 200 at indices 1 and 4
    const mockToRoute = {
      stopRouteIndices: () => [1, 4], // Stop 200 appears twice
      departureFrom: (stopIndex: number) => {
        // First departure at 1:10, second departure at 2:30
        return stopIndex === 1 ? Time.fromMinutes(70) : Time.fromMinutes(150);
      },
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    // Should pick the best timing: arrive at stop 0 (1:00) -> depart from stop 1 (1:10)
    // This is better than arrive at stop 3 (2:00) -> depart from stop 4 (2:30)
    const expectedTripBoardingId = encode(0, 0, 0); // stopIndex=0, routeId=0, tripIndex=0
    const continuations = result.get(expectedTripBoardingId);

    assert(continuations);
    assert.strictEqual(continuations.length, 1);
    assert.deepEqual(continuations[0], {
      hopOnStopIndex: 1, // Best to-stop index
      routeId: 1,
      tripIndex: 0,
    });
  });

  it('should handle case where no valid transfer timing exists between duplicate stops', () => {
    const tripsMapping: TripsMapping = new Map([
      ['trip1', { routeId: 0, tripRouteIndex: 0 }],
      ['trip2', { routeId: 1, tripRouteIndex: 0 }],
    ]);

    const tripContinuations = [
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
        return stopIndex === 0 ? Time.fromMinutes(120) : Time.fromMinutes(180);
      },
    } as unknown as Route;

    const mockToRoute = {
      stopRouteIndices: () => [1, 4], // Stop 200 appears twice
      departureFrom: (stopIndex: number) => {
        // Both departures are early: 1:00 and 1:30
        return stopIndex === 1 ? Time.fromMinutes(60) : Time.fromMinutes(90);
      },
    } as unknown as Route;

    const mockTimetable = {
      getRoute: (routeId: number) =>
        routeId === 0 ? mockFromRoute : mockToRoute,
    } as unknown as Timetable;

    const activeStopIds = new Set([100, 200]);

    const result = buildTripTransfers(
      tripsMapping,
      tripContinuations,
      mockTimetable,
      activeStopIds,
    );

    // Should find no valid continuations since all departures are before arrivals
    assert.strictEqual(result.size, 0);
  });
});
