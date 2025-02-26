import { StopId } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
import { Time } from '../timetable/time.js';
import { ALL_TRANSPORT_MODES, RouteType } from '../timetable/timetable.js';

export class Query {
  from: StopId;
  to: StopId[];
  departureTime: Time;
  lastDepartureTime?: Time;
  options: {
    maxTransfers: number;
    minTransferTime: Duration;
    transportModes: RouteType[];
  };

  constructor(builder: typeof Query.Builder.prototype) {
    this.from = builder.fromValue;
    this.to = builder.toValue;
    this.departureTime = builder.departureTimeValue;
    this.options = builder.optionsValue;
  }

  static Builder = class {
    fromValue!: StopId;
    toValue: StopId[] = [];
    departureTimeValue!: Time;
    // lastDepartureTimeValue?: Date;
    // via: StopId[] = [];
    optionsValue: {
      maxTransfers: number;
      minTransferTime: Duration;
      transportModes: RouteType[];
    } = {
      maxTransfers: 5,
      minTransferTime: Duration.fromSeconds(120),
      transportModes: ALL_TRANSPORT_MODES,
    };

    from(from: StopId): this {
      this.fromValue = from;
      return this;
    }

    to(to: StopId | StopId[]): this {
      this.toValue = Array.isArray(to) ? to : [to];
      return this;
    }

    departureTime(departureTime: Time): this {
      this.departureTimeValue = departureTime;
      return this;
    }

    maxTransfers(maxTransfers: number): this {
      this.optionsValue.maxTransfers = maxTransfers;
      return this;
    }

    minTransferTime(minTransferTime: Duration): this {
      this.optionsValue.minTransferTime = minTransferTime;
      return this;
    }

    transportModes(transportModes: RouteType[]): this {
      this.optionsValue.transportModes = transportModes;
      return this;
    }

    build(): Query {
      return new Query(this);
    }
  };
}
