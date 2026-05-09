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

/** Sentinel used for optional uint16 payload fields. */
export const NO_U16 = 0xffff;

/** Sentinel used for optional uint32 payload fields and missing graph cells. */
export const NO_U32 = 0xffffffff;
export const NO_CELL = NO_U32;

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

  private readonly kindByCell: Uint8Array;
  private readonly arrivalByCell: Uint16Array;
  private readonly prevCellByCell: Uint32Array;

  private readonly idByCell: Uint32Array;
  private readonly hopOnStopIndexByCell: Uint16Array;
  private readonly tripIndexByCell: Uint16Array;
  private readonly hopOffStopIndexByCell: Uint16Array;

  private readonly originStopByStop: Uint32Array;
  private readonly accessFromByStop: Uint32Array;
  private readonly accessDurationByStop: Uint16Array;

  private readonly touchedCells: number[] = [];
  private readonly touchedCellMask: Uint8Array;

  constructor(nbStops: number, maxRound: number) {
    this.nbStops = nbStops;
    this.roundCount = maxRound + 1;
    const cellCount = this.nbStops * this.roundCount;

    this.kindByCell = new Uint8Array(cellCount);
    this.arrivalByCell = new Uint16Array(cellCount).fill(UNREACHED_TIME);
    this.prevCellByCell = new Uint32Array(cellCount);
    this.idByCell = new Uint32Array(cellCount);
    this.hopOnStopIndexByCell = new Uint16Array(cellCount);
    this.tripIndexByCell = new Uint16Array(cellCount);
    this.hopOffStopIndexByCell = new Uint16Array(cellCount);
    this.originStopByStop = new Uint32Array(this.nbStops);
    this.accessFromByStop = new Uint32Array(this.nbStops);
    this.accessDurationByStop = new Uint16Array(this.nbStops);
    this.touchedCellMask = new Uint8Array(cellCount);
  }

  get length(): number {
    return this.roundCount;
  }

  get cellCount(): number {
    return this.kindByCell.length;
  }

  cell(round: number, stop: StopId): number {
    return round * this.nbStops + stop;
  }

  roundOffset(round: number): number {
    return round * this.nbStops;
  }

  roundOfCell(cell: number): number {
    return Math.floor(cell / this.nbStops);
  }

  stopOfCell(cell: number): StopId {
    return cell % this.nbStops;
  }

  hasCell(cell: number): boolean {
    return (
      cell >= 0 &&
      cell < this.kindByCell.length &&
      this.kindByCell[cell] !== EdgeKinds.NONE
    );
  }

  hasCellUnchecked(cell: number): boolean {
    return this.kindByCell[cell] !== EdgeKinds.NONE;
  }

  hasEdge(round: number, stop: StopId): boolean {
    return this.hasCell(this.cell(round, stop));
  }

  kindAtCell(cell: number): EdgeKind {
    return (this.kindByCell[cell] ?? EdgeKinds.NONE) as EdgeKind;
  }

  kindAtCellUnchecked(cell: number): EdgeKind {
    return this.kindByCell[cell] as EdgeKind;
  }

  kindAt(round: number, stop: StopId): EdgeKind {
    return this.kindAtCell(this.cell(round, stop));
  }

  *occupiedCells(): Generator<number> {
    for (let i = 0; i < this.touchedCells.length; i++) {
      const cell = this.touchedCells[i]!;
      if (this.kindByCell[cell] !== EdgeKinds.NONE) yield cell;
    }
  }

  arrivalAtCell(cell: number): Time {
    return this.arrivalByCell[cell]!;
  }

  arrivalAt(round: number, stop: StopId): Time {
    return this.arrivalAtCell(this.cell(round, stop));
  }

  predecessorCell(cell: number): number {
    return this.prevCellByCell[cell]!;
  }

  isVehicleCell(cell: number): boolean {
    const kind = this.kindByCell[cell]!;
    return (
      kind === EdgeKinds.VEHICLE || kind === EdgeKinds.VEHICLE_CONTINUATION
    );
  }

  isVehicleContinuationCell(cell: number): boolean {
    return this.kindByCell[cell]! === EdgeKinds.VEHICLE_CONTINUATION;
  }

  isTransferCell(cell: number): boolean {
    return this.kindByCell[cell]! === EdgeKinds.TRANSFER;
  }

  setOrigin(stop: StopId, arrival: Time, originStop: StopId = stop): void {
    const cell = this.cell(0, stop);
    this.writeCommon(cell, EdgeKinds.ORIGIN, arrival, NO_CELL);
    this.originStopByStop[stop] = originStop;
  }

  setAccess(
    toStop: StopId,
    arrival: Time,
    fromStop: StopId,
    duration: Duration,
  ): void {
    const cell = this.cell(0, toStop);
    this.writeCommon(cell, EdgeKinds.ACCESS, arrival, NO_CELL);
    this.accessFromByStop[toStop] = fromStop;
    this.accessDurationByStop[toStop] = duration;
  }

  setVehicle(
    round: number,
    toStop: StopId,
    arrival: Time,
    routeId: number,
    boardStopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
    hopOffStopIndex: StopRouteIndex,
    prevCell: number,
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
    previousVehicleCell: number,
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
    prevCell: number,
  ): void {
    const cell = this.cell(round, toStop);
    this.writeCommon(cell, EdgeKinds.TRANSFER, arrival, prevCell);
    this.idByCell[cell] = transferId;
  }

  clearTouched(): void {
    for (let i = 0; i < this.touchedCells.length; i++) {
      const cell = this.touchedCells[i]!;
      this.kindByCell[cell] = EdgeKinds.NONE;
      this.arrivalByCell[cell] = UNREACHED_TIME;
      this.touchedCellMask[cell] = 0;
    }
    this.touchedCells.length = 0;
  }

  clearAll(): void {
    this.kindByCell.fill(EdgeKinds.NONE);
    this.arrivalByCell.fill(UNREACHED_TIME);
    this.touchedCellMask.fill(0);
    this.touchedCells.length = 0;
  }

  originStopAtCell(cell: number): StopId | undefined {
    if (this.kindByCell[cell] !== EdgeKinds.ORIGIN) return undefined;
    return this.originStopByStop[this.stopOfCell(cell)] as StopId;
  }

  accessAtCell(cell: number): { from: StopId; duration: Duration } | undefined {
    if (this.kindByCell[cell] !== EdgeKinds.ACCESS) return undefined;
    const stop = this.stopOfCell(cell);
    return {
      from: this.accessFromByStop[stop] as StopId,
      duration: this.accessDurationByStop[stop] as Duration,
    };
  }

  transferIdAtCell(cell: number): TransferId | undefined {
    if (this.kindByCell[cell] !== EdgeKinds.TRANSFER) return undefined;
    return this.idByCell[cell] as TransferId;
  }

  vehicleRouteIdAtCell(cell: number): number {
    return this.idByCell[cell]!;
  }

  vehicleTripIndexAtCell(cell: number): TripRouteIndex {
    return this.tripIndexByCell[cell]!;
  }

  vehicleHopOffStopIndexAtCell(cell: number): StopRouteIndex {
    return this.hopOffStopIndexByCell[cell]!;
  }

  vehicleTripAtCell(cell: number): TripStop | undefined {
    if (!this.isVehicleCell(cell)) return undefined;
    return {
      stopIndex: this.vehicleHopOffStopIndexAtCell(cell),
      routeId: this.vehicleRouteIdAtCell(cell),
      tripIndex: this.vehicleTripIndexAtCell(cell),
    };
  }

  vehiclePayloadAtCell(cell: number):
    | {
        routeId: number;
        boardStopIndex: StopRouteIndex;
        tripIndex: TripRouteIndex;
        hopOffStopIndex: StopRouteIndex;
      }
    | undefined {
    if (!this.isVehicleCell(cell)) return undefined;
    return {
      routeId: this.idByCell[cell]!,
      boardStopIndex: this.hopOnStopIndexByCell[cell]!,
      tripIndex: this.tripIndexByCell[cell]!,
      hopOffStopIndex: this.hopOffStopIndexByCell[cell]!,
    };
  }

  /**
   * Returns the predecessor cell that should be followed after reconstructing a
   * complete vehicle chain ending at `cell`.
   */
  predecessorBeforeVehicleChain(cell: number): number {
    let firstVehicleCell = cell;
    while (
      this.kindByCell[firstVehicleCell]! === EdgeKinds.VEHICLE_CONTINUATION
    ) {
      const previous = this.prevCellByCell[firstVehicleCell]!;
      if (previous === NO_CELL || !this.isVehicleCell(previous)) return NO_CELL;
      firstVehicleCell = previous;
    }
    return this.prevCellByCell[firstVehicleCell]!;
  }

  private writeCommon(
    cell: number,
    kind: EdgeKind,
    arrival: Time,
    prevCell: number,
  ): void {
    this.kindByCell[cell] = kind;
    this.arrivalByCell[cell] = arrival;
    this.prevCellByCell[cell] = prevCell;
    if (this.touchedCellMask[cell] === 0) {
      this.touchedCellMask[cell] = 1;
      this.touchedCells.push(cell);
    }
  }

  private writeVehicle(
    cell: number,
    kind: typeof EdgeKinds.VEHICLE | typeof EdgeKinds.VEHICLE_CONTINUATION,
    arrival: Time,
    routeId: number,
    boardStopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
    hopOffStopIndex: StopRouteIndex,
    prevCell: number,
  ): void {
    this.writeCommon(cell, kind, arrival, prevCell);
    this.idByCell[cell] = routeId;
    this.hopOnStopIndexByCell[cell] = boardStopIndex;
    this.tripIndexByCell[cell] = tripIndex;
    this.hopOffStopIndexByCell[cell] = hopOffStopIndex;
  }
}
