import {
  Latitude,
  LocationType,
  Longitude,
  Platform,
  SourceStopId,
  Stop,
  StopId,
  StopsMap,
} from '../stops/stops.js';
import { Maybe, parseCsv } from './utils.js';

export type GtfsLocationType =
  | 0 // simple stop or platform (can also be empty)
  | 1 // station
  | 2 // entrance / exit
  | 3 // generic node
  | 4; // boarding area

export type StopEntry = {
  stop_id: SourceStopId;
  stop_name: string;
  stop_lat?: Latitude;
  stop_lon?: Longitude;
  location_type?: GtfsLocationType;
  parent_station?: SourceStopId;
  platform_code?: Platform;
};

type ParsedStop = Stop & {
  parentSourceId?: SourceStopId;
};

export type ParsedStopsMap = Map<SourceStopId, ParsedStop>;
/**
 * Parses the stops.txt file from a GTFS feed.
 *
 * @param stopsStream The readable stream containing the stops data.
 * @return A mapping of stop IDs to corresponding stop details.
 */
export const parseStops = async (
  stopsStream: NodeJS.ReadableStream,
  platformParser?: (stopEntry: StopEntry) => Maybe<Platform>,
): Promise<ParsedStopsMap> => {
  const parsedStops = new Map<SourceStopId, ParsedStop>();
  let i = 0;
  for await (const rawLine of parseCsv(stopsStream, [
    'stop_lat',
    'stop_lon',
    'location_type',
  ])) {
    const line = rawLine as StopEntry;
    const stop: ParsedStop = {
      id: i,
      sourceStopId: line.stop_id,
      name: line.stop_name,
      lat: line.stop_lat,
      lon: line.stop_lon,
      locationType: line.location_type
        ? parseGtfsLocationType(line.location_type)
        : 'SIMPLE_STOP_OR_PLATFORM',
      children: [],
      ...(line.parent_station && { parentSourceId: line.parent_station }),
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
    parsedStops.set(line.stop_id, stop);
    i = i + 1;
  }

  for (const [sourceStopId, stop] of parsedStops) {
    if (stop.parentSourceId) {
      const parentStop = parsedStops.get(stop.parentSourceId);
      if (!parentStop) {
        console.warn(
          `Cannot find parent stop ${stop.parentSourceId} of ${sourceStopId}`,
        );
        continue;
      }
      stop.parent = parentStop.id;
      parentStop.children.push(stop.id);
    }
  }
  return parsedStops;
};

/**
 * Builds the final stop map indexed by internal IDs.
 * Excludes all stops that do not have at least one valid stopId
 * as a child, a parent, or being valid itself.
 *
 * @param parsedStops - The map of parsed stops.
 * @param validStops - A set of valid stop IDs.
 * @returns A map of stops indexed by internal IDs.
 */
export const indexStops = (
  parsedStops: ParsedStopsMap,
  validStops?: Set<StopId>,
): StopsMap => {
  const stops = new Map<StopId, Stop>();

  for (const [, stop] of parsedStops) {
    if (
      !validStops ||
      validStops.has(stop.id) ||
      (stop.parent && validStops.has(stop.parent)) ||
      stop.children.some((childId) => validStops.has(childId))
    ) {
      stops.set(stop.id, {
        id: stop.id,
        sourceStopId: stop.sourceStopId,
        name: stop.name,
        lat: stop.lat,
        lon: stop.lon,
        locationType: stop.locationType,
        platform: stop.platform,
        children: stop.children.filter(
          (childId) => !validStops || validStops.has(childId),
        ),
        parent: stop.parent,
      });
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
