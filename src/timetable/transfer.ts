import type { StopId } from '../stops/stops.js';
import type { RouteId, StopRouteIndex, TripRouteIndex } from './route.js';
import type { Duration } from './time.js';
import type { TripStopId } from './tripStopId.js';

export const TransferTypes = {
  RECOMMENDED: 1,
  GUARANTEED: 2,
  REQUIRES_MINIMAL_TIME: 3,
  IN_SEAT: 4,
} as const;

export type TransferType = (typeof TransferTypes)[keyof typeof TransferTypes];

export type TransferTypeString = keyof typeof TransferTypes;

export type Transfer = {
  destination: StopId;
  type: TransferType;
  minTransferTime?: Duration;
};

export type TripStop = {
  stopIndex: StopRouteIndex;
  routeId: RouteId;
  tripIndex: TripRouteIndex;
  type?: TransferType;
  minTransferTime?: Duration;
};

export type TripTransfers = Map<TripStopId, TripStop[]>;
