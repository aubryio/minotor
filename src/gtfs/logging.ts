import log from 'loglevel';

export type ParserLogLevel =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

export const parserLog = log.getLogger('minotor:gtfs');
parserLog.setLevel('warn', false);

/**
 * Set logging for all GTFS parser instances in this module.
 * Applies to stops and timetable parsing; defaults to warn.
 * Does not change application logging or suppress thrown errors.
 */
export function setParserLogLevel(level: ParserLogLevel): void {
  parserLog.setLevel(level, false);
}
