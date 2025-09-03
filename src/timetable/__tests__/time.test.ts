import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Duration } from '../duration.js';
import { Time } from '../time.js';

describe('Time', () => {
  describe('Static factory methods', () => {
    describe('infinity()', () => {
      it('should return a Time instance representing infinity', () => {
        const infinityTime = Time.infinity();
        assert.strictEqual(infinityTime.toMinutes(), Number.MAX_SAFE_INTEGER);
      });

      it('should return the same infinity value for multiple calls', () => {
        const infinity1 = Time.infinity();
        const infinity2 = Time.infinity();
        assert(infinity1.equals(infinity2));
      });
    });

    describe('origin()', () => {
      it('should return a Time instance representing midnight (0 minutes)', () => {
        const midnight = Time.origin();
        assert.strictEqual(midnight.toMinutes(), 0);
        assert.strictEqual(midnight.toString(), '00:00');
      });
    });

    describe('fromMinutes()', () => {
      it('should create a Time instance from minutes', () => {
        const time = Time.fromMinutes(120);
        assert.strictEqual(time.toMinutes(), 120);
        assert.strictEqual(time.toString(), '02:00');
      });

      it('should handle zero minutes', () => {
        const time = Time.fromMinutes(0);
        assert.strictEqual(time.toMinutes(), 0);
        assert.strictEqual(time.toString(), '00:00');
      });

      it('should handle minutes beyond 24 hours', () => {
        const time = Time.fromMinutes(1500); // 25 hours
        assert.strictEqual(time.toMinutes(), 1500);
        assert.strictEqual(time.toString(), '01:00'); // wraps around to next day
      });
    });

    describe('fromHMS()', () => {
      it('should create a Time instance from hours, minutes, and seconds', () => {
        const time = Time.fromHMS(14, 30, 45);
        assert.strictEqual(time.toMinutes(), 14 * 60 + 31); // rounds 30:45 to 31 minutes
        assert.strictEqual(time.toString(), '14:31');
      });

      it('should round seconds to the nearest minute', () => {
        const time1 = Time.fromHMS(10, 30, 29); // rounds down
        assert.strictEqual(time1.toMinutes(), 10 * 60 + 30);

        const time2 = Time.fromHMS(10, 30, 30); // rounds up
        assert.strictEqual(time2.toMinutes(), 10 * 60 + 31);
      });

      it('should handle midnight', () => {
        const time = Time.fromHMS(0, 0, 0);
        assert.strictEqual(time.toMinutes(), 0);
        assert.strictEqual(time.toString(), '00:00');
      });

      it('should throw error for negative values', () => {
        assert.throws(() => Time.fromHMS(-1, 0, 0), /Invalid time/);
        assert.throws(() => Time.fromHMS(0, -1, 0), /Invalid time/);
        assert.throws(() => Time.fromHMS(0, 0, -1), /Invalid time/);
      });

      it('should throw error for invalid minute values', () => {
        assert.throws(() => Time.fromHMS(10, 60, 0), /Invalid time/);
        assert.throws(() => Time.fromHMS(10, 65, 0), /Invalid time/);
      });

      it('should throw error for invalid second values', () => {
        assert.throws(() => Time.fromHMS(10, 30, 60), /Invalid time/);
        assert.throws(() => Time.fromHMS(10, 30, 75), /Invalid time/);
      });
    });

    describe('fromHM()', () => {
      it('should create a Time instance from hours and minutes', () => {
        const time = Time.fromHM(15, 45);
        assert.strictEqual(time.toMinutes(), 15 * 60 + 45);
        assert.strictEqual(time.toString(), '15:45');
      });

      it('should handle midnight', () => {
        const time = Time.fromHM(0, 0);
        assert.strictEqual(time.toMinutes(), 0);
        assert.strictEqual(time.toString(), '00:00');
      });

      it('should throw error for negative hours', () => {
        assert.throws(() => Time.fromHM(-1, 30), /Invalid time/);
      });

      it('should throw error for negative minutes', () => {
        assert.throws(() => Time.fromHM(10, -5), /Invalid time/);
      });

      it('should throw error for invalid minute values', () => {
        assert.throws(() => Time.fromHM(10, 60), /Invalid time/);
        assert.throws(() => Time.fromHM(10, 75), /Invalid time/);
      });
    });

    describe('fromDate()', () => {
      it('should create a Time instance from a Date object', () => {
        const date = new Date(2023, 5, 15, 14, 30, 45);
        const time = Time.fromDate(date);
        assert.strictEqual(time.toMinutes(), 14 * 60 + 31); // rounds seconds
        assert.strictEqual(time.toString(), '14:31');
      });

      it('should handle midnight date', () => {
        const date = new Date(2023, 5, 15, 0, 0, 0);
        const time = Time.fromDate(date);
        assert.strictEqual(time.toMinutes(), 0);
        assert.strictEqual(time.toString(), '00:00');
      });

      it('should handle date near end of day', () => {
        const date = new Date(2023, 5, 15, 23, 59, 30);
        const time = Time.fromDate(date);
        assert.strictEqual(time.toMinutes(), 24 * 60); // rounds up to next day
        assert.strictEqual(time.toString(), '00:00');
      });
    });

    describe('fromString()', () => {
      it('should parse HH:MM format', () => {
        const time = Time.fromString('14:30');
        assert.strictEqual(time.toMinutes(), 14 * 60 + 30);
        assert.strictEqual(time.toString(), '14:30');
      });

      it('should parse HH:MM:SS format', () => {
        const time = Time.fromString('14:30:45');
        assert.strictEqual(time.toMinutes(), 14 * 60 + 31); // rounds seconds
        assert.strictEqual(time.toString(), '14:31');
      });

      it('should handle midnight', () => {
        const time = Time.fromString('00:00');
        assert.strictEqual(time.toMinutes(), 0);
        assert.strictEqual(time.toString(), '00:00');
      });

      it('should handle single digit hours and minutes', () => {
        const time = Time.fromString('9:05');
        assert.strictEqual(time.toMinutes(), 9 * 60 + 5);
        assert.strictEqual(time.toString(), '09:05');
      });

      it('should throw error for invalid format', () => {
        assert.throws(
          () => Time.fromString('invalid'),
          /Input string must be in the format/,
        );
        assert.throws(() => Time.fromString('12:65'), /Invalid time/);
        assert.throws(() => Time.fromString('12:30:65'), /Invalid time/);
      });

      it('should throw error for missing components', () => {
        assert.throws(
          () => Time.fromString('14'),
          /Input string must be in the format/,
        );
        assert.throws(
          () => Time.fromString('14:'),
          /Input string must be in the format/,
        );
        assert.throws(
          () => Time.fromString(':30'),
          /Input string must be in the format/,
        );
      });

      it('should throw error for non-numeric values', () => {
        assert.throws(
          () => Time.fromString('ab:cd'),
          /Input string must be in the format/,
        );
        assert.throws(
          () => Time.fromString('12:ab'),
          /Input string must be in the format/,
        );
        assert.throws(
          () => Time.fromString('12:30:ab'),
          /Input string must be in the format/,
        );
      });
    });
  });

  describe('Instance methods', () => {
    describe('toString()', () => {
      it('should format time as HH:MM', () => {
        const time = Time.fromMinutes(14 * 60 + 30);
        assert.strictEqual(time.toString(), '14:30');
      });

      it('should pad single digits with zeros', () => {
        const time = Time.fromMinutes(9 * 60 + 5);
        assert.strictEqual(time.toString(), '09:05');
      });

      it('should handle midnight', () => {
        const time = Time.fromMinutes(0);
        assert.strictEqual(time.toString(), '00:00');
      });

      it('should wrap hours beyond 24', () => {
        const time = Time.fromMinutes(25 * 60 + 30); // 25:30
        assert.strictEqual(time.toString(), '01:30');
      });

      it('should handle exactly 24 hours', () => {
        const time = Time.fromMinutes(24 * 60);
        assert.strictEqual(time.toString(), '00:00');
      });
    });

    describe('toMinutes()', () => {
      it('should return the minutes since midnight', () => {
        const time = Time.fromMinutes(150);
        assert.strictEqual(time.toMinutes(), 150);
      });

      it('should return 0 for midnight', () => {
        const time = Time.origin();
        assert.strictEqual(time.toMinutes(), 0);
      });
    });

    describe('plus()', () => {
      it('should add duration to time', () => {
        const time = Time.fromMinutes(120); // 02:00
        const duration = Duration.fromMinutes(30);
        const result = time.plus(duration);
        assert.strictEqual(result.toMinutes(), 150); // 02:30
      });

      it('should handle adding duration with seconds', () => {
        const time = Time.fromMinutes(120);
        const duration = Duration.fromSeconds(90); // 1.5 minutes
        const result = time.plus(duration);
        assert.strictEqual(result.toMinutes(), 122); // rounds to nearest minute
      });

      it('should not modify original time', () => {
        const time = Time.fromMinutes(120);
        const duration = Duration.fromMinutes(30);
        time.plus(duration);
        assert.strictEqual(time.toMinutes(), 120); // original unchanged
      });
    });

    describe('minus()', () => {
      it('should subtract duration from time', () => {
        const time = Time.fromMinutes(150); // 02:30
        const duration = Duration.fromMinutes(30);
        const result = time.minus(duration);
        assert.strictEqual(result.toMinutes(), 120); // 02:00
      });

      it('should handle subtracting duration with seconds', () => {
        const time = Time.fromMinutes(150);
        const duration = Duration.fromSeconds(90); // 1.5 minutes
        const result = time.minus(duration);
        assert.strictEqual(result.toMinutes(), 149); // rounds to nearest minute
      });

      it('should wrap to previous day for negative results', () => {
        const time = Time.fromMinutes(30); // 00:30
        const duration = Duration.fromMinutes(60); // 1 hour
        const result = time.minus(duration);
        assert.strictEqual(result.toMinutes(), 23 * 60 + 30); // 23:30 previous day
      });

      it('should not modify original time', () => {
        const time = Time.fromMinutes(150);
        const duration = Duration.fromMinutes(30);
        time.minus(duration);
        assert.strictEqual(time.toMinutes(), 150); // original unchanged
      });
    });

    describe('diff()', () => {
      it('should return absolute difference between times', () => {
        const time1 = Time.fromMinutes(150); // 02:30
        const time2 = Time.fromMinutes(120); // 02:00
        const diff = time1.diff(time2);
        assert.strictEqual(diff.toSeconds(), 30 * 60); // 30 minutes
      });

      it('should return absolute difference regardless of order', () => {
        const time1 = Time.fromMinutes(120); // 02:00
        const time2 = Time.fromMinutes(150); // 02:30
        const diff = time1.diff(time2);
        assert.strictEqual(diff.toSeconds(), 30 * 60); // 30 minutes
      });

      it('should return zero for same times', () => {
        const time = Time.fromMinutes(120);
        const diff = time.diff(time);
        assert.strictEqual(diff.toSeconds(), 0);
      });
    });

    describe('Comparison methods', () => {
      describe('isAfter()', () => {
        it('should return true when time is after other time', () => {
          const time1 = Time.fromMinutes(150);
          const time2 = Time.fromMinutes(120);
          assert.strictEqual(time1.isAfter(time2), true);
        });

        it('should return false when time is before other time', () => {
          const time1 = Time.fromMinutes(120);
          const time2 = Time.fromMinutes(150);
          assert.strictEqual(time1.isAfter(time2), false);
        });

        it('should return false when times are equal', () => {
          const time1 = Time.fromMinutes(120);
          const time2 = Time.fromMinutes(120);
          assert.strictEqual(time1.isAfter(time2), false);
        });
      });

      describe('isBefore()', () => {
        it('should return true when time is before other time', () => {
          const time1 = Time.fromMinutes(120);
          const time2 = Time.fromMinutes(150);
          assert.strictEqual(time1.isBefore(time2), true);
        });

        it('should return false when time is after other time', () => {
          const time1 = Time.fromMinutes(150);
          const time2 = Time.fromMinutes(120);
          assert.strictEqual(time1.isBefore(time2), false);
        });

        it('should return false when times are equal', () => {
          const time1 = Time.fromMinutes(120);
          const time2 = Time.fromMinutes(120);
          assert.strictEqual(time1.isBefore(time2), false);
        });
      });

      describe('equals()', () => {
        it('should return true when times are equal', () => {
          const time1 = Time.fromMinutes(120);
          const time2 = Time.fromMinutes(120);
          assert.strictEqual(time1.equals(time2), true);
        });

        it('should return false when times are different', () => {
          const time1 = Time.fromMinutes(120);
          const time2 = Time.fromMinutes(150);
          assert.strictEqual(time1.equals(time2), false);
        });

        it('should work with times created differently but representing same time', () => {
          const time1 = Time.fromHM(2, 30);
          const time2 = Time.fromMinutes(150);
          assert.strictEqual(time1.equals(time2), true);
        });
      });
    });
  });

  describe('Static utility methods', () => {
    describe('max()', () => {
      it('should return the maximum time from multiple times', () => {
        const time1 = Time.fromMinutes(120);
        const time2 = Time.fromMinutes(180);
        const time3 = Time.fromMinutes(90);
        const maxTime = Time.max(time1, time2, time3);
        assert.strictEqual(maxTime.toMinutes(), 180);
      });

      it('should work with single time', () => {
        const time = Time.fromMinutes(120);
        const maxTime = Time.max(time);
        assert.strictEqual(maxTime.toMinutes(), 120);
      });

      it('should work with duplicate times', () => {
        const time1 = Time.fromMinutes(120);
        const time2 = Time.fromMinutes(120);
        const maxTime = Time.max(time1, time2);
        assert.strictEqual(maxTime.toMinutes(), 120);
      });

      it('should throw error for empty array', () => {
        assert.throws(
          () => Time.max(),
          /At least one Time instance is required/,
        );
      });

      it('should handle infinity time', () => {
        const time1 = Time.fromMinutes(120);
        const infinity = Time.infinity();
        const maxTime = Time.max(time1, infinity);
        assert.strictEqual(maxTime, infinity);
      });
    });

    describe('min()', () => {
      it('should return the minimum time from multiple times', () => {
        const time1 = Time.fromMinutes(120);
        const time2 = Time.fromMinutes(180);
        const time3 = Time.fromMinutes(90);
        const minTime = Time.min(time1, time2, time3);
        assert.strictEqual(minTime.toMinutes(), 90);
      });

      it('should work with single time', () => {
        const time = Time.fromMinutes(120);
        const minTime = Time.min(time);
        assert.strictEqual(minTime.toMinutes(), 120);
      });

      it('should work with duplicate times', () => {
        const time1 = Time.fromMinutes(120);
        const time2 = Time.fromMinutes(120);
        const minTime = Time.min(time1, time2);
        assert.strictEqual(minTime.toMinutes(), 120);
      });

      it('should throw error for empty array', () => {
        assert.throws(
          () => Time.min(),
          /At least one Time instance is required/,
        );
      });

      it('should handle origin time', () => {
        const time1 = Time.fromMinutes(120);
        const origin = Time.origin();
        const minTime = Time.min(time1, origin);
        assert.strictEqual(minTime, origin);
      });
    });
  });

  describe('Edge cases and special scenarios', () => {
    it('should handle times beyond 24 hours correctly', () => {
      const time = Time.fromMinutes(25 * 60); // 25:00
      assert.strictEqual(time.toMinutes(), 25 * 60);
      assert.strictEqual(time.toString(), '01:00'); // wraps to next day for display
    });

    it('should handle very large time values', () => {
      const largeTime = Time.fromMinutes(1000000);
      assert.strictEqual(largeTime.toMinutes(), 1000000);
    });

    it('should maintain precision with rounding', () => {
      const time = Time.fromHMS(10, 30, 29); // should round down
      assert.strictEqual(time.toMinutes(), 10 * 60 + 30);

      const time2 = Time.fromHMS(10, 30, 31); // should round up
      assert.strictEqual(time2.toMinutes(), 10 * 60 + 31);
    });

    it('should work with chained operations', () => {
      const time = Time.fromHM(10, 0)
        .plus(Duration.fromMinutes(30))
        .minus(Duration.fromMinutes(15));
      assert.strictEqual(time.toMinutes(), 10 * 60 + 15);
    });

    it('should handle comparison with infinity', () => {
      const normalTime = Time.fromMinutes(1000);
      const infinity = Time.infinity();

      assert.strictEqual(normalTime.isBefore(infinity), true);
      assert.strictEqual(infinity.isAfter(normalTime), true);
      assert.strictEqual(infinity.equals(normalTime), false);
    });
  });
});
