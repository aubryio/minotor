import { SourceStopId } from '../stops/stops.js';
import { Duration } from '../timetable/duration.js';
import { Time } from '../timetable/time.js';
import { ALL_TRANSPORT_MODES, RouteType } from '../timetable/timetable.js';

export class Query {
  from: SourceStopId;
  to: Set<SourceStopId>;
  departureTime: Time;
  lastDepartureTime?: Time;
  options: {
    maxTransfers: number;
    minTransferTime: Duration;
    transportModes: Set<RouteType>;
  };

  constructor(builder: typeof Query.Builder.prototype) {
    this.from = builder.fromValue;
    this.to = builder.toValue;
    this.departureTime = builder.departureTimeValue;
    this.options = builder.optionsValue;
  }

  static Builder = class {
    fromValue!: SourceStopId;
    toValue: Set<SourceStopId> = new Set();
    departureTimeValue!: Time;
    // lastDepartureTimeValue?: Date;
    // via: StopId[] = [];
    optionsValue: {
      maxTransfers: number;
      minTransferTime: Duration;
      transportModes: Set<RouteType>;
    } = {
      maxTransfers: 5,
      minTransferTime: Duration.fromSeconds(120),
      transportModes: ALL_TRANSPORT_MODES,
    };

    /**
     * Sets the starting stop.
     */
    from(from: SourceStopId): this {
      this.fromValue = from;
      return this;
    }

    /**
     * Sets the destination stops(s), routing will stop when all the provided stops are reached.
     */
    to(to: SourceStopId | Set<SourceStopId>): this {
      this.toValue = to instanceof Set ? to : new Set([to]);
      return this;
    }

    /**
     * Sets the departure time for the query.
     * Note that the router will favor routes that depart shortly after the provided departure time,
     * even if a later route might arrive at the same time.
     * Range queries will allow to specify a range of departure times in the future.
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
     * Sets the minimum transfer time to use when no transfer time is provided in the data.
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
