import log from 'loglevel';

import { durationFromSeconds } from '../timetable/time.js';
import { GtfsTime, toTime } from './time.js';
import { parseCsv } from './utils.js';

type FrequencyEntry = {
  trip_id: string;
  start_time: GtfsTime;
  end_time: GtfsTime;
  headway_secs: number;
  exact_times?: string;
};

export type FrequencyWindow = {
  /** Start time in minutes since midnight */
  startTime: number;
  /** End time (exclusive) in minutes since midnight */
  endTime: number;
  /** Headway in minutes */
  headwayMins: number;
};

/**
 * A map from a GTFS trip_id to the list of frequency windows that define
 * its repeated service pattern.
 */
export type FrequenciesMap = Map<string, FrequencyWindow[]>;

/**
 * Parses the frequencies.txt file from a GTFS feed.
 *
 * In GTFS, a frequency entry indicates that a trip departs repeatedly at
 * a fixed headway between start_time and end_time. The stop times in
 * stop_times.txt for that trip serve only as a template – each stop's
 * time offset relative to the first stop is preserved, while the absolute
 * departure times are generated from the frequency windows.
 *
 * @param stream The readable stream containing the frequencies.txt data.
 * @param activeTripIds The set of active trip IDs to filter by.
 *   Only frequency entries whose trip_id appears in this set are included.
 * @returns A map of trip IDs to their ordered list of frequency windows.
 */
export const parseFrequencies = async (
  stream: NodeJS.ReadableStream,
  activeTripIds: Set<string>,
): Promise<FrequenciesMap> => {
  const map: FrequenciesMap = new Map();

  for await (const rawLine of parseCsv(stream, ['headway_secs'])) {
    const line = rawLine as FrequencyEntry;

    if (!activeTripIds.has(line.trip_id)) {
      continue;
    }

    if (line.exact_times !== '1') {
      log.warn(`${line.trip_id} will be treated as a scheduled-based trip.`);
    }
    const window: FrequencyWindow = {
      startTime: toTime(line.start_time),
      endTime: toTime(line.end_time),
      headwayMins: durationFromSeconds(line.headway_secs),
    };

    const existing = map.get(line.trip_id);
    if (existing) {
      existing.push(window);
    } else {
      map.set(line.trip_id, [window]);
    }
  }

  return map;
};
