import {
  Latitude,
  LocationType,
  Longitude,
  Platform,
  Stop,
  StopId,
  StopsMap,
} from '../stops/stops.js';
import { Maybe, parseCsv } from './utils.js';

export type StopIds = Set<StopId>;

export type GtfsLocationType =
  | 0 // simple stop or platform (can also be empty)
  | 1 // station
  | 2 // entrance / exit
  | 3 // generic node
  | 4; // boarding area

export type StopEntry = {
  stop_id: StopId;
  stop_name: string;
  stop_lat?: Latitude;
  stop_lon?: Longitude;
  location_type?: GtfsLocationType;
  parent_station?: StopId;
  platform_code?: Platform;
};

/**
 * Parses the stops.txt file from a GTFS feed.
 *
 * @param stopsStream The readable stream containing the stops data.
 * @return A mapping of stop IDs to corresponding stop details.
 */
export const parseStops = async (
  stopsStream: NodeJS.ReadableStream,
  platformParser?: (stopEntry: StopEntry) => Maybe<Platform>,
  validStops?: StopIds,
): Promise<StopsMap> => {
  const stops: StopsMap = new Map();

  for await (const rawLine of parseCsv(stopsStream)) {
    const line = rawLine as StopEntry;
    const stop: Stop = {
      id: line.stop_id,
      name: line.stop_name,
      lat: line.stop_lat,
      lon: line.stop_lon,
      locationType: line.location_type
        ? parseGtfsLocationType(line.location_type)
        : 'SIMPLE_STOP_OR_PLATFORM',
      children: [],
      ...(line.parent_station && { parent: line.parent_station }),
    };
    if (platformParser) {
      try {
        const platform = platformParser(line);
        if (platform) {
          stop.platform = platform;
        }
      } catch {
        console.info(`Could not parse platform for stop ${line.stop_id}.`);
      }
    }
    stops.set(line.stop_id, stop);
  }

  for (const [stopId, stop] of stops) {
    if (stop.parent) {
      const parentStop = stops.get(stop.parent);
      if (!parentStop) {
        console.warn(`Cannot find parent stop ${stop.parent} of ${stopId}`);
        continue;
      }
      parentStop.children.push(stopId);
    }
  }
  if (validStops) {
    // Remove all stops which don't have at least one valid stopId as a child,
    // a parent or as its own.
    for (const [stopId, stop] of stops) {
      if (
        !validStops.has(stopId) &&
        (!stop.parent || !validStops.has(stop.parent)) &&
        !stop.children.some((childId) => validStops.has(childId))
      ) {
        stops.delete(stopId);
      }
    }
  }
  return stops;
};

const parseGtfsLocationType = (
  gtfsLocationType: GtfsLocationType,
): LocationType => {
  switch (gtfsLocationType) {
    case 0:
    default:
      return 'SIMPLE_STOP_OR_PLATFORM';
    case 1:
      return 'STATION';
    case 2:
      return 'ENTRANCE_EXIT';
    case 3:
      return 'GENERIC_NODE';
    case 4:
      return 'BOARDING_AREA';
  }
};
