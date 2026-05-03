/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Route } from '../../timetable/route.js';
import { timeFromHM } from '../../timetable/time.js';
import {
  ALL_TRANSPORT_MODES,
  ServiceRoute,
  StopAdjacency,
  Timetable,
  TripTransfers,
} from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopId.js';
import { QueryOptions } from '../query.js';
import { Raptor } from '../raptor.js';
import { RoutingState } from '../state.js';

// ─── Base fixture ─────────────────────────────────────────────────────────────
// 3 stops: 0 (origin), 1 (transfer stop), 2 (destination)
// Route 0 (BUS): 0→1  depart 08:10 / arrive 08:30
// Route 1 (BUS): 1→2  depart 08:35 / arrive 08:50
// Stop adjacency: stop 0 → [0], stop 1 → [0, 1], stop 2 → [1]

const NB_STOPS = 3;

const route0 = Route.of({
  id: 0,
  serviceRouteId: 0,
  trips: [
    {
      stops: [
        {
          id: 0,
          arrivalTime: timeFromHM(8, 10),
          departureTime: timeFromHM(8, 10),
        },
        {
          id: 1,
          arrivalTime: timeFromHM(8, 30),
          departureTime: timeFromHM(8, 30),
        },
      ],
    },
  ],
});

const route1 = Route.of({
  id: 1,
  serviceRouteId: 1,
  trips: [
    {
      stops: [
        {
          id: 1,
          arrivalTime: timeFromHM(8, 35),
          departureTime: timeFromHM(8, 35),
        },
        {
          id: 2,
          arrivalTime: timeFromHM(8, 50),
          departureTime: timeFromHM(8, 50),
        },
      ],
    },
  ],
});

const stopsAdjacency: StopAdjacency[] = [
  { routes: [0] }, // stop 0: origin
  { routes: [0, 1] }, // stop 1: transfer stop
  { routes: [1] }, // stop 2: destination
];

const serviceRoutes: ServiceRoute[] = [
  { type: 'BUS', name: 'Route 0', routes: [0] },
  { type: 'BUS', name: 'Route 1', routes: [1] },
];

// ─── Extended fixture: slower direct route 0→2 ────────────────────────────────
// Route 2 (BUS): 0→2  depart 08:10 / arrive 09:00

const route2 = Route.of({
  id: 2,
  serviceRouteId: 2,
  trips: [
    {
      stops: [
        {
          id: 0,
          arrivalTime: timeFromHM(8, 10),
          departureTime: timeFromHM(8, 10),
        },
        {
          id: 2,
          arrivalTime: timeFromHM(9, 0),
          departureTime: timeFromHM(9, 0),
        },
      ],
    },
  ],
});

const stopsAdjacencyWithDirectRoute: StopAdjacency[] = [
  { routes: [0, 2] }, // stop 0
  { routes: [0, 1] }, // stop 1
  { routes: [1, 2] }, // stop 2
];

const serviceRoutesWithDirectRoute: ServiceRoute[] = [
  { type: 'BUS', name: 'Route 0', routes: [0] },
  { type: 'BUS', name: 'Route 1', routes: [1] },
  { type: 'BUS', name: 'Route 2', routes: [2] },
];

// ─── Extended fixture: walking transfer from stop 1 to stop 2 ─────────────────
// Stop 2 has no routes; can only be reached via the 5-minute walk from stop 1.

const stopsAdjacencyWithTransfer: StopAdjacency[] = [
  { routes: [0] },
  {
    routes: [0],
    transfers: [
      { destination: 2, type: 'REQUIRES_MINIMAL_TIME', minTransferTime: 5 },
    ],
  },
  { routes: [] },
];

// ─── Extended fixture: mixed transport modes ──────────────────────────────────
// Route 0 is BUS, route 1 is RAIL — used to verify mode filtering.

const mixedModeServiceRoutes: ServiceRoute[] = [
  { type: 'BUS', name: 'Route 0', routes: [0] },
  { type: 'RAIL', name: 'Route 1', routes: [1] },
];

// ─── Extended fixture: in-seat trip continuation ──────────────────────────────
// Encodes: at stop-index 1 of route 0, trip 0 → continue as route 1, trip 0,
// boarding at stop-index 0.

const tripContinuations: TripTransfers = new Map([
  [encode(1, 0, 0), [{ stopIndex: 0, routeId: 1, tripIndex: 0 }]],
]);

// ─────────────────────────────────────────────────────────────────────────────

describe('Raptor', () => {
  describe('route scanning', () => {
    it('marks the destination with the correct arrival time', () => {
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
      );
      const state = new RoutingState(
        timeFromHM(8, 0),
        [1],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        6,
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
      };
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(1)?.arrival, timeFromHM(8, 30));
    });

    it('finds a two-leg journey via a route change', () => {
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
      );
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        6,
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
      };
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(1)?.arrival, timeFromHM(8, 30));
      assert.strictEqual(state.getArrival(1)?.legNumber, 1);
      assert.strictEqual(state.getArrival(2)?.arrival, timeFromHM(8, 50));
      assert.strictEqual(state.getArrival(2)?.legNumber, 2);
    });

    it('prefers the faster two-leg route over a slower direct route', () => {
      const timetable = new Timetable(
        stopsAdjacencyWithDirectRoute,
        [route0, route1, route2],
        serviceRoutesWithDirectRoute,
      );
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        6,
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
      };
      raptor.run(options, state);
      // The 0→1→2 journey arrives at 08:50; the direct 0→2 route arrives at 09:00.
      assert.strictEqual(state.getArrival(2)?.arrival, timeFromHM(8, 50));
    });
  });

  describe('maxTransfers', () => {
    it('stops after maxTransfers+1 rounds', () => {
      // maxTransfers=0 means only round 1 runs: stop 1 is reachable (1 leg),
      // but stop 2 requires a second round and must remain unreached.
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
      );
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        1, // maxRounds = maxTransfers + 1
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 0,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
      };
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(1)?.arrival, timeFromHM(8, 30));
      assert.strictEqual(state.getArrival(2), undefined);
    });
  });

  describe('maxDuration', () => {
    it('filters vehicle arrivals after the maxDuration cutoff and allows the exact boundary', () => {
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
      );
      const raptor = new Raptor(timetable);
      const tooShortOptions: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
        maxDuration: 29,
      };

      const tooShort = new RoutingState(
        timeFromHM(8, 0),
        [1],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        tooShortOptions.maxTransfers + 1,
        tooShortOptions.maxDuration,
      );
      raptor.run(tooShortOptions, tooShort);
      assert.strictEqual(tooShort.getArrival(1), undefined);

      const justEnoughOptions: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
        maxDuration: 30,
      };
      const justEnough = new RoutingState(
        timeFromHM(8, 0),
        [1],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        justEnoughOptions.maxTransfers + 1,
        justEnoughOptions.maxDuration,
      );
      raptor.run(justEnoughOptions, justEnough);
      assert.strictEqual(justEnough.getArrival(1)?.arrival, timeFromHM(8, 30));
    });

    it('keeps intermediate stops reachable while filtering later vehicle arrivals', () => {
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
      );
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
        maxDuration: 45,
      };
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        options.maxTransfers + 1,
        options.maxDuration,
      );
      const raptor = new Raptor(timetable);
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(1)?.arrival, timeFromHM(8, 30));
      assert.strictEqual(state.getArrival(2), undefined);
    });

    it('filters timed walking transfers after the maxDuration cutoff', () => {
      const timetable = new Timetable(
        stopsAdjacencyWithTransfer,
        [route0],
        [serviceRoutes[0]!],
      );
      const raptor = new Raptor(timetable);
      const tooShortOptions: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
        maxDuration: 34,
      };

      const tooShort = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        tooShortOptions.maxTransfers + 1,
        tooShortOptions.maxDuration,
      );
      raptor.run(tooShortOptions, tooShort);
      assert.strictEqual(tooShort.getArrival(1)?.arrival, timeFromHM(8, 30));
      assert.strictEqual(tooShort.getArrival(2), undefined);

      const justEnoughOptions: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
        maxDuration: 35,
      };
      const justEnough = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        justEnoughOptions.maxTransfers + 1,
        justEnoughOptions.maxDuration,
      );
      raptor.run(justEnoughOptions, justEnough);
      assert.strictEqual(justEnough.getArrival(2)?.arrival, timeFromHM(8, 35));
    });

    it('filters in-seat continuation arrivals after the maxDuration cutoff', () => {
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
        tripContinuations,
      );
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
        maxDuration: 45,
      };
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        options.maxTransfers + 1,
        options.maxDuration,
      );
      const raptor = new Raptor(timetable);
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(1)?.arrival, timeFromHM(8, 30));
      assert.strictEqual(state.getArrival(2), undefined);
    });
  });

  describe('early termination', () => {
    it('exits when no trips are catchable', () => {
      // Departing at 09:00 — all trips have already left (route 0 at 08:10,
      // route 1 at 08:35).  No stop should be marked.
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
      );
      const state = new RoutingState(
        timeFromHM(9, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        6,
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
      };
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(1), undefined);
      assert.strictEqual(state.getArrival(2), undefined);
    });
  });

  describe('walking transfers', () => {
    it('marks stops reached only via a timed walk', () => {
      // Only route 0 exists (0→1).  Stop 2 has no routes but is reachable from
      // stop 1 via a 5-minute REQUIRES_MINIMAL_TIME transfer.
      // Expected: stop 2 arrival = 08:30 + 5 = 08:35.
      const timetable = new Timetable(
        stopsAdjacencyWithTransfer,
        [route0],
        [serviceRoutes[0]!],
      );
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        6,
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
      };
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(2)?.arrival, timeFromHM(8, 35));
    });
  });

  describe('transport mode filtering', () => {
    it('skips routes of excluded mode', () => {
      // Route 0 is BUS; route 1 is RAIL.  When only RAIL is allowed, route 0
      // is filtered out, stop 0 has no eligible route, and stop 1 is never
      // reached — so neither stop 1 nor stop 2 should be marked.
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        mixedModeServiceRoutes,
      );
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        6,
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: new Set(['RAIL']),
      };
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(1), undefined);
    });
  });

  describe('in-seat transfer continuations', () => {
    it('reaches a stop in the same round via a continuation', () => {
      // Continuation: route 0, trip 0, hop-off stop-index 1 → route 1, trip 0,
      // boarding at stop-index 0.  Because the continuation is processed within
      // round 1 (no extra round needed), stop 2 should have legNumber === 1
      // instead of the legNumber === 2 that a normal two-round journey produces.
      const timetable = new Timetable(
        stopsAdjacency,
        [route0, route1],
        serviceRoutes,
        tripContinuations,
      );
      const state = new RoutingState(
        timeFromHM(8, 0),
        [2],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        NB_STOPS,
        6,
      );
      const raptor = new Raptor(timetable);
      const options: QueryOptions = {
        maxTransfers: 5,
        minTransferTime: 2,
        transportModes: ALL_TRANSPORT_MODES,
      };
      raptor.run(options, state);
      assert.strictEqual(state.getArrival(2)?.arrival, timeFromHM(8, 50));
      assert.strictEqual(state.getArrival(2)?.legNumber, 1);
    });
  });
});
