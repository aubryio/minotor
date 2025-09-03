import fs from 'fs';

import { Plotter, Result } from '../router.js';

/**
 * Plots the graph of the result to a dot file.
 * @param result - The result object to plot.
 * @param filePath - The path where the dot file will be saved.
 */
export const plotGraphToDotFile = (result: Result, filePath: string): void => {
  const plotter = new Plotter(result);
  const dotContent = plotter.plotDotGraph();
  fs.writeFileSync(filePath, dotContent);
};
