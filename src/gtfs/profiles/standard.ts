import { GtfsProfile } from '../parser.js';

export const standardProfile: GtfsProfile = {
  routeTypeParser: (routeType: number) => {
    switch (routeType) {
      case 0:
        return 'TRAM';
      case 1:
        return 'SUBWAY';
      case 2:
        return 'RAIL';
      case 3:
        return 'BUS';
      case 4:
        return 'FERRY';
      case 5:
        return 'CABLE_TRAM';
      case 6:
        return 'AERIAL_LIFT';
      case 7:
        return 'FUNICULAR';
      case 11:
        return 'TROLLEYBUS';
      case 12:
        return 'MONORAIL';
      default:
        return undefined;
    }
  },
};
