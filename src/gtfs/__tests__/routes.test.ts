import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { parseRoutes } from '../routes.js';

describe('GTFS routes parser', () => {
  describe('parsing a well formed stream', () => {
    it('should find valid routes present in the source', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type\n',
      );
      mockedStream.push('"routeA","agencyA","B1","BUS 1","A bus","3"\n');
      mockedStream.push('"routeB","agencyB","T1","TRAM 1","A tram","0"\n');
      mockedStream.push(null);

      const routes = await parseRoutes(mockedStream);
      assert.deepEqual(
        routes,
        new Map([
          [
            'routeA',
            {
              type: 'BUS',
              name: 'B1',
              routes: [],
            },
          ],
          [
            'routeB',
            {
              type: 'TRAM',
              name: 'T1',
              routes: [],
            },
          ],
        ]),
      );
    });
    it('should ignore routes with invalid route type', async () => {
      const mockedStream = new Readable();
      mockedStream.push(
        'route_id,agency_id,route_short_name,route_long_name,route_desc,route_type\n',
      );
      mockedStream.push('"routeA","agencyA","B1","BUS 1","A bus","3"\n');
      mockedStream.push('"routeB","agencyB","T1","TRAM 1","A tram","8"\n');
      mockedStream.push(null);

      const routes = await parseRoutes(mockedStream);
      assert.deepEqual(
        routes,
        new Map([
          [
            'routeA',
            {
              type: 'BUS',
              name: 'B1',
              routes: [],
            },
          ],
        ]),
      );
    });
  });
});
