import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { transferDuration, TransferTypes } from '../transfer.js';

describe('transferDuration', () => {
  for (const type of Object.values(TransferTypes)) {
    it(`honors explicit zero and positive minimums for type ${type}`, () => {
      for (const minTransferTime of [0, 3, 12]) {
        assert.equal(
          transferDuration({ destination: 1, type, minTransferTime }, 7),
          minTransferTime,
        );
      }
    });
    it(`uses the type default for type ${type}`, () => {
      assert.equal(
        transferDuration({ destination: 1, type }, 7),
        type === TransferTypes.GUARANTEED || type === TransferTypes.IN_SEAT
          ? 0
          : 7,
      );
    });
  }
});
