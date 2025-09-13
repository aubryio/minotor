import assert from 'node:assert';
import { describe, it } from 'node:test';

import { chGtfsProfile } from '../ch.js';

describe('The swiss GTFS feed parser', () => {
  it('should convert the SBB route type to GTFS route type', () => {
    assert.ok(chGtfsProfile.routeTypeParser);
    assert.equal(chGtfsProfile.routeTypeParser(106), 'RAIL');
  });
  it('should not convert an unknown SBB route type', () => {
    assert.ok(chGtfsProfile.routeTypeParser);
    assert.equal(chGtfsProfile.routeTypeParser(716), undefined);
  });
});
