import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { Stop } from '../stops.js';
import { StopsIndex } from '../stopsIndex.js';
const mockStops: Stop[] = [
  {
    id: 0,
    sourceStopId: '8587255',
    name: 'Fribourg, Tilleul/Cathédrale',
    lat: 46.8061375857565,
    lon: 7.16145029437328,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 1,
    sourceStopId: '8592383',
    name: 'Fribourg, Neuveville/Court-Ch.',
    lat: 46.8042990960992,
    lon: 7.16060587800609,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 2,
    sourceStopId: '8592386',
    name: 'Fribourg, Petit-St-Jean',
    lat: 46.8035550740648,
    lon: 7.16806189486532,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  },
  {
    id: 3,
    sourceStopId: 'Parent8504100',
    name: 'Fribourg/Freiburg',
    lat: 46.8031492395272,
    lon: 7.15104780338173,
    children: [4, 5, 6],
    locationType: 'STATION',
  },
  {
    id: 4,
    sourceStopId: '8504100:0:1',
    name: 'Fribourg/Freiburg',
    lat: 46.8031492395272,
    lon: 7.15104780338173,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
    parent: 3,
  },
  {
    id: 5,
    sourceStopId: '8504100:0:1AB',
    name: 'Fribourg/Freiburg',
    lat: 46.8031492395272,
    lon: 7.15104780338173,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
    parent: 3,
  },
  {
    id: 6,
    sourceStopId: '8504100:0:2',
    name: 'Fribourg/Freiburg',
    lat: 46.8031492395272,
    lon: 7.15104780338173,
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
    parent: 3,
  },
];

describe('Stop Finder', () => {
  let stopFinder: StopsIndex;

  beforeEach(() => {
    stopFinder = new StopsIndex(mockStops);
  });

  describe('findStopsByName', () => {
    it('should find stops by exact name', () => {
      const results = stopFinder.findStopsByName(
        'Fribourg, Tilleul/Cathédrale',
      );
      assert.strictEqual(results[0]?.id, 0);
    });

    it('should not include children stops', () => {
      const results = stopFinder.findStopsByName('Fribourg/Freiburg', 2);
      assert.strictEqual(results[0]?.id, 3);
      assert.strictEqual(results[1]?.id, 0);
    });

    it('should find stops by partial name', () => {
      const results = stopFinder.findStopsByName('Cathédrale');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.id, 0);
    });

    it('should find stops by name with accents', () => {
      const results = stopFinder.findStopsByName('Cathedrale');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.id, 0);
    });

    it('should return an empty array if no stops match the query', () => {
      const results = stopFinder.findStopsByName('Nonexistent Stop');
      assert.strictEqual(results.length, 0);
    });
  });

  describe('findStopsByLocation', () => {
    it('should find stops by geographic location', () => {
      const results = stopFinder.findStopsByLocation(46.8061, 7.1614, 1);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0]?.id, 0);
    });

    it('should find multiple stops within the radius', () => {
      const results = stopFinder.findStopsByLocation(46.8, 7.16, 10, 0.75);
      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0]?.id, 1);
      assert.strictEqual(results[1]?.id, 0);
      assert.strictEqual(results[2]?.id, 2);
    });

    it('should find the N closest stops', () => {
      const results = stopFinder.findStopsByLocation(46.8, 7.16, 2, 10);
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0]?.id, 1);
      assert.strictEqual(results[1]?.id, 0);
    });

    it('should return an empty array if no stops are within the radius', () => {
      const results = stopFinder.findStopsByLocation(0, 0);
      assert.strictEqual(results.length, 0);
    });
  });

  describe('fromData', () => {
    it('should deserialize stops data and create a StopFinder instance', () => {
      const serializedData = stopFinder.serialize();
      const deserializedStopFinder = StopsIndex.fromData(serializedData);
      const results = deserializedStopFinder.findStopsByName('Fribourg');
      assert.strictEqual(results.length, 4);
    });
  });

  describe('equivalentStops', () => {
    it('should find equivalent stops for a given stop ID', () => {
      const equivalentStops = stopFinder.equivalentStops('8504100:0:1');
      assert.deepStrictEqual(
        equivalentStops.map((stop) => stop.id),
        [4, 5, 6],
      );
    });

    it('should return the same stop ID in an array if no equivalents', () => {
      const equivalentStops = stopFinder.equivalentStops('8587255');
      assert.deepStrictEqual(
        equivalentStops.map((stop) => stop.id),
        [0],
      );
    });

    it('should return an empty array for non-existent stop ID', () => {
      const equivalentStops = stopFinder.equivalentStops('999');
      assert.deepStrictEqual(equivalentStops, []);
    });
  });
});
