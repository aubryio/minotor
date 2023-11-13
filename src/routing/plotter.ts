import { StopId } from '../stops/stops.js';
import { Result } from './result.js';
import { TripLeg } from './router.js';

export class Plotter {
  private result: Result;

  constructor(result: Result) {
    this.result = result;
  }

  /**
   * Plots the path three as a DOT for debugging purposes.
   *
   * @returns A string representing the DOT graph of the path tree.
   */
  plotDotGraph(): string {
    const earliestArrivalsPerRound: Map<StopId, TripLeg>[] =
      this.result.earliestArrivalsPerRound;

    const dotParts: string[] = [
      'digraph PathTree {',
      '  graph [overlap=false];',
      '  node [shape=ellipse style=filled fillcolor=lightgrey];',
    ];
    earliestArrivalsPerRound.forEach((arrivalsInRound, round) => {
      arrivalsInRound.forEach((tripLeg: TripLeg) => {
        const { origin, leg } = tripLeg;
        if (!leg) return; // Skip if leg is undefined
        const fromStop = this.result['stopsIndex'].findStopById(leg.from.id);
        const toStop = this.result['stopsIndex'].findStopById(leg.to.id);
        const originStop = this.result['stopsIndex'].findStopById(origin);

        if (fromStop && toStop && originStop) {
          const fromName = fromStop.platform
            ? `${fromStop.name} (Pl. ${fromStop.platform})`
            : fromStop.name;
          const toName = toStop.platform
            ? `${toStop.name} (Pl. ${toStop.platform})`
            : toStop.name;
          const originName = originStop.platform
            ? `${originStop.name} (Pl. ${originStop.platform})`
            : originStop.name;
          const isVehicle = 'route' in leg;
          const routeLabelContent = isVehicle
            ? `${leg.route.name}\n${leg.departureTime.toString()} - ${leg.arrivalTime.toString()}`
            : leg.minTransferTime
              ? leg.minTransferTime.toString()
              : '';
          const intermediateNode = `IntermediateNode${fromStop.id}_${toStop.id}`;
          const lineColor = isVehicle ? '' : ', color="red", fontcolor="red"';
          const labelColor = isVehicle ? '' : ' fontcolor="red"';

          dotParts.push(
            `  "${fromName} (Origin: ${originName}) [R${round}]\n(${fromStop.id})" -> "${intermediateNode}" [shape=point${lineColor}];`,
          );
          dotParts.push(
            `  "${intermediateNode}" [label="${routeLabelContent}" shape=rect style=filled fillcolor=white${labelColor} border=0];`,
          );
          dotParts.push(
            `  "${intermediateNode}" -> "${toName} (Origin: ${originName}) [R${round}]\n(${toStop.id})" [${lineColor.replace(', ', '')}];`,
          );
        }
      });
    });

    dotParts.push('}');
    return dotParts.join('\n');
  }
}
