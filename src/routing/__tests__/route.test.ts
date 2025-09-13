import assert from 'node:assert';
import { describe, it } from 'node:test';

import { Stop } from '../../stops/stops.js';
import { Duration } from '../../timetable/duration.js';
import { Time } from '../../timetable/time.js';
import { ServiceRouteInfo, TransferType } from '../../timetable/timetable.js';
import { Route } from '../route.js';

describe('Route', () => {
  const stopA: Stop = {
    id: 1,
    sourceStopId: 'A',
    name: 'Stop A',
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
    children: [],
  };

  const stopB: Stop = {
    id: 2,
    sourceStopId: 'B',
    name: 'Stop B',
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
    children: [],
  };

  const stopC: Stop = {
    id: 3,
    sourceStopId: 'C',
    name: 'Stop C',
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
    children: [],
  };

  const stopD: Stop = {
    id: 4,
    sourceStopId: 'D',
    name: 'Stop D',
    locationType: 'SIMPLE_STOP_OR_PLATFORM',
    children: [],
  };

  const serviceRoute: ServiceRouteInfo = {
    type: 'BUS',
    name: 'Route 1',
  };

  const serviceRoute2: ServiceRouteInfo = {
    type: 'RAIL',
    name: 'Route 2',
  };

  const vehicleLeg = {
    from: stopA,
    to: stopB,
    route: serviceRoute,
    departureTime: Time.fromHMS(8, 0, 0),
    arrivalTime: Time.fromHMS(8, 30, 0),
  };

  const transferLeg = {
    from: stopB,
    to: stopC,
    type: 'RECOMMENDED' as TransferType,
    minTransferTime: Duration.fromMinutes(5),
  };

  const secondVehicleLeg = {
    from: stopC,
    to: stopD,
    route: serviceRoute2,
    departureTime: Time.fromHMS(8, 40, 0),
    arrivalTime: Time.fromHMS(9, 0, 0),
  };

  it('should calculate the correct departure time', () => {
    const route = new Route([vehicleLeg, transferLeg, secondVehicleLeg]);
    const departureTime = route.departureTime();
    assert.strictEqual(
      departureTime.toMinutes(),
      Time.fromHMS(8, 0, 0).toMinutes(),
    );
  });

  it('should calculate the correct arrival time', () => {
    const route = new Route([vehicleLeg, transferLeg, secondVehicleLeg]);
    const arrivalTime = route.arrivalTime();
    assert.strictEqual(
      arrivalTime.toMinutes(),
      Time.fromHMS(9, 0, 0).toMinutes(),
    );
  });

  it('should calculate the total duration of the route', () => {
    const route = new Route([vehicleLeg, transferLeg, secondVehicleLeg]);
    const totalDuration = route.totalDuration();
    assert.strictEqual(
      totalDuration.toSeconds(),
      Duration.fromMinutes(60).toSeconds(),
    );
  });

  it('should throw an error if no vehicle leg is found for departure time', () => {
    const route = new Route([transferLeg]);
    assert.throws(() => route.departureTime(), /No vehicle leg found in route/);
  });

  it('should throw an error if no vehicle leg is found for arrival time', () => {
    const route = new Route([transferLeg]);
    assert.throws(() => route.arrivalTime(), /No vehicle leg found in route/);
  });
});
