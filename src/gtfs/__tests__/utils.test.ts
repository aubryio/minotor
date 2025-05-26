import assert from 'node:assert';
import { describe, it } from 'node:test';

import { hashIds } from '../utils.js';

describe('Utility hashIds function', () => {
  it('should be consistent for a given input', () => {
    assert.equal(hashIds([1, 2, 3]), hashIds([1, 2, 3]));
  });
  it('should not collide with different input', () => {
    assert.notEqual(hashIds([1, 2, 3]), hashIds([4, 5, 6]));
  });
});
