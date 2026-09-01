import test from 'node:test';
import assert from 'node:assert/strict';
import GameClient from '../src/utils/gameClient.js';

function createCarClient(carDataMap) {
  const client = new GameClient('dummy-token');
  const calls = [];
  client.__calls = calls;
  client.sendWithPromise = async (cmd, params = {}) => {
    calls.push({ cmd, params, at: Date.now() });
    if (cmd === 'car_getrolecar') {
      return { roleCar: { carDataMap } };
    }
    if (cmd === 'car_getmemberhelpingcnt') {
      return { memberHelpingCntMap: {} };
    }
    if (cmd === 'legion_getinfo') {
      return { info: { members: {} } };
    }
    if (cmd === 'car_send') {
      return { ok: true, carId: params.carId };
    }
    if (cmd === 'car_refresh') {
      return { car: { ...(params || {}), color: 4, refreshCount: 1, rewards: [] } };
    }
    throw new Error(`unexpected command: ${cmd}`);
  };
  return client;
}

test('smartSendCar applies fixed commandDelayMs between car_send calls', async () => {
  const client = createCarClient({
    'car-1': { sendAt: 0, color: 4, rewards: [] },
    'car-2': { sendAt: 0, color: 4, rewards: [] },
  });

  const sleepCalls = [];
  client.__sleep = async (ms) => {
    sleepCalls.push(ms);
  };

  const result = await client.smartSendCar({
    minCarColor: 0,
    maxRefreshAttempts: 0,
    fallbackSendWhenStuck: true,
    commandDelayMs: 123,
  });

  assert.equal(result.sendCount, 2);
  assert.equal(result.sendFailureCount, 0);
  assert.equal(result.appliedRules.commandDelayMs, 123);
  assert.ok(sleepCalls.length >= 1, `expected sleep calls, got ${sleepCalls.length}`);
  assert.ok(sleepCalls.every((ms) => ms === 123), `unexpected sleep values: ${JSON.stringify(sleepCalls)}`);

  const sendCalls = client.__calls.filter((item) => item.cmd === 'car_send');
  assert.equal(sendCalls.length, 2);
});

test('smartSendCar defaults commandDelayMs to 1000ms when omitted', async () => {
  const client = createCarClient({
    'car-1': { sendAt: 0, color: 4, rewards: [] },
  });

  const sleepCalls = [];
  client.__sleep = async (ms) => {
    sleepCalls.push(ms);
  };

  const result = await client.smartSendCar({
    minCarColor: 0,
    maxRefreshAttempts: 0,
    fallbackSendWhenStuck: true,
  });

  assert.equal(result.sendCount, 1);
  assert.equal(result.appliedRules.commandDelayMs, 1000);
  // single car still waits before send after helper setup / previous command
  assert.ok(sleepCalls.includes(1000));
});
