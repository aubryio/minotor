import log from 'loglevel';
import { DateTime } from 'luxon';
import StreamZip from 'node-stream-zip';

import { StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { ParentStationTransferTimes } from '../timetable/io.js';
import { RouteType, Timetable } from '../timetable/timetable.js';
import { standardGtfsProfile } from './profiles/standard.js';
import { indexRoutes, parseRoutes } from './routes.js';
import { parseCalendar, parseCalendarDates, ServiceIds } from './services.js';
import { GtfsStopsMap, parseStops } from './stops.js';
import {
  buildTripTransfers,
  computeParentStationTransferTimes,
  GtfsTripTransfer,
  parseTransfers,
  TransfersMap,
  transformTransfersForParentStations,
} from './transfers.js';
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

export type GtfsParserOptions = {
  /**
   * When enabled, routes are collapsed by parent station sequence instead of
   * individual child stops. This reduces the number of routes and improves
   * routing performance at the cost of losing per-platform transfer time precision.
   *
   * When true:
   * - Routes are grouped by parent station sequence (trips using different platforms
   *   of the same stations are merged into one route)
   * - Intra-station transfers use median transfer times computed from child-to-child transfers
   * - Original child stop IDs are preserved for route reconstruction
   *
   * @default false
   */
  useParentStations?: boolean;
};

/**
 * Builds a mapping from child stop IDs to their parent station IDs.
 *
 * @param stopsMap The parsed stops map
 * @returns A map from child stop IDs to parent station IDs
 */
const buildStopToParentMap = (stopsMap: GtfsStopsMap): Map<StopId, StopId> => {
  const stopToParent = new Map<StopId, StopId>();
  for (const stop of stopsMap.values()) {
    if (stop.parent !== undefined) {
      stopToParent.set(stop.id, stop.parent);
    }
  }
  return stopToParent;
};

export class GtfsParser {
  private path: string;
  private profile: GtfsProfile;
  private options: GtfsParserOptions;

  constructor(
    path: string,
    profile: GtfsProfile = standardGtfsProfile,
    options: GtfsParserOptions = {},
  ) {
    this.path = path;
    this.profile = profile;
    this.options = options;
  }

  /**
   * Parses a GTFS feed to extract all the data relevant to a given day in a transit-planner friendly format.
   *
   * @param date The active date.
   * @param options Optional parsing options that override constructor options.
   * @returns The parsed timetable.
   */
  async parseTimetable(
    date: Date,
    options?: GtfsParserOptions,
  ): Promise<Timetable> {
    const effectiveOptions = { ...this.options, ...options };
    const useParentStations = effectiveOptions.useParentStations ?? false;

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

    // Build stop to parent mapping for parent station mode
    const stopToParent = useParentStations
      ? buildStopToParentMap(parsedStops)
      : undefined;

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

    let transfers: TransfersMap = new Map();
    let tripContinuationsList: GtfsTripTransfer[] = [];
    let guaranteedTripTransfersList: GtfsTripTransfer[] = [];
    let parentStationTransferTimes: ParentStationTransferTimes = new Map();

    if (entries[TRANSFERS_FILE]) {
      log.info(`Parsing ${TRANSFERS_FILE}`);
      const transfersStart = performance.now();
      const transfersStream = await zip.stream(TRANSFERS_FILE);
      const {
        transfers: parsedTransfers,
        tripContinuations: parsedTripContinuations,
        guaranteedTripTransfers: parsedGuaranteedTripTransfers,
      } = await parseTransfers(transfersStream, parsedStops);

      tripContinuationsList = parsedTripContinuations;
      guaranteedTripTransfersList = parsedGuaranteedTripTransfers;

      if (useParentStations) {
        // Compute median transfer times for parent stations before transforming
        parentStationTransferTimes = computeParentStationTransferTimes(
          parsedTransfers,
          parsedStops,
        );
        log.info(
          `Computed median transfer times for ${parentStationTransferTimes.size} parent stations.`,
        );

        // Transform transfers to use parent station IDs
        transfers = transformTransfersForParentStations(
          parsedTransfers,
          parsedStops,
        );
      } else {
        transfers = parsedTransfers;
      }

      const transfersEnd = performance.now();
      log.info(
        `${transfers.size} valid transfers and ${tripContinuationsList.length} trip continuations and ${guaranteedTripTransfersList.length} guaranteed trip transfers. (${(transfersEnd - transfersStart).toFixed(2)}ms)`,
      );
    }

    log.info(
      `Parsing ${STOP_TIMES_FILE}${useParentStations ? ' (parent station mode)' : ''}`,
    );
    const stopTimesStart = performance.now();
    const stopTimesStream = await zip.stream(STOP_TIMES_FILE);
    const { routes, serviceRoutesMap, tripsMapping } = await parseStopTimes(
      stopTimesStream,
      parsedStops,
      trips,
      activeStopIds,
      useParentStations,
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

    // temporary timetable for building continuations
    const timetable = new Timetable(stopsAdjacency, routes, serviceRoutes);

    log.info('Building in-seat trip continuations');
    const tripContinuationsStart = performance.now();
    const tripContinuations = buildTripTransfers(
      tripsMapping,
      tripContinuationsList,
      timetable,
      activeStopIds,
      stopToParent,
    );
    const tripContinuationsEnd = performance.now();
    log.info(
      `${tripContinuations.size} in-seat trip continuations origins created. (${(tripContinuationsEnd - tripContinuationsStart).toFixed(2)}ms)`,
    );

    log.info('Building guaranteed trip transfers');
    const guaranteedTripTransfersStart = performance.now();
    const guaranteedTripTransfers = buildTripTransfers(
      tripsMapping,
      guaranteedTripTransfersList,
      timetable,
      activeStopIds,
      stopToParent,
    );
    const guaranteedTripTransfersEnd = performance.now();
    log.info(
      `${guaranteedTripTransfers.size} guaranteed trip transfers origins created. (${(guaranteedTripTransfersEnd - guaranteedTripTransfersStart).toFixed(2)}ms)`,
    );
    log.info('Parsing complete.');

    return new Timetable(
      stopsAdjacency,
      routes,
      serviceRoutes,
      tripContinuations,
      guaranteedTripTransfers,
      useParentStations,
      parentStationTransferTimes,
    );
  }

  /**
   * Parses a GTFS feed to extract all stops.
   *
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
