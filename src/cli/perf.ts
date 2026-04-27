import fs from 'fs';
import { performance } from 'perf_hooks';

import {
  Query,
  RangeQuery,
  RangeResult,
  Router,
  StopsIndex,
} from '../router.js';
import { timeFromString, timeToString } from '../timetable/time.js';

type PerformanceResult = {
  label: string;
  meanTimeUs: number;
  meanMemoryMb: number;
};

type SerializedQuery = {
  from: string;
  to: string[];
  departureTime: string;
  lastDepartureTime?: string;
  maxTransfers?: number;
};

// ─── Table renderer ───────────────────────────────────────────────────────────

type Column = {
  header: string;
  width: number;
  align: 'left' | 'right';
};

const renderTable = (
  columns: Column[],
  rows: string[][],
  footerRow: string[],
): string => {
  const bar = (l: string, m: string, r: string) =>
    l + columns.map((c) => '─'.repeat(c.width + 2)).join(m) + r;

  const renderRow = (cells: string[]) =>
    '│' +
    cells
      .map((cell, i) => {
        const width = columns[i]?.width ?? 0;
        const align = columns[i]?.align ?? 'left';
        const padded =
          align === 'right' ? cell.padStart(width) : cell.padEnd(width);
        return ` ${padded} `;
      })
      .join('│') +
    '│';

  return [
    bar('┌', '┬', '┐'),
    renderRow(columns.map((c) => c.header)),
    bar('├', '┼', '┤'),
    ...rows.map(renderRow),
    bar('├', '┼', '┤'),
    renderRow(footerRow),
    bar('└', '┴', '┘'),
  ].join('\n');
};

// ─── Query label ──────────────────────────────────────────────────────────────

const buildQueryLabel = (query: Query, stopsIndex: StopsIndex): string => {
  const fromName =
    stopsIndex.findStopById(query.from)?.name ?? String(query.from);

  const toNames = [...query.to]
    .map((id) => stopsIndex.findStopById(id)?.name ?? String(id))
    .join(' / ');

  const dep = timeToString(query.departureTime);

  if (query instanceof RangeQuery) {
    const lastDep = timeToString(query.lastDepartureTime);
    return `${fromName} → ${toNames}  ${dep}–${lastDep}`;
  }

  return `${fromName} → ${toNames}  ${dep}`;
};

// ─── Query loaders ────────────────────────────────────────────────────────────

/**
 * Loads a list of routing queries from a JSON file and resolves the
 * human-readable stop IDs to the internal numeric IDs used by the router.
 *
 * Only entries that do **not** carry a `lastDepartureTime` field are loaded —
 * range-query entries are silently skipped.
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

  return serializedQueries
    .filter((q) => q.lastDepartureTime === undefined)
    .map((serializedQuery) => {
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
 * Loads a list of range routing queries from a JSON file and resolves the
 * human-readable stop IDs to the internal numeric IDs used by the router.
 *
 * Only entries that carry a `lastDepartureTime` field are loaded — plain
 * point-query entries are silently skipped.
 *
 * @param filePath - Path to the JSON file containing the serialized queries.
 * @param stopsIndex - The stops index used to resolve source stop IDs to the
 *   internal numeric IDs expected by the router.
 * @returns An array of fully constructed {@link RangeQuery} objects ready to
 *   be passed to {@link Router.rangeRoute}.
 * @throws If the file cannot be read, the JSON is malformed, or any stop ID
 *   referenced in the file cannot be found in the stops index.
 */
export const loadRangeQueriesFromJson = (
  filePath: string,
  stopsIndex: StopsIndex,
): RangeQuery[] => {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const serializedQueries: SerializedQuery[] = JSON.parse(
    fileContent,
  ) as SerializedQuery[];

  return serializedQueries
    .filter((q) => q.lastDepartureTime !== undefined)
    .map((serializedQuery) => {
      const fromStop = stopsIndex.findStopBySourceStopId(serializedQuery.from);
      const toStops = Array.from(serializedQuery.to).map((stopId) =>
        stopsIndex.findStopBySourceStopId(stopId),
      );

      if (!fromStop || toStops.some((toStop) => !toStop)) {
        throw new Error(
          `Invalid task: Start or end station not found for task ${JSON.stringify(serializedQuery)}`,
        );
      }
      const queryBuilder = new RangeQuery.Builder()
        .from(fromStop.id)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .to(new Set(toStops.map((stop) => stop!.id)))
        .departureTime(timeFromString(serializedQuery.departureTime))
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        .lastDepartureTime(timeFromString(serializedQuery.lastDepartureTime!));

      if (serializedQuery.maxTransfers !== undefined) {
        queryBuilder.maxTransfers(serializedQuery.maxTransfers);
      }

      return queryBuilder.build();
    });
};

// ─── Benchmark runners ────────────────────────────────────────────────────────

/**
 * Benchmarks {@link Router.route} across a set of queries.
 *
 * @param router - The router instance to benchmark.
 * @param tasks - The list of queries to run. One {@link PerformanceResult} is
 *   produced per query.
 * @param iterations - Number of times each query is repeated. Higher values
 *   yield a more stable mean at the cost of longer wall-clock time.
 * @param stopsIndex - Used to resolve stop names for result labels.
 * @returns An array of {@link PerformanceResult} objects, one per query, each
 *   containing the mean wall-clock time (µs) and mean heap delta (MB).
 */
export const testRouterPerformance = (
  router: Router,
  tasks: Query[],
  iterations: number,
  stopsIndex: StopsIndex,
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
      label: buildQueryLabel(task, stopsIndex),
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
 * @param stopsIndex - Used to resolve stop names for result labels.
 * @returns An array of {@link PerformanceResult} objects, one per query, each
 *   containing the mean wall-clock time (µs) and mean heap delta (MB) for the
 *   `bestRoute` call alone.
 */
export const testBestRoutePerformance = (
  router: Router,
  tasks: Query[],
  iterations: number,
  stopsIndex: StopsIndex,
): PerformanceResult[] => {
  const results: PerformanceResult[] = [];

  for (const task of tasks) {
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
      label: buildQueryLabel(task, stopsIndex),
      meanTimeUs: totalTime / iterations,
      meanMemoryMb: totalMemory / iterations / (1024 * 1024),
    });
  }

  return results;
};

/**
 * Benchmarks {@link Router.rangeRoute} across a set of range queries.
 *
 * @param router - The router instance to benchmark.
 * @param tasks - The list of range queries to run. One {@link PerformanceResult}
 *   is produced per query.
 * @param iterations - Number of times each query is repeated.
 * @param stopsIndex - Used to resolve stop names for result labels.
 * @returns An array of {@link PerformanceResult} objects, one per query, each
 *   containing the mean wall-clock time (µs) and mean heap delta (MB).
 */
export const testRangeRouterPerformance = (
  router: Router,
  tasks: RangeQuery[],
  iterations: number,
  stopsIndex: StopsIndex,
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

      router.rangeRoute(task);

      const endTime = performance.now();
      const endMemory = process.memoryUsage().heapUsed;

      totalTime += (endTime - startTime) * 1_000;
      if (endMemory >= startMemory) {
        totalMemory += endMemory - startMemory;
      }
    }

    results.push({
      label: buildQueryLabel(task, stopsIndex),
      meanTimeUs: totalTime / iterations,
      meanMemoryMb: totalMemory / iterations / (1024 * 1024),
    });
  }

  return results;
};

/**
 * Benchmarks {@link RangeResult.getRoutes} — the full Pareto-frontier
 * reconstruction phase — independently of the range routing phase.
 *
 * @param router - The router instance used to produce the range results that
 *   are then fed into `getRoutes`.
 * @param tasks - The list of range queries to benchmark. One
 *   {@link PerformanceResult} is produced per query.
 * @param iterations - Number of times `getRoutes` is called per query.
 * @param stopsIndex - Used to resolve stop names for result labels.
 * @returns An array of {@link PerformanceResult} objects, one per query, each
 *   containing the mean wall-clock time (µs) and mean heap delta (MB) for the
 *   `getRoutes` call alone.
 */
export const testRangeResultPerformance = (
  router: Router,
  tasks: RangeQuery[],
  iterations: number,
  stopsIndex: StopsIndex,
): PerformanceResult[] => {
  const results: PerformanceResult[] = [];

  for (const task of tasks) {
    const rangeResult: RangeResult = router.rangeRoute(task);

    let totalTime = 0;
    let totalMemory = 0;

    for (let i = 0; i < iterations; i++) {
      if (global.gc) {
        global.gc();
      }

      const startMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      rangeResult.getRoutes();

      const endTime = performance.now();
      const endMemory = process.memoryUsage().heapUsed;

      totalTime += (endTime - startTime) * 1_000;
      if (endMemory >= startMemory) {
        totalMemory += endMemory - startMemory;
      }
    }

    results.push({
      label: buildQueryLabel(task, stopsIndex),
      meanTimeUs: totalTime / iterations,
      meanMemoryMb: totalMemory / iterations / (1024 * 1024),
    });
  }

  return results;
};

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Prints a table summary of performance results to stdout.
 *
 * Each row corresponds to one task, identified by a human-readable query label
 * (origin → destination + departure time). A footer row shows the mean across
 * all tasks. An optional `label` is printed as a section header above the table.
 *
 * @param results - The performance results to display.
 * @param label - Heading printed above the table. Defaults to `'Performance Results'`.
 */
export const prettyPrintPerformanceResults = (
  results: PerformanceResult[],
  label = 'Performance Results',
): void => {
  console.log(`\n${label}`);

  if (results.length === 0) {
    console.log('  (no results)');
    return;
  }

  const fmtTime = (n: number) => Math.round(n).toLocaleString('en-US');
  const fmtMem = (n: number) => n.toFixed(2);

  const meanTime =
    results.reduce((s, r) => s + r.meanTimeUs, 0) / results.length;
  const meanMem =
    results.reduce((s, r) => s + r.meanMemoryMb, 0) / results.length;

  const queryHeader = 'Query';
  const timeHeader = 'Time (µs)';
  const memHeader = 'Mem (MB)';

  const timeVals = results.map((r) => fmtTime(r.meanTimeUs));
  const memVals = results.map((r) => fmtMem(r.meanMemoryMb));
  const meanTimeStr = fmtTime(meanTime);
  const meanMemStr = fmtMem(meanMem);

  const queryWidth = Math.max(
    queryHeader.length,
    'mean'.length,
    ...results.map((r) => r.label.length),
  );
  const timeWidth = Math.max(
    timeHeader.length,
    meanTimeStr.length,
    ...timeVals.map((v) => v.length),
  );
  const memWidth = Math.max(
    memHeader.length,
    meanMemStr.length,
    ...memVals.map((v) => v.length),
  );

  const columns: Column[] = [
    { header: queryHeader, width: queryWidth, align: 'left' },
    { header: timeHeader, width: timeWidth, align: 'right' },
    { header: memHeader, width: memWidth, align: 'right' },
  ];

  const rows = results.map((r, i) => [
    r.label,
    timeVals[i] ?? '',
    memVals[i] ?? '',
  ]);
  const footer = ['mean', meanTimeStr, meanMemStr];

  console.log(renderTable(columns, rows, footer));
};
