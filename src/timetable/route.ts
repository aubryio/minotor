import { StopId } from '../stops/stops.js';
import { SerializedRoute } from './io.js';
import { Time } from './time.js';
import { ServiceRouteId } from './timetable.js';

/**
 * An internal identifier for routes.
 * Not to mix with the ServiceRouteId which corresponds to the GTFS RouteId.
 * This one is used for identifying groups of trips
 * from a service route sharing the same list of stops.
 */
export type RouteId = number;

/**
 * Details about the pickup and drop-off modalities at each stop in each trip of a route.
 */
export type PickUpDropOffType =
  | 'REGULAR'
  | 'NOT_AVAILABLE'
  | 'MUST_PHONE_AGENCY'
  | 'MUST_COORDINATE_WITH_DRIVER';

export const REGULAR = 0;
export const NOT_AVAILABLE = 1;
export const MUST_PHONE_AGENCY = 2;
export const MUST_COORDINATE_WITH_DRIVER = 3;

/*
 * A trip route index corresponds to the index of a given trip in a route.
 */
export type TripRouteIndex = number;

/*
 * A stop route index corresponds to the index of a given stop in a route.
 */
export type StopRouteIndex = number;

/*
 * Global trip identifier.
 */
export type TripId = number;

const pickUpDropOffTypeMap: PickUpDropOffType[] = [
  'REGULAR',
  'NOT_AVAILABLE',
  'MUST_PHONE_AGENCY',
  'MUST_COORDINATE_WITH_DRIVER',
];

/**
 * Converts a numerical representation of a pick-up/drop-off type
 * into its corresponding string representation.
 *
 * @param numericalType - The numerical value representing the pick-up/drop-off type.
 * @returns The corresponding PickUpDropOffType as a string.
 * @throws An error if the numerical type is invalid.
 */
const toPickupDropOffType = (numericalType: number): PickUpDropOffType => {
  const type = pickUpDropOffTypeMap[numericalType];
  if (!type) {
    throw new Error(`Invalid pickup/drop-off type ${numericalType}`);
  }
  return type;
};

/**
 * A route identifies all trips of a given service route sharing the same list of stops.
 */
export class Route {
  public readonly id: RouteId;
  /**
   * Arrivals and departures encoded as minutes from midnight.
   * Format: [arrival1, departure1, arrival2, departure2, etc.]
   */
  private readonly stopTimes: Uint16Array;
  /**
   * PickUp and DropOff types represented as a 2-bit encoded Uint8Array.
   * Values (2 bits each):
   *   0: REGULAR
   *   1: NOT_AVAILABLE
   *   2: MUST_PHONE_AGENCY
   *   3: MUST_COORDINATE_WITH_DRIVER
   *
   * Encoding format: Each byte contains 2 pickup/drop-off pairs (4 bits each)
   * Bit layout per byte: [pickup_1 (2 bits)][drop_off_1 (2 bits)][pickup_0 (2 bits)][drop_off_0 (2 bits)]
   * Example: For stops 0 and 1 in a trip, one byte encodes all 4 values
   */
  private readonly pickUpDropOffTypes: Uint8Array;
  /**
   * A binary array of stopIds in the route.
   * [stop1, stop2, stop3,...]
   */
  public readonly stops: Uint32Array;
  /**
   * A reverse mapping of each stop with their index in the route:
   * {
   *   4: 0,
   *   5: 1,
   *   ...
   * }
   */
  private readonly stopIndices: Map<StopId, StopRouteIndex>;
  /**
   * The identifier of the route as a service shown to users.
   */
  private readonly serviceRouteId: ServiceRouteId;

  /**
   * The total number of stops in the route.
   */
  private readonly nbStops: number;

  /**
   * The total number of trips in the route.
   */
  private readonly nbTrips: number;

  constructor(
    id: RouteId,
    stopTimes: Uint16Array,
    pickUpDropOffTypes: Uint8Array,
    stops: Uint32Array,
    serviceRouteId: ServiceRouteId,
  ) {
    this.id = id;
    this.stopTimes = stopTimes;
    this.pickUpDropOffTypes = pickUpDropOffTypes;
    this.stops = stops;
    this.serviceRouteId = serviceRouteId;
    this.nbStops = stops.length;
    this.nbTrips = this.stopTimes.length / (this.stops.length * 2);
    this.stopIndices = new Map<StopId, StopRouteIndex>();
    for (let i = 0; i < stops.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.stopIndices.set(stops[i]!, i);
    }
  }

  /**
   * Serializes the Route into binary arrays.
   *
   * @returns The serialized binary data.
   */
  serialize(): SerializedRoute {
    return {
      stopTimes: this.stopTimes,
      pickUpDropOffTypes: this.pickUpDropOffTypes,
      stops: this.stops,
      serviceRouteId: this.serviceRouteId,
    };
  }

  /**
   * Checks if stop A is before stop B in the route.
   *
   * @param stopA - The StopId of the first stop.
   * @param stopB - The StopId of the second stop.
   * @returns True if stop A is before stop B, false otherwise.
   */
  isBefore(stopA: StopId, stopB: StopId): boolean {
    const stopAIndex = this.stopIndices.get(stopA);
    if (stopAIndex === undefined) {
      throw new Error(
        `Stop index ${stopAIndex} not found in route ${this.serviceRouteId}`,
      );
    }
    const stopBIndex = this.stopIndices.get(stopB);
    if (stopBIndex === undefined) {
      throw new Error(
        `Stop index ${stopBIndex} not found in route ${this.serviceRouteId}`,
      );
    }
    return stopAIndex < stopBIndex;
  }

  /**
   * Retrieves the number of stops in the route.
   *
   * @returns The total number of stops in the route.
   */
  getNbStops(): number {
    return this.nbStops;
  }

  /**
   * Finds the ServiceRouteId of the route. It corresponds the identifier
   * of the service shown to the end user as a route.
   *
   * @returns The ServiceRouteId of the route.
   */
  serviceRoute(): ServiceRouteId {
    return this.serviceRouteId;
  }

  /**
   * Retrieves the arrival time at a specific stop for a given trip.
   *
   * @param stopId - The identifier of the stop.
   * @param tripIndex - The index of the trip.
   * @returns The arrival time at the specified stop and trip as a Time object.
   */
  arrivalAt(stopId: StopId, tripIndex: TripRouteIndex): Time {
    const arrivalIndex =
      (tripIndex * this.stops.length + this.stopIndex(stopId)) * 2;
    const arrival = this.stopTimes[arrivalIndex];
    if (arrival === undefined) {
      throw new Error(
        `Arrival time not found for stop ${stopId} at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }
    return Time.fromMinutes(arrival);
  }

  /**
   * Retrieves the departure time at a specific stop for a given trip.
   *
   * @param stopId - The identifier of the stop.
   * @param tripIndex - The index of the trip.
   * @returns The departure time at the specified stop and trip as a Time object.
   */
  departureFrom(stopId: StopId, tripIndex: TripRouteIndex): Time {
    const departureIndex =
      (tripIndex * this.stops.length + this.stopIndex(stopId)) * 2 + 1;
    const departure = this.stopTimes[departureIndex];
    if (departure === undefined) {
      throw new Error(
        `Departure time not found for stop ${stopId} at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }
    return Time.fromMinutes(departure);
  }

  /**
   * Retrieves the pick-up type for a specific stop and trip.
   *
   * @param stopId - The identifier of the stop.
   * @param tripIndex - The index of the trip.
   * @returns The pick-up type at the specified stop and trip.
   */
  pickUpTypeFrom(stopId: StopId, tripIndex: TripRouteIndex): PickUpDropOffType {
    const globalIndex = tripIndex * this.stops.length + this.stopIndex(stopId);
    const byteIndex = Math.floor(globalIndex / 2);
    const isSecondPair = globalIndex % 2 === 1;

    const byte = this.pickUpDropOffTypes[byteIndex];
    if (byte === undefined) {
      throw new Error(
        `Pick up type not found for stop ${stopId} at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }

    const pickUpValue = isSecondPair
      ? (byte >> 6) & 0x03 // Upper 2 bits for second pair
      : (byte >> 2) & 0x03; // Bits 2-3 for first pair
    return toPickupDropOffType(pickUpValue);
  }

  /**
   * Retrieves the drop-off type for a specific stop and trip.
   *
   * @param stopId - The identifier of the stop.
   * @param tripIndex - The index of the trip.
   * @returns The drop-off type at the specified stop and trip.
   */
  dropOffTypeAt(stopId: StopId, tripIndex: TripRouteIndex): PickUpDropOffType {
    const globalIndex = tripIndex * this.stops.length + this.stopIndex(stopId);
    const byteIndex = Math.floor(globalIndex / 2);
    const isSecondPair = globalIndex % 2 === 1;

    const byte = this.pickUpDropOffTypes[byteIndex];
    if (byte === undefined) {
      throw new Error(
        `Drop off type not found for stop ${stopId} at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }

    const dropOffValue = isSecondPair
      ? (byte >> 4) & 0x03 // Bits 4-5 for second pair
      : byte & 0x03; // Lower 2 bits for first pair
    return toPickupDropOffType(dropOffValue);
  }

  /**
   * Finds the earliest trip that can be taken from a specific stop on a given route,
   * optionally constrained by a latest trip index and a time before which the trip
   * should not depart.
   * *
   * @param stopId - The StopId of the stop where the trip should be found.
   * @param [after=Time.origin()] - The earliest time after which the trip should depart.
   *                                    If not provided, searches all available trips.
   * @param [beforeTrip] - (Optional) The index of the trip before which the search should be constrained.
   *                                   If not provided, searches all available trips.
   * @returns The index of the earliest trip meeting the criteria, or undefined if no such trip is found.
   */
  findEarliestTrip(
    stopId: StopId,
    after: Time = Time.origin(),
    beforeTrip?: TripRouteIndex,
  ): TripRouteIndex | undefined {
    if (this.nbTrips <= 0) return undefined;

    let hi = this.nbTrips - 1;
    if (beforeTrip !== undefined) hi = Math.min(hi, beforeTrip - 1);
    if (hi < 0) return undefined;

    let lo = 0;
    let lb = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const depMid = this.departureFrom(stopId, mid);
      if (depMid.isBefore(after)) {
        lo = mid + 1;
      } else {
        lb = mid;
        hi = mid - 1;
      }
    }
    if (lb === -1) return undefined;

    for (let t = lb; t < (beforeTrip ?? this.nbTrips); t++) {
      const pickup = this.pickUpTypeFrom(stopId, t);
      if (pickup !== 'NOT_AVAILABLE') {
        return t;
      }
    }
    return undefined;
  }

  /**
   * Retrieves the index of a stop within the route.
   * @param stopId The StopId of the stop to locate in the route.
   * @returns The index of the stop in the route.
   */
  public stopIndex(stopId: StopId): StopRouteIndex {
    const stopIndex = this.stopIndices.get(stopId);
    if (stopIndex === undefined) {
      throw new Error(
        `Stop index for ${stopId} not found in route ${this.serviceRouteId}`,
      );
    }
    return stopIndex;
  }
}
