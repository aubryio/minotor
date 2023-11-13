import assert from 'node:assert';
import { describe, it } from 'node:test';

import { deserializeStopsMap, serializeStopsMap } from '../io.js';
import { StopsMap } from '../stops.js';

describe('stops io', () => {
  const stopsMap: StopsMap = new Map([
    [
      'stop1',
      {
        id: 'stop1',
        name: 'Stop 1',
        lat: 40.712776,
        lon: -74.005974,
        children: ['stop2'],
        parent: 'parentStop',
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        platform: 'Platform 1',
      },
    ],
    [
      'stop2',
      {
        id: 'stop2',
        name: 'Stop 2',
        lat: 34.052235,
        lon: -118.243683,
        children: [],
        parent: 'stop1',
        locationType: 'STATION',
        platform: 'Platform 2',
      },
    ],
  ]);

  it('should serialize and deserialize stops correctly', () => {
    const serializedData = serializeStopsMap(stopsMap);
    const deserializedStopsMap = deserializeStopsMap(serializedData);

    assert.deepStrictEqual(deserializedStopsMap, stopsMap);
  });
});
