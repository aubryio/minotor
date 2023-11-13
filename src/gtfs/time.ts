import { DateTime } from 'luxon';

import { Time } from '../timetable/time.js';

export type GtfsDate = number;
export type GtfsTime = string;

export const toGtfsDate = (date: DateTime): GtfsDate => {
  return parseInt(date.toFormat('yyyyLLdd'));
};

/**
 * Converts a time string in the format 'HH:mm:ss' to a Time object
 * (number of seconds since midnight).
 *
 * This method splits the input time string into hours, minutes, and seconds,
 * and then calculates the total number of seconds.
 *
 * @param time - A string representing the time in 'HH:mm:ss' format.
 * @returns The GTFS time as the number of seconds since midnight.
 * @throws An error if the input time string is not in the correct format.
 */
export const toTime = (time: GtfsTime): Time => {
  const splits = time.split(':');
  if (!splits[0] || !splits[1] || !splits[2]) {
    throw new Error(`Invalid time ${time}.`);
  }
  return Time.fromHMS(
    parseInt(splits[0]),
    parseInt(splits[1]),
    parseInt(splits[2]),
  );
};
