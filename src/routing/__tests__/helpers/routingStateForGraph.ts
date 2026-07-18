import { StopId } from '../../../stops/stops.js';
import { StopRouteIndex } from '../../../timetable/route.js';
import { Duration, Time } from '../../../timetable/time.js';
import {
  TransferId,
  TransferType,
  TripStop,
} from '../../../timetable/timetable.js';
import { AccessPoint } from '../../access.js';
import { CellId, NO_CELL } from '../../graph.js';
import { RoutingState } from '../../state.js';

export type TestOriginEdge = { stopId: StopId; arrival: Time };

export type TestAccessEdge = {
  arrival: Time;
  from: StopId;
  to: StopId;
  duration: Duration;
};

/** A boarded transit trip used to seed typed graph cells in tests. */
export type TestVehicleEdge = TripStop & {
  arrival: Time;
  hopOffStopIndex: StopRouteIndex;
  /** Link to the previous test vehicle edge when modeling an in-seat transfer. */
  continuationOf?: TestVehicleEdge;
  /** Explicit predecessor cell for tests that need deterministic reconstruction. */
  predecessor?: TestRoutingCell;
};

/** A walking or guaranteed connection used to seed typed graph cells in tests. */
export type TestTransferEdge = {
  arrival: Time;
  from: StopId;
  to: StopId;
  type: TransferType;
  minTransferTime?: Duration;
  transferId?: TransferId;
  /** Explicit predecessor cell for tests that need deterministic reconstruction. */
  predecessor?: TestRoutingCell;
};

export type TestRoutingCell = { round: number; stop: StopId };

export type TestRoutingEdge = (
  | TestOriginEdge
  | TestAccessEdge
  | TestVehicleEdge
  | TestTransferEdge
) & {
  /** Explicit predecessor cell for tests that need deterministic reconstruction. */
  predecessor?: TestRoutingCell;
};

export type RoutingGraphFixture = {
  nbStops: number;
  origins?: StopId[];
  destinations?: StopId[];
  arrivals?: [stop: StopId, time: Time, leg: number][];
  graph?: [stop: StopId, edge: TestRoutingEdge][][];
};

export type RoutingStateFixture = {
  departureTime?: Time;
  destinations?: StopId[];
  accessPaths?: AccessPoint[];
  nbStops?: number;
  maxRounds?: number;
  maxDuration?: Duration;
};

export function routingState({
  departureTime = 0,
  destinations = [],
  accessPaths = [],
  nbStops = 4,
  maxRounds = 3,
  maxDuration,
}: RoutingStateFixture = {}): RoutingState {
  return new RoutingState(
    departureTime,
    destinations,
    accessPaths,
    nbStops,
    maxRounds,
    maxDuration,
  );
}

/**
 * Builds a RoutingState for tests from a compact, graph-oriented fixture.
 *
 * Prefer the semantic helpers on {@link routingRun} for new route-reconstruction
 * tests. This function exists for sparse graph fixtures and low-level state
 * tests that need direct control over arrivals and graph cells.
 */
export function routingStateForGraph({
  nbStops,
  origins = [],
  destinations = [],
  arrivals = [],
  graph = [],
}: RoutingGraphFixture): RoutingState {
  const state = new RoutingState(
    0,
    destinations,
    [],
    nbStops,
    Math.max(0, graph.length - 1),
    undefined,
  );

  state.origins = [...origins];

  for (const [stop, time, leg] of arrivals) {
    state.updateArrival(stop, time, leg);
  }

  const knownVehicleCells = new WeakMap<TestVehicleEdge, CellId>();
  for (let round = 0; round < graph.length; round++) {
    const roundEdges = graph[round];
    if (roundEdges === undefined) continue;
    for (const [stop, edge] of roundEdges) {
      setRoutingEdge(state, round, stop, edge, knownVehicleCells);
    }
  }

  return state;
}

export function routingRun(params: {
  nbStops: number;
  destinations?: StopId[];
}): RoutingRunBuilder {
  return new RoutingRunBuilder(params.nbStops, params.destinations ?? []);
}

export class RoutingRunBuilder {
  private readonly origins: StopId[] = [];
  private readonly arrivals = new Map<StopId, { time: Time; leg: number }>();
  private readonly graph: [stop: StopId, edge: TestRoutingEdge][][] = [];

  constructor(
    private readonly nbStops: number,
    private readonly destinations: StopId[] = [],
  ) {}

  origin(stop: StopId, arrival: Time, sourceStop: StopId = stop): this {
    this.origins.push(stop);
    this.setArrival(stop, arrival, 0);
    this.addEdge(0, stop, { stopId: sourceStop, arrival });
    return this;
  }

  destination(stop: StopId): this {
    this.destinations.push(stop);
    return this;
  }

  reached(stop: StopId, arrival: Time, leg: number): this {
    this.setArrival(stop, arrival, leg);
    return this;
  }

  ride(params: {
    round: number;
    to: StopId;
    arrival: Time;
    routeId: number;
    tripIndex: number;
    boardStopIndex: StopRouteIndex;
    hopOffStopIndex: StopRouteIndex;
    predecessor?: TestRoutingCell;
  }): TestVehicleEdge {
    const edge: TestVehicleEdge = {
      arrival: params.arrival,
      routeId: params.routeId,
      tripIndex: params.tripIndex,
      stopIndex: params.boardStopIndex,
      hopOffStopIndex: params.hopOffStopIndex,
      predecessor: params.predecessor,
    };
    this.setArrival(params.to, params.arrival, params.round);
    this.addEdge(params.round, params.to, edge);
    return edge;
  }

  continueRide(params: {
    round: number;
    to: StopId;
    arrival: Time;
    routeId: number;
    tripIndex: number;
    boardStopIndex: StopRouteIndex;
    hopOffStopIndex: StopRouteIndex;
    continuationOf: TestVehicleEdge;
  }): TestVehicleEdge {
    const edge: TestVehicleEdge = {
      arrival: params.arrival,
      routeId: params.routeId,
      tripIndex: params.tripIndex,
      stopIndex: params.boardStopIndex,
      hopOffStopIndex: params.hopOffStopIndex,
      continuationOf: params.continuationOf,
    };
    this.setArrival(params.to, params.arrival, params.round);
    this.addEdge(params.round, params.to, edge);
    return edge;
  }

  transfer(params: {
    round: number;
    from: StopId;
    to: StopId;
    arrival: Time;
    type: TransferType;
    transferId: TransferId;
    minTransferTime?: Duration;
    predecessor?: TestRoutingCell;
  }): TestTransferEdge {
    const edge: TestTransferEdge = {
      arrival: params.arrival,
      from: params.from,
      to: params.to,
      type: params.type,
      transferId: params.transferId,
      minTransferTime: params.minTransferTime,
      predecessor: params.predecessor,
    };
    this.setArrival(params.to, params.arrival, params.round);
    this.addEdge(params.round, params.to, edge);
    return edge;
  }

  overrideArrival(stop: StopId, arrival: Time, leg: number): this {
    this.setArrival(stop, arrival, leg);
    return this;
  }

  buildState(): RoutingState {
    return routingStateForGraph({
      nbStops: this.nbStops,
      origins: this.origins,
      destinations: this.destinations,
      arrivals: Array.from(this.arrivals, ([stop, { time, leg }]) => [
        stop,
        time,
        leg,
      ]),
      graph: this.graph,
    });
  }

  private setArrival(stop: StopId, time: Time, leg: number): void {
    this.arrivals.set(stop, { time, leg });
  }

  private addEdge(round: number, stop: StopId, edge: TestRoutingEdge): void {
    while (this.graph.length <= round) this.graph.push([]);
    let roundEdges = this.graph[round];
    if (roundEdges === undefined) {
      roundEdges = [];
      this.graph[round] = roundEdges;
    }
    roundEdges.push([stop, edge]);
  }
}

function setRoutingEdge(
  state: RoutingState,
  round: number,
  stop: StopId,
  edge: TestRoutingEdge,
  knownVehicleCells: WeakMap<TestVehicleEdge, CellId>,
): void {
  if ('routeId' in edge) {
    const previousCell = edge.continuationOf
      ? (knownVehicleCells.get(edge.continuationOf) ?? NO_CELL)
      : (testPredecessorCell(state, edge) ??
        inferTestVehiclePredecessorCell(state, round));
    if (edge.continuationOf) {
      state.graph.setVehicleContinuation(
        round,
        stop,
        edge.arrival,
        edge.routeId,
        edge.stopIndex,
        edge.tripIndex,
        edge.hopOffStopIndex,
        previousCell,
      );
    } else {
      state.graph.setVehicle(
        round,
        stop,
        edge.arrival,
        edge.routeId,
        edge.stopIndex,
        edge.tripIndex,
        edge.hopOffStopIndex,
        previousCell,
      );
    }
    knownVehicleCells.set(edge, state.graph.cell(round, stop));
    return;
  }

  if ('type' in edge) {
    if (edge.transferId === undefined) {
      throw new Error('Transfer test edges must include transferId.');
    }
    const previousCell =
      testPredecessorCell(state, edge) ??
      testPredecessorForTransfer(state, round, edge);
    state.graph.setTransfer(
      round,
      stop,
      edge.arrival,
      edge.transferId,
      previousCell,
    );
    return;
  }

  if ('duration' in edge) {
    state.graph.setAccess(stop, edge.arrival, edge.from, edge.duration);
    return;
  }

  state.graph.setOrigin(stop, edge.arrival, edge.stopId);
}

function testPredecessorCell(
  state: RoutingState,
  edge: TestRoutingEdge,
): CellId | undefined {
  if (edge.predecessor === undefined) return undefined;
  return state.graph.cell(edge.predecessor.round, edge.predecessor.stop);
}

function inferTestVehiclePredecessorCell(
  state: RoutingState,
  round: number,
): CellId {
  if (round <= 0) return NO_CELL;

  let onlyPreviousCell = NO_CELL;
  let previousCellCount = 0;
  let onlyTransferCell = NO_CELL;
  let transferCellCount = 0;

  for (const cell of state.graph.occupiedCells()) {
    if (state.graph.roundOfCell(cell) !== round - 1) continue;
    onlyPreviousCell = cell;
    previousCellCount++;
    if (state.graph.isTransferCell(cell)) {
      onlyTransferCell = cell;
      transferCellCount++;
    }
  }

  if (transferCellCount === 1) return onlyTransferCell;
  return previousCellCount === 1 ? onlyPreviousCell : NO_CELL;
}

function testPredecessorForTransfer(
  state: RoutingState,
  round: number,
  edge: TestTransferEdge,
): CellId {
  const candidate = state.graph.cell(round, edge.from);
  return state.graph.hasCell(candidate) ? candidate : NO_CELL;
}
