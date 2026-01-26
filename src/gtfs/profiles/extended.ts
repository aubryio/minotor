import { RouteType } from '../../timetable/timetable.js';
import { GtfsProfile } from '../parser.js';
import { Maybe } from '../utils.js';

/**
 * Parses the extended GTFS route type and returns the corresponding basic GTFS route type.
 * Based on the GTFS Extended Route Types specification.
 * @see https://developers.google.com/transit/gtfs/reference/extended-route-types
 * @param routeType The extended route type to parse.
 * @returns The corresponding GTFS route type, or undefined if the route type is not recognized.
 */
const routeTypeParser = (routeType: number): Maybe<RouteType> => {
  switch (routeType) {
    // Railway Service (100-199)
    case 100: // Railway Service
    case 101: // High Speed Rail Service (TGV, ICE, Eurostar)
    case 102: // Long Distance Trains (InterCity/EuroCity)
    case 103: // Inter Regional Rail Service (InterRegio, Cross County Rail)
    case 104: // Car Transport Rail Service
    case 105: // Sleeper Rail Service (GNER Sleeper)
    case 106: // Regional Rail Service (TER, Regionalzug)
    case 107: // Tourist Railway Service (Romney, Hythe & Dymchurch)
    case 108: // Rail Shuttle (Within Complex) (Gatwick Shuttle, Sky Line)
    case 109: // Suburban Railway (S-Bahn, RER, S-tog)
    case 110: // Replacement Rail Service
    case 111: // Special Rail Service
    case 112: // Lorry Transport Rail Service
    case 113: // All Rail Services
    case 114: // Cross-Country Rail Service
    case 115: // Vehicle Transport Rail Service
    case 116: // Rack and Pinion Railway (Rochers de Naye, Dolderbahn)
    case 117: // Additional Rail Service
      return 'RAIL';

    // Coach Service (200-299)
    case 200: // Coach Service
    case 201: // International Coach Service (EuroLine, Touring)
    case 202: // National Coach Service (National Express)
    case 203: // Shuttle Coach Service (Roissy Bus)
    case 204: // Regional Coach Service
    case 205: // Special Coach Service
    case 206: // Sightseeing Coach Service
    case 207: // Tourist Coach Service
    case 208: // Commuter Coach Service
    case 209: // All Coach Services
      return 'BUS';

    // Urban Railway Service (400-499)
    case 400: // Urban Railway Service
    case 401: // Metro Service (Métro de Paris)
    case 402: // Underground Service (London Underground, U-Bahn)
    case 403: // Urban Railway Service
    case 404: // All Urban Railway Services
      return 'SUBWAY';

    case 405: // Monorail
      return 'MONORAIL';

    // Bus Service (700-799)
    case 700: // Bus Service
    case 701: // Regional Bus Service (Eastbourne-Maidstone)
    case 702: // Express Bus Service (X19 Wokingham-Heathrow)
    case 703: // Stopping Bus Service
    case 704: // Local Bus Service
    case 705: // Night Bus Service
    case 706: // Post Bus Service
    case 707: // Special Needs Bus
    case 708: // Mobility Bus Service
    case 709: // Mobility Bus for Registered Disabled
    case 710: // Sightseeing Bus
    case 711: // Shuttle Bus (747 Heathrow-Gatwick)
    case 712: // School Bus
    case 713: // School and Public Service Bus
    case 714: // Rail Replacement Bus Service
    case 715: // Demand and Response Bus Service
    case 716: // All Bus Services
      return 'BUS';

    // Trolleybus Service (800-899)
    case 800: // Trolleybus Service
      return 'TROLLEYBUS';

    // Tram Service (900-999)
    case 900: // Tram Service
    case 901: // City Tram Service
    case 902: // Local Tram Service (Munich, Brussels, Croydon)
    case 903: // Regional Tram Service
    case 904: // Sightseeing Tram Service (Blackpool Seafront)
    case 905: // Shuttle Tram Service
    case 906: // All Tram Services
      return 'TRAM';

    // Water Transport Service (1000-1099)
    case 1000: // Water Transport Service
      return 'FERRY';

    // Air Service (1100-1199)
    case 1100: // Air Service
      return undefined;

    // Ferry Service (1200-1299)
    case 1200: // Ferry Service
      return 'FERRY';

    // Aerial Lift Service (1300-1399)
    case 1300: // Aerial Lift Service (Telefèric de Montjuïc, Roosevelt Island Tramway)
    case 1301: // Telecabin Service
    case 1302: // Cable Car Service
    case 1304: // Chair Lift Service
    case 1305: // Drag Lift Service
    case 1306: // Small Telecabin Service
    case 1307: // All Telecabin Services
      return 'AERIAL_LIFT';

    case 1303: // Elevator Service (Ascenseur, Aufzug)
    case 1400: // Funicular Service (Rigiblick)
      return 'FUNICULAR';

    // Taxi Service (1500-1599)
    case 1500: // Taxi Service
    case 1502: // Water Taxi Service
    case 1503: // Rail Taxi Service
    case 1504: // Bike Taxi Service
    case 1505: // Licensed Taxi Service
    case 1506: // Private Hire Service Vehicle
    case 1507: // All Taxi Services
      return undefined;

    case 1501: // Communal Taxi Service (Marshrutka, dolmuş)
      return 'BUS';

    // Miscellaneous Service (1700-1799)
    case 1700: // Miscellaneous Service / Unknown mode
      return undefined;

    case 1702: // Horse-drawn Carriage
      return 'BUS';

    default:
      return undefined;
  }
};

export const extendedGtfsProfile: GtfsProfile = {
  routeTypeParser,
};
