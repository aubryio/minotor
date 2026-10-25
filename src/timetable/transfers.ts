import type { StopId } from '../stops/stops.js';
import type { RouteId, StopRouteIndex, TripRouteIndex } from './route.js';
import type { Duration, Time } from './time.js';
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
};

export type TripTransfers = Map<TripStopId, TripStop[]>;

export type MinimumTripTransfers = Map<
  TripStopId,
  (TripStop & { minTransferTime: Duration })[]
>;

export type TripTransferRule = TripStop &
  (
    | { type: typeof TransferTypes.GUARANTEED }
    | {
        type: typeof TransferTypes.REQUIRES_MINIMAL_TIME;
        minTransferTime: Duration;
      }
  );

/** Exact-pair rules replace the fallback buffer, including longer minima. */
export const tripTransferReadyTime = (
  rule: TripTransferRule | undefined,
  arrival: Time,
  fallbackReady: Time,
): Time =>
  rule
    ? arrival +
      (rule.type === TransferTypes.GUARANTEED ? 0 : rule.minTransferTime)
    : fallbackReady;

export type TripConnections = {
  rules: readonly TripTransferRule[];
  continuations: readonly TripStop[];
};
