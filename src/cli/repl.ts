import repl from 'node:repl';

import fs from 'fs';

import { Query, Router, StopsIndex, Time, Timetable } from '../router.js';
import type { Stop } from '../stops/stops.js';
import { Route } from '../timetable/route.js';
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
            `Arriving to ${toStop.name} at ${arrivalTime.arrival.toString()} with ${arrivalTime.legNumber - 1} transfers from ${fromStop.name}.`,
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

  const formatPickupDropoffType = (type: string): string => {
    switch (type) {
      case 'REGULAR':
        return 'R';
      case 'NOT_AVAILABLE':
        return 'N';
      case 'MUST_PHONE_AGENCY':
        return 'A';
      case 'MUST_COORDINATE_WITH_DRIVER':
        return 'D';
      default:
        return '?';
    }
  };

  replServer.defineCommand('inspect', {
    help: 'Inspect a route or stop using .inspect route <routeId> or .inspect stop <stopId>',
    action(inspectQuery: string) {
      this.clearBufferedCommand();

      const parts = inspectQuery.trim().split(' ');
      if (parts.length !== 2) {
        console.log(
          'Usage: .inspect route <routeId> or .inspect stop <stopId>',
        );
        this.displayPrompt();
        return;
      }

      const [type, idStr] = parts;
      if (type !== 'route' && type !== 'stop') {
        console.log(
          'Usage: .inspect route <routeId> or .inspect stop <stopId>',
        );
        this.displayPrompt();
        return;
      }

      const inspectRoute = (routeIdStr: string) => {
        const routeId = parseInt(routeIdStr.trim());
        if (isNaN(routeId)) {
          console.log('Usage: .inspect route <routeId>');
          return;
        }

        const route = timetable.getRoute(routeId);
        if (!route) {
          console.log(`Route ${routeId} not found`);
          return;
        }

        const serviceRouteInfo = timetable.getServiceRouteInfo(route);
        const routeName = serviceRouteInfo.name;
        const routeType = serviceRouteInfo.type;

        console.log(`\n=== Route ${routeId} ===`);
        console.log(`Service Route: ${routeName}`);
        console.log(`Type: ${routeType}`);
        console.log(`Number of stops: ${route.getNbStops()}`);
        console.log(`Number of trips: ${route.getNbTrips()}`);

        console.log('\n--- Stops ---');
        for (let i = 0; i < route.stops.length; i++) {
          const stopId = route.stopId(i);
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const stop = stopsIndex.findStopById(stopId)!;
          const platform = stop.platform ? ` (Pl. ${stop.platform})` : '';
          console.log(
            `${i + 1}. ${stop.name}${platform} (${stopId}, ${stop.sourceStopId})`,
          );
        }

        console.log('\n--- Trips ---');
        for (let tripIndex = 0; tripIndex < route.getNbTrips(); tripIndex++) {
          console.log(`\nTrip ${tripIndex}:`);
          for (let stopIndex = 0; stopIndex < route.stops.length; stopIndex++) {
            const stopId = route.stopId(stopIndex);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const stop = stopsIndex.findStopById(stopId)!;

            const departure = route.departureFrom(stopIndex, tripIndex);
            const arrival = route.arrivalAt(stopIndex, tripIndex);
            const pickupType = route.pickUpTypeFrom(stopIndex, tripIndex);
            const dropOffType = route.dropOffTypeAt(stopIndex, tripIndex);

            const pickupStr = formatPickupDropoffType(pickupType);
            const dropOffStr = formatPickupDropoffType(dropOffType);

            console.log(
              `  ${stopIndex + 1}. ${stop.name}: arr ${arrival.toString()} (${pickupStr}) → dep ${departure.toString()} (${dropOffStr})`,
            );
          }
        }

        console.log();
      };

      const inspectStop = (stopIdStr: string) => {
        let stop: Stop | undefined;
        const stopBySourceId = stopsIndex.findStopBySourceStopId(stopIdStr);
        if (stopBySourceId !== undefined) {
          stop = stopBySourceId;
        } else if (!isNaN(Number(stopIdStr))) {
          const stopById = stopsIndex.findStopById(Number(stopIdStr));
          if (stopById !== undefined) {
            stop = stopById;
          }
        } else {
          const stops = stopsIndex.findStopsByName(stopIdStr);
          if (stops.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            stop = stops[0]!;
          }
        }

        if (!stop) {
          console.log(`Stop not found: ${stopIdStr}`);
          return;
        }

        console.log(`\n=== Stop ${stop.id} ===`);
        console.log(`Name: ${stop.name}`);
        if (stop.platform) {
          console.log(`Platform: ${stop.platform}`);
        }
        console.log(`Source ID: ${stop.sourceStopId}`);

        const routes: Route[] = timetable.routesPassingThrough(stop.id);
        console.log(`Number of routes: ${routes.length}`);

        const equivalentStops = stopsIndex
          .equivalentStops(stop.sourceStopId)
          .filter((equivStop) => equivStop.id !== stop.id);
        console.log(`Number of equivalent stops: ${equivalentStops.length}`);

        if (equivalentStops.length > 0) {
          console.log('\n--- Equivalent Stops ---');
          equivalentStops.forEach((equivStop, index) => {
            const platform = equivStop.platform
              ? ` (Pl. ${equivStop.platform})`
              : '';
            console.log(
              `${index + 1}. ${equivStop.name}${platform} (${equivStop.id}, ${equivStop.sourceStopId})`,
            );
          });
        }

        if (routes.length > 0) {
          console.log('\n--- Routes ---');
          routes.forEach((route, index) => {
            const serviceRouteInfo = timetable.getServiceRouteInfo(route);
            console.log(
              `${index + 1}. Route ${route.id}: ${serviceRouteInfo.name} (${serviceRouteInfo.type})`,
            );
          });
        }

        const transfers = timetable.getTransfers(stop.id);
        console.log(`Number of transfers: ${transfers.length}`);

        if (transfers.length > 0) {
          console.log('\n--- Transfers ---');
          transfers.forEach((transfer, index) => {
            const destStop = stopsIndex.findStopById(transfer.destination);
            const platform = destStop?.platform
              ? ` (Pl. ${destStop.platform})`
              : '';
            const minTime = transfer.minTransferTime
              ? ` (min: ${Math.floor(transfer.minTransferTime.toSeconds() / 60)}min)`
              : '';
            console.log(
              `${index + 1}. ${transfer.type} to ${destStop?.name ?? 'Unknown'}${platform} (${transfer.destination}, ${destStop?.sourceStopId ?? 'N/A'})${minTime}`,
            );
          });
        }

        let totalContinuations = 0;
        console.log('\n--- Trip Continuations ---');

        routes.forEach((route: Route) => {
          const serviceRouteInfo = timetable.getServiceRouteInfo(route);
          const stopIndices = route.stopRouteIndices(stop.id);

          for (let tripIndex = 0; tripIndex < route.getNbTrips(); tripIndex++) {
            for (const stopIndex of stopIndices) {
              const continuations = timetable.getContinuousTrips(
                stopIndex,
                route.id,
                tripIndex,
              );

              for (const continuation of continuations) {
                totalContinuations++;
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const destRoute = timetable.getRoute(continuation.routeId)!;
                const destStopId = destRoute.stopId(continuation.stopIndex);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const destStop = stopsIndex.findStopById(destStopId)!;
                const destPlatform = destStop.platform
                  ? ` (Pl. ${destStop.platform})`
                  : '';

                const destServiceRouteInfo =
                  timetable.getServiceRouteInfo(destRoute);

                const originTime = route.departureFrom(stopIndex, tripIndex);
                const continuationTime = destRoute.departureFrom(
                  continuation.stopIndex,
                  continuation.tripIndex,
                );

                console.log(
                  `${totalContinuations}. From Route ${route.id} (${serviceRouteInfo.name}) Trip ${tripIndex} at ${originTime.toString()} → ` +
                    `Route ${continuation.routeId} (${destServiceRouteInfo.name}) Trip ${continuation.tripIndex} at ${continuationTime.toString()} ` +
                    `at ${destStop.name}${destPlatform} (${destStopId}, ${destStop.sourceStopId})`,
                );
              }
            }
          }
        });

        if (totalContinuations === 0) {
          console.log('No trip continuations found.');
        } else {
          console.log(`\nTotal trip continuations: ${totalContinuations}`);
        }
        let totalGuaranteedTransfers = 0;
        console.log('\n--- Guaranteed Trip Transfers ---');

        routes.forEach((route: Route) => {
          const serviceRouteInfo = timetable.getServiceRouteInfo(route);
          const stopIndices = route.stopRouteIndices(stop.id);

          for (let tripIndex = 0; tripIndex < route.getNbTrips(); tripIndex++) {
            for (const stopIndex of stopIndices) {
              const guaranteedTransfers = timetable.getGuaranteedTripTransfers(
                stopIndex,
                route.id,
                tripIndex,
              );

              for (const guaranteedTrip of guaranteedTransfers) {
                totalGuaranteedTransfers++;
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const destRoute = timetable.getRoute(guaranteedTrip.routeId)!;
                const destStopId = destRoute.stopId(guaranteedTrip.stopIndex);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const destStop = stopsIndex.findStopById(destStopId)!;
                const destPlatform = destStop.platform
                  ? ` (Pl. ${destStop.platform})`
                  : '';

                const destServiceRouteInfo =
                  timetable.getServiceRouteInfo(destRoute);

                const originTime = route.arrivalAt(stopIndex, tripIndex);
                const destinationTime = destRoute.departureFrom(
                  guaranteedTrip.stopIndex,
                  guaranteedTrip.tripIndex,
                );

                console.log(
                  `${totalGuaranteedTransfers}. From Route ${route.id} (${serviceRouteInfo.name}) Trip ${tripIndex} at ${originTime.toString()} → ` +
                    `Route ${guaranteedTrip.routeId} (${destServiceRouteInfo.name}) Trip ${guaranteedTrip.tripIndex} at ${destinationTime.toString()} ` +
                    `at ${destStop.name}${destPlatform} (${destStopId}, ${destStop.sourceStopId}) (guaranteed transfer)`,
                );
              }
            }
          }
        });

        if (totalGuaranteedTransfers === 0) {
          console.log('No guaranteed trip transfers found.');
        } else {
          console.log(
            `\nTotal guaranteed trip transfers: ${totalGuaranteedTransfers}`,
          );
        }
        console.log();
      };

      if (type === 'route') {
        inspectRoute(idStr ?? '');
      } else {
        inspectStop(idStr ?? '');
      }

      this.displayPrompt();
    },
  });
};
