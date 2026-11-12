import type { StopId } from '../stops/stops.js';
import type { RouteId, StopRouteIndex, TripRouteIndex } from './route.js';
import type { Duration } from './time.js';
import type { TripStopKey } from './tripStopKey.js';

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

export type TripPosition = {
  stopIndex: StopRouteIndex;
  routeId: RouteId;
  tripIndex: TripRouteIndex;
};

export type TripTransferDestination = TripPosition & {
  type?: TransferType;
  minTransferTime?: Duration;
};

/** Compatibility name for raw transfer destinations. */
export type TripStop = TripTransferDestination;

export type TripTransfers = Map<TripStopKey, TripStop[]>;

/** Generic transfer duration: explicit minimums override type defaults. */
export function transferDuration(
  transfer: Transfer,
  fallback: Duration,
): Duration {
  return (
    transfer.minTransferTime ??
    (transfer.type === TransferTypes.GUARANTEED ||
    transfer.type === TransferTypes.IN_SEAT
      ? 0
      : fallback)
  );
}
