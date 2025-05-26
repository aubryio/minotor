import assert from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import { Time } from '../../timetable/time.js';
import { GtfsParser } from '../parser.js';
describe('GTFS parser', () => {
  let parser: GtfsParser;

  beforeEach(() => {
    const gtfsPath = './src/gtfs/__tests__/resources/sample-feed.zip';
    parser = new GtfsParser(gtfsPath);
  });
  it('should correctly parse stops from GTFS feed', async () => {
    const stopsIndex = await parser.parseStops();
    assert.strictEqual(stopsIndex.size(), 9);
    const stop = stopsIndex.findStopBySourceStopId('FUR_CREEK_RES');
    assert(stop);
    assert.strictEqual(stop.name, 'Furnace Creek Resort (Demo)');
    assert.strictEqual(stop.lat, 36.425288);
    assert.strictEqual(stop.lon, -117.133162);
  });

  it('should correctly parse timetable from GTFS feed', async () => {
    const { timetable, stopsIndex } = await parser.parse(
      new Date('2007-01-10'),
    );

    const furCreekResId =
      stopsIndex.findStopBySourceStopId('FUR_CREEK_RES')?.id;
    assert(furCreekResId !== undefined);
    const transfers = timetable.getTransfers(furCreekResId);
    assert.strictEqual(transfers.length, 0);

    const route = timetable.getRoute('AB_x');
    assert(route);
    assert.strictEqual(route.serviceRouteId, 'AB');
    const beattyAirportId =
      stopsIndex.findStopBySourceStopId('BEATTY_AIRPORT')?.id;
    const bullfrogId = stopsIndex.findStopBySourceStopId('BULLFROG')?.id;
    assert(beattyAirportId !== undefined && bullfrogId !== undefined);
    assert.deepStrictEqual(Array.from(route.stops), [
      beattyAirportId,
      bullfrogId,
    ]);
    assert.strictEqual(route.stopTimes.length, 4);
    assert.strictEqual(route.pickUpDropOffTypes.length, 4);
    assert.strictEqual(route.stopTimes[0], Time.fromHMS(8, 0, 0).toSeconds());
    assert.strictEqual(route.stopTimes[1], Time.fromHMS(8, 0, 0).toSeconds());
    assert.strictEqual(route.stopTimes[2], Time.fromHMS(8, 10, 0).toSeconds());
    assert.strictEqual(route.stopTimes[3], Time.fromHMS(8, 15, 0).toSeconds());

    const routes = timetable.getRoutesThroughStop(furCreekResId);
    assert.strictEqual(routes.length, 2);
    assert.strictEqual(routes[0], 'BFC_1q');
    assert.strictEqual(routes[1], 'BFC_2');

    const serviceRoute = timetable.getServiceRoute('AB');
    assert(serviceRoute);
    assert.strictEqual(serviceRoute.name, '10');
    assert.strictEqual(serviceRoute.type, 'BUS');
  });
});
