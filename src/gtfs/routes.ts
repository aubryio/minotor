import log from 'loglevel';

import { ServiceRouteId, ServiceRoutesMap } from '../timetable/timetable.js';
import { GtfsProfile } from './parser.js';
import { standardProfile } from './profiles/standard.js';
import { parseCsv } from './utils.js';

// Can be a standard gtfs route type or an extended route type
// the profile converter handles the conversion to a route type.
export type GtfsRouteType = number;

type RouteEntry = {
  route_id: ServiceRouteId;
  agency_id: string;
  route_short_name: string;
  route_long_name: string;
  route_desc: string;
  route_type: number;
};

/**
 * Parses a GTFS routes.txt file and returns a map of all the valid routes.
 *
 * @param routesStream A readable stream for the GTFS routes.txt file.
 * @param profile A configuration object defining the specificities of the GTFS feed.
 * @returns A map of all the valid routes.
 */
export const parseRoutes = async (
  routesStream: NodeJS.ReadableStream,
  profile: GtfsProfile = standardProfile,
): Promise<ServiceRoutesMap> => {
  const routes: ServiceRoutesMap = new Map();
  for await (const rawLine of parseCsv(routesStream, ['route_type'])) {
    const line = rawLine as RouteEntry;
    const routeType = profile.routeTypeParser(line.route_type);
    if (routeType === undefined) {
      log.info(
        `Unsupported route type ${line.route_type} for route ${line.route_id}.`,
      );
      continue;
    }
    routes.set(line.route_id, {
      name: line.route_short_name,
      type: routeType,
      routes: [],
    });
  }
  return routes;
};
