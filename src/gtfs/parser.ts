import log from 'loglevel';
import { DateTime } from 'luxon';
import StreamZip from 'node-stream-zip';

import { Platform, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { RouteType, Timetable } from '../timetable/timetable.js';
import { standardProfile } from './profiles/standard.js';
import { parseRoutes } from './routes.js';
import { parseCalendar, parseCalendarDates, ServiceIds } from './services.js';
import { indexStops, parseStops, StopEntry } from './stops.js';
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
  platformParser?: (stopEntry: StopEntry) => Maybe<Platform>;
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
   * @param gtfsPath A path to the zipped GTFS feed.
   * @param gtfsProfile The GTFS profile configuration.
   * @returns An object containing the timetable and stops map.
   */
  async parse(
    date: Date,
  ): Promise<{ timetable: Timetable; stopsIndex: StopsIndex }> {
    log.setLevel('INFO');
    const zip = new StreamZip.async({ file: this.path });
    const entries = await zip.entries();
    const datetime = DateTime.fromJSDate(date);

    const validServiceIds: ServiceIds = new Set();
    const validStopIds = new Set<StopId>();

    log.info(`Parsing ${STOPS_FILE}`);
    const stopsStart = performance.now();
    const stopsStream = await zip.stream(STOPS_FILE);
    const parsedStops = await parseStops(
      stopsStream,
      this.profile.platformParser,
    );
    const stopsEnd = performance.now();
    log.info(
      `${parsedStops.size} parsed stops. (${(stopsEnd - stopsStart).toFixed(2)}ms)`,
    );

    if (entries[CALENDAR_FILE]) {
      log.info(`Parsing ${CALENDAR_FILE}`);
      const calendarStart = performance.now();
      const calendarStream = await zip.stream(CALENDAR_FILE);
      await parseCalendar(calendarStream, validServiceIds, datetime);
      const calendarEnd = performance.now();
      log.info(
        `${validServiceIds.size} valid services. (${(calendarEnd - calendarStart).toFixed(2)}ms)`,
      );
    }

    if (entries[CALENDAR_DATES_FILE]) {
      log.info(`Parsing ${CALENDAR_DATES_FILE}`);
      const calendarDatesStart = performance.now();
      const calendarDatesStream = await zip.stream(CALENDAR_DATES_FILE);
      await parseCalendarDates(calendarDatesStream, validServiceIds, datetime);
      const calendarDatesEnd = performance.now();
      log.info(
        `${validServiceIds.size} valid services. (${(calendarDatesEnd - calendarDatesStart).toFixed(2)}ms)`,
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
      validServiceIds,
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
    const routesAdjacency = await parseStopTimes(
      stopTimesStream,
      parsedStops,
      trips,
      validStopIds,
    );
    const stopsAdjacency = buildStopsAdjacencyStructure(
      validStopIds,
      routesAdjacency,
      transfers,
    );
    const stopTimesEnd = performance.now();
    log.info(
      `${routesAdjacency.size} valid unique routes. (${(stopTimesEnd - stopTimesStart).toFixed(2)}ms)`,
    );

    log.info(`Removing unused stops.`);
    const indexStopsStart = performance.now();
    const stops = indexStops(parsedStops, validStopIds);
    const indexStopsEnd = performance.now();
    log.info(
      `${stops.size} used stop stops, ${parsedStops.size - stops.size} unused. (${(indexStopsEnd - indexStopsStart).toFixed(2)}ms)`,
    );

    await zip.close();

    const timetable = new Timetable(
      stopsAdjacency,
      routesAdjacency,
      validGtfsRoutes,
    );

    log.info(`Building stops index.`);
    const stopsIndexStart = performance.now();
    const stopsIndex = new StopsIndex(stops);
    const stopsIndexEnd = performance.now();
    log.info(
      `Stops index built. (${(stopsIndexEnd - stopsIndexStart).toFixed(2)}ms)`,
    );

    log.info('Parsing complete.');
    return { timetable, stopsIndex };
  }

  /**
   * Parses a GTFS feed to extract all stops.
   *
   * @param gtfsPath A path the zipped GTFS feed.
   * @param gtfsProfile The GTFS profile configuration.
   * @returns An object containing the timetable and stops map.
   */
  async parseStops(): Promise<StopsIndex> {
    const zip = new StreamZip.async({ file: this.path });

    log.info(`Parsing ${STOPS_FILE}`);
    const stopsStart = performance.now();
    const stopsStream = await zip.stream(STOPS_FILE);
    const stops = indexStops(
      await parseStops(stopsStream, this.profile.platformParser),
    );
    const stopsEnd = performance.now();

    log.info(
      `${stops.size} parsed stops. (${(stopsEnd - stopsStart).toFixed(2)}ms)`,
    );

    await zip.close();

    return new StopsIndex(stops);
  }
}
