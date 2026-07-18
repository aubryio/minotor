import { Stop } from '../../../stops/stops.js';
import { StopsIndex } from '../../../stops/stopsIndex.js';
import { stopAdjacency } from '../../../timetable/__tests__/helpers/timetable.js';
import { Route, RouteId } from '../../../timetable/route.js';
import {
  ALL_TRANSPORT_MODES,
  RouteType,
  RouteTypes,
  ServiceRoute,
  StopAdjacency,
  Timetable,
  Transfer,
  TripTransfers,
} from '../../../timetable/timetable.js';
import { AccessFinder } from '../../access.js';
import { PlainRouter } from '../../plainRouter.js';
import { RangeRouter } from '../../rangeRouter.js';
import { Raptor } from '../../raptor.js';
import { Router } from '../../router.js';

export type StopSpec = string | Partial<Stop>;

export type RouteTripStopSpec = {
  id: number;
  arrivalTime: number;
  departureTime: number;
  dropOffType?: number;
  pickUpType?: number;
};

export type RouteSpec = {
  id?: RouteId;
  name?: string;
  mode?: RouteType;
  serviceRouteId?: number;
  trips: Array<{ stops: RouteTripStopSpec[] }>;
};

export type RoutingScenarioParams = {
  stops: StopSpec[];
  routes?: RouteSpec[];
  transfers?: Transfer[];
  tripContinuations?: TripTransfers;
  guaranteedTripTransfers?: TripTransfers;
};

export type RoutingScenario = {
  stops: Stop[];
  stopsAdjacency: StopAdjacency[];
  routesAdjacency: Route[];
  serviceRoutes: ServiceRoute[];
  timetable: Timetable;
  stopsIndex: StopsIndex;
  accessFinder: AccessFinder;
  raptor: Raptor;
  plainRouter: PlainRouter;
  rangeRouter: RangeRouter;
  router: Router;
};

export function routingScenario({
  stops: stopSpecs,
  routes: routeSpecs = [],
  transfers = [],
  tripContinuations,
  guaranteedTripTransfers,
}: RoutingScenarioParams): RoutingScenario {
  const stops = stopSpecs.map((spec, id) =>
    typeof spec === 'string'
      ? testStop(id, spec)
      : testStop(id, spec.name ?? `Stop ${String(id)}`, spec),
  );

  const routesAdjacency = routeSpecs.map((spec, index) => {
    const id = spec.id ?? index;
    return Route.of({
      id,
      serviceRouteId: spec.serviceRouteId ?? id,
      trips: spec.trips,
    });
  });

  const routeIdsByStop = Array.from(
    { length: stops.length },
    () => [] as RouteId[],
  );
  for (const route of routesAdjacency) {
    for (const stop of route.stops) {
      routeIdsByStop[stop]?.push(route.id);
    }
  }

  const transferIdsByStop = Array.from(
    { length: stops.length },
    () => [] as number[],
  );
  transfers.forEach((transfer, id) => {
    transferIdsByStop[transfer.from]?.push(id);
  });

  const stopsAdjacency = stops.map((_, stopId) =>
    stopAdjacency(routeIdsByStop[stopId], transferIdsByStop[stopId]),
  );

  const serviceRoutes = routeSpecs.map((spec, index) => {
    const id = spec.id ?? index;
    return {
      type: spec.mode ?? RouteTypes.BUS,
      name: spec.name ?? `Line ${String(id)}`,
      routes: [id],
    };
  });

  const timetable = new Timetable(
    stopsAdjacency,
    routesAdjacency,
    serviceRoutes,
    tripContinuations,
    guaranteedTripTransfers,
    transfers,
  );
  const stopsIndex = new StopsIndex(stops);
  const accessFinder = new AccessFinder(timetable, stopsIndex);
  const raptor = new Raptor(timetable);

  return {
    stops,
    stopsAdjacency,
    routesAdjacency,
    serviceRoutes,
    timetable,
    stopsIndex,
    accessFinder,
    raptor,
    plainRouter: new PlainRouter(timetable, stopsIndex, accessFinder, raptor),
    rangeRouter: new RangeRouter(timetable, stopsIndex, accessFinder, raptor),
    router: new Router(timetable, stopsIndex),
  };
}

export function defaultQueryOptions() {
  return {
    maxTransfers: 5,
    minTransferTime: 2,
    transportModes: ALL_TRANSPORT_MODES,
  };
}

function testStop(
  id: number,
  name: string,
  overrides: Partial<Stop> = {},
): Stop {
  return {
    id,
    sourceStopId: overrides.sourceStopId ?? name,
    name,
    lat: overrides.lat ?? 0,
    lon: overrides.lon ?? 0,
    children: overrides.children ?? [],
    locationType: overrides.locationType ?? 'SIMPLE_STOP_OR_PLATFORM',
    ...overrides,
  };
}
