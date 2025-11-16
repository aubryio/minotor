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
  GtfsTripIdsMap,
  parseStopTimes,
  parseTrips,
} from '../trips.js';

describe('buildStopsAdjacencyStructure', () => {
  it('should correctly build stops adjacency for valid routes and transfers', () => {
    const validStops: Set<StopId> = new Set([0]);
    const routes = [
      Route.of({
        id: 0,
        serviceRouteId: 0,
        trips: [
          {
            stops: [
              {
                id: 0,
                arrivalTime: Time.fromHMS(8, 0, 0),
                departureTime: Time.fromHMS(8, 0, 0),
              },
              {
                id: 1,
                arrivalTime: Time.fromHMS(8, 5, 0),
                departureTime: Time.fromHMS(8, 5, 0),
              },
            ],
          },
        ],
      }),
    ];
    const transfersMap: TransfersMap = new Map([
      [0, [{ destination: 1, type: 'RECOMMENDED' }]],
    ]);

    const serviceRoutes: ServiceRoute[] = [
      { type: 'BUS', name: 'B1', routes: [] },
    ];

    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routes,
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
        },
      ],
    ]);
    assert.deepEqual(serviceRoutes[0]?.routes, [0]);
  });

  it('should ignore transfers to invalid stops', () => {
    const validStops: Set<StopId> = new Set([0, 1]);
    const routes = [
      Route.of({
        id: 0,
        serviceRouteId: 0,
        trips: [
          {
            stops: [
              {
                id: 0,
                arrivalTime: Time.fromHMS(8, 0, 0),
                departureTime: Time.fromHMS(8, 0, 0),
              },
              {
                id: 1,
                arrivalTime: Time.fromHMS(8, 5, 0),
                departureTime: Time.fromHMS(8, 5, 0),
              },
            ],
          },
        ],
      }),
    ];
    const transfersMap: TransfersMap = new Map([
      [3, [{ destination: 2, type: 'RECOMMENDED' }]],
    ]);
    const serviceRoutes: ServiceRoute[] = [
      { type: 'BUS', name: 'B1', routes: [] },
    ];

    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routes,
      transfersMap,
      4,
      validStops,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        0,
        {
          routes: [0],
        },
      ],
      [
        1,
        {
          routes: [0],
        },
      ],
      [
        2,
        {
          routes: [],
        },
      ],
      [
        3,
        {
          routes: [],
        },
      ],
    ]);
    assert.deepEqual(serviceRoutes[0]?.routes, [0]);
  });

  it('should correctly handle trip continuations', () => {
    const validStops: Set<StopId> = new Set([0, 1]);
    const routes = [
      Route.of({
        id: 0,
        serviceRouteId: 0,
        trips: [
          {
            stops: [
              {
                id: 0,
                arrivalTime: Time.fromHMS(8, 0, 0),
                departureTime: Time.fromHMS(8, 0, 0),
              },
            ],
          },
        ],
      }),
      Route.of({
        id: 1,
        serviceRouteId: 0,
        trips: [
          {
            stops: [
              {
                id: 1,
                arrivalTime: Time.fromHMS(8, 30, 0),
                departureTime: Time.fromHMS(8, 30, 0),
              },
            ],
          },
        ],
      }),
    ];
    const transfersMap: TransfersMap = new Map();
    const serviceRoutes: ServiceRoute[] = [
      { type: 'BUS', name: 'B1', routes: [] },
    ];

    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routes,
      transfersMap,
      2,
      validStops,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        0,
        {
          routes: [0],
        },
      ],
      [
        1,
        {
          routes: [1],
        },
      ],
    ]);
  });

  it('should ignore trip continuations with invalid trip IDs', () => {
    const validStops: Set<StopId> = new Set([0]);
    const routes = [
      Route.of({
        id: 0,
        serviceRouteId: 0,
        trips: [
          {
            stops: [
              {
                id: 0,
                arrivalTime: Time.fromHMS(8, 0, 0),
                departureTime: Time.fromHMS(8, 0, 0),
              },
            ],
          },
        ],
      }),
    ];
    const transfersMap: TransfersMap = new Map();
    const serviceRoutes: ServiceRoute[] = [
      { type: 'BUS', name: 'B1', routes: [] },
    ];

    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routes,
      transfersMap,
      1,
      validStops,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        0,
        {
          routes: [0],
        },
      ],
    ]);
  });

  it('should ignore trip continuations for inactive stops', () => {
    const validStops: Set<StopId> = new Set([0]); // Only stop 0 is active
    const routes = [
      Route.of({
        id: 0,
        serviceRouteId: 0,
        trips: [
          {
            stops: [
              {
                id: 0,
                arrivalTime: Time.fromHMS(8, 0, 0),
                departureTime: Time.fromHMS(8, 0, 0),
              },
            ],
          },
        ],
      }),
    ];
    const transfersMap: TransfersMap = new Map();
    const serviceRoutes: ServiceRoute[] = [
      { type: 'BUS', name: 'B1', routes: [] },
    ];

    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routes,
      transfersMap,
      4,
      validStops,
    );

    assert.deepEqual(Array.from(stopsAdjacency.entries()), [
      [
        0,
        {
          routes: [0],
        },
      ],
      [
        1,
        {
          routes: [],
        },
      ],
      [
        2,
        {
          routes: [],
        },
      ],
      [
        3,
        {
          routes: [],
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
        0,
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
    assert.deepEqual(
      result.tripsMapping,
      new Map([['tripA', { routeId: 0, tripRouteIndex: 0 }]]),
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
        0,
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
    assert.deepEqual(
      result.tripsMapping,
      new Map([
        ['tripA', { routeId: 0, tripRouteIndex: 0 }],
        ['tripB', { routeId: 0, tripRouteIndex: 1 }],
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
        0,
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
        0,
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
        1,
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
        0,
        new Uint16Array([
          Time.fromHMS(8, 0, 0).toMinutes(),
          Time.fromHMS(8, 5, 0).toMinutes(),
        ]),
        encodePickUpDropOffTypes([REGULAR], [REGULAR]),
        new Uint32Array([0]),
        0,
      ),
    ]);
    assert.deepEqual(
      result.tripsMapping,
      new Map([['tripA', { routeId: 0, tripRouteIndex: 0 }]]),
    );
  });

  it('should create trip continuations mapping correctly', async () => {
    const mockedStream = new Readable();
    mockedStream.push(
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n',
    );
    mockedStream.push('"trip1","08:00:00","08:05:00","stop1","1","0","0"\n');
    mockedStream.push('"trip1","08:10:00","08:15:00","stop2","2","0","0"\n');
    mockedStream.push('"trip2","09:00:00","09:05:00","stop3","1","0","0"\n');
    mockedStream.push(null);

    const validTripIds: GtfsTripIdsMap = new Map([
      ['trip1', 'routeA'],
      ['trip2', 'routeB'],
    ]);
    const validStopIds: Set<StopId> = new Set([0, 1, 2]);
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

    const result = await parseStopTimes(
      mockedStream,
      stopsMap,
      validTripIds,
      validStopIds,
    );

    assert.deepEqual(
      result.tripsMapping,
      new Map([
        ['trip1', { routeId: 0, tripRouteIndex: 0 }],
        ['trip2', { routeId: 1, tripRouteIndex: 0 }],
      ]),
    );
    assert.deepEqual(
      result.serviceRoutesMap,
      new Map([
        ['routeA', 0],
        ['routeB', 1],
      ]),
    );
  });
});
