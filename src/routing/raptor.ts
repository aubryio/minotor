/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import {
  PickUpDropOffTypes,
  Route,
  StopRouteIndex,
  TripRouteIndex,
} from '../timetable/route.js';
import { Time } from '../timetable/time.js';
import { Timetable, TransferTypes } from '../timetable/timetable.js';
import { OccurrenceId, TripId, TripRule } from '../timetable/tripTransfers.js';
import {
  Boarding,
  BoardingContext,
  Frontier,
  RoundNumber,
} from './frontier.js';
import { QueryOptions } from './query.js';
import { RoutingEdge, VehicleEdge } from './state.js';

export interface IRaptorState {
  /** Origin stop IDs for this run. */
  readonly origins: StopId[];

  /** Per-round routing graph; `graph[round][stop]` is the best edge used to reach `stop`. */
  readonly graph: (RoutingEdge | undefined)[][];

  /** Per-run earliest arrival at a stop. Used for boarding decisions. */
  arrivalTime(stop: StopId): Time;

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

  /** Returns `true` if `stop` is one of the query's destination stops. */
  isDestination(stop: StopId): boolean;

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

  /** Optional range-only bounds; never use an ordinary stop label for these. */
  boardingBound?(
    round: RoundNumber,
    stop: StopId,
    context: BoardingContext,
  ): Time;
  updateBoardingBound?(
    round: RoundNumber,
    stop: StopId,
    context: BoardingContext,
    time: Time,
  ): void;
  tripBoardingBound?(round: RoundNumber, trip: TripId): StopRouteIndex;
  updateTripBoardingBound?(
    round: RoundNumber,
    trip: TripId,
    stopIndex: StopRouteIndex,
  ): void;
}

const NO_RULES: TripRule[] = [];

type BoardedTrip = {
  route: Route;
  trip: TripRouteIndex;
  stop: StopRouteIndex;
  predecessor: RoutingEdge;
  continuation?: VehicleEdge;
  scanEnd?: StopRouteIndex;
  scanEntry?: boolean;
};

/** Shared workspaces avoid reallocating stop-sized buffers between departure runs. */
export class Raptor {
  readonly statistics = {
    scannedTripStops: 0,
    retainedContexts: 0,
    exceptionalBoardings: 0,
  };
  private readonly ordinaryArrivals: Uint16Array;
  private readonly boardingTimes: Uint16Array;

  constructor(private readonly timetable: Timetable) {
    this.ordinaryArrivals = new Uint16Array(timetable.nbStops());
    this.boardingTimes = new Uint16Array(timetable.nbStops());
  }

  run(options: QueryOptions, state: IRaptorState): void {
    this.statistics.scannedTripStops = 0;
    this.statistics.retainedContexts = 0;
    this.statistics.exceptionalBoardings = 0;
    new RaptorRun(
      this.timetable,
      options,
      state,
      this.ordinaryArrivals.fill(0xffff),
      this.boardingTimes.fill(0xffff),
      this.statistics,
    ).run();
  }
}

/** One departure run: scan vehicles, preserve special connections, then relax walks. */
class RaptorRun {
  private readonly index: Timetable['tripTransfers'];
  private frontier: Frontier;
  private nextFrontier: Frontier;
  private readonly conditionalTimes = new Map<
    StopId,
    Map<BoardingContext, Time>
  >();
  private readonly covered = new Map<TripId, StopRouteIndex>();
  private readonly continuationEntries = new Map<OccurrenceId, Time>();
  private readonly queue: BoardedTrip[] = [];
  private readonly walks = new Map<StopId, VehicleEdge>();
  private readonly conditionalWalks: {
    edge: VehicleEdge;
    occurrence: OccurrenceId;
    rules: TripRule[];
  }[] = [];
  private round: RoundNumber = 0;

  constructor(
    private readonly timetable: Timetable,
    private readonly options: QueryOptions,
    private readonly state: IRaptorState,
    private readonly ordinaryArrivals: Uint16Array,
    private readonly boardingTimes: Uint16Array,
    private readonly statistics: Raptor['statistics'],
  ) {
    this.index = timetable.tripTransfers;
    this.frontier = new Frontier(timetable.nbStops());
    this.nextFrontier = new Frontier(timetable.nbStops());
    for (const stop of state.origins) {
      const edge = state.graph[0]![stop];
      if (edge) {
        this.frontier.set(stop, 0, { ready: edge.arrival, edge });
      }
    }
  }

  private allowed(route: Route): boolean {
    return this.options.transportModes.has(
      this.timetable.getServiceRouteType(route),
    );
  }

  run(): void {
    for (
      this.round = 1;
      this.round <= this.options.maxTransfers + 1 && this.frontier.stops.size;
      this.round++
    ) {
      this.state.initRound(this.round);

      const routes = this.timetable.findReachableRoutes(
        this.frontier.stops,
        this.options.transportModes,
      );
      // Ordinary routes establish destination bounds before exceptional scans.
      for (const [route, firstStop] of routes) {
        this.scanOrdinaryRoute(route, firstStop);
      }
      for (const [route, firstStop] of routes) {
        this.findExceptionalBoardings(route, firstStop);
      }
      // Continuations appended during a scan remain in this transit round.
      for (let position = 0; position < this.queue.length; position++) {
        this.scanExceptionalTrip(this.queue[position]!);
      }
      // Only vehicle arrivals start walks; walked labels feed the next transit round.
      for (const edge of this.walks.values()) {
        this.relaxOrdinaryTransfers(edge);
      }
      for (const { edge, occurrence, rules } of this.conditionalWalks) {
        this.relaxConditionalTransfers(edge, occurrence, rules);
      }
      this.frontier.clear();
      [this.frontier, this.nextFrontier] = [this.nextFrontier, this.frontier];
      this.queue.length = 0;
      this.walks.clear();
      this.conditionalWalks.length = 0;
    }
  }

  private scanOrdinaryRoute(route: Route, firstStop: StopRouteIndex): void {
    let active: BoardedTrip | undefined;
    for (let stop = firstStop; stop < route.getNbStops(); stop++) {
      if (active) {
        this.arrive(active, stop);
      }
      const ordinary = this.frontier.ordinary[route.stopId(stop)];
      const labels = this.frontier.conditional.get(route.stopId(stop));
      if (ordinary) {
        active =
          this.firstOrdinaryBoarding(ordinary, route, stop, active) ?? active;
      }
      if (labels) {
        for (const label of labels.values()) {
          active =
            this.firstOrdinaryBoarding(label, route, stop, active) ?? active;
        }
      }
    }
  }

  private firstOrdinaryBoarding(
    label: Boarding,
    route: Route,
    stop: StopRouteIndex,
    active?: BoardedTrip,
  ): BoardedTrip | undefined {
    // A pair-specific minimum can permit boarding before the generic ready time.
    const earliest = route.findEarliestTrip(
      stop,
      label.source?.arrival ?? label.ready,
      active?.trip,
    );
    if (earliest === undefined) {
      return undefined;
    }
    for (
      let trip = earliest;
      trip < (active?.trip ?? route.getNbTrips());
      trip++
    ) {
      if (this.index.isExceptional(route.id, trip)) {
        continue;
      }
      const boarding = this.board(label, route, stop, trip);
      if (boarding) {
        return boarding;
      }
    }
    return undefined;
  }

  /** Each exceptional trip needs only its earliest useful boarding position. */
  private findExceptionalBoardings(
    route: Route,
    firstStop: StopRouteIndex,
  ): void {
    for (const trip of this.index.exceptionalTrips[route.id]!) {
      if (
        route.departureFrom(firstStop, trip) >= this.state.destinationBest ||
        route.departureFrom(firstStop, trip) > this.state.maxArrivalTime
      ) {
        break;
      }
      const tripId = this.index.tripId(route.id, trip);
      const firstCoveredArrival = Math.min(
        this.covered.get(tripId) ?? route.getNbStops(),
        this.state.tripBoardingBound?.(this.round, tripId) ?? Infinity,
      );
      for (let stop = firstStop; stop + 1 < firstCoveredArrival; stop++) {
        const stopId = route.stopId(stop);
        const ordinary = this.frontier.ordinary[stopId];
        let boarding = ordinary
          ? this.board(ordinary, route, stop, trip)
          : undefined;
        if (!boarding) {
          const labels = this.frontier.conditional.get(stopId);
          if (labels) {
            for (const label of labels.values()) {
              boarding = this.board(label, route, stop, trip);
              if (boarding) {
                break;
              }
            }
          }
        }
        if (boarding) {
          this.enqueue(boarding);
          break;
        }
      }
    }
  }

  private scanExceptionalTrip(boarding: BoardedTrip): void {
    // The entry occurrence matters for an in-seat continuation, including
    // another continuation at the same occurrence. Ordinary boarding cannot alight there.
    for (
      let stop = boarding.stop + (boarding.scanEntry ? 0 : 1);
      stop < (boarding.scanEnd ?? boarding.route.getNbStops());
      stop++
    ) {
      this.arrive(boarding, stop);
    }
  }

  private recordArrival(stop: StopId, edge: RoutingEdge) {
    if (
      edge.arrival <= this.state.maxArrivalTime &&
      edge.arrival < this.state.improvementBound(this.round, stop)
    ) {
      this.state.graph[this.round]![stop] = edge;
      this.state.updateArrival(stop, edge.arrival, this.round);
    }
  }

  /** Compare only labels with identical boarding rights. */
  private improveBoarding(
    stop: StopId,
    context: BoardingContext,
    time: Time,
  ): boolean {
    if (
      time > this.state.maxArrivalTime ||
      time >= this.state.destinationBest
    ) {
      return false;
    }
    const shared =
      this.state.boardingBound?.(this.round, stop, context) ?? Infinity;
    if (context === 0) {
      if (time >= Math.min(this.boardingTimes[stop]!, shared)) {
        return false;
      }
      this.boardingTimes[stop] = time;
    } else {
      let bounds = this.conditionalTimes.get(stop);
      if (!bounds) {
        bounds = new Map<BoardingContext, Time>();
        this.conditionalTimes.set(stop, bounds);
      }
      if (time >= Math.min(bounds.get(context) ?? Infinity, shared)) {
        return false;
      }
      bounds.set(context, time);
    }
    this.state.updateBoardingBound?.(this.round, stop, context, time);
    this.statistics.retainedContexts++;
    return true;
  }

  private relaxOrdinaryTransfers(edge: VehicleEdge) {
    const stop = this.timetable
      .getRoute(edge.routeId)!
      .stopId(edge.hopOffStopIndex);
    let sameStopReady = edge.arrival + this.options.minTransferTime;
    for (const transfer of this.timetable.getTransfers(stop)) {
      const duration =
        transfer.minTransferTime ??
        (transfer.type === TransferTypes.GUARANTEED ||
        transfer.type === TransferTypes.IN_SEAT
          ? 0
          : this.options.minTransferTime);
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
      const retain = this.improveBoarding(transfer.destination, 0, ready);
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
        this.nextFrontier.set(transfer.destination, 0, { ready, edge: walk });
      }
    }
    if (this.improveBoarding(stop, 0, sameStopReady)) {
      this.nextFrontier.set(stop, 0, { ready: sameStopReady, edge });
    }
  }

  private enqueue(boarding: BoardedTrip) {
    if (!this.allowed(boarding.route)) {
      return;
    }
    const id = this.index.tripId(boarding.route.id, boarding.trip);
    const previous = Math.min(
      this.covered.get(id) ?? boarding.route.getNbStops(),
      this.state.tripBoardingBound?.(this.round, id) ?? Infinity,
    );
    let scanEntry = false;
    if (boarding.continuation) {
      const occurrence = this.index.occurrence({
        routeId: boarding.route.id,
        tripIndex: boarding.trip,
        stopIndex: boarding.stop,
      });
      const arrival = Math.max(
        boarding.continuation.arrival,
        boarding.route.arrivalAt(boarding.stop, boarding.trip),
      );
      scanEntry =
        arrival < (this.continuationEntries.get(occurrence) ?? Infinity);
      if (scanEntry) {
        this.continuationEntries.set(occurrence, arrival);
      }
    }
    // Suffix coverage is independent of the feeder's entry arrival time.
    const firstArrival = boarding.stop + 1;
    if (firstArrival >= previous && !scanEntry) {
      return;
    }
    if (firstArrival < previous) {
      this.covered.set(id, firstArrival);
      this.state.updateTripBoardingBound?.(this.round, id, firstArrival);
    }
    this.queue.push({
      ...boarding,
      scanEntry,
      scanEnd: firstArrival < previous ? previous : firstArrival,
    });
    this.statistics.exceptionalBoardings++;
  }

  private arrive(boarded: BoardedTrip, stopIndex: StopRouteIndex) {
    const { route, trip } = boarded;
    this.statistics.scannedTripStops++;
    const arrival = Math.max(
      route.arrivalAt(stopIndex, trip),
      stopIndex === boarded.stop ? (boarded.continuation?.arrival ?? 0) : 0,
    );
    if (
      arrival > this.state.maxArrivalTime ||
      arrival >= this.state.destinationBest
    ) {
      return;
    }
    // Ordinary trips have no occurrence-specific rules to look up.
    const occurrence = this.index.isExceptional(route.id, trip)
      ? this.index.occurrence({ routeId: route.id, tripIndex: trip, stopIndex })
      : undefined;
    const rules =
      occurrence === undefined
        ? NO_RULES
        : [...this.index.outgoing(occurrence)];
    const stop = route.stopId(stopIndex);
    const canAlight =
      route.dropOffTypeAt(stopIndex, trip) !== PickUpDropOffTypes.NOT_AVAILABLE;
    if (rules.length === 0) {
      if (!canAlight || arrival >= this.ordinaryArrivals[stop]!) {
        return;
      }
    }
    const edge: VehicleEdge = {
      routeId: route.id,
      tripIndex: trip,
      stopIndex: boarded.stop,
      hopOffStopIndex: stopIndex,
      arrival,
      predecessor: boarded.predecessor,
      ...(boarded.continuation && { continuationOf: boarded.continuation }),
    };
    // In-seat transfers are reachable even where public alighting is forbidden.
    for (const rule of rules) {
      if (rule.type !== TransferTypes.IN_SEAT) {
        continue;
      }
      const target = this.index.position(rule.target);
      const targetRoute = this.timetable.getRoute(target.routeId)!;
      if (
        targetRoute.departureFrom(target.stopIndex, target.tripIndex) < arrival
      ) {
        continue;
      }
      this.enqueue({
        route: targetRoute,
        trip: target.tripIndex,
        stop: target.stopIndex,
        predecessor: edge,
        continuation: edge,
      });
    }
    if (!canAlight) {
      return;
    }
    const conditional = rules.some(
      (rule) => rule.type !== TransferTypes.IN_SEAT,
    );
    if (!conditional) {
      if (arrival >= this.ordinaryArrivals[stop]!) {
        return;
      }
      this.ordinaryArrivals[stop] = arrival;
    }
    this.recordArrival(stop, edge);
    if (conditional) {
      this.conditionalWalks.push({ edge, occurrence: occurrence!, rules });
    } else {
      this.walks.set(stop, edge);
    }
  }

  /** Coalesce footpaths within one feeder; different feeders retain distinct rights. */
  private relaxConditionalTransfers(
    edge: VehicleEdge,
    occurrence: OccurrenceId,
    rules: TripRule[],
  ) {
    const stop = this.timetable
      .getRoute(edge.routeId)!
      .stopId(edge.hopOffStopIndex);
    const arrival = edge.arrival;
    const destinations = new Map<StopId, { ready: Time; edge: RoutingEdge }>();
    destinations.set(stop, {
      ready: arrival + this.options.minTransferTime,
      edge,
    });
    for (const transfer of this.timetable.getTransfers(stop)) {
      const duration =
        transfer.minTransferTime ??
        (transfer.type === TransferTypes.GUARANTEED ||
        transfer.type === TransferTypes.IN_SEAT
          ? 0
          : this.options.minTransferTime);
      const ready = arrival + duration;
      const walk = {
        arrival: ready,
        from: stop,
        to: transfer.destination,
        type: transfer.type,
        minTransferTime: duration,
        predecessor: edge,
      };
      if (transfer.destination !== stop) {
        this.recordArrival(transfer.destination, walk);
      }
      if (
        transfer.destination === stop ||
        ready < (destinations.get(transfer.destination)?.ready ?? Infinity)
      ) {
        destinations.set(transfer.destination, {
          ready,
          edge: transfer.destination === stop ? edge : walk,
        });
      }
    }
    const sensitive = new Set<StopId>();
    for (const rule of rules) {
      if (rule.type === TransferTypes.IN_SEAT) {
        continue;
      }
      const target = this.index.position(rule.target);
      const destination = this.timetable
        .getRoute(target.routeId)!
        .stopId(target.stopIndex);
      sensitive.add(destination);
      // A specific rule can establish a connection without a generic footpath.
      if (!destinations.has(destination)) {
        destinations.set(destination, { ready: Infinity, edge });
      }
    }
    for (const [destination, boarding] of destinations) {
      const conditional = sensitive.has(destination);
      const context = conditional ? occurrence + 1 : 0;
      const time = conditional ? edge.arrival : boarding.ready;
      if (this.improveBoarding(destination, context, time)) {
        this.nextFrontier.set(destination, context, {
          ...boarding,
          ...(conditional && { source: edge, occurrence }),
        });
      }
    }
  }

  private board(
    label: Boarding,
    route: Route,
    stop: StopRouteIndex,
    trip: TripRouteIndex,
  ): BoardedTrip | undefined {
    if (route.pickUpTypeFrom(stop, trip) === PickUpDropOffTypes.NOT_AVAILABLE) {
      return undefined;
    }
    const departure = route.departureFrom(stop, trip);
    const rule =
      label.occurrence === undefined
        ? undefined
        : this.index.transfer(
            label.occurrence,
            this.index.occurrence({
              routeId: route.id,
              tripIndex: trip,
              stopIndex: stop,
            }),
          );
    const ready = rule
      ? label.source!.arrival +
        (rule.type === TransferTypes.GUARANTEED
          ? 0
          : (rule.minTransferTime ?? this.options.minTransferTime))
      : label.ready;
    if (
      departure < ready ||
      departure > this.state.maxArrivalTime ||
      departure >= this.state.destinationBest ||
      (this.round === 1 &&
        this.options.maxInitialWaitingTime !== undefined &&
        departure - label.edge.arrival > this.options.maxInitialWaitingTime)
    ) {
      return undefined;
    }
    let predecessor = label.edge;
    if (rule) {
      const source = label.source!;
      predecessor = {
        arrival: ready,
        from: this.timetable
          .getRoute(source.routeId)!
          .stopId(source.hopOffStopIndex),
        to: route.stopId(stop),
        type: rule.type,
        minTransferTime: rule.minTransferTime,
        predecessor: source,
      };
    }
    return { route, trip, stop, predecessor };
  }
}
