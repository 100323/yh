import test from 'node:test';
import assert from 'node:assert/strict';
import GameClient from '../src/utils/gameClient.js';

test('rejects pending promises when websocket closes/disconnects', async () => {
  const client = new GameClient('dummy-token');

  let rejectedError = null;
  client.promises.set('1', {
    timer: setTimeout(() => {}, 10000),
    reject: (error) => {
      rejectedError = error;
    },
    resolve: () => {
      throw new Error('should not resolve');
    },
    cmd: 'role_getroleinfo',
    seq: 1
  });

  client._rejectPendingPromises(new Error('WebSocket连接已断开(1006)'));

  assert.equal(client.promises.size, 0);
  assert.ok(rejectedError instanceof Error);
  assert.match(rejectedError.message, /WebSocket连接已断开/);
});

test('attaches raw response metadata to rejected command errors', async () => {
  const client = new GameClient('dummy-token');

  const rejected = new Promise((resolve) => {
    client.promises.set('7', {
      timer: setTimeout(() => {}, 10000),
      reject: resolve,
      resolve: () => {
        throw new Error('should not resolve');
      },
      cmd: 'legacy_beginhangup',
      seq: 7,
    });
  });

  client._handleMessage({
    seq: 8,
    resp: 7,
    cmd: 'legacy_beginhangupresp',
    code: 200020,
    hint: '出了点小问题，请尝试重启游戏解决～',
    body: { roleLegacy: { hangUpBeginTime: 0 } },
  });

  const error = await rejected;
  assert.ok(error instanceof Error);
  assert.equal(error.message, '出了点小问题，请尝试重启游戏解决～');
  assert.equal(error.cmd, 'legacy_beginhangupresp');
  assert.equal(error.code, 200020);
  assert.equal(error.hint, '出了点小问题，请尝试重启游戏解决～');
  assert.deepEqual(error.body, { roleLegacy: { hangUpBeginTime: 0 } });
  assert.equal(error.raw?.resp, 7);
});

test('reopenLegacyHangup polls legacy info until hangUpBeginTime appears', async () => {
  const client = new GameClient('dummy-token');
  const getInfoCalls = [];
  let getInfoCount = 0;

  client.getLegacyInfo = async () => {
    getInfoCount += 1;
    getInfoCalls.push(getInfoCount);
    if (getInfoCount === 1) {
      return { roleLegacy: { hangUpBeginTime: 0, scheduleId: 4 } };
    }
    if (getInfoCount === 2) {
      return { roleLegacy: { hangUpBeginTime: 0, scheduleId: 4 } };
    }
    return { roleLegacy: { hangUpBeginTime: 1775830554033, scheduleId: 4 } };
  };

  client.beginLegacyHangup = async () => ({ roleLegacy: { hangUpBeginTime: 0 } });

  const result = await client.reopenLegacyHangup({ verifyAttempts: 3, verifyDelayMs: 0 });

  assert.equal(result.hangUpBeginTime, 1775830554033);
  assert.equal(getInfoCalls.length, 3);
  assert.equal(result.verificationSnapshots.at(-1)?.hangUpBeginTime, 1775830554033);
});

test('genieDailySweep skips a single unavailable kingdom and continues remaining work', async () => {
  const client = new GameClient('dummy-token');
  const sweepCalls = [];
  let ticketCalls = 0;

  client.getRoleInfo = async () => ({ role: { statisticsTime: {} } });
  client.sendWithPromise = async (cmd, params) => {
    if (cmd === 'genie_sweep') {
      sweepCalls.push(params.genieId);
      if (params.genieId === 2) {
        const error = new Error('condition not met');
        error.code = 3300060;
        throw error;
      }
      return { ok: true, genieId: params.genieId };
    }

    if (cmd === 'genie_buysweep') {
      ticketCalls += 1;
      if (ticketCalls > 1) {
        const error = new Error('ticket limit');
        error.code = 3300050;
        throw error;
      }
      return { ok: true };
    }

    throw new Error(`unexpected command: ${cmd}`);
  };

  const result = await client.genieDailySweep({
    commandDelayMs: 0,
    sweepDelayMs: 0,
    ticketDelayMs: 0,
  });

  assert.deepEqual(sweepCalls, [1, 2, 3, 4]);
  assert.equal(result.sweptCount, 3);
  assert.equal(result.claimedTickets, 1);
  assert.equal(result.sweepResults[1].skipped, true);
  assert.equal(result.sweepResults[1].reason, 'condition not met');
  assert.equal(ticketCalls, 2);
});

test('genieDailySweep retries transient too-fast sweep failures', async () => {
  const client = new GameClient('dummy-token');
  let firstGenieAttempts = 0;

  client.getRoleInfo = async () => ({
    role: {
      statisticsTime: {
        'genie:daily:free:2': Math.floor(Date.now() / 1000),
        'genie:daily:free:3': Math.floor(Date.now() / 1000),
        'genie:daily:free:4': Math.floor(Date.now() / 1000),
      },
    },
  });

  client.sendWithPromise = async (cmd, params) => {
    if (cmd === 'genie_sweep') {
      firstGenieAttempts += 1;
      if (firstGenieAttempts < 3) {
        const error = new Error('too fast');
        error.code = 200400;
        throw error;
      }
      return { ok: true, genieId: params.genieId };
    }

    if (cmd === 'genie_buysweep') {
      const error = new Error('ticket limit');
      error.code = 3300050;
      throw error;
    }

    throw new Error(`unexpected command: ${cmd}`);
  };

  const result = await client.genieDailySweep({
    commandDelayMs: 0,
    sweepDelayMs: 0,
    ticketDelayMs: 0,
    retryDelayMs: 0,
  });

  assert.equal(firstGenieAttempts, 3);
  assert.equal(result.sweptCount, 1);
  assert.equal(result.sweepResults[0].success, true);
});
