import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import GameClient from '../src/utils/gameClient.js';
import {
  createEgressDescriptor,
  withSchedulerObservationContext,
} from '../src/observability/schedulerObservationCore.js';

const FORBIDDEN_EVENT_KEYS = new Set([
  'params',
  'packet',
  'encoded',
  'response',
  'body',
  'token',
  'proxy',
  'raw',
  'stack',
]);

function createObserver(overrides = {}) {
  const sent = [];
  const settled = [];
  return {
    sent,
    settled,
    observer: {
      observeCommandSent(event) {
        sent.push(event);
      },
      observeCommandSettled(event) {
        settled.push(event);
      },
      ...overrides,
    },
  };
}

function createOpenClient(observer, options = {}) {
  const frames = [];
  const client = new GameClient('super-secret-token', {
    commandObserver: observer,
    ...options,
  });
  client.connected = true;
  client.ws = {
    readyState: 1,
    send(frame) {
      frames.push(frame);
    },
  };
  return { client, frames };
}

function assertEventIsSafe(event) {
  for (const key of Object.keys(event)) {
    assert.equal(FORBIDDEN_EVENT_KEYS.has(key), false, `forbidden event key: ${key}`);
  }
  assert.equal(JSON.stringify(event).includes('super-secret-token'), false);
}

test('successful request emits one sent and one success without changing the response', async () => {
  const capture = createObserver();
  const { client, frames } = createOpenClient(capture.observer);
  client.accountId = 41;
  client.ack = 17;

  const resultPromise = withSchedulerObservationContext({
    source: 'daily',
    taskType: 'sweep',
    runId: 'run-41',
    accountId: 41,
    batchTaskId: 8,
    executionLane: 'account:41',
    queueWaitMs: 12,
    token: 'must-not-leak',
    params: { secret: true },
  }, () => client.sendWithPromise('role_getroleinfo', { private: 'value' }));

  const response = { role: { roleId: 41 } };
  try {
    assert.equal(frames.length, 1);
    assert.equal(capture.sent.length, 1);
    const sent = capture.sent[0];
    assert.equal(sent.command, 'role_getroleinfo');
    assert.equal(sent.commandClass, 'game');
    assert.equal(sent.seq, 1);
    assert.equal(sent.ack, 17);
    assert.equal(sent.accountId, 41);
    assert.equal(sent.runId, 'run-41');
    assert.equal(sent.egressType, 'direct');
    assert.equal(sent.egressKey, 'direct');
    assertEventIsSafe(sent);

    // Observer-owned event objects must not be the mutable pending metadata.
    sent.command = 'tampered';
    sent.seq = 999;

    client._handleMessage({ resp: 1, seq: 18, cmd: 'role_getroleinforesp', body: response });
    assert.strictEqual(await resultPromise, response);
    assert.equal(capture.settled.length, 1);
    assert.equal(capture.settled[0].command, 'role_getroleinfo');
    assert.equal(capture.settled[0].seq, 1);
    assert.equal(capture.settled[0].ack, 17);
    assert.equal(capture.settled[0].outcome, 'success');
    assertEventIsSafe(capture.settled[0]);
  } finally {
    if (client.promises.size > 0) client._rejectPendingPromises(new Error('test cleanup'));
    await resultPromise.catch(() => {});
  }
});

test('timeout settles once and a late response cannot settle it again', async () => {
  const capture = createObserver();
  let pendingWasRegisteredBeforeSend = false;
  const { client } = createOpenClient(capture.observer);
  client.ws.send = () => {
    const pending = client.promises.get('1');
    pendingWasRegisteredBeforeSend = Boolean(pending?.timer);
  };

  const startedAt = Date.now();
  const resultPromise = client.sendWithPromise('tower_getinfo', { secret: true }, 20);
  const timeoutError = await resultPromise.catch((error) => error);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(pendingWasRegisteredBeforeSend, true);
  assert.ok(timeoutError instanceof Error);
  assert.match(timeoutError.message, /tower_getinfo/);
  assert.ok(elapsedMs >= 15, `timeout fired too early: ${elapsedMs}ms`);
  assert.equal(capture.sent.length, 1);
  assert.equal(capture.settled.length, 1);
  assert.equal(capture.settled[0].outcome, 'timeout');
  assert.equal(capture.settled[0].seq, 1);
  assertEventIsSafe(capture.settled[0]);

  client._handleMessage({ resp: 1, seq: 2, cmd: 'tower_getinforesp', body: { late: true } });
  assert.equal(capture.settled.length, 1);
});

test('disconnect rejects every pending request with the original Error and settles each once', async () => {
  const capture = createObserver();
  const { client } = createOpenClient(capture.observer);
  const first = client.sendWithPromise('tower_getinfo', {});
  const second = client.sendWithPromise('arena_getareatarget', {});
  const disconnectError = new Error('socket gone');

  client._rejectPendingPromises(disconnectError);
  const [firstError, secondError] = await Promise.all([
    first.catch((error) => error),
    second.catch((error) => error),
  ]);

  assert.strictEqual(firstError, disconnectError);
  assert.strictEqual(secondError, disconnectError);
  assert.equal(client.promises.size, 0);
  assert.equal(capture.sent.length, 2);
  assert.equal(capture.settled.length, 2);
  assert.deepEqual(capture.settled.map((event) => event.outcome), ['disconnected', 'disconnected']);
  assert.deepEqual(capture.settled.map((event) => event.seq), [1, 2]);

  client._rejectPendingPromises(disconnectError);
  assert.equal(capture.settled.length, 2);
});

test('business error preserves the rejected Error and exposes only numeric classification codes', async () => {
  const capture = createObserver();
  let rejectedError = null;
  const { client } = createOpenClient(capture.observer);
  const resultPromise = client.sendWithPromise('genie_sweep', { secret: true });
  resultPromise.catch((error) => {
    rejectedError = error;
  });

  client._handleMessage({
    resp: 1,
    seq: 2,
    cmd: 'genie_sweepresp',
    code: 200400,
    hint: 'too fast',
    body: { responseSecret: true },
  });

  const caught = await resultPromise.catch((error) => error);
  assert.strictEqual(caught, rejectedError);
  assert.equal(caught.code, 200400);
  assert.equal(capture.settled.length, 1);
  assert.equal(capture.settled[0].outcome, 'error');
  assert.equal(capture.settled[0].code, 200400);
  assert.equal(capture.settled[0].errorCode, 200400);
  assert.equal(Number.isInteger(capture.settled[0].errorCode), true);
  assertEventIsSafe(capture.settled[0]);
  assert.equal('response' in capture.settled[0], false);
  assert.equal('body' in capture.settled[0], false);
});

test('egress reflects the proxy actually installed on the websocket and never leaks proxy details', async () => {
  const proxy = {
    protocol: 'http',
    host: 'secret.proxy.internal',
    port: 2345,
    username: 'proxy-user',
    password: 'proxy-pass',
  };
  const capture = createObserver();
  const client = new GameClient('super-secret-token', {
    commandObserver: capture.observer,
    proxy,
    heartbeatInterval: 60_000,
  });
  let socketOptions;
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.send = () => {};
  socket.close = () => {};
  client.createWebSocket = (_url, options) => {
    socketOptions = options;
    queueMicrotask(() => socket.emit('open'));
    return socket;
  };
  client._startHeartbeat = () => {};

  const originalLog = console.log;
  console.log = () => {};
  try {
    await client.connect();
  } finally {
    console.log = originalLog;
  }
  assert.ok(socketOptions.agent);

  const seq = client.send('role_getroleinfo', { private: true });
  assert.equal(seq, 1);
  assert.equal(capture.sent.length, 1);
  assert.equal(capture.settled.length, 1);
  const expected = createEgressDescriptor(proxy);
  assert.deepEqual(
    { type: capture.sent[0].egressType, key: capture.sent[0].egressKey },
    expected,
  );
  const serialized = JSON.stringify([...capture.sent, ...capture.settled]);
  for (const secret of ['secret.proxy.internal', '2345', 'proxy-user', 'proxy-pass']) {
    assert.equal(serialized.includes(secret), false, `proxy secret leaked: ${secret}`);
  }

  const directCapture = createObserver();
  const { client: directClient } = createOpenClient(directCapture.observer, { proxy });
  directClient.send('role_getroleinfo', {});
  assert.equal(directCapture.sent[0].egressType, 'direct');
  assert.equal(directCapture.sent[0].egressKey, 'direct');
  client.disconnect();
});

test('system and game fire-and-forget commands settle at the known send boundary', () => {
  const capture = createObserver();
  const { client, frames } = createOpenClient(capture.observer);

  const systemSeq = client.send('_sys/ack', {});
  const gameSeq = client.send('role_getroleinfo', {});

  assert.deepEqual([systemSeq, gameSeq], [1, 2]);
  assert.equal(frames.length, 2);
  assert.deepEqual(capture.sent.map((event) => event.commandClass), ['system', 'game']);
  assert.deepEqual(capture.settled.map((event) => event.outcome), ['success', 'success']);
  assert.deepEqual(capture.settled.map((event) => event.seq), [1, 2]);
});

test('synchronous websocket send failure is observed but rethrows the identical Error', () => {
  const capture = createObserver();
  const { client } = createOpenClient(capture.observer);
  const sendError = new Error('send exploded');
  let sendCalls = 0;
  client.ws.send = () => {
    sendCalls += 1;
    throw sendError;
  };

  let caught;
  try {
    client.send('role_getroleinfo', {});
  } catch (error) {
    caught = error;
  }

  assert.strictEqual(caught, sendError);
  assert.equal(sendCalls, 1);
  assert.equal(capture.sent.length, 0);
  assert.equal(capture.settled.length, 1);
  assert.equal(capture.settled[0].outcome, 'error');
  assertEventIsSafe(capture.settled[0]);
});

test('observer getters, throws, rejected promises, and hostile thenables cannot affect commands', async () => {
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    let settledCalls = 0;
    const observer = {
      get observeCommandSent() {
        throw new Error('hostile getter');
      },
      observeCommandSettled() {
        settledCalls += 1;
        if (settledCalls === 1) return Promise.reject(new Error('rejected observer'));
        return {
          then(_resolve, reject) {
            reject(new Error('hostile thenable'));
            return this;
          },
        };
      },
    };
    const { client, frames } = createOpenClient(observer);

    assert.equal(client.send('role_getroleinfo', {}), 1);
    assert.equal(client.send('_sys/ack', {}), 2);
    assert.equal(frames.length, 2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
