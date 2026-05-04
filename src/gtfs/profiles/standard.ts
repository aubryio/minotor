import { RouteTypes } from '../../timetable/timetable.js';
import { GtfsProfile } from '../parser.js';

export const standardGtfsProfile: GtfsProfile = {
  routeTypeParser: (routeType: number) => {
    switch (routeType) {
      case 0:
        return RouteTypes.TRAM;
      case 1:
        return RouteTypes.SUBWAY;
      case 2:
        return RouteTypes.RAIL;
      case 3:
        return RouteTypes.BUS;
      case 4:
        return RouteTypes.FERRY;
      case 5:
        return RouteTypes.CABLE_TRAM;
      case 6:
        return RouteTypes.AERIAL_LIFT;
      case 7:
        return RouteTypes.FUNICULAR;
      case 11:
        return RouteTypes.TROLLEYBUS;
      case 12:
        return RouteTypes.MONORAIL;
      default:
        return undefined;
    }
  },
};
