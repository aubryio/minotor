import { DateTime } from 'luxon';

import { toGtfsDate } from './time.js';
import { parseCsv } from './utils.js';

export type ServiceId = string;
export type ServiceIds = Set<ServiceId>;

type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type ActiveFlag = 0 | 1;
type RawGtfsDate = number;
type ExceptionType = 1 | 2;

type CalendarEntry = {
  service_id: string;
  monday: ActiveFlag;
  tuesday: ActiveFlag;
  wednesday: ActiveFlag;
  thursday: ActiveFlag;
  friday: ActiveFlag;
  saturday: ActiveFlag;
  sunday: ActiveFlag;
  start_date: RawGtfsDate;
  end_date: RawGtfsDate;
};

type CalendarDatesEntry = {
  service_id: ServiceId;
  date: RawGtfsDate;
  exception_type: ExceptionType;
};

const weekdays = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};

/**
 * Parses a GTFS calendar.txt file and finds the service_ids of a given date.
 *
 * @param serviceIds A map of the active service ids (will be populated with active service_ids).
 * @param date The active date.
 * @param calendarStream A readable stream for the GTFS calendar.txt file.
 */
export const parseCalendar = async (
  calendarStream: NodeJS.ReadableStream,
  serviceIds: ServiceIds,
  date: DateTime,
) => {
  const activeDate: number = toGtfsDate(date);
  const weekday = date.weekday as Weekday;
  const weekdayIndex = weekdays[weekday] as keyof CalendarEntry;
  for await (const rawLine of parseCsv(calendarStream)) {
    const line = rawLine as CalendarEntry;
    if (activeDate < line.start_date || activeDate > line.end_date) {
      // If the service is not valid on this date
      continue;
    }
    if (line[weekdayIndex] !== 1) {
      // If the service is not valid on this week day
      continue;
    }
    serviceIds.add(line['service_id']);
  }
};

/**
 * Parses a gtfs calendar_dates.txt file and finds the service ids valid at a given date.
 *
 * @param serviceIds A map of the active service ids (will be populated and filtered).
 * @param date The active date, in the format "YYYYMMDD".
 * @param calendarDatesStream A readable stream for the GTFS calendar_dates.txt file.
 */
export const parseCalendarDates = async (
  calendarDatesStream: NodeJS.ReadableStream,
  serviceIds: ServiceIds,
  date: DateTime,
) => {
  const activeDate: number = toGtfsDate(date);
  for await (const rawLine of parseCsv(calendarDatesStream)) {
    const line = rawLine as CalendarDatesEntry;
    if (line.date !== activeDate) {
      // No rule on the active date
    } else if (line.exception_type === 2 && serviceIds.has(line.service_id)) {
      // Service has been removed for the specified date.

      serviceIds.delete(line.service_id);
    } else if (line.exception_type === 1) {
      // Service is present on the active date
      serviceIds.add(line.service_id);
    }
  }
};
