import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { StopId } from '../../stops/stops.js';
import { indexStops, ParsedStopsMap, parseStops } from '../stops.js';

describe('GTFS stops parser', () => {
  describe('parseStops', () => {
    it('should parse valid stops present in the source', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n',
      );
      mockedStream.push(
        '"Parent8587255","Fribourg, Tilleul/Cathédrale","46.8061375857565","7.16145029437328","1",""\n',
      );
      mockedStream.push(
        '"Parent8504100","Fribourg/Freiburg","46.8031492395272","7.15104780338173","1",""\n',
      );

      mockedStream.push(null);
      const parsedStops = await parseStops(mockedStream);

      assert.equal(parsedStops.size, 2);

      const stop1 = parsedStops.get('Parent8587255');
      assert.ok(stop1);
      assert.equal(stop1.id, 0);
      assert.equal(stop1.sourceStopId, 'Parent8587255');
      assert.equal(stop1.name, 'Fribourg, Tilleul/Cathédrale');
      assert.equal(stop1.lat, 46.8061375857565);
      assert.equal(stop1.lon, 7.16145029437328);
      assert.equal(stop1.locationType, 'STATION');
      assert.deepEqual(stop1.children, []);

      const stop2 = parsedStops.get('Parent8504100');
      assert.ok(stop2);
      assert.equal(stop2.id, 1);
      assert.equal(stop2.sourceStopId, 'Parent8504100');
      assert.equal(stop2.name, 'Fribourg/Freiburg');
      assert.equal(stop2.lat, 46.8031492395272);
      assert.equal(stop2.lon, 7.15104780338173);
      assert.equal(stop2.locationType, 'STATION');
      assert.deepEqual(stop2.children, []);
    });

    it('should parse nested stops', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n',
      );
      mockedStream.push(
        '"8504100:0:1","Fribourg/Freiburg","46.8018210323626","7.14993389242926","","Parent8504100"\n',
      );
      mockedStream.push(
        '"8504100:0:2","Fribourg/Freiburg","46.8010031847878","7.14920625704902","","Parent8504100"\n',
      );
      mockedStream.push(
        '"Parent8504100","Fribourg/Freiburg","46.8031492395272","7.15104780338173","1",""\n',
      );

      mockedStream.push(null);

      const parsedStops = await parseStops(mockedStream);

      assert.equal(parsedStops.size, 3);

      const parentStop = parsedStops.get('Parent8504100');
      assert.ok(parentStop);
      assert.equal(parentStop.id, 2);
      assert.equal(parentStop.sourceStopId, 'Parent8504100');
      assert.equal(parentStop.locationType, 'STATION');
      assert.deepEqual(parentStop.children, [0, 1]);

      const childStop1 = parsedStops.get('8504100:0:1');
      assert.ok(childStop1);
      assert.equal(childStop1.id, 0);
      assert.equal(childStop1.parent, 2);
      assert.equal(childStop1.locationType, 'SIMPLE_STOP_OR_PLATFORM');

      const childStop2 = parsedStops.get('8504100:0:2');
      assert.ok(childStop2);
      assert.equal(childStop2.id, 1);
      assert.equal(childStop2.parent, 2);
      assert.equal(childStop2.locationType, 'SIMPLE_STOP_OR_PLATFORM');
    });

    it('should parse the platform', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station,platform_code\n',
      );
      mockedStream.push(
        '"8504100:0:1","Fribourg/Freiburg","46.8018210323626","7.14993389242926","","Parent8504100","1"\n',
      );
      mockedStream.push(
        '"8504100:0:2","Fribourg/Freiburg","46.8010031847878","7.14920625704902","","Parent8504100","2"\n',
      );
      mockedStream.push(
        '"Parent8504100","Fribourg/Freiburg","46.8031492395272","7.15104780338173","1","",""\n',
      );

      mockedStream.push(null);

      const parsedStops = await parseStops(mockedStream);

      const childStop1 = parsedStops.get('8504100:0:1');
      assert.ok(childStop1);
      assert.equal(childStop1.platform, '1');

      const childStop2 = parsedStops.get('8504100:0:2');
      assert.ok(childStop2);
      assert.equal(childStop2.platform, '2');
    });
  });

  describe('indexStops', () => {
    it('should correctly index parsed stops', () => {
      const parsedStopsMap: ParsedStopsMap = new Map();

      parsedStopsMap.set('Parent8504100', {
        id: 0,
        sourceStopId: 'Parent8504100',
        name: 'Fribourg/Freiburg',
        lat: 46.8031492395272,
        lon: 7.15104780338173,
        locationType: 'STATION',
        children: [1, 2],
      });

      parsedStopsMap.set('8504100:0:1', {
        id: 1,
        sourceStopId: '8504100:0:1',
        name: 'Fribourg/Freiburg',
        lat: 46.8018210323626,
        lon: 7.14993389242926,
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
        parent: 0,
        platform: '1',
        parentSourceId: 'Parent8504100',
      });

      parsedStopsMap.set('8504100:0:2', {
        id: 2,
        sourceStopId: '8504100:0:2',
        name: 'Fribourg/Freiburg',
        lat: 46.8010031847878,
        lon: 7.14920625704902,
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
        parent: 0,
        platform: '2',
        parentSourceId: 'Parent8504100',
      });

      const indexedStops = indexStops(parsedStopsMap);

      assert.equal(indexedStops.size, 3);

      const station = indexedStops.get(0);
      assert.ok(station);
      assert.equal(station.sourceStopId, 'Parent8504100');
      assert.deepEqual(station.children, [1, 2]);

      const platform1 = indexedStops.get(1);
      assert.ok(platform1);
      assert.equal(platform1.sourceStopId, '8504100:0:1');
      assert.equal(platform1.platform, '1');
      assert.equal(platform1.parent, 0);

      const platform2 = indexedStops.get(2);
      assert.ok(platform2);
      assert.equal(platform2.sourceStopId, '8504100:0:2');
      assert.equal(platform2.platform, '2');
      assert.equal(platform2.parent, 0);
    });

    it('should filter stops based on validStops set', () => {
      const parsedStopsMap: ParsedStopsMap = new Map();

      parsedStopsMap.set('Parent8504100', {
        id: 0,
        sourceStopId: 'Parent8504100',
        name: 'Fribourg/Freiburg',
        lat: 46.8031492395272,
        lon: 7.15104780338173,
        locationType: 'STATION',
        children: [1, 2, 3],
      });

      parsedStopsMap.set('8504100:0:1', {
        id: 1,
        sourceStopId: '8504100:0:1',
        name: 'Fribourg/Freiburg',
        lat: 46.8018210323626,
        lon: 7.14993389242926,
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
        parent: 0,
        parentSourceId: 'Parent8504100',
      });

      parsedStopsMap.set('8504100:0:2', {
        id: 2,
        sourceStopId: '8504100:0:2',
        name: 'Fribourg/Freiburg',
        lat: 46.8010031847878,
        lon: 7.14920625704902,
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
        parent: 0,
        parentSourceId: 'Parent8504100',
      });

      parsedStopsMap.set('8504100:0:3', {
        id: 3,
        sourceStopId: '8504100:0:3',
        name: 'Fribourg/Freiburg',
        lat: 46.8,
        lon: 7.14,
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
        children: [],
        parent: 0,
        parentSourceId: 'Parent8504100',
      });
      const validStops = new Set<StopId>([1, 2]);

      const indexedStops = indexStops(parsedStopsMap, validStops);

      assert.equal(indexedStops.size, 3);
      assert.ok(indexedStops.has(0));
      assert.ok(indexedStops.has(1));
      assert.ok(indexedStops.has(2));
      assert.ok(!indexedStops.has(3));
    });
  });
});
