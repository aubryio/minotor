import { Stop } from '../stops/stops.js';
import {
  Duration,
  DURATION_ZERO,
  durationToString,
  Time,
  TIME_ORIGIN,
  timeToString,
} from '../timetable/time.js';
import { ServiceRouteInfo, TransferType } from '../timetable/timetable.js';

export type PickUpDropOffType =
  | 'REGULAR'
  | 'NOT_AVAILABLE'
  | 'MUST_PHONE_AGENCY'
  | 'MUST_COORDINATE_WITH_DRIVER';

export type BaseLeg = {
  from: Stop;
  to: Stop;
};

export type Access = BaseLeg & {
  duration: Duration;
};

export type Transfer = BaseLeg & {
  minTransferTime?: Duration;
  type: TransferType;
};

export type VehicleLeg = BaseLeg & {
  route: ServiceRouteInfo;
  departureTime: Time;
  arrivalTime: Time;
  pickUpType: PickUpDropOffType;
  dropOffType: PickUpDropOffType;
};

export type Leg = Transfer | Access | VehicleLeg;

/**
 * Represents a resolved route consisting of multiple legs,
 * which can be either vehicle legs or transfer legs.
 */
export class Route {
  legs: Leg[];

  constructor(legs: Leg[]) {
    this.legs = legs;
  }

  /**
   * Calculates the departure time of the route.
   *
   * @returns The departure time of the route.
   * @throws If no vehicle leg is found in the route.
   */
  departureTime(): Time {
    let cumulativeAccessTime: Duration = DURATION_ZERO;
    for (let i = 0; i < this.legs.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const leg = this.legs[i]!;
      if ('departureTime' in leg) {
        return leg.departureTime - cumulativeAccessTime;
      }
      if ('duration' in leg && leg.duration) {
        cumulativeAccessTime += leg.duration;
      }
    }
    throw new Error('No vehicle leg found in route');
  }

  /**
   * Calculates the arrival time of the route.
   *
   * @returns The arrival time of the route.
   * @throws If no vehicle leg is found in the route.
   */
  arrivalTime(): Time {
    let lastVehicleArrivalTime: Time = TIME_ORIGIN;
    let totalTransferTime: Duration = DURATION_ZERO;

    // Find the last vehicle leg and sum transfer times that come after it
    for (let i = this.legs.length - 1; i >= 0; i--) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const leg = this.legs[i]!;

      if ('arrivalTime' in leg) {
        lastVehicleArrivalTime = leg.arrivalTime;
        return lastVehicleArrivalTime + totalTransferTime;
      } else if ('minTransferTime' in leg && leg.minTransferTime) {
        totalTransferTime += leg.minTransferTime;
      }
    }

    throw new Error('No vehicle leg found in route');
  }

  /**
   * Calculates the total duration of the route.
   *
   * @returns The total duration of the route.
   */
  totalDuration(): Duration {
    if (this.legs.length === 0) return DURATION_ZERO;
    return Math.abs(this.arrivalTime() - this.departureTime());
  }

  /**
   * Generates a human-readable string representation of the route.
   *
   * @returns A formatted string describing each leg of the route.
   */
  toString(): string {
    return this.legs
      .map((leg, index) => {
        const fromStop = `From: ${leg.from.name}${leg.from.platform ? ` (Pl. ${leg.from.platform})` : ''}`;
        const toStop = `To: ${leg.to.name}${leg.to.platform ? ` (Pl. ${leg.to.platform})` : ''}`;
        const transferDetails =
          'type' in leg && !('route' in leg)
            ? `Transfer: ${leg.type}${leg.minTransferTime ? `, Minimum Transfer Time: ${durationToString(leg.minTransferTime)}` : ''}`
            : '';
        const accessDetails =
          'duration' in leg
            ? `Access duration: ${durationToString(leg.duration)}`
            : '';
        const travelDetails =
          'route' in leg && 'departureTime' in leg && 'arrivalTime' in leg
            ? `Route: ${leg.route.type} ${leg.route.name}, Departure: ${timeToString(leg.departureTime)}, Arrival: ${timeToString(leg.arrivalTime)}`
            : '';

        return [
          `Leg ${index + 1}:`,
          `  ${fromStop}`,
          `  ${toStop}`,
          transferDetails ? `  ${transferDetails}` : '',
          accessDetails ? `  ${accessDetails}` : '',
          travelDetails ? `  ${travelDetails}` : '',
        ]
          .filter((line) => line.trim() !== '')
          .join('\n');
      })
      .join('\n');
  }
}
