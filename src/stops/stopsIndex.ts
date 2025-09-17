import { BinaryReader, BinaryWriter } from '@bufbuild/protobuf/wire';
import { around } from 'geokdbush';
import KDTree from 'kdbush';
import { addAll, createIndex, search, SearchResult } from 'slimsearch';

import { generateAccentVariants } from './i18n.js';
import { deserializeStopsMap, serializeStopsMap } from './io.js';
import { StopsMap as ProtoStopsMap } from './proto/stops.js';
import { SourceStopId, SourceStopsMap, Stop, StopId } from './stops.js';

type StopPoint = { id: StopId; lat: number; lon: number };

/**
 * The StopMap class provides functionality to search for public transport stops
 * by name or geographic location. It leverages text search and geospatial indexing
 * to efficiently find stops based on user queries.
 */
export class StopsIndex {
  private readonly stops: Stop[];
  private readonly sourceStopsMap: SourceStopsMap;
  private readonly textIndex;
  private readonly geoIndex: KDTree;
  private readonly stopPoints: StopPoint[];

  constructor(stops: Stop[]) {
    this.stops = stops;
    this.sourceStopsMap = new Map<SourceStopId, StopId>();
    const stopsSet = new Map<StopId, { id: StopId; name: string }>();
    this.stopPoints = [];
    for (let id = 0; id < stops.length; id++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const stop = stops[id]!;

      this.sourceStopsMap.set(stop.sourceStopId, id);

      const effectiveStopId = stop.parent ?? id;
      if (!stopsSet.has(effectiveStopId)) {
        stopsSet.set(effectiveStopId, {
          id: effectiveStopId,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          name: stop.parent ? this.stops[stop.parent]!.name : stop.name,
        });
      }

      if (stop.lat && stop.lon) {
        this.stopPoints.push({
          id: id,
          lat: stop.lat,
          lon: stop.lon,
        });
      }
    }
    this.textIndex = createIndex({
      fields: ['name'],
      storeFields: ['id'],
      searchOptions: { prefix: true, fuzzy: 0.2 },
      processTerm: generateAccentVariants,
    });
    const stopsArray = Array.from(stopsSet.values());
    addAll(this.textIndex, stopsArray);
    this.geoIndex = new KDTree(this.stopPoints.length);
    for (let i = 0; i < this.stopPoints.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { lat, lon } = this.stopPoints[i]!;
      this.geoIndex.add(lon, lat);
    }
    this.geoIndex.finish();
  }

  /**
   * Deserializes a binary representation of the stops.
   *
   * @param data - The binary data to deserialize.
   * @returns The deserialized StopFinder.
   */
  static fromData(data: Uint8Array): StopsIndex {
    const reader = new BinaryReader(data);
    const protoStopsMap = ProtoStopsMap.decode(reader);

    return new StopsIndex(deserializeStopsMap(protoStopsMap));
  }

  /**
   * Serializes the stops into a binary protobuf.
   *
   * @returns The serialized binary data.
   */
  serialize(): Uint8Array {
    const protoStopsMap: ProtoStopsMap = serializeStopsMap(this.stops);

    const writer = new BinaryWriter();
    ProtoStopsMap.encode(protoStopsMap, writer);
    return writer.finish();
  }

  /**
   * Returns the number of stops in the index.
   *
   * @returns The total number of stops.
   */
  size(): number {
    return this.stops.length;
  }

  /**
   * Finds stops by their name using a text search.
   *
   * @param query - The name or partial name of the stop to search for.
   * @param maxResults - The maximum number of results to return (default is 5).
   * @returns An array of Stop objects that match the search query.
   */
  findStopsByName(query: string, maxResults = 5): Stop[] {
    const results = search(this.textIndex, query).map(
      (result: SearchResult) => this.stops[result.id as number] as Stop,
    );
    return results.slice(0, maxResults);
  }

  /**
   * Finds stops by their geographic location using latitude and longitude.
   *
   * @param lat - The latitude of the location to search near.
   * @param lon - The longitude of the location to search near.
   * @param maxResults - The maximum number of results to return (default is 10).
   * @param radius - The search radius in kilometers (default is 0.5).
   * @returns An array of Stop objects that are closest to the specified location.
   */
  findStopsByLocation(
    lat: number,
    lon: number,
    maxResults = 5,
    radius = 0.5,
  ): Stop[] {
    const nearestStops = around(
      this.geoIndex,
      lon,
      lat,
      maxResults,
      radius,
    ).map((id) => {
      const stopPoint = this.stopPoints[id as number] as StopPoint;
      return this.stops[stopPoint.id] as Stop;
    });
    return nearestStops;
  }

  /**
   * Finds a stop by its internal ID.
   *
   * @param id - The internal ID of the stop to search for.
   * @returns The Stop object that matches the specified ID, or undefined if not found.
   */
  findStopById(id: StopId): Stop | undefined {
    return this.stops[id];
  }

  /**
   * Finds a stop by its ID in the transit data source (e.g. GTFS).
   *
   * @param id - The source ID of the stop to search for.
   * @returns The Stop object that matches the specified ID, or undefined if not found.
   */
  findStopBySourceStopId(sourceStopId: SourceStopId): Stop | undefined {
    const stopId = this.sourceStopsMap.get(sourceStopId);
    if (stopId === undefined) {
      return;
    }
    return this.findStopById(stopId);
  }

  /**
   * Find ids of all sibling stops.
   */
  equivalentStops(sourceId: SourceStopId): Stop[] {
    const id = this.sourceStopsMap.get(sourceId);
    if (id === undefined) {
      return [];
    }
    const stop = this.stops[id];
    if (!stop) {
      return [];
    }
    const equivalentStops = stop.parent
      ? (this.stops[stop.parent]?.children ?? [])
      : stop.children;
    return Array.from(new Set([id, ...equivalentStops])).map(
      (stopId) => this.stops[stopId] as Stop,
    );
  }
}
