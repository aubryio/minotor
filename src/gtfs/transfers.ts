import { SourceStopId, StopId } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
import { Route } from '../timetable/route.js';
import {
  ServiceRouteId,
  Timetable,
  Transfer,
  TransferType,
  TripBoarding,
  TripContinuations,
} from '../timetable/timetable.js';
import { encode } from '../timetable/tripBoardingId.js';
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

export type GtfsTripContinuation = {
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
  tripContinuations: GtfsTripContinuation[];
}> => {
  const transfers: TransfersMap = new Map();
  const tripContinuations: GtfsTripContinuation[] = [];
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

    if (transferEntry.transfer_type === 4) {
      if (
        transferEntry.from_trip_id === undefined ||
        transferEntry.from_trip_id === '' ||
        transferEntry.to_trip_id === undefined ||
        transferEntry.to_trip_id === ''
      ) {
        console.warn(
          `Unsupported in-seat transfer, missing from_trip_id and/or to_trip_id.`,
        );
        continue;
      }
      const tripBoardingEntry: GtfsTripContinuation = {
        fromStop: fromStop.id,
        fromTrip: transferEntry.from_trip_id,
        toStop: toStop.id,
        toTrip: transferEntry.to_trip_id,
      };
      tripContinuations.push(tripBoardingEntry);
      continue;
    }
    if (transferEntry.from_trip_id && transferEntry.to_trip_id) {
      console.warn(
        `Unsupported transfer of type ${transferEntry.transfer_type} between trips ${transferEntry.from_trip_id} and ${transferEntry.to_trip_id}.`,
      );
      continue;
    }
    if (transferEntry.from_route_id && transferEntry.to_route_id) {
      console.warn(
        `Unsupported transfer of type ${transferEntry.transfer_type} between routes ${transferEntry.from_route_id} and ${transferEntry.to_route_id}.`,
      );
      continue;
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
      destination: toStop.id,
      type: parseGtfsTransferType(transferEntry.transfer_type),
      ...(transferEntry.min_transfer_time !== undefined && {
        minTransferTime: Duration.fromSeconds(transferEntry.min_transfer_time),
      }),
    };

    const fromStopTransfers = transfers.get(fromStop.id) || [];
    fromStopTransfers.push(transfer);
    transfers.set(fromStop.id, fromStopTransfers);
  }
  return {
    transfers,
    tripContinuations,
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
 * @param tripContinuations Array of GTFS trip continuation data from transfers.txt
 * @param timetable The timetable containing route and timing information
 * @param activeStopIds Set of stop IDs that are active/enabled in the system
 * @returns A map from trip boarding IDs to arrays of continuation boarding options
 */
export const buildTripContinuations = (
  tripsMapping: TripsMapping,
  tripContinuations: GtfsTripContinuation[],
  timetable: Timetable,
  activeStopIds: Set<StopId>,
): TripContinuations => {
  const continuations: TripContinuations = new Map();

  for (const gtfsContinuation of tripContinuations) {
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
      // No valid continuation found
      continue;
    }

    const tripBoardingId = encode(
      bestStopIndices.fromStopIndex,
      fromTripMapping.routeId,
      fromTripMapping.tripRouteIndex,
    );

    const continuationBoarding: TripBoarding = {
      hopOnStopIndex: bestStopIndices.toStopIndex,
      routeId: toTripMapping.routeId,
      tripIndex: toTripMapping.tripRouteIndex,
    };

    const existingContinuations = continuations.get(tripBoardingId) || [];
    existingContinuations.push(continuationBoarding);
    continuations.set(tripBoardingId, existingContinuations);
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
