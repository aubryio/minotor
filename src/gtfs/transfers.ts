import log from 'loglevel';

import { SourceStopId, StopId } from '../stops/stops.js';
import { Duration, durationFromSeconds } from '../timetable/time.js';
import {
  Timetable,
  Transfer,
  TransferType,
  TransferTypes,
  TripStop,
  TripTransfers,
} from '../timetable/timetable.js';
import { encode } from '../timetable/tripStopKey.js';
import { ServiceId, ServiceIds } from './services.js';
import { GtfsStopsMap } from './stops.js';
import { GtfsTripId, TripsMapping } from './trips.js';
import { parseCsv } from './utils.js';

export type GtfsTransferType =
  | 0 // recommended transfer point
  | 1 // timed transfer (guaranteed)
  | 2 // requires a minimal amount of time
  | 3 // transfer not possible
  | 4 // in-seat transfer
  | 5; //  in-seat transfer not allowed (must alight)

export type TransfersMap = Map<StopId, Transfer[]>;

/**
 * Directed stop pairs for which the feed explicitly disallows transfers.
 *
 * These constraints are retained during parsing so generated transfers do not
 * accidentally re-enable a connection declared with GTFS transfer_type=3.
 * They are not serialized into the routing timetable.
 */
export type ForbiddenTransfersMap = Map<StopId, Set<StopId>>;

export type GtfsTripTransfer = {
  fromStop: StopId;
  fromTrip: GtfsTripId;
  toStop: StopId;
  toTrip: GtfsTripId;
  type?: TransferType;
  minTransferTime?: Duration;
};

export type TransferEntry = {
  from_stop_id?: SourceStopId;
  to_stop_id?: SourceStopId;
  from_trip_id?: GtfsTripId;
  to_trip_id?: GtfsTripId;
  from_route_id?: string;
  to_route_id?: string;
  service_id?: ServiceId;
  transfer_type: GtfsTransferType;
  min_transfer_time?: number;
};

/**
 * Processes in-seat transfer entries (type 4).
 */
const processInSeatTransfer = (
  transferEntry: TransferEntry,
  fromStop: StopId,
  toStop: StopId,
  tripContinuations: GtfsTripTransfer[],
): void => {
  if (
    transferEntry.from_trip_id === undefined ||
    transferEntry.from_trip_id === '' ||
    transferEntry.to_trip_id === undefined ||
    transferEntry.to_trip_id === ''
  ) {
    log.warn(
      `Unsupported in-seat transfer, missing from_trip_id and/or to_trip_id.`,
    );
    return;
  }

  const tripContinuationEntry: GtfsTripTransfer = {
    fromStop,
    fromTrip: transferEntry.from_trip_id,
    toStop,
    toTrip: transferEntry.to_trip_id,
  };
  tripContinuations.push(tripContinuationEntry);
};

/**
 * Processes timed connections and explicit minimum intervals between two trips.
 */
const processTripTransfer = (
  transferEntry: TransferEntry,
  fromStop: StopId,
  toStop: StopId,
  tripTransfers: GtfsTripTransfer[],
): void => {
  if (
    transferEntry.from_trip_id === undefined ||
    transferEntry.from_trip_id === '' ||
    transferEntry.to_trip_id === undefined ||
    transferEntry.to_trip_id === ''
  ) {
    // This shouldn't be called without trip IDs
    return;
  }

  const tripTransferEntry: GtfsTripTransfer = {
    fromStop,
    fromTrip: transferEntry.from_trip_id,
    toStop,
    toTrip: transferEntry.to_trip_id,
    ...(transferEntry.transfer_type === 2 && {
      type: TransferTypes.REQUIRES_MINIMAL_TIME,
      minTransferTime: durationFromSeconds(
        transferEntry.min_transfer_time ?? 0,
      ),
    }),
  };
  tripTransfers.push(tripTransferEntry);
};

/**
 * Processes guaranteed transfer entries (type 1) without trip IDs as stop-to-stop transfers.
 */
const processGuaranteedStopTransfer = (
  transferEntry: TransferEntry,
  fromStop: StopId,
  toStop: StopId,
  transfers: TransfersMap,
): void => {
  // Reject transfers that specify route IDs - these are not supported for stop-to-stop transfers
  if (transferEntry.from_route_id || transferEntry.to_route_id) {
    log.warn(
      `Unsupported transfer of type ${transferEntry.transfer_type} between routes ${transferEntry.from_route_id} and ${transferEntry.to_route_id}.`,
    );
    return;
  }

  const transfer: Transfer = {
    destination: toStop,
    type: TransferTypes.GUARANTEED,
    ...(transferEntry.min_transfer_time !== undefined && {
      minTransferTime: durationFromSeconds(transferEntry.min_transfer_time),
    }),
  };

  const fromStopTransfers = transfers.get(fromStop) || [];
  fromStopTransfers.push(transfer);
  transfers.set(fromStop, fromStopTransfers);
};

/**
 * Processes regular stop-to-stop transfer entries (types 0 and 2).
 */
const processStopToStopTransfer = (
  transferEntry: TransferEntry,
  fromStop: StopId,
  toStop: StopId,
  transfers: TransfersMap,
): void => {
  if (transferEntry.from_trip_id || transferEntry.to_trip_id) {
    log.warn(
      `Unsupported transfer of type ${transferEntry.transfer_type} between trips ${transferEntry.from_trip_id} and ${transferEntry.to_trip_id}.`,
    );
    return;
  }
  if (transferEntry.from_route_id || transferEntry.to_route_id) {
    log.warn(
      `Unsupported transfer of type ${transferEntry.transfer_type} between routes ${transferEntry.from_route_id} and ${transferEntry.to_route_id}.`,
    );
    return;
  }

  if (
    transferEntry.transfer_type === 2 &&
    transferEntry.min_transfer_time === undefined
  ) {
    console.info(
      `Missing minimum transfer time between ${transferEntry.from_stop_id} and ${transferEntry.to_stop_id}.`,
    );
  }

  const transfer: Transfer = {
    destination: toStop,
    type: parseGtfsTransferType(transferEntry.transfer_type),
    ...(transferEntry.min_transfer_time !== undefined && {
      minTransferTime: durationFromSeconds(transferEntry.min_transfer_time),
    }),
  };

  const fromStopTransfers = transfers.get(fromStop) || [];
  fromStopTransfers.push(transfer);
  transfers.set(fromStop, fromStopTransfers);
};

/**
 * Parses the transfers.txt file from a GTFS feed.
 *
 * @param transfersStream The readable stream containing the transfers data.
 * @param stopsMap The parsed GTFS stops indexed by their source IDs.
 * @param activeServiceIds The service IDs active for the requested date.
 * @param tripRoutes Optional trip-to-service-route mapping used to check route constraints.
 * @returns Parsed stop transfers, trip continuations, and trip-specific transfers.
 */
export const parseTransfers = async (
  transfersStream: NodeJS.ReadableStream,
  stopsMap: GtfsStopsMap,
  activeServiceIds: ServiceIds,
  tripRoutes?: ReadonlyMap<GtfsTripId, string>,
): Promise<{
  transfers: TransfersMap;
  forbiddenTransfers: ForbiddenTransfersMap;
  tripContinuations: GtfsTripTransfer[];
  tripTransfers: GtfsTripTransfer[];
}> => {
  const transfers: TransfersMap = new Map();
  const forbiddenTransfers: ForbiddenTransfersMap = new Map();
  const tripContinuations: GtfsTripTransfer[] = [];
  const tripTransfers: GtfsTripTransfer[] = [];

  for await (const rawLine of parseCsv(transfersStream, ['transfer_type'])) {
    const transferEntry = rawLine as TransferEntry;
    const minimum = (rawLine as { min_transfer_time?: string })
      .min_transfer_time;
    transferEntry.min_transfer_time =
      minimum === undefined || minimum === '' ? undefined : Number(minimum);

    if (
      transferEntry.service_id &&
      !activeServiceIds.has(transferEntry.service_id)
    ) {
      continue;
    }

    if (
      tripRoutes &&
      transferEntry.from_trip_id &&
      transferEntry.to_trip_id &&
      ((transferEntry.from_route_id &&
        tripRoutes.has(transferEntry.from_trip_id) &&
        tripRoutes.get(transferEntry.from_trip_id) !==
          transferEntry.from_route_id) ||
        (transferEntry.to_route_id &&
          tripRoutes.has(transferEntry.to_trip_id) &&
          tripRoutes.get(transferEntry.to_trip_id) !==
            transferEntry.to_route_id))
    ) {
      log.warn(
        'Trip transfer references a route that does not contain its trip',
      );
      continue;
    }

    // Type 5 only prevents remaining seated between two specific trips. It
    // does not prohibit an ordinary stop-to-stop transfer.
    if (transferEntry.transfer_type === 5) {
      continue;
    }

    if (!transferEntry.from_stop_id || !transferEntry.to_stop_id) {
      log.warn(`Missing transfer origin or destination stop.`);
      continue;
    }
    const fromStop = stopsMap.get(transferEntry.from_stop_id);
    const toStop = stopsMap.get(transferEntry.to_stop_id);

    if (!fromStop || !toStop) {
      log.warn(
        `Transfer references non-existent stop(s): from_stop_id=${transferEntry.from_stop_id}, to_stop_id=${transferEntry.to_stop_id}`,
      );
      continue;
    }

    if (
      (transferEntry.transfer_type === 1 ||
        transferEntry.transfer_type === 2) &&
      (transferEntry.from_trip_id || transferEntry.to_trip_id) &&
      !(transferEntry.from_trip_id && transferEntry.to_trip_id)
    ) {
      log.warn('Unsupported transfer with only one trip specified');
      continue;
    }

    switch (transferEntry.transfer_type) {
      case 4: // In-seat transfer
        processInSeatTransfer(
          transferEntry,
          fromStop.id,
          toStop.id,
          tripContinuations,
        );
        break;
      case 2: // Trip-specific minimum or generic stop transfer
      case 1: // Guaranteed transfer
        // Trip IDs scope guarantees and minimum times to a specific trip pair.
        if (
          transferEntry.from_trip_id &&
          transferEntry.from_trip_id !== '' &&
          transferEntry.to_trip_id &&
          transferEntry.to_trip_id !== ''
        ) {
          if (
            transferEntry.transfer_type === 2 &&
            (transferEntry.min_transfer_time === undefined ||
              !Number.isFinite(transferEntry.min_transfer_time) ||
              transferEntry.min_transfer_time < 0)
          ) {
            log.warn('Invalid minimum time for trip transfer');
            break;
          }
          processTripTransfer(
            transferEntry,
            fromStop.id,
            toStop.id,
            tripTransfers,
          );
        } else if (transferEntry.transfer_type === 2) {
          processStopToStopTransfer(
            transferEntry,
            fromStop.id,
            toStop.id,
            transfers,
          );
        } else {
          processGuaranteedStopTransfer(
            transferEntry,
            fromStop.id,
            toStop.id,
            transfers,
          );
        }
        break;
      case 3: {
        if (
          transferEntry.from_trip_id ||
          transferEntry.to_trip_id ||
          transferEntry.from_route_id ||
          transferEntry.to_route_id
        ) {
          log.warn(
            `Unsupported transfer of type 3 with trip or route constraints: from_trip_id=${transferEntry.from_trip_id}, to_trip_id=${transferEntry.to_trip_id}, from_route_id=${transferEntry.from_route_id}, to_route_id=${transferEntry.to_route_id}.`,
          );
          break;
        }
        const forbiddenDestinations =
          forbiddenTransfers.get(fromStop.id) ?? new Set<StopId>();
        forbiddenDestinations.add(toStop.id);
        forbiddenTransfers.set(fromStop.id, forbiddenDestinations);
        break;
      }
      case 0: // Recommended transfer
      default:
        processStopToStopTransfer(
          transferEntry,
          fromStop.id,
          toStop.id,
          transfers,
        );
        break;
    }
  }

  return {
    transfers,
    forbiddenTransfers,
    tripContinuations,
    tripTransfers,
  };
};

/**
 * Adds missing directed transfers between route-served child stops belonging
 * to the same parent station.
 *
 * GTFS feeds commonly use parent_station to group platforms while omitting the
 * corresponding transfers.txt rows. The generated transfers intentionally do
 * not carry a fixed duration: routing applies the query's fallback minimum
 * transfer time. Explicit and forbidden feed entries always take precedence.
 *
 * @returns The number of directed sibling transfers added.
 */
export const addMissingSiblingTransfers = (
  stopsMap: GtfsStopsMap,
  activeStops: ReadonlySet<StopId>,
  transfers: TransfersMap,
  forbiddenTransfers: ForbiddenTransfersMap = new Map(),
): number => {
  let addedTransfers = 0;

  for (const parent of stopsMap.values()) {
    const activeChildren = parent.children.filter((child) =>
      activeStops.has(child),
    );
    if (activeChildren.length < 2) continue;

    for (const fromStop of activeChildren) {
      const existing = transfers.get(fromStop) ?? [];
      const connected = new Set(
        existing.map((transfer) => transfer.destination),
      );
      const forbidden = forbiddenTransfers.get(fromStop);

      for (const toStop of activeChildren) {
        if (
          toStop === fromStop ||
          connected.has(toStop) ||
          forbidden?.has(toStop)
        ) {
          continue;
        }
        existing.push({
          destination: toStop,
          type: TransferTypes.REQUIRES_MINIMAL_TIME,
        });
        connected.add(toStop);
        addedTransfers += 1;
      }

      if (existing.length > 0) {
        transfers.set(fromStop, existing);
      }
    }
  }

  return addedTransfers;
};

/**
 * Merges generated transfers into parsed feed transfers.
 *
 * Only transfers between active stops are kept. Explicit feed transfers and
 * forbidden directed pairs take precedence over generated candidates.
 *
 * @returns The number of generated transfers added.
 */
export const addGeneratedTransfers = (
  generatedTransfers: ReadonlyMap<StopId, readonly Transfer[]>,
  activeStops: ReadonlySet<StopId>,
  transfers: TransfersMap,
  forbiddenTransfers: ForbiddenTransfersMap = new Map(),
): number => {
  let addedTransfers = 0;

  for (const [fromStop, candidates] of generatedTransfers) {
    if (!activeStops.has(fromStop)) continue;

    const existing = transfers.get(fromStop) ?? [];
    const connected = new Set(existing.map((transfer) => transfer.destination));
    const forbidden = forbiddenTransfers.get(fromStop);

    for (const transfer of candidates) {
      if (
        !activeStops.has(transfer.destination) ||
        connected.has(transfer.destination) ||
        forbidden?.has(transfer.destination)
      ) {
        continue;
      }
      connected.add(transfer.destination);
      existing.push(transfer);
      addedTransfers += 1;
    }

    if (existing.length > 0) {
      transfers.set(fromStop, existing);
    }
  }

  return addedTransfers;
};

/**
 * Resolve GTFS trip references after route partitioning. A repeated stop ID
 * applies to every trip stop pair. Keep infeasible type-2 pairs as restrictions:
 * dropping them would incorrectly allow the generic transfer as a fallback.
 */
export const buildTripTransfers = (
  tripsMapping: TripsMapping,
  gtfsTripTransfers: GtfsTripTransfer[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
): TripTransfers => {
  const tripTransfers: TripTransfers = new Map();

  for (const gtfsTransfer of gtfsTripTransfers) {
    if (
      !activeStopIds.has(gtfsTransfer.fromStop) ||
      !activeStopIds.has(gtfsTransfer.toStop)
    ) {
      continue;
    }
    const fromTripMapping = tripsMapping.get(gtfsTransfer.fromTrip);
    const toTripMapping = tripsMapping.get(gtfsTransfer.toTrip);

    if (!fromTripMapping || !toTripMapping) {
      continue;
    }

    const fromRoute = timetable.getRoute(fromTripMapping.routeId);
    const toRoute = timetable.getRoute(toTripMapping.routeId);

    if (!fromRoute || !toRoute) {
      continue;
    }

    for (const fromStopIndex of fromRoute.stopRouteIndices(
      gtfsTransfer.fromStop,
    )) {
      for (const toStopIndex of toRoute.stopRouteIndices(gtfsTransfer.toStop)) {
        const sourceArrival = fromRoute.arrivalAt(
          fromStopIndex,
          fromTripMapping.tripRouteIndex,
        );
        const targetDeparture = toRoute.departureFrom(
          toStopIndex,
          toTripMapping.tripRouteIndex,
        );
        if (
          gtfsTransfer.type !== TransferTypes.REQUIRES_MINIMAL_TIME &&
          targetDeparture < sourceArrival
        )
          continue;
        const tripStopKey = encode(
          fromStopIndex,
          fromTripMapping.routeId,
          fromTripMapping.tripRouteIndex,
        );
        const transferDestination: TripStop = {
          stopIndex: toStopIndex,
          routeId: toTripMapping.routeId,
          tripIndex: toTripMapping.tripRouteIndex,
          ...(gtfsTransfer.type !== undefined && {
            type: gtfsTransfer.type,
          }),
          ...(gtfsTransfer.minTransferTime !== undefined && {
            minTransferTime: gtfsTransfer.minTransferTime,
          }),
        };
        const existing = tripTransfers.get(tripStopKey) ?? [];
        existing.push(transferDestination);
        tripTransfers.set(tripStopKey, existing);
      }
    }
  }

  return tripTransfers;
};

const parseGtfsTransferType = (
  gtfsTransferType: GtfsTransferType,
): TransferType => {
  switch (gtfsTransferType) {
    case 0:
    default:
      return TransferTypes.RECOMMENDED;
    case 1:
      return TransferTypes.GUARANTEED;
    case 2:
      return TransferTypes.REQUIRES_MINIMAL_TIME;
    case 4:
      return TransferTypes.IN_SEAT;
  }
};
