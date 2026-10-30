/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { PickUpDropOffTypes, Route } from '../timetable/route.js';
import { Time } from '../timetable/time.js';
import { Timetable, TransferTypes } from '../timetable/timetable.js';
import { TripRule } from '../timetable/tripTransfers.js';
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
  improvementBound(round: number, stop: StopId): Time;

  /**
   * Best known arrival time at any destination.
   */
  readonly destinationBest: Time;

  /** Bound that is safe for every requested destination, not just the fastest. */
  destinationPruningBound?(round: number): Time;

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

  /** Optional range-only bounds; never use an ordinary stop label for these. */
  boardingBound?(round: number, stop: StopId, context: number): number;
  updateBoardingBound?(
    round: number,
    stop: StopId,
    context: number,
    time: number,
  ): void;
  tripBoardingBound?(round: number, trip: number): number;
  updateTripBoardingBound?(
    round: number,
    trip: number,
    stopIndex: number,
  ): void;
}

/** A boarding context retains its feeder until the next vehicle is boarded. */
type Boarding = {
  ready: Time;
  edge: RoutingEdge;
  source?: VehicleEdge;
  occurrence?: number;
};
const NO_RULES: TripRule[] = [];

type Frontier = Map<StopId, Map<number, Boarding>>;
type BoardedTrip = {
  route: Route;
  trip: number;
  stop: number;
  predecessor: RoutingEdge;
  continuation?: VehicleEdge;
  scanEnd?: number;
  scanEntry?: boolean;
};

/**
 * RAPTOR with one active ordinary trip and explicit scans of exception-bearing
 * trips. Stop arrival bounds never stand in for trip-dependent boarding rights.
 */
export class Raptor {
  /** Counters for reproducible benchmarks; reset for each departure run. */
  readonly statistics = {
    scannedTripStops: 0,
    retainedContexts: 0,
    exceptionalBoardings: 0,
  };
  private readonly ordinaryArrivalWorkspace: Uint16Array;
  private readonly boardingWorkspace: Uint16Array;

  constructor(private readonly timetable: Timetable) {
    this.ordinaryArrivalWorkspace = new Uint16Array(timetable.nbStops());
    this.boardingWorkspace = new Uint16Array(timetable.nbStops());
  }

  run(options: QueryOptions, state: IRaptorState): void {
    this.statistics.scannedTripStops = 0;
    this.statistics.retainedContexts = 0;
    this.statistics.exceptionalBoardings = 0;
    const index = this.timetable.tripTransfers;
    const ordinaryArrivals = this.ordinaryArrivalWorkspace.fill(0xffff);
    let frontier: Frontier = new Map();
    // At-most-round dominance is valid only within the same boarding context.
    const boardingBounds = new Map<StopId, Map<number, number>>();
    const defaultBoardingBounds = this.boardingWorkspace.fill(0xffff);
    const covered = new Map<number, number>();
    const continuationEntries = new Map<number, number>();
    const allowed = (route: Route) =>
      options.transportModes.has(
        this.timetable.getServiceRouteInfo(route).type,
      );
    for (const stop of state.origins) {
      const edge = state.graph[0]![stop];
      if (edge)
        frontier.set(stop, new Map([[0, { ready: edge.arrival, edge }]]));
    }

    for (
      let round = 1;
      round <= options.maxTransfers + 1 && frontier.size;
      round++
    ) {
      state.initRound(round);
      const next: Frontier = new Map();
      let destinationBound = state.destinationPruningBound?.(round) ?? Infinity;
      const queue: BoardedTrip[] = [];
      const recordArrival = (stop: StopId, edge: RoutingEdge) => {
        if (
          edge.arrival <= state.maxArrivalTime &&
          edge.arrival < state.improvementBound(round, stop)
        ) {
          state.graph[round]![stop] = edge;
          state.updateArrival(stop, edge.arrival, round);
          if (state.isDestination(stop))
            destinationBound =
              state.destinationPruningBound?.(round) ?? Infinity;
        }
      };
      const addBoarding = (
        stop: StopId,
        context: number,
        boarding: Boarding,
      ) => {
        const time = context === 0 ? boarding.ready : boarding.source!.arrival;
        if (time > state.maxArrivalTime || time >= destinationBound) return;
        const shared = state.boardingBound?.(round, stop, context) ?? Infinity;
        if (context === 0) {
          if (time >= Math.min(defaultBoardingBounds[stop]!, shared)) return;
          defaultBoardingBounds[stop] = time;
        } else {
          let bounds = boardingBounds.get(stop);
          if (!bounds)
            boardingBounds.set(stop, (bounds = new Map<number, number>()));
          if (time >= Math.min(bounds.get(context) ?? Infinity, shared)) return;
          bounds.set(context, time);
        }
        state.updateBoardingBound?.(round, stop, context, time);
        let labels = next.get(stop);
        if (!labels) next.set(stop, (labels = new Map<number, Boarding>()));
        labels.set(context, boarding);
        this.statistics.retainedContexts++;
      };
      const enqueue = (boarding: BoardedTrip) => {
        if (!allowed(boarding.route)) return;
        const id = index.tripId(boarding.route.id, boarding.trip);
        const previous = Math.min(
          covered.get(id) ?? boarding.route.getNbStops(),
          state.tripBoardingBound?.(round, id) ?? Infinity,
        );
        let scanEntry = false;
        if (boarding.continuation) {
          const occurrence = index.occurrence({
            routeId: boarding.route.id,
            tripIndex: boarding.trip,
            stopIndex: boarding.stop,
          });
          const arrival = Math.max(
            boarding.continuation.arrival,
            boarding.route.arrivalAt(boarding.stop, boarding.trip),
          );
          scanEntry =
            arrival < (continuationEntries.get(occurrence) ?? Infinity);
          if (scanEntry) continuationEntries.set(occurrence, arrival);
        }
        // Suffix coverage is independent of the feeder's entry arrival time.
        const firstArrival = boarding.stop + 1;
        if (firstArrival >= previous && !scanEntry) return;
        if (firstArrival < previous) {
          covered.set(id, firstArrival);
          state.updateTripBoardingBound?.(round, id, firstArrival);
        }
        queue.push({
          ...boarding,
          scanEntry,
          scanEnd: firstArrival < previous ? previous : firstArrival,
        });
        this.statistics.exceptionalBoardings++;
      };
      const arrive = (boarded: BoardedTrip, stopIndex: number) => {
        const { route, trip } = boarded;
        this.statistics.scannedTripStops++;
        const arrival = Math.max(
          route.arrivalAt(stopIndex, trip),
          stopIndex === boarded.stop ? (boarded.continuation?.arrival ?? 0) : 0,
        );
        if (arrival > state.maxArrivalTime || arrival >= destinationBound)
          return;
        const occurrence = index.occurrence({
          routeId: route.id,
          tripIndex: trip,
          stopIndex,
        });
        const rules = index.isExceptional(route.id, trip)
          ? [...index.outgoing(occurrence)]
          : NO_RULES;
        const stop = route.stopId(stopIndex);
        const canAlight =
          route.dropOffTypeAt(stopIndex, trip) !==
          PickUpDropOffTypes.NOT_AVAILABLE;
        if (rules.length === 0) {
          if (!canAlight || arrival >= ordinaryArrivals[stop]!) return;
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
          if (rule.type !== TransferTypes.IN_SEAT) continue;
          const target = index.position(rule.target);
          const targetRoute = this.timetable.getRoute(target.routeId)!;
          if (
            targetRoute.departureFrom(target.stopIndex, target.tripIndex) <
            arrival
          )
            continue;
          enqueue({
            route: targetRoute,
            trip: target.tripIndex,
            stop: target.stopIndex,
            predecessor: edge,
            continuation: edge,
          });
        }
        if (!canAlight) return;
        if (!rules.some((rule) => rule.type !== TransferTypes.IN_SEAT)) {
          if (arrival >= ordinaryArrivals[stop]!) return;
          ordinaryArrivals[stop] = arrival;
        }
        recordArrival(stop, edge);
        const destinations = new Map<
          number,
          { ready: number; edge: RoutingEdge }
        >();
        destinations.set(stop, {
          ready: arrival + options.minTransferTime,
          edge,
        });
        for (const transfer of this.timetable.getTransfers(stop)) {
          const duration =
            transfer.minTransferTime ??
            (transfer.type === TransferTypes.GUARANTEED ||
            transfer.type === TransferTypes.IN_SEAT
              ? 0
              : options.minTransferTime);
          const ready = arrival + duration;
          const walk = {
            arrival: ready,
            from: stop,
            to: transfer.destination,
            type: transfer.type,
            minTransferTime: duration,
            predecessor: edge,
          };
          if (transfer.destination !== stop)
            recordArrival(transfer.destination, walk);
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
        const sensitive = new Set<number>();
        for (const rule of rules) {
          if (rule.type === TransferTypes.IN_SEAT) continue;
          const target = index.position(rule.target);
          const destination = this.timetable
            .getRoute(target.routeId)!
            .stopId(target.stopIndex);
          sensitive.add(destination);
          // A specific rule can establish a connection without a generic footpath.
          if (!destinations.has(destination))
            destinations.set(destination, { ready: Infinity, edge });
        }
        for (const [destination, boarding] of destinations) {
          addBoarding(
            destination,
            sensitive.has(destination) ? occurrence + 1 : 0,
            {
              ...boarding,
              ...(sensitive.has(destination) && { source: edge, occurrence }),
            },
          );
        }
      };
      const board = (
        label: Boarding,
        route: Route,
        stop: number,
        trip: number,
      ): BoardedTrip | undefined => {
        if (
          route.pickUpTypeFrom(stop, trip) === PickUpDropOffTypes.NOT_AVAILABLE
        )
          return undefined;
        const departure = route.departureFrom(stop, trip);
        const rule =
          label.occurrence === undefined
            ? undefined
            : index.transfer(
                label.occurrence,
                index.occurrence({
                  routeId: route.id,
                  tripIndex: trip,
                  stopIndex: stop,
                }),
              );
        const ready = rule
          ? label.source!.arrival +
            (rule.type === TransferTypes.GUARANTEED
              ? 0
              : (rule.minTransferTime ?? options.minTransferTime))
          : label.ready;
        if (
          departure < ready ||
          departure > state.maxArrivalTime ||
          departure >= destinationBound ||
          (round === 1 &&
            options.maxInitialWaitingTime !== undefined &&
            departure - label.edge.arrival > options.maxInitialWaitingTime)
        )
          return undefined;
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
      };

      const routes = this.timetable.findReachableRoutes(
        new Set(frontier.keys()),
        options.transportModes,
      );
      for (const [route, firstStop] of routes) {
        const exceptions = index.exceptionalTrips[route.id]!;

        let active: BoardedTrip | undefined;
        for (let stop = firstStop; stop < route.getNbStops(); stop++) {
          if (active) arrive(active, stop);
          for (const label of frontier.get(route.stopId(stop))?.values() ??
            []) {
            // A specific minimum can be shorter than the generic walking time.
            const earliest = route.findEarliestTrip(
              stop,
              label.source?.arrival ?? label.ready,
            );
            if (earliest === undefined) continue;
            for (const trip of exceptions) {
              if (trip < earliest) continue;
              const id = index.tripId(route.id, trip);
              if (
                stop + 1 >=
                Math.min(
                  covered.get(id) ?? Infinity,
                  state.tripBoardingBound?.(round, id) ?? Infinity,
                )
              )
                continue;
              const boarding = board(label, route, stop, trip);
              if (boarding) enqueue(boarding);
            }
            for (
              let trip = earliest;
              trip < (active?.trip ?? route.getNbTrips());
              trip++
            ) {
              if (index.isExceptional(route.id, trip)) continue;
              const boarding = board(label, route, stop, trip);
              if (boarding) {
                active = boarding;
                break;
              }
            }
          }
        }
      }
      for (let q = 0; q < queue.length; q++) {
        const boarding = queue[q]!;
        // The entry occurrence matters for an in-seat continuation, including
        // another continuation at the same occurrence. Ordinary boarding cannot alight there.
        for (
          let stop = boarding.stop + (boarding.scanEntry ? 0 : 1);
          stop < (boarding.scanEnd ?? boarding.route.getNbStops());
          stop++
        )
          arrive(boarding, stop);
      }
      frontier = next;
    }
  }
}
