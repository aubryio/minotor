import { Command } from 'commander';
import fs from 'fs';
import log from 'loglevel';
import { DateTime } from 'luxon';

import { chGtfsProfile, GtfsParser, GtfsProfile } from '../parser.js';
import { Router, StopsIndex, Timetable } from '../router.js';
import {
  loadQueriesFromJson,
  prettyPrintPerformanceResults,
  testRouterPerformance,
} from './perf.js';
import { startRepl } from './repl.js';

const program = new Command();

export type GtfsVariant = string;

export type Config = {
  [config: GtfsVariant]: GtfsProfile;
};

const profiles: Config = {
  CH: chGtfsProfile,
};

program
  .name('minotor')
  .description('CLI for minotor route planner.')
  .version('0.0.1');

program
  .command('parse-gtfs')
  .description('Parse a GTFS feed and output a timetable and stops file.')
  .argument('<gtfsPath>', 'Path to GTFS data')
  .option(
    '-d, --date <date>',
    'Date of the day to parse in yyyy-MM-dd format',
    DateTime.now().toFormat('yyyy-MM-dd'),
  )
  .option(
    '-t, --timetableOutputPath <path>',
    'Path to output timetable file',
    '/tmp/timetable',
  )
  .option(
    '-s, --stopsOutputPath <path>',
    'Path to output stops file',
    '/tmp/stops',
  )
  .option('-p, --profileName <name>', 'Profile name for GTFS config', 'CH')
  .option('-v, --verbose', 'Verbose mode', false)
  .action(
    async (
      gtfsPath: string,
      options: {
        date: string;
        timetableOutputPath: string;
        stopsOutputPath: string;
        profileName: string;
        verbose: boolean;
      },
    ) => {
      if (options.verbose) {
        log.setDefaultLevel(log.levels.INFO);
      } else {
        log.setDefaultLevel(log.levels.ERROR);
      }
      const parser = new GtfsParser(gtfsPath, profiles[options.profileName]);
      const stopsIndex = await parser.parseStops();
      fs.writeFileSync(options.stopsOutputPath, stopsIndex.serialize());
      const timetable = await parser.parseTimetable(new Date(options.date));
      fs.writeFileSync(options.timetableOutputPath, timetable.serialize());
    },
  );

program
  .command('parse-stops')
  .description('Parse a GTFS feed and output a stops file.')
  .argument('<gtfsPath>', 'Path to GTFS data')
  .option('-s, --outputPath <path>', 'Path to output stops file', '/tmp/stops')
  .option('-p, --profileName <name>', 'Profile name for GTFS config', 'CH')
  .option('-v, --verbose', 'Verbose mode', false)
  .action(
    async (
      gtfsPath: string,
      options: {
        stopsOutputPath: string;
        profileName: string;
        verbose: boolean;
      },
    ) => {
      if (options.verbose) {
        log.setDefaultLevel(log.levels.INFO);
      } else {
        log.setDefaultLevel(log.levels.ERROR);
      }
      const parser = new GtfsParser(gtfsPath, profiles[options.profileName]);
      const stopsIndex = await parser.parseStops();
      fs.writeFileSync(options.stopsOutputPath, stopsIndex.serialize());
    },
  );

program
  .command('repl')
  .description('Find stops matching a textual query')
  .option('-s, --stopsPath <path>', 'Path to the stops file', '/tmp/stops')
  .option(
    '-t, --timetablePath <path>',
    'Path to the timetable file',
    '/tmp/timetable',
  )
  .action((options: { stopsPath: string; timetablePath: string }) => {
    startRepl(options.stopsPath, options.timetablePath);
  });

program
  .command('perf')
  .description('Evaluate the performance of the router on a set of routes.')
  .argument('<routesPath>', 'Path to the JSON file containing the routes')
  .option('-s, --stopsPath <path>', 'Path to the stops file', '/tmp/stops')
  .option(
    '-t, --timetablePath <path>',
    'Path to the timetable file',
    '/tmp/timetable',
  )
  .option(
    '-i, --iterations <number>',
    'Number of iterations for performance tests',
    '20',
  )
  .action(
    (
      routesPath: string,
      options: {
        stopsPath: string;
        timetablePath: string;
        iterations: string;
      },
    ) => {
      const stopsIndex = StopsIndex.fromData(
        fs.readFileSync(options.stopsPath),
      );
      const timetable = Timetable.fromData(
        fs.readFileSync(options.timetablePath),
      );
      const router = new Router(timetable, stopsIndex);

      const queries = loadQueriesFromJson(routesPath);
      const performanceResults = testRouterPerformance(
        router,
        stopsIndex,
        queries,
        parseInt(options.iterations, 10),
      );

      prettyPrintPerformanceResults(performanceResults);
    },
  );

program.parse(process.argv);
