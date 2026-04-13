import {
  Route as ProtoRoute,
  RouteType as ProtoRouteType,
  ServiceRoute as ProtoServiceRoute,
  StopAdjacency as ProtoStopAdjacency,
  TransferType as ProtoTransferType,
  TripTransferEntry as ProtoTripTransferEntry,
} from './proto/v1/timetable.js';
import { Route } from './route.js';
import {
  RouteType,
  ServiceRoute,
  ServiceRouteId,
  StopAdjacency,
  Transfer,
  TransferType,
  TripStop,
  TripTransfers,
} from './timetable.js';
import { decode, encode, TripStopId } from './tripStopId.js';

export type SerializedRoute = {
  stopTimes: Uint16Array;
  pickupDropOffTypes: Uint8Array;
  stops: Uint32Array;
  serviceRouteId: ServiceRouteId;
};

const isLittleEndian = (() => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, 0x12345678);
  return new Uint8Array(buffer)[0] === 0x78;
})();

const STANDARD_ENDIANNESS = true; // true = little-endian

const uint32ArrayToBytes = (array: Uint32Array): Uint8Array => {
  if (isLittleEndian === STANDARD_ENDIANNESS) {
    return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  }

  // If endianness doesn't match, we need to swap byte order
  const result = new Uint8Array(array.length * 4);
  const view = new DataView(result.buffer);

  for (let i = 0; i < array.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    view.setUint32(i * 4, array[i]!, STANDARD_ENDIANNESS);
  }

  return result;
};

const bytesToUint32Array = (bytes: Uint8Array): Uint32Array => {
  if (bytes.byteLength % 4 !== 0) {
    throw new Error(
      'Byte array length must be a multiple of 4 to convert to Uint32Array',
    );
  }

  // If system endianness matches our standard, we can create a view directly
  if (isLittleEndian === STANDARD_ENDIANNESS) {
    return new Uint32Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 4,
    );
  }

  // If endianness doesn't match, we need to swap byte order
  const result = new Uint32Array(bytes.byteLength / 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < result.length; i++) {
    result[i] = view.getUint32(i * 4, STANDARD_ENDIANNESS);
  }

  return result;
};

const uint16ArrayToBytes = (array: Uint16Array): Uint8Array => {
  if (isLittleEndian === STANDARD_ENDIANNESS) {
    return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  }

  // If endianness doesn't match, we need to swap byte order
  const result = new Uint8Array(array.length * 2);
  const view = new DataView(result.buffer);

  for (let i = 0; i < array.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    view.setUint16(i * 2, array[i]!, STANDARD_ENDIANNESS);
  }

  return result;
};

const bytesToUint16Array = (bytes: Uint8Array): Uint16Array => {
  if (bytes.byteLength % 2 !== 0) {
    throw new Error(
      'Byte array length must be a multiple of 2 to convert to Uint16Array',
    );
  }

  // If system endianness matches our standard, we can create a view directly
  if (isLittleEndian === STANDARD_ENDIANNESS) {
    return new Uint16Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength / 2,
    );
  }

  // If endianness doesn't match, we need to swap byte order
  const result = new Uint16Array(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < result.length; i++) {
    result[i] = view.getUint16(i * 2, STANDARD_ENDIANNESS);
  }

  return result;
};

export const serializeStopsAdjacency = (
  stopsAdjacency: StopAdjacency[],
): ProtoStopAdjacency[] => {
  return stopsAdjacency.map((value) => {
    return {
      transfers: value.transfers
        ? value.transfers.map((transfer) => ({
            destination: transfer.destination,
            type: serializeTransferType(transfer.type),
            ...(transfer.minTransferTime !== undefined && {
              minTransferTime: transfer.minTransferTime,
            }),
          }))
        : [],
      routes: value.routes,
    };
  });
};

export const serializeRoutesAdjacency = (
  routesAdjacency: Route[],
): ProtoRoute[] => {
  const protoRoutesAdjacency: ProtoRoute[] = [];

  routesAdjacency.forEach((route: Route) => {
    const routeData = route.serialize();
    protoRoutesAdjacency.push({
      stopTimes: uint16ArrayToBytes(routeData.stopTimes),
      pickupDropOffTypes: routeData.pickupDropOffTypes,
      stops: uint32ArrayToBytes(routeData.stops),
      serviceRouteId: routeData.serviceRouteId,
    });
  });

  return protoRoutesAdjacency;
};

export const serializeServiceRoutesMap = (
  serviceRoutes: ServiceRoute[],
): ProtoServiceRoute[] => {
  return serviceRoutes.map((value) => {
    return {
      type: serializeRouteType(value.type),
      name: value.name,
      routes: value.routes,
    };
  });
};

export const deserializeStopsAdjacency = (
  protoStopsAdjacency: ProtoStopAdjacency[],
): StopAdjacency[] => {
  const result: StopAdjacency[] = [];

  for (let i = 0; i < protoStopsAdjacency.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const value = protoStopsAdjacency[i]!;
    const transfers: Transfer[] = [];

    for (let j = 0; j < value.transfers.length; j++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const transfer = value.transfers[j]!;
      const newTransfer: Transfer = {
        destination: transfer.destination,
        type: parseTransferType(transfer.type),
        ...(transfer.minTransferTime !== undefined && {
          minTransferTime: transfer.minTransferTime,
        }),
      };
      transfers.push(newTransfer);
    }

    const stopAdjacency: StopAdjacency = {
      routes: value.routes,
    };

    if (transfers.length > 0) {
      stopAdjacency.transfers = transfers;
    }

    result.push(stopAdjacency);
  }

  return result;
};

export const deserializeRoutesAdjacency = (
  protoRoutesAdjacency: ProtoRoute[],
): Route[] => {
  const routesAdjacency: Route[] = [];

  for (let i = 0; i < protoRoutesAdjacency.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const value = protoRoutesAdjacency[i]!;
    const stops = bytesToUint32Array(value.stops);
    routesAdjacency.push(
      new Route(
        i,
        bytesToUint16Array(value.stopTimes),
        value.pickupDropOffTypes,
        stops,
        value.serviceRouteId,
      ),
    );
  }

  return routesAdjacency;
};

export const deserializeServiceRoutesMap = (
  protoServiceRoutes: ProtoServiceRoute[],
): ServiceRoute[] => {
  const result: ServiceRoute[] = [];

  for (let i = 0; i < protoServiceRoutes.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const value = protoServiceRoutes[i]!;
    result.push({
      type: parseRouteType(value.type),
      name: value.name,
      routes: value.routes,
    });
  }

  return result;
};

const parseTransferType = (type: ProtoTransferType): TransferType => {
  switch (type) {
    case ProtoTransferType.TRANSFER_TYPE_UNSPECIFIED:
      throw new Error('Unspecified protobuf transfer type.');
    case ProtoTransferType.TRANSFER_TYPE_RECOMMENDED_TRANSFER_POINT:
      return 'RECOMMENDED';
    case ProtoTransferType.TRANSFER_TYPE_TIMED_TRANSFER:
      return 'GUARANTEED';
    case ProtoTransferType.TRANSFER_TYPE_REQUIRES_MINIMAL_TIME:
      return 'REQUIRES_MINIMAL_TIME';
    case ProtoTransferType.TRANSFER_TYPE_IN_SEAT_TRANSFER:
      return 'IN_SEAT';
    case ProtoTransferType.UNRECOGNIZED:
      throw new Error('Unrecognized protobuf transfer type.');
  }
};

const serializeTransferType = (type: TransferType): ProtoTransferType => {
  switch (type) {
    case 'RECOMMENDED':
      return ProtoTransferType.TRANSFER_TYPE_RECOMMENDED_TRANSFER_POINT;
    case 'GUARANTEED':
      return ProtoTransferType.TRANSFER_TYPE_TIMED_TRANSFER;
    case 'REQUIRES_MINIMAL_TIME':
      return ProtoTransferType.TRANSFER_TYPE_REQUIRES_MINIMAL_TIME;
    case 'IN_SEAT':
      return ProtoTransferType.TRANSFER_TYPE_IN_SEAT_TRANSFER;
  }
};

const parseRouteType = (type: ProtoRouteType): RouteType => {
  switch (type) {
    case ProtoRouteType.ROUTE_TYPE_UNSPECIFIED:
      throw new Error('Unspecified protobuf route type.');
    case ProtoRouteType.ROUTE_TYPE_TRAM:
      return 'TRAM';
    case ProtoRouteType.ROUTE_TYPE_SUBWAY:
      return 'SUBWAY';
    case ProtoRouteType.ROUTE_TYPE_RAIL:
      return 'RAIL';
    case ProtoRouteType.ROUTE_TYPE_BUS:
      return 'BUS';
    case ProtoRouteType.ROUTE_TYPE_FERRY:
      return 'FERRY';
    case ProtoRouteType.ROUTE_TYPE_CABLE_TRAM:
      return 'CABLE_TRAM';
    case ProtoRouteType.ROUTE_TYPE_AERIAL_LIFT:
      return 'AERIAL_LIFT';
    case ProtoRouteType.ROUTE_TYPE_FUNICULAR:
      return 'FUNICULAR';
    case ProtoRouteType.ROUTE_TYPE_TROLLEYBUS:
      return 'TROLLEYBUS';
    case ProtoRouteType.ROUTE_TYPE_MONORAIL:
      return 'MONORAIL';
    case ProtoRouteType.UNRECOGNIZED:
    default:
      throw new Error('Unrecognized protobuf route type.');
  }
};

const serializeRouteType = (type: RouteType): ProtoRouteType => {
  switch (type) {
    case 'TRAM':
      return ProtoRouteType.ROUTE_TYPE_TRAM;
    case 'SUBWAY':
      return ProtoRouteType.ROUTE_TYPE_SUBWAY;
    case 'RAIL':
      return ProtoRouteType.ROUTE_TYPE_RAIL;
    case 'BUS':
      return ProtoRouteType.ROUTE_TYPE_BUS;
    case 'FERRY':
      return ProtoRouteType.ROUTE_TYPE_FERRY;
    case 'CABLE_TRAM':
      return ProtoRouteType.ROUTE_TYPE_CABLE_TRAM;
    case 'AERIAL_LIFT':
      return ProtoRouteType.ROUTE_TYPE_AERIAL_LIFT;
    case 'FUNICULAR':
      return ProtoRouteType.ROUTE_TYPE_FUNICULAR;
    case 'TROLLEYBUS':
      return ProtoRouteType.ROUTE_TYPE_TROLLEYBUS;
    case 'MONORAIL':
      return ProtoRouteType.ROUTE_TYPE_MONORAIL;
  }
};

export const serializeTripTransfers = (
  tripTransfers: TripTransfers,
): ProtoTripTransferEntry[] => {
  const result: ProtoTripTransferEntry[] = [];
  for (const [tripBoardingId, destinations] of tripTransfers.entries()) {
    const [originStopIndex, originRouteId, originTripIndex] =
      decode(tripBoardingId);

    result.push({
      origin: {
        stopIndex: originStopIndex,
        routeId: originRouteId,
        tripIndex: originTripIndex,
      },
      destinations: destinations.map((tripStop) => ({
        stopIndex: tripStop.stopIndex,
        routeId: tripStop.routeId,
        tripIndex: tripStop.tripIndex,
      })),
    });
  }

  return result;
};

export const deserializeTripTransfers = (
  protoTripTransfer: ProtoTripTransferEntry[],
): TripTransfers => {
  const result = new Map<TripStopId, TripStop[]>();

  for (let i = 0; i < protoTripTransfer.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entry = protoTripTransfer[i]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const origin = entry.origin!;
    const tripBoardingId = encode(
      origin.stopIndex,
      origin.routeId,
      origin.tripIndex,
    );
    const destinations: TripStop[] = entry.destinations.map(
      (protoTripStop) => ({
        stopIndex: protoTripStop.stopIndex,
        routeId: protoTripStop.routeId,
        tripIndex: protoTripStop.tripIndex,
      }),
    );

    result.set(tripBoardingId, destinations);
  }

  return result;
};
