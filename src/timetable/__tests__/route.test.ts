import assert from 'node:assert';
import { describe, it } from 'node:test';

import { encodePickUpDropOffTypes } from '../../gtfs/trips.js';
import {
  MUST_COORDINATE_WITH_DRIVER,
  MUST_PHONE_AGENCY,
  NOT_AVAILABLE,
  REGULAR,
  Route,
} from '../route.js';
import { TIME_ORIGIN, timeFromHMS } from '../time.js';

describe('Route', () => {
  const stopTimes = new Uint16Array([
    // Trip 0: Stop 1 -> Stop 2
    timeFromHMS(8, 0, 0),
    timeFromHMS(8, 1, 0),
    timeFromHMS(8, 30, 0),
    timeFromHMS(8, 31, 0),
    // Trip 1: Stop 1 -> Stop 2
    timeFromHMS(9, 0, 0),
    timeFromHMS(9, 1, 0),
    timeFromHMS(9, 30, 0),
    timeFromHMS(9, 31, 0),
    // Trip 2: Stop 1 -> Stop 2
    timeFromHMS(10, 0, 0),
    timeFromHMS(10, 1, 0),
    timeFromHMS(10, 30, 0),
    timeFromHMS(10, 31, 0),
  ]);

  const pickupDropOffTypes = encodePickUpDropOffTypes(
    [
      // Trip 0
      REGULAR,
      NOT_AVAILABLE,
      // Trip 1
      REGULAR,
      REGULAR,
      // Trip 2
      MUST_PHONE_AGENCY,
      MUST_COORDINATE_WITH_DRIVER,
    ],
    [
      // Trip 0
      REGULAR,
      REGULAR,
      // Trip 1
      REGULAR,
      REGULAR,
      // Trip 2
      REGULAR,
      REGULAR,
    ],
  );

  const stops = new Uint32Array([1001, 1002]);
  const serviceRouteId = 0;

  const route = new Route(
    0,
    stopTimes,
    pickupDropOffTypes,
    stops,
    serviceRouteId,
  );

  describe('constructor', () => {
    it('should create a route with correct properties', () => {
      assert.strictEqual(route.getNbStops(), 2);
      assert.strictEqual(route.serviceRoute(), serviceRouteId);
    });

    it('should handle empty route', () => {
      const emptyRoute = new Route(
        0,
        new Uint16Array([]),
        new Uint8Array([]),
        new Uint32Array([]),
        1,
      );
      assert.strictEqual(emptyRoute.getNbStops(), 0);
      assert.strictEqual(emptyRoute.serviceRoute(), 1);
    });
  });

  describe('serialize', () => {
    it('should serialize route data correctly', () => {
      const serialized = route.serialize();
      assert.deepStrictEqual(serialized.stopTimes, stopTimes);
      assert.deepStrictEqual(serialized.pickupDropOffTypes, pickupDropOffTypes);
      assert.deepStrictEqual(serialized.stops, stops);
      assert.strictEqual(serialized.serviceRouteId, serviceRouteId);
    });
  });

  describe('getNbStops', () => {
    it('should return correct number of stops', () => {
      assert.strictEqual(route.getNbStops(), 2);
    });
  });

  describe('serviceRoute', () => {
    it('should return correct service route ID', () => {
      assert.strictEqual(route.serviceRoute(), serviceRouteId);
    });
  });

  describe('arrivalAt', () => {
    it('should return correct arrival time for trip 0 at stop index 0', () => {
      const arrival = route.arrivalAt(0, 0);
      assert.strictEqual(arrival, timeFromHMS(8, 0, 0));
    });

    it('should return correct arrival time for trip 1 at stop index 1', () => {
      const arrival = route.arrivalAt(1, 1);
      assert.strictEqual(arrival, timeFromHMS(9, 30, 0));
    });

    it('should throw error for invalid stop index', () => {
      assert.throws(
        () => route.arrivalAt(999, 0),
        /StopId for stop at index 999 not found/,
      );
    });

    it('should throw error for invalid trip index', () => {
      assert.throws(() => route.arrivalAt(0, 999), /Arrival time not found/);
    });
  });

  describe('departureFrom', () => {
    it('should return correct departure time for trip 0 at stop index 0', () => {
      const departure = route.departureFrom(0, 0);
      assert.strictEqual(departure, timeFromHMS(8, 1, 0));
    });

    it('should return correct departure time for trip 2 at stop index 1', () => {
      const departure = route.departureFrom(1, 2);
      assert.strictEqual(departure, timeFromHMS(10, 31, 0));
    });

    it('should throw error for invalid stop index', () => {
      assert.throws(
        () => route.departureFrom(999, 0),
        /StopId for stop at index 999 not found/,
      );
    });

    it('should throw error for invalid trip index', () => {
      assert.throws(
        () => route.departureFrom(0, 999),
        /Departure time not found/,
      );
    });
  });

  describe('pickUpTypeFrom', () => {
    it('should return REGULAR pickup type for trip 0 at stop index 0', () => {
      const pickUpType = route.pickUpTypeFrom(0, 0);
      assert.strictEqual(pickUpType, REGULAR);
    });

    it('should return NOT_AVAILABLE pickup type for trip 0 at stop index 1', () => {
      const pickUpType = route.pickUpTypeFrom(1, 0);
      assert.strictEqual(pickUpType, NOT_AVAILABLE);
    });

    it('should return MUST_PHONE_AGENCY pickup type for trip 2 at stop index 0', () => {
      const pickUpType = route.pickUpTypeFrom(0, 2);
      assert.strictEqual(pickUpType, MUST_PHONE_AGENCY);
    });

    it('should throw error for invalid stop index', () => {
      assert.throws(
        () => route.pickUpTypeFrom(999, 0),
        /StopId for stop at index 999 not found/,
      );
    });

    it('should throw error for invalid trip index', () => {
      assert.throws(
        () => route.pickUpTypeFrom(0, 999),
        /Pick up type not found/,
      );
    });
  });

  describe('dropOffTypeAt', () => {
    it('should return REGULAR drop off type for trip 0 at stop index 0', () => {
      const dropOffType = route.dropOffTypeAt(0, 0);
      assert.strictEqual(dropOffType, REGULAR);
    });

    it('should return REGULAR drop off type for trip 1 at stop index 1', () => {
      const dropOffType = route.dropOffTypeAt(1, 1);
      assert.strictEqual(dropOffType, REGULAR);
    });

    it('should throw error for invalid stop index', () => {
      assert.throws(
        () => route.dropOffTypeAt(999, 0),
        /StopId for stop at index 999 not found/,
      );
    });

    it('should throw error for invalid trip index', () => {
      assert.throws(
        () => route.dropOffTypeAt(0, 999),
        /Drop off type not found/,
      );
    });
  });

  describe('findEarliestTrip', () => {
    it('should find earliest trip without time constraint', () => {
      const tripIndex = route.findEarliestTrip(0);
      assert.strictEqual(tripIndex, 0);
    });

    it('should find earliest trip after specified time', () => {
      const afterTime = timeFromHMS(8, 30, 0);
      const tripIndex = route.findEarliestTrip(0, afterTime);
      assert.strictEqual(tripIndex, 1);
    });

    it('should find earliest trip with exact match time', () => {
      const afterTime = timeFromHMS(9, 1, 0);
      const tripIndex = route.findEarliestTrip(0, afterTime);
      assert.strictEqual(tripIndex, 1);
    });

    it('should return undefined when no trip is available after specified time', () => {
      const afterTime = timeFromHMS(23, 0, 0);
      const tripIndex = route.findEarliestTrip(0, afterTime);
      assert.strictEqual(tripIndex, undefined);
    });

    it('should find earliest trip', () => {
      const tripIndex = route.findEarliestTrip(1);
      // findEarliestTrip only filters by time, not pickup type
      assert.strictEqual(tripIndex, 0);
    });

    it('should respect beforeTrip constraint', () => {
      const tripIndex = route.findEarliestTrip(0, timeFromHMS(8, 2, 0), 1);
      assert.strictEqual(tripIndex, undefined);
    });

    it('should return undefined when beforeTrip is 0', () => {
      const tripIndex = route.findEarliestTrip(0, TIME_ORIGIN, 0);
      assert.strictEqual(tripIndex, undefined);
    });

    it('should handle MUST_PHONE_AGENCY pickup type', () => {
      const afterTime = timeFromHMS(9, 30, 0);
      const tripIndex = route.findEarliestTrip(0, afterTime);
      // Should find trip 2 even though it requires phone agency
      assert.strictEqual(tripIndex, 2);
    });

    it('should throw error for invalid stop index', () => {
      assert.throws(
        () => route.findEarliestTrip(999),
        /StopId for stop at index 999 not found/,
      );
    });
  });

  describe('stopRouteIndices', () => {
    it('should return correct stop route indices for existing stop', () => {
      const indices = route.stopRouteIndices(1001);
      assert.deepStrictEqual(indices, [0]);
    });

    it('should return correct stop route indices for second stop', () => {
      const indices = route.stopRouteIndices(1002);
      assert.deepStrictEqual(indices, [1]);
    });

    it('should return empty array for non-existent stop', () => {
      const indices = route.stopRouteIndices(9999);
      assert.deepStrictEqual(indices, []);
    });
  });
});
