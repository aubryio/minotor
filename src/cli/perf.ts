import fs from 'fs';
import { performance } from 'perf_hooks';

import { Query, Router, StopsIndex, Time } from '../router.js';

type PerformanceResult = {
  task: Query;
  meanTimeMs: number;
  meanMemoryMb: number;
};

type SerializedQuery = {
  from: string;
  to: string[];
  departureTime: string;
  maxTransfers?: number;
};

/**
 *
 * @param filePath
 * @returns
 */
export const loadQueriesFromJson = (filePath: string): Query[] => {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const serializedQueries: SerializedQuery[] = JSON.parse(
    fileContent,
  ) as SerializedQuery[];

  return serializedQueries.map((serializedQuery) => {
    const queryBuilder = new Query.Builder()
      .from(serializedQuery.from)
      .to(new Set(serializedQuery.to))
      .departureTime(Time.fromString(serializedQuery.departureTime));

    if (serializedQuery.maxTransfers !== undefined) {
      queryBuilder.maxTransfers(serializedQuery.maxTransfers);
    }

    return queryBuilder.build();
  });
};

/**
 *
 * @param router
 * @param stopsIndex
 * @param tasks
 * @param iterations
 * @returns
 */
export const testRouterPerformance = (
  router: Router,
  stopsIndex: StopsIndex,
  tasks: Query[],
  iterations: number,
): PerformanceResult[] => {
  const results: PerformanceResult[] = [];

  for (const task of tasks) {
    const fromStop = stopsIndex.findStopBySourceStopId(task.from);
    const toStops = Array.from(task.to).map((stopId) =>
      stopsIndex.findStopBySourceStopId(stopId),
    );

    if (!fromStop || toStops.some((toStop) => !toStop)) {
      throw new Error(
        `Invalid task: Start or end station not found for task ${JSON.stringify(task)}`,
      );
    }

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

      totalTime += endTime - startTime;
      if (endMemory >= startMemory) {
        totalMemory += endMemory - startMemory;
      }
    }

    results.push({
      task,
      meanTimeMs: totalTime / iterations,
      meanMemoryMb: totalMemory / iterations / (1024 * 1024),
    });
  }

  return results;
};

/**
 *
 * @param results
 * @returns
 */
export const prettyPrintPerformanceResults = (
  results: PerformanceResult[],
): void => {
  if (results.length === 0) {
    console.log('No performance results to display.');
    return;
  }

  const overallMeanTimeMs =
    results.reduce((sum, result) => sum + result.meanTimeMs, 0) /
    results.length;
  const overallMeanMemoryMb =
    results.reduce((sum, result) => sum + result.meanMemoryMb, 0) /
    results.length;

  console.log('Overall Performance Results:');
  console.log(`  Mean Time (ms): ${overallMeanTimeMs.toFixed(2)}`);
  console.log(`  Mean Memory (MB): ${overallMeanMemoryMb.toFixed(2)}`);
  console.log('');

  console.log('Individual Task Results:');
  results.forEach((result, index) => {
    console.log(`Task ${index + 1}:`);
    console.log(`  Mean Time (ms): ${result.meanTimeMs.toFixed(2)}`);
    console.log(`  Mean Memory (MB): ${result.meanMemoryMb.toFixed(2)}`);
    console.log('');
  });
};
