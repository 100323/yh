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
