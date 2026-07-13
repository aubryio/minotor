import { distance } from 'geokdbush';

import { Stop } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Duration } from '../timetable/time.js';
import {
  RouteType,
  RouteTypes,
  RouteTypeString,
  Transfer,
  TransferTypes,
} from '../timetable/timetable.js';
import { getOrInsert } from '../utils/map.js';
import {
  GeneratedTransfers,
  StopModes,
  TransferGenerator,
} from './generator.js';

/**
 * Extra transfer time, in minutes, attributed to leaving a stop served by a
 * given mode, keyed by mode name. Represents the (mostly vertical) effort of
 * getting between the vehicle and street level — e.g. climbing up from a deep
 * subway platform. Modes absent from the table contribute no penalty.
 */
export type ModeAccessPenalties = Partial<Record<RouteTypeString, number>>;

export type StraightLineTransferGeneratorOptions = {
  /**
   * Maximum straight-line distance between two stops for a transfer to be generated, in meters.
   */
  maxDistanceMeters?: number;

  /**
   * Assumed pedestrian walking speed, in kilometers per hour.
   */
  walkingSpeedKmh?: number;

  /**
   * Multiplier applied to the straight-line distance to approximate the real
   * walking path length. Use 1 to disable.
   */
  detourFactor?: number;

  /**
   * Flat penalty, in minutes, added to every generated transfer to account for
   * the general overhead of changing (orientation, walking through the
   * station). Use 0 to disable.
   */
  changePenaltyMinutes?: number;

  /**
   * Per-mode access penalty, in minutes, added on both ends of a transfer based
   * on the modes serving the origin and destination stops (see
   * {@link ModeAccessPenalties}). Passing this replaces the default table; pass
   * `{}` to disable mode penalties entirely.
   */
  modeAccessPenaltyMinutes?: ModeAccessPenalties;
};

const DEFAULT_MAX_DISTANCE_METERS = 500;
const DEFAULT_WALKING_SPEED_KMH = 4;
const DEFAULT_DETOUR_FACTOR = 1.3;
const DEFAULT_CHANGE_PENALTY_MINUTES = 3;
const DEFAULT_MODE_ACCESS_PENALTY_MINUTES: ModeAccessPenalties = {
  SUBWAY: 4,
  RAIL: 3,
};

/**
 * A {@link TransferGenerator} that connects geographically close stops with
 * virtual walking transfers.
 *
 * The transfer time is derived from the straight-line (great-circle / haversine)
 * distance between two stops, scaled up by a detour factor to approximate the
 * real walking path and divided by an assumed walking speed. This is a
 * deliberately crude heuristic meant to fill in footpaths for feeds that
 * under-specify `transfers.txt` (e.g. large interchanges where subway, tram and
 * bus stops sit close together but are left unconnected).
 *
 * Generated transfers use {@link TransferTypes.REQUIRES_MINIMAL_TIME} so they
 * are treated as walking connections by both the router's transfer step and
 * its access/egress computation. Each origin is connected to its nearby stops
 * with a single directed edge; the reverse edge is produced when the neighbor
 * is itself visited as an origin.
 *
 * On top of the walking time, two penalties are added: a flat
 * `changePenaltyMinutes` for the general overhead of any change, and a per-mode
 * access penalty on each end (see {@link ModeAccessPenalties}) so that changes
 * out of deep modes like the subway cost more than the straight-line distance
 * alone would suggest. Both penalties are symmetric, so the two directions of a
 * transfer share the same minimum time.
 */
export class StraightLineTransferGenerator implements TransferGenerator {
  private readonly maxDistanceMeters: number;
  private readonly walkingSpeedKmh: number;
  private readonly detourFactor: number;
  private readonly changePenaltyMinutes: number;
  private readonly modeAccessPenalty: Map<RouteType, number>;

  constructor(options: StraightLineTransferGeneratorOptions = {}) {
    this.maxDistanceMeters =
      options.maxDistanceMeters ?? DEFAULT_MAX_DISTANCE_METERS;
    this.walkingSpeedKmh = options.walkingSpeedKmh ?? DEFAULT_WALKING_SPEED_KMH;
    this.detourFactor = options.detourFactor ?? DEFAULT_DETOUR_FACTOR;
    this.changePenaltyMinutes =
      options.changePenaltyMinutes ?? DEFAULT_CHANGE_PENALTY_MINUTES;
    this.modeAccessPenalty = new Map();
    const penalties =
      options.modeAccessPenaltyMinutes ?? DEFAULT_MODE_ACCESS_PENALTY_MINUTES;
    for (const [name, minutes] of Object.entries(penalties)) {
      this.modeAccessPenalty.set(RouteTypes[name as RouteTypeString], minutes);
    }
  }

  generate(
    originStops: Stop[],
    stops: StopsIndex,
    stopModes: StopModes,
  ): GeneratedTransfers {
    const generated: GeneratedTransfers = new Map();
    const maxDistanceKm = this.maxDistanceMeters / 1000;

    for (const origin of originStops) {
      const { id, lat, lon } = origin;
      if (lat === undefined || lon === undefined) {
        continue;
      }
      const originAccessPenalty = this.accessPenalty(stopModes.get(id));
      const neighbors = stops.findStopsByLocation(
        lat,
        lon,
        Infinity,
        maxDistanceKm,
      );
      for (const neighbor of neighbors) {
        const { id: neighborId, lat: neighborLat, lon: neighborLon } = neighbor;
        if (
          neighborId === id ||
          neighborLat === undefined ||
          neighborLon === undefined
        ) {
          continue;
        }
        const walkingTime = this.walkingDuration(
          lon,
          lat,
          neighborLon,
          neighborLat,
        );
        // Emit a single directed edge; the reverse edge is emitted when the
        // neighbor is itself visited as an origin. Penalties are symmetric, so
        // both directions end up with the same minimum time.
        const minTransferTime =
          walkingTime +
          this.changePenaltyMinutes +
          originAccessPenalty +
          this.accessPenalty(stopModes.get(neighborId));
        this.addTransfer(generated, id, neighborId, minTransferTime);
      }
    }
    return generated;
  }

  /**
   * The access penalty for a stop, in minutes: the smallest per-mode penalty
   * among the modes serving it (the least-effort way in or out). Stops with no
   * known or no penalized mode contribute nothing.
   */
  private accessPenalty(modes: ReadonlySet<RouteType> | undefined): number {
    if (modes === undefined) {
      return 0;
    }
    let min = Infinity;
    for (const mode of modes) {
      const penalty = this.modeAccessPenalty.get(mode) ?? 0;
      if (penalty < min) {
        min = penalty;
      }
    }
    return min === Infinity ? 0 : min;
  }

  private addTransfer(
    transfers: GeneratedTransfers,
    from: number,
    to: number,
    minTransferTime: Duration,
  ): void {
    const transfer: Transfer = {
      destination: to,
      type: TransferTypes.REQUIRES_MINIMAL_TIME,
      minTransferTime,
    };
    getOrInsert(transfers, from, []).push(transfer);
  }

  /**
   * Estimates the walking time between two coordinates, in whole minutes.
   */
  private walkingDuration(
    lon1: number,
    lat1: number,
    lon2: number,
    lat2: number,
  ): Duration {
    const straightLineKm = distance(lon1, lat1, lon2, lat2);
    const walkingKm = straightLineKm * this.detourFactor;
    return Math.round((walkingKm / this.walkingSpeedKmh) * 60);
  }
}
