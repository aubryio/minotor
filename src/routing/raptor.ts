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
import {
  encode,
  TripKey,
  tripKey,
  TripStopId,
} from '../timetable/tripStopId.js';
import { type BoardingLabel, Frontier } from './frontier.js';
import { QueryOptions } from './query.js';
import type { IRaptorState } from './raptorState.js';
import {
  RoutingEdge,
  TransferEdge,
  UNREACHED_TIME,
  VehicleEdge,
} from './state.js';

type Boarding = TripStop & {
  previous: RoutingEdge;
  continuationOf?: VehicleEdge;
};

type RunBuffers = { ready: Uint16Array; walkArrival: Uint16Array };

/** One engine for plain and Range RAPTOR, with sparse fixed-trip scans. */
export class Raptor {
  // Numeric buffers may be reused; reconstructed paths never reference them.
  private buffers?: RunBuffers;

  constructor(private readonly timetable: Timetable) {}

  /** Options and state already contain normalized integer minutes. */
  run(options: QueryOptions, state: IRaptorState): void {
    const nbStops = state.graph[0]!.length;
    const buffers =
      this.buffers?.ready.length === nbStops
        ? this.buffers
        : {
            ready: new Uint16Array(nbStops),
            walkArrival: new Uint16Array(nbStops),
          };
    // Lease the buffers so even a reentrant call gets independent working state.
    this.buffers = undefined;
    buffers.ready.fill(UNREACHED_TIME);
    buffers.walkArrival.fill(UNREACHED_TIME);
    try {
      new RaptorRun(this.timetable, options, state, buffers).run();
    } finally {
      this.buffers = buffers;
    }
  }
}

/**
 * Algorithm 1: collect marked routes, scan trips, then relax footpaths.
 * Frontiers hold only improvements; persistent bounds avoid copying tau[k - 1]
 * into tau[k]. The graph stores reconstruction edges, not a full label table.
 * @see https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
class RaptorRun {
  private frontier: Frontier;
  private nextFrontier: Frontier;
  // Boarding-ready times and vehicle arrivals eligible to start a footpath differ.
  private readonly boardingReadyTimes: Uint16Array;
  private readonly walkArrival: Uint16Array;
  private readonly conditionalReady = new Map<TripStopId, Map<StopId, Time>>();
  private readonly connectionsSeen = new Set<TripStopId>();
  private readonly walks = new Map<StopId, VehicleEdge>();
  private readonly scannedBoardingPositions = new Map<
    TripKey,
    StopRouteIndex
  >();
  private readonly queuedBoardingPositions = new Map<TripKey, StopRouteIndex>();
  private readonly tripQueue: Boarding[] = [];
  private round = 0;

  constructor(
    private readonly timetable: Timetable,
    private readonly options: QueryOptions,
    private readonly state: IRaptorState,
    buffers: RunBuffers,
  ) {
    const nbStops = state.graph[0]!.length;
    this.frontier = new Frontier(nbStops);
    this.nextFrontier = new Frontier(nbStops);
    this.boardingReadyTimes = buffers.ready;
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
    // Round k adds a boarding; access is round 0 and in-seat continuations stay in k.
    for (
      this.round = 1;
      this.round <= this.options.maxTransfers + 1 && this.frontier.stops.size;
      this.round++
    ) {
      // Algorithm 1’s Q: each marked route starts at its earliest marked stop.
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
          sourceId: encode(from.stopIndex, from.routeId, from.tripIndex),
        };
        for (const rule of this.timetable.getTripTransferRules(from)) {
          const route = this.timetable.getRoute(rule.routeId)!;
          if (
            !this.allowed(route) ||
            rule.stopIndex >=
              this.boardingBound(tripKey(rule.routeId, rule.tripIndex))
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
      // Scanning may append in-seat continuations, consumed within this same round.
      for (let i = 0; i < this.tripQueue.length; i++) {
        this.scanTrip(this.tripQueue[i]!);
      }
      // Footpath phase: only vehicle arrivals start walks; walked labels cannot chain them.
      for (const edge of this.walks.values()) {
        this.considerTransfers(edge);
      }
      for (const edge of this.nextFrontier.sources) {
        this.considerTransfers(
          edge,
          encode(edge.hopOffStopIndex, edge.routeId, edge.tripIndex),
        );
      }
      this.frontier.clear();
      [this.frontier, this.nextFrontier] = [this.nextFrontier, this.frontier];
      this.walks.clear();
      this.queuedBoardingPositions.clear();
      this.tripQueue.length = 0;
    }
  }

  private allowed(route: Route): boolean {
    return this.options.transportModes.has(
      this.timetable.getServiceRouteType(route),
    );
  }

  /** Target pruning (tau*(target)), plus the query’s arrival deadline. */
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

  /** Algorithm 1’s route scan: active is t, replaced when an earlier trip is catchable. */
  private scanRoute(route: Route, start: number): void {
    let active: Boarding | undefined;
    const special = this.timetable.getSpecialTrips(route.id);
    if (special.length === route.getNbTrips()) {
      return;
    }
    for (let index = start; index < route.getNbStops(); index++) {
      if (active) {
        const arrival = route.arrivalAt(index, active.tripIndex);
        if (this.inBounds(arrival)) {
          this.arrive(route, index, active, arrival);
        }
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
    // A trip-pair rule may permit boarding before the ordinary transfer-ready time.
    const after = label.source?.arrival ?? label.ready;
    if (active && after > route.departureFrom(index, active.tripIndex)) {
      return undefined;
    }
    const first = route.findEarliestTrip(index, after, active?.tripIndex);
    if (first === undefined) {
      return undefined;
    }
    let specialIndex = 0;
    let specialEnd = special.length;
    while (specialIndex < specialEnd) {
      const middle = (specialIndex + specialEnd) >>> 1;
      if (special[middle]! < first) {
        specialIndex = middle + 1;
      } else {
        specialEnd = middle;
      }
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

  /**
   * Trips with onward rules or continuations cannot be discarded in favor of an
   * earlier ordinary trip; discover each separately at its first useful boarding.
   */
  private findSpecialBoardings(route: Route, start: number): void {
    for (const trip of this.timetable.getSpecialTrips(route.id)) {
      if (!this.inBounds(route.departureFrom(start, trip))) {
        break;
      }
      const bound = Math.min(
        route.getNbStops(),
        this.boardingBound(tripKey(route.id, trip)),
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

  /** Boarding the same trip earlier covers its suffix; stop index 0 in key identifies the trip. */
  private boardingBound(key: TripKey): number {
    return Math.min(
      this.scannedBoardingPositions.get(key) ?? Infinity,
      this.queuedBoardingPositions.get(key) ?? Infinity,
      this.state.tripBoardingBound?.(this.round, key) ?? Infinity,
    );
  }

  private enqueue(boarding: Boarding): void {
    const key = tripKey(boarding.routeId, boarding.tripIndex);
    if (boarding.stopIndex >= this.boardingBound(key)) {
      return;
    }
    this.queuedBoardingPositions.set(key, boarding.stopIndex);
    this.tripQueue.push(boarding);
  }

  private scanTrip(boarding: Boarding): void {
    const key = tripKey(boarding.routeId, boarding.tripIndex);
    if (
      boarding.stopIndex > this.queuedBoardingPositions.get(key)! ||
      (this.scannedBoardingPositions.get(key) ?? Infinity) <= boarding.stopIndex
    ) {
      return;
    }
    this.scannedBoardingPositions.set(key, boarding.stopIndex);
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
      const arrival = route.arrivalAt(index, boarding.tripIndex);
      if (!this.inBounds(arrival)) {
        break;
      }
      this.arrive(route, index, boarding, arrival, connections?.get(index));
    }
  }

  /** Allocate an immutable edge only if a result, boarding, walk, or connection needs it. */
  private arrive(
    route: Route,
    index: number,
    boarding: Boarding,
    arrival: Time,
    connection?: TripConnections,
  ): void {
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
    // A dominated stop arrival may still offer a new boarding, walk, or trip connection.
    const publish = canAlight && arrival < this.state.arrivalTime(stop);
    const ready = arrival + this.options.minTransferTime;
    const retain =
      canAlight && !conditional && this.improveOrdinary(stop, ready, false);
    const walk =
      canAlight && !conditional && this.improveOrdinary(stop, arrival, true);
    if (!publish && !retain && !walk && !newConnection) {
      return;
    }
    // Keep the actual predecessor: later aggregate improvements must not rewrite this path.
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
        this.nextFrontier.sources.push(edge);
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
    const times = walking ? this.walkArrival : this.boardingReadyTimes;
    if (time >= UNREACHED_TIME || times[stop]! <= time) {
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
      this.nextFrontier.ordinary[stop] = label;
    } else {
      const labels =
        this.nextFrontier.conditional.get(stop) ??
        new Map<TripStopId, BoardingLabel>();
      labels.set(label.sourceId, label);
      this.nextFrontier.conditional.set(stop, labels);
    }
    this.nextFrontier.stops.add(stop);
  }

  private publish(stop: StopId, edge: RoutingEdge): void {
    this.state.publishArrival(stop, edge, this.round);
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
        this.addLabel(
          stop,
          sourceId === undefined
            ? { edge, ready: arrival }
            : { edge, ready: arrival, source, sourceId },
        );
      }
    }
  }
}
