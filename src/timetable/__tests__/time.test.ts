import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  DURATION_ZERO,
  durationFromSeconds,
  durationToString,
  TIME_INFINITY,
  TIME_ORIGIN,
  timeFromDate,
  timeFromHM,
  timeFromHMS,
  timeFromString,
  timeToString,
} from '../time.js';

describe('time utilities', () => {
  describe('constants', () => {
    it('should expose time and duration constants', () => {
      assert.strictEqual(TIME_ORIGIN, 0);
      assert.strictEqual(DURATION_ZERO, 0);
      assert.strictEqual(TIME_INFINITY, Number.MAX_SAFE_INTEGER);
    });
  });

  describe('timeFromHMS', () => {
    it('should convert hours, minutes, seconds to minutes (rounded)', () => {
      assert.strictEqual(timeFromHMS(1, 2, 30), 63);
      assert.strictEqual(timeFromHMS(0, 0, 29), 0);
      assert.strictEqual(timeFromHMS(0, 0, 31), 1);
    });

    it('should throw on invalid values', () => {
      assert.throws(() => timeFromHMS(-1, 0, 0));
      assert.throws(() => timeFromHMS(0, -1, 0));
      assert.throws(() => timeFromHMS(0, 0, -1));
      assert.throws(() => timeFromHMS(0, 60, 0));
      assert.throws(() => timeFromHMS(0, 0, 60));
    });
  });

  describe('timeFromHM', () => {
    it('should convert hours and minutes to minutes', () => {
      assert.strictEqual(timeFromHM(0, 0), 0);
      assert.strictEqual(timeFromHM(1, 30), 90);
      assert.strictEqual(timeFromHM(25, 0), 1500);
    });

    it('should throw on invalid values', () => {
      assert.throws(() => timeFromHM(-1, 0));
      assert.throws(() => timeFromHM(0, -1));
      assert.throws(() => timeFromHM(0, 60));
    });
  });

  describe('timeFromDate', () => {
    it('should parse time from a Date object', () => {
      const date = new Date(2020, 0, 1, 12, 34, 56);
      assert.strictEqual(timeFromDate(date), timeFromHMS(12, 34, 56));
    });
  });

  describe('timeFromString', () => {
    it('should parse HH:MM and HH:MM:SS strings', () => {
      assert.strictEqual(timeFromString('01:05'), timeFromHM(1, 5));
      assert.strictEqual(timeFromString('10:20:30'), timeFromHMS(10, 20, 30));
    });

    it('should throw on invalid strings', () => {
      assert.throws(() => timeFromString(''));
      assert.throws(() => timeFromString('foo'));
      assert.throws(() => timeFromString('12'));
      assert.throws(() => timeFromString('12:'));
      assert.throws(() => timeFromString(':34'));
      assert.throws(() => timeFromString('12:xx'));
      assert.throws(() => timeFromString('12:34:xx'));
    });
  });

  describe('timeToString', () => {
    it('should format time as HH:MM', () => {
      assert.strictEqual(timeToString(0), '00:00');
      assert.strictEqual(timeToString(75), '01:15');
      assert.strictEqual(timeToString(1439), '23:59');
    });

    it('should wrap hours past 24', () => {
      assert.strictEqual(timeToString(1500), '01:00');
    });
  });

  describe('durationFromSeconds', () => {
    it('should convert seconds to minutes (rounded)', () => {
      assert.strictEqual(durationFromSeconds(0), 0);
      assert.strictEqual(durationFromSeconds(30), 1);
      assert.strictEqual(durationFromSeconds(90), 2);
    });
  });

  describe('durationToString', () => {
    it('should format short durations in minutes', () => {
      assert.strictEqual(durationToString(0), '0min');
      assert.strictEqual(durationToString(5), '5min');
      assert.strictEqual(durationToString(59), '59min');
    });

    it('should format long durations as HH:MM', () => {
      assert.strictEqual(durationToString(60), '01:00');
      assert.strictEqual(durationToString(135), '02:15');
    });
  });
});
