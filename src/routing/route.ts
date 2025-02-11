import { Stop } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
import { Time } from '../timetable/time.js';
import { ServiceRoute, TransferType } from '../timetable/timetable.js';

export type BaseLeg = {
  from: Stop;
  to: Stop;
};

export type Transfer = BaseLeg & {
  minTransferTime?: Duration;
  type: TransferType;
};

export type VehicleLeg = BaseLeg & {
  route: ServiceRoute;
  departureTime: Time;
  arrivalTime: Time;
};

export type Leg = Transfer | VehicleLeg;

export class Route {
  legs: Leg[];

  constructor(legs: Leg[]) {
    this.legs = legs;
  }

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

  totalDuration(): Duration {
    if (this.legs.length === 0) return Duration.zero();
    return this.arrivalTime().diff(this.departureTime());
  }

  print(): string {
    return this.legs
      .map((leg, index) => {
        if ('route' in leg) {
          return `Leg ${index + 1}: ${leg.from.name} to ${leg.to.name}
            via route ${leg.route.type} ${leg.route.name},
            departs at ${leg.departureTime.toString()}, arrives at ${leg.arrivalTime.toString()}`;
        }
        return `Leg ${index + 1}: Transfer from ${leg.from.name} to ${leg.to.name},
            minimum transfer time: ${leg.minTransferTime?.toString() ?? 'not specified'}`;
      })
      .join('\n');
  }
}
