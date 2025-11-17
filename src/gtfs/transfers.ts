import { SourceStopId, StopId } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
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
 * Processes guaranteed transfer entries (type 1).
 */
const processGuaranteedTransfer = (
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
    console.warn(
      `Unsupported guaranteed transfer, missing from_trip_id and/or to_trip_id.`,
    );
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
        processGuaranteedTransfer(
          transferEntry,
          fromStop.id,
          toStop.id,
          guaranteedTripTransfers,
        );
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
