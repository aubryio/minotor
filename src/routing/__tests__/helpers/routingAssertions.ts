import assert from 'node:assert';

import { StopId } from '../../../stops/stops.js';
import { Time } from '../../../timetable/time.js';
import { RangeRaptorState } from '../../rangeState.js';
import { Result } from '../../result.js';
import { Route } from '../../route.js';
import { RoutingState } from '../../state.js';

export function expectArrival(
  subject: RoutingState | Result,
  stop: StopId,
  arrival: Time,
  legNumber?: number,
): void {
  const actual =
    subject instanceof RoutingState
      ? subject.getArrival(stop)
      : subject.arrivalAt(stop);

  assert(actual);
  assert.strictEqual(actual.arrival, arrival);
  if (legNumber !== undefined) {
    assert.strictEqual(actual.legNumber, legNumber);
  }
}

export function expectNoArrival(
  subject: RoutingState | Result,
  stop: StopId,
): void {
  const actual =
    subject instanceof RoutingState
      ? subject.getArrival(stop)
      : subject.arrivalAt(stop);

  assert.strictEqual(actual, undefined);
}

export function expectRouteStops(
  route: Route | undefined,
  stops: StopId[],
): void {
  assert(route);
  assert.strictEqual(route.legs[0]?.from.id, stops[0]);
  assert.strictEqual(
    route.legs[route.legs.length - 1]?.to.id,
    stops[stops.length - 1],
  );

  for (let i = 0; i < route.legs.length; i++) {
    assert.strictEqual(route.legs[i]?.from.id, stops[i]);
    assert.strictEqual(route.legs[i]?.to.id, stops[i + 1]);
  }
}

export function expectRoundLabel(
  state: RangeRaptorState,
  round: number,
  stop: StopId,
  arrival: Time,
): void {
  assert.strictEqual(state.roundLabels[round]?.[stop], arrival);
}
