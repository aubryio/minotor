/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { StopsIndex } from '../../stops/stopsIndex.js';
import { Route } from '../../timetable/route.js';
import {
  ALL_TRANSPORT_MODES,
  RouteTypes,
  StopAdjacency,
  Timetable,
  TransferTypes,
  TripStop,
  TripTransfers,
} from '../../timetable/timetable.js';
import { encode } from '../../timetable/tripStopKey.js';
import { QueryOptions } from '../query.js';
import { RangeRaptorState } from '../rangeState.js';
import { Raptor } from '../raptor.js';
import { Result } from '../result.js';
import { RoutingEdge, RoutingState, UNREACHED_TIME } from '../state.js';

const options: QueryOptions = {
  minTransferTime: 5,
  maxTransfers: 3,
  transportModes: ALL_TRANSPORT_MODES,
};
/** Build a route from fixture stop IDs and per-trip arrival/departure times. */
const route = (id: number, stops: number[], times: number[][]) =>
  Route.of({
    id,
    serviceRouteId: 0,
    trips: times.map((times) => ({
      stops: stops.map((id, i) => ({
        id,
        arrivalTime: times[i]!,
        departureTime: times[i]!,
      })),
    })),
  });
/** Assemble fixture routes, trip rules, and walking transfers into a timetable. */
const createTimetable = (
  routes: Route[],
  transfers: TripTransfers = new Map(),
  continuations: TripTransfers = new Map(),
  walks: [number, number, number][] = [],
) => {
  const stops: StopAdjacency[] = Array.from(
    {
      length:
        Math.max(
          ...routes.flatMap((r) => [...r.stops]),
          ...walks.flatMap(([from, to]) => [from, to]),
        ) + 1,
    },
    () => ({ routes: [] }),
  );
  for (const r of routes) {
    for (const stop of new Set(r.stops)) {
      stops[stop]!.routes.push(r.id);
    }
  }
  for (const [from, destination, minTransferTime] of walks) {
    (stops[from]!.transfers ??= []).push({
      destination,
      minTransferTime,
      type: TransferTypes.REQUIRES_MINIMAL_TIME,
    });
  }
  return new Timetable(
    stops,
    routes,
    [{ name: 'test', type: RouteTypes.BUS, routes: routes.map((r) => r.id) }],
    continuations,
    transfers,
  );
};
/** Run a fixture query from stop zero, applying the supplied option overrides. */
const runRaptor = (
  timetable: Timetable,
  departure = 0,
  overrides: Partial<QueryOptions> = {},
) => {
  const queryOptions = { ...options, ...overrides };
  const state = new RoutingState(
    departure,
    [],
    [{ fromStopId: 0, toStopId: 0, duration: 0 }],
    timetable.nbStops(),
    queryOptions.maxTransfers + 1,
    queryOptions.maxDuration,
  );
  new Raptor(timetable).run(queryOptions, state);
  return state;
};
/**
 * Collect arrival times in stop-ID order for comparison with the independent
 * event router.
 */
const arrivalTimes = (s: RoutingState) =>
  Array.from({ length: s.nbStops }, (_, stop) => s.arrivalTime(stop));

/** Exhaustive event search: no route ordering, stop dominance, or production resolver. */
function exhaustive(
  timetable: Timetable,
  departure: number,
  queryOptions: QueryOptions,
): number[] {
  type Event = { stop: number; time: number; position?: TripStop };
  const best = Array(timetable.nbStops()).fill(UNREACHED_TIME) as number[];
  best[0] = departure;
  let previous: Event[] = [{ stop: 0, time: departure }];
  const maxTime = departure + (queryOptions.maxDuration ?? UNREACHED_TIME);
  const rules = [...timetable.tripTransfers.all()];
  const routes: Route[] = [];
  for (let i = 0; timetable.getRoute(i); i++) {
    routes.push(timetable.getRoute(i)!);
  }
  for (let round = 1; round <= queryOptions.maxTransfers + 1; round++) {
    const reached: Event[] = [];
    const visited = new Map<string, number>();
    const rides: {
      route: Route;
      trip: number;
      start: number;
      continuation: boolean;
      entryTime?: number;
    }[] = [];
    for (const event of previous) {
      for (const r of routes) {
        if (
          !queryOptions.transportModes.has(
            timetable.getServiceRouteInfo(r).type,
          )
        ) {
          continue;
        }
        for (let trip = 0; trip < r.getNbTrips(); trip++) {
          for (let stop = 0; stop < r.getNbStops(); stop++) {
            if (r.pickUpTypeFrom(stop) === 1) {
              continue;
            }
            const dest = r.stopId(stop),
              dep = r.departureFrom(stop, trip);
            let minimum =
              event.stop === dest
                ? event.position
                  ? queryOptions.minTransferTime
                  : 0
                : Infinity;
            if (event.position) {
              for (const walk of timetable.getTransfers(event.stop)) {
                if (walk.destination === dest) {
                  minimum =
                    walk.minTransferTime ?? queryOptions.minTransferTime;
                }
              }
              const source = timetable.tripTransfers.tripStopId(event.position);
              const target = timetable.tripTransfers.tripStopId({
                routeId: r.id,
                tripIndex: trip,
                stopIndex: stop,
              });
              const rule = rules.find(
                (rule) =>
                  rule.source === source &&
                  rule.target === target &&
                  rule.type !== TransferTypes.IN_SEAT,
              );
              if (rule) {
                minimum =
                  rule.type === TransferTypes.GUARANTEED
                    ? 0
                    : rule.minTransferTime!;
              }
            }
            if (
              dep < event.time + minimum ||
              dep > maxTime ||
              (round === 1 &&
                queryOptions.maxInitialWaitingTime !== undefined &&
                dep - event.time > queryOptions.maxInitialWaitingTime)
            ) {
              continue;
            }
            rides.push({ route: r, trip, start: stop, continuation: false });
          }
        }
      }
    }
    for (let q = 0; q < rides.length; q++) {
      const ride = rides[q]!;
      for (
        let stop = ride.start + (ride.continuation ? 0 : 1);
        stop < ride.route.getNbStops();
        stop++
      ) {
        const key = `${ride.route.id}:${ride.trip}:${stop}`;
        const time = Math.max(
          ride.route.arrivalAt(stop, ride.trip),
          stop === ride.start ? (ride.entryTime ?? 0) : 0,
        );
        if (time >= (visited.get(key) ?? Infinity)) {
          continue;
        }
        visited.set(key, time);
        if (time > maxTime) {
          continue;
        }
        const position = {
          routeId: ride.route.id,
          tripIndex: ride.trip,
          stopIndex: stop,
        };
        const source = timetable.tripTransfers.tripStopId(position);
        for (const rule of rules) {
          if (rule.source === source && rule.type === TransferTypes.IN_SEAT) {
            const target = timetable.tripTransfers.position(rule.target),
              r = timetable.getRoute(target.routeId)!;
            if (
              queryOptions.transportModes.has(
                timetable.getServiceRouteInfo(r).type,
              ) &&
              r.departureFrom(target.stopIndex, target.tripIndex) >= time
            ) {
              rides.push({
                route: r,
                trip: target.tripIndex,
                start: target.stopIndex,
                continuation: true,
                entryTime: time,
              });
            }
          }
        }
        if (ride.route.dropOffTypeAt(stop) === 1) {
          continue;
        }
        const stopId = ride.route.stopId(stop);
        best[stopId] = Math.min(best[stopId]!, time);
        reached.push({ stop: stopId, time, position });
        for (const walk of timetable.getTransfers(stopId)) {
          const arrival =
            time + (walk.minTransferTime ?? queryOptions.minTransferTime);
          if (arrival <= maxTime) {
            best[walk.destination] = Math.min(best[walk.destination]!, arrival);
          }
        }
      }
    }
    previous = reached;
  }
  return best;
}

/** Check predecessor timing and boarding counts for every retained stop arrival. */
function validateLinks(timetable: Timetable, state: RoutingState): void {
  for (const { stop, legNumber } of state.arrivals()) {
    let edge: RoutingEdge | undefined = state.parents[legNumber]![stop];
    let boardings = 0;
    const seen = new Set<RoutingEdge>();
    while (edge) {
      assert(!seen.has(edge), 'predecessor cycle');
      seen.add(edge);
      if ('routeId' in edge) {
        const r = timetable.getRoute(edge.routeId)!;
        assert.equal(
          edge.arrival,
          Math.max(
            r.arrivalAt(edge.hopOffStopIndex, edge.tripIndex),
            edge.hopOffStopIndex === edge.stopIndex
              ? (edge.continuationOf?.arrival ?? 0)
              : 0,
          ),
        );
        assert(edge.predecessor);
        assert(
          r.departureFrom(edge.stopIndex, edge.tripIndex) >=
            edge.predecessor.arrival,
        );
        if (!edge.continuationOf) {
          boardings++;
        }
        edge = edge.continuationOf ?? edge.predecessor;
      } else if ('type' in edge) {
        assert(edge.arrival >= edge.predecessor.arrival);
        edge = edge.predecessor;
      } else {
        break;
      }
    }
    assert.equal(boardings, legNumber);
  }
}

describe('transfer-aware trip scans', () => {
  it('keeps a later trip on the same route for its guaranteed connection', () => {
    const timetable = createTimetable(
      [
        route(
          0,
          [0, 1],
          [
            [0, 10],
            [1, 11],
          ],
        ),
        route(1, [1, 2], [[12, 20]]),
      ],
      new Map([
        [encode(1, 0, 1), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    const state = runRaptor(timetable);
    assert.equal(state.arrivalTime(2), 20);
    const target = state.parents[2]![2]!;
    assert('routeId' in target && 'type' in target.predecessor);
    const feeder = target.predecessor.predecessor;
    assert('routeId' in feeder && feeder.tripIndex === 1);
    validateLinks(timetable, state);
    assert.deepEqual(arrivalTimes(state), exhaustive(timetable, 0, options));
  });

  it('does not bypass a longer pair-specific minimum via a generic platform walk', () => {
    const timetable = createTimetable(
      [
        route(
          0,
          [0, 1],
          [
            [0, 10],
            [1, 11],
          ],
        ),
        route(
          1,
          [2, 3],
          [
            [12, 20],
            [20, 30],
          ],
        ),
      ],
      new Map([
        [
          encode(1, 0, 0),
          [
            {
              routeId: 1,
              tripIndex: 0,
              stopIndex: 0,
              type: TransferTypes.REQUIRES_MINIMAL_TIME,
              minTransferTime: 60,
            },
          ],
        ],
      ]),
      new Map(),
      [[1, 2, 1]],
    );
    // The later, ordinary feeder is still useful despite the earlier arrival.
    const state = runRaptor(timetable);
    assert.equal(state.arrivalTime(3), 20);
    validateLinks(timetable, state);
    assert.deepEqual(arrivalTimes(state), exhaustive(timetable, 0, options));
    const restrictedOnly = createTimetable(
      [
        route(0, [0, 1], [[0, 10]]),
        route(
          1,
          [2, 3],
          [
            [12, 20],
            [20, 30],
          ],
        ),
      ],
      new Map([
        [
          encode(1, 0, 0),
          [
            {
              routeId: 1,
              tripIndex: 0,
              stopIndex: 0,
              type: TransferTypes.REQUIRES_MINIMAL_TIME,
              minTransferTime: 60,
            },
          ],
        ],
      ]),
      new Map(),
      [[1, 2, 1]],
    );
    assert.equal(runRaptor(restrictedOnly).arrivalTime(3), 30);
  });

  it('honors zero and boundary minimums across stops without a generic walk', () => {
    for (const minimum of [0, 2, 3]) {
      const timetable = createTimetable(
        [route(0, [0, 1], [[0, 10]]), route(1, [2, 3], [[12, 20]])],
        new Map([
          [
            encode(1, 0, 0),
            [
              {
                routeId: 1,
                tripIndex: 0,
                stopIndex: 0,
                type: TransferTypes.REQUIRES_MINIMAL_TIME,
                minTransferTime: minimum,
              },
            ],
          ],
        ]),
      );
      assert.equal(
        runRaptor(timetable).arrivalTime(3),
        minimum <= 2 ? 20 : UNREACHED_TIME,
      );
      assert.deepEqual(
        arrivalTimes(runRaptor(timetable)),
        exhaustive(timetable, 0, options),
      );
      assert.deepEqual(
        arrivalTimes(runRaptor(Timetable.fromData(timetable.serialize()))),
        arrivalTimes(runRaptor(timetable)),
      );
    }
  });

  it('retains dominated in-seat feeders and terminates zero-time continuation cycles', () => {
    const timetable = createTimetable(
      [
        route(
          0,
          [0, 1],
          [
            [0, 10],
            [1, 11],
          ],
        ),
        route(1, [1, 2], [[11, 20]]),
      ],
      new Map(),
      new Map([
        [encode(1, 0, 1), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
        [encode(0, 1, 0), [{ routeId: 0, tripIndex: 1, stopIndex: 1 }]],
      ]),
    );
    assert.deepEqual(
      [...Timetable.fromData(timetable.serialize()).tripTransfers.all()],
      [...timetable.tripTransfers.all()],
    );
    const state = runRaptor(timetable, 0, { maxTransfers: 0 });
    assert.equal(state.arrivalTime(2), 20);
    assert.equal(state.getArrival(2)?.legNumber, 1);
    validateLinks(timetable, state);
  });

  it('processes non-public continuation points without moving arrival backwards during dwell', () => {
    const source = Route.of({
      id: 0,
      serviceRouteId: 0,
      trips: [
        {
          stops: [
            { id: 0, arrivalTime: 0, departureTime: 0 },
            {
              id: 1,
              arrivalTime: 10,
              departureTime: 10,
              pickUpType: 1,
              dropOffType: 1,
            },
          ],
        },
      ],
    });
    const target = Route.of({
      id: 1,
      serviceRouteId: 0,
      trips: [
        {
          stops: [
            { id: 2, arrivalTime: 8, departureTime: 12, pickUpType: 1 },
            { id: 3, arrivalTime: 20, departureTime: 20 },
          ],
        },
      ],
    });
    const timetable = createTimetable(
      [source, target],
      new Map(),
      new Map([
        [encode(1, 0, 0), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    assert.deepEqual(
      [...Timetable.fromData(timetable.serialize()).tripTransfers.all()],
      [...timetable.tripTransfers.all()],
    );
    const state = runRaptor(timetable, 0, { maxTransfers: 0 });
    assert.equal(state.arrivalTime(1), UNREACHED_TIME);
    assert.equal(state.arrivalTime(2), 10);
    assert.equal(state.arrivalTime(3), 20);
    validateLinks(timetable, state);
    const stops = new StopsIndex(
      Array.from({ length: 4 }, (_, id) => ({
        id,
        sourceStopId: String(id),
        name: String(id),
        children: [],
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
      })),
    );
    const result = new Result(state, stops, timetable);
    const journey = result.bestRoute(new Set([3]));
    assert(journey);
  });

  it('does not hold departures or exceed waiting, duration, or mode limits', () => {
    const timetable = createTimetable(
      [route(0, [0, 1], [[5, 10]]), route(1, [1, 2], [[9, 20]])],
      new Map([
        [encode(1, 0, 0), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    assert.equal(runRaptor(timetable).arrivalTime(2), UNREACHED_TIME);
    assert.equal(
      runRaptor(timetable, 0, { maxInitialWaitingTime: 4 }).arrivalTime(1),
      UNREACHED_TIME,
    );
    assert.equal(
      runRaptor(timetable, 0, { maxDuration: 9 }).arrivalTime(1),
      UNREACHED_TIME,
    );
    assert.equal(
      runRaptor(timetable, 0, {
        transportModes: new Set([RouteTypes.RAIL]),
      }).arrivalTime(1),
      UNREACHED_TIME,
    );
  });

  it('relaxes walks from the best vehicle arrival without chaining footpaths', () => {
    const timetable = createTimetable(
      [
        route(0, [0, 1], [[0, 20]]),
        route(1, [0, 1], [[0, 10]]),
        route(2, [2, 3], [[15, 25]]),
      ],
      new Map(),
      new Map(),
      [
        [1, 2, 3],
        [2, 4, 1],
      ],
    );
    const state = runRaptor(timetable);
    assert.equal(state.arrivalTime(2), 13);
    assert.equal(state.arrivalTime(3), 25);
    assert.equal(state.arrivalTime(4), UNREACHED_TIME);
    validateLinks(timetable, state);
  });

  it('prunes later alternative destinations after finding the earliest arrival', () => {
    const timetable = createTimetable([route(0, [0, 1, 2], [[0, 10, 20]])]);
    const state = new RoutingState(
      0,
      [1, 2],
      [{ fromStopId: 0, toStopId: 0, duration: 0 }],
      3,
      4,
    );
    new Raptor(timetable).run(options, state);
    assert.equal(state.arrivalTime(1), 10);
    assert.equal(state.arrivalTime(2), UNREACHED_TIME);
  });

  it('rejects old datasets and invalid numeric references', () => {
    assert.throws(() => Timetable.fromData(new Uint8Array()), /regenerate/);
    const timetable = createTimetable([route(0, [0, 1], [[0, 10]])]);
    assert.equal(timetable.tripTransfers.tripId(0, 0), 0);
    assert.equal(
      timetable.tripTransfers.tripStopId({
        routeId: 0,
        tripIndex: 0,
        stopIndex: 1,
      }),
      1,
    );
    assert.throws(() =>
      timetable.tripTransfers.tripStopId({
        routeId: 0,
        tripIndex: 1,
        stopIndex: 0,
      }),
    );
  });

  it('stops the ordered scan at waiting, duration, and destination bounds', () => {
    for (const limit of ['waiting', 'duration', 'destination'] as const) {
      const r = route(
        0,
        [0, 1],
        Array.from({ length: 10000 }, (_, i) => [6 + i, 7 + i]),
      );
      let checks = 0;
      const departureFrom = r.departureFrom.bind(r);
      r.departureFrom = (...args) => {
        checks++;
        return departureFrom(...args);
      };
      const timetable = createTimetable([r]);
      const state = new RoutingState(
        0,
        limit === 'destination' ? [1] : [],
        [
          { fromStopId: 0, toStopId: 0, duration: 0 },
          ...(limit === 'destination'
            ? [{ fromStopId: 0, toStopId: 1, duration: 5 }]
            : []),
        ],
        2,
        1,
        limit === 'duration' ? 5 : undefined,
      );
      new Raptor(timetable).run(
        {
          ...options,
          maxTransfers: 0,
          ...(limit === 'waiting' && { maxInitialWaitingTime: 5 }),
        },
        state,
      );
      assert.equal(
        state.arrivalTime(1),
        limit === 'destination' ? 5 : UNREACHED_TIME,
      );
      // Include the binary searches at the (at most two) seeded origins.
      assert(
        checks <= 2 * Math.ceil(Math.log2(r.getNbTrips())) + 4,
        `${limit}: inspected ${checks} departures`,
      );
    }
    // Waiting and duration are inclusive, unlike the destination improvement bound.
    const timetable = createTimetable([route(0, [0, 1], [[5, 5]])]);
    assert.equal(
      runRaptor(timetable, 0, {
        maxInitialWaitingTime: 5,
        maxDuration: 5,
      }).arrivalTime(1),
      5,
    );
  });

  it('clears reused frontiers after a round limit and a failed run', () => {
    const timetable = createTimetable(
      [route(0, [0, 1], [[0, 10]]), route(1, [1, 2], [[10, 20]])],
      new Map([
        [encode(1, 0, 0), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    const raptor = new Raptor(timetable);
    const states: RoutingState[] = [];
    for (const [departure, maxTransfers] of [
      [0, 0],
      [100, 3],
      [0, 3],
    ] as const) {
      const state = new RoutingState(
        departure,
        [],
        [{ fromStopId: 0, toStopId: 0, duration: 0 }],
        timetable.nbStops(),
        4,
      );
      raptor.run({ ...options, maxTransfers }, state);
      assert.deepEqual(
        arrivalTimes(state),
        arrivalTimes(runRaptor(timetable, departure, { maxTransfers })),
      );
      states.push(state);
    }
    const r = timetable.getRoute(0)!;
    const original = r.departureFrom.bind(r);
    r.departureFrom = () => {
      throw new Error('injected failure');
    };
    assert.throws(() => {
      raptor.run(
        options,
        new RoutingState(
          0,
          [],
          [{ fromStopId: 0, toStopId: 0, duration: 0 }],
          timetable.nbStops(),
          4,
        ),
      );
    }, /injected failure/);
    r.departureFrom = original;
    const late = new RoutingState(
      100,
      [],
      [{ fromStopId: 0, toStopId: 0, duration: 0 }],
      timetable.nbStops(),
      4,
    );
    raptor.run(options, late);
    assert.equal(late.arrivalTime(2), UNREACHED_TIME);
    assert.equal(states[0]!.arrivalTime(2), UNREACHED_TIME);
    assert.equal(states[2]!.arrivalTime(2), 20);
    for (const state of states) validateLinks(timetable, state);
  });

  it('matches an exhaustive event router on generated networks and descending range runs', () => {
    let seed = 173;
    const rulePairs = new Set<string>();
    /**
     * Advance the deterministic generator and return an integer below the
     * exclusive bound.
     */
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      // Scale the full word; the low bits of this LCG have short cycles.
      return Math.floor((seed / 0x100000000) * n);
    };
    for (let sample = 0; sample < 500; sample++) {
      const routes = Array.from({ length: 4 }, (_, id) => {
        const stops = Array.from({ length: 2 + random(3) }, () => random(5));
        stops[0] = id === 0 ? 0 : 1 + random(3);
        const departure = random(20),
          duration = 1 + random(10);
        // Every trip in a route shares its public boarding/alighting pattern.
        const pickups = stops.map(() => (random(4) === 0 ? 1 : 0));
        const dropoffs = stops.map(() => (random(4) === 0 ? 1 : 0));
        return Route.of({
          id,
          serviceRouteId: 0,
          trips: [0, 5, 10].map((offset) => ({
            stops: stops.map((stop, position) => ({
              id: stop,
              arrivalTime: departure + offset + position * duration,
              departureTime: departure + offset + position * duration,
              pickUpType: pickups[position]!,
              dropOffType: dropoffs[position]!,
            })),
          })),
        });
      });
      const rules: TripTransfers = new Map();
      for (let j = 0; j < 8; j++) {
        const from = random(4),
          trip = random(3),
          target = random(4),
          targetTrip = random(3);
        const stopIndex = random(routes[target]!.getNbStops());
        const key = encode(random(routes[from]!.getNbStops()), from, trip),
          list = rules.get(key) ?? [];
        if (
          list.some(
            (r) =>
              r.routeId === target &&
              r.tripIndex === targetTrip &&
              r.stopIndex === stopIndex,
          )
        ) {
          continue;
        }
        list.push({
          routeId: target,
          tripIndex: targetTrip,
          stopIndex,
          ...(random(2) === 0
            ? { type: TransferTypes.GUARANTEED }
            : {
                type: TransferTypes.REQUIRES_MINIMAL_TIME,
                minTransferTime: random(15),
              }),
        });
        rules.set(key, list);
        rulePairs.add(`${from}:${target}`);
      }
      const continuations: TripTransfers = new Map();
      for (let j = 0; j < 2; j++) {
        const from = random(4),
          to = random(4),
          sourceTrip = random(3),
          targetTrip = random(3);
        const fromIndex = random(routes[from]!.getNbStops());
        const toIndex = random(routes[to]!.getNbStops());
        if (
          routes[from]!.arrivalAt(fromIndex, sourceTrip) <=
          routes[to]!.departureFrom(toIndex, targetTrip)
        ) {
          continuations.set(encode(fromIndex, from, sourceTrip), [
            { routeId: to, tripIndex: targetTrip, stopIndex: toIndex },
          ]);
        }
      }
      const timetable = createTimetable(routes, rules, continuations, [
        [1, 2, 1],
        [2, 3, 2],
      ]);
      const queryOptions = { ...options, maxDuration: 30 + random(15) };
      const shared = new RangeRaptorState(4, timetable.nbStops(), 10);
      const expectedRange = Array(timetable.nbStops()).fill(
        UNREACHED_TIME,
      ) as number[];
      const actualRange = [...expectedRange];
      for (const departure of [10, 5, 0]) {
        const state = runRaptor(timetable, departure, queryOptions);
        const expected = exhaustive(timetable, departure, queryOptions);
        assert.deepEqual(
          arrivalTimes(state),
          expected,
          `sample ${sample}, departure ${departure}`,
        );
        validateLinks(timetable, state);
        // Target pruning must preserve the best answer among alternatives.
        const targets = [1, timetable.nbStops() - 1];
        const targeted = new RoutingState(
          departure,
          targets,
          [{ fromStopId: 0, toStopId: 0, duration: 0 }],
          timetable.nbStops(),
          4,
          queryOptions.maxDuration,
        );
        new Raptor(timetable).run(queryOptions, targeted);
        assert.equal(
          targeted.destinationBest,
          Math.min(...targets.map((stop) => expected[stop]!)),
        );
        validateLinks(timetable, targeted);
        const rangeRun = new RoutingState(
          departure,
          [],
          [{ fromStopId: 0, toStopId: 0, duration: 0 }],
          timetable.nbStops(),
          4,
          queryOptions.maxDuration,
        );
        shared.setCurrentRun(rangeRun);
        new Raptor(timetable).run(queryOptions, shared);
        for (let stop = 0; stop < timetable.nbStops(); stop++) {
          expectedRange[stop] = Math.min(expectedRange[stop]!, expected[stop]!);
          actualRange[stop] = Math.min(
            actualRange[stop]!,
            rangeRun.arrivalTime(stop),
          );
        }
        assert.deepEqual(actualRange, expectedRange);
        validateLinks(timetable, rangeRun);
      }
    }
    assert.equal(rulePairs.size, 16, 'exercise every ordered pair of routes');
  });
});

it('skips expired exceptional trips before attempting boardings', () => {
  const count = 10000;
  const timetable = createTimetable(
    [
      route(
        0,
        [0, 1],
        Array.from({ length: count }, (_, i) => [i, i + 1]),
      ),
    ],
    new Map(
      Array.from({ length: count }, (_, i) => [
        encode(1, 0, i),
        [{ routeId: 0, tripIndex: i, stopIndex: 0 }],
      ]),
    ),
  );
  const raptor = new Raptor(timetable);
  const state = new RoutingState(
    count + 10,
    [],
    [{ fromStopId: 0, toStopId: 0, duration: 0 }],
    2,
    1,
  );
  raptor.run({ ...options, maxTransfers: 0 }, state);
  assert.equal(raptor.statistics.exceptionalTripsConsidered, 0);
  assert.equal(raptor.statistics.exceptionalBoardingAttempts, 0);
});

it('plots feeder predecessors that do not win the stop label', async () => {
  const { Plotter } = await import('../plotter.js');
  const timetable = createTimetable(
    [
      route(
        0,
        [0, 1],
        [
          [0, 10],
          [1, 11],
        ],
      ),
      route(1, [1, 2], [[12, 20]]),
    ],
    new Map([[encode(1, 0, 1), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]]]),
  );
  const stops = new StopsIndex(
    [0, 1, 2].map((id) => ({
      id,
      sourceStopId: String(id),
      name: String(id),
      children: [],
      locationType: 'SIMPLE_STOP_OR_PLATFORM',
    })),
  );
  const dot = new Plotter(
    new Result(runRaptor(timetable), stops, timetable),
  ).plotDotGraph();
  assert(dot.includes('0:0'));
  assert(dot.includes('0:1'));
  assert(dot.includes('Transfer'));
  assert(dot.includes('"s_0"'));
  const declarations = [...dot.matchAll(/"(edge_\d+)" \[label=/g)].map(
    (match) => match[1],
  );
  assert.equal(new Set(declarations).size, declarations.length);
});

it('keeps arrival publication and boarding retention independent across range runs', () => {
  const timetable = createTimetable(
    [route(0, [0, 1], [[0, 10]])],
    new Map(),
    new Map(),
    [[1, 2, 2]],
  );
  for (const outcome of ['publish', 'retain'] as const) {
    const previous = new RoutingState(1, [], [], 3, 2);
    const shared = new RangeRaptorState(2, 3, 1);
    shared.setCurrentRun(previous);
    if (outcome === 'publish') {
      shared.updateBoardingBound(1, 2, 12);
    } else {
      shared.updateArrival(2, 11, 1);
    }
    const current = new RoutingState(
      0,
      [],
      [{ fromStopId: 0, toStopId: 0, duration: 0 }],
      3,
      2,
    );
    shared.setCurrentRun(current);
    const raptor = new Raptor(timetable);
    raptor.run({ ...options, maxTransfers: 0 }, shared);
    assert.equal(
      current.parents[1]![2]?.arrival,
      outcome === 'publish' ? 12 : undefined,
    );
    assert.equal(shared.boardingBound(1, 2), 12);
    // Both cases retain same-stop readiness; only the second retains the walk.
    assert.equal(
      raptor.statistics.retainedContexts,
      outcome === 'publish' ? 1 : 2,
    );
  }
});

it('retains a boarding decided before walking arrival tightens the destination bound', () => {
  const timetable = createTimetable(
    [route(0, [0, 1], [[0, 10]])],
    new Map(),
    new Map(),
    [[1, 2, 2]],
  );
  const state = new RoutingState(
    0,
    [2],
    [{ fromStopId: 0, toStopId: 0, duration: 0 }],
    3,
    2,
  );
  const raptor = new Raptor(timetable);
  raptor.run({ ...options, maxTransfers: 0 }, state);
  assert.equal(state.destinationBest, 12);
  assert.equal(state.parents[1]![2]?.arrival, 12);
  assert.equal(raptor.statistics.retainedContexts, 1);
});

it('tries ordinary boarding first and falls back to conditional rights', () => {
  for (const ordinaryArrival of [5, 6]) {
    const timetable = createTimetable(
      [
        route(0, [0, 1], [[0, ordinaryArrival]]),
        route(1, [0, 1], [[0, 7]]),
        route(2, [1, 2], [[10, 20]]),
        route(3, [2, 3], [[30, 40]]),
      ],
      new Map([
        [encode(1, 1, 0), [{ routeId: 2, tripIndex: 0, stopIndex: 0 }]],
        [encode(1, 2, 0), [{ routeId: 3, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    const state = new RoutingState(
      0,
      [],
      [{ fromStopId: 0, toStopId: 0, duration: 0 }],
      4,
      3,
    );
    const raptor = new Raptor(timetable);
    raptor.run({ ...options, maxTransfers: 1 }, state);
    const edge = state.parents[2]![2];
    assert.ok(edge && 'routeId' in edge);
    assert.equal(edge.routeId, 2);
    assert.equal(edge.arrival, 20);
    const predecessor = edge.predecessor;
    if (ordinaryArrival === 5) {
      assert.ok('routeId' in predecessor);
      assert.equal(predecessor.routeId, 0);
      assert.equal(raptor.statistics.exceptionalBoardingAttempts, 2);
    } else {
      assert.ok('type' in predecessor);
      assert.equal(predecessor.type, TransferTypes.GUARANTEED);
      assert.ok('routeId' in predecessor.predecessor);
      assert.equal(predecessor.predecessor.routeId, 1);
      assert.equal(raptor.statistics.exceptionalBoardingAttempts, 3);
    }
  }
});
