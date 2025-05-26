import { Duration } from './duration.js';
import {
  RoutesAdjacency as ProtoRoutesAdjacency,
  RouteType as ProtoRouteType,
  ServiceRoutesMap as ProtoServiceRoutesMap,
  StopsAdjacency as ProtoStopsAdjacency,
  Transfer as ProtoTransfer,
  TransferType as ProtoTransferType,
} from './proto/timetable.js';
import {
  Route,
  RoutesAdjacency,
  RouteType,
  ServiceRoutesMap,
  StopsAdjacency,
  Transfer,
  TransferType,
} from './timetable.js';

const isLittleEndian = (() => {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, 0x12345678);
  return new Uint8Array(buffer)[0] === 0x78;
})();

const STANDARD_ENDIANNESS = true; // true = little-endian

function uint32ArrayToBytes(array: Uint32Array): Uint8Array {
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
}

function bytesToUint32Array(bytes: Uint8Array): Uint32Array {
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
}

export const serializeStopsAdjacency = (
  stopsAdjacency: StopsAdjacency,
): ProtoStopsAdjacency => {
  const protoStopsAdjacency: ProtoStopsAdjacency = {
    stops: {},
  };

  stopsAdjacency.forEach(
    (value: { transfers: Transfer[]; routes: string[] }, key: number) => {
      protoStopsAdjacency.stops[key] = {
        transfers: value.transfers.map((transfer) => ({
          destination: transfer.destination,
          type: serializeTransferType(transfer.type),
          ...(transfer.minTransferTime !== undefined && {
            minTransferTime: transfer.minTransferTime.toSeconds(),
          }),
        })),
        routes: value.routes,
      };
    },
  );

  return protoStopsAdjacency;
};

export const serializeRoutesAdjacency = (
  routesAdjacency: RoutesAdjacency,
): ProtoRoutesAdjacency => {
  const protoRoutesAdjacency: ProtoRoutesAdjacency = {
    routes: {},
  };

  routesAdjacency.forEach((value: Route, key: string) => {
    protoRoutesAdjacency.routes[key] = {
      stopTimes: uint32ArrayToBytes(value.stopTimes),
      pickUpDropOffTypes: value.pickUpDropOffTypes,
      stops: uint32ArrayToBytes(value.stops),
      serviceRouteId: value.serviceRouteId,
    };
  });

  return protoRoutesAdjacency;
};

export const serializeServiceRoutesMap = (
  serviceRoutesMap: ServiceRoutesMap,
): ProtoServiceRoutesMap => {
  const protoServiceRoutesMap: ProtoServiceRoutesMap = {
    routes: {},
  };

  serviceRoutesMap.forEach(
    (value: { type: RouteType; name: string }, key: string) => {
      protoServiceRoutesMap.routes[key] = {
        type: serializeRouteType(value.type),
        name: value.name,
      };
    },
  );

  return protoServiceRoutesMap;
};

export const deserializeStopsAdjacency = (
  protoStopsAdjacency: ProtoStopsAdjacency,
): StopsAdjacency => {
  const stopsAdjacency: StopsAdjacency = new Map();

  Object.entries(protoStopsAdjacency.stops).forEach(([keyStr, value]) => {
    const key = parseInt(keyStr, 10);
    stopsAdjacency.set(key, {
      transfers: value.transfers.map(
        (transfer: ProtoTransfer): Transfer => ({
          destination: transfer.destination,
          type: parseTransferType(transfer.type),
          ...(transfer.minTransferTime !== undefined && {
            minTransferTime: Duration.fromSeconds(transfer.minTransferTime),
          }),
        }),
      ),
      routes: value.routes,
    });
  });

  return stopsAdjacency;
};

export const deserializeRoutesAdjacency = (
  protoRoutesAdjacency: ProtoRoutesAdjacency,
): RoutesAdjacency => {
  const routesAdjacency: RoutesAdjacency = new Map();

  Object.entries(protoRoutesAdjacency.routes).forEach(([key, value]) => {
    const stops = bytesToUint32Array(value.stops);
    const indices = new Map<number, number>();
    for (let i = 0; i < stops.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      indices.set(stops[i]!, i);
    }
    routesAdjacency.set(key, {
      stopTimes: bytesToUint32Array(value.stopTimes),
      pickUpDropOffTypes: value.pickUpDropOffTypes,
      stops: stops,
      stopIndices: indices,
      serviceRouteId: value.serviceRouteId,
    });
  });

  return routesAdjacency;
};

export const deserializeServiceRoutesMap = (
  protoServiceRoutesMap: ProtoServiceRoutesMap,
): ServiceRoutesMap => {
  const serviceRoutesMap: ServiceRoutesMap = new Map();

  Object.entries(protoServiceRoutesMap.routes).forEach(([key, value]) => {
    serviceRoutesMap.set(key, {
      type: parseRouteType(value.type),
      name: value.name,
    });
  });

  return serviceRoutesMap;
};

const parseTransferType = (type: ProtoTransferType): TransferType => {
  switch (type) {
    case ProtoTransferType.RECOMMENDED_TRANSFER_POINT:
      return 'RECOMMENDED';
    case ProtoTransferType.TIMED_TRANSFER:
      return 'GUARANTEED';
    case ProtoTransferType.REQUIRES_MINIMAL_TIME:
      return 'REQUIRES_MINIMAL_TIME';
    case ProtoTransferType.IN_SEAT_TRANSFER:
      return 'IN_SEAT';
    case ProtoTransferType.UNRECOGNIZED:
      throw new Error('Unrecognized protobuf transfer type.');
  }
};

const serializeTransferType = (type: TransferType): ProtoTransferType => {
  switch (type) {
    case 'RECOMMENDED':
      return ProtoTransferType.RECOMMENDED_TRANSFER_POINT;
    case 'GUARANTEED':
      return ProtoTransferType.TIMED_TRANSFER;
    case 'REQUIRES_MINIMAL_TIME':
      return ProtoTransferType.REQUIRES_MINIMAL_TIME;
    case 'IN_SEAT':
      return ProtoTransferType.IN_SEAT_TRANSFER;
  }
};

const parseRouteType = (type: ProtoRouteType): RouteType => {
  switch (type) {
    case ProtoRouteType.TRAM:
      return 'TRAM';
    case ProtoRouteType.SUBWAY:
      return 'SUBWAY';
    case ProtoRouteType.RAIL:
      return 'RAIL';
    case ProtoRouteType.BUS:
      return 'BUS';
    case ProtoRouteType.FERRY:
      return 'FERRY';
    case ProtoRouteType.CABLE_TRAM:
      return 'CABLE_TRAM';
    case ProtoRouteType.AERIAL_LIFT:
      return 'AERIAL_LIFT';
    case ProtoRouteType.FUNICULAR:
      return 'FUNICULAR';
    case ProtoRouteType.TROLLEYBUS:
      return 'TROLLEYBUS';
    case ProtoRouteType.MONORAIL:
      return 'MONORAIL';
    case ProtoRouteType.UNRECOGNIZED:
    default:
      throw new Error('Unrecognized protobuf route type.');
  }
};

const serializeRouteType = (type: RouteType): ProtoRouteType => {
  switch (type) {
    case 'TRAM':
      return ProtoRouteType.TRAM;
    case 'SUBWAY':
      return ProtoRouteType.SUBWAY;
    case 'RAIL':
      return ProtoRouteType.RAIL;
    case 'BUS':
      return ProtoRouteType.BUS;
    case 'FERRY':
      return ProtoRouteType.FERRY;
    case 'CABLE_TRAM':
      return ProtoRouteType.CABLE_TRAM;
    case 'AERIAL_LIFT':
      return ProtoRouteType.AERIAL_LIFT;
    case 'FUNICULAR':
      return ProtoRouteType.FUNICULAR;
    case 'TROLLEYBUS':
      return ProtoRouteType.TROLLEYBUS;
    case 'MONORAIL':
      return ProtoRouteType.MONORAIL;
  }
};
