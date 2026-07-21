import { Stop, StopId } from '../stops/stops.js';
import { StopsIndex } from '../stops/stopsIndex.js';
import { Transfer } from '../timetable/timetable.js';

/**
 * A map of directed transfers keyed by their origin stop id. Structurally
 * identical to the parser's `TransfersMap`, so generated transfers can be
 * merged directly into a feed's parsed transfers.
 */
export type GeneratedTransfers = Map<StopId, Transfer[]>;

/**
 * Strategy for synthesizing additional stop-to-stop (walking) transfers that
 * are missing from a transit feed.
 *
 * It runs as a pre-processing step between parsing and serialization and is
 * therefore agnostic of the source parser: it depends only on the generic
 * stops model, not on any GTFS-specific types. This keeps the door open for
 * smarter generators (e.g. an OSM pedestrian router) and for reuse across
 * parsers.
 */
export interface TransferGenerator {
  /**
   * Generates candidate directed transfers between nearby stops.
   *
   * Implementations connect each origin to its nearby stops as directed edges
   * (emit `origin -> neighbor`; the reverse edge is produced when the neighbor
   * is itself visited as an origin). The caller deduplicates the result against
   * the transfers already present in the feed and only keeps the relevant ones,
   * so an implementation can freely emit a transfer for every nearby pair
   * without tracking what already exists.
   *
   * Implementations may be synchronous (return the transfers directly) or
   * asynchronous (return a promise, e.g. when calling out to a routing engine);
   * the caller awaits the result either way.
   *
   * @param originStops - Stops to generate outgoing transfers from.
   * @param stops - Index of all stops, providing coordinates and geo search.
   * @returns Candidate transfers to merge into the feed's transfers.
   */
  generate(
    originStops: Stop[],
    stops: StopsIndex,
  ): GeneratedTransfers | Promise<GeneratedTransfers>;
}
