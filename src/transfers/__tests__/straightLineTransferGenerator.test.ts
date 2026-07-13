import assert from 'node:assert';
import { describe, it } from 'node:test';

import { distance } from 'geokdbush';

import { Stop } from '../../stops/stops.js';
import { StopsIndex } from '../../stops/stopsIndex.js';
import {
  RouteType,
  RouteTypes,
  TransferTypes,
} from '../../timetable/timetable.js';
import { StopModes } from '../generator.js';
import { StraightLineTransferGenerator } from '../straightLineTransferGenerator.js';

// A tiny synthetic interchange: a subway and a tram stop ~100m apart, a bus
// stop ~2km away, and a stop with no coordinates.
const subwayLat = 59.357;
const subwayLon = 18.102;
const tramLat = 59.3576;
const tramLon = 18.1035;
const farLat = 59.37;
const farLon = 18.13;

const subway: Stop = {
  id: 0,
  name: 'Subway',
  lat: subwayLat,
  lon: subwayLon,
  children: [],
  locationType: 'SIMPLE_STOP_OR_PLATFORM',
};
const tram: Stop = {
  id: 1,
  name: 'Tram',
  lat: tramLat,
  lon: tramLon,
  children: [],
  locationType: 'SIMPLE_STOP_OR_PLATFORM',
};
const far: Stop = {
  id: 2,
  name: 'Far Away',
  lat: farLat,
  lon: farLon,
  children: [],
  locationType: 'SIMPLE_STOP_OR_PLATFORM',
};
const noCoords: Stop = {
  id: 3,
  name: 'No Coordinates',
  children: [],
  locationType: 'SIMPLE_STOP_OR_PLATFORM',
};

const stops = new StopsIndex([subway, tram, far, noCoords]);

// No mode information: every stop's access penalty resolves to 0.
const noModes: StopModes = new Map();

describe('StraightLineTransferGenerator', () => {
  it('connects nearby stops with typed walking transfers', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
    });
    const transfers = generator.generate([subway, tram], stops, noModes);

    const subwayToTram = (transfers.get(subway.id) ?? []).find(
      (t) => t.destination === tram.id,
    );
    assert.ok(subwayToTram, 'expected a transfer from subway to tram');
    assert.strictEqual(subwayToTram.type, TransferTypes.REQUIRES_MINIMAL_TIME);
    assert.ok(
      typeof subwayToTram.minTransferTime === 'number' &&
        Number.isInteger(subwayToTram.minTransferTime),
    );
  });

  it('emits exactly one edge per direction when both stops are origins', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
    });
    const transfers = generator.generate([subway, tram], stops, noModes);

    const subwayToTram = (transfers.get(subway.id) ?? []).filter(
      (t) => t.destination === tram.id,
    );
    const tramToSubway = (transfers.get(tram.id) ?? []).filter(
      (t) => t.destination === subway.id,
    );
    assert.strictEqual(subwayToTram.length, 1);
    assert.strictEqual(tramToSubway.length, 1);
  });

  it('only emits transfers from the given origins', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
    });
    // Only the subway is an origin; the reverse tram -> subway edge is only
    // emitted when the tram is itself visited as an origin.
    const transfers = generator.generate([subway], stops, noModes);

    const subwayToTram = (transfers.get(subway.id) ?? []).some(
      (t) => t.destination === tram.id,
    );
    assert.ok(subwayToTram, 'expected subway -> tram');
    assert.ok(
      !transfers.has(tram.id),
      'expected no reverse edge when the tram is not an origin',
    );
  });

  it('does not connect stops beyond the radius', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
    });
    const transfers = generator.generate([subway], stops, noModes);

    const subwayToFar = (transfers.get(subway.id) ?? []).some(
      (t) => t.destination === far.id,
    );
    assert.ok(!subwayToFar);
    assert.ok(!transfers.has(far.id));
  });

  it('connects farther stops when the radius is large enough', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 5000,
    });
    const transfers = generator.generate([subway], stops, noModes);

    const subwayToFar = (transfers.get(subway.id) ?? []).some(
      (t) => t.destination === far.id,
    );
    assert.ok(subwayToFar);
  });

  it('ignores stops without coordinates', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 5000,
    });
    const transfers = generator.generate([subway, noCoords], stops, noModes);

    assert.ok(!transfers.has(noCoords.id));
    for (const stopTransfers of transfers.values()) {
      assert.ok(!stopTransfers.some((t) => t.destination === noCoords.id));
    }
  });

  it('derives the transfer time from distance, detour and walking speed', () => {
    const walkingSpeedKmh = 4.5;
    const detourFactor = 1.3;
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
      walkingSpeedKmh,
      detourFactor,
      changePenaltyMinutes: 0,
      modeAccessPenaltyMinutes: {},
    });
    const transfers = generator.generate([subway], stops, noModes);
    const subwayToTram = (transfers.get(subway.id) ?? []).find(
      (t) => t.destination === tram.id,
    );
    assert.ok(subwayToTram);

    const straightLineKm = distance(subwayLon, subwayLat, tramLon, tramLat);
    const expected = Math.round(
      ((straightLineKm * detourFactor) / walkingSpeedKmh) * 60,
    );
    assert.strictEqual(subwayToTram.minTransferTime, expected);
  });

  // Walking time between the subway and tram at the default speed and detour,
  // with penalties disabled, as a baseline the penalty tests build on. Derived
  // from the generator so it tracks the default speed/detour.
  const baseWalkingTime = (() => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
      changePenaltyMinutes: 0,
      modeAccessPenaltyMinutes: {},
    });
    const transfer = generator
      .generate([subway], stops, noModes)
      .get(subway.id)
      ?.find((t) => t.destination === tram.id);
    assert.ok(transfer?.minTransferTime !== undefined);
    return transfer.minTransferTime;
  })();

  it('adds a flat change penalty to every transfer', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
      changePenaltyMinutes: 5,
      modeAccessPenaltyMinutes: {},
    });
    const transfers = generator.generate([subway], stops, noModes);
    const subwayToTram = (transfers.get(subway.id) ?? []).find(
      (t) => t.destination === tram.id,
    );
    assert.ok(subwayToTram);
    assert.strictEqual(subwayToTram.minTransferTime, baseWalkingTime + 5);
  });

  it('adds a per-mode access penalty on each end, symmetrically', () => {
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
      changePenaltyMinutes: 0,
      modeAccessPenaltyMinutes: { SUBWAY: 4 },
    });
    const modes: StopModes = new Map([
      [subway.id, new Set<RouteType>([RouteTypes.SUBWAY])],
      [tram.id, new Set<RouteType>([RouteTypes.TRAM])],
    ]);
    const transfers = generator.generate([subway, tram], stops, modes);

    // Only the subway end carries a penalty; the tram mode is not in the table.
    const subwayToTram = (transfers.get(subway.id) ?? []).find(
      (t) => t.destination === tram.id,
    );
    const tramToSubway = (transfers.get(tram.id) ?? []).find(
      (t) => t.destination === subway.id,
    );
    assert.strictEqual(subwayToTram?.minTransferTime, baseWalkingTime + 4);
    assert.strictEqual(tramToSubway?.minTransferTime, baseWalkingTime + 4);
  });

  it('applies the default subway and change penalties out of the box', () => {
    // Defaults: changePenaltyMinutes 3, SUBWAY access 4, TRAM 0.
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
    });
    const modes: StopModes = new Map([
      [subway.id, new Set<RouteType>([RouteTypes.SUBWAY])],
      [tram.id, new Set<RouteType>([RouteTypes.TRAM])],
    ]);
    const transfers = generator.generate([subway], stops, modes);
    const subwayToTram = (transfers.get(subway.id) ?? []).find(
      (t) => t.destination === tram.id,
    );
    assert.strictEqual(subwayToTram?.minTransferTime, baseWalkingTime + 3 + 4);
  });

  it('uses the least-effort mode for a stop served by several modes', () => {
    // A stop served by both subway and bus has street-level (bus) access, so
    // the smaller penalty wins.
    const generator = new StraightLineTransferGenerator({
      maxDistanceMeters: 500,
      changePenaltyMinutes: 0,
      modeAccessPenaltyMinutes: { SUBWAY: 3, BUS: 0 },
    });
    const modes: StopModes = new Map([
      [subway.id, new Set<RouteType>([RouteTypes.SUBWAY, RouteTypes.BUS])],
    ]);
    const transfers = generator.generate([subway], stops, modes);
    const subwayToTram = (transfers.get(subway.id) ?? []).find(
      (t) => t.destination === tram.id,
    );
    assert.strictEqual(subwayToTram?.minTransferTime, baseWalkingTime);
  });
});
