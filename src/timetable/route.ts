import { StopId } from '../stops/stops.js';
import { SerializedRoute } from './io.js';
import { Time, TIME_ORIGIN } from './time.js';
import { ServiceRouteId } from './timetable.js';

/**
 * An internal identifier for routes.
 * Not to mix with the ServiceRouteId which corresponds to the GTFS RouteId.
 * This one is used for identifying groups of trips
 * from a service route sharing the same list of stops.
 */
export type RouteId = number;

export type RawPickUpDropOffType = 0 | 1 | 2 | 3;

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
  private readonly pickupDropOffTypes: Uint8Array;
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
  private readonly stopIndices: Map<StopId, StopRouteIndex[]>;
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
    pickupDropOffTypes: Uint8Array,
    stops: Uint32Array,
    serviceRouteId: ServiceRouteId,
  ) {
    this.id = id;
    this.stopTimes = stopTimes;
    this.pickupDropOffTypes = pickupDropOffTypes;
    this.stops = stops;
    this.serviceRouteId = serviceRouteId;
    this.nbStops = stops.length;
    this.nbTrips = this.stopTimes.length / (this.stops.length * 2);
    this.stopIndices = new Map<StopId, StopRouteIndex[]>();
    for (let i = 0; i < stops.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const stopId = stops[i]!;
      const existingIndices = this.stopIndices.get(stopId);
      if (existingIndices) {
        existingIndices.push(i);
      } else {
        this.stopIndices.set(stopId, [i]);
      }
    }
  }

  /**
   * Creates a new route from multiple trips with their stops.
   *
   * @param params The route parameters including ID, service route ID, and trips.
   * @returns The new route.
   */
  static of(params: {
    id: RouteId;
    serviceRouteId: ServiceRouteId;
    trips: Array<{
      stops: Array<{
        id: StopId;
        arrivalTime: Time;
        departureTime: Time;
        dropOffType?: number;
        pickUpType?: number;
      }>;
    }>;
  }): Route {
    const { id, serviceRouteId, trips } = params;

    if (trips.length === 0) {
      throw new Error('At least one trip must be provided');
    }

    // All trips must have the same stops in the same order
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstTrip = trips[0]!;
    const stopIds = new Uint32Array(firstTrip.stops.map((stop) => stop.id));
    const numStops = stopIds.length;

    // Validate all trips have the same stops
    for (let tripIndex = 1; tripIndex < trips.length; tripIndex++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const trip = trips[tripIndex]!;
      if (trip.stops.length !== numStops) {
        throw new Error(
          `Trip ${tripIndex} has ${trip.stops.length} stops, expected ${numStops}`,
        );
      }
      for (let stopIndex = 0; stopIndex < numStops; stopIndex++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (trip.stops[stopIndex]!.id !== stopIds[stopIndex]) {
          throw new Error(
            `Trip ${tripIndex} has different stop at index ${stopIndex}`,
          );
        }
      }
    }

    // Create stopTimes array with arrivals and departures for all trips
    const stopTimes = new Uint16Array(trips.length * numStops * 2);
    for (let tripIndex = 0; tripIndex < trips.length; tripIndex++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const trip = trips[tripIndex]!;
      for (let stopIndex = 0; stopIndex < numStops; stopIndex++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const stop = trip.stops[stopIndex]!;
        const baseIndex = (tripIndex * numStops + stopIndex) * 2;
        stopTimes[baseIndex] = stop.arrivalTime;
        stopTimes[baseIndex + 1] = stop.departureTime;
      }
    }

    // Create pickupDropOffTypes array (2-bit encoded) for all trips
    const totalStopEntries = trips.length * numStops;
    const pickupDropOffTypes = new Uint8Array(Math.ceil(totalStopEntries / 2));

    for (let tripIndex = 0; tripIndex < trips.length; tripIndex++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const trip = trips[tripIndex]!;
      for (let stopIndex = 0; stopIndex < numStops; stopIndex++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const stop = trip.stops[stopIndex]!;
        const globalIndex = tripIndex * numStops + stopIndex;
        const pickUp = stop.pickUpType ?? REGULAR;
        const dropOff = stop.dropOffType ?? REGULAR;
        const byteIndex = Math.floor(globalIndex / 2);
        const isSecondPair = globalIndex % 2 === 1;

        if (isSecondPair) {
          // Second pair: pickup in upper 2 bits, dropOff in bits 4-5
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          pickupDropOffTypes[byteIndex]! |= (pickUp << 6) | (dropOff << 4);
        } else {
          // First pair: pickup in bits 2-3, dropOff in lower 2 bits
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          pickupDropOffTypes[byteIndex]! |= (pickUp << 2) | dropOff;
        }
      }
    }

    return new Route(
      id,
      stopTimes,
      pickupDropOffTypes,
      stopIds,
      serviceRouteId,
    );
  }

  /**
   * Serializes the Route into binary arrays.
   *
   * @returns The serialized binary data.
   */
  serialize(): SerializedRoute {
    return {
      stopTimes: this.stopTimes,
      pickupDropOffTypes: this.pickupDropOffTypes,
      stops: this.stops,
      serviceRouteId: this.serviceRouteId,
    };
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
   * Retrieves the number of trips in the route.
   *
   * @returns The total number of trips in the route.
   */
  getNbTrips(): number {
    return this.nbTrips;
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
   * @param stopIndex - The index of the stop in the route.
   * @param tripIndex - The index of the trip.
   * @returns The arrival time at the specified stop and trip as a Time.
   */
  arrivalAt(stopIndex: StopRouteIndex, tripIndex: TripRouteIndex): Time {
    const arrivalIndex = (tripIndex * this.stops.length + stopIndex) * 2;
    const arrival = this.stopTimes[arrivalIndex];
    if (arrival === undefined) {
      throw new Error(
        `Arrival time not found for stop ${this.stopId(stopIndex)} (${stopIndex}) at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }
    return arrival;
  }

  /**
   * Retrieves the departure time at a specific stop for a given trip.
   *
   * @param stopIndex - The index of the stop in the route.
   * @param tripIndex - The index of the trip.
   * @returns The departure time at the specified stop and trip as a Time.
   */
  departureFrom(stopIndex: StopRouteIndex, tripIndex: TripRouteIndex): Time {
    const departureIndex = (tripIndex * this.stops.length + stopIndex) * 2 + 1;
    const departure = this.stopTimes[departureIndex];
    if (departure === undefined) {
      throw new Error(
        `Departure time not found for stop ${this.stopId(stopIndex)} (${stopIndex}) at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }
    return departure;
  }

  /**
   * Retrieves the pick-up type for a specific stop and trip.
   *
   * @param stopIndex - The index of the stop in the route.
   * @param tripIndex - The index of the trip.
   * @returns The pick-up type at the specified stop and trip.
   */
  pickUpTypeFrom(
    stopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
  ): RawPickUpDropOffType {
    const globalIndex = tripIndex * this.stops.length + stopIndex;
    const byteIndex = Math.floor(globalIndex / 2);
    const isSecondPair = globalIndex % 2 === 1;

    const byte = this.pickupDropOffTypes[byteIndex];
    if (byte === undefined) {
      throw new Error(
        `Pick up type not found for stop ${this.stopId(stopIndex)} (${stopIndex}) at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }

    const pickUpValue = isSecondPair
      ? (byte >> 6) & 0x03 // Upper 2 bits for second pair
      : (byte >> 2) & 0x03; // Bits 2-3 for first pair
    return pickUpValue as RawPickUpDropOffType;
  }

  /**
   * Retrieves the drop-off type for a specific stop and trip.
   *
   * @param stopIndex - The index of the stop in the route.
   * @param tripIndex - The index of the trip.
   * @returns The drop-off type at the specified stop and trip.
   */
  dropOffTypeAt(
    stopIndex: StopRouteIndex,
    tripIndex: TripRouteIndex,
  ): RawPickUpDropOffType {
    const globalIndex = tripIndex * this.stops.length + stopIndex;
    const byteIndex = Math.floor(globalIndex / 2);
    const isSecondPair = globalIndex % 2 === 1;

    const byte = this.pickupDropOffTypes[byteIndex];
    if (byte === undefined) {
      throw new Error(
        `Drop off type not found for stop ${this.stopId(stopIndex)} (${stopIndex}) at trip index ${tripIndex} in route ${this.serviceRouteId}`,
      );
    }

    const dropOffValue = isSecondPair
      ? (byte >> 4) & 0x03 // Bits 4-5 for second pair
      : byte & 0x03; // Lower 2 bits for first pair
    return dropOffValue as RawPickUpDropOffType;
  }

  /**
   * Finds the earliest trip that can be taken from a specific stop on a given route,
   * optionally constrained by a latest trip index and a time before which the trip
   * should not depart.
   * *
   * @param stopIndex - The route index of the stop where the trip should be found.
   * @param [after=Time.origin()] - The earliest time after which the trip should depart.
   *                                    If not provided, searches all available trips.
   * @param [beforeTrip] - (Optional) The index of the trip before which the search should be constrained.
   *                                   If not provided, searches all available trips.
   * @returns The index of the earliest trip meeting the criteria, or undefined if no such trip is found.
   */
  findEarliestTrip(
    stopIndex: StopRouteIndex,
    after: Time = TIME_ORIGIN,
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
      const depMid = this.departureFrom(stopIndex, mid);
      if (depMid < after) {
        lo = mid + 1;
      } else {
        lb = mid;
        hi = mid - 1;
      }
    }
    if (lb === -1) return undefined;
    return lb;
  }

  /**
   * Retrieves the indices of a stop within the route.
   * @param stopId The StopId of the stop to locate in the route.
   * @returns An array of indices where the stop appears in the route, or an empty array if the stop is not found.
   */
  public stopRouteIndices(stopId: StopId): StopRouteIndex[] {
    const stopIndex = this.stopIndices.get(stopId);
    if (stopIndex === undefined) {
      return [];
    }
    return stopIndex;
  }

  /**
   * Retrieves the id of a stop at a given index in a route.
   * @param stopRouteIndex The route index of the stop.
   * @returns The id of the stop at the given index in the route.
   */
  public stopId(stopRouteIndex: StopRouteIndex): StopId {
    const stopId = this.stops[stopRouteIndex];
    if (stopId === undefined) {
      throw new Error(
        `StopId for stop at index ${stopRouteIndex} not found in route ${this.serviceRouteId}`,
      );
    }
    return stopId;
  }
}
