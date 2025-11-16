import assert from 'node:assert';
import { describe, it } from 'node:test';

import { RouteId, StopRouteIndex, TripRouteIndex } from '../route.js';
import {
  decode,
  encode,
  getRouteId,
  getStopIndex,
  getTripIndex,
} from '../tripBoardingId.js';

describe('tripBoardingId', () => {
  it('should maintain identity for encode/decode round-trip', () => {
    const testCases: [StopRouteIndex, RouteId, TripRouteIndex][] = [
      [0, 0, 0],
      [1, 1, 1],
      [500, 1000, 500],
      [100000, 200000, 300000],
      [0, 1048575, 0],
      [1048575, 0, 1048575],
      [1048575, 1048575, 1048575], // Maximum values (2^20 - 1)
    ];

    testCases.forEach(([stopIndex, routeId, tripIndex]) => {
      const tripBoardingId = encode(stopIndex, routeId, tripIndex);
      const [decodedStopIndex, decodedRouteId, decodedTripIndex] =
        decode(tripBoardingId);

      assert.strictEqual(decodedStopIndex, stopIndex);
      assert.strictEqual(decodedRouteId, routeId);
      assert.strictEqual(decodedTripIndex, tripIndex);
    });
  });

  it('should extract stop index correctly', () => {
    const tripBoardingId = encode(42, 100, 200);
    assert.strictEqual(getStopIndex(tripBoardingId), 42);
  });

  it('should extract route ID correctly', () => {
    const tripBoardingId = encode(42, 100, 200);
    assert.strictEqual(getRouteId(tripBoardingId), 100);
  });

  it('should extract trip index correctly', () => {
    const tripBoardingId = encode(42, 100, 200);
    assert.strictEqual(getTripIndex(tripBoardingId), 200);
  });

  it('should throw error for values exceeding 20-bit limit', () => {
    const maxValue = 1048575; // 2^20 - 1
    assert.throws(() => encode(maxValue + 1, 0, 0));
    assert.throws(() => encode(0, maxValue + 1, 0));
    assert.throws(() => encode(0, 0, maxValue + 1));
  });
});
