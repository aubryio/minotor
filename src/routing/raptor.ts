/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import {
  PickUpDropOffTypes,
  Route,
  StopRouteIndex,
} from '../timetable/route.js';
import { Time } from '../timetable/time.js';
import {
  Timetable,
  TransferTypes,
  TripConnections,
  TripStop,
  tripTransferReadyTime,
} from '../timetable/timetable.js';
import { encode, TripStopId } from '../timetable/tripStopId.js';
import { QueryOptions } from './query.js';
import { RoutingEdge, TransferEdge, VehicleEdge } from './state.js';

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
  improvementBound(round: number, stop: StopId): Time;

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
  updateArrival(stop: StopId, time: Time, round: number): void;

  /**
   * Propagates labels from round `k-1` into round `k` before routes are scanned.
   * No-op in standard RAPTOR mode.
   */
  initRound(round: number): void;

  /** Cross-run bounds distinguish unrestricted boarding from a vehicle arrival eligible to walk. */
  improveOrdinaryLabel?(
    round: number,
    stop: StopId,
    time: Time,
    walking: boolean,
  ): boolean;

  /** Earliest already-reached position on this trip, across later departure runs. */
  tripBoardingBound?(round: number, trip: TripStopId): StopRouteIndex;

  /** Optional cross-run dominance once aboard the exact same scheduled trip. */
  improveTripBoarding?(
    round: number,
    trip: TripStopId,
    stopIndex: StopRouteIndex,
  ): boolean;
}

type BoardingLabel = {
  edge: RoutingEdge;
  ready: Time;
  source?: VehicleEdge;
  sourceId?: TripStopId;
};
type Boarding = TripStop & {
  previous: RoutingEdge;
  continuationOf?: VehicleEdge;
};

/** Dense ordinary labels; maps exist only for trip-conditioned alternatives. */
class Frontier {
  readonly ordinary: (BoardingLabel | undefined)[];
  readonly conditional = new Map<StopId, Map<TripStopId, BoardingLabel>>();
  readonly stops = new Set<StopId>();
  readonly sources: VehicleEdge[] = [];

  constructor(nbStops: number) {
    this.ordinary = new Array<BoardingLabel | undefined>(nbStops);
  }

  clear(): void {
    for (const stop of this.stops) {
      this.ordinary[stop] = undefined;
    }
    this.stops.clear();
    this.conditional.clear();
    this.sources.length = 0;
  }
}

type RunBuffers = { ready: Float64Array; walkArrival: Float64Array };

/** One engine for plain and Range RAPTOR, with sparse fixed-trip scans. */
export class Raptor {
  // Numeric buffers may be reused; reconstructed paths never reference them.
  private buffers?: RunBuffers;

  constructor(private readonly timetable: Timetable) {}

  run(options: QueryOptions, state: IRaptorState): void {
    const nbStops = state.graph[0]!.length;
    const buffers =
      this.buffers?.ready.length === nbStops
        ? this.buffers
        : {
            ready: new Float64Array(nbStops),
            walkArrival: new Float64Array(nbStops),
          };
    // Lease the buffers so even a reentrant call gets independent working state.
    this.buffers = undefined;
    buffers.ready.fill(Infinity);
    buffers.walkArrival.fill(Infinity);
    try {
      new RaptorRun(this.timetable, options, state, buffers).run();
    } finally {
      this.buffers = buffers;
    }
  }
}

/** Query-local labels and paths; numeric bounds are borrowed from the engine. */
class RaptorRun {
  private frontier: Frontier;
  private next: Frontier;
  private readonly ready: Float64Array;
  private readonly walkArrival: Float64Array;
  private readonly conditionalReady = new Map<TripStopId, Map<StopId, Time>>();
  private readonly connectionsSeen = new Set<TripStopId>();
  private readonly walks = new Map<StopId, VehicleEdge>();
  private readonly scanned = new Map<TripStopId, StopRouteIndex>();
  private readonly queued = new Map<TripStopId, StopRouteIndex>();
  private readonly queue: Boarding[] = [];
  private round = 0;

  constructor(
    private readonly timetable: Timetable,
    private readonly options: QueryOptions,
    private readonly state: IRaptorState,
    buffers: RunBuffers,
  ) {
    const nbStops = state.graph[0]!.length;
    this.frontier = new Frontier(nbStops);
    this.next = new Frontier(nbStops);
    this.ready = buffers.ready;
    this.walkArrival = buffers.walkArrival;
    for (const stop of state.origins) {
      const edge = state.graph[0]![stop];
      if (!edge) {
        continue;
      }
      this.frontier.ordinary[stop] = { edge, ready: edge.arrival };
      this.frontier.stops.add(stop);
    }
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
      // Ordinary scanning tightens destination bounds before special trips are queued.
      for (const [route, start] of routes) {
        this.scanRoute(route, start);
      }
      for (const [route, start] of routes) {
        this.findSpecialBoardings(route, start);
      }
      for (const source of this.frontier.sources) {
        const from = this.tripStop(source);
        const label: BoardingLabel = {
          edge: source,
          ready: source.arrival + this.options.minTransferTime,
          source,
        };
        for (const rule of this.timetable.getTripTransferRules(from)) {
          const route = this.timetable.getRoute(rule.routeId)!;
          if (
            !this.allowed(route) ||
            rule.stopIndex >=
              this.boardingBound(encode(0, rule.routeId, rule.tripIndex))
          ) {
            continue;
          }
          const boarding = this.board(
            route,
            rule.stopIndex,
            rule.tripIndex,
            label,
          );
          if (boarding) {
            this.enqueue(boarding);
          }
        }
      }
      for (let i = 0; i < this.queue.length; i++) {
        this.scanTrip(this.queue[i]!);
      }
      // A walked label must not suppress a vehicle arrival's ability to start a walk.
      for (const edge of this.walks.values()) {
        this.considerTransfers(edge);
      }
      for (const edge of this.next.sources) {
        this.considerTransfers(
          edge,
          encode(edge.hopOffStopIndex, edge.routeId, edge.tripIndex),
        );
      }
      this.frontier.clear();
      [this.frontier, this.next] = [this.next, this.frontier];
      this.walks.clear();
      this.queued.clear();
      this.queue.length = 0;
    }
  }

  private allowed(route: Route): boolean {
    return this.options.transportModes.has(
      this.timetable.getServiceRouteInfo(route).type,
    );
  }

  private inBounds(time: Time): boolean {
    return (
      time <= this.state.maxArrivalTime && time < this.state.destinationBest
    );
  }

  private tripStop(edge: VehicleEdge): TripStop {
    return {
      routeId: edge.routeId,
      tripIndex: edge.tripIndex,
      stopIndex: edge.hopOffStopIndex,
    };
  }

  /** All discovery paths use the same exact-pair eligibility and predecessor. */
  private board(
    route: Route,
    index: number,
    trip: number,
    label: BoardingLabel,
  ): Boarding | undefined {
    const departure = route.departureFrom(index, trip);
    if (
      !this.inBounds(departure) ||
      route.pickUpTypeFrom(index, trip) === PickUpDropOffTypes.NOT_AVAILABLE
    ) {
      return undefined;
    }
    const target = { routeId: route.id, stopIndex: index, tripIndex: trip };
    const source = label.source;
    const rule = source
      ? this.timetable.getTripTransferRule(this.tripStop(source), target)
      : undefined;
    const ready = tripTransferReadyTime(
      rule,
      source?.arrival ?? label.edge.arrival,
      label.ready,
    );
    if (
      departure < ready ||
      (this.round === 1 &&
        this.options.maxInitialWaitingTime !== undefined &&
        departure - label.edge.arrival > this.options.maxInitialWaitingTime)
    ) {
      return undefined;
    }
    let previous = label.edge;
    if (source && rule) {
      previous = {
        from: this.timetable
          .getRoute(source.routeId)!
          .stopId(source.hopOffStopIndex),
        to: route.stopId(index),
        type: rule.type,
        arrival: ready,
        previous: source,
        ...(rule.type === TransferTypes.REQUIRES_MINIMAL_TIME && {
          minTransferTime: rule.minTransferTime,
        }),
      };
    }
    return { ...target, previous };
  }

  /** Scan each ordinary route once, upgrading the active trip along the route. */
  private scanRoute(route: Route, start: number): void {
    let active: Boarding | undefined;
    const special = this.timetable.getSpecialTrips(route.id);
    if (special.length === route.getNbTrips()) {
      return;
    }
    for (let index = start; index < route.getNbStops(); index++) {
      if (active) {
        this.arrive(route, index, active);
      }
      const stop = route.stopId(index);
      const ordinary = this.frontier.ordinary[stop];
      if (ordinary) {
        active =
          this.firstOrdinaryBoarding(route, index, ordinary, special, active) ??
          active;
      }
      const conditional = this.frontier.conditional.get(stop);
      if (conditional) {
        for (const label of conditional.values()) {
          active =
            this.firstOrdinaryBoarding(route, index, label, special, active) ??
            active;
        }
      }
    }
  }

  private firstOrdinaryBoarding(
    route: Route,
    index: number,
    label: BoardingLabel,
    special: readonly number[],
    active?: Boarding,
  ): Boarding | undefined {
    const after = label.source?.arrival ?? label.ready;
    if (active && after > route.departureFrom(index, active.tripIndex)) {
      return undefined;
    }
    const first = route.findEarliestTrip(index, after, active?.tripIndex);
    if (first === undefined) {
      return undefined;
    }
    let specialIndex = 0;
    while (specialIndex < special.length && special[specialIndex]! < first) {
      specialIndex++;
    }
    for (
      let trip = first;
      trip < (active?.tripIndex ?? route.getNbTrips());
      trip++
    ) {
      if (!this.inBounds(route.departureFrom(index, trip))) {
        break;
      }
      if (special[specialIndex] === trip) {
        specialIndex++;
        continue;
      }
      const boarding = this.board(route, index, trip, label);
      if (boarding) {
        return boarding;
      }
    }
    return undefined;
  }

  /** Each special trip is discovered once per route, at its earliest useful position. */
  private findSpecialBoardings(route: Route, start: number): void {
    for (const trip of this.timetable.getSpecialTrips(route.id)) {
      if (!this.inBounds(route.departureFrom(start, trip))) {
        break;
      }
      const bound = Math.min(
        route.getNbStops(),
        this.boardingBound(encode(0, route.id, trip)),
      );
      for (let index = start; index < bound; index++) {
        const stop = route.stopId(index);
        const ordinary = this.frontier.ordinary[stop];
        let boarding = ordinary && this.board(route, index, trip, ordinary);
        if (!boarding) {
          const conditional = this.frontier.conditional.get(stop);
          if (conditional) {
            for (const label of conditional.values()) {
              boarding = this.board(route, index, trip, label);
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

  private boardingBound(key: TripStopId): number {
    return Math.min(
      this.scanned.get(key) ?? Infinity,
      this.queued.get(key) ?? Infinity,
      this.state.tripBoardingBound?.(this.round, key) ?? Infinity,
    );
  }

  private enqueue(boarding: Boarding): void {
    const key = encode(0, boarding.routeId, boarding.tripIndex);
    if (boarding.stopIndex >= this.boardingBound(key)) {
      return;
    }
    this.queued.set(key, boarding.stopIndex);
    this.queue.push(boarding);
  }

  private scanTrip(boarding: Boarding): void {
    const key = encode(0, boarding.routeId, boarding.tripIndex);
    if (
      boarding.stopIndex > this.queued.get(key)! ||
      (this.scanned.get(key) ?? Infinity) <= boarding.stopIndex
    ) {
      return;
    }
    this.scanned.set(key, boarding.stopIndex);
    if (
      this.state.improveTripBoarding &&
      !this.state.improveTripBoarding(this.round, key, boarding.stopIndex)
    ) {
      return;
    }
    const route = this.timetable.getRoute(boarding.routeId)!;
    const connections = this.timetable.getTripConnections(
      route.id,
      boarding.tripIndex,
    );
    for (
      let index = boarding.stopIndex + (boarding.continuationOf ? 0 : 1);
      index < route.getNbStops();
      index++
    ) {
      if (!this.inBounds(route.arrivalAt(index, boarding.tripIndex))) {
        break;
      }
      this.arrive(route, index, boarding, connections?.get(index));
    }
  }

  /** Allocate an immutable edge only if a result, boarding, walk, or connection needs it. */
  private arrive(
    route: Route,
    index: number,
    boarding: Boarding,
    connection?: TripConnections,
  ): void {
    const arrival = route.arrivalAt(index, boarding.tripIndex);
    if (!this.inBounds(arrival)) {
      return;
    }
    const stop = route.stopId(index);
    const canAlight =
      route.dropOffTypeAt(index, boarding.tripIndex) !==
      PickUpDropOffTypes.NOT_AVAILABLE;
    const sourceId = connection
      ? encode(index, route.id, boarding.tripIndex)
      : undefined;
    const newConnection =
      sourceId !== undefined && !this.connectionsSeen.has(sourceId);
    if (newConnection) {
      this.connectionsSeen.add(sourceId);
    }
    const conditional = !!connection?.rules.length;
    const publish = canAlight && arrival < this.state.arrivalTime(stop);
    const ready = arrival + this.options.minTransferTime;
    const retain =
      canAlight && !conditional && this.improveOrdinary(stop, ready, false);
    const walk =
      canAlight && !conditional && this.improveOrdinary(stop, arrival, true);
    if (!publish && !retain && !walk && !newConnection) {
      return;
    }
    const edge: VehicleEdge = {
      routeId: route.id,
      tripIndex: boarding.tripIndex,
      stopIndex: boarding.stopIndex,
      hopOffStopIndex: index,
      arrival,
      previous: boarding.previous,
      ...(boarding.continuationOf && {
        continuationOf: boarding.continuationOf,
      }),
    };
    if (publish) {
      this.publish(stop, edge);
    }
    if (retain) {
      this.addLabel(stop, { edge, ready });
    }
    if (walk) {
      this.walks.set(stop, edge);
    }
    if (newConnection) {
      if (canAlight && conditional) {
        this.next.sources.push(edge);
        if (this.improveConditional(stop, ready, sourceId)) {
          this.addLabel(stop, { edge, ready, source: edge, sourceId });
        }
      }
      for (const continuation of connection!.continuations) {
        const nextRoute = this.timetable.getRoute(continuation.routeId)!;
        const departure = nextRoute.departureFrom(
          continuation.stopIndex,
          continuation.tripIndex,
        );
        if (
          this.allowed(nextRoute) &&
          departure >= arrival &&
          this.inBounds(departure)
        ) {
          this.enqueue({
            ...continuation,
            previous: edge,
            continuationOf: edge,
          });
        }
      }
    }
  }

  private improveOrdinary(stop: StopId, time: Time, walking: boolean): boolean {
    const times = walking ? this.walkArrival : this.ready;
    if (times[stop]! <= time) {
      return false;
    }
    times[stop] = time;
    return (
      this.state.improveOrdinaryLabel?.(this.round, stop, time, walking) ?? true
    );
  }

  private improveConditional(
    stop: StopId,
    time: Time,
    source: TripStopId,
  ): boolean {
    const times = this.conditionalReady.get(source) ?? new Map<StopId, Time>();
    if ((times.get(stop) ?? Infinity) <= time) {
      return false;
    }
    times.set(stop, time);
    this.conditionalReady.set(source, times);
    return true;
  }

  private addLabel(stop: StopId, label: BoardingLabel): void {
    if (label.sourceId === undefined) {
      this.next.ordinary[stop] = label;
    } else {
      const labels =
        this.next.conditional.get(stop) ?? new Map<TripStopId, BoardingLabel>();
      labels.set(label.sourceId, label);
      this.next.conditional.set(stop, labels);
    }
    this.next.stops.add(stop);
  }

  private publish(stop: StopId, edge: RoutingEdge): void {
    this.state.graph[this.round]![stop] = edge;
    this.state.updateArrival(stop, edge.arrival, this.round);
  }

  private considerTransfers(source: VehicleEdge, sourceId?: TripStopId): void {
    const from = this.timetable
      .getRoute(source.routeId)!
      .stopId(source.hopOffStopIndex);
    for (const transfer of this.timetable.getTransfers(from)) {
      const duration =
        transfer.minTransferTime ??
        (transfer.type === TransferTypes.IN_SEAT
          ? 0
          : this.options.minTransferTime);
      const arrival = source.arrival + duration;
      if (!this.inBounds(arrival)) {
        continue;
      }
      const stop = transfer.destination;
      const publish = arrival < this.state.arrivalTime(stop);
      const retain =
        sourceId === undefined
          ? this.improveOrdinary(stop, arrival, false)
          : this.improveConditional(stop, arrival, sourceId);
      if (!publish && !retain) {
        continue;
      }
      const edge: TransferEdge = {
        from,
        to: stop,
        type: transfer.type,
        arrival,
        minTransferTime: duration,
        previous: source,
      };
      if (publish) {
        this.publish(stop, edge);
      }
      if (retain) {
        this.addLabel(stop, {
          edge,
          ready: arrival,
          ...(sourceId !== undefined && { source, sourceId }),
        });
      }
    }
  }
}
