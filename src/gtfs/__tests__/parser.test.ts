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
    const timetable = await parser.parseTimetable(new Date('2007-01-10'));
    const stopsIndex = await parser.parseStops();

    const furCreekResId =
      stopsIndex.findStopBySourceStopId('FUR_CREEK_RES')?.id;
    assert(furCreekResId !== undefined);
    const transfers = timetable.getTransfers(furCreekResId);
    assert.strictEqual(transfers.length, 0);

    const route = timetable.getRoute(3);
    assert(route);
    assert.strictEqual(route.serviceRoute(), 2);
    const beattyAirportId =
      stopsIndex.findStopBySourceStopId('BEATTY_AIRPORT')?.id;
    const bullfrogId = stopsIndex.findStopBySourceStopId('BULLFROG')?.id;
    assert(beattyAirportId !== undefined && bullfrogId !== undefined);
    assert.strictEqual(route.getNbStops(), 2);
    assert(route.arrivalAt(beattyAirportId, 0).equals(Time.fromHMS(8, 0, 0)));
    assert(
      route.departureFrom(beattyAirportId, 0).equals(Time.fromHMS(8, 0, 0)),
    );
    assert(route.arrivalAt(bullfrogId, 0).equals(Time.fromHMS(8, 10, 0)));
    assert(route.departureFrom(bullfrogId, 0).equals(Time.fromHMS(8, 15, 0)));

    const routes = timetable.routesPassingThrough(furCreekResId);
    assert.strictEqual(routes.length, 2);
    assert.strictEqual(routes[0]?.serviceRoute(), 3);
    assert.strictEqual(routes[1]?.serviceRoute(), 3);

    const serviceRoute = timetable.getServiceRouteInfo(route);
    assert(serviceRoute);
    assert.strictEqual(serviceRoute.name, '10');
    assert.strictEqual(serviceRoute.type, 'BUS');
  });
});
