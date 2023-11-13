import { Duration } from './duration.js';

/**
 * A class representing a time in hours, minutes, and seconds.
 */
export class Time {
  private secondsSinceMidnight: number;
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
   * @returns A Time instance representing midnight (00:00:00).
   */
  static origin(): Time {
    return new Time(0);
  }

  private constructor(seconds: number) {
    this.secondsSinceMidnight = seconds;
  }

  /**
   * Creates a Time instance from the number of seconds since midnight.
   *
   * @param seconds - The number of seconds since midnight.
   * @returns A Time instance representing the specified time.
   */
  static fromSeconds(seconds: number): Time {
    return new Time(seconds);
  }

  /**
   * Creates a Time instance from hours, minutes, and seconds.
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
    return new Time(seconds + 60 * minutes + 3600 * hours);
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
    return new Time(seconds + 60 * minutes + 3600 * hours);
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
      isNaN(Number(hoursStr)) ||
      isNaN(Number(minutesStr)) ||
      (secondsStr !== undefined && isNaN(Number(secondsStr)))
    ) {
      throw new Error(
        'Input string must be in the format "HH:MM:SS" or "HH:MM".',
      );
    }
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    const seconds = secondsStr !== undefined ? parseInt(secondsStr, 10) : 0;
    return new Time(seconds + 60 * minutes + 3600 * hours);
  }

  /**
   * Converts the Time instance to a string in "HH:MM:SS" format.
   *
   * @returns A string representing the time.
   */
  toString(): string {
    const hours = Math.floor(this.secondsSinceMidnight / 3600);
    const minutes = Math.floor((this.secondsSinceMidnight % 3600) / 60);
    const seconds = this.secondsSinceMidnight % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Gets the time as the number of seconds since midnight.
   *
   * @returns The time in seconds since midnight.
   */
  toSeconds(): number {
    return this.secondsSinceMidnight;
  }
  /**
   * Adds a Duration to the current Time instance and returns a new Time instance.
   *
   * @param duration - A Duration instance representing the duration to add.
   * @returns A new Time instance with the added duration.
   */
  plus(duration: Duration): Time {
    const totalSeconds = this.secondsSinceMidnight + duration.toSeconds();
    return new Time(totalSeconds);
  }

  /**
   * Subtracts a Duration from the current Time instance and returns a new Time instance.
   *
   * @param duration - A Duration instance representing the duration to subtract.
   * @returns A new Time instance with the subtracted duration.
   */
  minus(duration: Duration): Time {
    let totalSeconds = this.secondsSinceMidnight - duration.toSeconds();
    if (totalSeconds < 0) {
      totalSeconds += 24 * 3600; // Adjust for negative time to loop back to previous day
    }
    return new Time(totalSeconds);
  }

  /**
   * Subtracts another Time instance from the current Time instance and returns the Duration.
   *
   * @param otherTime - A Time instance representing the time to subtract.
   * @returns A Duration instance representing the time difference.
   */
  diff(otherTime: Time): Duration {
    const totalSeconds = this.secondsSinceMidnight - otherTime.toSeconds();
    return Duration.fromSeconds(Math.abs(totalSeconds));
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
    return times.reduce((maxTime, currentTime) => {
      return currentTime.toSeconds() > maxTime.toSeconds()
        ? currentTime
        : maxTime;
    });
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
    return times.reduce((minTime, currentTime) => {
      return currentTime.toSeconds() < minTime.toSeconds()
        ? currentTime
        : minTime;
    });
  }
}
