export class Duration {
  private totalSeconds: number;

  private constructor(totalSeconds: number) {
    this.totalSeconds = totalSeconds;
  }
  /**
   * Creates a Duration instance from a given number of seconds.
   *
   * @param seconds - The number of seconds for the duration.
   * @returns A Duration instance representing the specified duration.
   */
  static fromSeconds(seconds: number): Duration {
    return new Duration(seconds);
  }
  /**
   * Creates a Duration instance from a given number of minutes.
   *
   * @param minutes - The number of minutes for the duration.
   * @returns A Duration instance representing the specified duration.
   */
  static fromMinutes(minutes: number): Duration {
    return new Duration(minutes * 60);
  }
  /**
   * Gets a Duration instance representing zero duration (0 hours, 0 minutes, 0 seconds).
   *
   * @returns A Duration instance representing zero duration.
   */
  static zero(): Duration {
    return new Duration(0);
  }

  /**
   * Converts the duration instance to a string in "HH:MM:SS" format.
   *
   * @returns A string representing the duration.
   */
  toString(): string {
    const hours = Math.floor(this.totalSeconds / 3600);
    const minutes = Math.floor((this.totalSeconds % 3600) / 60);
    const seconds = this.totalSeconds % 60;
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes.toString().padStart(2, '0')}:${seconds
        .toString()
        .padStart(2, '0')}`;
    }
  }

  /**
   * Gets the duration as the number of seconds.
   *
   * @returns The duration in seconds.
   */
  toSeconds(): number {
    return this.totalSeconds;
  }

  /**
   * Adds another Duration to this instance and returns the result as a new Duration.
   *
   * @param other - The other Duration to add.
   * @returns A new Duration instance representing the sum.
   */
  add(other: Duration): Duration {
    const totalSeconds = this.totalSeconds + other.toSeconds();
    return new Duration(totalSeconds);
  }

  /**
   * Subtracts another Duration from this instance and returns the result as a new Duration.
   * If the result would be negative, it returns a Duration of 0 seconds.
   *
   * @param other - The other Duration to subtract.
   * @returns A new Duration instance representing the difference.
   */
  subtract(other: Duration): Duration {
    const totalSeconds = Math.max(0, this.totalSeconds - other.toSeconds());
    return new Duration(totalSeconds);
  }
}
