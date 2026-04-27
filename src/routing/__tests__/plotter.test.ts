import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Timetable } from '../../router.js';
import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { timeFromHMS, timeFromString } from '../../timetable/time.js';
import { ServiceRoute, StopAdjacency } from '../../timetable/timetable.js';
import { Plotter } from '../plotter.js';
import { Query } from '../query.js';
import { Result } from '../result.js';
import { RoutingState } from '../router.js';

const NB_STOPS = 3;

describe('Plotter', () => {
  const stop1: Stop = {
    id: 0,
    sourceStopId: 'stop1',
    name: 'Lausanne',
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stop2: Stop = {
    id: 1,
    sourceStopId: 'stop2',
    name: 'Fribourg',
    children: [],
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
  };

  const stopsAdjacency: StopAdjacency[] = [{ routes: [0] }, { routes: [0] }];

  const routesAdjacency = [
    Route.of({
      id: 0,
      serviceRouteId: 0,
      trips: [
        {
          stops: [
            {
              id: 0,
              arrivalTime: timeFromString('08:00:00'),
              departureTime: timeFromString('08:05:00'),
            },
            {
              id: 1,
              arrivalTime: timeFromString('08:30:00'),
              departureTime: timeFromString('08:35:00'),
            },
          ],
        },
      ],
    }),
  ];

  const routes: ServiceRoute[] = [
    {
      type: 'RAIL',
      name: 'IC 1',
      routes: [0],
    },
  ];

  const mockStopsIndex = new StopsIndex([stop1, stop2]);
  const mockTimetable = new Timetable(stopsAdjacency, routesAdjacency, routes);
  const mockQuery = new Query.Builder()
    .from(0)
    .to(new Set([1]))
    .departureTime(timeFromHMS(8, 0, 0))
    .build();

  describe('plotDotGraph', () => {
    it('should generate valid DOT graph structure', () => {
      const result = new Result(
        mockQuery.to,
        RoutingState.fromTestData({ nbStops: NB_STOPS }),
        mockStopsIndex,
        mockTimetable,
      );

      const plotter = new Plotter(result);
      const dotGraph = plotter.plotDotGraph();

      assert(dotGraph.includes('digraph RoutingGraph {'));
      assert(dotGraph.includes('// Stations'));
      assert(dotGraph.includes('// Edges'));
      assert(dotGraph.endsWith('}'));
    });

    it('should include station nodes', () => {
      const result = new Result(
        mockQuery.to,
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [0],
          graph: [[[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]]],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const plotter = new Plotter(result);
      const dotGraph = plotter.plotDotGraph();

      assert(dotGraph.includes('"s_0"'));
      assert(dotGraph.includes('Lausanne'));
      assert(dotGraph.includes('shape=box'));
    });

    it('should handle empty graph gracefully', () => {
      const result = new Result(
        mockQuery.to,
        RoutingState.fromTestData({ nbStops: NB_STOPS }),
        mockStopsIndex,
        mockTimetable,
      );

      const plotter = new Plotter(result);
      const dotGraph = plotter.plotDotGraph();

      assert(dotGraph.includes('digraph RoutingGraph {'));
      assert(dotGraph.endsWith('}'));
    });

    it('should escape special characters', () => {
      const specialStop: Stop = {
        id: 2,
        sourceStopId: 'test"stop\\with\nlines\rand\ttabs',
        name: 'Station "Test"\nWith\\Special\rChars\tAndTabs',
        lat: 0,
        lon: 0,
        children: [],
        parent: undefined,
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
      };

      const specialStopsIndex = new StopsIndex([stop1, stop2, specialStop]);

      const result = new Result(
        mockQuery.to,
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [2],
          destinations: [2],
          graph: [[[2, { stopId: 2, arrival: timeFromHMS(8, 0, 0) }]]],
        }),
        specialStopsIndex,
        mockTimetable,
      );

      const plotter = new Plotter(result);
      const dotGraph = plotter.plotDotGraph();

      // Check that special characters are properly escaped in the station label
      assert(
        dotGraph.includes(
          'Station \\"Test\\"\\nWith\\\\Special\\rChars\\tAndTabs\\n2',
        ),
        'Station name should have properly escaped special characters',
      );
    });

    it('should use correct colors', () => {
      const result = new Result(
        mockQuery.to,
        RoutingState.fromTestData({
          nbStops: NB_STOPS,
          origins: [0],
          destinations: [1],
          graph: [
            [[0, { stopId: 0, arrival: timeFromHMS(8, 0, 0) }]], // round 0 – origins
            [
              [
                1,
                {
                  stopIndex: 0,
                  hopOffStopIndex: 1,
                  arrival: timeFromHMS(8, 30, 0),
                  routeId: 0,
                  tripIndex: 0,
                },
              ],
            ], // round 1 – vehicle leg
            [
              [
                1,
                {
                  from: 0,
                  to: 1,
                  arrival: timeFromHMS(8, 45, 0),
                  type: 'RECOMMENDED',
                  minTransferTime: 5,
                },
              ],
            ], // round 2 – transfer
          ],
        }),
        mockStopsIndex,
        mockTimetable,
      );

      const plotter = new Plotter(result);
      const dotGraph = plotter.plotDotGraph();
      assert(
        dotGraph.includes('color="#60a5fa"'),
        'Round 1 should use blue color (#60a5fa)',
      );
      assert(
        dotGraph.includes('color="#ff9800"'),
        'Round 2 should use orange color (#ff9800)',
      );
    });
  });
});
