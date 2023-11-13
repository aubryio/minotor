import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { StopsMap } from '../../stops/stops.js';
import { chGtfsProfile } from '../profiles/ch.js';
import { parseStops } from '../stops.js';

describe('GTFS stops parser', () => {
  describe('parsing a well formed stream', () => {
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
      const stops = await parseStops(
        mockedStream,
        chGtfsProfile.platformParser,
      );
      const expectedStops: StopsMap = new Map([
        [
          'Parent8587255',
          {
            id: 'Parent8587255',
            lat: 46.8061375857565,
            locationType: 'STATION',
            lon: 7.16145029437328,
            name: 'Fribourg, Tilleul/Cathédrale',
            children: [],
          },
        ],
        [
          'Parent8504100',
          {
            id: 'Parent8504100',
            lat: 46.8031492395272,
            locationType: 'STATION',
            lon: 7.15104780338173,
            name: 'Fribourg/Freiburg',
            children: [],
          },
        ],
      ]);

      assert.deepEqual(stops, expectedStops);
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

      const stops = await parseStops(mockedStream);
      const expectedStops: StopsMap = new Map([
        [
          '8504100:0:1',
          {
            id: '8504100:0:1',
            lat: 46.8018210323626,
            lon: 7.14993389242926,
            name: 'Fribourg/Freiburg',
            parent: 'Parent8504100',
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          '8504100:0:2',
          {
            id: '8504100:0:2',
            lat: 46.8010031847878,
            lon: 7.14920625704902,
            name: 'Fribourg/Freiburg',
            parent: 'Parent8504100',
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'Parent8504100',
          {
            id: 'Parent8504100',
            children: ['8504100:0:1', '8504100:0:2'],
            lat: 46.8031492395272,
            locationType: 'STATION',
            lon: 7.15104780338173,
            name: 'Fribourg/Freiburg',
          },
        ],
      ]);

      assert.deepEqual(stops, expectedStops);
    });
    it('should parse the platform', async () => {
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

      const stops = await parseStops(
        mockedStream,
        chGtfsProfile.platformParser,
      );
      const expectedStops: StopsMap = new Map([
        [
          '8504100:0:1',
          {
            id: '8504100:0:1',
            lat: 46.8018210323626,
            lon: 7.14993389242926,
            name: 'Fribourg/Freiburg',
            parent: 'Parent8504100',
            platform: '1',
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          '8504100:0:2',
          {
            id: '8504100:0:2',
            lat: 46.8010031847878,
            lon: 7.14920625704902,
            name: 'Fribourg/Freiburg',
            parent: 'Parent8504100',
            platform: '2',
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'Parent8504100',
          {
            id: 'Parent8504100',
            children: ['8504100:0:1', '8504100:0:2'],
            lat: 46.8031492395272,
            locationType: 'STATION',
            lon: 7.15104780338173,
            name: 'Fribourg/Freiburg',
          },
        ],
      ]);

      assert.deepEqual(stops, expectedStops);
    });
  });
});
