import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  deserializeRoutesAdjacency,
  deserializeServiceRoutesMap,
  deserializeStopsAdjacency,
  deserializeTransfers,
  deserializeTripTransfers,
  serializeRoutesAdjacency,
  serializeServiceRoutesMap,
  serializeStopsAdjacency,
  serializeTransfers,
  serializeTripTransfers,
} from '../io.js';
import { PickUpDropOffTypes, Route } from '../route.js';
import { timeFromHMS } from '../time.js';
import {
  createStopAdjacency,
  RouteTypes,
  ServiceRoute,
  StopAdjacency,
  TransferTypes,
  TripStop,
} from '../timetable.js';
import { encode } from '../tripStopId.js';

describe('Timetable IO', () => {
  const stopsAdjacency: StopAdjacency[] = [
    createStopAdjacency([0], [0]),
    createStopAdjacency([1], [1]),
  ];
  const transfers = [
    { from: 0, destination: 2, type: TransferTypes.RECOMMENDED },
    {
      from: 1,
      destination: 1,
      type: TransferTypes.GUARANTEED,
      minTransferTime: 3,
    },
  ];
  const routesAdjacency = [
    new Route(
      0,
      new Uint16Array([timeFromHMS(16, 40, 0), timeFromHMS(16, 50, 0)]),
      new Uint8Array([PickUpDropOffTypes.REGULAR, PickUpDropOffTypes.REGULAR]),
      new Uint32Array([1, 2]),
      0,
    ),
    new Route(
      1,
      new Uint16Array([timeFromHMS(15, 20, 0), timeFromHMS(15, 30, 0)]),
      new Uint8Array([PickUpDropOffTypes.REGULAR, PickUpDropOffTypes.REGULAR]),
      new Uint32Array([2, 1]),
      1,
    ),
  ];
  const routes: ServiceRoute[] = [
    { type: RouteTypes.RAIL, name: 'Route 1', routes: [0] },
    { type: RouteTypes.RAIL, name: 'Route 2', routes: [1] },
  ];
  const stopsAdjacencyProto = [
    {
      routeIds: new Uint8Array(new Uint32Array([0]).buffer),
      transferIds: new Uint8Array(new Uint32Array([0]).buffer),
    },
    {
      routeIds: new Uint8Array(new Uint32Array([1]).buffer),
      transferIds: new Uint8Array(new Uint32Array([1]).buffer),
    },
  ];

  const routesAdjacencyProto = [
    {
      stopTimes: new Uint8Array(
        new Uint16Array([timeFromHMS(16, 40, 0), timeFromHMS(16, 50, 0)])
          .buffer,
      ),
      pickupDropOffTypes: new Uint8Array([
        PickUpDropOffTypes.REGULAR,
        PickUpDropOffTypes.REGULAR,
      ]),
      stops: new Uint8Array(new Uint32Array([1, 2]).buffer),
      serviceRouteId: 0,
    },
    {
      stopTimes: new Uint8Array(
        new Uint16Array([timeFromHMS(15, 20, 0), timeFromHMS(15, 30, 0)])
          .buffer,
      ),
      pickupDropOffTypes: new Uint8Array([
        PickUpDropOffTypes.REGULAR,
        PickUpDropOffTypes.REGULAR,
      ]),
      stops: new Uint8Array(new Uint32Array([2, 1]).buffer),
      serviceRouteId: 1,
    },
  ];

  const routesProto = [
    { type: 3, name: 'Route 1', routes: [0] },
    { type: 3, name: 'Route 2', routes: [1] },
  ];

  it('should serialize a stops adjacency matrix to a Uint8Array', () => {
    const serializedData = serializeStopsAdjacency(stopsAdjacency);
    assert.deepStrictEqual(serializedData, stopsAdjacencyProto);
  });

  it('should deserialize a Uint8Array to a stops adjacency matrix', () => {
    const serializedData = serializeStopsAdjacency(stopsAdjacency);
    const deserializedData = deserializeStopsAdjacency(serializedData);
    assert.deepStrictEqual(deserializedData, stopsAdjacency);
  });

  it('should serialize and deserialize transfers correctly', () => {
    const serialized = serializeTransfers(transfers);
    const deserialized = deserializeTransfers(serialized);

    assert.deepStrictEqual(deserialized, transfers);
  });

  it('should serialize and deserialize tripContinuations correctly', () => {
    const tripContinuations = new Map<bigint, TripStop[]>();
    tripContinuations.set(encode(1, 0, 2), [
      { stopIndex: 1, routeId: 0, tripIndex: 2 },
      { stopIndex: 3, routeId: 1, tripIndex: 1 },
    ]);
    tripContinuations.set(encode(2, 0, 0), [
      { stopIndex: 2, routeId: 0, tripIndex: 0 },
    ]);

    const serialized = serializeTripTransfers(tripContinuations);
    const deserialized = deserializeTripTransfers(serialized);

    assert.deepStrictEqual(deserialized, tripContinuations);
  });

  it('should handle empty StopAdjacency without transfers or tripContinuations', () => {
    const emptyStopsAdjacency: StopAdjacency[] = [
      createStopAdjacency([0]),
      createStopAdjacency([1]),
    ];

    const serialized = serializeStopsAdjacency(emptyStopsAdjacency);
    const deserialized = deserializeStopsAdjacency(serialized);

    assert.deepStrictEqual(deserialized, emptyStopsAdjacency);
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
