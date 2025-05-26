import {
  LocationType as ProtoLocationType,
  Stop as ProtoStop,
  StopsMap as ProtoStopsMap,
} from './proto/stops.js';
import { LocationType, Stop, StopsMap } from './stops.js';

const CURRENT_VERSION = '0.0.2';
const serializeStop = (stop: Stop): ProtoStop => {
  return {
    name: stop.name,
    sourceStopId: stop.sourceStopId,
    lat: stop.lat,
    lon: stop.lon,
    children: stop.children,
    parent: stop.parent,
    locationType: serializeLocationType(stop.locationType),
    platform: stop.platform,
  };
};

export const serializeStopsMap = (stopsMap: StopsMap): ProtoStopsMap => {
  const protoStopsMap: ProtoStopsMap = {
    version: CURRENT_VERSION,
    stops: {},
  };

  stopsMap.forEach((value: Stop, key: number) => {
    protoStopsMap.stops[key] = serializeStop(value);
  });

  return protoStopsMap;
};

const deserializeStop = (stopId: number, protoStop: ProtoStop): Stop => {
  return {
    id: stopId,
    sourceStopId: protoStop.sourceStopId,
    name: protoStop.name,
    lat: protoStop.lat,
    lon: protoStop.lon,
    children: protoStop.children,
    parent: protoStop.parent,
    locationType: parseProtoLocationType(protoStop.locationType),
    platform: protoStop.platform,
  };
};

export const deserializeStopsMap = (protoStopsMap: ProtoStopsMap): StopsMap => {
  if (protoStopsMap.version !== CURRENT_VERSION) {
    throw new Error(`Unsupported stopMap version ${protoStopsMap.version}`);
  }
  const stopsMap: StopsMap = new Map();

  Object.entries(protoStopsMap.stops).forEach(([key, value]) => {
    const intKey = parseInt(key, 10);
    stopsMap.set(intKey, deserializeStop(intKey, value));
  });

  return stopsMap;
};

const parseProtoLocationType = (
  protoLocationType: ProtoLocationType,
): LocationType => {
  switch (protoLocationType) {
    case ProtoLocationType.SIMPLE_STOP_OR_PLATFORM:
      return 'SIMPLE_STOP_OR_PLATFORM';
    case ProtoLocationType.STATION:
      return 'STATION';
    case ProtoLocationType.ENTRANCE_EXIT:
      return 'ENTRANCE_EXIT';
    case ProtoLocationType.GENERIC_NODE:
      return 'GENERIC_NODE';
    case ProtoLocationType.BOARDING_AREA:
      return 'BOARDING_AREA';
    case ProtoLocationType.UNRECOGNIZED:
      throw new Error('Unrecognized protobuf location type.');
  }
};

const serializeLocationType = (
  locationType: LocationType,
): ProtoLocationType => {
  switch (locationType) {
    case 'SIMPLE_STOP_OR_PLATFORM':
      return ProtoLocationType.SIMPLE_STOP_OR_PLATFORM;
    case 'STATION':
      return ProtoLocationType.STATION;
    case 'ENTRANCE_EXIT':
      return ProtoLocationType.ENTRANCE_EXIT;
    case 'GENERIC_NODE':
      return ProtoLocationType.GENERIC_NODE;
    case 'BOARDING_AREA':
      return ProtoLocationType.BOARDING_AREA;
  }
};
