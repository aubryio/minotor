/** Run with node --expose-gc --import tsx src/benchmarks/raptor.ts [baseline-root]. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Result, StopArrival } from '../routing/result.js';
import type { RoutingState } from '../routing/state.js';
import type { MinimumTripTransfers } from '../timetable/timetable.js';

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? '.');
  const moduleUrl = (path: string) => pathToFileURL(resolve(root, path)).href;
  const {
    Router,
    Query,
    RangeQuery,
    RangeResult,
    Timetable,
    StopsIndex,
    RouteTypes,
  } = (await import(
    moduleUrl('src/router.ts')
  )) as typeof import('../router.js');
  const { Route } = (await import(
    moduleUrl('src/timetable/route.ts')
  )) as typeof import('../timetable/route.js');
  const { encode } = (await import(
    moduleUrl('src/timetable/tripStopId.ts')
  )) as typeof import('../timetable/tripStopId.js');
  const iterations = Number(process.env.BENCH_ITERATIONS ?? 100);
  const warmup = Number(process.env.BENCH_WARMUP ?? 20);
  const batches = 5;
  const filter = new RegExp(process.env.BENCH_FILTER ?? '');
  if (
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    !Number.isInteger(warmup) ||
    warmup < 0
  ) {
    throw new Error(
      'Benchmark iterations must be positive and warmup nonnegative integers',
    );
  }
  const gc = global.gc;
  if (!gc) {
    throw new Error('Run with --expose-gc for memory measurements');
  }
  const retained: { value?: unknown } = {};
  const memory = () => {
    gc();
    gc();
    return process.memoryUsage();
  };
  const beforeLoad = memory();
  const loadStart = performance.now();
  const timetable = Timetable.fromData(
    readFileSync('src/__e2e__/timetable/timetable.bin'),
  );
  const loadMs = performance.now() - loadStart;
  const loaded = memory();
  const load = {
    ms: loadMs,
    heapBytes: loaded.heapUsed - beforeLoad.heapUsed,
    arrayBufferBytes: loaded.arrayBuffers - beforeLoad.arrayBuffers,
  };
  const stops = StopsIndex.fromData(
    readFileSync('src/__e2e__/timetable/stops.bin'),
  );
  const router = new Router(timetable, stops);
  const origin = stops.findStopBySourceStopId('Parent8507000');
  const destination = stops.findStopBySourceStopId('Parent8509253');
  if (!origin || !destination) {
    throw new Error('Missing benchmark stops');
  }
  const point = new Query.Builder()
    .from(origin.id)
    .to(destination.id)
    .departureTime(750)
    .maxDuration(360)
    .build();
  const range = new RangeQuery.Builder()
    .from(origin.id)
    .to(destination.id)
    .departureTime(750)
    .lastDepartureTime(780)
    .maxDuration(360)
    .build();
  const isochrone = new Query.Builder()
    .from(origin.id)
    .departureTime(750)
    .maxDuration(120)
    .build();
  const rangeIsochrone = new RangeQuery.Builder()
    .from(origin.id)
    .departureTime(750)
    .lastDepartureTime(760)
    .maxDuration(120)
    .rangeOptions({ optimizeBeyondLatestDeparture: false })
    .build();

  // Every incoming trip has a distinct onward rule, exercising sparse fixed-trip scans.
  const count = 200;
  const routes = [0, 1].map((id) =>
    Route.of({
      id,
      serviceRouteId: id,
      trips: Array.from({ length: count }, (_, trip) => ({
        stops: [
          {
            id,
            arrivalTime: 600 + trip * 2 + id * 11,
            departureTime: 600 + trip * 2 + id * 11,
          },
          {
            id: id + 1,
            arrivalTime: 610 + trip * 2 + id * 11,
            departureTime: 610 + trip * 2 + id * 11,
          },
        ],
      })),
    }),
  );
  const rules: MinimumTripTransfers = new Map(
    Array.from({ length: count }, (_, tripIndex) => [
      encode(1, 0, tripIndex),
      [{ routeId: 1, tripIndex, stopIndex: 0, minTransferTime: 0 }],
    ]),
  );
  const syntheticStops = new StopsIndex(
    [0, 1, 2].map((id) => ({
      id,
      sourceStopId: String(id),
      name: String(id),
      children: [],
      locationType: 'SIMPLE_STOP_OR_PLATFORM' as const,
    })),
  );
  const synthetic = new Router(
    new Timetable(
      [{ routes: [0] }, { routes: [0, 1] }, { routes: [1] }],
      routes,
      [0, 1].map((id) => ({
        type: RouteTypes.BUS,
        name: String(id),
        routes: [id],
      })),
      undefined,
      undefined,
      rules,
    ),
    syntheticStops,
  );
  const specialPoint = new Query.Builder()
    .from(0)
    .to(2)
    .departureTime(599)
    .build();
  const specialRange = new RangeQuery.Builder()
    .from(0)
    .to(2)
    .departureTime(599)
    .lastDepartureTime(650)
    .build();

  // Compatibility is confined to this comparison harness, never production code.
  const arrivals = (result: Result): IterableIterator<StopArrival> =>
    'arrivals' in (result as object)
      ? result.arrivals()
      : (
          result as unknown as { routingState: RoutingState }
        ).routingState.arrivals();
  const fingerprint = (value: unknown, departure: number): string => {
    const hash = createHash('sha256');
    const render = (
      records: Iterable<StopArrival & { duration: number }>,
      index: InstanceType<typeof StopsIndex>,
    ) => {
      const durations: number[] = [];
      const transfers: number[] = [];
      for (const { stop: stopId, duration, legNumber } of records) {
        const stop = index.findStopById(stopId);
        if (!stop) {
          continue;
        }
        const parentStopId = stop.parent ?? stopId;
        const parent =
          stop.parent === undefined ? stop : index.findStopById(parentStopId);
        if (!parent) {
          throw new Error('Missing parent stop');
        }
        durations.push(
          parent.lon ?? 0,
          parent.lat ?? 0,
          duration,
          duration,
          stopId,
          parentStopId,
        );
        transfers.push(
          parent.lon ?? 0,
          parent.lat ?? 0,
          legNumber - 1,
          duration,
          stopId,
          parentStopId,
        );
      }
      hash.update(new Uint8Array(Float32Array.from(durations).buffer));
      hash.update(new Uint8Array(Float32Array.from(transfers).buffer));
    };
    const addResult = (result: Result, departureTime: number) => {
      render(
        Array.from(arrivals(result), (arrival) => ({
          ...arrival,
          duration: arrival.arrival - departureTime,
        })),
        result.stopsIndex,
      );
      for (const arrival of arrivals(result)) {
        hash.update(JSON.stringify(arrival));
      }
      hash.update(JSON.stringify(result.bestRoute()?.legs ?? null));
      // Reconstruct representative isochrone paths as well as destination paths.
      for (const { stop } of Array.from(arrivals(result)).filter(
        (_, i) => i % 100 === 0,
      )) {
        hash.update(JSON.stringify(result.bestRoute(stop)?.legs ?? null));
      }
    };
    if (value instanceof RangeResult) {
      const first = [...value][0];
      if (first) {
        render(
          Array.from(value.allShortestDurations(), ([stop, arrival]) => ({
            stop,
            ...arrival,
          })),
          first.result.stopsIndex,
        );
      }
      for (const run of value as Iterable<{
        departureTime: number;
        result: Result;
      }>) {
        hash.update(String(run.departureTime));
        addResult(run.result, run.departureTime);
      }
    } else {
      addResult(value as Result, departure);
    }
    return hash.digest('hex');
  };
  const scenarios = [
    { name: 'swiss-point', departure: 750, run: () => router.route(point) },
    {
      name: 'swiss-range',
      departure: 750,
      run: () => router.rangeRoute(range),
    },
    {
      name: 'swiss-isochrone',
      departure: 750,
      run: () => router.route(isochrone),
    },
    {
      name: 'swiss-range-isochrone',
      departure: 750,
      run: () => router.rangeRoute(rangeIsochrone),
    },
    {
      name: 'special-point',
      departure: 599,
      run: () => synthetic.route(specialPoint),
    },
    {
      name: 'special-range',
      departure: 599,
      run: () => synthetic.rangeRoute(specialRange),
    },
  ];
  const results = [];
  for (const scenario of scenarios.filter((s) => filter.test(s.name))) {
    for (let i = 0; i < warmup; i++) {
      scenario.run();
    }
    const times = [];
    for (let batch = 0; batch < batches; batch++) {
      gc();
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        retained.value = scenario.run();
      }
      times.push((performance.now() - start) / iterations);
      retained.value = undefined;
    }
    const before = memory();
    retained.value = scenario.run();
    const after = memory();
    const digest = fingerprint(retained.value, scenario.departure);
    results.push({
      name: scenario.name,
      medianMs: [...times].sort((a, b) => a - b)[2],
      batchesMs: times,
      retainedHeapBytes: after.heapUsed - before.heapUsed,
      retainedArrayBufferBytes: after.arrayBuffers - before.arrayBuffers,
      fingerprint: digest,
    });
    retained.value = undefined;
  }
  console.log(
    JSON.stringify(
      {
        root,
        node: process.version,
        iterations,
        warmup,
        load,
        maxRssKiB: process.resourceUsage().maxRSS,
        results,
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
