import assert from 'node:assert/strict';
import { it } from 'node:test';

import { RoundLabels } from '../roundLabels.js';

it('keeps ordinary and zero-context labels independent and clears both', () => {
  const frontier = new RoundLabels(2);
  const ordinary = { readyAt: 20, edge: { stopId: 1, arrival: 20 } };
  const conditional = {
    readyAt: 10,
    edge: {
      routeId: 0,
      tripIndex: 0,
      stopIndex: 0,
      hopOffStopIndex: 1,
      arrival: 10,
      predecessor: ordinary.edge,
    },
  };
  frontier.set(1, ordinary);
  frontier.setConditional(1, 0, conditional);
  assert.equal(frontier.ordinary[1], ordinary);
  assert.equal(frontier.conditional.get(1)?.get(0), conditional);
  assert.deepEqual([...frontier.markedStops], [1]);
  frontier.clear();
  assert.equal(frontier.ordinary[1], undefined);
  assert.equal(frontier.conditional.size, 0);
  assert.equal(frontier.markedStops.size, 0);
});
