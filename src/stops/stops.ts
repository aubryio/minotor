// A stop ID defined in the source of the transit data (e.g. GTFS)
export type SourceStopId = string;
// An internally indexed StopId
export type StopId = number;

export type Platform = string;
export type Latitude = number;
export type Longitude = number;

export type LocationType =
  | 'SIMPLE_STOP_OR_PLATFORM'
  | 'STATION'
  | 'ENTRANCE_EXIT'
  | 'GENERIC_NODE'
  | 'BOARDING_AREA';

export type Stop = {
  id: StopId;
  sourceStopId: SourceStopId;
  name: string;
  lat?: Latitude;
  lon?: Longitude;
  children: StopId[];
  parent?: StopId;
  locationType: LocationType;
  platform?: Platform;
};

/**
 * Mapping internal StopIds to Stop objects.
 */
export type StopsMap = Map<StopId, Stop>;
/**
 * Mapping source stopIds to internal stopIds;
 */
export type SourceStopsMap = Map<SourceStopId, StopId>;
