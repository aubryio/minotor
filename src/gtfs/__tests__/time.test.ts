import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DateTime } from 'luxon';

import { toGtfsDate, toTime } from '../time.js';

describe('Date converter', () => {
  it('should convert a valid date to GTFS format', () => {
    assert.equal(
      toGtfsDate(DateTime.fromISO('2007-01-10T12:00:00+00:00')),
      20070110,
    );
  });
});

describe('Time converter', () => {
  it('should convert a valid service time to numerical format', () => {
    assert.equal(toTime('10:23:54').toSeconds(), 37434);
  });
  it('should convert a valid service time after midnight to numerical format', () => {
    assert.equal(toTime('25:13:31').toSeconds(), 90811);
  });
  it('should throw when trying to convert an invalid time', () => {
    assert.throws(() => toTime('2513:31'));
  });
});
