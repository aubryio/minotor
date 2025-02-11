# Minotor

![GitHub Workflow Status](https://github.com/aubryio/minotor/actions/workflows/minotor.yml/badge.svg?branch=main)

A lightweight and easy to use public transit router primarily targeting client-side usage for research, data visualization, dynamic web and mobile apps.

Unlike most transit planners out there, **minotor** can store all the transit data for a given day in memory on the client, allowing for fast runtime queries using only local data.
This is particularly useful for highly dynamic applications or complex visualizations for research purposes where the user needs to query the data in real-time.
Privacy-conscious applications where the user does not want to share their location data with a server can also benefit from this model.

The transit router and the stops index of **minotor** can run in the browser, on react-native or in a Node.js environment.
Transit data (GTFS) parsing runs on Node.js, and the resulting data is serialized as a protobuf binary that can be loaded from the router.

## Features

- GTFS feed parsing (standard and extended)
- Geographic and textual stops search
- Transit routing from origin(s) stop(s) to destination(s) stop(s) at a given time
- Computation for arrival times at all stops given a destination and start time

### Tested GTFS feeds

| Feed                                                                                       | Parsing time | Timetable Size for a Day (Compressed) |
| ------------------------------------------------------------------------------------------ | ------------ | ------------------------------------- |
| [Swiss GTFS feed](https://data.opentransportdata.swiss/en/dataset/timetable-2025-gtfs2020) | ~2 minutes   | 44 MB (9MB)                           |

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

Note that this operation can take a few minutes for large GTFS feeds.
See comments in the code for more options.

#### Stop Search (Browser or Node.js)

```
const origins = stopsIndex.findStopsByName('Fribourg');
const destinations = stopsIndex.findStopsByName('Moles'); // Partial name search
```

Query stops by ID:

`const stopFromId = stopsIndex.findStopById('8592374:0:A');`

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

### Debugging

It is possible to plot the router graph to debug the algorithm:

`minotor repl`

`minotor> .plot from <stationId> to <stationId> at <HH:mm> [with <N> transfers] [to <graph.dot>]`

`dot -Ksfdp -Tsvg graph.dot -o graph.svg `

### Build

Make sure you have a working node setup as well as a protobuf compiler.

- `build`: builds the project in the `dist/` directory
- `clean`: removes the `dist/` directory

### Tests

- `test`: runs test runner
- `test:coverage`: runs test runner with coverage reports

### Formatting & linting

- `lint`: ESLint with automatic fixing
- `format`: Prettier with automatic fixing
- `spell:check`: Spell checker

### Releasing

- `cz`: generates a valid git commit message (See [Commitizen](https://github.com/commitizen/cz-cli))

Releases are automatically published to npm when merging to the `main` or `beta` (pre-release) branch.

## Roadmap

The project is under active development. Here are some of the features that are planned:

- Documentation website and examples
- Load multiple GTFS archives at once
- Range queries
- Transfer preferences
- Support for exporting a calendar range as opposed to a single day
- Support for GTFS `frequencies.txt`
- Support for more types of transfers
- NeTEx support
- RT-GTFS Support
