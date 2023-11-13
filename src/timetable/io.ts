import { Duration } from './duration.js';
import {
  PickUpDropOffType as ProtoPickUpDropOffType,
  RoutesAdjacency as ProtoRoutesAdjacency,
  RouteType as ProtoRouteType,
  ServiceRoutesMap as ProtoServiceRoutesMap,
  StopsAdjacency as ProtoStopsAdjacency,
  Transfer as ProtoTransfer,
  TransferType as ProtoTransferType,
} from './proto/timetable.js';
import { Time } from './time.js';
import {
  PickUpDropOffType,
  Route,
  RoutesAdjacency,
  RouteType,
  ServiceRoutesMap,
  StopsAdjacency,
  Transfer,
  TransferType,
} from './timetable.js';

export const serializeStopsAdjacency = (
  stopsAdjacency: StopsAdjacency,
): ProtoStopsAdjacency => {
  const protoStopsAdjacency: ProtoStopsAdjacency = {
    stops: {},
  };

  stopsAdjacency.forEach(
    (value: { transfers: Transfer[]; routes: string[] }, key: string) => {
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
      stopTimes: value.stopTimes.map((stopTimes) => ({
        arrival: stopTimes.arrival.toSeconds(),
        departure: stopTimes.departure.toSeconds(),
        pickUpType: serializePickUpDropOffType(stopTimes.pickUpType),
        dropOffType: serializePickUpDropOffType(stopTimes.dropOffType),
      })),
      stops: value.stops,
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

  Object.entries(protoStopsAdjacency.stops).forEach(([key, value]) => {
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
    routesAdjacency.set(key, {
      stopTimes: value.stopTimes.map((stopTimes) => ({
        arrival: Time.fromSeconds(stopTimes.arrival),
        departure: Time.fromSeconds(stopTimes.departure),
        pickUpType:
          stopTimes.pickUpType !== undefined
            ? parsePickUpDropOffType(stopTimes.pickUpType)
            : 'REGULAR',
        dropOffType:
          stopTimes.dropOffType !== undefined
            ? parsePickUpDropOffType(stopTimes.dropOffType)
            : 'REGULAR',
      })),
      stops: value.stops,
      stopIndices: new Map(value.stops.map((stop, index) => [stop, index])),
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

const parsePickUpDropOffType = (
  type: ProtoPickUpDropOffType,
): PickUpDropOffType => {
  switch (type) {
    case ProtoPickUpDropOffType.MUST_PHONE_AGENCY:
      return 'MUST_PHONE_AGENCY';
    case ProtoPickUpDropOffType.MUST_COORDINATE_WITH_DRIVER:
      return 'MUST_COORDINATE_WITH_DRIVER';
    case ProtoPickUpDropOffType.NOT_AVAILABLE:
      return 'NOT_AVAILABLE';
    default:
      return 'REGULAR';
  }
};

const serializePickUpDropOffType = (
  type: PickUpDropOffType,
): ProtoPickUpDropOffType | undefined => {
  switch (type) {
    case 'REGULAR':
      return undefined;
    case 'NOT_AVAILABLE':
      return ProtoPickUpDropOffType.NOT_AVAILABLE;
    case 'MUST_COORDINATE_WITH_DRIVER':
      return ProtoPickUpDropOffType.MUST_COORDINATE_WITH_DRIVER;
    case 'MUST_PHONE_AGENCY':
      return ProtoPickUpDropOffType.MUST_PHONE_AGENCY;
  }
};
