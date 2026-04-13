import { StopId } from '../stops/stops.js';
import { Duration, durationFromSeconds, Time } from '../timetable/time.js';
import { ALL_TRANSPORT_MODES, RouteType } from '../timetable/timetable.js';

export type QueryOptions = {
  maxTransfers: number;
  minTransferTime: Duration;
  transportModes: Set<RouteType>;
};

export class Query {
  from: StopId;
  to: Set<StopId>;
  departureTime: Time;
  lastDepartureTime?: Time;
  options: QueryOptions;

  constructor(builder: typeof Query.Builder.prototype) {
    this.from = builder.fromValue;
    this.to = builder.toValue;
    this.departureTime = builder.departureTimeValue;
    this.options = builder.optionsValue;
  }

  static Builder = class {
    fromValue!: StopId;
    toValue: Set<StopId> = new Set();
    departureTimeValue!: Time;
    optionsValue: {
      maxTransfers: number;
      minTransferTime: Duration;
      transportModes: Set<RouteType>;
    } = {
      maxTransfers: 5,
      minTransferTime: durationFromSeconds(120),
      transportModes: ALL_TRANSPORT_MODES,
    };

    /**
     * Sets the starting stop.
     */
    from(from: StopId): this {
      this.fromValue = from;
      return this;
    }

    /**
     * Sets the destination stops(s), routing will stop when all the provided stops are reached.
     */
    to(to: StopId | Set<StopId>): this {
      this.toValue = to instanceof Set ? to : new Set([to]);
      return this;
    }

    /**
     * Sets the departure time for the query as minutes since midnight.
     * Note that the router will favor routes that depart shortly after the provided departure time,
     * even if a later route might arrive at the same time.
     */
    departureTime(departureTime: Time): this {
      this.departureTimeValue = departureTime;
      return this;
    }

    /**
     * Sets the maximum number of transfers allowed.
     */
    maxTransfers(maxTransfers: number): this {
      this.optionsValue.maxTransfers = maxTransfers;
      return this;
    }

    /**
     * Sets the minimum transfer time (in minutes)
     * to use when no transfer time is provided in the data.
     */
    minTransferTime(minTransferTime: Duration): this {
      this.optionsValue.minTransferTime = minTransferTime;
      return this;
    }

    /**
     * Sets the transport modes to consider.
     */
    transportModes(transportModes: Set<RouteType>): this {
      this.optionsValue.transportModes = transportModes;
      return this;
    }

    build(): Query {
      return new Query(this);
    }
  };
}
