import log from 'loglevel';

import { SourceStopId, StopId } from '../stops/stops.js';
import { Route } from '../timetable/route.js';
import { durationFromSeconds } from '../timetable/time.js';
import {
  MinimumTripTransfers,
  ServiceRouteId,
  Timetable,
  Transfer,
  TransferType,
  TransferTypes,
  TripStop,
  TripTransfers as TripTransfers,
} from '../timetable/timetable.js';
import { encode } from '../timetable/tripStopId.js';
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
  minTransferTime?: number;
};

export type GtfsMinimumTripTransfer = GtfsTripTransfer & {
  minTransferTime: number;
};

export type TransferEntry = {
  from_stop_id?: SourceStopId;
  to_stop_id?: SourceStopId;
  from_trip_id?: GtfsTripId;
  to_trip_id?: GtfsTripId;
  from_route_id?: ServiceRouteId;
  to_route_id?: ServiceRouteId;
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
 * Processes guaranteed transfer entries (type 1) with trip IDs as trip-to-trip transfers.
 */
const processGuaranteedTripTransfer = (
  transferEntry: TransferEntry,
  fromStop: StopId,
  toStop: StopId,
  guaranteedTripTransfers: GtfsTripTransfer[],
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

  const guaranteedTripTransferEntry: GtfsTripTransfer = {
    fromStop,
    fromTrip: transferEntry.from_trip_id,
    toStop,
    toTrip: transferEntry.to_trip_id,
  };
  guaranteedTripTransfers.push(guaranteedTripTransferEntry);
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
 * @param activeTrips Optional active trip membership, checked before retaining trip-pair rows.
 * @returns Parsed stop transfers, continuations, guarantees, and trip-specific minima.
 */
export const parseTransfers = async (
  transfersStream: NodeJS.ReadableStream,
  stopsMap: GtfsStopsMap,
  activeServiceIds: ServiceIds,
  activeTrips?: ReadonlySet<GtfsTripId> | ReadonlyMap<GtfsTripId, unknown>,
): Promise<{
  transfers: TransfersMap;
  forbiddenTransfers: ForbiddenTransfersMap;
  tripContinuations: GtfsTripTransfer[];
  guaranteedTripTransfers: GtfsTripTransfer[];
  minimumTripTransfers: GtfsMinimumTripTransfer[];
}> => {
  const transfers: TransfersMap = new Map();
  const forbiddenTransfers: ForbiddenTransfersMap = new Map();
  const tripContinuations: GtfsTripTransfer[] = [];
  const guaranteedTripTransfers: GtfsTripTransfer[] = [];
  const minimumTripTransfers: GtfsMinimumTripTransfer[] = [];

  for await (const rawLine of parseCsv(transfersStream, ['transfer_type'])) {
    const transferEntry = rawLine as TransferEntry;
    // Empty CSV cells are missing, not a zero-second minimum.
    const rawMinimum = (rawLine as { min_transfer_time?: string })
      .min_transfer_time;
    transferEntry.min_transfer_time =
      rawMinimum === undefined || rawMinimum.trim() === ''
        ? undefined
        : Number(rawMinimum);

    if (
      transferEntry.service_id &&
      !activeServiceIds.has(transferEntry.service_id)
    ) {
      continue;
    }

    // Most trip-pair rows in a multi-date feed do not apply to this day.
    if (
      activeTrips &&
      ((transferEntry.from_trip_id &&
        !activeTrips.has(transferEntry.from_trip_id)) ||
        (transferEntry.to_trip_id &&
          !activeTrips.has(transferEntry.to_trip_id)))
    ) {
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

    switch (transferEntry.transfer_type) {
      case 4: // In-seat transfer
        processInSeatTransfer(
          transferEntry,
          fromStop.id,
          toStop.id,
          tripContinuations,
        );
        break;
      case 1: // Guaranteed transfer
        // If trip IDs are provided, treat as trip-to-trip guaranteed transfer
        // Otherwise, treat as stop-to-stop guaranteed transfer
        if (
          transferEntry.from_trip_id &&
          transferEntry.from_trip_id !== '' &&
          transferEntry.to_trip_id &&
          transferEntry.to_trip_id !== ''
        ) {
          processGuaranteedTripTransfer(
            transferEntry,
            fromStop.id,
            toStop.id,
            guaranteedTripTransfers,
          );
        } else if (transferEntry.from_trip_id || transferEntry.to_trip_id) {
          log.warn('Unsupported guaranteed transfer with only one trip ID.');
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
      case 2: // An exact trip pair has its own minimum, not a walking edge.
        if (transferEntry.from_trip_id && transferEntry.to_trip_id) {
          const seconds = transferEntry.min_transfer_time;
          if (
            seconds === undefined ||
            !Number.isFinite(seconds) ||
            seconds < 0
          ) {
            log.warn(
              'Invalid or missing minimum time for trip-specific transfer.',
            );
            break;
          }
          minimumTripTransfers.push({
            fromStop: fromStop.id,
            toStop: toStop.id,
            fromTrip: transferEntry.from_trip_id,
            toTrip: transferEntry.to_trip_id,
            minTransferTime: durationFromSeconds(seconds),
          });
          break;
        }
        processStopToStopTransfer(
          transferEntry,
          fromStop.id,
          toStop.id,
          transfers,
        );
        break;
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
    guaranteedTripTransfers,
    minimumTripTransfers,
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
    if (activeChildren.length < 2) {
      continue;
    }

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
    if (!activeStops.has(fromStop)) {
      continue;
    }

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
 * Disambiguates stops involved in a transfer.
 *
 * The GTFS specification only refers to a stopId in the trip-to-trip transfers and not the
 * specific stop index in the route. For routes that have multiple stops with the same stopId,
 * we need to determine which are the from / to stop indices in respective routes.
 * We do so by picking the stop indices leading to the most coherent transfer.
 * (we pick the closest from stop index happening after the to stop index).
 */
const disambiguateTransferStopsIndices = (
  fromStop: StopId,
  fromRoute: Route,
  fromTripIndex: number,
  toStop: StopId,
  toRoute: Route,
  toTripIndex: number,
  minimumTime = 0,
): { fromStopIndex: number; toStopIndex: number } | undefined => {
  const fromStopIndices = fromRoute.stopRouteIndices(fromStop);
  const toStopIndices = toRoute.stopRouteIndices(toStop);
  let bestFromStopIndex: number | undefined;
  let bestToStopIndex: number | undefined;
  let bestTimeDifference = Infinity;
  let bestFeasible: { fromStopIndex: number; toStopIndex: number } | undefined;
  let feasibleDifference = Infinity;

  for (const originStopIndex of fromStopIndices) {
    const fromArrivalTime = fromRoute.arrivalAt(originStopIndex, fromTripIndex);
    for (const toStopIndex of toStopIndices) {
      const toDepartureTime = toRoute.departureFrom(toStopIndex, toTripIndex);
      if (toDepartureTime >= fromArrivalTime) {
        const timeDifference = toDepartureTime - fromArrivalTime;
        if (
          timeDifference >= minimumTime &&
          timeDifference < feasibleDifference
        ) {
          feasibleDifference = timeDifference;
          bestFeasible = { fromStopIndex: originStopIndex, toStopIndex };
        }
        if (timeDifference < bestTimeDifference) {
          bestTimeDifference = timeDifference;
          bestFromStopIndex = originStopIndex;
          bestToStopIndex = toStopIndex;
        }
      }
    }
  }

  if (bestFeasible) {
    return bestFeasible;
  }
  if (bestFromStopIndex !== undefined && bestToStopIndex !== undefined) {
    return {
      fromStopIndex: bestFromStopIndex,
      toStopIndex: bestToStopIndex,
    };
  }

  return undefined;
};

/**
 * Builds trip continuations map from GTFS trip continuation data.
 *
 * This function processes GTFS in-seat transfer data and creates a mapping
 * from trip boarding IDs to continuation boarding information. It disambiguates
 * stop indices when routes have multiple stops with the same ID by finding
 * the most coherent transfer timing.
 *
 * @param tripsMapping Mapping from GTFS trip IDs to internal trip representations
 * @param gtfsTripTransfers Array of GTFS trip continuation data from transfers.txt
 * @param timetable The timetable containing route and timing information
 * @param activeStopIds Set of stop IDs that are active/enabled in the system
 * @returns A map from trip boarding IDs to arrays of continuation boarding options
 */
export const buildTripTransfers = (
  tripsMapping: TripsMapping,
  gtfsTripTransfers: GtfsTripTransfer[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
): TripTransfers => {
  const continuations: TripTransfers = new Map();

  for (const gtfsContinuation of gtfsTripTransfers) {
    if (
      !activeStopIds.has(gtfsContinuation.fromStop) ||
      !activeStopIds.has(gtfsContinuation.toStop)
    ) {
      continue;
    }
    const fromTripMapping = tripsMapping.get(gtfsContinuation.fromTrip);
    const toTripMapping = tripsMapping.get(gtfsContinuation.toTrip);

    if (!fromTripMapping || !toTripMapping) {
      continue;
    }

    const fromRoute = timetable.getRoute(fromTripMapping.routeId);
    const toRoute = timetable.getRoute(toTripMapping.routeId);

    if (!fromRoute || !toRoute) {
      continue;
    }

    const bestStopIndices = disambiguateTransferStopsIndices(
      gtfsContinuation.fromStop,
      fromRoute,
      fromTripMapping.tripRouteIndex,
      gtfsContinuation.toStop,
      toRoute,
      toTripMapping.tripRouteIndex,
      gtfsContinuation.minTransferTime,
    );

    if (!bestStopIndices) {
      continue;
    }

    const tripStopId = encode(
      bestStopIndices.fromStopIndex,
      fromTripMapping.routeId,
      fromTripMapping.tripRouteIndex,
    );

    const continuationBoarding: TripStop = {
      stopIndex: bestStopIndices.toStopIndex,
      routeId: toTripMapping.routeId,
      tripIndex: toTripMapping.tripRouteIndex,
    };

    const existingContinuations = continuations.get(tripStopId) || [];
    existingContinuations.push(continuationBoarding);
    continuations.set(tripStopId, existingContinuations);
  }

  return continuations;
};

/** Keep even an infeasible minimum: ordinary boarding must not bypass it. */
export const buildMinimumTripTransfers = (
  tripsMapping: TripsMapping,
  entries: GtfsMinimumTripTransfer[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
): MinimumTripTransfers => {
  const result: MinimumTripTransfers = new Map();
  for (const entry of entries) {
    for (const [origin, destinations] of buildTripTransfers(
      tripsMapping,
      [entry],
      timetable,
      activeStopIds,
    )) {
      const existing = result.get(origin) ?? [];
      existing.push(
        ...destinations.map((destination) => ({
          ...destination,
          minTransferTime: entry.minTransferTime,
        })),
      );
      result.set(origin, existing);
    }
  }
  return result;
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
