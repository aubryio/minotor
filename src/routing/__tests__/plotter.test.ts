import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Timetable } from '../../router.js';
import { Stop, StopId } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import { Time } from '../../timetable/time.js';
import { ServiceRoute, StopAdjacency } from '../../timetable/timetable.js';
import { Plotter } from '../plotter.js';
import { Query } from '../query.js';
import { Result } from '../result.js';
import { RoutingEdge } from '../router.js';

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
              arrivalTime: Time.fromString('08:00:00'),
              departureTime: Time.fromString('08:05:00'),
            },
            {
              id: 1,
              arrivalTime: Time.fromString('08:30:00'),
              departureTime: Time.fromString('08:35:00'),
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
    .from('stop1')
    .to(new Set(['stop2']))
    .departureTime(Time.fromHMS(8, 0, 0))
    .build();

  describe('plotDotGraph', () => {
    it('should generate valid DOT graph structure', () => {
      const result = new Result(
        mockQuery,
        {
          earliestArrivals: new Map(),
          graph: [],
          destinations: [],
        },
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
      const graph: Map<StopId, RoutingEdge>[] = [
        new Map([[0, { arrival: Time.fromHMS(8, 0, 0) }]]),
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals: new Map(),
          graph,
          destinations: [0],
        },
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
        mockQuery,
        {
          earliestArrivals: new Map(),
          graph: [],
          destinations: [],
        },
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
      const graph: Map<StopId, RoutingEdge>[] = [
        new Map([[2, { arrival: Time.fromHMS(8, 0, 0) }]]),
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals: new Map(),
          graph,
          destinations: [2],
        },
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
      const graph: Map<StopId, RoutingEdge>[] = [
        new Map([[0, { arrival: Time.fromHMS(8, 0, 0) }]]),
        new Map([
          [
            1,
            {
              from: 0,
              to: 1,
              arrival: Time.fromHMS(8, 30, 0),
              routeId: 0,
              tripIndex: 0,
            },
          ],
        ]),
        new Map([
          [
            1,
            {
              from: 0,
              to: 1,
              arrival: Time.fromHMS(8, 45, 0),
              type: 'WALKING',
              minTransferTime: Time.fromHMS(0, 5, 0),
            },
          ],
        ]),
      ];

      const result = new Result(
        mockQuery,
        {
          earliestArrivals: new Map(),
          graph,
          destinations: [1],
        },
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
