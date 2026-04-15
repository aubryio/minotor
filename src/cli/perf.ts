import fs from 'fs';
import { performance } from 'perf_hooks';

import { Query, Router, StopsIndex } from '../router.js';
import { timeFromString } from '../timetable/time.js';

type PerformanceResult = {
  task: Query;
  meanTimeUs: number;
  meanMemoryMb: number;
};

type SerializedQuery = {
  from: string;
  to: string[];
  departureTime: string;
  maxTransfers?: number;
};

/**
 * Loads a list of routing queries from a JSON file and resolves the
 * human-readable stop IDs to the internal numeric IDs used by the router.
 *
 * The file must contain a JSON array whose elements each have the shape:
 * ```json
 * { "from": "STOP_A", "to": ["STOP_B", "STOP_C"], "departureTime": "08:30:00" }
 * ```
 * An optional `maxTransfers` integer field is also supported.
 *
 * @param filePath - Path to the JSON file containing the serialized queries.
 * @param stopsIndex - The stops index used to resolve source stop IDs to the
 *   internal numeric IDs expected by the router.
 * @returns An array of fully constructed {@link Query} objects ready to be
 *   passed to {@link Router.route}.
 * @throws If the file cannot be read, the JSON is malformed, or any stop ID
 *   referenced in the file cannot be found in the stops index.
 */
export const loadQueriesFromJson = (
  filePath: string,
  stopsIndex: StopsIndex,
): Query[] => {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const serializedQueries: SerializedQuery[] = JSON.parse(
    fileContent,
  ) as SerializedQuery[];

  return serializedQueries.map((serializedQuery) => {
    const fromStop = stopsIndex.findStopBySourceStopId(serializedQuery.from);
    const toStops = Array.from(serializedQuery.to).map((stopId) =>
      stopsIndex.findStopBySourceStopId(stopId),
    );

    if (!fromStop || toStops.some((toStop) => !toStop)) {
      throw new Error(
        `Invalid task: Start or end station not found for task ${JSON.stringify(serializedQuery)}`,
      );
    }
    const queryBuilder = new Query.Builder()
      .from(fromStop.id)
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      .to(new Set(toStops.map((stop) => stop!.id)))
      .departureTime(timeFromString(serializedQuery.departureTime));

    if (serializedQuery.maxTransfers !== undefined) {
      queryBuilder.maxTransfers(serializedQuery.maxTransfers);
    }

    return queryBuilder.build();
  });
};

/**
 * Benchmarks {@link Router.route} across a set of queries.
 *
 * @param router - The router instance to benchmark.
 * @param tasks - The list of queries to run. One {@link PerformanceResult} is
 *   produced per query.
 * @param iterations - Number of times each query is repeated. Higher values
 *   yield a more stable mean at the cost of longer wall-clock time.
 * @returns An array of {@link PerformanceResult} objects, one per query, each
 *   containing the mean wall-clock time (µs) and mean heap delta (MB).
 */
export const testRouterPerformance = (
  router: Router,
  tasks: Query[],
  iterations: number,
): PerformanceResult[] => {
  const results: PerformanceResult[] = [];

  for (const task of tasks) {
    let totalTime = 0;
    let totalMemory = 0;

    for (let i = 0; i < iterations; i++) {
      if (global.gc) {
        global.gc();
      }

      const startMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      router.route(task);

      const endTime = performance.now();
      const endMemory = process.memoryUsage().heapUsed;

      totalTime += (endTime - startTime) * 1_000;
      if (endMemory >= startMemory) {
        totalMemory += endMemory - startMemory;
      }
    }

    results.push({
      task,
      meanTimeUs: totalTime / iterations,
      meanMemoryMb: totalMemory / iterations / (1024 * 1024),
    });
  }

  return results;
};

/**
 * Benchmarks {@link Result.bestRoute} — the path-reconstruction phase —
 * independently of the routing phase.
 *
 * @param router - The router instance used to produce the routing results that
 *   are then fed into `bestRoute`.
 * @param tasks - The list of queries to benchmark. One {@link PerformanceResult}
 *   is produced per query.
 * @param iterations - Number of times `bestRoute` is called per query.
 * @returns An array of {@link PerformanceResult} objects, one per query, each
 *   containing the mean wall-clock time (µs) and mean heap delta (MB) for the
 *   `bestRoute` call alone.
 */
export const testBestRoutePerformance = (
  router: Router,
  tasks: Query[],
  iterations: number,
): PerformanceResult[] => {
  const results: PerformanceResult[] = [];

  for (const task of tasks) {
    // Compute the routing result once — this is not part of the benchmark.
    const result = router.route(task);

    let totalTime = 0;
    let totalMemory = 0;

    for (let i = 0; i < iterations; i++) {
      if (global.gc) {
        global.gc();
      }

      const startMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      result.bestRoute();

      const endTime = performance.now();
      const endMemory = process.memoryUsage().heapUsed;

      totalTime += (endTime - startTime) * 1_000;
      if (endMemory >= startMemory) {
        totalMemory += endMemory - startMemory;
      }
    }

    results.push({
      task,
      meanTimeUs: totalTime / iterations,
      meanMemoryMb: totalMemory / iterations / (1024 * 1024),
    });
  }

  return results;
};

/**
 * Prints a human-readable summary of performance results to stdout.
 *
 * Displays an overall mean across all tasks followed by a per-task breakdown.
 * An optional {@link label} is printed as a section header so that results
 * from different benchmark phases (e.g. routing vs. reconstruction) can be
 * told apart when several calls appear in the same run.
 *
 * @param results - The performance results to display, as returned by
 *   {@link testRouterPerformance} or {@link testBestRoutePerformance}.
 * @param label - Optional heading printed above the results block.
 *   Defaults to `'Performance Results'`.
 */
export const prettyPrintPerformanceResults = (
  results: PerformanceResult[],
  label = 'Performance Results',
): void => {
  if (results.length === 0) {
    console.log('No performance results to display.');
    return;
  }

  const overallMeanTimeNs =
    results.reduce((sum, result) => sum + result.meanTimeUs, 0) /
    results.length;
  const overallMeanMemoryMb =
    results.reduce((sum, result) => sum + result.meanMemoryMb, 0) /
    results.length;

  console.log(`${label}:`);
  console.log(`  Mean Time (µs): ${overallMeanTimeNs.toFixed(0)}`);
  console.log(`  Mean Memory (MB): ${overallMeanMemoryMb.toFixed(2)}`);
  console.log('');

  console.log('Individual Task Results:');
  results.forEach((result, index) => {
    console.log(`Task ${index + 1}:`);
    console.log(`  Mean Time (µs): ${result.meanTimeUs.toFixed(0)}`);
    console.log(`  Mean Memory (MB): ${result.meanMemoryMb.toFixed(2)}`);
    console.log('');
  });
};
