import { Timetable } from '../router.js';
import { SourceStopId, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Duration } from '../timetable/duration.js';
import { Query } from './query.js';
import { Leg, Route, Transfer, VehicleLeg } from './route.js';
import { Arrival, RoutingState, TransferEdge, VehicleEdge } from './router.js';

export class Result {
  private readonly query: Query;
  public readonly routingState: RoutingState;
  public readonly stopsIndex: StopsIndex;
  public readonly timetable: Timetable;

  constructor(
    query: Query,
    routingState: RoutingState,
    stopsIndex: StopsIndex,
    timetable: Timetable,
  ) {
    this.query = query;
    this.routingState = routingState;
    this.stopsIndex = stopsIndex;
    this.timetable = timetable;
  }

  /**
   * Gets the effective stop ID for routing lookups.
   * When parent station mode is enabled, returns the parent station ID if the stop has one.
   * Otherwise returns the original stop ID.
   *
   * @param stopId - The stop ID to get the effective ID for.
   * @returns The effective stop ID for routing lookups.
   */
  private getEffectiveStopId(stopId: StopId): StopId {
    const stop = this.stopsIndex.findStopById(stopId);
    if (stop) {
      return this.timetable.getEffectiveStopId(stop);
    }
    return stopId;
  }

  /**
   * Reconstructs the best route to a stop by StopId.
   * (to any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param to The destination stop by StopId.
   * @returns a route to the destination stop if it exists.
   */
  bestRouteToStopId(to: StopId | Set<StopId>): Route | undefined {
    const sourceStopIds =
      to instanceof Set
        ? new Set(
            Array.from(to)
              .map(
                (stopId) => this.stopsIndex.findStopById(stopId)?.sourceStopId,
              )
              .filter(
                (sourceId): sourceId is SourceStopId => sourceId !== undefined,
              ),
          )
        : this.stopsIndex.findStopById(to)?.sourceStopId;

    if (
      sourceStopIds === undefined ||
      (sourceStopIds instanceof Set && sourceStopIds.size === 0)
    ) {
      return undefined;
    }

    return this.bestRoute(sourceStopIds);
  }

  /**
   * Reconstructs the best route to a stop.
   * (to any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param to The destination stop. Defaults to the destination of the original query.
   * @returns a route to the destination stop if it exists.
   */
  bestRoute(to?: SourceStopId | Set<SourceStopId>): Route | undefined {
    const destinationList =
      to instanceof Set
        ? Array.from(to)
        : to
          ? [to]
          : Array.from(this.query.to);
    // find the first reached destination
    let fastestDestination: StopId | undefined = undefined;
    let fastestTime: Arrival | undefined = undefined;
    for (const sourceDestination of destinationList) {
      const equivalentStops =
        this.stopsIndex.equivalentStops(sourceDestination);
      for (const destination of equivalentStops) {
        // Use effective stop ID (parent station when enabled) for lookup in routing state
        const effectiveStopId = this.getEffectiveStopId(destination.id);
        const arrivalTime =
          this.routingState.earliestArrivals.get(effectiveStopId);
        if (arrivalTime !== undefined) {
          if (
            fastestTime === undefined ||
            arrivalTime.arrival.isBefore(fastestTime.arrival)
          ) {
            // Store the effective stop ID for graph traversal
            fastestDestination = effectiveStopId;
            fastestTime = arrivalTime;
          }
        }
      }
    }
    if (!fastestDestination || !fastestTime) {
      return undefined;
    }
    const route: Leg[] = [];
    let currentStop = fastestDestination;
    let round = fastestTime.legNumber;
    let previousVehicleEdge: VehicleEdge | undefined;
    while (round > 0) {
      const edge = this.routingState.graph[round]?.get(currentStop);
      if (!edge) {
        throw new Error(
          `No edge arriving at stop ${currentStop} at round ${round}`,
        );
      }
      let leg: Leg;
      if ('routeId' in edge) {
        let vehicleEdge = edge;
        // Handle leg reconstruction for in-seat trip continuations
        const chainedEdges = [vehicleEdge];
        while ('routeId' in vehicleEdge && vehicleEdge.continuationOf) {
          chainedEdges.push(vehicleEdge.continuationOf);
          vehicleEdge = vehicleEdge.continuationOf;
        }
        leg = this.buildVehicleLeg(chainedEdges);
        // Insert a transfer leg between consecutive vehicle legs if applicable
        if (previousVehicleEdge) {
          const isGuaranteed = this.timetable.isTripTransferGuaranteed(
            {
              stopIndex: vehicleEdge.hopOffStopIndex,
              routeId: vehicleEdge.routeId,
              tripIndex: vehicleEdge.tripIndex,
            },
            {
              stopIndex: previousVehicleEdge.stopIndex,
              routeId: previousVehicleEdge.routeId,
              tripIndex: previousVehicleEdge.tripIndex,
            },
          );

          if (isGuaranteed) {
            // Guaranteed transfer - always show transfer leg
            const guaranteedTransferLeg = this.buildGuaranteedTransferLeg(
              vehicleEdge,
              previousVehicleEdge,
            );
            route.unshift(guaranteedTransferLeg);
          } else if (this.timetable.isUsingParentStations()) {
            // In parent station mode, insert intra-station transfer leg
            // when alighting and boarding at the same parent station
            const alightStopId = this.getEffectiveStopIdFromRoute(
              vehicleEdge.routeId,
              vehicleEdge.hopOffStopIndex,
            );
            const boardStopId = this.getEffectiveStopIdFromRoute(
              previousVehicleEdge.routeId,
              previousVehicleEdge.stopIndex,
            );

            if (alightStopId === boardStopId) {
              const intraStationTransferLeg = this.buildIntraStationTransferLeg(
                vehicleEdge,
                previousVehicleEdge,
              );
              route.unshift(intraStationTransferLeg);
            }
          }
        }
        previousVehicleEdge = vehicleEdge;
        // Get the effective stop ID for the boarding stop to continue traversal
        currentStop = this.getEffectiveStopIdFromRoute(
          vehicleEdge.routeId,
          vehicleEdge.stopIndex,
        );
      } else if ('type' in edge) {
        leg = this.buildTransferLeg(edge);
        previousVehicleEdge = undefined;
        // The 'from' stop in a transfer edge is already an effective stop ID
        currentStop = edge.from;
      } else {
        break;
      }
      route.unshift(leg);
      if ('routeId' in edge) {
        round -= 1;
      }
    }
    return new Route(route);
  }

  /**
   * Gets the effective stop ID from a route at a given stop index.
   * This is used during route reconstruction to get the stop ID for graph traversal.
   *
   * @param routeId - The route ID
   * @param stopIndex - The stop index in the route
   * @returns The stop ID at that position (parent station ID when useParentStations is enabled)
   */
  private getEffectiveStopIdFromRoute(
    routeId: number,
    stopIndex: number,
  ): StopId {
    const route = this.timetable.getRoute(routeId);
    if (!route) {
      throw new Error(`Route ${routeId} not found`);
    }
    return route.stopId(stopIndex);
  }

  /**
   * Builds a vehicle leg from a chain of vehicle edges.
   * Uses originalStopId to get the actual platform/child stop for route reconstruction
   * when parent station mode is enabled.
   *
   * @param edges Array of vehicle edges representing continuous trips on transit vehicles
   * @returns A vehicle leg with departure/arrival information and route details
   * @throws Error if the edges array is empty
   */
  private buildVehicleLeg(edges: VehicleEdge[]): VehicleLeg {
    if (edges.length === 0) {
      throw new Error('Cannot build vehicle leg from empty edges');
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstEdge = edges[edges.length - 1]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastEdge = edges[0]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const firstRoute = this.timetable.getRoute(firstEdge.routeId)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastRoute = this.timetable.getRoute(lastEdge.routeId)!;

    // Use originalStopId to get the actual child stop (platform) for reconstruction
    // This handles both parent station mode (returns original child) and normal mode (returns the stop itself)
    const fromStopId = firstRoute.originalStopId(
      firstEdge.stopIndex,
      firstEdge.tripIndex,
    );
    const toStopId = lastRoute.originalStopId(
      lastEdge.hopOffStopIndex,
      lastEdge.tripIndex,
    );

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(fromStopId)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(toStopId)!,
      // The route info comes from the first boarded route in case on continuous trips
      route: this.timetable.getServiceRouteInfo(firstRoute),
      departureTime: firstRoute.departureFrom(
        firstEdge.stopIndex,
        firstEdge.tripIndex,
      ),
      arrivalTime: lastEdge.arrival,
      pickUpType: firstRoute.pickUpTypeFrom(
        firstEdge.stopIndex,
        firstEdge.tripIndex,
      ),
      dropOffType: lastRoute.dropOffTypeAt(
        lastEdge.hopOffStopIndex,
        lastEdge.tripIndex,
      ),
    };
  }

  /**
   * Builds a transfer leg from a transfer edge.
   *
   * @param edge Transfer edge representing a walking connection between stops
   * @returns A transfer leg with from/to stops and transfer details
   */
  private buildTransferLeg(edge: TransferEdge): Transfer {
    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(edge.from)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(edge.to)!,
      minTransferTime: edge.minTransferTime,
      type: edge.type,
    };
  }

  /**
   * Builds a guaranteed transfer leg between two consecutive vehicle legs.
   * Uses originalStopId to get the actual platform/child stop for route reconstruction
   * when parent station mode is enabled.
   *
   * @param fromEdge The vehicle edge we're alighting from
   * @param toEdge The vehicle edge we're boarding
   * @returns A transfer leg with type 'GUARANTEED'
   */
  private buildGuaranteedTransferLeg(
    fromEdge: VehicleEdge,
    toEdge: VehicleEdge,
  ): Transfer {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fromRoute = this.timetable.getRoute(fromEdge.routeId)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const toRoute = this.timetable.getRoute(toEdge.routeId)!;

    // Use originalStopId to get the actual child stop (platform) for reconstruction
    const fromStopId = fromRoute.originalStopId(
      fromEdge.hopOffStopIndex,
      fromEdge.tripIndex,
    );
    const toStopId = toRoute.originalStopId(toEdge.stopIndex, toEdge.tripIndex);

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(fromStopId)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(toStopId)!,
      type: 'GUARANTEED',
    };
  }

  /**
   * Builds an intra-station transfer leg between two consecutive vehicle legs
   * when using parent station mode. This represents a transfer between platforms
   * within the same parent station.
   *
   * @param fromEdge The vehicle edge we're alighting from
   * @param toEdge The vehicle edge we're boarding
   * @returns A transfer leg with the appropriate transfer time
   */
  private buildIntraStationTransferLeg(
    fromEdge: VehicleEdge,
    toEdge: VehicleEdge,
  ): Transfer {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const fromRoute = this.timetable.getRoute(fromEdge.routeId)!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const toRoute = this.timetable.getRoute(toEdge.routeId)!;

    // Use originalStopId to get the actual child stop (platform) for reconstruction
    const fromStopId = fromRoute.originalStopId(
      fromEdge.hopOffStopIndex,
      fromEdge.tripIndex,
    );
    const toStopId = toRoute.originalStopId(toEdge.stopIndex, toEdge.tripIndex);

    // Get the parent station ID to look up transfer time
    const parentStationId = fromRoute.stopId(fromEdge.hopOffStopIndex);
    const transferTimeSeconds =
      this.timetable.getParentStationTransferTime(parentStationId);

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      from: this.stopsIndex.findStopById(fromStopId)!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      to: this.stopsIndex.findStopById(toStopId)!,
      type: 'RECOMMENDED',
      ...(transferTimeSeconds !== undefined && {
        minTransferTime: Duration.fromSeconds(transferTimeSeconds),
      }),
    };
  }

  /**
   * Returns the arrival time at any stop reachable in less time / transfers than the destination(s) of the query)
   *
   * @param stop The target stop for which to return the arrival time.
   * @param maxTransfers The optional maximum number of transfers allowed.
   * @returns The arrival time if the target stop is reachable, otherwise undefined.
   */
  arrivalAt(stop: SourceStopId, maxTransfers?: number): Arrival | undefined {
    const equivalentStops = this.stopsIndex.equivalentStops(stop);
    let earliestArrival: Arrival | undefined = undefined;

    for (const equivalentStop of equivalentStops) {
      // Use effective stop ID (parent station when enabled) for lookup
      const effectiveStopId = this.getEffectiveStopId(equivalentStop.id);
      let arrivalTime;
      if (maxTransfers === undefined) {
        arrivalTime = this.routingState.earliestArrivals.get(effectiveStopId);
      } else {
        // We have no guarantee that the stop was visited in the last round,
        // so we need to check all rounds if it's not found in the last one.
        for (let i = maxTransfers + 1; i >= 0; i--) {
          const arrivalEdge = this.routingState.graph[i]?.get(effectiveStopId);
          if (arrivalEdge !== undefined) {
            arrivalTime = {
              arrival: arrivalEdge.arrival,
              legNumber: i,
            };
            break;
          }
        }
      }
      if (arrivalTime !== undefined) {
        if (
          earliestArrival === undefined ||
          arrivalTime.arrival.isBefore(earliestArrival.arrival)
        ) {
          earliestArrival = arrivalTime;
        }
      }
    }

    return earliestArrival;
  }
}
