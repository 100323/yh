import assert from "node:assert/strict";
import test from "node:test";

import { getTowerActId } from "../src/utils/towerActId.js";

test("getTowerActId returns the Friday-based activity id for the current cycle", () => {
  assert.equal(getTowerActId(new Date("2026-07-01T12:00:00+08:00")), 2606261);
  assert.equal(getTowerActId(new Date("2026-07-03T00:00:00+08:00")), 2607031);
  assert.equal(getTowerActId(new Date("2026-07-09T23:59:59+08:00")), 2607031);
});
