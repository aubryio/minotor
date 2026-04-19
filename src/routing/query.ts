import { StopId } from '../stops/stops.js';
import { Duration, durationFromSeconds, Time } from '../timetable/time.js';
import { ALL_TRANSPORT_MODES, RouteType } from '../timetable/timetable.js';

export type QueryOptions = {
  maxTransfers: number;
  minTransferTime: Duration;
  transportModes: Set<RouteType>;
};

/**
 * A routing query for standard RAPTOR.
 *
 * Finds the earliest-arrival journey from `from` to `to` for a single
 * departure time.  Use {@link RangeQuery} (and `router.rangeRoute()`) when
 * you want all Pareto-optimal journeys within a departure-time window.
 */
export class Query {
  from: StopId;
  to: Set<StopId>;
  departureTime: Time;
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
     * Sets the destination stop(s).
     * Routing stops as soon as all provided stops have been reached.
     */
    to(to: StopId | Set<StopId>): this {
      this.toValue = to instanceof Set ? to : new Set([to]);
      return this;
    }

    /**
     * Sets the departure time in minutes from midnight.
     * The router favours trips departing shortly after this time.
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
     * Sets the fallback minimum transfer time (in minutes) used when the
     * timetable data does not specify one for a particular transfer.
     */
    minTransferTime(minTransferTime: Duration): this {
      this.optionsValue.minTransferTime = minTransferTime;
      return this;
    }

    /**
     * Restricts routing to the given transport modes.
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

/**
 * A routing query for Range RAPTOR.
 *
 * Extends {@link Query} with a required `lastDepartureTime` that defines the
 * upper bound of the departure-time window.  `router.rangeRoute()` returns
 * all Pareto-optimal journeys departing in
 * `[departureTime, lastDepartureTime]`.
 *
 * Build one with {@link RangeQuery.Builder}, which inherits every method from
 * {@link Query.Builder} and adds `lastDepartureTime()`:
 *
 * ```ts
 * const q = new RangeQuery.Builder()
 *   .from(stop)
 *   .to(dest)
 *   .departureTime(earliest)
 *   .lastDepartureTime(latest)
 *   .maxTransfers(3)
 *   .build();
 *
 * const result = router.rangeRoute(q);
 * result.paretoOptimalRoutes();
 * ```
 */
export class RangeQuery extends Query {
  /** Upper bound of the departure-time window (minutes from midnight). */
  readonly lastDepartureTime: Time;

  constructor(builder: typeof RangeQuery.Builder.prototype) {
    super(builder);
    this.lastDepartureTime = builder.lastDepartureTimeValue;
  }

  /**
   * Builder for {@link RangeQuery}.
   *
   * Inherits all methods from {@link Query.Builder} — `from()`, `to()`,
   * `departureTime()`, `maxTransfers()`, `minTransferTime()`,
   * `transportModes()` — and adds `lastDepartureTime()`.  The `build()`
   * method is overridden to return a {@link RangeQuery}.
   */
  static Builder = class extends Query.Builder {
    lastDepartureTimeValue!: Time;

    /**
     * Sets the upper bound of the departure-time window.
     *
     * The router will find all Pareto-optimal journeys departing between
     * `departureTime` (earliest) and `lastDepartureTime` (latest).
     */
    lastDepartureTime(time: Time): this {
      this.lastDepartureTimeValue = time;
      return this;
    }

    build(): RangeQuery {
      return new RangeQuery(this);
    }
  };
}
