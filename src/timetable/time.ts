import { Duration } from './duration.js';

/**
 * A class representing a time as minutes since midnight.
 */
export class Time {
  /*
   * Number of minutes since midnight.
   Note that this value can go beyond 3600 to model services overlapping with the next day.
   */
  private minutesSinceMidnight: number;
  /**
   * Gets the infinity time as a Time instance.
   * This represents a time that is conceptually beyond any real possible time.
   *
   * @returns A Time instance representing an "infinity" time.
   */
  static infinity(): Time {
    return new Time(Number.MAX_SAFE_INTEGER);
  }
  /**
   * Gets the midnight time as a Time instance.
   *
   * @returns A Time instance representing midnight.
   */
  static origin(): Time {
    return new Time(0);
  }

  private constructor(minutes: number) {
    this.minutesSinceMidnight = minutes;
  }

  /**
   * Creates a Time instance from the number of minutes since midnight.
   *
   * @param minutes - The number of minutes since midnight.
   * @returns A Time instance representing the specified time.
   */
  static fromMinutes(minutes: number): Time {
    return new Time(minutes);
  }

  /**
   * Creates a Time instance from hours, minutes, and seconds.
   * Rounds to the closest minute as times are represented in minutes from midnight.
   *
   * @param hours - The hours component of the time.
   * @param minutes - The minutes component of the time.
   * @param seconds - The seconds component of the time.
   * @returns A Time instance representing the specified time.
   */
  static fromHMS(hours: number, minutes: number, seconds: number): Time {
    if (
      hours < 0 ||
      minutes < 0 ||
      seconds < 0 ||
      minutes >= 60 ||
      seconds >= 60
    ) {
      throw new Error(
        'Invalid time. Ensure hours, minutes, and seconds are valid values.',
      );
    }
    const totalSeconds = seconds + 60 * minutes + 3600 * hours;
    const roundedMinutes = Math.round(totalSeconds / 60);
    return new Time(roundedMinutes);
  }

  /**
   * Creates a Time instance from hours, minutes.
   *
   * @param hours - The hours component of the time.
   * @param minutes - The minutes component of the time.
   * @returns A Time instance representing the specified time.
   */
  static fromHM(hours: number, minutes: number): Time {
    if (hours < 0 || minutes < 0 || minutes >= 60) {
      throw new Error(
        'Invalid time. Ensure hours and minutes are valid values.',
      );
    }
    return new Time(minutes + hours * 60);
  }

  /**
   * Parses a JavaScript Date object and creates a Time instance.
   *
   * @param date - A JavaScript Date object representing the time.
   * @returns A Time instance representing the parsed time.
   */
  static fromDate(date: Date): Time {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    return Time.fromHMS(hours, minutes, seconds);
  }

  /**
   * Parses a time string in the format "HH:MM:SS" or "HH:MM" and creates a Time instance.
   *
   * @param timeStr - A string representing the time in "HH:MM:SS" or "HH:MM" format.
   * @returns A Time instance representing the parsed time.
   */
  static fromString(timeStr: string): Time {
    const [hoursStr, minutesStr, secondsStr] = timeStr.split(':');
    if (
      hoursStr === undefined ||
      minutesStr === undefined ||
      hoursStr.trim() === '' ||
      minutesStr.trim() === '' ||
      isNaN(Number(hoursStr)) ||
      isNaN(Number(minutesStr)) ||
      (secondsStr !== undefined &&
        (secondsStr.trim() === '' || isNaN(Number(secondsStr))))
    ) {
      throw new Error(
        'Input string must be in the format "HH:MM:SS" or "HH:MM".',
      );
    }
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    const seconds = secondsStr !== undefined ? parseInt(secondsStr, 10) : 0;
    return Time.fromHMS(hours, minutes, seconds);
  }

  /**
   * Converts the Time instance to a string in "HH:MM:SS" format.
   *
   * @returns A string representing the time.
   */
  toString(): string {
    let hours = Math.floor(this.minutesSinceMidnight / 60);
    const minutes = Math.floor(this.minutesSinceMidnight % 60);
    if (hours >= 24) {
      hours = hours % 24;
    }
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  /**
   * Converts the Time instance to the total number of minutes since midnight, rounded to the closest minute.
   *
   * @returns The time in minutes since midnight.
   */
  toMinutes(): number {
    return this.minutesSinceMidnight;
  }

  /**
   * Adds a Duration to the current Time instance and returns a new Time instance.
   *
   * @param duration - A Duration instance representing the duration to add.
   * @returns A new Time instance with the added duration.
   */
  plus(duration: Duration): Time {
    const totalSeconds = this.minutesSinceMidnight * 60 + duration.toSeconds();
    return new Time(Math.round(totalSeconds / 60));
  }

  /**
   * Subtracts a Duration from the current Time instance and returns a new Time instance.
   *
   * @param duration - A Duration instance representing the duration to subtract.
   * @returns A new Time instance with the subtracted duration.
   */
  minus(duration: Duration): Time {
    let totalSeconds = this.minutesSinceMidnight * 60 - duration.toSeconds();
    if (totalSeconds < 0) {
      totalSeconds += 24 * 3600; // Adjust for negative time to loop back to previous day
    }
    return new Time(Math.round(totalSeconds / 60));
  }

  /**
   * Subtracts another Time instance from the current Time instance and returns the Duration.
   *
   * @param otherTime - A Time instance representing the time to subtract.
   * @returns A Duration instance representing the time difference.
   */
  diff(otherTime: Time): Duration {
    const totalMinutes = this.minutesSinceMidnight - otherTime.toMinutes();
    return Duration.fromSeconds(Math.abs(totalMinutes * 60));
  }

  /**
   * Computes the maximum Time instance among the provided Time instances.
   *
   * @param times - An array of Time instances to compare.
   * @returns A Time instance representing the maximum time.
   */
  static max(...times: Time[]): Time {
    if (times.length === 0) {
      throw new Error('At least one Time instance is required.');
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let maxTime = times[0]!;
    for (let i = 1; i < times.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (times[i]!.minutesSinceMidnight > maxTime.minutesSinceMidnight) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        maxTime = times[i]!;
      }
    }
    return maxTime;
  }

  /**
   * Computes the minimum Time instance among the provided Time instances.
   *
   * @param times - An array of Time instances to compare.
   * @returns A Time instance representing the minimum time.
   */
  static min(...times: Time[]): Time {
    if (times.length === 0) {
      throw new Error('At least one Time instance is required.');
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let minTime = times[0]!;
    for (let i = 1; i < times.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      if (times[i]!.minutesSinceMidnight < minTime.minutesSinceMidnight) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        minTime = times[i]!;
      }
    }
    return minTime;
  }

  /**
   * Determines if the current Time instance is after another Time instance.
   *
   * @param otherTime - A Time instance to compare against.
   * @returns True if the current Time instance is after the other Time instance, otherwise false.
   */
  isAfter(otherTime: Time): boolean {
    return this.minutesSinceMidnight > otherTime.minutesSinceMidnight;
  }

  /**
   * Determines if the current Time instance is before another Time instance.
   *
   * @param otherTime - A Time instance to compare against.
   * @returns True if the current Time instance is before the other Time instance, otherwise false.
   */
  isBefore(otherTime: Time): boolean {
    return this.minutesSinceMidnight < otherTime.minutesSinceMidnight;
  }

  /**
   * Determines if the current Time instance is equal to another Time instance.
   *
   * @param otherTime - A Time instance to compare against.
   * @returns True if the current Time instance is equal to the other Time instance, otherwise false.
   */
  equals(otherTime: Time): boolean {
    return this.minutesSinceMidnight === otherTime.minutesSinceMidnight;
  }
}
