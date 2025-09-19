import log from 'loglevel';
import { DateTime } from 'luxon';
import StreamZip from 'node-stream-zip';

import { StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { RouteType, Timetable } from '../timetable/timetable.js';
import { standardProfile } from './profiles/standard.js';
import { indexRoutes, parseRoutes } from './routes.js';
import { parseCalendar, parseCalendarDates, ServiceIds } from './services.js';
import { parseStops } from './stops.js';
import { parseTransfers, TransfersMap } from './transfers.js';
import {
  buildStopsAdjacencyStructure,
  parseStopTimes,
  parseTrips,
} from './trips.js';
import { Maybe } from './utils.js';

const CALENDAR_FILE = 'calendar.txt';
const CALENDAR_DATES_FILE = 'calendar_dates.txt';
const ROUTES_FILE = 'routes.txt';
const TRIPS_FILE = 'trips.txt';
const STOP_TIMES_FILE = 'stop_times.txt';
const STOPS_FILE = 'stops.txt';
const TRANSFERS_FILE = 'transfers.txt';

export type GtfsProfile = {
  routeTypeParser: (routeType: number) => Maybe<RouteType>;
};

export class GtfsParser {
  private path: string;
  private profile: GtfsProfile;

  constructor(path: string, profile: GtfsProfile = standardProfile) {
    // TODO: support input from multiple sources
    this.path = path;
    this.profile = profile;
  }

  /**
   * Parses a GTFS feed to extract all the data relevant to a given day in a transit-planner friendly format.
   *
   * @param date The active date.
   * @returns The parsed timetable.
   */
  async parseTimetable(date: Date): Promise<Timetable> {
    log.setLevel('INFO');
    const zip = new StreamZip.async({ file: this.path });
    const entries = await zip.entries();
    const datetime = DateTime.fromJSDate(date);

    const activeServiceIds: ServiceIds = new Set();
    const activeStopIds = new Set<StopId>();

    log.info(`Parsing ${STOPS_FILE}`);
    const stopsStart = performance.now();
    const stopsStream = await zip.stream(STOPS_FILE);
    const parsedStops = await parseStops(stopsStream);
    const stopsEnd = performance.now();
    log.info(
      `${parsedStops.size} parsed stops. (${(stopsEnd - stopsStart).toFixed(2)}ms)`,
    );

    if (entries[CALENDAR_FILE]) {
      log.info(`Parsing ${CALENDAR_FILE}`);
      const calendarStart = performance.now();
      const calendarStream = await zip.stream(CALENDAR_FILE);
      await parseCalendar(calendarStream, activeServiceIds, datetime);
      const calendarEnd = performance.now();
      log.info(
        `${activeServiceIds.size} valid services. (${(calendarEnd - calendarStart).toFixed(2)}ms)`,
      );
    }

    if (entries[CALENDAR_DATES_FILE]) {
      log.info(`Parsing ${CALENDAR_DATES_FILE}`);
      const calendarDatesStart = performance.now();
      const calendarDatesStream = await zip.stream(CALENDAR_DATES_FILE);
      await parseCalendarDates(calendarDatesStream, activeServiceIds, datetime);
      const calendarDatesEnd = performance.now();
      log.info(
        `${activeServiceIds.size} valid services. (${(calendarDatesEnd - calendarDatesStart).toFixed(2)}ms)`,
      );
    }

    log.info(`Parsing ${ROUTES_FILE}`);
    const routesStart = performance.now();
    const routesStream = await zip.stream(ROUTES_FILE);
    const validGtfsRoutes = await parseRoutes(routesStream, this.profile);
    const routesEnd = performance.now();
    log.info(
      `${validGtfsRoutes.size} valid GTFS routes. (${(routesEnd - routesStart).toFixed(2)}ms)`,
    );

    log.info(`Parsing ${TRIPS_FILE}`);
    const tripsStart = performance.now();
    const tripsStream = await zip.stream(TRIPS_FILE);
    const trips = await parseTrips(
      tripsStream,
      activeServiceIds,
      validGtfsRoutes,
    );
    const tripsEnd = performance.now();
    log.info(
      `${trips.size} valid trips. (${(tripsEnd - tripsStart).toFixed(2)}ms)`,
    );

    let transfers = new Map() as TransfersMap;
    if (entries[TRANSFERS_FILE]) {
      log.info(`Parsing ${TRANSFERS_FILE}`);
      const transfersStart = performance.now();
      const transfersStream = await zip.stream(TRANSFERS_FILE);
      transfers = await parseTransfers(transfersStream, parsedStops);
      const transfersEnd = performance.now();
      log.info(
        `${transfers.size} valid transfers. (${(transfersEnd - transfersStart).toFixed(2)}ms)`,
      );
    }

    log.info(`Parsing ${STOP_TIMES_FILE}`);
    const stopTimesStart = performance.now();
    const stopTimesStream = await zip.stream(STOP_TIMES_FILE);
    const { routes, serviceRoutesMap } = await parseStopTimes(
      stopTimesStream,
      parsedStops,
      trips,
      activeStopIds,
    );
    const serviceRoutes = indexRoutes(validGtfsRoutes, serviceRoutesMap);
    const stopTimesEnd = performance.now();
    log.info(
      `${routes.length} valid unique routes. (${(stopTimesEnd - stopTimesStart).toFixed(2)}ms)`,
    );
    log.info('Building stops adjacency structure');
    const stopsAdjacencyStart = performance.now();
    const stopsAdjacency = buildStopsAdjacencyStructure(
      serviceRoutes,
      routes,
      transfers,
      parsedStops.size,
      activeStopIds,
    );

    const stopsAdjacencyEnd = performance.now();
    log.info(
      `${stopsAdjacency.length} valid stops in the structure. (${(stopsAdjacencyEnd - stopsAdjacencyStart).toFixed(2)}ms)`,
    );
    await zip.close();

    const timetable = new Timetable(stopsAdjacency, routes, serviceRoutes);

    log.info('Parsing complete.');
    return timetable;
  }

  /**
   * Parses a GTFS feed to extract all stops.
   *
   * @param activeStops The set of active stop IDs to include in the index.
   * @returns An index of stops.
   */
  async parseStops(): Promise<StopsIndex> {
    const zip = new StreamZip.async({ file: this.path });

    log.info(`Parsing ${STOPS_FILE}`);
    const stopsStart = performance.now();
    const stopsStream = await zip.stream(STOPS_FILE);
    const stops = await parseStops(stopsStream);
    const stopsEnd = performance.now();

    log.info(
      `${stops.size} parsed stops. (${(stopsEnd - stopsStart).toFixed(2)}ms)`,
    );

    await zip.close();

    return new StopsIndex(Array.from(stops.values()));
  }
}
