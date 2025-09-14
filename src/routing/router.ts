/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Stop, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Duration } from '../timetable/duration.js';
import { ServiceRoute } from '../timetable/proto/timetable.js';
import { RouteTripIndex } from '../timetable/route.js';
import { Time } from '../timetable/time.js';
import { ServiceRouteId, Timetable } from '../timetable/timetable.js';
import { Query } from './query.js';
import { Result } from './result.js';
import { Leg, TripId } from './route.js';

const UNREACHED = Time.infinity();

export type TripLeg = ReachingTime & {
  leg?: Leg; // leg is not set for the very first segment
};

export type ReachingTime = {
  arrival: Time;
  legNumber: number;
  origin: StopId;
};

export type MarkedStop = {
  stopId: StopId;
  reachedWith: 'transfer' | 'vehicle';
  fromServiceRoute?: ServiceRouteId; // only consider next legs that can be reached from this service route
  fromTrip?: TripId; // only consider next legs that can be reached from this trip
  toServiceRoute?: ServiceRouteId; // only consider next legs that are part of this service route
  toTrip?: TripId; // only consider next legs that are part of this trip
};

// Corresponds to a trip within a route
type RouteTrip = {
  tripIndex: RouteTripIndex;
  origin: StopId;
  bestHopOnStop: StopId;
};

/**
 * A public transportation network router utilizing the RAPTOR algorithm for
 * efficient journey planning and routing. For more information on the RAPTOR
 * algorithm, refer to its detailed explanation in the research paper:
 * https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf
 */
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
    markedStops: Set<MarkedStop>, // TODO Add to_route_id and to_trip_id info from the transfer
    arrivalsAtCurrentRound: Map<StopId, TripLeg>,
    earliestArrivals: Map<StopId, ReachingTime>,
    round: number,
  ): void {
    const { options } = query;
    const newlyMarkedStops: Set<MarkedStop> = new Set();
    for (const stop of markedStops) {
      const currentArrival = arrivalsAtCurrentRound.get(stop.stopId);
      // Skip transfers if the last leg was also a transfer
      if (currentArrival === undefined || stop.reachedWith === 'transfer') {
        continue;
      }
      for (const transfer of this.timetable.getTransfers(
        stop.stopId,
        stop.fromServiceRoute,
        stop.fromTrip,
      )) {
        let transferTime: Duration;
        if (transfer.minTransferTime) {
          transferTime = transfer.minTransferTime;
        } else if (transfer.type === 'IN_SEAT') {
          transferTime = Duration.zero();
        } else {
          transferTime = options.minTransferTime;
        }
        const arrivalAfterTransfer = currentArrival.arrival.plus(transferTime);
        const originalArrival =
          arrivalsAtCurrentRound.get(transfer.destination)?.arrival ??
          UNREACHED;
        if (arrivalAfterTransfer.isBefore(originalArrival)) {
          const origin = currentArrival.origin;
          arrivalsAtCurrentRound.set(transfer.destination, {
            arrival: arrivalAfterTransfer,
            legNumber: round,
            origin: origin,
            leg: {
              from: this.stopsIndex.findStopById(stop.stopId)!,
              to: this.stopsIndex.findStopById(transfer.destination)!,
              minTransferTime: transfer.minTransferTime,
              type: transfer.type,
            },
          });
          earliestArrivals.set(transfer.destination, {
            arrival: arrivalAfterTransfer,
            legNumber: round,
            origin: origin,
          });
          newlyMarkedStops.add({
            stopId: transfer.destination,
            toServiceRoute: transfer.toServiceRoute,
            toTrip: transfer.toTrip,
            reachedWith: 'transfer',
          });
        }
      }
    }
    for (const newStop of newlyMarkedStops) {
      markedStops.add(newStop);
    }
  }

  /**
   * Finds the earliest arrival time at any stop from a given set of destinations.
   *
   * @param earliestArrivals A map of stops to their earliest reaching times.
   * @param destinations An array of destination stops to evaluate.
   * @returns The earliest arrival time among the provided destinations.
   */
  private earliestArrivalAtAnyStop(
    earliestArrivals: Map<StopId, ReachingTime>,
    destinations: Stop[],
  ): Time {
    let earliestArrivalAtAnyDestination = UNREACHED;
    for (const destination of destinations) {
      const arrival =
        earliestArrivals.get(destination.id)?.arrival ?? UNREACHED;
      earliestArrivalAtAnyDestination = Time.min(
        earliestArrivalAtAnyDestination,
        arrival,
      );
    }
    return earliestArrivalAtAnyDestination;
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
    const destinations = Array.from(to).flatMap((destination) =>
      this.stopsIndex.equivalentStops(destination),
    );
    const earliestArrivals = new Map<StopId, ReachingTime>();

    const earliestArrivalsWithoutAnyLeg = new Map<StopId, TripLeg>();
    const earliestArrivalsPerRound = [earliestArrivalsWithoutAnyLeg];
    // Stops that have been improved at round k-1
    const markedStops = new Set<MarkedStop>();

    for (const originStop of origins) {
      markedStops.add({ stopId: originStop.id, reachedWith: 'transfer' });
      earliestArrivals.set(originStop.id, {
        arrival: departureTime,
        legNumber: 0,
        origin: originStop.id,
      });
      earliestArrivalsWithoutAnyLeg.set(originStop.id, {
        arrival: departureTime,
        legNumber: 0,
        origin: originStop.id,
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
      for (const [route, hopOnStop] of reachableRoutes.entries()) {
        let currentRouteTrip: RouteTrip | undefined = undefined;
        for (const currentStop of route.stopsIterator(hopOnStop)) {
          if (currentRouteTrip !== undefined) {
            const currentTrip = route.tripIdAtIndex(currentRouteTrip.tripIndex);
            const currentArrivalTime = route.arrivalAt(
              currentStop,
              currentRouteTrip.tripIndex,
            );
            const currentDropOffType = route.dropOffTypeAt(
              currentStop,
              currentRouteTrip.tripIndex,
            );
            const earliestArrivalAtCurrentStop =
              earliestArrivals.get(currentStop)?.arrival ?? UNREACHED;
            if (
              currentDropOffType !== 'NOT_AVAILABLE' &&
              currentArrivalTime.isBefore(earliestArrivalAtCurrentStop) && // local prunning
              currentArrivalTime.isBefore(
                this.earliestArrivalAtAnyStop(earliestArrivals, destinations),
              ) // target prunning
            ) {
              const bestHopOnDepartureTime = route.departureFrom(
                currentRouteTrip.bestHopOnStop,
                currentRouteTrip.tripIndex,
              );
              arrivalsAtCurrentRound.set(currentStop, {
                arrival: currentArrivalTime,
                legNumber: round,
                origin: currentRouteTrip.origin,
                leg: {
                  from: this.stopsIndex.findStopById(
                    currentRouteTrip.bestHopOnStop,
                  )!,
                  to: this.stopsIndex.findStopById(currentStop)!,
                  departureTime: bestHopOnDepartureTime,
                  arrivalTime: currentArrivalTime,
                  dropOffType: currentDropOffType,
                  pickUpType: route.pickUpTypeFrom(
                    currentStop,
                    currentRouteTrip.tripIndex,
                  ),
                  route: this.timetable.getServiceRouteInfo(route),
                },
              });
              earliestArrivals.set(currentStop, {
                arrival: currentArrivalTime,
                legNumber: round,
                origin: currentRouteTrip.origin,
              });
              markedStops.add({
                stopId: currentStop,
                fromTrip: currentTrip,
                fromServiceRoute: route.serviceRoute(),
                reachedWith: 'vehicle',
              });
            }
          }
          // check if we can catch a previous trip at the current stop
          // if there was no current trip, find the first one reachable
          const earliestArrivalOnPreviousRound =
            arrivalsAtPreviousRound.get(currentStop)?.arrival;
          if (
            earliestArrivalOnPreviousRound !== undefined &&
            (currentRouteTrip === undefined ||
              earliestArrivalOnPreviousRound.isBefore(
                route.arrivalAt(currentStop, currentRouteTrip.tripIndex),
              ) ||
              earliestArrivalOnPreviousRound.equals(
                route.arrivalAt(currentStop, currentRouteTrip.tripIndex),
              ))
          ) {
            const earliestTrip = route.findEarliestTrip(
              currentStop,
              earliestArrivalOnPreviousRound,
              currentRouteTrip?.tripIndex,
            );
            if (earliestTrip !== undefined) {
              currentRouteTrip = {
                tripIndex: earliestTrip,
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
