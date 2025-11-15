import assert from 'node:assert';
import { describe, it } from 'node:test';

import { RouteId, TripRouteIndex } from '../route.js';
import { decode, encode } from '../tripId.js';

describe('tripId', () => {
  it('should maintain identity for encode/decode round-trip', () => {
    const testCases: [RouteId, TripRouteIndex][] = [
      [0, 0],
      [1, 1],
      [1000, 500],
      [65535, 32767],
      [131071, 0],
      [0, 32767],
      [(1 << 17) - 1, (1 << 15) - 1], // Maximum values
    ];

    testCases.forEach(([routeId, tripIndex]) => {
      const tripId = encode(routeId, tripIndex);
      const [decodedRouteId, decodedTripIndex] = decode(tripId);

      assert.strictEqual(decodedRouteId, routeId);
      assert.strictEqual(decodedTripIndex, tripIndex);
    });
  });
});
