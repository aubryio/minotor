/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Duration } from '../timetable/duration.js';
import { Time } from '../timetable/time.js';
import { Timetable } from '../timetable/timetable.js';
import { Query } from './query.js';
import { Result } from './result.js';
import { Leg } from './route.js';

const UNREACHED = Time.infinity();

export type TripLeg = ReachingTime & {
  leg?: Leg; // leg is not set for the very first segment
};

export type ReachingTime = {
  time: Time;
  legNumber: number;
  origin: StopId;
};

type CurrentTrip = {
  trip: number;
  origin: StopId;
  bestHopOnStop: StopId;
};

export class Router {
  private readonly timetable: Timetable;
  private readonly stopsIndex: StopsIndex;

  constructor(timetable: Timetable, stopsIndex: StopsIndex) {
    this.timetable = timetable;
    this.stopsIndex = stopsIndex;
  }

  /**
   * Evaluates possible transfers for a given query on a transport
   * network, updating the earliest arrivals at various stops and marking new
   * stops that can be reached through these transfers.
   */
  private considerTransfers(
    query: Query,
    markedStops: Set<StopId>,
    arrivalsAtCurrentRound: Map<StopId, TripLeg>,
    earliestArrivals: Map<StopId, ReachingTime>,
    round: number,
  ): void {
    const { options } = query;
    const newlyMarkedStops: Set<StopId> = new Set();
    for (const stop of markedStops) {
      for (const transfer of this.timetable.getTransfers(stop)) {
        let transferTime: Duration;
        if (transfer.minTransferTime) {
          transferTime = transfer.minTransferTime;
        } else if (transfer.type === 'IN_SEAT') {
          transferTime = Duration.zero();
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer = arrivalsAtCurrentRound
          .get(stop)!
          .time.plus(transferTime);
        const originalArrival =
          arrivalsAtCurrentRound.get(transfer.destination)?.time ?? UNREACHED;
        if (arrivalAfterTransfer.toSeconds() < originalArrival.toSeconds()) {
          const origin = arrivalsAtCurrentRound.get(stop)?.origin ?? stop;
          arrivalsAtCurrentRound.set(transfer.destination, {
            time: arrivalAfterTransfer,
            legNumber: round,
            origin: origin,
            leg: {
              from: this.stopsIndex.findStopById(stop)!,
              to: this.stopsIndex.findStopById(transfer.destination)!,
              minTransferTime: transfer.minTransferTime,
            },
          });
          earliestArrivals.set(transfer.destination, {
            time: arrivalAfterTransfer,
            legNumber: round,
            origin: origin,
          });
          newlyMarkedStops.add(transfer.destination);
        }
      }
    }
    for (const newStop of newlyMarkedStops) {
      markedStops.add(newStop);
    }
  }

  /**
   * The main Raptor algorithm implementation.
   *
   * @param query The query containing the main parameters for the routing.
   * @returns A result object containing data structures allowing to reconstruct routes and .
   */
  route(query: Query): Result {
    const { from, to, departureTime, options } = query;
    // Consider children or siblings of the "from" stop as potential origins
    const origins = this.stopsIndex.equivalentStops(from);
    // Consider children or siblings of the "to" stop(s) as potential destinations
    const destinations = to.flatMap((destination) =>
      this.stopsIndex.equivalentStops(destination),
    );
    const earliestArrivals = new Map<StopId, ReachingTime>();

    const earliestArrivalsWithoutAnyLeg = new Map<StopId, TripLeg>();
    const earliestArrivalsPerRound = [earliestArrivalsWithoutAnyLeg];
    // Stops that have been improved at round k-1
    const markedStops = new Set<StopId>();

    for (const originStop of origins) {
      markedStops.add(originStop);
      earliestArrivals.set(originStop, {
        time: departureTime,
        legNumber: 0,
        origin: originStop,
      });
      earliestArrivalsWithoutAnyLeg.set(originStop, {
        time: departureTime,
        legNumber: 0,
        origin: originStop,
      });
    }
    // on the first round we need to first consider transfers to discover all possible route origins
    this.considerTransfers(
      query,
      markedStops,
      earliestArrivalsWithoutAnyLeg,
      earliestArrivals,
      0,
    );

    for (let round = 1; round <= options.maxTransfers + 1; round++) {
      const arrivalsAtCurrentRound = new Map<StopId, TripLeg>();
      earliestArrivalsPerRound.push(arrivalsAtCurrentRound);
      const arrivalsAtPreviousRound = earliestArrivalsPerRound[round - 1]!;
      // Routes that contain at least one stop reached with at least round - 1 legs
      // together with corresponding hop on stop index (earliest marked stop)
      const reachableRoutes = this.timetable.findReachableRoutes(
        markedStops,
        options.transportModes,
      );
      markedStops.clear();
      // for each route that can be reached with at least round - 1 trips
      for (const [routeId, hopOnStop] of reachableRoutes.entries()) {
        const route = this.timetable.getRoute(routeId)!;
        let currentTrip: CurrentTrip | undefined = undefined;
        const hopOnIndex = route.stopIndices.get(hopOnStop)!;
        // for each stops in the route starting with the hop-on one
        for (let i = hopOnIndex; i < route.stops.length; i++) {
          const currentStop = route.stops[i]!;
          const stopNumbers = route.stops.length;
          if (currentTrip !== undefined) {
            const currentStopTimes =
              route.stopTimes[currentTrip.trip * stopNumbers + i]!;
            const earliestArrivalAtCurrentStop =
              earliestArrivals.get(currentStop)?.time ?? UNREACHED;
            let arrivalToImprove = earliestArrivalAtCurrentStop;
            if (destinations.length > 0) {
              const earliestArrivalsAtDestinations: Time[] = [];
              // if multiple destinations are specified, the target pruning
              // should compare to the earliest arrival at any of them
              for (const destinationStop of destinations) {
                const earliestArrivalAtDestination =
                  earliestArrivals.get(destinationStop)?.time ?? UNREACHED;
                earliestArrivalsAtDestinations.push(
                  earliestArrivalAtDestination,
                );
              }
              const earliestArrivalAtDestination = Time.min(
                ...earliestArrivalsAtDestinations,
              );
              arrivalToImprove = Time.min(
                earliestArrivalAtCurrentStop,
                earliestArrivalAtDestination,
              );
            }
            if (
              currentStopTimes.dropOffType !== 'NOT_AVAILABLE' &&
              currentStopTimes.arrival.toSeconds() <
                arrivalToImprove.toSeconds()
            ) {
              const bestHopOnStopIndex = route.stopIndices.get(
                currentTrip.bestHopOnStop,
              )!;
              const bestHopOnStopTimes =
                route.stopTimes[
                  currentTrip.trip * stopNumbers + bestHopOnStopIndex
                ]!;
              arrivalsAtCurrentRound.set(currentStop, {
                time: currentStopTimes.arrival,
                legNumber: round,
                origin: currentTrip.origin,
                leg: {
                  from: this.stopsIndex.findStopById(
                    currentTrip.bestHopOnStop,
                  )!,
                  to: this.stopsIndex.findStopById(currentStop)!,
                  departureTime: bestHopOnStopTimes.departure,
                  arrivalTime: currentStopTimes.arrival,
                  route: this.timetable.getServiceRoute(route.serviceRouteId),
                },
              });
              earliestArrivals.set(currentStop, {
                time: currentStopTimes.arrival,
                legNumber: round,
                origin: currentTrip.origin,
              });
              markedStops.add(currentStop);
            }
          }
          // check if we can catch a previous trip at the current stop
          // if there was no current trip, find the first one reachable
          const earliestArrivalOnPreviousRound =
            arrivalsAtPreviousRound.get(currentStop)?.time;
          if (
            earliestArrivalOnPreviousRound !== undefined &&
            (currentTrip === undefined ||
              earliestArrivalOnPreviousRound.toSeconds() <=
                route.stopTimes[
                  currentTrip.trip * stopNumbers + i
                ]!.departure.toSeconds())
          ) {
            const earliestTrip = this.timetable.findEarliestTrip(
              route,
              currentStop,
              currentTrip?.trip,
              earliestArrivalOnPreviousRound,
            );
            if (earliestTrip !== undefined) {
              currentTrip = {
                trip: earliestTrip,
                // we need to keep track of the best hop-on stop to reconstruct the route at the end
                bestHopOnStop: currentStop,
                origin:
                  arrivalsAtPreviousRound.get(currentStop)?.origin ??
                  currentStop,
              };
            }
          }
        }
      }
      this.considerTransfers(
        query,
        markedStops,
        arrivalsAtCurrentRound,
        earliestArrivals,
        round,
      );
      if (markedStops.size === 0) break;
    }
    return new Result(
      query,
      earliestArrivals,
      earliestArrivalsPerRound,
      this.stopsIndex,
    );
  }
}
