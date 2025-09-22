import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { StopId } from '../../stops/stops.js';
import { REGULAR, Route } from '../../timetable/route.js';
import { Time } from '../../timetable/time.js';
import { ServiceRoute } from '../../timetable/timetable.js';
import { GtfsRoutesMap } from '../routes.js';
import { ServiceIds } from '../services.js';
import { GtfsStopsMap } from '../stops.js';
import { TransfersMap } from '../transfers.js';
import {
  buildStopsAdjacencyStructure,
  encodePickUpDropOffTypes,
  parseStopTimes,
  parseTrips,
  GtfsTripIdsMap,
} from '../trips.js';

describe('buildStopsAdjacencyStructure', () => {
  it('should correctly build stops adjacency for valid routes and transfers', () => {
    const validStops: Set<StopId> = new Set([0]);
    const routesAdjacency = [
      new Route(
        new Uint16Array(),
        new Uint8Array(),
        new Uint32Array([0, 1]),
        0,
      ),
    ];
    const transfersMap: TransfersMap = new Map([
      [0, [{ destination: 1, type: 'RECOMMENDED' }]],
    ]);
    const serviceRoutes: ServiceRoute[] = [
      { type: 'BUS', name: 'B1', routes: [] },
    ];

    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routesAdjacency,
      transfersMap,
      2,
      validStops,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        0,
        {
          routes: [0],
          transfers: [
            {
              destination: 1,
              type: 'RECOMMENDED',
            },
          ],
        },
      ],
      [
        1,
        {
          routes: [],
          transfers: [],
        },
      ],
    ]);
    assert.deepEqual(serviceRoutes[0]?.routes, [0]);
  });

  it('should ignore transfers to invalid stops', () => {
    const validStops: Set<StopId> = new Set([0, 1]);
    const routesAdjacency = [
      new Route(
        new Uint16Array(),
        new Uint8Array(),
        new Uint32Array([0, 1]),
        0,
      ),
    ];
    const transfersMap: TransfersMap = new Map([
      [3, [{ destination: 2, type: 'RECOMMENDED' }]],
    ]);
    const serviceRoutes: ServiceRoute[] = [
      { type: 'BUS', name: 'B1', routes: [] },
    ];

    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routesAdjacency,
      transfersMap,
      4,
      validStops,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        0,
        {
          routes: [0],
          transfers: [],
        },
      ],
      [
        1,
        {
          routes: [0],
          transfers: [],
        },
      ],
      [
        2,
        {
          routes: [],
          transfers: [],
        },
      ],
      [
        3,
        {
          routes: [],
          transfers: [],
        },
      ],
    ]);
    assert.deepEqual(serviceRoutes[0]?.routes, [0]);
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
    const validRouteIds: GtfsRoutesMap = new Map([
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
    const validRouteIds: GtfsRoutesMap = new Map([
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
    const validRouteIds: GtfsRoutesMap = new Map([
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

    const validTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const validStopIds: Set<StopId> = new Set([0, 1]);
    const stopsMap: GtfsStopsMap = new Map([
      [
        'stop1',
        {
          id: 0,
          sourceStopId: 'stop1',
          name: 'Stop 1',
          children: [],
          locationType: 'SIMPLE_STOP_OR_PLATFORM',
          lat: 36.425288,
          lon: -117.133162,
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
          lat: 36.868446,
          lon: -116.784582,
        },
      ],
    ]);
    const result = await parseStopTimes(
      mockedStream,
      stopsMap,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(result.routes, [
      new Route(
        new Uint16Array([
          Time.fromHMS(8, 0, 0).toMinutes(),
          Time.fromHMS(8, 5, 0).toMinutes(),
          Time.fromHMS(8, 10, 0).toMinutes(),
          Time.fromHMS(8, 15, 0).toMinutes(),
        ]),
        encodePickUpDropOffTypes([REGULAR, REGULAR], [REGULAR, REGULAR]),
        new Uint32Array([0, 1]),
        0,
      ),
    ]);
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

    const validTripIds: GtfsTripIdsMap = new Map([
      ['tripA', 'routeA'],
      ['tripB', 'routeA'],
    ]);
    const validStopIds: Set<StopId> = new Set([0, 1]);
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

    const result = await parseStopTimes(
      mockedStream,
      stopsMap,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(result.routes, [
      new Route(
        new Uint16Array([
          Time.fromHMS(8, 0, 0).toMinutes(),
          Time.fromHMS(8, 5, 0).toMinutes(),
          Time.fromHMS(8, 10, 0).toMinutes(),
          Time.fromHMS(8, 15, 0).toMinutes(),
          Time.fromHMS(9, 0, 0).toMinutes(),
          Time.fromHMS(9, 5, 0).toMinutes(),
          Time.fromHMS(9, 10, 0).toMinutes(),
          Time.fromHMS(9, 15, 0).toMinutes(),
        ]),
        encodePickUpDropOffTypes(
          [REGULAR, REGULAR, REGULAR, REGULAR],
          [REGULAR, REGULAR, REGULAR, REGULAR],
        ),
        new Uint32Array([0, 1]),
        0,
      ),
    ]);
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

    const validTripIds: GtfsTripIdsMap = new Map([
      ['tripA', 'routeA'],
      ['tripB', 'routeA'],
    ]);
    const validStopIds: Set<StopId> = new Set([0, 1]);
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

    const result = await parseStopTimes(
      mockedStream,
      stopsMap,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(result.routes, [
      new Route(
        new Uint16Array([
          Time.fromHMS(8, 0, 0).toMinutes(),
          Time.fromHMS(8, 5, 0).toMinutes(),
          Time.fromHMS(8, 10, 0).toMinutes(),
          Time.fromHMS(8, 15, 0).toMinutes(),
          Time.fromHMS(9, 0, 0).toMinutes(),
          Time.fromHMS(9, 5, 0).toMinutes(),
          Time.fromHMS(9, 10, 0).toMinutes(),
          Time.fromHMS(9, 15, 0).toMinutes(),
        ]),
        encodePickUpDropOffTypes(
          [REGULAR, REGULAR, REGULAR, REGULAR],
          [REGULAR, REGULAR, REGULAR, REGULAR],
        ),
        new Uint32Array([0, 1]),
        0,
      ),
    ]);
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

    const validTripIds: GtfsTripIdsMap = new Map([
      ['tripA', 'routeA'],
      ['tripB', 'routeA'],
    ]);
    const validStopIds: Set<StopId> = new Set([0, 1]);
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

    const result = await parseStopTimes(
      mockedStream,
      stopsMap,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(result.routes, [
      new Route(
        new Uint16Array([
          Time.fromHMS(8, 0, 0).toMinutes(),
          Time.fromHMS(8, 5, 0).toMinutes(),
          Time.fromHMS(8, 10, 0).toMinutes(),
          Time.fromHMS(8, 15, 0).toMinutes(),
        ]),
        encodePickUpDropOffTypes([REGULAR, REGULAR], [REGULAR, REGULAR]),
        new Uint32Array([0, 1]),
        0,
      ),
      new Route(
        new Uint16Array([
          Time.fromHMS(9, 0, 0).toMinutes(),
          Time.fromHMS(9, 15, 0).toMinutes(),
        ]),
        encodePickUpDropOffTypes([REGULAR], [REGULAR]),
        new Uint32Array([0]),
        0,
      ),
    ]);
  });

  it('should ignore non-increasing stop sequences', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
    );
    mockedStream.push('"tripA","08:00:00","08:05:00","stop1","2","0","0"\n');
    mockedStream.push('"tripA","08:10:00","08:15:00","stop2","1","0","0"\n');
    mockedStream.push(null);

    const validTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const validStopIds: Set<StopId> = new Set([0, 1]);
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

    const result = await parseStopTimes(
      mockedStream,
      stopsMap,
      validTripIds,
      validStopIds,
    );
    assert.deepEqual(result.routes, [
      new Route(
        new Uint16Array([
          Time.fromHMS(8, 0, 0).toMinutes(),
          Time.fromHMS(8, 5, 0).toMinutes(),
        ]),
        encodePickUpDropOffTypes([REGULAR], [REGULAR]),
        new Uint32Array([0]),
        0,
      ),
    ]);
  });
});
