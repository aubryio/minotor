# Virtual transfers

Many GTFS feeds only partially populate `transfers.txt`, so nearby stops that belong to different stations (e.g. a subway platform and an adjacent tram or bus terminal) end up with no walking connection and cannot be used as an interchange. A `TransferGenerator` can be passed to the parser to synthesize the missing walking transfers as a pre-processing step, before the timetable is serialized.

## Built-in implementation

`StraightLineTransferGenerator` connects nearby stops that aren't already linked in the feed — for every stop it adds walking transfers to the other stops within a radius, estimating the walking time from the straight-line distance:

```ts
import {
  GtfsParser,
  StraightLineTransferGenerator,
  extendedGtfsProfile,
} from 'minotor/parser';

const parser = new GtfsParser(
  'gtfs-feed.zip',
  extendedGtfsProfile,
  new StraightLineTransferGenerator({ maxDistanceMeters: 500 }),
);

const timetable = await parser.parseTimetable(new Date());
```

On top of the walking time, some adjustments make the estimate more realistic:

- a **detour factor** as no path in the real world is a straight line
- a flat **change penalty** added to every transfer, for the general overhead of changing
- a per-mode **access penalty** added on each end, based on the modes serving the two stops, so that a change out of a deep mode such as the subway costs more than the straight-line distance alone would suggest

Both penalties are symmetric, the two directions of a transfer share the same minimum time. Existing transfers from the feed are always preserved:

| Option                     | Default                  | Description                                                                                              |
| -------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `maxDistanceMeters`        | `500`                    | Radius within which two stops are connected                                                              |
| `walkingSpeedKmh`          | `4`                      | Assumed walking speed                                                                                    |
| `detourFactor`             | `1.3`                    | Multiplier from straight-line to real walking distance (`1` to disable)                                  |
| `changePenaltyMinutes`     | `3`                      | Flat penalty added to every generated transfer (`0` to disable)                                          |
| `modeAccessPenaltyMinutes` | `{ SUBWAY: 4, RAIL: 3 }` | Per-mode access penalty in minutes, keyed by mode name; passing this replaces the default, `{}` disables |

## Custom implementation

The straight-line estimate is relatively basic but works without external dependencies. For realistic walking times, you can implement the `TransferGenerator` interface yourself by e.g. delegating to an external pedestrian routing engine.

The parser passes the candidate origin stops (route-served stops with coordinates) and deduplicates the result against the transfers already in the feed, keeping only links between stops a route actually calls at — so you can emit a transfer for every nearby pair without tracking what already exists. `stopModes` gives the transport modes serving each stop (derived from the routes calling at it) so you can tune transfers to the modes involved; ignore it if you don't need it. Return the directed transfers to add, using `TransferTypes.REQUIRES_MINIMAL_TIME` so the router treats them as walking connections (for both transfers and access/egress). `minTransferTime` is expressed in minutes.

```ts
import { GtfsParser, TransferTypes, extendedGtfsProfile } from 'minotor/parser';
import type { GeneratedTransfers, TransferGenerator } from 'minotor/parser';
import type { Stop, StopsIndex } from 'minotor';

// Delegates to a hypothetical external walking-router HTTP API.
class WalkingApiTransferGenerator implements TransferGenerator {
  async generate(
    originStops: Stop[],
    stops: StopsIndex,
  ): Promise<GeneratedTransfers> {
    const generated: GeneratedTransfers = new Map();

    for (const origin of originStops) {
      // Reuse minotor's geo index to find nearby candidate stops.
      const neighbors = stops.findStopsByLocation(
        origin.lat,
        origin.lon,
        Infinity,
        this.maxDistanceKm,
      );

      for (const neighbor of neighbors) {
        // Ask the external engine for a real door-to-door walking time.
        const walkTimeInMinutes = await callExternalRoutingEngine(
          origin.lat,
          origin.lon,
          neighbor.lat,
          neighbor.lon,
        );

        const transfers = generated.get(origin.id) ?? [];
        transfers.push({
          destination: neighbor.id,
          type: TransferTypes.REQUIRES_MINIMAL_TIME,
          minTransferTime: walkTimeInMinutes,
        });
        generated.set(origin.id, transfers);
      }
    }

    return generated;
  }
}

const parser = new GtfsParser(
  'gtfs-feed.zip',
  extendedGtfsProfile,
  new WalkingApiTransferGenerator('https://walk.example.com'),
);
```

Transfers are directed. The example above emits one edge per `origin -> neighbor`; the reverse edge is produced when the neighbor is itself visited as an origin (every candidate stop is passed as an origin), so a symmetric walking time yields a usable connection both ways.
