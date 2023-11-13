import * as assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { StopsMap } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Time } from '../../timetable/time.js';
import {
  RoutesAdjacency,
  ServiceRoutesMap,
  StopsAdjacency,
  Timetable,
} from '../../timetable/timetable.js';
import { GtfsParser } from '../parser.js';

describe('parse gtfs', () => {
  let gtfsParser: GtfsParser;

  beforeEach(() => {
    const gtfsPath = './src/gtfs/__tests__/resources/sample-feed.zip';
    gtfsParser = new GtfsParser(gtfsPath);
  });

  describe('given a gtfs feed', () => {
    const date = new Date('2007-01-10T12:00:00+00:00');
    it('should parse the timetable', async () => {
      const expectedRoutesAdjacency: RoutesAdjacency = new Map([
        [
          'STBA_1kdg12n',
          {
            serviceRouteId: 'STBA',
            stops: ['STAGECOACH', 'BEATTY_AIRPORT'],
            stopTimes: [
              {
                departure: Time.fromHMS(6, 0, 0),
                arrival: Time.fromHMS(6, 0, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 20, 0),
                arrival: Time.fromHMS(6, 20, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
            stopIndices: new Map([
              ['STAGECOACH', 0],
              ['BEATTY_AIRPORT', 1],
            ]),
          },
        ],
        [
          'CITY_asdcjh',
          {
            serviceRouteId: 'CITY',
            stops: ['STAGECOACH', 'NANAA', 'NADAV', 'DADAN', 'EMSI'],
            stopTimes: [
              {
                departure: Time.fromHMS(6, 0, 0),
                arrival: Time.fromHMS(7, 0, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 7, 0),
                arrival: Time.fromHMS(7, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 14, 0),
                arrival: Time.fromHMS(7, 12, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 21, 0),
                arrival: Time.fromHMS(7, 19, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 28, 0),
                arrival: Time.fromHMS(7, 26, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 0, 0),
                arrival: Time.fromHMS(6, 0, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 7, 0),
                arrival: Time.fromHMS(6, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 14, 0),
                arrival: Time.fromHMS(6, 12, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 21, 0),
                arrival: Time.fromHMS(6, 19, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 28, 0),
                arrival: Time.fromHMS(6, 26, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
            stopIndices: new Map([
              ['STAGECOACH', 0],
              ['NANAA', 1],
              ['NADAV', 2],
              ['DADAN', 3],
              ['EMSI', 4],
            ]),
          },
        ],
        [
          'CITY_1vpda0p',
          {
            serviceRouteId: 'CITY',
            stops: ['EMSI', 'DADAN', 'NADAV', 'NANAA', 'STAGECOACH'],
            stopTimes: [
              {
                departure: Time.fromHMS(6, 30, 0),
                arrival: Time.fromHMS(6, 28, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 37, 0),
                arrival: Time.fromHMS(6, 35, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 44, 0),
                arrival: Time.fromHMS(6, 42, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 51, 0),
                arrival: Time.fromHMS(6, 49, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(6, 58, 0),
                arrival: Time.fromHMS(6, 56, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
            stopIndices: new Map([
              ['EMSI', 0],
              ['DADAN', 1],
              ['NADAV', 2],
              ['NANAA', 3],
              ['STAGECOACH', 4],
            ]),
          },
        ],
        [
          'AB_4szggk',
          {
            serviceRouteId: 'AB',
            stops: ['BEATTY_AIRPORT', 'BULLFROG'],
            stopTimes: [
              {
                departure: Time.fromHMS(8, 0, 0),
                arrival: Time.fromHMS(8, 0, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(8, 15, 0),
                arrival: Time.fromHMS(8, 10, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
            stopIndices: new Map([
              ['BEATTY_AIRPORT', 0],
              ['BULLFROG', 1],
            ]),
          },
        ],
        [
          'AB_7cf41g',
          {
            serviceRouteId: 'AB',
            stops: ['BULLFROG', 'BEATTY_AIRPORT'],
            stopTimes: [
              {
                departure: Time.fromHMS(12, 5, 0),
                arrival: Time.fromHMS(12, 5, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(12, 15, 0),
                arrival: Time.fromHMS(12, 15, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
            stopIndices: new Map([
              ['BULLFROG', 0],
              ['BEATTY_AIRPORT', 1],
            ]),
          },
        ],
        [
          'BFC_zfm0pg',
          {
            serviceRouteId: 'BFC',
            stops: ['BULLFROG', 'FUR_CREEK_RES'],
            stopTimes: [
              {
                departure: Time.fromHMS(8, 20, 0),
                arrival: Time.fromHMS(8, 20, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(9, 20, 0),
                arrival: Time.fromHMS(9, 20, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
            stopIndices: new Map([
              ['BULLFROG', 0],
              ['FUR_CREEK_RES', 1],
            ]),
          },
        ],
        [
          'BFC_1xsky4a',
          {
            serviceRouteId: 'BFC',
            stops: ['FUR_CREEK_RES', 'BULLFROG'],
            stopTimes: [
              {
                departure: Time.fromHMS(11, 0, 0),
                arrival: Time.fromHMS(11, 0, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
              {
                departure: Time.fromHMS(12, 0, 0),
                arrival: Time.fromHMS(12, 0, 0),
                pickUpType: 'REGULAR',
                dropOffType: 'REGULAR',
              },
            ],
            stopIndices: new Map([
              ['FUR_CREEK_RES', 0],
              ['BULLFROG', 1],
            ]),
          },
        ],
      ]);
      const expectedStopsAdjacency: StopsAdjacency = new Map([
        [
          'STAGECOACH',
          {
            routes: ['STBA_1kdg12n', 'CITY_asdcjh', 'CITY_1vpda0p'],
            transfers: [],
          },
        ],
        [
          'BEATTY_AIRPORT',
          {
            routes: ['STBA_1kdg12n', 'AB_4szggk', 'AB_7cf41g'],
            transfers: [],
          },
        ],
        [
          'NANAA',
          {
            routes: ['CITY_asdcjh', 'CITY_1vpda0p'],
            transfers: [],
          },
        ],
        [
          'NADAV',
          {
            routes: ['CITY_asdcjh', 'CITY_1vpda0p'],
            transfers: [],
          },
        ],
        [
          'DADAN',
          {
            routes: ['CITY_asdcjh', 'CITY_1vpda0p'],
            transfers: [],
          },
        ],
        [
          'EMSI',
          {
            routes: ['CITY_asdcjh', 'CITY_1vpda0p'],
            transfers: [],
          },
        ],
        [
          'BULLFROG',
          {
            routes: ['AB_4szggk', 'AB_7cf41g', 'BFC_zfm0pg', 'BFC_1xsky4a'],
            transfers: [],
          },
        ],
        [
          'FUR_CREEK_RES',
          {
            routes: ['BFC_zfm0pg', 'BFC_1xsky4a'],
            transfers: [],
          },
        ],
      ]);
      const expectedRoutes: ServiceRoutesMap = new Map([
        [
          'AB',
          {
            name: '10',
            type: 'BUS',
          },
        ],
        [
          'BFC',
          {
            name: '20',
            type: 'BUS',
          },
        ],
        [
          'STBA',
          {
            name: '30',
            type: 'BUS',
          },
        ],
        [
          'CITY',
          {
            name: '40',
            type: 'BUS',
          },
        ],
        [
          'AAMV',
          {
            name: '50',
            type: 'BUS',
          },
        ],
      ]);
      const expectedTimetable = new Timetable(
        expectedStopsAdjacency,
        expectedRoutesAdjacency,
        expectedRoutes,
      );
      const { timetable } = await gtfsParser.parse(date);

      assert.deepEqual(timetable, expectedTimetable);
    });
    it('should parse stops', async () => {
      const expectedStops: StopsMap = new Map([
        [
          'FUR_CREEK_RES',
          {
            id: 'FUR_CREEK_RES',
            name: 'Furnace Creek Resort (Demo)',
            lat: 36.425288,
            lon: -117.133162,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'BEATTY_AIRPORT',
          {
            id: 'BEATTY_AIRPORT',
            name: 'Nye County Airport (Demo)',
            lat: 36.868446,
            lon: -116.784582,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'BULLFROG',
          {
            id: 'BULLFROG',
            name: 'Bullfrog (Demo)',
            lat: 36.88108,
            lon: -116.81797,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'STAGECOACH',
          {
            id: 'STAGECOACH',
            name: 'Stagecoach Hotel & Casino (Demo)',
            lat: 36.915682,
            lon: -116.751677,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'NADAV',
          {
            id: 'NADAV',
            name: 'North Ave / D Ave N (Demo)',
            lat: 36.914893,
            lon: -116.76821,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'NANAA',
          {
            id: 'NANAA',
            name: 'North Ave / N A Ave (Demo)',
            lat: 36.914944,
            lon: -116.761472,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'DADAN',
          {
            id: 'DADAN',
            name: 'Doing Ave / D Ave N (Demo)',
            lat: 36.909489,
            lon: -116.768242,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'EMSI',
          {
            id: 'EMSI',
            name: 'E Main St / S Irving St (Demo)',
            lat: 36.905697,
            lon: -116.76218,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
      ]);
      const { stopsIndex } = await gtfsParser.parse(date);

      assert.deepEqual(stopsIndex, new StopsIndex(expectedStops));
    });
  });
});

describe('parse gtfs stops', () => {
  let gtfsParser: GtfsParser;
  beforeEach(() => {
    const gtfsPath = './src/gtfs/__tests__/resources/sample-feed.zip';
    gtfsParser = new GtfsParser(gtfsPath);
  });
  describe('given a gtfs feed', () => {
    it('should parse stops', async () => {
      const expectedStops: StopsMap = new Map([
        [
          'FUR_CREEK_RES',
          {
            id: 'FUR_CREEK_RES',
            name: 'Furnace Creek Resort (Demo)',
            lat: 36.425288,
            lon: -117.133162,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'BEATTY_AIRPORT',
          {
            id: 'BEATTY_AIRPORT',
            name: 'Nye County Airport (Demo)',
            lat: 36.868446,
            lon: -116.784582,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'BULLFROG',
          {
            id: 'BULLFROG',
            name: 'Bullfrog (Demo)',
            lat: 36.88108,
            lon: -116.81797,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'STAGECOACH',
          {
            id: 'STAGECOACH',
            name: 'Stagecoach Hotel & Casino (Demo)',
            lat: 36.915682,
            lon: -116.751677,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'NADAV',
          {
            id: 'NADAV',
            name: 'North Ave / D Ave N (Demo)',
            lat: 36.914893,
            lon: -116.76821,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'NANAA',
          {
            id: 'NANAA',
            name: 'North Ave / N A Ave (Demo)',
            lat: 36.914944,
            lon: -116.761472,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'DADAN',
          {
            id: 'DADAN',
            name: 'Doing Ave / D Ave N (Demo)',
            lat: 36.909489,
            lon: -116.768242,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'EMSI',
          {
            id: 'EMSI',
            name: 'E Main St / S Irving St (Demo)',
            lat: 36.905697,
            lon: -116.76218,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
        [
          'AMV',
          {
            id: 'AMV',
            name: 'Amargosa Valley (Demo)',
            lat: 36.641496,
            lon: -116.40094,
            locationType: 'SIMPLE_STOP_OR_PLATFORM',
            children: [],
          },
        ],
      ]);
      const stops = await gtfsParser.parseStops();

      assert.deepStrictEqual(stops, new StopsIndex(expectedStops));
    });
  });
});
