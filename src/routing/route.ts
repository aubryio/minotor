import { SourceStopId, Stop } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
import { Time } from '../timetable/time.js';
import { ServiceRouteInfo, TransferType } from '../timetable/timetable.js';

export type JsonLeg = {
  from: SourceStopId;
  to: SourceStopId;
} & (
  | {
      departure: string;
      arrival: string;
      route: ServiceRouteInfo;
    }
  | {
      type: TransferType;
      minTransferTime?: string;
    }
);

export type PickUpDropOffType =
  | 'REGULAR'
  | 'NOT_AVAILABLE'
  | 'MUST_PHONE_AGENCY'
  | 'MUST_COORDINATE_WITH_DRIVER';

export type BaseLeg = {
  from: Stop;
  to: Stop;
};

export type Transfer = BaseLeg & {
  minTransferTime?: Duration;
  type: TransferType;
};

export type VehicleLeg = BaseLeg & {
  route: ServiceRouteInfo;
  departureTime: Time;
  arrivalTime: Time;
  // TODO support pick up and drop off types
  /*
  pickUpType: PickUpDropOffType;
  dropOffType: PickUpDropOffType;
  */
};

export type Leg = Transfer | VehicleLeg;

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
    const cumulativeTransferTime: Duration = Duration.zero();
    for (let i = 0; i < this.legs.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const leg = this.legs[i]!;
      if ('departureTime' in leg) {
        return leg.departureTime.minus(cumulativeTransferTime);
      }
      if ('minTransferTime' in leg && leg.minTransferTime) {
        cumulativeTransferTime.add(leg.minTransferTime);
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
    let lastVehicleArrivalTime: Time = Time.origin();
    const totalTransferTime: Duration = Duration.zero();
    let vehicleLegFound = false;

    for (let i = this.legs.length - 1; i >= 0; i--) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const leg = this.legs[i]!;

      if ('arrivalTime' in leg && !vehicleLegFound) {
        lastVehicleArrivalTime = leg.arrivalTime;
        vehicleLegFound = true;
      } else if (
        'minTransferTime' in leg &&
        leg.minTransferTime &&
        vehicleLegFound
      ) {
        totalTransferTime.add(leg.minTransferTime);
      }
    }

    if (!vehicleLegFound) {
      throw new Error('No vehicle leg found in route');
    }

    return lastVehicleArrivalTime.plus(totalTransferTime);
  }

  /**
   * Calculates the total duration of the route.
   *
   * @returns The total duration of the route.
   */
  totalDuration(): Duration {
    if (this.legs.length === 0) return Duration.zero();
    return this.arrivalTime().diff(this.departureTime());
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
          'minTransferTime' in leg
            ? `Minimum Transfer Time: ${leg.minTransferTime?.toString()}`
            : '';
        const travelDetails =
          'route' in leg && 'departureTime' in leg && 'arrivalTime' in leg
            ? `Route: ${leg.route.type} ${leg.route.name}, Departure: ${leg.departureTime.toString()}, Arrival: ${leg.arrivalTime.toString()}`
            : '';

        return [
          `Leg ${index + 1}:`,
          `  ${fromStop}`,
          `  ${toStop}`,
          transferDetails ? `  ${transferDetails}` : '',
          travelDetails ? `  ${travelDetails}` : '',
        ]
          .filter((line) => line.trim() !== '')
          .join('\n');
      })
      .join('\n');
  }

  /**
   * Generates a concise JSON representation of the route.
   * This is particularly useful for generating regression tests
   * to verify the correctness of route calculations.
   *
   * @returns A JSON representation of the route.
   */
  asJson(): JsonLeg[] {
    const jsonLegs: JsonLeg[] = this.legs.map((leg: Leg) => {
      if ('route' in leg) {
        return {
          from: leg.from.sourceStopId,
          to: leg.to.sourceStopId,
          departure: leg.departureTime.toString(),
          arrival: leg.arrivalTime.toString(),
          route: leg.route,
        };
      } else {
        return {
          from: leg.from.sourceStopId,
          to: leg.to.sourceStopId,
          type: leg.type,
          ...(leg.minTransferTime !== undefined && {
            minTransferTime: leg.minTransferTime.toString(),
          }),
        };
      }
    });

    return jsonLegs;
  }
}
