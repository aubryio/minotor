import log from 'loglevel';

import { SourceStopId, StopId } from '../stops/stops.js';
import { Route } from '../timetable/route.js';
import { durationFromSeconds } from '../timetable/time.js';
import {
  MinimumTimeTripTransfers,
  ServiceRouteId,
  Timetable,
  Transfer,
  TransferType,
  TransferTypes,
  TripStop,
  TripTransfers as TripTransfers,
} from '../timetable/timetable.js';
import { encode } from '../timetable/tripStopId.js';
import { GtfsRouteId } from './routes.js';
import { ServiceId, ServiceIds } from './services.js';
import { GtfsStopsMap } from './stops.js';
import { GtfsTripId, GtfsTripIdsMap, TripsMapping } from './trips.js';
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
};

export type GtfsMinimumTimeTripTransfer = GtfsTripTransfer & {
  fromRoute?: GtfsRouteId;
  toRoute?: GtfsRouteId;
  minTransferTime?: number;
};

export type QualifiedMinimumTimeTripTransfer = GtfsTripTransfer & {
  fromRoute?: ServiceRouteId;
  toRoute?: ServiceRouteId;
  minTransferTime?: number;
};

export type TransferEntry = {
  from_stop_id?: SourceStopId;
  to_stop_id?: SourceStopId;
  from_trip_id?: GtfsTripId;
  to_trip_id?: GtfsTripId;
  from_route_id?: GtfsRouteId;
  to_route_id?: GtfsRouteId;
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

const processMinimumTimeTripTransfer = (
  transferEntry: TransferEntry,
  fromStop: StopId,
  toStop: StopId,
  minimumTimeTripTransfers: GtfsMinimumTimeTripTransfer[],
): void => {
  const fromTrip = transferEntry.from_trip_id;
  const toTrip = transferEntry.to_trip_id;
  if (!fromTrip || !toTrip) {
    log.warn(
      `Unsupported partially qualified transfer of type 2 between trips ${transferEntry.from_trip_id} and ${transferEntry.to_trip_id}.`,
    );
    return;
  }

  if (transferEntry.min_transfer_time === undefined) {
    log.warn(
      `Missing minimum transfer time between trips ${transferEntry.from_trip_id} and ${transferEntry.to_trip_id}.`,
    );
  }

  minimumTimeTripTransfers.push({
    fromStop,
    fromTrip,
    toStop,
    toTrip,
    ...(transferEntry.from_route_id && {
      fromRoute: transferEntry.from_route_id,
    }),
    ...(transferEntry.to_route_id && {
      toRoute: transferEntry.to_route_id,
    }),
    ...(transferEntry.min_transfer_time !== undefined && {
      minTransferTime: durationFromSeconds(transferEntry.min_transfer_time),
    }),
  });
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
 * @returns Parsed stop transfers, trip continuations, and guaranteed trip transfers.
 */
export const parseTransfers = async (
  transfersStream: NodeJS.ReadableStream,
  stopsMap: GtfsStopsMap,
  activeServiceIds: ServiceIds,
): Promise<{
  transfers: TransfersMap;
  forbiddenTransfers: ForbiddenTransfersMap;
  tripContinuations: GtfsTripTransfer[];
  guaranteedTripTransfers: GtfsTripTransfer[];
  minimumTimeTripTransfers: GtfsMinimumTimeTripTransfer[];
}> => {
  const transfers: TransfersMap = new Map();
  const forbiddenTransfers: ForbiddenTransfersMap = new Map();
  const tripContinuations: GtfsTripTransfer[] = [];
  const guaranteedTripTransfers: GtfsTripTransfer[] = [];
  const minimumTimeTripTransfers: GtfsMinimumTimeTripTransfer[] = [];

  for await (const rawLine of parseCsv(transfersStream, [
    'transfer_type',
    'min_transfer_time',
  ])) {
    const transferEntry = rawLine as TransferEntry;

    if (
      transferEntry.service_id &&
      !activeServiceIds.has(transferEntry.service_id)
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
      case 2: // Requires minimal time
        if (transferEntry.from_trip_id || transferEntry.to_trip_id) {
          processMinimumTimeTripTransfer(
            transferEntry,
            fromStop.id,
            toStop.id,
            minimumTimeTripTransfers,
          );
        } else {
          processStopToStopTransfer(
            transferEntry,
            fromStop.id,
            toStop.id,
            transfers,
          );
        }
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
    minimumTimeTripTransfers,
  };
};

/**
 * Resolves and validates exact type-2 transfer qualifiers against the active
 * service routes and the concrete internal trips built for the requested day.
 */
export const resolveMinimumTimeTripTransfers = (
  transfers: GtfsMinimumTimeTripTransfer[],
  gtfsTrips: GtfsTripIdsMap,
  serviceRoutesMap: ReadonlyMap<GtfsRouteId, ServiceRouteId>,
  tripsMapping: TripsMapping,
  timetable: Timetable,
): QualifiedMinimumTimeTripTransfer[] => {
  const resolved: QualifiedMinimumTimeTripTransfer[] = [];

  for (const transfer of transfers) {
    const fromGtfsRoute = gtfsTrips.get(transfer.fromTrip);
    const toGtfsRoute = gtfsTrips.get(transfer.toTrip);
    if (!fromGtfsRoute || !toGtfsRoute) {
      log.warn(
        `Transfer references unknown trip(s): from_trip_id=${transfer.fromTrip}, to_trip_id=${transfer.toTrip}.`,
      );
      continue;
    }
    if (
      (transfer.fromRoute && transfer.fromRoute !== fromGtfsRoute) ||
      (transfer.toRoute && transfer.toRoute !== toGtfsRoute)
    ) {
      log.warn(
        `Transfer trip/route qualifier mismatch: from_trip_id=${transfer.fromTrip}, from_route_id=${transfer.fromRoute}, to_trip_id=${transfer.toTrip}, to_route_id=${transfer.toRoute}.`,
      );
      continue;
    }

    const fromRouteQualifier = transfer.fromRoute ?? fromGtfsRoute;
    const toRouteQualifier = transfer.toRoute ?? toGtfsRoute;
    const fromServiceRoute = serviceRoutesMap.get(fromRouteQualifier);
    const toServiceRoute = serviceRoutesMap.get(toRouteQualifier);
    if (fromServiceRoute === undefined || toServiceRoute === undefined) {
      log.warn(
        `Transfer references route(s) without an active service route: from_route_id=${fromRouteQualifier}, to_route_id=${toRouteQualifier}.`,
      );
      continue;
    }

    const fromTrip = tripsMapping.get(transfer.fromTrip);
    const toTrip = tripsMapping.get(transfer.toTrip);
    if (!fromTrip || !toTrip) {
      log.warn(
        `Transfer references trip(s) without an active internal trip: from_trip_id=${transfer.fromTrip}, to_trip_id=${transfer.toTrip}.`,
      );
      continue;
    }
    const fromInternalRoute = timetable.getRoute(fromTrip.routeId);
    const toInternalRoute = timetable.getRoute(toTrip.routeId);
    if (
      !fromInternalRoute ||
      !toInternalRoute ||
      fromInternalRoute.serviceRoute() !== fromServiceRoute ||
      toInternalRoute.serviceRoute() !== toServiceRoute
    ) {
      log.warn(
        `Transfer trip/service-route mismatch: from_trip_id=${transfer.fromTrip}, to_trip_id=${transfer.toTrip}.`,
      );
      continue;
    }

    resolved.push({
      fromStop: transfer.fromStop,
      fromTrip: transfer.fromTrip,
      toStop: transfer.toStop,
      toTrip: transfer.toTrip,
      ...(transfer.fromRoute !== undefined && { fromRoute: fromServiceRoute }),
      ...(transfer.toRoute !== undefined && { toRoute: toServiceRoute }),
      ...(transfer.minTransferTime !== undefined && {
        minTransferTime: transfer.minTransferTime,
      }),
    });
  }

  return resolved;
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
): { fromStopIndex: number; toStopIndex: number } | undefined => {
  const fromStopIndices = fromRoute.stopRouteIndices(fromStop);
  const toStopIndices = toRoute.stopRouteIndices(toStop);
  let bestFromStopIndex: number | undefined;
  let bestToStopIndex: number | undefined;
  let bestTimeDifference = Infinity;

  for (const originStopIndex of fromStopIndices) {
    const fromArrivalTime = fromRoute.arrivalAt(originStopIndex, fromTripIndex);
    for (const toStopIndex of toStopIndices) {
      const toDepartureTime = toRoute.departureFrom(toStopIndex, toTripIndex);
      if (toDepartureTime > fromArrivalTime) {
        const timeDifference = toDepartureTime - fromArrivalTime;
        if (timeDifference < bestTimeDifference) {
          bestTimeDifference = timeDifference;
          bestFromStopIndex = originStopIndex;
          bestToStopIndex = toStopIndex;
        }
      }
    }
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
const buildResolvedTripTransfers = <
  T extends GtfsTripTransfer,
  D extends TripStop,
>(
  tripsMapping: TripsMapping,
  gtfsTripTransfers: T[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
  buildDestination: (tripStop: TripStop, transfer: T) => D,
): Map<ReturnType<typeof encode>, D[]> => {
  const continuations = new Map<ReturnType<typeof encode>, D[]>();

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
    );

    if (!bestStopIndices) {
      continue;
    }

    const tripStopId = encode(
      bestStopIndices.fromStopIndex,
      fromTripMapping.routeId,
      fromTripMapping.tripRouteIndex,
    );

    const continuationBoarding = buildDestination(
      {
        stopIndex: bestStopIndices.toStopIndex,
        routeId: toTripMapping.routeId,
        tripIndex: toTripMapping.tripRouteIndex,
      },
      gtfsContinuation,
    );

    const existingContinuations = continuations.get(tripStopId) || [];
    existingContinuations.push(continuationBoarding);
    continuations.set(tripStopId, existingContinuations);
  }

  return continuations;
};

export const buildTripTransfers = (
  tripsMapping: TripsMapping,
  gtfsTripTransfers: GtfsTripTransfer[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
): TripTransfers =>
  buildResolvedTripTransfers(
    tripsMapping,
    gtfsTripTransfers,
    timetable,
    activeStopIds,
    (tripStop) => tripStop,
  );

export const buildMinimumTimeTripTransfers = (
  tripsMapping: TripsMapping,
  gtfsTripTransfers: QualifiedMinimumTimeTripTransfer[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
): MinimumTimeTripTransfers =>
  buildResolvedTripTransfers(
    tripsMapping,
    gtfsTripTransfers,
    timetable,
    activeStopIds,
    (tripStop, transfer) => ({
      ...tripStop,
      ...(transfer.minTransferTime !== undefined && {
        minTransferTime: transfer.minTransferTime,
      }),
    }),
  );

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
