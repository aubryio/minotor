# Minotor

![GitHub Workflow Status](https://github.com/aubryio/minotor/actions/workflows/minotor.yml/badge.svg?branch=main)

[Documentation and examples](https://minotor.dev)

A lightweight and easy to use public transit router primarily targeting client-side usage for research, data visualization, dynamic web and mobile apps.

Unlike most transit planners out there, **minotor** can store all the transit data for a given day in memory on the client, allowing for fast runtime queries using only local data.
This is particularly useful for highly dynamic applications or complex visualizations for research purposes where the user needs to query the data in real-time.
Privacy-conscious applications where the user does not want to share their location data with a server can also benefit from this model.

The transit router and the stops index of **minotor** can run in the browser, on React Native or in a Node.js environment.
Transit data (GTFS) parsing runs on Node.js, and the resulting data is serialized as a protobuf binary that can be loaded by the router.

Minotor's routing algorithm is mostly based on RAPTOR. See [Round-Based Public Transit Routing, D. Delling et al. 2012](https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf).

## Examples

### In-browser transit router

An example client-side transit router running in the browser with a web worker.

[Demo](https://www.minotor.dev/#router) | [Code](https://github.com/aubryio/minotor.dev/tree/main/app/examples/planner)

### Isochrone maps

An example implementation of dynamic isochrone maps using minotor in the browser.

[Demo](https://www.minotor.dev/#isochrones) | [Code](https://github.com/aubryio/minotor.dev/tree/main/app/examples/isochrones)

A more complete isochrone map showcase can be found on [isochrone.ch](https://isochrone.ch).

## Features

- GTFS feed parsing (standard and extended)
- Virtual transfer generation — add missing walking transfers between nearby stops
- Geographic and textual stop search
- **Point queries** — earliest-arrival journey from an origin to a destination at a given time
- **Range queries** — all Pareto-optimal journeys within a departure-time window
- Isochrone computation — earliest arrival times / fastest routes to every reachable stop

### Tested GTFS feeds

| Feed                                                                                       | Parsing time | Timetable size for a day (compressed) |
| ------------------------------------------------------------------------------------------ | ------------ | ------------------------------------- |
| [Swiss GTFS feed](https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020) | ~2 minutes   | 20 MB (5 MB)                          |

## Get started

### Installation

`npm i minotor`

### TypeScript API

#### GTFS feed parsing (Node.js only)

```ts
import { GtfsParser, extendedGtfsProfile } from 'minotor/parser';

const parser = new GtfsParser('gtfs-feed.zip', extendedGtfsProfile);
const timetable = await parser.parseTimetable(new Date());
const stopsIndex = await parser.parseStops();
```

Times are represented at the minute level (16-bit integers). Parsing can take a few minutes for large feeds.

#### Timetable format and trip transfers

Timetable format **2** uses dense numeric trip and stop-occurrence IDs, with compact typed-array transfer indexes at runtime. Old timetable binaries must be regenerated with the current parser; they are rejected with a regeneration message. Stop-index binaries are unchanged. IDs are local to one generated timetable and must not be persisted across regenerations.

Trip-specific type-1 connections waive the fallback transfer buffer but do not simulate held departures. Type-2 connections replace the generic minimum with their declared interval, including zero; longer intervals cannot be bypassed through a generic platform transfer. Type-4 continuations stay in the same boarding round, including at stops without public pickup or drop-off. Times remain minute-based.

Preprocessing groups trips by stop sequence and pickup/drop-off pattern, then splits overtaking trips into ordered routes. Routing retains separate boarding contexts where incoming trips have different transfer rules and explicitly scans trips with outgoing rules. Immutable predecessor links preserve useful feeder journeys even when they do not win a stop's earliest-arrival label. Range queries reuse bounds only between matching boarding contexts and trip suffixes.

#### Virtual transfers

Many GTFS feeds only partially populate `transfers.txt`, so nearby stops in different stations end up with no walking connection and can't be used as an interchange. Pass a `TransferGenerator` to the parser to synthesize the missing walking transfers before the timetable is serialized. The built-in `StraightLineTransferGenerator` connects nearby stops that aren't already linked, estimating walking time from the straight-line distance:

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

See [`src/transfers/README.md`](src/transfers/README.md) for the tuning options and how to plug in a custom generator (e.g. an external pedestrian routing engine).

#### Stop search (browser or Node.js)

```ts
// Text search (supports partial names and accents)
const results = stopsIndex.findStopsByName('Fribourg');

// Lookup by source ID from the GTFS feed
const platform = stopsIndex.findStopBySourceStopId('8504100:0:2');

// Nearest stops within 500 m
const nearby = stopsIndex.findStopsByLocation(46.803, 7.151, 5, 0.5);
```

#### Point query (browser or Node.js)

Find the earliest-arrival journey departing at a specific time:

```ts
import { Query, Router } from 'minotor';

const router = new Router(timetable, stopsIndex);

const [origin] = stopsIndex.findStopsByName('Fribourg/Freiburg');
const [destination] = stopsIndex.findStopsByName('Moléson-sur-Gruyères');

const result = router.route(
  new Query.Builder()
    .from(origin.id)
    .to(destination.id)
    .departureTime(8 * 60 + 30) // 08:30 in minutes from midnight
    .maxTransfers(3)
    .build(),
);

const route = result.bestRoute(); // Route | undefined

// Earliest arrival at any individual stop (useful for isochrone computation)
const arrival = result.arrivalAt(stop.id); // { arrival: Time, legNumber: number } | undefined
// Earliest arrival at every reachable stop
const arrivals = result.arrivals();
```

Query options:

| Option                  | Default   | Description                                                            |
| ----------------------- | --------- | ---------------------------------------------------------------------- |
| `maxTransfers`          | `5`       | Maximum number of transfers                                            |
| `minTransferTime`       | `2 min`   | Fallback minimum transfer time                                         |
| `maxDuration`           | unlimited | Maximum total journey duration from the query departure time           |
| `maxInitialWaitingTime` | unlimited | Maximum wait for the first vehicle after arriving at the boarding stop |
| `transportModes`        | all       | Restrict to a subset of `RouteTypes` values                            |

#### Range query (browser or Node.js)

Find the departure/arrival frontier within a departure-time window. A journey dominates another when it departs no earlier and arrives no later, with at least one strict improvement. Transfer count is constrained by `maxTransfers`, not optimized as a separate criterion.

Destinations supplied to `.to(...)` are alternatives: the router finds the earliest arrival at **any** of them, including equivalent platforms. A journey to one destination can dominate a journey to another. Routing continues after the first discovery if a better arrival is possible; slower destinations need not be reached. Omit destinations for full-network exploration. Result lookups and post-query transfer limits operate only on retained data.

```ts
import { RangeQuery, Router } from 'minotor';

const rangeResult = router.rangeRoute(
  new RangeQuery.Builder()
    .from(origin.id)
    .to(destination.id)
    .departureTime(8 * 60) // window start: 08:00
    .lastDepartureTime(10 * 60) // window end:   10:00
    .maxTransfers(3)
    .build(),
);

console.log(rangeResult.size); // number of Pareto-optimal journeys

// Iterate runs latest-departure-first
for (const { departureTime, result } of rangeResult) {
  const route = result.bestRoute();
}

// Or pick a specific journey
const earliest = rangeResult.bestRoute(); // earliest arrival
const latest = rangeResult.latestDepartureRoute(); // latest possible departure
const fastest = rangeResult.fastestRoute(); // shortest travel duration
const all = rangeResult.routes(); // lazy iterator, earliest-departure-first

// Earliest arrival at every reachable stop
const arrivals = rangeResult.arrivals();
// Shortest duration to every reachable stop
const durations = rangeResult.shortestDurations();
```

### CLI Usage

Parse GTFS data for today and save the timetable and stops index to `/tmp`:

`minotor parse-gtfs gtfs_feed.zip`

Additionally generate virtual walking transfers between stops within 1 km:

`minotor parse-gtfs gtfs_feed.zip --virtual-transfers-radius 1000`

Start the interactive REPL:

`minotor repl`

Search stops:

`minotor> .find moleson`

Query a route:

`minotor> .route from fribourg to moleson at 08:00`

Run `minotor parse-gtfs -h` and `minotor repl -h` for all available options.

## Development

### Requirements

A working [Node.js](https://nodejs.org) environment and `protoc`:

Ubuntu: `apt install -y protobuf-compiler` |
Fedora: `dnf install -y protobuf-compiler` |
macOS: `brew install protobuf`

### Debugging

The REPL (`minotor repl`) exposes several inspection tools.

#### Inspect a stop

`minotor> .inspect stop <id|sourceId|name>`

#### Inspect a route

`minotor> .inspect route <id>`

#### Plot the routing graph

Requires [Graphviz](https://graphviz.org):

Ubuntu: `apt install -y graphviz` |
Fedora: `dnf install -y graphviz` |
macOS: `brew install graphviz`

```
minotor> .plot from <station> to <station> at <HH:mm> [with <N> transfers] [to <graph.dot>]
dot -Ksfdp -Tsvg graph.dot -o graph.svg
```

### Scripts

| Script          | Description                                   |
| --------------- | --------------------------------------------- |
| `build`         | Compile to `dist/`                            |
| `clean`         | Remove `dist/`                                |
| `test`          | Run unit tests                                |
| `test:coverage` | Unit tests with coverage                      |
| `e2e`           | End-to-end tests against real Swiss GTFS data |
| `perf`          | Performance benchmark (not in CI)             |
| `lint`          | ESLint with auto-fix                          |
| `format`        | Prettier with auto-fix                        |
| `spell:check`   | Spell checker                                 |
| `cz`            | Generate a Commitizen commit message          |

Releases are automatically published to npm on merge to `main` (stable) or `beta` (pre-release).

## Roadmap and requests

The project is under active development. Use GitHub issues for bug reports and feature requests. For custom development, consulting, integrations, or other inquiries, feel free to contact [the author](https://aubry.io/).

### Timetable binary loading

`Timetable.fromData()` expects a binary generated by a compatible Minotor serializer. It checks the format version and decodes the data, then loads canonical transfer rules without repeating sorting, deduplication, or semantic validation. Constructing a timetable from raw rules still validates and normalizes them. The binary format is unchanged.
