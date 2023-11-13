import assert from 'node:assert';
import { describe, it } from 'node:test';

import { chGtfsProfile } from '../ch.js';

describe('The swiss GTFS feed parser', () => {
  it('should extract the platform number from a stop entry', () => {
    assert.ok(chGtfsProfile.platformParser);
    assert.equal(
      chGtfsProfile.platformParser({
        stop_id: '8504100:0:1',
        stop_name: 'Fribourg/Freiburg',
        stop_lat: 46.8018210323626,
        stop_lon: 7.14993389242926,
        location_type: 1,
        parent_station: 'Parent8504100',
      }),
      '1',
    );
  });
  it('should not extract any platform number when not specified', () => {
    assert.ok(chGtfsProfile.platformParser);
    assert.equal(
      chGtfsProfile.platformParser({
        stop_id: 'Parent8587255',
        stop_name: 'Fribourg, Tilleul/Cathédrale',
        stop_lat: 46.8061375857565,
        stop_lon: 7.16145029437328,
        location_type: 1,
        parent_station: '',
      }),
      undefined,
    );
  });
  it('should convert the SBB route type to GTFS route type', () => {
    assert.ok(chGtfsProfile.routeTypeParser);
    assert.equal(chGtfsProfile.routeTypeParser(106), 'RAIL');
  });
  it('should not convert an unknown SBB route type', () => {
    assert.ok(chGtfsProfile.routeTypeParser);
    assert.equal(chGtfsProfile.routeTypeParser(716), undefined);
  });
});
