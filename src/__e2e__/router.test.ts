import assert from 'node:assert';
import { describe, it } from 'node:test';

import fs from 'fs';

import {
  Query,
  RangeQuery,
  Route,
  Router,
  Stop,
  StopsIndex,
  Timetable,
} from '../router.js';
import { timeFromString, timeToString } from '../timetable/time.js';

type StopRef = { name: string; platform?: string };

type ExpectedVehicleLeg = {
  from: StopRef;
  to: StopRef;
  departure: string;
  arrival: string;
  route: { type: string; name: string };
};

type ExpectedTransferLeg = {
  from: StopRef;
  to: StopRef;
  type: string;
  minTransferTime?: number;
};

type ExpectedAccessLeg = {
  from: StopRef;
  to: StopRef;
  duration: number;
};

type ExpectedLeg = ExpectedVehicleLeg | ExpectedTransferLeg | ExpectedAccessLeg;

const stopsPath = new URL('./timetable/stops.bin', import.meta.url).pathname;
const timetablePath = new URL('./timetable/timetable.bin', import.meta.url)
  .pathname;

const stopsIndex = StopsIndex.fromData(fs.readFileSync(stopsPath));
const timetable = Timetable.fromData(fs.readFileSync(timetablePath));
const router = new Router(timetable, stopsIndex);

/**
 * Finds a station by its exact name. Asserts that exactly one STATION-type
 * stop with that name exists so a typo in a test causes an immediate failure.
 */
function findStation(name: string): Stop {
  const match = stopsIndex
    .findStopsByName(name, 20)
    .find((s) => s.name === name && s.locationType === 'STATION');
  assert.ok(match, `Station not found: "${name}"`);
  return match;
}

/**
 * Converts an internal Stop to a StopRef used in expected leg data.
 * Platform is omitted when the stop has none, keeping assertions concise.
 */
function toStopRef(stop: Stop): StopRef {
  return stop.platform
    ? { name: stop.name, platform: stop.platform }
    : { name: stop.name };
}

/**
 * Converts a Route's legs to the name-based format used in assertions.
 */
function toExpectedLegs(route: Route): ExpectedLeg[] {
  return route.legs.map((leg) => {
    if ('route' in leg) {
      return {
        from: toStopRef(leg.from),
        to: toStopRef(leg.to),
        departure: timeToString(leg.departureTime),
        arrival: timeToString(leg.arrivalTime),
        route: leg.route,
      };
    } else if ('type' in leg) {
      return {
        from: toStopRef(leg.from),
        to: toStopRef(leg.to),
        type: leg.type,
        ...(leg.minTransferTime !== undefined && {
          minTransferTime: leg.minTransferTime,
        }),
      };
    } else {
      return {
        from: toStopRef(leg.from),
        to: toStopRef(leg.to),
        duration: leg.duration,
      };
    }
  });
}

const pointRoutes: {
  from: string;
  to: string;
  at: string;
  legs: ExpectedLeg[];
}[] = [
  {
    from: 'Fribourg/Freiburg',
    to: 'Moléson-sur-Gruyères',
    at: '08:30',
    legs: [
      {
        from: { name: 'Fribourg/Freiburg', platform: '2' },
        to: { name: 'Bulle', platform: '2' },
        departure: '08:34',
        arrival: '09:10',
        route: { type: 'RAIL', name: 'RE2' },
      },
      {
        from: { name: 'Bulle', platform: '2' },
        to: { name: 'Bulle', platform: '4' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 3,
      },
      {
        from: { name: 'Bulle', platform: '4' },
        to: { name: 'Gruyères', platform: '1' },
        departure: '09:20',
        arrival: '09:28',
        route: { type: 'RAIL', name: 'S51' },
      },
      {
        from: { name: 'Gruyères', platform: '1' },
        to: { name: 'Gruyères, gare', platform: 'B' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 2,
      },
      {
        from: { name: 'Gruyères, gare', platform: 'B' },
        to: { name: 'Moléson-sur-Gruyères' },
        departure: '09:33',
        arrival: '09:44',
        route: { type: 'BUS', name: '263' },
      },
    ],
  },
  {
    from: 'Bern',
    to: 'St. Moritz',
    at: '12:30',
    legs: [
      {
        from: { name: 'Bern', platform: '8' },
        to: { name: 'Zürich HB', platform: '33' },
        departure: '12:31',
        arrival: '13:28',
        route: { type: 'RAIL', name: 'IC1' },
      },
      {
        from: { name: 'Zürich HB', platform: '33' },
        to: { name: 'Zürich HB', platform: '6' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 7,
      },
      {
        from: { name: 'Zürich HB', platform: '6' },
        to: { name: 'Chur', platform: '9' },
        departure: '13:38',
        arrival: '14:52',
        route: { type: 'RAIL', name: 'IC3' },
      },
      {
        from: { name: 'Chur', platform: '9' },
        to: { name: 'Chur', platform: '10' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 3,
      },
      {
        from: { name: 'Chur', platform: '10' },
        to: { name: 'St. Moritz', platform: '1' },
        departure: '14:58',
        arrival: '16:55',
        route: { type: 'RAIL', name: 'IR38' },
      },
    ],
  },
  {
    from: 'Basel SBB',
    to: 'Strasbourg',
    at: '16:50',
    legs: [
      {
        from: { name: 'Basel SBB', platform: '33' },
        to: { name: 'Saint-Louis (Haut-Rhin)' },
        departure: '17:08',
        arrival: '17:16',
        route: { type: 'RAIL', name: 'TER' },
      },
      {
        from: { name: 'Saint-Louis (Haut-Rhin)' },
        to: { name: 'Strasbourg' },
        departure: '17:30',
        arrival: '18:39',
        route: { type: 'RAIL', name: 'K200' },
      },
    ],
  },
  {
    from: 'Fribourg/Freiburg',
    to: 'Davos Platz',
    at: '08:30',
    legs: [
      {
        from: { name: 'Fribourg/Freiburg', platform: '3' },
        to: { name: 'Bern', platform: '10' },
        departure: '08:33',
        arrival: '08:56',
        route: { type: 'RAIL', name: 'IR15' },
      },
      {
        from: { name: 'Bern', platform: '10' },
        to: { name: 'Bern', platform: '2' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 6,
      },
      {
        from: { name: 'Bern', platform: '2' },
        to: { name: 'Zürich HB', platform: '34' },
        departure: '09:02',
        arrival: '09:58',
        route: { type: 'RAIL', name: 'IC81' },
      },
      {
        from: { name: 'Zürich HB', platform: '34' },
        to: { name: 'Zürich HB', platform: '10' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 7,
      },
      {
        from: { name: 'Zürich HB', platform: '10' },
        to: { name: 'Landquart', platform: '2' },
        departure: '10:07',
        arrival: '11:11',
        route: { type: 'RAIL', name: 'IC3' },
      },
      {
        from: { name: 'Landquart', platform: '2' },
        to: { name: 'Landquart', platform: '6' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 4,
      },
      {
        from: { name: 'Landquart', platform: '6' },
        to: { name: 'Davos Platz', platform: '2' },
        departure: '11:20',
        arrival: '12:27',
        route: { type: 'RAIL', name: 'RE13' },
      },
    ],
  },
  {
    from: 'Fribourg/Freiburg',
    to: 'Plan-Francey',
    at: '09:00',
    legs: [
      {
        from: { name: 'Fribourg/Freiburg', platform: '2' },
        to: { name: 'Bulle', platform: '2' },
        departure: '09:04',
        arrival: '09:40',
        route: { type: 'RAIL', name: 'RE3' },
      },
      {
        from: { name: 'Bulle', platform: '2' },
        to: { name: 'Bulle', platform: '4' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 3,
      },
      {
        from: { name: 'Bulle', platform: '4' },
        to: { name: 'Gruyères', platform: '2' },
        departure: '09:50',
        arrival: '09:57',
        route: { type: 'RAIL', name: 'S50' },
      },
      {
        from: { name: 'Gruyères', platform: '2' },
        to: { name: 'Gruyères, gare', platform: 'B' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 2,
      },
      {
        from: { name: 'Gruyères, gare', platform: 'B' },
        to: { name: 'Moléson-sur-Gruyères' },
        departure: '10:33',
        arrival: '10:44',
        route: { type: 'BUS', name: '263' },
      },
      {
        from: { name: 'Moléson-sur-Gruyères' },
        to: { name: 'Moléson-sur-Gruyères (funi)' },
        type: 'REQUIRES_MINIMAL_TIME',
        minTransferTime: 2,
      },
      {
        from: { name: 'Moléson-sur-Gruyères (funi)' },
        to: { name: 'Plan-Francey' },
        departure: '11:00',
        arrival: '11:05',
        route: { type: 'FUNICULAR', name: 'FUN' },
      },
    ],
  },
];

const rangeRoutes: {
  from: string;
  to: string;
  earliest: string;
  latest: string;
  // Runs are listed latest-departure-first, matching Range RAPTOR's natural order.
  runs: { departureTime: string; legs: ExpectedLeg[] }[];
}[] = [
  {
    from: 'Fribourg/Freiburg',
    to: 'Moléson-sur-Gruyères',
    earliest: '08:00',
    latest: '10:00',
    runs: [
      {
        departureTime: '09:34',
        legs: [
          {
            from: { name: 'Fribourg/Freiburg', platform: '2' },
            to: { name: 'Bulle', platform: '2' },
            departure: '09:34',
            arrival: '10:10',
            route: { type: 'RAIL', name: 'RE2' },
          },
          {
            from: { name: 'Bulle', platform: '2' },
            to: { name: 'Bulle', platform: '4' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 3,
          },
          {
            from: { name: 'Bulle', platform: '4' },
            to: { name: 'Gruyères', platform: '1' },
            departure: '10:20',
            arrival: '10:28',
            route: { type: 'RAIL', name: 'S51' },
          },
          {
            from: { name: 'Gruyères', platform: '1' },
            to: { name: 'Gruyères, gare', platform: 'B' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 2,
          },
          {
            from: { name: 'Gruyères, gare', platform: 'B' },
            to: { name: 'Moléson-sur-Gruyères' },
            departure: '10:33',
            arrival: '10:44',
            route: { type: 'BUS', name: '263' },
          },
        ],
      },
      {
        departureTime: '08:34',
        legs: [
          {
            from: { name: 'Fribourg/Freiburg', platform: '2' },
            to: { name: 'Bulle', platform: '2' },
            departure: '08:34',
            arrival: '09:10',
            route: { type: 'RAIL', name: 'RE2' },
          },
          {
            from: { name: 'Bulle', platform: '2' },
            to: { name: 'Bulle', platform: '4' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 3,
          },
          {
            from: { name: 'Bulle', platform: '4' },
            to: { name: 'Gruyères', platform: '1' },
            departure: '09:20',
            arrival: '09:28',
            route: { type: 'RAIL', name: 'S51' },
          },
          {
            from: { name: 'Gruyères', platform: '1' },
            to: { name: 'Gruyères, gare', platform: 'B' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 2,
          },
          {
            from: { name: 'Gruyères, gare', platform: 'B' },
            to: { name: 'Moléson-sur-Gruyères' },
            departure: '09:33',
            arrival: '09:44',
            route: { type: 'BUS', name: '263' },
          },
        ],
      },
    ],
  },
  {
    from: 'Basel SBB',
    to: 'Strasbourg',
    earliest: '16:00',
    latest: '18:00',
    runs: [
      {
        departureTime: '17:21',
        legs: [
          {
            from: { name: 'Basel SBB', platform: '31' },
            to: { name: 'Strasbourg' },
            departure: '17:21',
            arrival: '18:39',
            route: { type: 'RAIL', name: 'TER' },
          },
        ],
      },
      {
        departureTime: '16:38',
        legs: [
          {
            from: { name: 'Basel SBB', platform: '33' },
            to: { name: 'Saint-Louis (Haut-Rhin)' },
            departure: '16:38',
            arrival: '16:46',
            route: { type: 'RAIL', name: 'TER' },
          },
          {
            from: { name: 'Saint-Louis (Haut-Rhin)' },
            to: { name: 'Strasbourg' },
            departure: '16:54',
            arrival: '18:09',
            route: { type: 'RAIL', name: 'K200' },
          },
        ],
      },
    ],
  },
  {
    from: 'Fribourg/Freiburg',
    to: 'Davos Platz',
    earliest: '08:00',
    latest: '09:00',
    runs: [
      {
        departureTime: '08:33',
        legs: [
          {
            from: { name: 'Fribourg/Freiburg', platform: '3' },
            to: { name: 'Bern', platform: '10' },
            departure: '08:33',
            arrival: '08:56',
            route: { type: 'RAIL', name: 'IR15' },
          },
          {
            from: { name: 'Bern', platform: '10' },
            to: { name: 'Bern', platform: '2' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 6,
          },
          {
            from: { name: 'Bern', platform: '2' },
            to: { name: 'Zürich HB', platform: '34' },
            departure: '09:02',
            arrival: '09:58',
            route: { type: 'RAIL', name: 'IC81' },
          },
          {
            from: { name: 'Zürich HB', platform: '34' },
            to: { name: 'Zürich HB', platform: '10' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 7,
          },
          {
            from: { name: 'Zürich HB', platform: '10' },
            to: { name: 'Landquart', platform: '2' },
            departure: '10:07',
            arrival: '11:11',
            route: { type: 'RAIL', name: 'IC3' },
          },
          {
            from: { name: 'Landquart', platform: '2' },
            to: { name: 'Landquart', platform: '6' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 4,
          },
          {
            from: { name: 'Landquart', platform: '6' },
            to: { name: 'Davos Platz', platform: '2' },
            departure: '11:20',
            arrival: '12:27',
            route: { type: 'RAIL', name: 'RE13' },
          },
        ],
      },
      {
        departureTime: '08:03',
        legs: [
          {
            from: { name: 'Fribourg/Freiburg', platform: '3' },
            to: { name: 'Zürich HB', platform: '33' },
            departure: '08:03',
            arrival: '09:28',
            route: { type: 'RAIL', name: 'IC1' },
          },
          {
            from: { name: 'Zürich HB', platform: '33' },
            to: { name: 'Zürich HB', platform: '4' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 7,
          },
          {
            from: { name: 'Zürich HB', platform: '4' },
            to: { name: 'Landquart', platform: '2' },
            departure: '09:38',
            arrival: '10:41',
            route: { type: 'RAIL', name: 'IC3' },
          },
          {
            from: { name: 'Landquart', platform: '2' },
            to: { name: 'Landquart', platform: '6' },
            type: 'REQUIRES_MINIMAL_TIME',
            minTransferTime: 4,
          },
          {
            from: { name: 'Landquart', platform: '6' },
            to: { name: 'Davos Platz', platform: '1' },
            departure: '10:49',
            arrival: '12:03',
            route: { type: 'RAIL', name: 'RE24' },
          },
        ],
      },
    ],
  },
];

describe('E2E Tests for Transit Router', () => {
  describe('point queries', () => {
    for (const { from, to, at, legs } of pointRoutes) {
      it(`${from} → ${to} at ${at}`, () => {
        const fromStation = findStation(from);
        const toStation = findStation(to);

        const result = router.route(
          new Query.Builder()
            .from(fromStation.id)
            .to(toStation.id)
            .departureTime(timeFromString(at))
            .maxTransfers(5)
            .build(),
        );

        const bestRoute = result.bestRoute(toStation.id);
        assert.ok(bestRoute, 'No route found');
        assert.deepStrictEqual(toExpectedLegs(bestRoute), legs);
      });
    }
  });

  describe('range queries', () => {
    for (const { from, to, earliest, latest, runs } of rangeRoutes) {
      it(`${from} → ${to} [${earliest}–${latest}]`, () => {
        const fromStation = findStation(from);
        const toStation = findStation(to);

        const result = router.rangeRoute(
          new RangeQuery.Builder()
            .from(fromStation.id)
            .to(toStation.id)
            .departureTime(timeFromString(earliest))
            .lastDepartureTime(timeFromString(latest))
            .maxTransfers(5)
            .build(),
        );

        assert.strictEqual(
          result.size,
          runs.length,
          `Expected ${runs.length} Pareto-optimal run(s), got ${result.size}`,
        );

        const actualRuns = [...result];
        for (let i = 0; i < runs.length; i++) {
          const actualRun = actualRuns[i];
          const expectedRun = runs[i];
          assert.ok(actualRun, `Run ${i}: missing actual run`);
          assert.ok(expectedRun, `Run ${i}: missing expected run`);

          assert.strictEqual(
            timeToString(actualRun.departureTime),
            expectedRun.departureTime,
            `Run ${i}: departure time mismatch`,
          );

          const route = actualRun.result.bestRoute(toStation.id);
          assert.ok(route, `Run ${i}: no route found`);
          assert.deepStrictEqual(
            toExpectedLegs(route),
            expectedRun.legs,
            `Run ${i}: legs mismatch`,
          );
        }
      });
    }
  });
});
