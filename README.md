# Minotor

![GitHub Workflow Status](https://github.com/aubryio/minotor/actions/workflows/minotor.yml/badge.svg?branch=main)

[Documentation and examples](https://minotor.dev)

A lightweight and easy to use public transit router primarily targeting client-side usage for research, data visualization, dynamic web and mobile apps.

Unlike most transit planners out there, **minotor** can store all the transit data for a given day in memory on the client, allowing for fast runtime queries using only local data.
This is particularly useful for highly dynamic applications or complex visualizations for research purposes where the user needs to query the data in real-time.
Privacy-conscious applications where the user does not want to share their location data with a server can also benefit from this model.

The transit router and the stops index of **minotor** can run in the browser, on react-native or in a Node.js environment.
Transit data (GTFS) parsing runs on Node.js, and the resulting data is serialized as a protobuf binary that can be loaded from the router.

Minotor routing algorithm is mostly based on RAPTOR. See [Round-Based Public Transit Routing, D. Delling et al. 2012](https://www.microsoft.com/en-us/research/wp-content/uploads/2012/01/raptor_alenex.pdf).

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
- Geographic and textual stops search
- Transit routing from origin(s) stop(s) to destination(s) stop(s) at a given time
- Computation for arrival times at all stops given a destination and start time

### Tested GTFS feeds

| Feed                                                                                       | Parsing time | Timetable Size for a Day (Compressed) |
| ------------------------------------------------------------------------------------------ | ------------ | ------------------------------------- |
| [Swiss GTFS feed](https://data.opentransportdata.swiss/en/dataset/timetable-2025-gtfs2020) | ~2 minutes   | 20 MB (5MB)                           |

## Get started

### Installation

`npm i minotor`

### Typescript API Usage example

#### GTFS Feed parsing (Node.js only)

```
import { GtfsParser, chGtfsProfile } from 'minotor/parser';

const parser = new GtfsParser('gtfs-feed.zip', chGtfsProfile);
const { timetable, stopsIndex } = await parser.parse(new Date());
```

Note that times are only represented at the minute level so they can fit on 16 bits.

This operation can take a few minutes for large GTFS feeds.

#### Stop Search (Browser or Node.js)

```
const origins = stopsIndex.findStopsByName('Fribourg');
const destinations = stopsIndex.findStopsByName('Moles'); // Partial name search
```

Query stops by ID:

`const stopFromId = stopsIndex.findStopBySourceId('8592374:0:A');`

Or by location:

`const nearbyStops = stopsIndex.findStopsByLocation(46.80314924, 7.1510478, 5, 0.5);`

#### Routing (Browser or Node.js)

```
import { Query, Router, Time } from 'minotor';

const router = new Router(timetable, stopsIndex);

const query = new Query.Builder()
  .from('Parent8504100')
  .to('Parent8504748')
  .departureTime(Time.fromHMS(8,0,0))
  .maxTransfers(5)
  .build();
const result = router.route(query);
```

Get the route between origin and the closest destination (optionally provide another destination stop than the one in the query, the resulting route will be found if it's reachable before the first query destination reached).

`const bestRoute = result.bestRoute();`

Get the arrival time to any stop (optionally provide the max number of transfers if you're interested in a lower one than the one provided in the query).
This time will be correct for any stop reachable before the first query destination reached.

`const arrivalTime = result.arrivalAt(toStop.id);`

### CLI Usage example

Parse GTFS data for a day and output the timetable and stops index (`minotor parse-gtfs -h` for more options):

`minotor parse-gtfs gtfs_feed.zip`

Note that this operation can take a few minutes for very large GTFS feeds.
Without extra parameters it saves the timetable and stopsIndex for the current day in `/tmp` as binary protobufs.

Run the REPL to query the router or the stop index (`minotor repl -h` for more options):

`minotor repl`

Search stops (`minotor> .find -h for more options`):

`minotor> .find moleson`

Query routes (`minotor> .route -h for more options`):

`minotor> .route from fribourg to moleson at 08:00`

## Development

### Requirements

Make sure you have a working [node](https://nodejs.org) environment.

`protoc` also needs to be available on the build system.

Ubuntu: `sudo apt install -y protobuf-compiler` |
Fedora: `sudo dnf install -y protobuf-compiler` |
MacOS: `brew install protobuf`

### Debugging

It is possible to plot the router graph to debug the algorithm:

Using the npm script `repl`, or `minotor repl` if the project is installed globally.

`minotor> .plot from <stationId> to <stationId> at <HH:mm> [with <N> transfers] [to <graph.dot>]`

`dot -Ksfdp -Tsvg graph.dot -o graph.svg `

### Build

- `build`: builds the project in the `dist/` directory
- `clean`: removes the `dist/` directory

### Unit Tests

- `test`: runs unit tests
- `test:coverage`: runs unit test runner with coverage reports

### End-to-End Tests

- `e2e`: runs end-to-end tests, using a real data from a day in the Swiss GTFS dataset
- `perf`: runs a basic performance test, using a real data from a day in the Swiss GTFS dataset

Note that performance tests are not included in the CI pipeline and must be run manually.

### Formatting & linting

- `lint`: ESLint with automatic fixing
- `format`: Prettier with automatic fixing
- `spell:check`: Spell checker

### Releasing

- `cz`: generates a valid git commit message (See [Commitizen](https://github.com/commitizen/cz-cli))

Releases are automatically published to npm when merging to the `main` or `beta` (pre-release) branch.

## Roadmap

The project is under active development. Here are some of the features that are planned (ordered by priority).
Contact [the author](https://aubry.io/) for feature requests.

- Route/Trip-based transfer support
- Arrive-by support
- Range queries
- Transfer preferences
- Route/Trip metadata support
- Routing filters based on metadata e.g. bicycle support, wheelchair access
- More routing options (slower/faster transfers, etc.)
- Improved stop search (sort by stop importance)
- Real-time timetable support (tripId/routeId mapping)
- Support for exporting a calendar range as opposed to a single day
- Support for GTFS `frequencies.txt`
- Load multiple GTFS archives at once
- NeTEx support
