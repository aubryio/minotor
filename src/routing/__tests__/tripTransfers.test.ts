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
import { encode } from '../../timetable/tripStopId.js';
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
const make = (
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
const run = (
  tt: Timetable,
  departure = 0,
  overrides: Partial<QueryOptions> = {},
) => {
  const opts = { ...options, ...overrides };
  const state = new RoutingState(
    departure,
    [],
    [{ fromStopId: 0, toStopId: 0, duration: 0 }],
    tt.nbStops(),
    opts.maxTransfers + 1,
    opts.maxDuration,
  );
  new Raptor(tt).run(opts, state);
  return state;
};
const arrivals = (s: RoutingState) =>
  Array.from({ length: s.nbStops }, (_, stop) => s.arrivalTime(stop));

/** Exhaustive event search: no route ordering, stop dominance, or production resolver. */
function exhaustive(
  tt: Timetable,
  departure: number,
  opts: QueryOptions,
): number[] {
  type Event = { stop: number; time: number; position?: TripStop };
  const best = Array(tt.nbStops()).fill(UNREACHED_TIME) as number[];
  best[0] = departure;
  let previous: Event[] = [{ stop: 0, time: departure }];
  const maxTime = departure + (opts.maxDuration ?? UNREACHED_TIME);
  const rules = [...tt.tripTransfers.all()];
  const routes: Route[] = [];
  for (let i = 0; tt.getRoute(i); i++) {
    routes.push(tt.getRoute(i)!);
  }
  for (let round = 1; round <= opts.maxTransfers + 1; round++) {
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
        if (!opts.transportModes.has(tt.getServiceRouteInfo(r).type)) {
          continue;
        }
        for (let trip = 0; trip < r.getNbTrips(); trip++) {
          for (let stop = 0; stop < r.getNbStops(); stop++) {
            if (r.pickUpTypeFrom(stop, trip) === 1) {
              continue;
            }
            const dest = r.stopId(stop),
              dep = r.departureFrom(stop, trip);
            let minimum =
              event.stop === dest
                ? event.position
                  ? opts.minTransferTime
                  : 0
                : Infinity;
            if (event.position) {
              for (const walk of tt.getTransfers(event.stop)) {
                if (walk.destination === dest) {
                  minimum = walk.minTransferTime ?? opts.minTransferTime;
                }
              }
              const source = tt.tripTransfers.occurrence(event.position);
              const target = tt.tripTransfers.occurrence({
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
                opts.maxInitialWaitingTime !== undefined &&
                dep - event.time > opts.maxInitialWaitingTime)
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
        const source = tt.tripTransfers.occurrence(position);
        for (const rule of rules) {
          if (rule.source === source && rule.type === TransferTypes.IN_SEAT) {
            const target = tt.tripTransfers.position(rule.target),
              r = tt.getRoute(target.routeId)!;
            if (
              opts.transportModes.has(tt.getServiceRouteInfo(r).type) &&
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
        if (ride.route.dropOffTypeAt(stop, ride.trip) === 1) {
          continue;
        }
        const stopId = ride.route.stopId(stop);
        best[stopId] = Math.min(best[stopId]!, time);
        reached.push({ stop: stopId, time, position });
        for (const walk of tt.getTransfers(stopId)) {
          const arrival = time + (walk.minTransferTime ?? opts.minTransferTime);
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

function validateLinks(tt: Timetable, state: RoutingState): void {
  for (const { stop, legNumber } of state.arrivals()) {
    let edge: RoutingEdge | undefined = state.graph[legNumber]![stop];
    let boardings = 0;
    const seen = new Set<RoutingEdge>();
    while (edge) {
      assert(!seen.has(edge), 'predecessor cycle');
      seen.add(edge);
      if ('routeId' in edge) {
        const r = tt.getRoute(edge.routeId)!;
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
        assert(edge.predecessor && edge.arrival >= edge.predecessor.arrival);
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
    const tt = make(
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
    const state = run(tt);
    assert.equal(state.arrivalTime(2), 20);
    const target = state.graph[2]![2]!;
    assert(
      'routeId' in target && target.predecessor && 'type' in target.predecessor,
    );
    const feeder = target.predecessor.predecessor!;
    assert('routeId' in feeder && feeder.tripIndex === 1);
    validateLinks(tt, state);
    assert.deepEqual(arrivals(state), exhaustive(tt, 0, options));
  });

  it('does not bypass a longer pair-specific minimum via a generic platform walk', () => {
    const tt = make(
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
    // The later, unrestricted feeder is still useful despite the earlier arrival.
    const state = run(tt);
    assert.equal(state.arrivalTime(3), 20);
    validateLinks(tt, state);
    assert.deepEqual(arrivals(state), exhaustive(tt, 0, options));
    const restrictedOnly = make(
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
    assert.equal(run(restrictedOnly).arrivalTime(3), 30);
  });

  it('honors zero and boundary minimums across stops without a generic walk', () => {
    for (const minimum of [0, 2, 3]) {
      const tt = make(
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
      assert.equal(run(tt).arrivalTime(3), minimum <= 2 ? 20 : UNREACHED_TIME);
      assert.deepEqual(arrivals(run(tt)), exhaustive(tt, 0, options));
      assert.deepEqual(
        arrivals(run(Timetable.fromData(tt.serialize()))),
        arrivals(run(tt)),
      );
    }
  });

  it('retains dominated in-seat feeders and terminates zero-time continuation cycles', () => {
    const tt = make(
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
      [...Timetable.fromData(tt.serialize()).tripTransfers.all()],
      [...tt.tripTransfers.all()],
    );
    const state = run(tt, 0, { maxTransfers: 0 });
    assert.equal(state.arrivalTime(2), 20);
    assert.equal(state.getArrival(2)?.legNumber, 1);
    validateLinks(tt, state);
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
    const tt = make(
      [source, target],
      new Map(),
      new Map([
        [encode(1, 0, 0), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    assert.deepEqual(
      [...Timetable.fromData(tt.serialize()).tripTransfers.all()],
      [...tt.tripTransfers.all()],
    );
    const state = run(tt, 0, { maxTransfers: 0 });
    assert.equal(state.arrivalTime(1), UNREACHED_TIME);
    assert.equal(state.arrivalTime(2), 10);
    assert.equal(state.arrivalTime(3), 20);
    validateLinks(tt, state);
    const stops = new StopsIndex(
      Array.from({ length: 4 }, (_, id) => ({
        id,
        sourceStopId: String(id),
        name: String(id),
        children: [],
        locationType: 'SIMPLE_STOP_OR_PLATFORM',
      })),
    );
    const result = new Result(state, stops, tt);
    const journey = result.bestRoute(new Set([3]));
    assert(journey);
  });

  it('does not hold departures or exceed waiting, duration, or mode limits', () => {
    const tt = make(
      [route(0, [0, 1], [[5, 10]]), route(1, [1, 2], [[9, 20]])],
      new Map([
        [encode(1, 0, 0), [{ routeId: 1, tripIndex: 0, stopIndex: 0 }]],
      ]),
    );
    assert.equal(run(tt).arrivalTime(2), UNREACHED_TIME);
    assert.equal(
      run(tt, 0, { maxInitialWaitingTime: 4 }).arrivalTime(1),
      UNREACHED_TIME,
    );
    assert.equal(run(tt, 0, { maxDuration: 9 }).arrivalTime(1), UNREACHED_TIME);
    assert.equal(
      run(tt, 0, { transportModes: new Set([RouteTypes.RAIL]) }).arrivalTime(1),
      UNREACHED_TIME,
    );
  });

  it('relaxes walks from the best vehicle arrival without chaining footpaths', () => {
    const tt = make(
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
    const state = run(tt);
    assert.equal(state.arrivalTime(2), 13);
    assert.equal(state.arrivalTime(3), 25);
    assert.equal(state.arrivalTime(4), UNREACHED_TIME);
    validateLinks(tt, state);
  });

  it('prunes later alternative destinations after finding the earliest arrival', () => {
    const tt = make([route(0, [0, 1, 2], [[0, 10, 20]])]);
    const state = new RoutingState(
      0,
      [1, 2],
      [{ fromStopId: 0, toStopId: 0, duration: 0 }],
      3,
      4,
    );
    new Raptor(tt).run(options, state);
    assert.equal(state.arrivalTime(1), 10);
    assert.equal(state.arrivalTime(2), UNREACHED_TIME);
  });

  it('rejects old datasets and invalid numeric references', () => {
    assert.throws(() => Timetable.fromData(new Uint8Array()), /regenerate/);
    const tt = make([route(0, [0, 1], [[0, 10]])]);
    assert.equal(tt.tripTransfers.tripId(0, 0), 0);
    assert.equal(
      tt.tripTransfers.occurrence({ routeId: 0, tripIndex: 0, stopIndex: 1 }),
      1,
    );
    assert.throws(() =>
      tt.tripTransfers.occurrence({ routeId: 0, tripIndex: 1, stopIndex: 0 }),
    );
  });

  it('matches an exhaustive event router on generated networks and descending range runs', () => {
    let seed = 173;
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    for (let sample = 0; sample < 100; sample++) {
      const routes = Array.from({ length: 4 }, (_, id) => {
        const start = id === 0 ? 0 : 1 + random(3);
        const end = 1 + random(4);
        const departure = random(20),
          duration = 1 + random(10);
        return route(
          id,
          [start, end],
          [
            [departure, departure + duration],
            [departure + 5, departure + duration + 5],
            [departure + 10, departure + duration + 10],
          ],
        );
      });
      const rules: TripTransfers = new Map();
      for (let j = 0; j < 8; j++) {
        const from = random(4),
          trip = random(3),
          target = random(4),
          targetTrip = random(3);
        const key = encode(1, from, trip),
          list = rules.get(key) ?? [];
        if (
          list.some((r) => r.routeId === target && r.tripIndex === targetTrip)
        ) {
          continue;
        }
        list.push({
          routeId: target,
          tripIndex: targetTrip,
          stopIndex: 0,
          type: TransferTypes.REQUIRES_MINIMAL_TIME,
          minTransferTime: random(15),
        });
        rules.set(key, list);
      }
      const continuations: TripTransfers = new Map();
      for (let j = 0; j < 2; j++) {
        const from = random(4),
          to = random(4),
          sourceTrip = random(3),
          targetTrip = random(3);
        if (
          routes[from]!.arrivalAt(1, sourceTrip) <=
          routes[to]!.departureFrom(0, targetTrip)
        ) {
          continuations.set(encode(1, from, sourceTrip), [
            { routeId: to, tripIndex: targetTrip, stopIndex: 0 },
          ]);
        }
      }
      const tt = make(routes, rules, continuations, [
        [1, 2, 1],
        [2, 3, 2],
      ]);
      const opts = { ...options, maxDuration: 30 + random(15) };
      const shared = new RangeRaptorState(4, tt.nbStops(), 10);
      const expectedRange = Array(tt.nbStops()).fill(
        UNREACHED_TIME,
      ) as number[];
      const actualRange = [...expectedRange];
      for (const departure of [10, 5, 0]) {
        const state = run(tt, departure, opts);
        const expected = exhaustive(tt, departure, opts);
        assert.deepEqual(
          arrivals(state),
          expected,
          `sample ${sample}, departure ${departure}`,
        );
        validateLinks(tt, state);
        // Target pruning must preserve the best answer among alternatives.
        const targets = [1, tt.nbStops() - 1];
        const targeted = new RoutingState(
          departure,
          targets,
          [{ fromStopId: 0, toStopId: 0, duration: 0 }],
          tt.nbStops(),
          4,
          opts.maxDuration,
        );
        new Raptor(tt).run(opts, targeted);
        assert.equal(
          targeted.destinationBest,
          Math.min(...targets.map((stop) => expected[stop]!)),
        );
        validateLinks(tt, targeted);
        const rangeRun = new RoutingState(
          departure,
          [],
          [{ fromStopId: 0, toStopId: 0, duration: 0 }],
          tt.nbStops(),
          4,
          opts.maxDuration,
        );
        shared.setCurrentRun(rangeRun);
        new Raptor(tt).run(opts, shared);
        for (let stop = 0; stop < tt.nbStops(); stop++) {
          expectedRange[stop] = Math.min(expectedRange[stop]!, expected[stop]!);
          actualRange[stop] = Math.min(
            actualRange[stop]!,
            rangeRun.arrivalTime(stop),
          );
        }
        assert.deepEqual(actualRange, expectedRange);
        validateLinks(tt, rangeRun);
      }
    }
  });
});
