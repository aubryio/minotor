import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { Time } from '../../timetable/time.js';
import {
  RoutesAdjacency,
  ServiceRoutesMap,
} from '../../timetable/timetable.js';
import { ServiceIds } from '../services.js';
import { StopIds } from '../stops.js';
import { TransfersMap } from '../transfers.js';
import {
  buildStopsAdjacencyStructure,
  parseStopTimes,
  parseTrips,
  TripIdsMap,
} from '../trips.js';

describe('buildStopsAdjacencyStructure', () => {
  it('should correctly build stops adjacency for valid routes and transfers', () => {
    const validStops: StopIds = new Set(['stop1']);
    const routesAdjacency: RoutesAdjacency = new Map([
      [
        'routeA',
        {
          serviceRouteId: 'service1',
          stops: ['stop1', 'stop2'],
          stopIndices: new Map([
            ['stop1', 0],
            ['stop2', 1],
          ]),
          stopTimes: [],
        },
      ],
    ]);
    const transfersMap: TransfersMap = new Map([
      ['stop1', [{ destination: 'stop2', type: 'RECOMMENDED' }]],
    ]);

    const stopsAdjacency = buildStopsAdjacencyStructure(
      validStops,
      routesAdjacency,
      transfersMap,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        'stop1',
        {
          routes: ['routeA'],
          transfers: [],
        },
      ],
    ]);
  });

  it('should ignore transfers to invalid stops', () => {
    const validStops: StopIds = new Set(['stop1', 'stop2']);
    const routesAdjacency: RoutesAdjacency = new Map([
      [
        'routeA',
        {
          serviceRouteId: 'service1',
          stops: ['stop1', 'stop2'],
          stopIndices: new Map([
            ['stop1', 0],
            ['stop2', 1],
          ]),
          stopTimes: [],
        },
      ],
    ]);
    const transfersMap: TransfersMap = new Map([
      ['stop1', [{ destination: 'stop3', type: 'RECOMMENDED' }]],
    ]);

    const stopsAdjacency = buildStopsAdjacencyStructure(
      validStops,
      routesAdjacency,
      transfersMap,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        'stop1',
        {
          routes: ['routeA'],
          transfers: [],
        },
      ],
      [
        'stop2',
        {
          routes: ['routeA'],
          transfers: [],
        },
      ],
    ]);
  });
});
describe('GTFS trips parser', () => {
  it('should correctly parse valid trips', async () => {
    const mockedStream = new Readable();
    mockedStream.push('route_id,service_id,trip_id\n');
    mockedStream.push('"routeA","service1","trip1"\n');
    mockedStream.push('"routeB","service2","trip2"\n');
    mockedStream.push(null);

    const validServiceIds: ServiceIds = new Set(['service1', 'service2']);
    const validRouteIds: ServiceRoutesMap = new Map([
      ['routeA', { type: 'BUS', name: 'B1' }],
      ['routeB', { type: 'TRAM', name: 'T1' }],
    ]);

    const trips = await parseTrips(
      mockedStream,
      validServiceIds,
      validRouteIds,
    );
    assert.deepEqual(
      trips,
      new Map([
        ['trip1', 'routeA'],
        ['trip2', 'routeB'],
      ]),
    );
  });

  it('should ignore trips with invalid service ids', async () => {
    const mockedStream = new Readable();
    mockedStream.push('route_id,service_id,trip_id\n');
    mockedStream.push('"routeA","service1","trip1"\n');
    mockedStream.push('"routeB","service3","trip2"\n');
    mockedStream.push(null);

    const validServiceIds: ServiceIds = new Set(['service1', 'service2']);
    const validRouteIds: ServiceRoutesMap = new Map([
      ['routeA', { type: 'BUS', name: 'B1' }],
      ['routeB', { type: 'TRAM', name: 'T1' }],
    ]);

    const trips = await parseTrips(
      mockedStream,
      validServiceIds,
      validRouteIds,
    );
    assert.deepEqual(trips, new Map([['trip1', 'routeA']]));
  });

  it('should ignore trips with invalid route ids', async () => {
    const mockedStream = new Readable();
    mockedStream.push('route_id,service_id,trip_id\n');
    mockedStream.push('"routeA","service1","trip1"\n');
    mockedStream.push('"routeC","service2","trip2"\n');
    mockedStream.push(null);

    const validServiceIds: ServiceIds = new Set(['service1', 'service2']);
    const validRouteIds: ServiceRoutesMap = new Map([
      ['routeA', { type: 'BUS', name: 'B1' }],
      ['routeB', { type: 'TRAM', name: 'T1' }],
    ]);

    const trips = await parseTrips(
      mockedStream,
      validServiceIds,
      validRouteIds,
    );
    assert.deepEqual(trips, new Map([['trip1', 'routeA']]));
  });
});

describe('GTFS stop times parser', () => {
  it('should correctly parse valid stop times', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
    );
    mockedStream.push('"tripA","08:00:00","08:05:00","stop1","1","0","0"\n');
    mockedStream.push('"tripA","08:10:00","08:15:00","stop2","2","0","0"\n');
    mockedStream.push(null);

    const validTripIds: TripIdsMap = new Map([['tripA', 'routeA']]);
    const validStopIds: StopIds = new Set(['stop1', 'stop2']);

    const routes = await parseStopTimes(
      mockedStream,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(
      routes,
      new Map([
        [
          'routeA_1e0e4u3',
          {
            serviceRouteId: 'routeA',
            stops: ['stop1', 'stop2'],
            stopIndices: new Map([
              ['stop1', 0],
              ['stop2', 1],
            ]),
            stopTimes: [
              {
                arrival: Time.fromHMS(8, 0, 0),
                departure: Time.fromHMS(8, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(8, 10, 0),
                departure: Time.fromHMS(8, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
          },
        ],
      ]),
    );
  });

  it('should create same route for same GTFS route with same stops', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
    );
    mockedStream.push('"tripA","08:00:00","08:05:00","stop1","1","0","0"\n');
    mockedStream.push('"tripA","08:10:00","08:15:00","stop2","2","0","0"\n');
    mockedStream.push('"tripB","09:00:00","09:05:00","stop1","1","0","0"\n');
    mockedStream.push('"tripB","09:10:00","09:15:00","stop2","2","0","0"\n');
    mockedStream.push(null);

    const validTripIds: TripIdsMap = new Map([
      ['tripA', 'routeA'],
      ['tripB', 'routeA'],
    ]);
    const validStopIds: StopIds = new Set(['stop1', 'stop2']);

    const routes = await parseStopTimes(
      mockedStream,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(
      routes,
      new Map([
        [
          'routeA_1e0e4u3',
          {
            serviceRouteId: 'routeA',
            stops: ['stop1', 'stop2'],
            stopIndices: new Map([
              ['stop1', 0],
              ['stop2', 1],
            ]),
            stopTimes: [
              {
                arrival: Time.fromHMS(8, 0, 0),
                departure: Time.fromHMS(8, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(8, 10, 0),
                departure: Time.fromHMS(8, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(9, 0, 0),
                departure: Time.fromHMS(9, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(9, 10, 0),
                departure: Time.fromHMS(9, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
          },
        ],
      ]),
    );
  });

  it('should support unsorted trips within a route', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
    );
    mockedStream.push('"tripB","09:00:00","09:05:00","stop1","1","0","0"\n');
    mockedStream.push('"tripB","09:10:00","09:15:00","stop2","2","0","0"\n');
    mockedStream.push('"tripA","08:00:00","08:05:00","stop1","1","0","0"\n');
    mockedStream.push('"tripA","08:10:00","08:15:00","stop2","2","0","0"\n');
    mockedStream.push(null);

    const validTripIds: TripIdsMap = new Map([
      ['tripA', 'routeA'],
      ['tripB', 'routeA'],
    ]);
    const validStopIds: StopIds = new Set(['stop1', 'stop2']);

    const routes = await parseStopTimes(
      mockedStream,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(
      routes,
      new Map([
        [
          'routeA_1e0e4u3',
          {
            serviceRouteId: 'routeA',
            stops: ['stop1', 'stop2'],
            stopIndices: new Map([
              ['stop1', 0],
              ['stop2', 1],
            ]),
            stopTimes: [
              {
                arrival: Time.fromHMS(8, 0, 0),
                departure: Time.fromHMS(8, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(8, 10, 0),
                departure: Time.fromHMS(8, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(9, 0, 0),
                departure: Time.fromHMS(9, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(9, 10, 0),
                departure: Time.fromHMS(9, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
          },
        ],
      ]),
    );
  });

  it('should create distinct route for same GTFS route with different stops', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
    );
    mockedStream.push('"tripA","08:00:00","08:05:00","stop1","1","0","0"\n');
    mockedStream.push('"tripA","08:10:00","08:15:00","stop2","2","0","0"\n');
    mockedStream.push('"tripB","09:00:00","09:15:00","stop1","1","0","0"\n');
    mockedStream.push(null);

    const validTripIds: TripIdsMap = new Map([
      ['tripA', 'routeA'],
      ['tripB', 'routeA'],
    ]);
    const validStopIds: StopIds = new Set(['stop1', 'stop2']);

    const routes = await parseStopTimes(
      mockedStream,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(
      routes,
      new Map([
        [
          'routeA_1e0e4u3',
          {
            serviceRouteId: 'routeA',
            stops: ['stop1', 'stop2'],
            stopIndices: new Map([
              ['stop1', 0],
              ['stop2', 1],
            ]),
            stopTimes: [
              {
                arrival: Time.fromHMS(8, 0, 0),
                departure: Time.fromHMS(8, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                arrival: Time.fromHMS(8, 10, 0),
                departure: Time.fromHMS(8, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
          },
        ],
        [
          'routeA_1tcrqn',
          {
            serviceRouteId: 'routeA',
            stops: ['stop1'],
            stopIndices: new Map([['stop1', 0]]),
            stopTimes: [
              {
                arrival: Time.fromHMS(9, 0, 0),
                departure: Time.fromHMS(9, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
          },
        ],
      ]),
    );
  });

  it('should throw an error for non-increasing stop sequences', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
    );
    mockedStream.push('"tripA","08:00:00","08:05:00","stop1","2","0","0"\n');
    mockedStream.push('"tripA","08:10:00","08:15:00","stop2","1","0","0"\n');
    mockedStream.push(null);

    const validTripIds: TripIdsMap = new Map([['tripA', 'routeA']]);
    const validStopIds: StopIds = new Set(['stop1', 'stop2']);

    const routes = await parseStopTimes(
      mockedStream,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(
      routes,
      new Map([
        [
          'routeA_1tcrqn',
          {
            serviceRouteId: 'routeA',
            stops: ['stop1'],
            stopIndices: new Map([['stop1', 0]]),
            stopTimes: [
              {
                arrival: Time.fromHMS(8, 0, 0),
                departure: Time.fromHMS(8, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
          },
        ],
      ]),
    );
  });
});
