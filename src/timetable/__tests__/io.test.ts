import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Duration } from '../duration.js';
import {
  deserializeRoutesAdjacency,
  deserializeServiceRoutesMap,
  deserializeStopsAdjacency,
  serializeRoutesAdjacency,
  serializeServiceRoutesMap,
  serializeStopsAdjacency,
} from '../io.js';
import { REGULAR, Route } from '../route.js';
import { Time } from '../time.js';
import { ServiceRoutesMap, StopsAdjacency } from '../timetable.js';

describe('Timetable IO', () => {
  const stopsAdjacency: StopsAdjacency = new Map([
    [
      1,
      {
        transfers: [{ destination: 2, type: 'RECOMMENDED' }],
        routes: [0],
      },
    ],
    [
      2,
      {
        transfers: [
          {
            destination: 1,
            type: 'GUARANTEED',
            minTransferTime: Duration.fromMinutes(3),
          },
        ],
        routes: [1],
      },
    ],
  ]);
  const routesAdjacency = [
    new Route(
      new Uint16Array([
        Time.fromHMS(16, 40, 0).toMinutes(),
        Time.fromHMS(16, 50, 0).toMinutes(),
      ]),
      new Uint8Array([REGULAR, REGULAR]),
      new Uint32Array([1, 2]),
      'gtfs1',
    ),
    new Route(
      new Uint16Array([
        Time.fromHMS(15, 20, 0).toMinutes(),
        Time.fromHMS(15, 30, 0).toMinutes(),
      ]),
      new Uint8Array([REGULAR, REGULAR]),
      new Uint32Array([2, 1]),
      'gtfs2',
    ),
  ];
  const routes: ServiceRoutesMap = new Map([
    ['gtfs1', { type: 'RAIL', name: 'Route 1', routes: [0] }],
    ['gtfs2', { type: 'RAIL', name: 'Route 2', routes: [1] }],
  ]);
  const stopsAdjacencyProto = {
    stops: {
      '1': {
        transfers: [{ destination: 2, type: 0 }],
        routes: [0],
      },
      '2': {
        transfers: [
          {
            destination: 1,
            type: 1,
            minTransferTime: 180,
          },
        ],
        routes: [1],
      },
    },
  };

  const routesAdjacencyProto = [
    {
      stopTimes: new Uint8Array(
        new Uint16Array([
          Time.fromHMS(16, 40, 0).toMinutes(),
          Time.fromHMS(16, 50, 0).toMinutes(),
        ]).buffer,
      ),
      pickUpDropOffTypes: new Uint8Array([REGULAR, REGULAR]),
      stops: new Uint8Array(new Uint32Array([1, 2]).buffer),
      serviceRouteId: 'gtfs1',
    },
    {
      stopTimes: new Uint8Array(
        new Uint16Array([
          Time.fromHMS(15, 20, 0).toMinutes(),
          Time.fromHMS(15, 30, 0).toMinutes(),
        ]).buffer,
      ),
      pickUpDropOffTypes: new Uint8Array([REGULAR, REGULAR]),
      stops: new Uint8Array(new Uint32Array([2, 1]).buffer),
      serviceRouteId: 'gtfs2',
    },
  ];

  const routesProto = {
    routes: {
      gtfs1: { type: 2, name: 'Route 1', routes: [0] },
      gtfs2: { type: 2, name: 'Route 2', routes: [1] },
    },
  };

  it('should serialize a stops adjacency matrix to a Uint8Array', () => {
    const serializedData = serializeStopsAdjacency(stopsAdjacency);
    assert.deepStrictEqual(serializedData, stopsAdjacencyProto);
  });

  it('should deserialize a Uint8Array to a stops adjacency matrix', () => {
    const serializedData = serializeStopsAdjacency(stopsAdjacency);
    const deserializedData = deserializeStopsAdjacency(serializedData);
    assert.deepStrictEqual(deserializedData, stopsAdjacency);
  });

  it('should serialize a routes adjacency matrix to a Uint8Array', () => {
    const serializedData = serializeRoutesAdjacency(routesAdjacency);
    assert.deepStrictEqual(serializedData, routesAdjacencyProto);
  });

  it('should deserialize a Uint8Array to a routes adjacency matrix', () => {
    const serializedData = serializeRoutesAdjacency(routesAdjacency);
    const deserializedData = deserializeRoutesAdjacency(serializedData);
    assert.deepStrictEqual(deserializedData, routesAdjacency);
  });

  it('should serialize a service route map to a Uint8Array', () => {
    const serializedData = serializeServiceRoutesMap(routes);
    assert.deepStrictEqual(serializedData, routesProto);
  });

  it('should deserialize a Uint8Array to a service route map', () => {
    const serializedData = serializeServiceRoutesMap(routes);
    const deserializedData = deserializeServiceRoutesMap(serializedData);
    assert.deepStrictEqual(deserializedData, routes);
  });
});
