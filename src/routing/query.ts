import { StopId } from '../stops/stops.js';
import { Duration, durationFromSeconds, Time } from '../timetable/time.js';
import { ALL_TRANSPORT_MODES, RouteType } from '../timetable/timetable.js';

export type QueryOptions = {
  maxTransfers: number;
  minTransferTime: Duration;
  transportModes: Set<RouteType>;
  /**
   * Maximum time (in minutes) the traveler is willing to wait at the first
   * boarding stop before the first transit vehicle departs.
   *
   * When set, any trip that would require waiting longer than this duration
   * after arriving at the stop is skipped for the first boarding leg.
   * Undefined means no limit.
   */
  maxInitialWaitingTime?: Duration;
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
    optionsValue: QueryOptions = {
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

    /**
     * Sets the maximum time (in minutes) the traveler is willing to wait at
     * the first boarding stop before the first transit vehicle departs.
     *
     * When set, any trip that would require waiting longer than this duration
     * after arriving at the stop is not considered for the first boarding leg.
     */
    maxInitialWaitingTime(maxInitialWaitingTime: Duration): this {
      this.optionsValue.maxInitialWaitingTime = maxInitialWaitingTime;
      return this;
    }

    build(): Query {
      return new Query(this);
    }
  };
}

/**
 * Options specific to a {@link RangeQuery}.
 */
export type RangeQueryOptions = {
  /**
   * When `true`, a full RAPTOR pass is run at `lastDepartureTime + 1` before
   * the main departure-time loop (the *boundary run*).
   *
   * The boundary run seeds the shared Pareto labels with the best arrival
   * achievable by departing just after the window closes.  Any in-window
   * journey whose arrival is no better than what that post-window departure
   * achieves is therefore suppressed — you only see journeys that are still
   * worth taking given that a later departure exists.
   *
   * **Timetable use-case** (`boundaryRun: true`): the window is a *display
   * filter*.  A journey at 10:55 that arrives at 12:30 is hidden when an
   * 11:05 departure arrives at 12:00 — the router pre-empts the dominated
   * option on the caller's behalf.
   *
   * **Isochrone / accessibility use-case** (`boundaryRun: false`, the
   * default): the window is a hard constraint.  Every Pareto-optimal journey
   * whose departure falls strictly within `[departureTime, lastDepartureTime]`
   * is returned, regardless of what might be available just outside the
   * window.
   *
   * @default false
   */
  optimizeBeyondLatestDeparture: boolean;
};

/**
 * A routing query for Range RAPTOR.
 *
 * Extends {@link Query} with a required `lastDepartureTime` that defines the
 * upper bound of the departure-time window.  `router.rangeRoute()` returns
 * all Pareto-optimal journeys departing in
 * `[departureTime, lastDepartureTime]`.
 *
 */
export class RangeQuery extends Query {
  /** Upper bound of the departure-time window (minutes from midnight). */
  readonly lastDepartureTime: Time;
  /** Options specific to Range RAPTOR behavior. */
  readonly rangeOptions: RangeQueryOptions;

  constructor(builder: typeof RangeQuery.Builder.prototype) {
    super(builder);
    this.lastDepartureTime = builder.lastDepartureTimeValue;
    this.rangeOptions = builder.rangeOptionsValue;
  }

  static Builder = class extends Query.Builder {
    lastDepartureTimeValue!: Time;
    rangeOptionsValue: RangeQueryOptions = {
      optimizeBeyondLatestDeparture: true,
    };

    /**
     * Sets the upper bound of the departure-time window.
     */
    lastDepartureTime(time: Time): this {
      this.lastDepartureTimeValue = time;
      return this;
    }

    /**
     * Overrides individual Range RAPTOR options.
     * Unspecified fields keep their defaults.
     */
    rangeOptions(options: Partial<RangeQueryOptions>): this {
      this.rangeOptionsValue = { ...this.rangeOptionsValue, ...options };
      return this;
    }

    build(): RangeQuery {
      return new RangeQuery(this);
    }
  };
}
