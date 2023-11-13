import assert from 'node:assert';
import { describe, it } from 'node:test';

import { hash } from '../utils.js';

describe('Utility hash function', () => {
  it('should be consistent for a given input', () => {
    assert.equal(hash('stationA'), 'lswfbh');
  });
  it('should not collide with different input', () => {
    assert.equal(hash('stationA') === hash('stationB'), false);
  });
});
