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
import { Time } from '../time.js';
import {
  RoutesAdjacency,
  ServiceRoutesMap,
  StopsAdjacency,
} from '../timetable.js';

describe('timetable io', () => {
  const stopsAdjacency: StopsAdjacency = new Map([
    [
      'stop1',
      {
        transfers: [{ destination: 'stop2', type: 'RECOMMENDED' }],
        routes: ['route1'],
      },
    ],
    [
      'stop2',
      {
        transfers: [
          {
            destination: 'stop1',
            type: 'GUARANTEED',
            minTransferTime: Duration.fromMinutes(3),
          },
        ],
        routes: ['route2'],
      },
    ],
  ]);
  const routesAdjacency: RoutesAdjacency = new Map([
    [
      'route1',
      {
        stopTimes: [
          {
            arrival: Time.fromSeconds(1000),
            departure: Time.fromSeconds(1010),
            pickUpType: 'REGULAR',
            dropOffType: 'REGULAR',
          },
        ],
        stops: ['stop1', 'stop2'],
        stopIndices: new Map([
          ['stop1', 0],
          ['stop2', 1],
        ]),
        serviceRouteId: 'gtfs1',
      },
    ],
    [
      'route2',
      {
        stopTimes: [
          {
            arrival: Time.fromSeconds(2000),
            departure: Time.fromSeconds(2010),
            pickUpType: 'REGULAR',
            dropOffType: 'REGULAR',
          },
        ],
        stops: ['stop2', 'stop1'],
        stopIndices: new Map([
          ['stop2', 0],
          ['stop1', 1],
        ]),
        serviceRouteId: 'gtfs2',
      },
    ],
  ]);
  const routes: ServiceRoutesMap = new Map([
    ['gtfs1', { type: 'RAIL', name: 'Route 1' }],
    ['gtfs2', { type: 'RAIL', name: 'Route 2' }],
  ]);

  const stopsAdjacencyProto = {
    stops: {
      stop1: {
        transfers: [{ destination: 'stop2', type: 0 }],
        routes: ['route1'],
      },
      stop2: {
        transfers: [
          {
            destination: 'stop1',
            type: 1,
            minTransferTime: 180,
          },
        ],
        routes: ['route2'],
      },
    },
  };

  const routesAdjacencyProto = {
    routes: {
      route1: {
        stopTimes: [
          {
            arrival: 1000,
            departure: 1010,
            pickUpType: undefined,
            dropOffType: undefined,
          },
        ],
        stops: ['stop1', 'stop2'],
        serviceRouteId: 'gtfs1',
      },
      route2: {
        stopTimes: [
          {
            arrival: 2000,
            departure: 2010,
            pickUpType: undefined,
            dropOffType: undefined,
          },
        ],
        stops: ['stop2', 'stop1'],
        serviceRouteId: 'gtfs2',
      },
    },
  };

  const routesProto = {
    routes: {
      gtfs1: { type: 2, name: 'Route 1' },
      gtfs2: { type: 2, name: 'Route 2' },
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
