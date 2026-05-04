/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { StopRouteIndex, TripRouteIndex } from '../timetable/route.js';
import { Duration, Time } from '../timetable/time.js';
import { TransferType } from '../timetable/timetable.js';
import type { RoutingEdge, VehicleEdge } from './state.js';

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
export class TypedStateGraph {
  readonly nbStops: number;
  readonly roundCount: number;

  readonly kind: Uint8Array;
  readonly arrival: Uint16Array;
  readonly prevCell: Uint32Array;

  /** Union payload: routeId for vehicles, fromStop for access/transfers/origins. */
  readonly u32: Uint32Array;
  /** Union payload: board stopIndex for vehicles, duration for access/transfers. */
  readonly u16a: Uint16Array;
  /** Union payload: tripIndex for vehicles. */
  readonly u16b: Uint16Array;
  /** Union payload: hopOffStopIndex for vehicles. */
  readonly u16c: Uint16Array;
  /** Union payload: transfer type for transfers. */
  readonly u8: Uint8Array;

  private readonly touchedCells: number[] = [];

  /**
   * Compatibility fallback for test fixtures that provide a continuation edge
   * whose `continuationOf` edge is not itself present in the graph. Production
   * routing leaves this empty and uses numeric `prevCell` links exclusively.
   */
  private readonly detachedContinuationByCell = new Map<number, VehicleEdge>();

  constructor(nbStops: number, maxRound: number) {
    this.nbStops = nbStops;
    this.roundCount = maxRound + 1;
    const cellCount = this.nbStops * this.roundCount;

    this.kind = new Uint8Array(cellCount);
    this.arrival = new Uint16Array(cellCount).fill(UNREACHED_TIME);
    this.prevCell = new Uint32Array(cellCount).fill(NO_CELL);
    this.u32 = new Uint32Array(cellCount).fill(NO_U32);
    this.u16a = new Uint16Array(cellCount).fill(NO_U16);
    this.u16b = new Uint16Array(cellCount).fill(NO_U16);
    this.u16c = new Uint16Array(cellCount).fill(NO_U16);
    this.u8 = new Uint8Array(cellCount);
  }

  get length(): number {
    return this.roundCount;
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
      cell >= 0 && cell < this.kind.length && this.kind[cell] !== EdgeKinds.NONE
    );
  }

  hasEdge(round: number, stop: StopId): boolean {
    return this.hasCell(this.cell(round, stop));
  }

  arrivalAtCell(cell: number): Time {
    return this.arrival[cell]!;
  }

  arrivalAt(round: number, stop: StopId): Time {
    return this.arrivalAtCell(this.cell(round, stop));
  }

  predecessorCell(cell: number): number {
    return this.prevCell[cell]!;
  }

  isVehicleCell(cell: number): boolean {
    return isVehicleEdgeKind(this.kind[cell]!);
  }

  isVehicleContinuationCell(cell: number): boolean {
    return this.kind[cell]! === EdgeKinds.VEHICLE_CONTINUATION;
  }

  isTransferCell(cell: number): boolean {
    return this.kind[cell]! === EdgeKinds.TRANSFER;
  }

  setOrigin(stop: StopId, arrival: Time, originStop: StopId = stop): void {
    const cell = this.cell(0, stop);
    this.writeCommon(cell, EdgeKinds.ORIGIN, arrival, NO_CELL);
    this.u32[cell] = originStop;
  }

  setAccess(
    toStop: StopId,
    arrival: Time,
    fromStop: StopId,
    duration: Duration,
  ): void {
    const cell = this.cell(0, toStop);
    this.writeCommon(cell, EdgeKinds.ACCESS, arrival, NO_CELL);
    this.u32[cell] = fromStop;
    this.u16a[cell] = duration;
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
    fromStop: StopId,
    type: TransferType,
    minTransferTime: Duration | undefined,
    prevCell: number,
  ): void {
    const cell = this.cell(round, toStop);
    this.writeCommon(cell, EdgeKinds.TRANSFER, arrival, prevCell);
    this.u32[cell] = fromStop;
    this.u16a[cell] = minTransferTime ?? NO_U16;
    this.u8[cell] = type;
  }

  setRoutingEdgeFromObject(
    round: number,
    stop: StopId,
    edge: RoutingEdge,
    knownVehicleCells?: WeakMap<VehicleEdge, number>,
  ): void {
    if ('routeId' in edge) {
      const previousCell = edge.continuationOf
        ? (knownVehicleCells?.get(edge.continuationOf) ?? NO_CELL)
        : NO_CELL;
      if (edge.continuationOf) {
        this.setVehicleContinuation(
          round,
          stop,
          edge.arrival,
          edge.routeId,
          edge.stopIndex,
          edge.tripIndex,
          edge.hopOffStopIndex,
          previousCell,
        );
        if (previousCell === NO_CELL) {
          this.detachedContinuationByCell.set(
            this.cell(round, stop),
            edge.continuationOf,
          );
        }
      } else {
        this.setVehicle(
          round,
          stop,
          edge.arrival,
          edge.routeId,
          edge.stopIndex,
          edge.tripIndex,
          edge.hopOffStopIndex,
          NO_CELL,
        );
      }
      knownVehicleCells?.set(edge, this.cell(round, stop));
      return;
    }

    if ('type' in edge) {
      this.setTransfer(
        round,
        stop,
        edge.arrival,
        edge.from,
        edge.type,
        edge.minTransferTime,
        NO_CELL,
      );
      return;
    }

    if ('duration' in edge) {
      this.setAccess(stop, edge.arrival, edge.from, edge.duration);
      return;
    }

    this.setOrigin(stop, edge.arrival, edge.stopId);
  }

  clearTouched(): void {
    for (let i = 0; i < this.touchedCells.length; i++) {
      const cell = this.touchedCells[i]!;
      this.kind[cell] = EdgeKinds.NONE;
      this.arrival[cell] = UNREACHED_TIME;
      this.prevCell[cell] = NO_CELL;
      this.detachedContinuationByCell.delete(cell);
    }
    this.touchedCells.length = 0;
  }

  clearAll(): void {
    this.kind.fill(EdgeKinds.NONE);
    this.arrival.fill(UNREACHED_TIME);
    this.prevCell.fill(NO_CELL);
    this.touchedCells.length = 0;
    this.detachedContinuationByCell.clear();
  }

  edgeAt(round: number, stop: StopId): RoutingEdge | undefined {
    return this.edgeAtCell(this.cell(round, stop));
  }

  edgeAtCell(cell: number): RoutingEdge | undefined {
    const kind = this.kind[cell] ?? EdgeKinds.NONE;
    if (kind === EdgeKinds.NONE) return undefined;

    const arrival = this.arrival[cell]!;
    switch (kind) {
      case EdgeKinds.ORIGIN:
        return { stopId: this.u32[cell]!, arrival };
      case EdgeKinds.ACCESS:
        return {
          arrival,
          from: this.u32[cell]!,
          to: this.stopOfCell(cell),
          duration: this.u16a[cell]!,
        };
      case EdgeKinds.VEHICLE:
        return this.vehicleEdgeAtCell(cell);
      case EdgeKinds.VEHICLE_CONTINUATION:
        return this.vehicleEdgeAtCell(cell);
      case EdgeKinds.TRANSFER: {
        const minTransferTime = this.u16a[cell]!;
        return {
          arrival,
          from: this.u32[cell]!,
          to: this.stopOfCell(cell),
          type: this.u8[cell]! as TransferType,
          ...(minTransferTime !== NO_U16 && { minTransferTime }),
        };
      }
      default:
        return undefined;
    }
  }

  vehicleEdgeAtCell(cell: number): VehicleEdge {
    const continuationOf = this.continuationOfCell(cell);
    return {
      arrival: this.arrival[cell]!,
      routeId: this.u32[cell]!,
      stopIndex: this.u16a[cell]!,
      tripIndex: this.u16b[cell]!,
      hopOffStopIndex: this.u16c[cell]!,
      ...(continuationOf !== undefined && { continuationOf }),
    };
  }

  /**
   * Returns the predecessor cell that should be followed after reconstructing a
   * complete vehicle chain ending at `cell`.
   */
  predecessorBeforeVehicleChain(cell: number): number {
    let firstVehicleCell = cell;
    while (this.kind[firstVehicleCell]! === EdgeKinds.VEHICLE_CONTINUATION) {
      const previous = this.prevCell[firstVehicleCell]!;
      if (previous === NO_CELL || !this.isVehicleCell(previous)) return NO_CELL;
      firstVehicleCell = previous;
    }
    return this.prevCell[firstVehicleCell]!;
  }

  *edges(): Generator<{
    round: number;
    stop: StopId;
    cell: number;
    edge: RoutingEdge;
  }> {
    for (let cell = 0; cell < this.kind.length; cell++) {
      if (this.kind[cell]! === EdgeKinds.NONE) continue;
      const edge = this.edgeAtCell(cell);
      if (edge === undefined) continue;
      yield {
        round: this.roundOfCell(cell),
        stop: this.stopOfCell(cell),
        cell,
        edge,
      };
    }
  }

  private writeCommon(
    cell: number,
    kind: EdgeKind,
    arrival: Time,
    prevCell: number,
  ): void {
    this.kind[cell] = kind;
    this.arrival[cell] = arrival;
    this.prevCell[cell] = prevCell;
    this.detachedContinuationByCell.delete(cell);
    this.touchedCells.push(cell);
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
    this.u32[cell] = routeId;
    this.u16a[cell] = boardStopIndex;
    this.u16b[cell] = tripIndex;
    this.u16c[cell] = hopOffStopIndex;
  }

  private continuationOfCell(cell: number): VehicleEdge | undefined {
    if (this.kind[cell]! !== EdgeKinds.VEHICLE_CONTINUATION) return undefined;

    const previousCell = this.prevCell[cell]!;
    if (previousCell !== NO_CELL && this.isVehicleCell(previousCell)) {
      return this.vehicleEdgeAtCell(previousCell);
    }

    return this.detachedContinuationByCell.get(cell);
  }
}
