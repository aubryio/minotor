import fs from 'fs';

import { Plotter, Result, Route } from '../router.js';

export const prettyPrintRoute = (route: Route): void => {
  route.legs.forEach((leg, index) => {
    const fromStop = `From: ${leg.from.name}${leg.from.platform ? ' (Pl. ' + leg.from.platform + ')' : ''}`;
    const toStop = `To: ${leg.to.name}${leg.to.platform ? ' (Pl. ' + leg.to.platform + ')' : ''}`;
    let transferDetails = '';
    let travelDetails = '';

    if ('minTransferTime' in leg) {
      transferDetails = `Minimum Transfer Time: ${leg.minTransferTime?.toString()}`;
    }
    if ('route' in leg && 'departureTime' in leg && 'arrivalTime' in leg) {
      travelDetails = `Route: ${leg.route.type} ${leg.route.name}, Departure: ${leg.departureTime.toString()}, Arrival: ${leg.arrivalTime.toString()}`;
    }

    console.log(`Leg ${index + 1}:`);
    console.log(`  ${fromStop}`);
    console.log(`  ${toStop}`);
    if (transferDetails) {
      console.log(`  ${transferDetails}`);
    }
    if (travelDetails) {
      console.log(`  ${travelDetails}`);
    }
    console.log('');
  });
};

export const plotGraphToDotFile = (result: Result, filePath: string): void => {
  const plotter = new Plotter(result);
  const dotContent = plotter.plotDotGraph();
  fs.writeFileSync(filePath, dotContent);
};
