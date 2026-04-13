/**
 * A Time represented as minutes since midnight.
 * Note that this value can go beyond 1440 (24*60) to model services overlapping with the next day.
 */
export type Time = number;

/**
 * A Duration represented as minutes.
 */
export type Duration = number;

export const TIME_INFINITY: Time = Number.MAX_SAFE_INTEGER;
export const TIME_ORIGIN: Time = 0;

export const DURATION_ZERO: Duration = 0;

/**
 * Creates a Time from hours, minutes, and seconds.
 * Rounds to the closest minute as times are represented in minutes from midnight.
 *
 * @param hours - The hours component of the time.
 * @param minutes - The minutes component of the time.
 * @param seconds - The seconds component of the time.
 * @returns A Time representing the specified time.
 */
export const timeFromHMS = (
  hours: number,
  minutes: number,
  seconds: number,
): Time => {
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
  return Math.round(totalSeconds / 60);
};

/**
 * Creates a Time from hours and minutes.
 *
 * @param hours - The hours component of the time.
 * @param minutes - The minutes component of the time.
 * @returns A Time representing the specified time.
 */
export const timeFromHM = (hours: number, minutes: number): Time => {
  if (hours < 0 || minutes < 0 || minutes >= 60) {
    throw new Error('Invalid time. Ensure hours and minutes are valid values.');
  }
  return minutes + hours * 60;
};

/**
 * Parses a JavaScript Date object and creates a Time.
 *
 * @param date - A JavaScript Date object representing the time.
 * @returns A Time representing the parsed time.
 */
export const timeFromDate = (date: Date): Time => {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  return timeFromHMS(hours, minutes, seconds);
};

/**
 * Parses a time string in the format "HH:MM:SS" or "HH:MM" and creates a Time.
 *
 * @param timeStr - A string representing the time in "HH:MM:SS" or "HH:MM" format.
 * @returns A Time representing the parsed time.
 */
export const timeFromString = (timeStr: string): Time => {
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
  return timeFromHMS(hours, minutes, seconds);
};

/**
 * Converts a Time to a string in "HH:MM" format.
 * Hours wrap around at 24 (e.g., 25:30 becomes 01:30).
 *
 * @param time - The Time to convert.
 * @returns A string representing the time.
 */
export const timeToString = (time: Time): string => {
  let hours = Math.floor(time / 60);
  const minutes = Math.floor(time % 60);
  if (hours >= 24) {
    hours = hours % 24;
  }
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

/**
 * Creates a Duration from a given number of seconds.
 *
 * @param seconds - The number of seconds for the duration.
 * @returns A Duration representing the specified duration in minutes.
 */
export const durationFromSeconds = (seconds: number): Duration =>
  Math.round(seconds / 60);

/**
 * Converts a Duration to a string in "HH:MM" or "(M)Mmin" format.
 *
 * @param duration - The Duration to convert (in minutes).
 * @returns A string representing the duration.
 */
export const durationToString = (duration: Duration): string => {
  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}min`;
  }
};
