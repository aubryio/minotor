import { SourceStopId, StopId } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
import {
  ServiceRouteId,
  Transfer,
  TransferType,
} from '../timetable/timetable.js';
import { ParsedStopsMap } from './stops.js';
import { TripId } from './trips.js';
import { parseCsv } from './utils.js';

export type GtfsTransferType =
  | 0 // recommended transfer point
  | 1 // timed transfer (guaranteed)
  | 2 // requires a minimal amount of time
  | 3 // transfer not possible
  | 4 // in-seat transfer
  | 5; //  in-seat transfer not allowed (must alight)

export type TransfersMap = Map<StopId, Transfer[]>;

export type TransferEntry = {
  from_stop_id?: SourceStopId;
  to_stop_id?: SourceStopId;
  from_trip_id?: TripId;
  to_trip_id?: TripId;
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
  stopsMap: ParsedStopsMap,
): Promise<TransfersMap> => {
  const transfers: TransfersMap = new Map();

  for await (const rawLine of parseCsv(transfersStream)) {
    const transferEntry = rawLine as TransferEntry;

    if (
      transferEntry.transfer_type === 3 ||
      transferEntry.transfer_type === 5
    ) {
      continue;
    }
    if (transferEntry.from_trip_id && transferEntry.to_trip_id) {
      console.warn(
        `Unsupported transfer between trips ${transferEntry.from_trip_id} and ${transferEntry.to_trip_id}.`,
      );
      continue;
    }
    if (transferEntry.from_route_id && transferEntry.to_route_id) {
      console.warn(
        `Unsupported transfer between routes ${transferEntry.from_route_id} and ${transferEntry.to_route_id}.`,
      );
      continue;
    }
    if (!transferEntry.from_stop_id || !transferEntry.to_stop_id) {
      console.warn(`Missing transfer origin or destination stop.`);
      continue;
    }
    if (transferEntry.transfer_type === 2 && !transferEntry.min_transfer_time) {
      console.info(
        `Missing minimum transfer time between ${transferEntry.from_stop_id} and ${transferEntry.to_stop_id}.`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fromStop = stopsMap.get(transferEntry.from_stop_id + '')!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const toStop = stopsMap.get(transferEntry.to_stop_id + '')!;

    const transfer: Transfer = {
      destination: toStop.id,
      type: parseGtfsTransferType(transferEntry.transfer_type),
      ...(transferEntry.min_transfer_time && {
        minTransferTime: Duration.fromSeconds(transferEntry.min_transfer_time),
      }),
    };

    const fromStopTransfers = transfers.get(fromStop.id) || [];
    fromStopTransfers.push(transfer);
    transfers.set(fromStop.id, fromStopTransfers);
  }
  return transfers;
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
