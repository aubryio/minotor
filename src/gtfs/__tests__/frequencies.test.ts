import assert from 'node:assert';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';

import { durationFromSeconds, timeFromHMS } from '../../timetable/time.js';
import { FrequenciesMap, parseFrequencies } from '../frequencies.js';
import { GtfsStopsMap } from '../stops.js';
import { GtfsTripIdsMap, parseStopTimes } from '../trips.js';

/** Builds a minimal GtfsStopsMap for the two stops used across tests. */
const buildTwoStopsMap = (): GtfsStopsMap =>
  new Map([
    [
      'stop1',
      {
        id: 0,
        sourceStopId: 'stop1',
        name: 'Stop 1',
        children: [],
        locationType: 'SIMPLE_STOP_OR_PLATFORM' as const,
        lat: 0,
        lon: 0,
      },
    ],
    [
      'stop2',
      {
        id: 1,
        sourceStopId: 'stop2',
        name: 'Stop 2',
        children: [],
        locationType: 'SIMPLE_STOP_OR_PLATFORM' as const,
        lat: 0,
        lon: 0,
      },
    ],
  ]);

describe('GTFS frequencies parser', () => {
  it('should correctly parse a single frequency window', async () => {
    const stream = new Readable();
    stream.push('trip_id,start_time,end_time,headway_secs\n');
    stream.push('"tripA","06:00:00","08:00:00","1800"\n');
    stream.push(null);

    const result = await parseFrequencies(stream, new Set(['tripA']));

    assert.strictEqual(result.size, 1);
    const windows = result.get('tripA');
    assert(windows !== undefined);
    assert.strictEqual(windows.length, 1);
    assert.strictEqual(windows[0]?.startTime, timeFromHMS(6, 0, 0));
    assert.strictEqual(windows[0].endTime, timeFromHMS(8, 0, 0));
    assert.strictEqual(windows[0].headwayMins, durationFromSeconds(1800));
  });

  it('should ignore trips not in activeTripIds', async () => {
    const stream = new Readable();
    stream.push('trip_id,start_time,end_time,headway_secs\n');
    stream.push('"tripA","06:00:00","08:00:00","1800"\n');
    stream.push('"tripB","10:00:00","12:00:00","600"\n');
    stream.push(null);

    const result = await parseFrequencies(stream, new Set(['tripA']));

    assert.strictEqual(result.size, 1);
    assert(result.has('tripA'));
    assert(!result.has('tripB'));
  });

  it('should return an empty map when no trips match activeTripIds', async () => {
    const stream = new Readable();
    stream.push('trip_id,start_time,end_time,headway_secs\n');
    stream.push('"tripA","06:00:00","08:00:00","1800"\n');
    stream.push(null);

    const result = await parseFrequencies(stream, new Set(['tripB']));

    assert.strictEqual(result.size, 0);
  });

  it('should collect multiple frequency windows for the same trip', async () => {
    const stream = new Readable();
    stream.push('trip_id,start_time,end_time,headway_secs\n');
    stream.push('"tripA","06:00:00","08:00:00","1800"\n');
    stream.push('"tripA","08:00:00","10:00:00","600"\n');
    stream.push(null);

    const result = await parseFrequencies(stream, new Set(['tripA']));

    assert.strictEqual(result.size, 1);
    const windows = result.get('tripA');
    assert(windows !== undefined);
    assert.strictEqual(windows.length, 2);
    assert.strictEqual(windows[0]?.startTime, timeFromHMS(6, 0, 0));
    assert.strictEqual(windows[0].headwayMins, durationFromSeconds(1800));
    assert.strictEqual(windows[1]?.startTime, timeFromHMS(8, 0, 0));
    assert.strictEqual(windows[1].headwayMins, durationFromSeconds(600));
  });

  it('should parse multiple trips each with their own window', async () => {
    const stream = new Readable();
    stream.push('trip_id,start_time,end_time,headway_secs\n');
    stream.push('"tripA","06:00:00","22:00:00","1800"\n');
    stream.push('"tripB","08:00:00","20:00:00","600"\n');
    stream.push(null);

    const result = await parseFrequencies(stream, new Set(['tripA', 'tripB']));

    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get('tripA')?.length, 1);
    assert.strictEqual(result.get('tripB')?.length, 1);
  });
});

describe('GTFS stop times parser with frequency expansion', () => {
  it('should expand a frequency trip into the correct number of concrete trips', async () => {
    // Template trip: stop1 @ 06:00, stop2 @ 06:20
    // Window: 06:00 – 07:00 (exclusive), headway 30 min → 2 departures (06:00, 06:30)
    const stream = new Readable();
    stream.push('trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    stream.push('"tripA","06:00:00","06:00:00","stop1","1"\n');
    stream.push('"tripA","06:20:00","06:20:00","stop2","2"\n');
    stream.push(null);

    const activeTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const activeStopIds = new Set([0, 1]);
    const stopsMap = buildTwoStopsMap();
    const frequenciesMap: FrequenciesMap = new Map([
      [
        'tripA',
        [
          {
            startTime: timeFromHMS(6, 0, 0),
            endTime: timeFromHMS(7, 0, 0),
            headwayMins: durationFromSeconds(1800),
            exactTimes: false,
          },
        ],
      ],
    ]);

    const result = await parseStopTimes(
      stream,
      stopsMap,
      activeTripIds,
      activeStopIds,
      frequenciesMap,
    );

    assert.strictEqual(result.routes.length, 1);
    const route = result.routes[0];
    assert(route !== undefined);
    assert.strictEqual(route.getNbTrips(), 2);
  });

  it('should produce correctly shifted stop times for expanded trips', async () => {
    // Template: stop1 @ 06:00/06:00, stop2 @ 06:20/06:20
    // Window: 06:00 – 07:00, headway 30 min → trips at 06:00 and 06:30
    const stream = new Readable();
    stream.push('trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    stream.push('"tripA","06:00:00","06:00:00","stop1","1"\n');
    stream.push('"tripA","06:20:00","06:20:00","stop2","2"\n');
    stream.push(null);

    const activeTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const activeStopIds = new Set([0, 1]);
    const stopsMap = buildTwoStopsMap();
    const frequenciesMap: FrequenciesMap = new Map([
      [
        'tripA',
        [
          {
            startTime: timeFromHMS(6, 0, 0),
            endTime: timeFromHMS(7, 0, 0),
            headwayMins: durationFromSeconds(1800),
            exactTimes: false,
          },
        ],
      ],
    ]);

    const result = await parseStopTimes(
      stream,
      stopsMap,
      activeTripIds,
      activeStopIds,
      frequenciesMap,
    );

    const route = result.routes[0];
    assert(route !== undefined);

    // Trips are sorted by firstDeparture inside finalizeRouteFromBuilder.
    // Trip 0 departs at 06:00
    assert.strictEqual(route.arrivalAt(0, 0), timeFromHMS(6, 0, 0));
    assert.strictEqual(route.departureFrom(0, 0), timeFromHMS(6, 0, 0));
    assert.strictEqual(route.arrivalAt(1, 0), timeFromHMS(6, 20, 0));
    assert.strictEqual(route.departureFrom(1, 0), timeFromHMS(6, 20, 0));

    // Trip 1 departs at 06:30 (offset +30 min)
    assert.strictEqual(route.arrivalAt(0, 1), timeFromHMS(6, 30, 0));
    assert.strictEqual(route.departureFrom(0, 1), timeFromHMS(6, 30, 0));
    assert.strictEqual(route.arrivalAt(1, 1), timeFromHMS(6, 50, 0));
    assert.strictEqual(route.departureFrom(1, 1), timeFromHMS(6, 50, 0));
  });

  it('should treat end_time as exclusive (last departure strictly before end_time)', async () => {
    // Window: 06:00 – 06:30, headway 30 min → only 1 trip (06:00); 06:30 is excluded
    const stream = new Readable();
    stream.push('trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    stream.push('"tripA","06:00:00","06:00:00","stop1","1"\n');
    stream.push('"tripA","06:20:00","06:20:00","stop2","2"\n');
    stream.push(null);

    const activeTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const activeStopIds = new Set([0, 1]);
    const stopsMap = buildTwoStopsMap();
    const frequenciesMap: FrequenciesMap = new Map([
      [
        'tripA',
        [
          {
            startTime: timeFromHMS(6, 0, 0),
            endTime: timeFromHMS(6, 30, 0),
            headwayMins: durationFromSeconds(1800),
            exactTimes: false,
          },
        ],
      ],
    ]);

    const result = await parseStopTimes(
      stream,
      stopsMap,
      activeTripIds,
      activeStopIds,
      frequenciesMap,
    );

    const route = result.routes[0];
    assert(route !== undefined);
    assert.strictEqual(route.getNbTrips(), 1);
    assert.strictEqual(route.arrivalAt(0, 0), timeFromHMS(6, 0, 0));
  });

  it('should expand trips across multiple frequency windows', async () => {
    // Two windows for the same trip:
    //   Window 1: 06:00 – 07:00, headway 30 min → 2 trips
    //   Window 2: 10:00 – 11:00, headway 30 min → 2 trips
    // Total: 4 trips
    const stream = new Readable();
    stream.push('trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    stream.push('"tripA","06:00:00","06:00:00","stop1","1"\n');
    stream.push('"tripA","06:20:00","06:20:00","stop2","2"\n');
    stream.push(null);

    const activeTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const activeStopIds = new Set([0, 1]);
    const stopsMap = buildTwoStopsMap();
    const frequenciesMap: FrequenciesMap = new Map([
      [
        'tripA',
        [
          {
            startTime: timeFromHMS(6, 0, 0),
            endTime: timeFromHMS(7, 0, 0),
            headwayMins: durationFromSeconds(1800),
            exactTimes: false,
          },
          {
            startTime: timeFromHMS(10, 0, 0),
            endTime: timeFromHMS(11, 0, 0),
            headwayMins: durationFromSeconds(1800),
            exactTimes: false,
          },
        ],
      ],
    ]);

    const result = await parseStopTimes(
      stream,
      stopsMap,
      activeTripIds,
      activeStopIds,
      frequenciesMap,
    );

    const route = result.routes[0];
    assert(route !== undefined);
    assert.strictEqual(route.getNbTrips(), 4);

    // Trips are sorted by firstDeparture: 06:00, 06:30, 10:00, 10:30
    assert.strictEqual(route.arrivalAt(0, 0), timeFromHMS(6, 0, 0));
    assert.strictEqual(route.arrivalAt(0, 1), timeFromHMS(6, 30, 0));
    assert.strictEqual(route.arrivalAt(0, 2), timeFromHMS(10, 0, 0));
    assert.strictEqual(route.arrivalAt(0, 3), timeFromHMS(10, 30, 0));
  });

  it('should not expand a trip that has no frequency entry', async () => {
    const stream = new Readable();
    stream.push('trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    stream.push('"tripA","08:00:00","08:00:00","stop1","1"\n');
    stream.push('"tripA","08:20:00","08:20:00","stop2","2"\n');
    stream.push(null);

    const activeTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const activeStopIds = new Set([0, 1]);
    const stopsMap = buildTwoStopsMap();
    // Provide a frequenciesMap but with no entry for tripA
    const frequenciesMap: FrequenciesMap = new Map();

    const result = await parseStopTimes(
      stream,
      stopsMap,
      activeTripIds,
      activeStopIds,
      frequenciesMap,
    );

    const route = result.routes[0];
    assert(route !== undefined);
    assert.strictEqual(route.getNbTrips(), 1);
    assert.strictEqual(route.arrivalAt(0, 0), timeFromHMS(8, 0, 0));
    assert.strictEqual(route.arrivalAt(1, 0), timeFromHMS(8, 20, 0));
  });

  it('should leave non-frequency trips unchanged when frequenciesMap is undefined', async () => {
    const stream = new Readable();
    stream.push('trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    stream.push('"tripA","09:00:00","09:05:00","stop1","1"\n');
    stream.push('"tripA","09:30:00","09:35:00","stop2","2"\n');
    stream.push(null);

    const activeTripIds: GtfsTripIdsMap = new Map([['tripA', 'routeA']]);
    const activeStopIds = new Set([0, 1]);
    const stopsMap = buildTwoStopsMap();

    // No frequenciesMap passed → original behavior
    const result = await parseStopTimes(
      stream,
      stopsMap,
      activeTripIds,
      activeStopIds,
    );

    const route = result.routes[0];
    assert(route !== undefined);
    assert.strictEqual(route.getNbTrips(), 1);
    assert.strictEqual(route.arrivalAt(0, 0), timeFromHMS(9, 0, 0));
    assert.strictEqual(route.departureFrom(0, 0), timeFromHMS(9, 5, 0));
  });

  it('should mix frequency and non-frequency trips sharing the same stop sequence into one route', async () => {
    // tripA is a frequency trip (2 expansions); tripB is a regular trip.
    // Both serve the same GTFS route with the same stop sequence → same route.
    const stream = new Readable();
    stream.push('trip_id,arrival_time,departure_time,stop_id,stop_sequence\n');
    stream.push('"tripA","06:00:00","06:00:00","stop1","1"\n');
    stream.push('"tripA","06:20:00","06:20:00","stop2","2"\n');
    stream.push('"tripB","08:00:00","08:00:00","stop1","1"\n');
    stream.push('"tripB","08:20:00","08:20:00","stop2","2"\n');
    stream.push(null);

    const activeTripIds: GtfsTripIdsMap = new Map([
      ['tripA', 'routeA'],
      ['tripB', 'routeA'],
    ]);
    const activeStopIds = new Set([0, 1]);
    const stopsMap = buildTwoStopsMap();
    const frequenciesMap: FrequenciesMap = new Map([
      [
        'tripA',
        [
          {
            startTime: timeFromHMS(6, 0, 0),
            endTime: timeFromHMS(7, 0, 0),
            headwayMins: durationFromSeconds(1800),
            exactTimes: false,
          },
        ],
      ],
    ]);

    const result = await parseStopTimes(
      stream,
      stopsMap,
      activeTripIds,
      activeStopIds,
      frequenciesMap,
    );

    // All three trips (2 from tripA expansion + 1 from tripB) share the same
    // stop sequence, so they should be grouped into a single route.
    assert.strictEqual(result.routes.length, 1);
    const route = result.routes[0];
    assert(route !== undefined);
    assert.strictEqual(route.getNbTrips(), 3);
  });
});
