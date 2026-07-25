import assert from 'node:assert';
import { describe, it } from 'node:test';

import { standardGtfsProfile } from '../standard.js';

describe('The standard GTFS feed parser', () => {
  it('derives sibling transfers by default', () => {
    assert.strictEqual(standardGtfsProfile.deriveSiblingTransfers, true);
  });
});
