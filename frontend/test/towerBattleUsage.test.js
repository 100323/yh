import assert from "node:assert/strict";
import test from "node:test";
import {
  getEffectiveTowerBattleLimit,
  getShanghaiBusinessDate,
  getTowerBattleUsage,
  releaseTowerBattleSlot,
  reserveTowerBattleSlot,
} from "../src/utils/batch/towerConfig.js";

const createStorage = () => ({
  values: new Map(),
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  },
  setItem(key, value) {
    this.values.set(key, String(value));
  },
});

test("Shanghai business date changes at UTC 16:00", () => {
  assert.equal(getShanghaiBusinessDate(new Date("2026-08-31T15:59:59Z")), "2026-08-31");
  assert.equal(getShanghaiBusinessDate(new Date("2026-08-31T16:00:00Z")), "2026-09-01");
});

test("tower battle usage is isolated by account, task type, and business date", () => {
  const storage = createStorage();
  const options = { storage, businessDate: "2026-09-01" };

  assert.equal(reserveTowerBattleSlot("account-1", "TOWER", options), true);
  assert.equal(getTowerBattleUsage("account-1", "TOWER", options), 1);
  assert.equal(getTowerBattleUsage("account-2", "TOWER", options), 0);
  assert.equal(getTowerBattleUsage("account-1", "WEIRD_TOWER", options), 0);
  assert.equal(getTowerBattleUsage("account-1", "TOWER", { storage, businessDate: "2026-09-02" }), 0);
});

test("tower battle reservations stop at ten and failed reservations can be released", () => {
  const storage = createStorage();
  const options = { storage, businessDate: "2026-09-01" };

  for (let index = 0; index < 10; index += 1) {
    assert.equal(reserveTowerBattleSlot("account-1", "TOWER", options), true);
  }
  assert.equal(reserveTowerBattleSlot("account-1", "TOWER", options), false);
  assert.equal(releaseTowerBattleSlot("account-1", "TOWER", options), true);
  assert.equal(reserveTowerBattleSlot("account-1", "TOWER", options), true);
  assert.equal(getTowerBattleUsage("account-1", "TOWER", options), 10);
});

test("effective tower limit honors configuration, remaining usage, and hard cap", () => {
  assert.equal(getEffectiveTowerBattleLimit(20, 12), 10);
  assert.equal(getEffectiveTowerBattleLimit(6, 12), 6);
  assert.equal(getEffectiveTowerBattleLimit(20, 3), 3);
  assert.equal(getEffectiveTowerBattleLimit(20, -1), 0);
});
