export type StopId = string;
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
  name: string;
  lat?: Latitude;
  lon?: Longitude;
  children: StopId[];
  parent?: StopId;
  locationType: LocationType;
  platform?: Platform;
};

export type StopsMap = Map<StopId, Stop>;
