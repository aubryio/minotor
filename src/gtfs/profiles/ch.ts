import { Platform } from '../../stops/stops.js';
import { RouteType } from '../../timetable/timetable.js';
import { GtfsProfile } from '../parser.js';
import { StopEntry } from '../stops.js';
import { Maybe } from '../utils.js';

/**
 * Parses the platform number from a stop entry.
 * @param stopEntry The stop entry.
 * @returns The platform corresponding to this stop.
 */
const platformParser = (stopEntry: StopEntry): Maybe<Platform> => {
  const stopId = String(stopEntry.stop_id);
  const stopParts = stopId.split(':');
  if (stopParts.length > 2) {
    return stopParts[2];
  }
  return undefined;
};

/**
 * Parses the SBB extended route type and returns the corresponding basic GTFS route type.
 * @param routeType The SBB route type to parse.
 * @returns The corresponding GTFS route type, or undefined if the route type is not recognized.
 */
const routeTypeParser = (routeType: number): Maybe<RouteType> => {
  switch (routeType) {
    case 1700: // Lift
    case 1400: // Cogwheel train, funicular
      return 'FUNICULAR'; // Funicular
    case 700: // Bus
    case 705: // Night bus
    case 710: // Panorama bus
    case 202: // National long-distance bus
    case 201: // International long-distance bus
    case 702: // Express bus
    case 715: // On-demand bus
      return 'BUS'; // Bus
    case 1300: // Chairlift, Gondola
      return 'AERIAL_LIFT'; // Aerial lift
    case 401: // Metro
      return 'SUBWAY'; // Subway
    case 1000: // Boat / Ship
      return 'FERRY'; // Boat
    case 900: // Tram
      return 'TRAM'; // Tram
    case 117: // Special train
    case 102: // International train
    case 104: // Car train
    case 101: // International train
    case 111: // Airport train
    case 105: // Night train
    case 103: // Fast train
    case 107: // Mountain train
    case 100: // No guaranteed train
    case 106: // Regional train
    case 109: // Urban train
    case 116: // ??? train TODO figure out what this means
      return 'RAIL'; // Train
    case 1100: // Aircraft
    case 1500: // Taxi
    default:
      return undefined;
  }
};

export const chGtfsProfile: GtfsProfile = {
  routeTypeParser,
  platformParser,
};
