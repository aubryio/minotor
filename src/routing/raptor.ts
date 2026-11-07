/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import {
  PickUpDropOffTypes,
  Route,
  StopRouteIndex,
  TripRouteIndex,
} from '../timetable/route.js';
import { Time, UINT16_TIME_LIMIT } from '../timetable/time.js';
import {
  BoardingSource,
  ResolvedBoarding,
  Timetable,
  TransferTypes,
} from '../timetable/timetable.js';
import { transferDuration } from '../timetable/transfer.js';
import {
  TripId,
  TripRule,
  TripStopId,
  TripTransferIndex,
} from '../timetable/tripTransfers.js';
import { QueryOptions } from './query.js';
import {
  Boarding,
  boardingFeeder,
  ConditionalBoarding,
  RoundLabels,
  RoundNumber,
} from './roundLabels.js';
import { RoutingEdge, VehicleEdge } from './state.js';

const NO_TRIP_RULES: readonly Readonly<TripRule>[] = [];

export interface IRaptorState {
  /** Origin stop IDs for this run. */
  readonly origins: StopId[];

  /**
   * Per-round routing parents; `parents[round][stop]` is the best edge used to
   * reach `stop`.
   */
  readonly parents: (RoutingEdge | undefined)[][];

  /**
   * Tightest known upper bound on the arrival time at `stop` in `round`.
   */
  improvementBound(round: RoundNumber, stop: StopId): Time;

  /**
   * Best known arrival time at any destination.
   */
  readonly destinationBest: Time;

  /** Latest arrival time allowed by the current query/run. */
  readonly maxArrivalTime: Time;

  /**
   * Records a new arrival at `stop`, updating all relevant state.
   *
   * In Range RAPTOR mode this also updates the cross-run shared labels.
   */
  updateArrival(stop: StopId, time: Time, round: RoundNumber): void;

  /**
   * Propagates labels from round `k-1` into round `k` before routes are scanned.
   * No-op in standard RAPTOR mode.
   */
  initRound(round: RoundNumber): void;

  readonly rangeBounds?: RangeBounds;
  publishArrival(stop: StopId, edge: RoutingEdge, round: RoundNumber): void;
}

export interface RangeBounds {
  /** Optional cross-run ordinary readiness bounds. */
  boardingBound(round: RoundNumber, stop: StopId): Time;
  updateBoardingBound(round: RoundNumber, stop: StopId, time: Time): void;

  /** Optional cross-run conditional arrival bounds. */
  conditionalBoardingBound(
    round: RoundNumber,
    stop: StopId,
    context: TripStopId,
  ): Time;
  /**
   * Optionally retain a tighter boarding-context bound across range-query
   * departure runs.
   */
  updateConditionalBoardingBound(
    round: RoundNumber,
    stop: StopId,
    context: TripStopId,
    time: Time,
  ): void;
  /** Optionally return the first covered trip arrival index across range-query runs. */
  tripBoardingBound(round: RoundNumber, trip: TripId): StopRouteIndex;
  /** Optionally retain trip suffix coverage across range-query runs and later rounds. */
  updateTripBoardingBound(
    round: RoundNumber,
    trip: TripId,
    stopIndex: StopRouteIndex,
  ): void;
}

type BoardedTrip = {
  route: Route;
  tripIndex: TripRouteIndex;
  boardingStopIndex: StopRouteIndex;
  tripOffset: number;
  predecessor: RoutingEdge;
  continuation?: VehicleEdge;
};

type TripScan = BoardedTrip & {
  startStopIndex: StopRouteIndex;
  endStopIndexExclusive: StopRouteIndex;
};

/** Reusable storage; bounds contain no reconstruction references. */
class RaptorWorkspace {
  readonly earliestOrdinaryVehicleArrival: Uint16Array;
  readonly earliestBoardingTime: Uint16Array;
  readonly roundLabels: [RoundLabels, RoundLabels];

  /**
   * Allocate reusable stop-sized buffers and alternating roundLabels for this
   * timetable.
   */
  constructor(timetable: Timetable) {
    this.earliestOrdinaryVehicleArrival = new Uint16Array(timetable.nbStops());
    this.earliestBoardingTime = new Uint16Array(timetable.nbStops());
    this.roundLabels = [
      new RoundLabels(timetable.nbStops()),
      new RoundLabels(timetable.nbStops()),
    ];
  }
  reset(): void {
    this.earliestOrdinaryVehicleArrival.fill(UINT16_TIME_LIMIT);
    this.earliestBoardingTime.fill(UINT16_TIME_LIMIT);
  }
  clear(): void {
    for (const labels of this.roundLabels) labels.clear();
  }
}

/** Shared workspaces avoid reallocating stop-sized buffers between departure runs. */
export class Raptor {
  readonly statistics = {
    scannedTripStops: 0,
    retainedContexts: 0,
    exceptionalBoardings: 0,
    exceptionalTripsConsidered: 0,
    exceptionalBoardingAttempts: 0,
  };
  private readonly workspace: RaptorWorkspace;

  constructor(private readonly timetable: Timetable) {
    this.workspace = new RaptorWorkspace(timetable);
  }

  /**
   * Reset workspaces, execute one departure run, and release frontier
   * predecessors even if scanning fails.
   */
  run(options: QueryOptions, state: IRaptorState): void {
    this.statistics.scannedTripStops = 0;
    this.statistics.retainedContexts = 0;
    this.statistics.exceptionalBoardings = 0;
    this.statistics.exceptionalTripsConsidered = 0;
    this.statistics.exceptionalBoardingAttempts = 0;
    this.workspace.reset();
    try {
      new RaptorRun(
        this.workspace,
        this.timetable,
        options,
        state,
        this.statistics,
      ).run();
    } finally {
      this.workspace.clear();
    }
  }
}

/**
 * One departure run: scan vehicles, preserve special connections, then relax
 * transfers from vehicle arrivals.
 */
class RaptorRun {
  private readonly boardingPositions: StopRouteIndex[] = [];
  private readonly bestConditionalArrivalTimes = new Map<
    StopId,
    Map<TripStopId, Time>
  >();
  private readonly firstCoveredArrivalIndex = new Map<TripId, StopRouteIndex>();
  private readonly bestContinuationEntryArrival = new Map<TripStopId, Time>();
  private readonly pendingTripScans: TripScan[] = [];
  private readonly bestOrdinaryVehicleArrivals = new Map<StopId, VehicleEdge>();
  private readonly pendingConditionalTransfers: {
    edge: VehicleEdge;
    tripStopId: TripStopId;
    rules: readonly Readonly<TripRule>[];
  }[] = [];

  private readonly transferIndex: TripTransferIndex;
  private currentLabels: RoundLabels;
  private nextLabels: RoundLabels;
  private round: RoundNumber = 0;

  /**
   * Bind one departure run to reusable workspaces and seed ordinary labels
   * from access arrivals.
   */
  constructor(
    private readonly workspace: RaptorWorkspace,
    private readonly timetable: Timetable,
    private readonly options: QueryOptions,
    private readonly state: IRaptorState,
    private readonly statistics: Raptor['statistics'],
  ) {
    this.currentLabels = workspace.roundLabels[0];
    this.nextLabels = workspace.roundLabels[1];
    this.transferIndex = timetable.tripTransfers;
    for (const stop of state.origins) {
      const edge = state.parents[0]![stop];
      if (edge) {
        this.currentLabels.set(stop, { readyAt: edge.arrival, edge });
      }
    }
  }

  /**
   * Scan ordinary and exceptional trips by round, then relax vehicle transfers
   * into the next frontier.
   */
  run(): void {
    for (
      this.round = 1;
      this.round <= this.options.maxTransfers + 1 &&
      this.currentLabels.markedStops.size;
      this.round++
    ) {
      this.state.initRound(this.round);

      const routes = this.timetable.findReachableRoutes(
        this.currentLabels.markedStops,
        this.options.transportModes,
      );
      // Trips without outgoing rules establish destination bounds before exceptional scans.
      for (const [route, firstStop] of routes) {
        this.scanOrdinaryRoute(route, firstStop);
      }
      for (const [route, firstStop] of routes) {
        this.findExceptionalBoardings(route, firstStop);
      }
      // Continuations appended during a scan remain in this transit round.
      for (
        let position = 0;
        position < this.pendingTripScans.length;
        position++
      ) {
        const boarding = this.pendingTripScans[position]!;
        // Continuations can alight or continue again at their entry trip stop;
        // ordinary boardings start with the following arrival.
        for (
          let stopIndex = boarding.startStopIndex;
          stopIndex < boarding.endStopIndexExclusive;
          stopIndex++
        ) {
          this.processTripArrival(boarding, stopIndex);
        }
      }
      // Only vehicle arrivals start transfers; walked labels feed the next transit round.
      for (const edge of this.bestOrdinaryVehicleArrivals.values()) {
        this.relaxOrdinaryTransfers(edge);
      }
      for (const { edge, tripStopId, rules } of this
        .pendingConditionalTransfers) {
        this.relaxConditionalTransfers(edge, tripStopId, rules);
      }
      this.currentLabels.clear();
      [this.currentLabels, this.nextLabels] = [
        this.nextLabels,
        this.currentLabels,
      ];
      this.pendingTripScans.length = 0;
      this.bestOrdinaryVehicleArrivals.clear();
      this.pendingConditionalTransfers.length = 0;
    }
  }

  /**
   * Scan trips without outgoing rules, replacing the active trip when an
   * earlier eligible boarding is found.
   */
  private scanOrdinaryRoute(route: Route, firstStop: StopRouteIndex): void {
    let active: BoardedTrip | undefined;
    for (
      let stopIndex = firstStop;
      stopIndex < route.getNbStops();
      stopIndex++
    ) {
      if (active) {
        this.processTripArrival(active, stopIndex);
      }
      const ordinary = this.currentLabels.ordinary[route.stopId(stopIndex)];
      const conditionals = this.currentLabels.conditional.get(
        route.stopId(stopIndex),
      );
      if (ordinary) {
        active =
          this.firstOrdinaryBoarding(ordinary, route, stopIndex, active) ??
          active;
      }
      if (conditionals) {
        for (const label of conditionals.values()) {
          active =
            this.firstOrdinaryBoarding(
              label,
              route,
              stopIndex,
              active,
              boardingFeeder(label),
            ) ?? active;
        }
      }
    }
  }

  /**
   * Find an eligible ordinary trip before the active trip, respecting
   * readiness and query departure bounds.
   */
  private firstOrdinaryBoarding(
    label: Boarding,
    route: Route,
    stopIndex: StopRouteIndex,
    active?: BoardedTrip,
    feeder?: VehicleEdge,
  ): BoardedTrip | undefined {
    const resolved = this.timetable.findFirstOrdinaryBoarding(
      route,
      stopIndex,
      {
        genericReady: label.readyAt,
        fallbackTransferDuration: this.options.minTransferTime,
        source: feeder ? this.boardingSource(feeder) : undefined,
        beforeTrip: active?.tripIndex,
        maxDeparture: this.maxBoardingDeparture(label),
        beforeDeparture: this.state.destinationBest,
      },
    );
    return resolved
      ? this.createBoarding(
          label,
          route,
          stopIndex,
          resolved.trip,
          resolved,
          feeder,
        )
      : undefined;
  }

  /** Each exceptional trip needs only its earliest useful boarding position. */
  private findExceptionalBoardings(
    route: Route,
    firstStop: StopRouteIndex,
  ): void {
    const exceptionalTrips = this.transferIndex.exceptionalTrips[route.id]!;
    if (!exceptionalTrips.length) return;
    const positions = this.boardingPositions;
    positions.length = 0;
    for (let i = firstStop; i + 1 < route.getNbStops(); i++) {
      if (
        this.currentLabels.markedStops.has(route.stopId(i)) &&
        route.pickUpTypeFrom(i) !== PickUpDropOffTypes.NOT_AVAILABLE
      ) {
        positions.push(i);
      }
    }
    if (!positions.length) return;
    // Every trip stop matters: a trip already departed upstream may still be boardable downstream.
    let earliestTrip = 0;
    // A single candidate is cheaper to check directly than to search for a lower bound.
    if (exceptionalTrips.length > 1) {
      earliestTrip = route.getNbTrips();
      for (
        let stopIndex = firstStop;
        stopIndex + 1 < route.getNbStops();
        stopIndex++
      ) {
        const stopId = route.stopId(stopIndex);
        if (
          !this.currentLabels.markedStops.has(stopId) ||
          route.pickUpTypeFrom(stopIndex) === PickUpDropOffTypes.NOT_AVAILABLE
        )
          continue;
        let earliestTime =
          this.currentLabels.ordinary[stopId]?.readyAt ?? Infinity;
        const conditionalLabels = this.currentLabels.conditional.get(stopId);
        if (conditionalLabels)
          for (const label of conditionalLabels.values()) {
            earliestTime = Math.min(
              earliestTime,
              boardingFeeder(label).arrival,
            );
          }
        if (earliestTime !== Infinity)
          earliestTrip = Math.min(
            earliestTrip,
            route.findEarliestTrip(stopIndex, earliestTime) ??
              route.getNbTrips(),
          );
      }
    }
    let lo = 0,
      hi = exceptionalTrips.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (exceptionalTrips[mid]! < earliestTrip) lo = mid + 1;
      else hi = mid;
    }
    for (let candidate = lo; candidate < exceptionalTrips.length; candidate++) {
      const tripIndex = exceptionalTrips[candidate]!;
      this.statistics.exceptionalTripsConsidered++;
      if (
        route.departureFrom(firstStop, tripIndex) >=
          this.state.destinationBest ||
        route.departureFrom(firstStop, tripIndex) > this.state.maxArrivalTime
      ) {
        break;
      }
      const tripId = this.transferIndex.tripId(route.id, tripIndex);
      const firstCoveredArrival = Math.min(
        this.firstCoveredArrivalIndex.get(tripId) ?? route.getNbStops(),
        this.state.rangeBounds?.tripBoardingBound(this.round, tripId) ??
          Infinity,
      );
      for (const stopIndex of positions) {
        if (stopIndex + 1 >= firstCoveredArrival) break;
        const stopId = route.stopId(stopIndex);
        const ordinary = this.currentLabels.ordinary[stopId];
        let boarding = ordinary
          ? this.tryExceptionalBoarding(ordinary, route, stopIndex, tripIndex)
          : undefined;
        if (!boarding) {
          for (const label of this.currentLabels.conditional
            .get(stopId)
            ?.values() ?? []) {
            boarding = this.tryExceptionalBoarding(
              label,
              route,
              stopIndex,
              tripIndex,
              boardingFeeder(label),
            );
            if (boarding) break;
          }
        }
        if (boarding) {
          this.enqueueUncoveredTripScan(boarding);
          break;
        }
      }
    }
  }

  private boardingSource(feeder: VehicleEdge): BoardingSource {
    return {
      tripStopId: this.transferIndex.tripStopId({
        routeId: feeder.routeId,
        tripIndex: feeder.tripIndex,
        stopIndex: feeder.hopOffStopIndex,
      }),
      arrival: feeder.arrival,
    };
  }

  private tryExceptionalBoarding(
    label: Boarding,
    route: Route,
    stopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
    feeder?: VehicleEdge,
  ): BoardedTrip | undefined {
    this.statistics.exceptionalBoardingAttempts++;
    const departure = route.departureFrom(stopIndex, tripIndex);
    if (
      departure > this.maxBoardingDeparture(label) ||
      departure >= this.state.destinationBest
    )
      return undefined;
    const resolved = this.timetable.resolveBoarding(
      route,
      stopIndex,
      tripIndex,
      departure,
      label.readyAt,
      this.options.minTransferTime,
      feeder ? this.boardingSource(feeder) : undefined,
    );
    return resolved
      ? this.createBoarding(
          label,
          route,
          stopIndex,
          tripIndex,
          resolved,
          feeder,
        )
      : undefined;
  }

  /** Publish an arrival already checked against the duration and improvement bounds. */
  private recordArrival(stop: StopId, edge: RoutingEdge): void {
    this.state.publishArrival(stop, edge, this.round);
  }

  /** Read the tightest ordinary readiness bound. */
  private boardingBound(stop: StopId): Time {
    return Math.min(
      this.workspace.earliestBoardingTime[stop]!,
      this.state.rangeBounds?.boardingBound(this.round, stop) ?? Infinity,
    );
  }

  /** Read the tightest bound for matching conditional boarding rights. */
  private conditionalBoardingBound(stop: StopId, context: TripStopId): Time {
    return Math.min(
      this.bestConditionalArrivalTimes.get(stop)?.get(context) ?? Infinity,
      this.state.rangeBounds?.conditionalBoardingBound(
        this.round,
        stop,
        context,
      ) ?? Infinity,
    );
  }

  /** Retain ordinary boarding after checking time limits and dominance. */
  private retainBoarding(stop: StopId, time: Time, boarding: Boarding): void {
    this.workspace.earliestBoardingTime[stop] = time;
    this.state.rangeBounds?.updateBoardingBound(this.round, stop, time);
    this.nextLabels.set(stop, boarding);
    this.statistics.retainedContexts++;
  }

  /** Retain conditional boarding after checking time limits and dominance. */
  private retainConditionalBoarding(
    stop: StopId,
    context: TripStopId,
    time: Time,
    boarding: ConditionalBoarding,
  ): void {
    let bounds = this.bestConditionalArrivalTimes.get(stop);
    if (!bounds) {
      bounds = new Map<TripStopId, Time>();
      this.bestConditionalArrivalTimes.set(stop, bounds);
    }
    bounds.set(context, time);
    this.state.rangeBounds?.updateConditionalBoardingBound(
      this.round,
      stop,
      context,
      time,
    );
    this.nextLabels.setConditional(stop, context, boarding);
    this.statistics.retainedContexts++;
  }

  /**
   * Relax same-stop readiness and one walking transfer from an ordinary
   * vehicle arrival.
   */
  private relaxOrdinaryTransfers(edge: VehicleEdge): void {
    const stop = this.timetable
      .getRoute(edge.routeId)!
      .stopId(edge.hopOffStopIndex);
    let sameStopReady = edge.arrival + this.options.minTransferTime;
    for (const transfer of this.timetable.getTransfers(stop)) {
      const duration = transferDuration(transfer, this.options.minTransferTime);
      const ready = edge.arrival + duration;
      if (transfer.destination === stop) {
        // Explicit same-platform transfer times replace the query fallback.
        sameStopReady = ready;
        continue;
      }
      if (
        ready > this.state.maxArrivalTime ||
        ready >= this.state.destinationBest
      ) {
        continue;
      }
      const publish =
        ready < this.state.improvementBound(this.round, transfer.destination);
      // Decide both outcomes before publication can tighten destinationBest.
      const retain = ready < this.boardingBound(transfer.destination);
      if (!publish && !retain) {
        continue;
      }
      const walk = {
        arrival: ready,
        from: stop,
        to: transfer.destination,
        type: transfer.type,
        minTransferTime: duration,
        predecessor: edge,
      };
      if (publish) {
        this.recordArrival(transfer.destination, walk);
      }
      if (retain) {
        this.retainBoarding(transfer.destination, ready, {
          readyAt: ready,
          edge: walk,
        });
      }
    }
    if (
      sameStopReady <= this.state.maxArrivalTime &&
      sameStopReady < this.state.destinationBest &&
      sameStopReady < this.boardingBound(stop)
    ) {
      this.retainBoarding(stop, sameStopReady, {
        readyAt: sameStopReady,
        edge,
      });
    }
  }

  /**
   * Queue only uncovered trip arrivals, tracking continuation-entry
   * improvements separately from suffix coverage.
   */
  private enqueueUncoveredTripScan(boarding: BoardedTrip): void {
    if (
      !this.options.transportModes.has(
        this.timetable.getServiceRouteType(boarding.route),
      )
    ) {
      return;
    }
    const id = this.transferIndex.tripId(boarding.route.id, boarding.tripIndex);
    const previous = Math.min(
      this.firstCoveredArrivalIndex.get(id) ?? boarding.route.getNbStops(),
      this.state.rangeBounds?.tripBoardingBound(this.round, id) ?? Infinity,
    );
    let scanEntry = false;
    if (boarding.continuation) {
      const tripStopId = this.transferIndex.tripStopId({
        routeId: boarding.route.id,
        tripIndex: boarding.tripIndex,
        stopIndex: boarding.boardingStopIndex,
      });
      const arrival = Math.max(
        boarding.continuation.arrival,
        boarding.route.arrivalAt(
          boarding.boardingStopIndex,
          boarding.tripIndex,
        ),
      );
      scanEntry =
        arrival <
        (this.bestContinuationEntryArrival.get(tripStopId) ?? Infinity);
      if (scanEntry) {
        this.bestContinuationEntryArrival.set(tripStopId, arrival);
      }
    }
    // Suffix coverage is independent of the feeder's entry arrival time.
    const firstArrival = boarding.boardingStopIndex + 1;
    if (firstArrival >= previous && !scanEntry) {
      return;
    }
    if (firstArrival < previous) {
      this.firstCoveredArrivalIndex.set(id, firstArrival);
      this.state.rangeBounds?.updateTripBoardingBound(
        this.round,
        id,
        firstArrival,
      );
    }
    this.pendingTripScans.push({
      ...boarding,
      startStopIndex: boarding.boardingStopIndex + (scanEntry ? 0 : 1),
      endStopIndexExclusive: firstArrival < previous ? previous : firstArrival,
    });
    this.statistics.exceptionalBoardings++;
  }

  /**
   * Process continuations before alighting restrictions, then retain
   * ordinary or conditional vehicle arrivals.
   */
  private processTripArrival(
    boarded: BoardedTrip,
    stopIndex: StopRouteIndex,
  ): void {
    const { route, tripIndex } = boarded;
    this.statistics.scannedTripStops++;
    const arrival = Math.max(
      route.arrivalAtOffset(stopIndex, boarded.tripOffset),
      stopIndex === boarded.boardingStopIndex
        ? (boarded.continuation?.arrival ?? 0)
        : 0,
    );
    if (
      arrival > this.state.maxArrivalTime ||
      arrival >= this.state.destinationBest
    ) {
      return;
    }
    // Ordinary trips have no trip stop-specific rules to look up.
    const tripStopId = this.transferIndex.isExceptional(route.id, tripIndex)
      ? this.transferIndex.tripStopId({
          routeId: route.id,
          tripIndex,
          stopIndex,
        })
      : undefined;
    const rules =
      tripStopId === undefined
        ? NO_TRIP_RULES
        : this.transferIndex.rulesFrom(tripStopId);
    const stop = route.stopId(stopIndex);
    const canAlight =
      route.dropOffTypeAt(stopIndex) !== PickUpDropOffTypes.NOT_AVAILABLE;
    if (rules.length === 0) {
      if (
        !canAlight ||
        arrival >= this.workspace.earliestOrdinaryVehicleArrival[stop]!
      ) {
        return;
      }
    }
    const edge: VehicleEdge = {
      routeId: route.id,
      tripIndex,
      stopIndex: boarded.boardingStopIndex,
      hopOffStopIndex: stopIndex,
      arrival,
      predecessor: boarded.predecessor,
      ...(boarded.continuation && { continuationOf: boarded.continuation }),
    };
    let conditional = false;
    // In-seat transfers are reachable even where public alighting is forbidden.
    for (const rule of rules) {
      if (rule.type !== TransferTypes.IN_SEAT) {
        conditional = true;
        continue;
      }
      const target = this.transferIndex.position(rule.target);
      const targetRoute = this.timetable.getRoute(target.routeId)!;
      if (
        targetRoute.departureFrom(target.stopIndex, target.tripIndex) < arrival
      ) {
        continue;
      }
      this.enqueueUncoveredTripScan({
        route: targetRoute,
        tripIndex: target.tripIndex,
        tripOffset: targetRoute.tripStopOffset(target.tripIndex),
        boardingStopIndex: target.stopIndex,
        predecessor: edge,
        continuation: edge,
      });
    }
    if (!canAlight) {
      return;
    }
    if (!conditional) {
      if (arrival >= this.workspace.earliestOrdinaryVehicleArrival[stop]!) {
        return;
      }
      this.workspace.earliestOrdinaryVehicleArrival[stop] = arrival;
    }
    if (
      arrival <= this.state.maxArrivalTime &&
      arrival < this.state.improvementBound(this.round, stop)
    ) {
      this.recordArrival(stop, edge);
    }
    if (conditional) {
      this.pendingConditionalTransfers.push({
        edge,
        tripStopId: tripStopId!,
        rules,
      });
    } else {
      this.bestOrdinaryVehicleArrivals.set(stop, edge);
    }
  }

  /** Coalesce footpaths within one feeder; different feeders retain distinct rights. */
  private relaxConditionalTransfers(
    edge: VehicleEdge,
    tripStopId: TripStopId,
    rules: readonly Readonly<TripRule>[],
  ): void {
    const stop = this.timetable
      .getRoute(edge.routeId)!
      .stopId(edge.hopOffStopIndex);
    const arrival = edge.arrival;
    const destinations = new Map<StopId, ConditionalBoarding>();
    destinations.set(stop, {
      readyAt: arrival + this.options.minTransferTime,
      edge,
    });
    for (const transfer of this.timetable.getTransfers(stop)) {
      const duration = transferDuration(transfer, this.options.minTransferTime);
      const ready = arrival + duration;
      const walk = {
        arrival: ready,
        from: stop,
        to: transfer.destination,
        type: transfer.type,
        minTransferTime: duration,
        predecessor: edge,
      };
      if (
        transfer.destination !== stop &&
        ready <= this.state.maxArrivalTime &&
        ready < this.state.improvementBound(this.round, transfer.destination)
      ) {
        this.recordArrival(transfer.destination, walk);
      }
      if (
        transfer.destination === stop ||
        ready < (destinations.get(transfer.destination)?.readyAt ?? Infinity)
      ) {
        destinations.set(transfer.destination, {
          readyAt: ready,
          edge: transfer.destination === stop ? edge : walk,
        });
      }
    }
    const sensitive = new Set<StopId>();
    for (const rule of rules) {
      if (rule.type === TransferTypes.IN_SEAT) {
        continue;
      }
      const target = this.transferIndex.position(rule.target);
      const destination = this.timetable
        .getRoute(target.routeId)!
        .stopId(target.stopIndex);
      sensitive.add(destination);
      // A specific rule can establish a connection without a generic footpath.
      if (!destinations.has(destination)) {
        destinations.set(destination, { readyAt: Infinity, edge });
      }
    }
    for (const [destination, boarding] of destinations) {
      const conditional = sensitive.has(destination);
      const bound = conditional
        ? this.conditionalBoardingBound(destination, tripStopId)
        : this.boardingBound(destination);
      const time = conditional ? edge.arrival : boarding.readyAt;
      if (
        time <= this.state.maxArrivalTime &&
        time < this.state.destinationBest &&
        time < bound
      ) {
        if (conditional) {
          this.retainConditionalBoarding(
            destination,
            tripStopId,
            time,
            boarding,
          );
        } else {
          this.retainBoarding(destination, time, boarding);
        }
      }
    }
  }

  /** Inclusive ceiling shared by ordinary lookup and exceptional boardings. */
  private maxBoardingDeparture(label: Boarding): Time {
    return this.round === 1 && this.options.maxInitialWaitingTime !== undefined
      ? Math.min(
          this.state.maxArrivalTime,
          label.edge.arrival + this.options.maxInitialWaitingTime,
        )
      : this.state.maxArrivalTime;
  }

  /** Attach routing predecessors to a timetable eligibility result. */
  private createBoarding(
    label: Boarding,
    route: Route,
    stopIndex: StopRouteIndex,
    trip: TripRouteIndex,
    resolved: ResolvedBoarding,
    feeder?: VehicleEdge,
  ): BoardedTrip {
    let predecessor = label.edge;
    if (resolved.rule && feeder) {
      const source = feeder;
      predecessor = {
        arrival: resolved.ready,
        from: this.timetable
          .getRoute(source.routeId)!
          .stopId(source.hopOffStopIndex),
        to: route.stopId(stopIndex),
        type: resolved.rule.type,
        minTransferTime: resolved.rule.minTransferTime,
        predecessor: source,
      };
    }
    return {
      route,
      tripIndex: trip,
      tripOffset: route.tripStopOffset(trip),
      boardingStopIndex: stopIndex,
      predecessor,
    };
  }
}
