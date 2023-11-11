import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foobar } from "../index.js";

describe("foobar()", () => {
  describe("given two positive integers", () => {
    const first = 1;
    const second = 2;

    describe("when called", () => {
      it("returns the sum of them multiplied by 3", () => {
        assert.equal(foobar(first, second), 9);
      });
    });
  });
});
