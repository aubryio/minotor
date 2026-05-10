/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { StopRouteIndex, TripRouteIndex } from '../timetable/route.js';
import { Duration, Time } from '../timetable/time.js';
import { TransferId, TripStop } from '../timetable/timetable.js';

/**
 * Sentinel value used in arrival-time arrays to mark stops not yet reached.
 * 0xFFFF = 65 535 minutes ≈ 45.5 days, safely beyond realistic transit times.
 */
export const UNREACHED_TIME: Time = 0xffff;

export type CellId = number;

export const NO_CELL: CellId = 0xffffffff;

export const EdgeKinds = {
  NONE: 0,
  ORIGIN: 1,
  ACCESS: 2,
  VEHICLE: 3,
  VEHICLE_CONTINUATION: 4,
  TRANSFER: 5,
} as const;

export type EdgeKind = (typeof EdgeKinds)[keyof typeof EdgeKinds];

export function isVehicleEdgeKind(kind: number): boolean {
  return kind === EdgeKinds.VEHICLE || kind === EdgeKinds.VEHICLE_CONTINUATION;
}

/**
 * Dense, flattened, typed-array representation of the per-round RAPTOR state graph.
 *
 * The graph is indexed as `cell = round * nbStops + stopId`.  Only `kind` and
 * `arrival` need to be cleared; payload arrays may keep stale values because
 * they are ignored when `kind[cell] === EdgeKinds.NONE`.
 */
export class DenseRoutingGraph {
  readonly nbStops: number;
  readonly roundCount: number;

  private readonly kind: Uint8Array;
  private readonly arrival: Uint16Array;
  private readonly prevCell: Uint32Array;

  private readonly id: Uint32Array;
  private readonly hopOnStopIndex: Uint16Array;
  private readonly tripIndex: Uint16Array;
  private readonly hopOffStopIndex: Uint16Array;

  private readonly originStop: Uint32Array;
  private readonly accessFrom: Uint32Array;
  private readonly accessDuration: Uint16Array;

  private readonly touchedCells: CellId[] = [];
  private readonly touchedCellMask: Uint8Array;

  constructor(nbStops: number, maxRound: number) {
    this.nbStops = nbStops;
    this.roundCount = maxRound + 1;
    const cellCount = this.nbStops * this.roundCount;

    this.kind = new Uint8Array(cellCount);
    this.arrival = new Uint16Array(cellCount).fill(UNREACHED_TIME);
    this.prevCell = new Uint32Array(cellCount);
    this.id = new Uint32Array(cellCount);
    this.hopOnStopIndex = new Uint16Array(cellCount);
    this.tripIndex = new Uint16Array(cellCount);
    this.hopOffStopIndex = new Uint16Array(cellCount);
    this.originStop = new Uint32Array(this.nbStops);
    this.accessFrom = new Uint32Array(this.nbStops);
    this.accessDuration = new Uint16Array(this.nbStops);
    this.touchedCellMask = new Uint8Array(cellCount);
  }

  get length(): number {
    return this.roundCount;
  }

  get cellCount(): number {
    return this.kind.length;
  }

  cell(round: number, stop: StopId): CellId {
    return round * this.nbStops + stop;
  }

  roundOffset(round: number): CellId {
    return round * this.nbStops;
  }

  roundOfCell(cell: CellId): number {
    return Math.floor(cell / this.nbStops);
  }

  stopOfCell(cell: CellId): StopId {
    return cell % this.nbStops;
  }

  hasCell(cell: CellId): boolean {
    return (
      cell >= 0 && cell < this.kind.length && this.kind[cell] !== EdgeKinds.NONE
    );
  }

  hasCellUnchecked(cell: CellId): boolean {
    return this.kind[cell] !== EdgeKinds.NONE;
  }

  hasEdge(round: number, stop: StopId): boolean {
    return this.hasCell(this.cell(round, stop));
  }

  kindAtCell(cell: CellId): EdgeKind {
    return (this.kind[cell] ?? EdgeKinds.NONE) as EdgeKind;
  }

  kindAtCellUnchecked(cell: CellId): EdgeKind {
    return this.kind[cell] as EdgeKind;
  }

  kindAt(round: number, stop: StopId): EdgeKind {
    return this.kindAtCell(this.cell(round, stop));
  }

  *occupiedCells(): Generator<CellId> {
    for (let i = 0; i < this.touchedCells.length; i++) {
      const cell = this.touchedCells[i]!;
      if (this.kind[cell] !== EdgeKinds.NONE) yield cell;
    }
  }

  arrivalAtCell(cell: CellId): Time {
    return this.arrival[cell]!;
  }

  arrivalAt(round: number, stop: StopId): Time {
    return this.arrivalAtCell(this.cell(round, stop));
  }

  predecessorCell(cell: CellId): CellId {
    return this.prevCell[cell]!;
  }

  isVehicleCell(cell: CellId): boolean {
    const kind = this.kind[cell]!;
    return (
      kind === EdgeKinds.VEHICLE || kind === EdgeKinds.VEHICLE_CONTINUATION
    );
  }

  isVehicleContinuationCell(cell: CellId): boolean {
    return this.kind[cell]! === EdgeKinds.VEHICLE_CONTINUATION;
  }

  isTransferCell(cell: CellId): boolean {
    return this.kind[cell]! === EdgeKinds.TRANSFER;
  }

  setOrigin(stop: StopId, arrival: Time, originStop: StopId = stop): void {
    const cell = this.cell(0, stop);
    this.writeCommon(cell, EdgeKinds.ORIGIN, arrival, NO_CELL);
    this.originStop[stop] = originStop;
  }

  setAccess(
    toStop: StopId,
    arrival: Time,
    fromStop: StopId,
    duration: Duration,
  ): void {
    const cell = this.cell(0, toStop);
    this.writeCommon(cell, EdgeKinds.ACCESS, arrival, NO_CELL);
    this.accessFrom[toStop] = fromStop;
    this.accessDuration[toStop] = duration;
  }

  setVehicle(
    round: number,
    toStop: StopId,
    arrival: Time,
    routeId: number,
    boardStopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
    hopOffStopIndex: StopRouteIndex,
    prevCell: CellId,
  ): void {
    const cell = this.cell(round, toStop);
    this.writeVehicle(
      cell,
      EdgeKinds.VEHICLE,
      arrival,
      routeId,
      boardStopIndex,
      tripIndex,
      hopOffStopIndex,
      prevCell,
    );
  }

  setVehicleContinuation(
    round: number,
    toStop: StopId,
    arrival: Time,
    routeId: number,
    boardStopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
    hopOffStopIndex: StopRouteIndex,
    previousVehicleCell: CellId,
  ): void {
    const cell = this.cell(round, toStop);
    this.writeVehicle(
      cell,
      EdgeKinds.VEHICLE_CONTINUATION,
      arrival,
      routeId,
      boardStopIndex,
      tripIndex,
      hopOffStopIndex,
      previousVehicleCell,
    );
  }

  setTransfer(
    round: number,
    toStop: StopId,
    arrival: Time,
    transferId: TransferId,
    prevCell: CellId,
  ): void {
    const cell = this.cell(round, toStop);
    this.writeCommon(cell, EdgeKinds.TRANSFER, arrival, prevCell);
    this.id[cell] = transferId;
  }

  clearTouched(): void {
    for (let i = 0; i < this.touchedCells.length; i++) {
      const cell = this.touchedCells[i]!;
      this.kind[cell] = EdgeKinds.NONE;
      this.arrival[cell] = UNREACHED_TIME;
      this.touchedCellMask[cell] = 0;
    }
    this.touchedCells.length = 0;
  }

  clearAll(): void {
    this.kind.fill(EdgeKinds.NONE);
    this.arrival.fill(UNREACHED_TIME);
    this.touchedCellMask.fill(0);
    this.touchedCells.length = 0;
  }

  originStopAtCell(cell: CellId): StopId | undefined {
    if (this.kind[cell] !== EdgeKinds.ORIGIN) return undefined;
    return this.originStop[this.stopOfCell(cell)] as StopId;
  }

  accessAtCell(cell: CellId): { from: StopId; duration: Duration } | undefined {
    if (this.kind[cell] !== EdgeKinds.ACCESS) return undefined;
    const stop = this.stopOfCell(cell);
    return {
      from: this.accessFrom[stop] as StopId,
      duration: this.accessDuration[stop] as Duration,
    };
  }

  transferIdAtCell(cell: CellId): TransferId | undefined {
    if (this.kind[cell] !== EdgeKinds.TRANSFER) return undefined;
    return this.id[cell] as TransferId;
  }

  vehicleRouteIdAtCell(cell: CellId): number {
    return this.id[cell]!;
  }

  vehicleTripIndexAtCell(cell: CellId): TripRouteIndex {
    return this.tripIndex[cell]!;
  }

  vehicleHopOffStopIndexAtCell(cell: CellId): StopRouteIndex {
    return this.hopOffStopIndex[cell]!;
  }

  vehicleTripAtCell(cell: CellId): TripStop | undefined {
    if (!this.isVehicleCell(cell)) return undefined;
    return {
      stopIndex: this.vehicleHopOffStopIndexAtCell(cell),
      routeId: this.vehicleRouteIdAtCell(cell),
      tripIndex: this.vehicleTripIndexAtCell(cell),
    };
  }

  vehiclePayload(cell: CellId):
    | {
        routeId: number;
        boardStopIndex: StopRouteIndex;
        tripIndex: TripRouteIndex;
        hopOffStopIndex: StopRouteIndex;
      }
    | undefined {
    if (!this.isVehicleCell(cell)) return undefined;
    return {
      routeId: this.id[cell]!,
      boardStopIndex: this.hopOnStopIndex[cell]!,
      tripIndex: this.tripIndex[cell]!,
      hopOffStopIndex: this.hopOffStopIndex[cell]!,
    };
  }

  /**
   * Returns the predecessor cell that should be followed after reconstructing a
   * complete vehicle chain ending at `cell`.
   */
  predecessorBeforeVehicleChain(cell: CellId): CellId {
    let firstVehicleCell = cell;
    while (this.kind[firstVehicleCell]! === EdgeKinds.VEHICLE_CONTINUATION) {
      const previous = this.prevCell[firstVehicleCell]!;
      if (previous === NO_CELL || !this.isVehicleCell(previous)) return NO_CELL;
      firstVehicleCell = previous;
    }
    return this.prevCell[firstVehicleCell]!;
  }

  private writeCommon(
    cell: CellId,
    kind: EdgeKind,
    arrival: Time,
    prevCell: CellId,
  ): void {
    this.kind[cell] = kind;
    this.arrival[cell] = arrival;
    this.prevCell[cell] = prevCell;
    if (this.touchedCellMask[cell] === 0) {
      this.touchedCellMask[cell] = 1;
      this.touchedCells.push(cell);
    }
  }

  private writeVehicle(
    cell: CellId,
    kind: typeof EdgeKinds.VEHICLE | typeof EdgeKinds.VEHICLE_CONTINUATION,
    arrival: Time,
    routeId: number,
    boardStopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
    hopOffStopIndex: StopRouteIndex,
    prevCell: CellId,
  ): void {
    this.writeCommon(cell, kind, arrival, prevCell);
    this.id[cell] = routeId;
    this.hopOnStopIndex[cell] = boardStopIndex;
    this.tripIndex[cell] = tripIndex;
    this.hopOffStopIndex[cell] = hopOffStopIndex;
  }
}
