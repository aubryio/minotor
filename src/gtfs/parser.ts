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
    const zip = new StreamZip.async({ file: this.path });
    const entries = await zip.entries();
    const datetime = DateTime.fromJSDate(date);

    const validServiceIds: ServiceIds = new Set();
    const validStopIds = new Set<StopId>();

    log.info(`Parsing ${STOPS_FILE}`);
    const stopsStream = await zip.stream(STOPS_FILE);
    const parsedStops = await parseStops(
      stopsStream,
      this.profile.platformParser,
    );
    log.info(`${parsedStops.size} parsed stops.`);

    if (entries[CALENDAR_FILE]) {
      log.info(`Parsing ${CALENDAR_FILE}`);
      const calendarStream = await zip.stream(CALENDAR_FILE);
      await parseCalendar(calendarStream, validServiceIds, datetime);
      log.info(`${validServiceIds.size} valid services.`);
    }

    if (entries[CALENDAR_DATES_FILE]) {
      log.info(`Parsing ${CALENDAR_DATES_FILE}`);
      const calendarDatesStream = await zip.stream(CALENDAR_DATES_FILE);
      await parseCalendarDates(calendarDatesStream, validServiceIds, datetime);
      log.info(`${validServiceIds.size} valid services.`);
    }

    log.info(`Parsing ${ROUTES_FILE}`);
    const routesStream = await zip.stream(ROUTES_FILE);
    const validGtfsRoutes = await parseRoutes(routesStream, this.profile);
    log.info(`${validGtfsRoutes.size} valid GTFS routes.`);

    log.info(`Parsing ${TRIPS_FILE}`);
    const tripsStream = await zip.stream(TRIPS_FILE);
    const trips = await parseTrips(
      tripsStream,
      validServiceIds,
      validGtfsRoutes,
    );
    log.info(`${trips.size} valid trips.`);

    let transfers = new Map() as TransfersMap;
    if (entries[TRANSFERS_FILE]) {
      log.info(`Parsing ${TRANSFERS_FILE}`);
      const transfersStream = await zip.stream(TRANSFERS_FILE);
      transfers = await parseTransfers(transfersStream, parsedStops);
      log.info(`${transfers.size} valid transfers.`);
    }

    log.info(`Parsing ${STOP_TIMES_FILE}`);
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
    log.info(`${routesAdjacency.size} valid unique routes.`);

    log.info(`Removing unused stops.`);
    const stops = indexStops(parsedStops, validStopIds);
    log.info(
      `${stops.size} used stop stops, ${parsedStops.size - stops.size} unused.`,
    );

    await zip.close();

    const timetable = new Timetable(
      stopsAdjacency,
      routesAdjacency,
      validGtfsRoutes,
    );

    log.info(`Building stops index.`);
    const stopsIndex = new StopsIndex(stops);

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
    const stopsStream = await zip.stream(STOPS_FILE);
    const stops = indexStops(
      await parseStops(stopsStream, this.profile.platformParser),
    );

    log.info(`${stops.size} parsed stops.`);

    await zip.close();

    return new StopsIndex(stops);
  }
}
