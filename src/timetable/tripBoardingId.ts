import { RouteId, StopRouteIndex, TripRouteIndex } from './route.js';

// Each value uses 20 bits, allowing values from 0 to 1,048,575 (2^20 - 1)
const VALUE_MASK = (1n << 20n) - 1n; // 0xFFFFF
const MAX_VALUE = 1_048_575; // 2^20 - 1

// Bit positions for each value in the 60-bit bigint
const TRIP_INDEX_SHIFT = 0n;
const ROUTE_ID_SHIFT = 20n;
const STOP_INDEX_SHIFT = 40n;

// A TripId encodes a stop index, route ID, and trip index into a single bigint value
export type TripBoardingId = bigint;

/**
 * Validates that a value fits within 20 bits (0 to 1,048,575)
 * @param value - The value to validate
 * @param name - The name of the value for error reporting
 * @throws Error if the value is out of range
 */
const validateValue = (value: number, name: string): void => {
  if (value < 0 || value > MAX_VALUE) {
    throw new Error(`${name} must be between 0 and ${MAX_VALUE}, got ${value}`);
  }
};

/**
 * Encodes a stop index, route ID, and trip index into a single trip boarding ID.
 * @param stopIndex - The index of the stop within the route (0 to 1,048,575)
 * @param routeId - The route identifier (0 to 1,048,575)
 * @param tripIndex - The index of the trip within the route (0 to 1,048,575)
 * @returns The encoded trip ID as a bigint
 */
export const encode = (
  stopIndex: StopRouteIndex,
  routeId: RouteId,
  tripIndex: TripRouteIndex,
): TripBoardingId => {
  validateValue(stopIndex, 'stopIndex');
  validateValue(routeId, 'routeId');
  validateValue(tripIndex, 'tripIndex');

  return (
    (BigInt(stopIndex) << STOP_INDEX_SHIFT) |
    (BigInt(routeId) << ROUTE_ID_SHIFT) |
    (BigInt(tripIndex) << TRIP_INDEX_SHIFT)
  );
};

/**
 * Decodes a trip boarding ID back into its constituent stop index, route ID, and trip index.
 * @param tripBoardingId - The encoded trip ID
 * @returns A tuple containing [stopIndex, routeId, tripIndex]
 */
export const decode = (
  tripBoardingId: TripBoardingId,
): [StopRouteIndex, RouteId, TripRouteIndex] => {
  const stopIndex = Number((tripBoardingId >> STOP_INDEX_SHIFT) & VALUE_MASK);
  const routeId = Number((tripBoardingId >> ROUTE_ID_SHIFT) & VALUE_MASK);
  const tripIndex = Number((tripBoardingId >> TRIP_INDEX_SHIFT) & VALUE_MASK);

  return [stopIndex, routeId, tripIndex];
};

/**
 * Extracts just the stop index from a trip ID without full decoding.
 * @param tripBoardingId - The encoded trip boarding ID
 * @returns The stop index
 */
export const getStopIndex = (
  tripBoardingId: TripBoardingId,
): StopRouteIndex => {
  return Number((tripBoardingId >> STOP_INDEX_SHIFT) & VALUE_MASK);
};

/**
 * Extracts just the route ID from a trip ID without full decoding.
 * @param tripBoardingId - The encoded trip boarding ID
 * @returns The route ID
 */
export const getRouteId = (tripBoardingId: TripBoardingId): RouteId => {
  return Number((tripBoardingId >> ROUTE_ID_SHIFT) & VALUE_MASK);
};

/**
 * Extracts just the trip index from a trip ID without full decoding.
 * @param tripBoardingId - The encoded trip boarding ID
 * @returns The trip index
 */
export const getTripIndex = (
  tripBoardingId: TripBoardingId,
): TripRouteIndex => {
  return Number((tripBoardingId >> TRIP_INDEX_SHIFT) & VALUE_MASK);
};
