import {
  LocationType as ProtoLocationType,
  Stop as ProtoStop,
  StopsMap as ProtoStopsMap,
} from './proto/v1/stops.js';
import { LocationType, Stop } from './stops.js';

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

export const serializeStopsMap = (stops: Stop[]): ProtoStopsMap => {
  const protoStopsMap: ProtoStopsMap = {
    stops: stops.map((value) => serializeStop(value)),
  };

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

export const deserializeStopsMap = (protoStopsMap: ProtoStopsMap): Stop[] => {
  return protoStopsMap.stops.map((value, intKey) =>
    deserializeStop(intKey, value),
  );
};

const parseProtoLocationType = (
  protoLocationType: ProtoLocationType,
): LocationType => {
  switch (protoLocationType) {
    case ProtoLocationType.LOCATION_TYPE_SIMPLE_STOP_OR_PLATFORM:
      return 'SIMPLE_STOP_OR_PLATFORM';
    case ProtoLocationType.LOCATION_TYPE_STATION:
      return 'STATION';
    case ProtoLocationType.LOCATION_TYPE_ENTRANCE_EXIT:
      return 'ENTRANCE_EXIT';
    case ProtoLocationType.LOCATION_TYPE_GENERIC_NODE:
      return 'GENERIC_NODE';
    case ProtoLocationType.LOCATION_TYPE_BOARDING_AREA:
      return 'BOARDING_AREA';
    case ProtoLocationType.LOCATION_TYPE_UNSPECIFIED:
      throw new Error('Unspecified protobuf location type.');
    case ProtoLocationType.UNRECOGNIZED:
      throw new Error('Unrecognized protobuf location type.');
  }
};

const serializeLocationType = (
  locationType: LocationType,
): ProtoLocationType => {
  switch (locationType) {
    case 'SIMPLE_STOP_OR_PLATFORM':
      return ProtoLocationType.LOCATION_TYPE_SIMPLE_STOP_OR_PLATFORM;
    case 'STATION':
      return ProtoLocationType.LOCATION_TYPE_STATION;
    case 'ENTRANCE_EXIT':
      return ProtoLocationType.LOCATION_TYPE_ENTRANCE_EXIT;
    case 'GENERIC_NODE':
      return ProtoLocationType.LOCATION_TYPE_GENERIC_NODE;
    case 'BOARDING_AREA':
      return ProtoLocationType.LOCATION_TYPE_BOARDING_AREA;
  }
};
