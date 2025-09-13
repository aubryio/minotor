import repl from 'node:repl';

import fs from 'fs';

import { Query, Router, StopsIndex, Time, Timetable } from '../router.js';
import { plotGraphToDotFile } from './utils.js';

export const startRepl = (stopsPath: string, timetablePath: string) => {
  const stopsIndex = StopsIndex.fromData(fs.readFileSync(stopsPath));
  const timetable = Timetable.fromData(fs.readFileSync(timetablePath));
  console.log(`Minotor Transit Router CLI`);
  console.log(
    'Enter your stop (.find) or routing (.route) queries. Type ".exit" to quit.',
  );
  const replServer = repl.start({
    prompt: 'minotor> ',
    ignoreUndefined: true,
  });
  replServer.context.stopFinder = stopsIndex;
  replServer.defineCommand('find', {
    help: 'Find stops by name using .find <query>',
    action(query: string) {
      this.clearBufferedCommand();
      let stops = [];
      const stopBySourceId = stopsIndex.findStopBySourceStopId(query);
      if (stopBySourceId !== undefined) {
        stops.push(stopBySourceId);
      } else if (!isNaN(Number(query))) {
        const stopById = stopsIndex.findStopById(Number(query));
        if (stopById !== undefined) {
          stops.push(stopById);
        }
      } else {
        stops = stopsIndex.findStopsByName(query);
      }
      stops.forEach((stop) => {
        console.log(`${stop.name} (${stop.sourceStopId} - ${stop.id})`);
      });
      this.displayPrompt();
    },
  });
  replServer.defineCommand('route', {
    help: 'Find a route using .route from <stationIdOrName> to <stationIdOrName> at <HH:mm> [with <N> transfers]',
    action(routeQuery: string) {
      this.clearBufferedCommand();
      const parts = routeQuery.split(' ').filter(Boolean);
      const withTransfersIndex = parts.indexOf('with');
      const maxTransfers =
        withTransfersIndex !== -1 && parts[withTransfersIndex + 1] !== undefined
          ? parseInt(parts[withTransfersIndex + 1] as string)
          : 4;
      const atTime = parts
        .slice(
          withTransfersIndex === -1
            ? parts.indexOf('at') + 1
            : parts.indexOf('at') + 1,
          withTransfersIndex === -1 ? parts.length : withTransfersIndex,
        )
        .join(' ');
      const fromIndex = parts.indexOf('from');
      const toIndex = parts.indexOf('to');
      const fromId = parts.slice(fromIndex + 1, toIndex).join(' ');
      const toId = parts.slice(toIndex + 1, parts.indexOf('at')).join(' ');

      if (!fromId || !toId || !atTime) {
        console.log(
          'Usage: .route from <stationIdOrName> to <stationIdOrName> at <HH:mm> [with <N> transfers]',
        );
        this.displayPrompt();
        return;
      }

      const fromStop =
        stopsIndex.findStopBySourceStopId(fromId) ||
        (isNaN(Number(fromId))
          ? undefined
          : stopsIndex.findStopById(Number(fromId))) ||
        stopsIndex.findStopsByName(fromId)[0];
      const toStop =
        stopsIndex.findStopBySourceStopId(toId) ||
        (isNaN(Number(toId))
          ? undefined
          : stopsIndex.findStopById(Number(toId))) ||
        stopsIndex.findStopsByName(toId)[0];

      if (!fromStop) {
        console.log(`No stop found for 'from' ID or name: ${fromId}`);
        this.displayPrompt();
        return;
      }

      if (!toStop) {
        console.log(`No stop found for 'to' ID or name: ${toId}`);
        this.displayPrompt();
        return;
      }

      const departureTime = Time.fromString(atTime);

      try {
        const query = new Query.Builder()
          .from(fromStop.sourceStopId)
          .to(toStop.sourceStopId)
          .departureTime(departureTime)
          .maxTransfers(maxTransfers)
          .build();

        const router = new Router(timetable, stopsIndex);

        const result = router.route(query);
        const arrivalTime = result.arrivalAt(toStop.sourceStopId);
        if (arrivalTime === undefined) {
          console.log(`Destination not reachable`);
        } else {
          console.log(
            `Arriving to ${toStop.name} at ${arrivalTime.arrival.toString()} with ${arrivalTime.legNumber - 1} transfers from ${stopsIndex.findStopById(arrivalTime.origin)?.name}.`,
          );
        }
        const bestRoute = result.bestRoute(toStop.sourceStopId);

        if (bestRoute) {
          console.log(`Found route from ${fromStop.name} to ${toStop.name}:`);
          console.log(bestRoute.toString());
        } else {
          console.log('No route found');
        }
      } catch (error) {
        console.log('Error querying route:', error);
      }

      this.displayPrompt();
    },
  });
  replServer.defineCommand('plot', {
    help: 'Plot a network graph using .plot from <stationId> to <stationId> at <HH:mm> [with <N> transfers] [to <graph.dot>]',
    action(routeQuery: string) {
      this.clearBufferedCommand();
      const parts = routeQuery.split(' ').filter(Boolean);
      const withTransfersIndex = parts.indexOf('with');
      const maxTransfers =
        withTransfersIndex !== -1 && parts[withTransfersIndex + 1] !== undefined
          ? parseInt(parts[withTransfersIndex + 1] as string)
          : 1;
      const atTimeIndex = parts.indexOf('at');
      const atTime = parts
        .slice(
          atTimeIndex + 1,
          withTransfersIndex === -1
            ? parts.indexOf('to', atTimeIndex) >= 0
              ? parts.indexOf('to', atTimeIndex)
              : parts.length
            : withTransfersIndex,
        )
        .join(' ');
      const fromIndex = parts.indexOf('from');
      const toIndex = parts.indexOf('to');
      const toFileIndex =
        toIndex !== -1 && parts.indexOf('to', toIndex + 1) !== -1
          ? parts.indexOf('to', toIndex + 1)
          : -1;
      const fromId = parts.slice(fromIndex + 1, toIndex).join(' ');
      const toId = parts.slice(toIndex + 1, atTimeIndex).join(' ');
      const outputFile =
        toFileIndex !== -1
          ? parts.slice(toFileIndex + 1).join(' ')
          : `${fromId.replace(/ /g, '')}-${toId.replace(/ /g, '')}-${atTime.replace(/:/g, '')}.dot`;

      if (!fromId || !toId || !atTime || isNaN(maxTransfers)) {
        console.log(
          'Usage: .plot from <stationId> to <stationId> at <HH:mm> [with <N> transfers] [to <graph.dot>]',
        );
        this.displayPrompt();
        return;
      }

      const fromStop =
        stopsIndex.findStopBySourceStopId(fromId) ||
        stopsIndex.findStopsByName(fromId)[0];
      const toStop =
        stopsIndex.findStopBySourceStopId(toId) ||
        stopsIndex.findStopsByName(toId)[0];

      if (!fromStop) {
        console.log(`No stop found for 'from' ID or name: ${fromId}`);
        this.displayPrompt();
        return;
      }

      if (!toStop) {
        console.log(`No stop found for 'to' ID or name: ${toId}`);
        this.displayPrompt();
        return;
      }

      const departureTime = Time.fromString(atTime);
      try {
        const query = new Query.Builder()
          .from(fromStop.sourceStopId)
          .to(toStop.sourceStopId)
          .departureTime(departureTime)
          .maxTransfers(maxTransfers)
          .build();

        const router = new Router(timetable, stopsIndex);

        const result = router.route(query);
        plotGraphToDotFile(result, outputFile);
      } catch (error) {
        console.log('Error plotting route:', error);
      }

      this.displayPrompt();
    },
  });
};
