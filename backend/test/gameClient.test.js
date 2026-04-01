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
