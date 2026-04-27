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
```

Query options:

| Option                  | Default   | Description                                                            |
| ----------------------- | --------- | ---------------------------------------------------------------------- |
| `maxTransfers`          | `5`       | Maximum number of transfers                                            |
| `minTransferTime`       | `2 min`   | Fallback minimum transfer time                                         |
| `maxInitialWaitingTime` | unlimited | Maximum wait for the first vehicle after arriving at the boarding stop |
| `transportModes`        | all       | Restrict to a subset of GTFS route types                               |

#### Range query (browser or Node.js)

Find all Pareto-optimal journeys within a departure-time window — no journey in the result is dominated by another (i.e. no journey departs later _and_ arrives earlier):

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
const all = rangeResult.getRoutes(); // all routes, earliest-departure-first

// Earliest arrival at every reachable stop across all runs
const arrivals = rangeResult.allEarliestArrivals(); // Map<StopId, Arrival>
const durations = rangeResult.allShortestDurations(); // Map<StopId, DurationArrival>
```

### CLI Usage

Parse GTFS data for today and save the timetable and stops index to `/tmp`:

`minotor parse-gtfs gtfs_feed.zip`

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
