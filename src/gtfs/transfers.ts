import { SourceStopId, StopId } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
import { ParentStationTransferTimes } from '../timetable/io.js';
import { Route } from '../timetable/route.js';
import {
  ServiceRouteId,
  Timetable,
  Transfer,
  TransferType,
  TripStop,
  TripTransfers as TripTransfers,
} from '../timetable/timetable.js';
import { encode } from '../timetable/tripStopId.js';
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

export type GtfsTripTransfer = {
  fromStop: StopId;
  fromTrip: GtfsTripId;
  toStop: StopId;
  toTrip: GtfsTripId;
};

export type TransferEntry = {
  from_stop_id?: SourceStopId;
  to_stop_id?: SourceStopId;
  from_trip_id?: GtfsTripId;
  to_trip_id?: GtfsTripId;
  from_route_id?: ServiceRouteId;
  to_route_id?: ServiceRouteId;
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
    console.warn(
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
    console.warn(
      `Unsupported transfer of type ${transferEntry.transfer_type} between routes ${transferEntry.from_route_id} and ${transferEntry.to_route_id}.`,
    );
    return;
  }

  const transfer: Transfer = {
    destination: toStop,
    type: 'GUARANTEED',
    ...(transferEntry.min_transfer_time !== undefined && {
      minTransferTime: Duration.fromSeconds(transferEntry.min_transfer_time),
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
    console.warn(
      `Unsupported transfer of type ${transferEntry.transfer_type} between trips ${transferEntry.from_trip_id} and ${transferEntry.to_trip_id}.`,
    );
    return;
  }
  if (transferEntry.from_route_id || transferEntry.to_route_id) {
    console.warn(
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
      minTransferTime: Duration.fromSeconds(transferEntry.min_transfer_time),
    }),
  };

  const fromStopTransfers = transfers.get(fromStop) || [];
  fromStopTransfers.push(transfer);
  transfers.set(fromStop, fromStopTransfers);
};

/**
 * Parses the transfers.txt file from a GTFS feed.
 *
 * @param stopsStream The readable stream containing the stops data.
 * @return A mapping of stop IDs to corresponding stop details.
 */
export const parseTransfers = async (
  transfersStream: NodeJS.ReadableStream,
  stopsMap: GtfsStopsMap,
): Promise<{
  transfers: TransfersMap;
  tripContinuations: GtfsTripTransfer[];
  guaranteedTripTransfers: GtfsTripTransfer[];
}> => {
  const transfers: TransfersMap = new Map();
  const tripContinuations: GtfsTripTransfer[] = [];
  const guaranteedTripTransfers: GtfsTripTransfer[] = [];

  for await (const rawLine of parseCsv(transfersStream, [
    'transfer_type',
    'min_transfer_time',
  ])) {
    const transferEntry = rawLine as TransferEntry;

    if (
      transferEntry.transfer_type === 3 ||
      transferEntry.transfer_type === 5
    ) {
      continue;
    }

    if (!transferEntry.from_stop_id || !transferEntry.to_stop_id) {
      console.warn(`Missing transfer origin or destination stop.`);
      continue;
    }
    const fromStop = stopsMap.get(transferEntry.from_stop_id);
    const toStop = stopsMap.get(transferEntry.to_stop_id);

    if (!fromStop || !toStop) {
      console.warn(
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
      case 0: // Recommended transfer
      case 2: // Requires minimal time
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
    tripContinuations,
    guaranteedTripTransfers,
  };
};

/**
 * Computes the median transfer time for each parent station based on
 * transfer times between its child stops.
 *
 * @param transfers The parsed transfers map (child stop -> transfers)
 * @param stopsMap The parsed stops map
 * @returns A map of parent station IDs to their median transfer times in seconds
 */
export const computeParentStationTransferTimes = (
  transfers: TransfersMap,
  stopsMap: GtfsStopsMap,
): ParentStationTransferTimes => {
  // Build a quick lookup from stopId to parent
  const stopToParent = new Map<StopId, StopId>();
  for (const stop of stopsMap.values()) {
    if (stop.parent !== undefined) {
      stopToParent.set(stop.id, stop.parent);
    }
  }

  // Group transfer times by parent station
  const transferTimesByStation = new Map<StopId, number[]>();

  for (const [fromStopId, transferList] of transfers) {
    const fromParentId = stopToParent.get(fromStopId);
    if (fromParentId === undefined) continue;

    for (const transfer of transferList) {
      const toParentId = stopToParent.get(transfer.destination);

      // Only consider transfers within the same parent station
      if (toParentId !== fromParentId) continue;

      if (transfer.minTransferTime !== undefined) {
        const times = transferTimesByStation.get(fromParentId) || [];
        times.push(transfer.minTransferTime.toSeconds());
        transferTimesByStation.set(fromParentId, times);
      }
    }
  }

  // Compute median for each station
  const result: ParentStationTransferTimes = new Map();

  for (const [stationId, times] of transferTimesByStation) {
    if (times.length === 0) continue;

    times.sort((a, b) => a - b);

    const mid = Math.floor(times.length / 2);
    const median =
      times.length % 2 === 0
        ? Math.round(((times[mid - 1] ?? 0) + (times[mid] ?? 0)) / 2)
        : (times[mid] ?? 0);

    result.set(stationId, median);
  }

  return result;
};

/**
 * Transforms the transfers map to use parent station IDs when parent station mode is enabled.
 * Filters out intra-station transfers (they'll use the median transfer time instead).
 *
 * @param transfers The original transfers map (child stop -> transfers)
 * @param stopsMap The parsed stops map
 * @returns A new transfers map using parent station IDs for inter-station transfers
 */
export const transformTransfersForParentStations = (
  transfers: TransfersMap,
  stopsMap: GtfsStopsMap,
): TransfersMap => {
  // Build a quick lookup from stopId to parent
  const stopToParent = new Map<StopId, StopId>();
  for (const stop of stopsMap.values()) {
    if (stop.parent !== undefined) {
      stopToParent.set(stop.id, stop.parent);
    }
  }

  const result: TransfersMap = new Map();

  for (const [fromStopId, transferList] of transfers) {
    const effectiveFromId = stopToParent.get(fromStopId) ?? fromStopId;

    for (const transfer of transferList) {
      const effectiveToId =
        stopToParent.get(transfer.destination) ?? transfer.destination;

      // Skip intra-station transfers (same parent or same stop)
      if (effectiveFromId === effectiveToId) continue;

      const existingTransfers = result.get(effectiveFromId) || [];

      // Check if we already have a transfer to this destination
      const existingTransfer = existingTransfers.find(
        (t) => t.destination === effectiveToId,
      );

      if (existingTransfer) {
        // Keep the shorter transfer time
        if (
          transfer.minTransferTime !== undefined &&
          (existingTransfer.minTransferTime === undefined ||
            transfer.minTransferTime.toSeconds() <
              existingTransfer.minTransferTime.toSeconds())
        ) {
          existingTransfer.minTransferTime = transfer.minTransferTime;
        }
      } else {
        existingTransfers.push({
          destination: effectiveToId,
          type: transfer.type,
          minTransferTime: transfer.minTransferTime,
        });
        result.set(effectiveFromId, existingTransfers);
      }
    }
  }

  return result;
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
      if (toDepartureTime.isAfter(fromArrivalTime)) {
        const timeDifference =
          toDepartureTime.toMinutes() - fromArrivalTime.toMinutes();
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
 * @param activeStopIds Set of stop IDs that are active/enabled in the system (parent station IDs when useParentStations=true)
 * @param stopToParent Optional mapping from child stop IDs to parent station IDs (required when useParentStations=true)
 * @returns A map from trip boarding IDs to arrays of continuation boarding options
 */
export const buildTripTransfers = (
  tripsMapping: TripsMapping,
  gtfsTripTransfers: GtfsTripTransfer[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
  stopToParent?: Map<StopId, StopId>,
): TripTransfers => {
  const continuations: TripTransfers = new Map();

  /**
   * Gets the effective stop ID for checking active stops.
   * Returns parent station ID if stopToParent is provided, otherwise the original ID.
   */
  const getEffectiveStopId = (stopId: StopId): StopId => {
    if (stopToParent) {
      return stopToParent.get(stopId) ?? stopId;
    }
    return stopId;
  };

  for (const gtfsContinuation of gtfsTripTransfers) {
    // Check if stops are active (using effective IDs for parent station mode)
    const effectiveFromStop = getEffectiveStopId(gtfsContinuation.fromStop);
    const effectiveToStop = getEffectiveStopId(gtfsContinuation.toStop);

    if (
      !activeStopIds.has(effectiveFromStop) ||
      !activeStopIds.has(effectiveToStop)
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

    // Use effective stop IDs (parent stations) for looking up stop indices in routes
    // since routes now use parent station IDs when useParentStations=true
    const bestStopIndices = disambiguateTransferStopsIndices(
      effectiveFromStop,
      fromRoute,
      fromTripMapping.tripRouteIndex,
      effectiveToStop,
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

const parseGtfsTransferType = (
  gtfsTransferType: GtfsTransferType,
): TransferType => {
  switch (gtfsTransferType) {
    case 0:
    default:
      return 'RECOMMENDED';
    case 1:
      return 'GUARANTEED';
    case 2:
      return 'REQUIRES_MINIMAL_TIME';
    case 4:
      return 'IN_SEAT';
  }
};
