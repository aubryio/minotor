import assert from 'node:assert';
import { describe, it } from 'node:test';

import { RouteTypes } from '../../../timetable/timetable.js';
import { extendedGtfsProfile } from '../extended.js';

describe('The extended GTFS feed parser', () => {
  it('should convert the extended route type to GTFS route type', () => {
    assert.ok(extendedGtfsProfile.routeTypeParser);
    assert.equal(extendedGtfsProfile.routeTypeParser(106), RouteTypes.RAIL);
  });
  it('should not convert an unknown extended route type', () => {
    assert.ok(extendedGtfsProfile.routeTypeParser);
    assert.equal(extendedGtfsProfile.routeTypeParser(716), undefined);
  });
});
