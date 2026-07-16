import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OBSERVATION_OUTCOMES,
  SchedulerObservationAggregator,
  attributeSchedulerObservationCommandSent,
  classifyCommandFailure,
  createEgressDescriptor,
  getSchedulerObservationContext,
  runObservedTask,
  sanitizeObservationMessage,
  withSchedulerObservationContext,
} from '../src/observability/schedulerObservationCore.js';

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('scheduler observation context is null outside a scope and returned as a shallow copy', () => {
  assert.equal(getSchedulerObservationContext(), null);

  return withSchedulerObservationContext({ source: 'batch', accountId: 'account-1' }, () => {
    const first = getSchedulerObservationContext();
    first.source = 'mutated';
    first.extra = 'caller-only';

    assert.deepEqual(getSchedulerObservationContext(), {
      source: 'batch',
      accountId: 'account-1',
    });
  });
});

test('withSchedulerObservationContext merges nested scopes across awaits and restores the parent', async () => {
  await withSchedulerObservationContext({
    source: 'scheduler',
    accountId: 'account-1',
    queueWaitMs: 12,
    executionLane: 'lane-a',
    taskType: 'parent-task',
  }, async () => {
    await Promise.resolve();
    await nextTurn();
    assert.equal(getSchedulerObservationContext().taskType, 'parent-task');

    await withSchedulerObservationContext({ taskType: 'child-task' }, async () => {
      await Promise.resolve();
      await nextTurn();
      assert.deepEqual(getSchedulerObservationContext(), {
        source: 'scheduler',
        accountId: 'account-1',
        queueWaitMs: 12,
        executionLane: 'lane-a',
        taskType: 'child-task',
      });
    });

    assert.equal(getSchedulerObservationContext().taskType, 'parent-task');
  });

  assert.equal(getSchedulerObservationContext(), null);
});

test('withSchedulerObservationContext treats non-object context as empty', () => (
  withSchedulerObservationContext({ source: 'parent' }, () => (
    withSchedulerObservationContext(null, () => {
      assert.deepEqual(getSchedulerObservationContext(), { source: 'parent' });
    })
  ))
));

test('concurrent scheduler observation contexts remain isolated', async () => {
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });

  const first = withSchedulerObservationContext({ accountId: 'first' }, async () => {
    releaseSecond();
    await firstGate;
    return getSchedulerObservationContext();
  });
  const second = withSchedulerObservationContext({ accountId: 'second' }, async () => {
    await secondGate;
    releaseFirst();
    await Promise.resolve();
    return getSchedulerObservationContext();
  });

  assert.deepEqual(await Promise.all([first, second]), [
    { accountId: 'first' },
    { accountId: 'second' },
  ]);
});

test('context wrapper preserves synchronous and asynchronous settlement identity', async () => {
  const value = { ok: true };
  assert.strictEqual(withSchedulerObservationContext({}, () => value), value);

  const promise = Promise.resolve(value);
  assert.strictEqual(withSchedulerObservationContext({}, () => promise), promise);
  assert.strictEqual(await promise, value);

  const syncError = new Error('sync failure');
  assert.throws(
    () => withSchedulerObservationContext({}, () => { throw syncError; }),
    (error) => error === syncError,
  );

  const asyncError = new Error('async failure');
  const rejected = Promise.reject(asyncError);
  assert.strictEqual(withSchedulerObservationContext({}, () => rejected), rejected);
  await assert.rejects(rejected, (error) => error === asyncError);
});

test('runObservedTask creates protected run metadata visible to the executor', async () => {
  await withSchedulerObservationContext({
    source: 'scheduler',
    accountId: 'account-1',
    queueWaitMs: 18,
    executionLane: 'lane-a',
  }, async () => {
    const context = await runObservedTask({
      taskType: 'daily',
      runId: 'caller-run-id',
      startedAt: 'caller-started-at',
    }, async () => {
      await Promise.resolve();
      return getSchedulerObservationContext();
    });

    assert.equal(context.source, 'scheduler');
    assert.equal(context.accountId, 'account-1');
    assert.equal(context.queueWaitMs, 18);
    assert.equal(context.executionLane, 'lane-a');
    assert.equal(context.taskType, 'daily');
    assert.notEqual(context.runId, 'caller-run-id');
    assert.match(context.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(context.startedAt, 'caller-started-at');
    assert.equal(new Date(context.startedAt).toISOString(), context.startedAt);
  });
});

test('runObservedTask preserves return identity and observes success exactly once', async () => {
  const calls = [];
  const observer = { observeTaskSettled: (payload) => calls.push(payload) };
  const value = { result: 'ok' };
  assert.strictEqual(runObservedTask({ taskType: 'sync', source: 'manual' }, () => value, observer), value);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].taskType, 'sync');
  assert.equal(calls[0].source, 'manual');
  assert.equal(calls[0].outcome, 'success');
  assert.ok(Number.isFinite(calls[0].durationMs));
  assert.ok(calls[0].durationMs >= 0);
  assert.ok(calls[0].runId);
  assert.ok(calls[0].startedAt);

  const asyncCalls = [];
  const promise = Promise.resolve(value);
  const returned = runObservedTask(
    { taskType: 'async' },
    () => promise,
    { observeTaskSettled: (payload) => asyncCalls.push(payload) },
  );
  assert.strictEqual(returned, promise);
  assert.strictEqual(await returned, value);
  assert.equal(asyncCalls.length, 1);
  assert.equal(asyncCalls[0].outcome, 'success');
});

test('task-local sent command attribution is private, excludes system traffic, and isolates concurrent runs', async () => {
  const settlements = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = runObservedTask({ taskType: 'FIRST' }, async () => {
    assert.deepEqual(Object.getOwnPropertySymbols(getSchedulerObservationContext()), []);
    assert.equal(attributeSchedulerObservationCommandSent({ commandClass: 'game' }), true);
    await withSchedulerObservationContext({ source: 'nested' }, async () => {
      assert.equal(attributeSchedulerObservationCommandSent({ commandClass: 'game' }), true);
      assert.equal(attributeSchedulerObservationCommandSent({ commandClass: 'system' }), false);
    });
    await firstGate;
  }, { observeTaskSettled: (event) => settlements.push(event) });

  const second = runObservedTask({ taskType: 'SECOND' }, async () => {
    assert.equal(attributeSchedulerObservationCommandSent({ commandClass: 'game' }), true);
    releaseFirst();
  }, { observeTaskSettled: (event) => settlements.push(event) });

  await Promise.all([first, second]);
  assert.equal(attributeSchedulerObservationCommandSent({ commandClass: 'game' }), false);
  assert.deepEqual(
    settlements
      .map((event) => [event.taskType, event.attributedCommandCount])
      .sort(([left], [right]) => left.localeCompare(right)),
    [['FIRST', 2], ['SECOND', 1]],
  );
});

test('runObservedTask classifies failures once and preserves the original error', async () => {
  const cases = [
    { error: Object.assign(new Error('timed out'), { timeout: true }), outcome: 'timeout' },
    { error: Object.assign(new Error('socket closed'), { disconnected: true }), outcome: 'disconnected' },
    { error: Object.assign(new Error('too fast'), { code: 200400 }), outcome: 'rate_limited' },
    { error: new Error('ordinary failure'), outcome: 'error' },
  ];

  for (const { error, outcome } of cases) {
    const syncCalls = [];
    assert.throws(
      () => runObservedTask(
        { taskType: 'sync-failure' },
        () => { throw error; },
        { observeTaskSettled: (payload) => syncCalls.push(payload) },
      ),
      (caught) => caught === error,
    );
    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].outcome, outcome);
    assert.strictEqual(syncCalls[0].error, error);
    assert.ok(Number.isFinite(syncCalls[0].durationMs));
    assert.ok(syncCalls[0].durationMs >= 0);

    const asyncCalls = [];
    const rejected = Promise.reject(error);
    assert.strictEqual(runObservedTask(
      { taskType: 'async-failure' },
      () => rejected,
      { observeTaskSettled: (payload) => asyncCalls.push(payload) },
    ), rejected);
    await assert.rejects(rejected, (caught) => caught === error);
    assert.equal(asyncCalls.length, 1);
    assert.equal(asyncCalls[0].outcome, outcome);
    assert.strictEqual(asyncCalls[0].error, error);
  }
});

test('runObservedTask isolates missing and failing observers without unhandled rejections', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const value = { ok: true };
    assert.strictEqual(runObservedTask({}, () => value), value);
    assert.strictEqual(runObservedTask({}, () => value, {}), value);
    assert.strictEqual(runObservedTask({}, () => value, {
      observeTaskSettled() { throw new Error('observer sync failure'); },
    }), value);
    assert.strictEqual(runObservedTask({}, () => value, {
      observeTaskSettled() { return Promise.reject(new Error('observer async failure')); },
    }), value);

    const executorError = new Error('executor failure');
    assert.throws(
      () => runObservedTask({}, () => { throw executorError; }, {
        observeTaskSettled() { throw new Error('observer sync failure'); },
      }),
      (error) => error === executorError,
    );

    const rejected = Promise.reject(executorError);
    assert.strictEqual(runObservedTask({}, () => rejected, {
      observeTaskSettled() { return Promise.reject(new Error('observer async failure')); },
    }), rejected);
    await assert.rejects(rejected, (error) => error === executorError);
    await nextTurn();
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask isolates a throwing observer method getter for every settlement path', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const getterError = new Error('observer getter failure');
    const createObserver = () => ({
      get observeTaskSettled() { throw getterError; },
    });
    const value = { ok: true };

    assert.strictEqual(runObservedTask({}, () => value, createObserver()), value);

    const syncError = new Error('sync executor failure');
    assert.throws(
      () => runObservedTask({}, () => { throw syncError; }, createObserver()),
      (error) => error === syncError,
    );

    const asyncError = new Error('async executor failure');
    const rejected = Promise.reject(asyncError);
    assert.strictEqual(runObservedTask({}, () => rejected, createObserver()), rejected);
    await assert.rejects(rejected, (error) => error === asyncError);

    await nextTurn();
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask falls back to error when failure classification reads throw', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const createExecutorError = () => {
      const error = new Error('executor failure');
      const classificationError = new Error('classification getter failure');
      Object.defineProperty(error, 'timeout', {
        get() { throw classificationError; },
      });
      return error;
    };

    const syncError = createExecutorError();
    const syncCalls = [];
    assert.throws(
      () => runObservedTask({}, () => { throw syncError; }, {
        observeTaskSettled: (payload) => syncCalls.push(payload),
      }),
      (error) => error === syncError,
    );
    assert.equal(syncCalls.length, 1);
    assert.equal(syncCalls[0].outcome, 'error');
    assert.strictEqual(syncCalls[0].error, syncError);

    const asyncError = createExecutorError();
    const asyncCalls = [];
    const rejected = Promise.reject(asyncError);
    assert.strictEqual(runObservedTask({}, () => rejected, {
      observeTaskSettled: (payload) => asyncCalls.push(payload),
    }), rejected);
    await assert.rejects(rejected, (error) => error === asyncError);
    assert.equal(asyncCalls.length, 1);
    assert.equal(asyncCalls[0].outcome, 'error');
    assert.strictEqual(asyncCalls[0].error, asyncError);

    await nextTurn();
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask consumes a rejected chain returned by an observer thenable', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const chainError = new Error('observer chain failure');
    const observer = {
      observeTaskSettled() {
        return {
          then() { return Promise.reject(chainError); },
        };
      },
    };
    const value = { ok: true };
    assert.strictEqual(runObservedTask({}, () => value, observer), value);

    const promise = Promise.resolve(value);
    assert.strictEqual(runObservedTask({}, () => promise, observer), promise);
    assert.strictEqual(await promise, value);

    await nextTurn();
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask safely attaches observation to hostile executor thenables', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const getterError = new Error('executor then getter failure');
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'then', {
      get() { throw getterError; },
    });
    assert.strictEqual(runObservedTask({}, () => throwingGetter), throwingGetter);

    const callError = new Error('executor then call failure');
    const throwingCall = {
      then() { throw callError; },
    };
    assert.strictEqual(runObservedTask({}, () => throwingCall), throwingCall);

    const chainError = new Error('executor chain failure');
    const rejectedChain = {
      then() { return Promise.reject(chainError); },
    };
    assert.strictEqual(runObservedTask({}, () => rejectedChain), rejectedChain);

    await nextTurn();
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask observes only the first success from a repeating executor thenable', () => {
  const calls = [];
  const thenable = {
    then(resolve) {
      resolve('first');
      resolve('second');
      return Promise.resolve();
    },
  };

  assert.strictEqual(runObservedTask({}, () => thenable, {
    observeTaskSettled: (payload) => calls.push(payload),
  }), thenable);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, 'success');
});

test('runObservedTask keeps the first success when a thenable later rejects and resolves', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const originalError = new Error('late rejection');
    const calls = [];
    const thenable = {
      then(resolve, reject) {
        resolve('first');
        reject(originalError);
        resolve('third');
        return Promise.resolve();
      },
    };

    assert.strictEqual(runObservedTask({}, () => thenable, {
      observeTaskSettled: (payload) => calls.push(payload),
    }), thenable);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].outcome, 'success');

    await nextTurn();
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask keeps the first classified failure when a thenable later resolves', () => {
  const originalError = Object.assign(new Error('too fast'), { code: 200400 });
  const calls = [];
  const thenable = {
    then(resolve, reject) {
      reject(originalError);
      resolve('late success');
      return Promise.resolve();
    },
  };

  assert.strictEqual(runObservedTask({}, () => thenable, {
    observeTaskSettled: (payload) => calls.push(payload),
  }), thenable);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, 'rate_limited');
  assert.strictEqual(calls[0].error, originalError);
});

test('runObservedTask does not reopen settlement after the first observer call throws', () => {
  let observerCalls = 0;
  const thenable = {
    then(resolve) {
      resolve('first');
      resolve('second');
      return Promise.resolve();
    },
  };

  assert.strictEqual(runObservedTask({}, () => thenable, {
    observeTaskSettled() {
      observerCalls += 1;
      throw new Error('observer failure');
    },
  }), thenable);
  assert.equal(observerCalls, 1);
});

test('runObservedTask observes hostile then getter and call errors as failures', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const getterError = new Error('executor then getter failure');
    const throwingGetter = {};
    Object.defineProperty(throwingGetter, 'then', {
      get() { throw getterError; },
    });

    const getterCalls = [];
    assert.strictEqual(runObservedTask({}, () => throwingGetter, {
      observeTaskSettled: (payload) => getterCalls.push(payload),
    }), throwingGetter);
    assert.equal(getterCalls.length, 1);
    assert.equal(getterCalls[0].outcome, 'error');
    assert.strictEqual(getterCalls[0].error, getterError);

    const callError = new Error('executor then call failure');
    const throwingCall = {
      then() { throw callError; },
    };
    const callCalls = [];
    assert.strictEqual(runObservedTask({}, () => throwingCall, {
      observeTaskSettled: (payload) => callCalls.push(payload),
    }), throwingCall);
    assert.equal(callCalls.length, 1);
    assert.equal(callCalls[0].outcome, 'error');
    assert.strictEqual(callCalls[0].error, callError);

    await nextTurn();
    await nextTurn();
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask retains success when a thenable resolves before throwing', () => {
  const laterError = new Error('late then failure');
  const calls = [];
  const thenable = {
    then(resolve) {
      resolve('first');
      throw laterError;
    },
  };

  assert.strictEqual(runObservedTask({}, () => thenable, {
    observeTaskSettled: (payload) => calls.push(payload),
  }), thenable);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, 'success');
});

test('runObservedTask does not assimilate an executor thenable returned by its own then', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const calls = [];
    const thenable = {
      thenCalls: 0,
      then(resolve) {
        this.thenCalls += 1;
        resolve('settled');
        return this;
      },
    };

    assert.strictEqual(runObservedTask({}, () => thenable, {
      observeTaskSettled: (payload) => calls.push(payload),
    }), thenable);
    await nextTurn();
    await nextTurn();

    assert.equal(thenable.thenCalls, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].outcome, 'success');
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask does not assimilate an observer thenable returned by its own then', async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const observerThenable = {
      thenCalls: 0,
      then() {
        this.thenCalls += 1;
        return this;
      },
    };
    let observerCalls = 0;

    const value = { ok: true };
    assert.strictEqual(runObservedTask({}, () => value, {
      observeTaskSettled() {
        observerCalls += 1;
        return observerThenable;
      },
    }), value);
    await nextTurn();
    await nextTurn();

    assert.equal(observerCalls, 1);
    assert.equal(observerThenable.thenCalls, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('runObservedTask observes a non-function executor as a failed settlement', () => {
  const calls = [];
  let caught;
  try {
    runObservedTask({ taskType: 'invalid' }, null, {
      observeTaskSettled: (payload) => calls.push(payload),
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof TypeError);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, 'error');
  assert.strictEqual(calls[0].error, caught);
});

test('exports exactly the supported observation outcomes', () => {
  assert.deepEqual([...OBSERVATION_OUTCOMES], [
    'success',
    'ignored',
    'error',
    'timeout',
    'disconnected',
    'rate_limited',
    'sent',
  ]);
});

test('sanitizeObservationMessage removes secrets and caps the summary length', () => {
  const longEncoding = 'A'.repeat(96);
  const raw = [
    'failed\u0000\n',
    'https://game.example/path?token=query-secret&role=1',
    ' token=plain-secret',
    ' roleToken: "role-secret"',
    ' p=proxy-secret',
    ` encoded=${longEncoding}`,
    ' tail='.concat('z'.repeat(400)),
  ].join('');

  const result = sanitizeObservationMessage(raw);

  assert.ok(result.length <= 300);
  assert.equal(result.includes('\u0000'), false);
  assert.equal(result.includes('\n'), false);
  assert.equal(result.includes('query-secret'), false);
  assert.equal(result.includes('plain-secret'), false);
  assert.equal(result.includes('role-secret'), false);
  assert.equal(result.includes('proxy-secret'), false);
  assert.equal(result.includes(longEncoding), false);
  assert.match(result, /https:\/\/game\.example\/path/);
});

test('sanitizeObservationMessage honors a custom maximum and handles empty values', () => {
  assert.equal(sanitizeObservationMessage(null), '');
  assert.equal(sanitizeObservationMessage('123456789', 5), '12345');
  assert.equal(sanitizeObservationMessage('value', 0), '');
});

test('sanitizeObservationMessage removes escaped secrets and C1 controls without swallowing context', () => {
  const escapedPayload = 'prefix payload="{\\"token\\":\\"escaped-secret\\"}" suffix';
  const escapedQuote = 'before token="part1\\"part2-secret" after';

  const payloadResult = sanitizeObservationMessage(escapedPayload);
  const quoteResult = sanitizeObservationMessage(escapedQuote);
  const controlResult = sanitizeObservationMessage('left\u0085right');

  assert.equal(payloadResult.includes('escaped-secret'), false);
  assert.match(payloadResult, /prefix/);
  assert.match(payloadResult, /suffix/);
  assert.equal(quoteResult.includes('part2-secret'), false);
  assert.match(quoteResult, /before/);
  assert.match(quoteResult, /after/);
  assert.equal(controlResult, 'leftright');
});

test('sanitizeObservationMessage redacts unterminated sensitive values and complete URL queries', () => {
  const sensitiveCases = [
    ['token="unterminated-secret', 'unterminated-secret'],
    ["roleToken='unterminated-role", 'unterminated-role'],
    ['p="unterminated-proxy', 'unterminated-proxy'],
  ];

  for (const [input, secret] of sensitiveCases) {
    assert.equal(sanitizeObservationMessage(input).includes(secret), false);
  }

  assert.equal(
    sanitizeObservationMessage('https://game.example/path?foo="query-secret"'),
    'https://game.example/path',
  );
  assert.equal(
    sanitizeObservationMessage('//game.example/path?foo=query-secret'),
    '//game.example/path',
  );
  assert.equal(
    sanitizeObservationMessage('ordinary diagnostic text without assignments'),
    'ordinary diagnostic text without assignments',
  );
});

test('sanitizeObservationMessage fails closed for unterminated quoted values with separators', () => {
  const cases = [
    ['token="abc,still-secret', 'still-secret'],
    ['roleToken="abc;still-secret', 'still-secret'],
    ['p="abc]still-secret', 'still-secret'],
    ['token="abc&still-secret', 'still-secret'],
    ['roleToken="abc still-secret', 'still-secret'],
  ];

  for (const [input, secret] of cases) {
    const result = sanitizeObservationMessage(input);
    assert.equal(result.includes(secret), false);
    assert.match(result, /\[REDACTED\]/);
  }
});

test('sanitizeObservationMessage keeps structural characters inside closed sensitive quotes redacted', () => {
  const cases = [
    ['token="first,comma-secret"', 'comma-secret'],
    ["roleToken='first;semicolon-secret'", 'semicolon-secret'],
    ['p="first&amp-secret"', 'amp-secret'],
    ['token="first]bracket-secret"', 'bracket-secret'],
  ];

  for (const [input, secret] of cases) {
    const result = sanitizeObservationMessage(input);
    assert.equal(result.includes(secret), false);
    assert.match(result, /\[REDACTED\]/);
  }
});

test('sanitizeObservationMessage continues through chained secrets after an unterminated value', () => {
  const cases = [
    {
      input: 'token="token-secret, p="proxy-secret"',
      secrets: ['token-secret', 'proxy-secret'],
    },
    {
      input: "roleToken='role-secret; token='token-secret'",
      secrets: ['role-secret', 'token-secret'],
    },
    {
      input: String.raw`token="first-secret, roleToken=\"second-secret\"; p='third-secret'`,
      secrets: ['first-secret', 'second-secret', 'third-secret'],
    },
  ];

  for (const { input, secrets } of cases) {
    const result = sanitizeObservationMessage(input);
    for (const secret of secrets) assert.equal(result.includes(secret), false);
    assert.equal((result.match(/\[REDACTED\]/g) ?? []).length, secrets.length);
  }
});

test('sanitizeObservationMessage recognizes whitespace-separated chained quoted secrets', () => {
  const cases = [
    {
      input: 'token="token-secret p="proxy-secret"',
      secrets: ['token-secret', 'proxy-secret'],
    },
    {
      input: "roleToken='role-secret token='next-secret'",
      secrets: ['role-secret', 'next-secret'],
    },
  ];

  for (const { input, secrets } of cases) {
    const result = sanitizeObservationMessage(input);
    for (const secret of secrets) assert.equal(result.includes(secret), false);
    assert.equal((result.match(/\[REDACTED\]/g) ?? []).length, 2);
  }
});

test('sanitizeObservationMessage keeps closed values with assignment-like text as one redaction', () => {
  const cases = [
    {
      input: 'before token="ordinary, token=inside-text" after',
      expected: 'before token="[REDACTED]" after',
      secrets: ['ordinary', 'inside-text'],
    },
    {
      input: "before roleToken='ordinary; p=inside-text' after",
      expected: "before roleToken='[REDACTED]' after",
      secrets: ['ordinary', 'inside-text'],
    },
  ];

  for (const { input, expected, secrets } of cases) {
    const result = sanitizeObservationMessage(input);
    assert.equal(result, expected);
    assert.equal((result.match(/\[REDACTED\]/g) ?? []).length, 1);
    for (const secret of secrets) assert.equal(result.includes(secret), false);
  }
});

test('sanitizeObservationMessage redacts every prohibited observation field', () => {
  const cases = [
    ['params={password: short-secret}', ['short-secret']],
    ['responseBody={private: short-secret}', ['short-secret']],
    ['proxy=http://raw.proxy.local:8080', ['raw.proxy.local']],
    ['stack=Error: boom at full-sensitive-stack', ['boom', 'full-sensitive-stack']],
  ];

  for (const [input, secrets] of cases) {
    const result = sanitizeObservationMessage(input);
    assert.match(result, /\[REDACTED\]/);
    for (const secret of secrets) assert.equal(result.includes(secret), false);
  }

  const aggregator = new SchedulerObservationAggregator({ maxAnomalies: 10 });
  for (const [message] of cases) aggregator.recordAnomaly({ type: 'safety', message });
  const serialized = JSON.stringify(aggregator.takeSnapshot());

  for (const secret of ['short-secret', 'raw.proxy.local', 'boom', 'full-sensitive-stack']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('sanitizeObservationMessage fails closed for nested sensitive payload containers', () => {
  const messages = [
    'responseBody={"meta":{},"private":"nested-secret"}',
    'params={meta:{ok:true}, password: nested-secret}',
    'arguments=[[], "nested-secret"]',
    'body={"text":"}","private":"nested-secret"}',
  ];

  for (const message of messages) {
    const result = sanitizeObservationMessage(message);
    assert.match(result, /\[REDACTED\]/);
    assert.equal(result.includes('nested-secret'), false);
  }

  const aggregator = new SchedulerObservationAggregator({ maxAnomalies: messages.length });
  for (const message of messages) aggregator.recordAnomaly({ type: 'nested', message });
  const serialized = JSON.stringify(aggregator.takeSnapshot());

  assert.equal(serialized.includes('nested-secret'), false);
});

test('classifyCommandFailure recognizes structured and textual rate limits', () => {
  assert.equal(classifyCommandFailure({ code: 200400 }), 'rate_limited');
  assert.equal(
    classifyCommandFailure({ response: { data: { code: '12400000' } } }),
    'rate_limited',
  );
  assert.equal(
    classifyCommandFailure(new Error('操作过快，请稍后重试')),
    'rate_limited',
  );
});

test('classifyCommandFailure prioritizes timeout and disconnection hints', () => {
  const rateLimited = { code: 200400, message: '过于频繁' };

  assert.equal(
    classifyCommandFailure(rateLimited, { timeout: true, disconnected: true }),
    'timeout',
  );
  assert.equal(
    classifyCommandFailure(rateLimited, { disconnected: true }),
    'disconnected',
  );
  assert.equal(classifyCommandFailure(new Error('ordinary failure')), 'error');
});

test('createEgressDescriptor returns direct without a proxy', () => {
  assert.deepEqual(createEgressDescriptor(), { type: 'direct', key: 'direct' });
  assert.deepEqual(createEgressDescriptor(null), { type: 'direct', key: 'direct' });
});

test('createEgressDescriptor returns only a stable proxy fingerprint', () => {
  const proxy = {
    protocol: 'HTTPS:',
    host: 'Secret.Proxy.Example',
    port: '8443',
    username: 'private-user',
    password: 'private-password',
  };

  const first = createEgressDescriptor(proxy);
  const second = createEgressDescriptor({
    protocol: 'https',
    host: 'secret.proxy.example',
    port: 8443,
  });
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.equal(first.type, 'proxy');
  assert.match(first.key, /^proxy:[a-f0-9]{12}$/);
  assert.equal(serialized.includes('Secret.Proxy.Example'), false);
  assert.equal(serialized.includes('secret.proxy.example'), false);
  assert.equal(serialized.includes('private-user'), false);
  assert.equal(serialized.includes('private-password'), false);
});

test('SchedulerObservationAggregator separates command outcomes and totals counts', () => {
  const aggregator = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T08:09:42.000Z'),
  });

  aggregator.recordCommand({
    command: 'role:info:get',
    outcome: 'success',
    dimensions: { scheduler: 'regular' },
  });
  aggregator.recordCommand({
    command: 'role:info:get',
    outcome: 'rate_limited',
    dimensions: { scheduler: 'regular' },
  });

  const snapshot = aggregator.takeSnapshot();

  assert.equal(snapshot.commandMetrics.length, 2);
  assert.deepEqual(
    snapshot.commandMetrics.map((row) => row.outcome).sort(),
    ['rate_limited', 'success'],
  );
  assert.equal(snapshot.totals.commandCount, 2);
  assert.equal(snapshot.totals.rateLimitedCount, 1);
  assert.ok(snapshot.commandMetrics.every((row) => row.minute === '2026-07-15 08:09:00'));
});

test('recordCommand accumulates outcome counts and valid latency statistics', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  aggregator.recordCommand({ command: 'observe', outcome: 'error', latencyMs: 12.5 });
  aggregator.recordCommand({ command: 'observe', outcome: 'timeout', latencyMs: 0 });
  aggregator.recordCommand({ command: 'observe', outcome: 'disconnected', latencyMs: -1 });
  aggregator.recordCommand({ command: 'observe', outcome: 'rate_limited', latencyMs: Infinity });

  const rows = Object.fromEntries(
    aggregator.takeSnapshot().commandMetrics.map((row) => [row.outcome, row]),
  );

  assert.deepEqual(rows.error, {
    minute: '1970-01-01 00:00:00',
    dimensions: { command: 'observe' },
    outcome: 'error',
    commandCount: 1,
    errorCount: 1,
    timeoutCount: 0,
    disconnectedCount: 0,
    rateLimitedCount: 0,
    latencyCount: 1,
    latencySumMs: 12.5,
    latencyMaxMs: 12.5,
  });
  assert.equal(rows.timeout.timeoutCount, 1);
  assert.equal(rows.timeout.latencyCount, 1);
  assert.equal(rows.timeout.latencySumMs, 0);
  assert.equal(rows.disconnected.disconnectedCount, 1);
  assert.equal(rows.disconnected.latencyCount, 0);
  assert.equal(rows.disconnected.latencySumMs, 0);
  assert.equal(rows.rate_limited.rateLimitedCount, 1);
  assert.equal(rows.rate_limited.latencyCount, 0);
  assert.equal(rows.rate_limited.latencyMaxMs, 0);
});

test('recordTask normalizes empty and object dimensions without object key coercion', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  aggregator.recordTask({
    outcome: 'success',
    dimensions: { scheduler: null, task: { unsafe: 'object' } },
  });

  const snapshot = aggregator.takeSnapshot();
  assert.equal(snapshot.taskMetrics.length, 1);
  assert.equal(snapshot.taskMetrics[0].dimensions.scheduler, '');
  assert.equal(snapshot.taskMetrics[0].dimensions.task, 'UNATTRIBUTED');
  assert.equal(snapshot.taskMetrics[0].minute, '1970-01-01 00:00:00');
  assert.equal(snapshot.totals.taskCount, 1);
  assert.equal(JSON.stringify(snapshot).includes('[object Object]'), false);
});

test('dimension keys are normalized before sensitive matching and redaction wins collisions', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  aggregator.recordAnomaly({
    type: 'normalized-key',
    message: 'safe',
    dimensions: { 'token\u0000': 'dimension-secret' },
  });
  aggregator.recordAnomaly({
    type: 'collision',
    message: 'safe',
    dimensions: { 'to\u0000ken': 'alias-secret', token: 'direct-secret' },
  });

  const snapshot = aggregator.takeSnapshot();
  const serialized = JSON.stringify(snapshot);

  assert.deepEqual(snapshot.anomalies[0].dimensions, { token: '[REDACTED]' });
  assert.deepEqual(snapshot.anomalies[1].dimensions, { token: '[REDACTED]' });
  assert.equal(serialized.includes('dimension-secret'), false);
  assert.equal(serialized.includes('alias-secret'), false);
  assert.equal(serialized.includes('direct-secret'), false);
});

test('recordTask accumulates valid timing statistics and attributed command aliases', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  aggregator.recordTask({
    task: 'daily',
    outcome: 'success',
    durationMs: 25,
    queueWaitMs: 5,
    commandCount: '2.9',
  });
  aggregator.recordTask({
    task: 'daily',
    outcome: 'success',
    durationMs: -1,
    queueWaitMs: Infinity,
    attributedCommandCount: 3,
  });
  aggregator.recordTask({
    task: 'daily',
    outcome: 'success',
    durationMs: 'not-a-number',
    queueWaitMs: -10,
    commandCount: -4,
  });

  const row = aggregator.takeSnapshot().taskMetrics[0];
  assert.deepEqual(row, {
    minute: '1970-01-01 00:00:00',
    dimensions: { task: 'daily' },
    outcome: 'success',
    runCount: 3,
    durationCount: 1,
    durationSumMs: 25,
    durationMaxMs: 25,
    queueWaitCount: 1,
    queueWaitSumMs: 5,
    queueWaitMaxMs: 5,
    attributedCommandCount: 5,
  });
});

test('record metrics saturate extreme measurements and counts at a finite safe limit', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });

  for (let index = 0; index < 2; index += 1) {
    aggregator.recordCommand({ command: 'extreme', outcome: 'success', latencyMs: Number.MAX_VALUE });
    aggregator.recordTask({
      task: 'extreme',
      outcome: 'success',
      durationMs: Number.MAX_VALUE,
      queueWaitMs: Number.MAX_VALUE,
      attributedCommandCount: Number.MAX_VALUE,
    });
  }

  const snapshot = aggregator.takeSnapshot();
  const command = snapshot.commandMetrics[0];
  const task = snapshot.taskMetrics[0];
  const numericValues = [
    ...Object.values(command).filter((value) => typeof value === 'number'),
    ...Object.values(task).filter((value) => typeof value === 'number'),
    ...Object.values(snapshot.totals),
  ];

  assert.ok(numericValues.every((value) => Number.isFinite(value)));
  assert.ok(numericValues.every((value) => value <= Number.MAX_SAFE_INTEGER));
  assert.equal(command.latencySumMs, Number.MAX_SAFE_INTEGER);
  assert.equal(command.latencyMaxMs, Number.MAX_SAFE_INTEGER);
  assert.equal(task.durationSumMs, Number.MAX_SAFE_INTEGER);
  assert.equal(task.queueWaitSumMs, Number.MAX_SAFE_INTEGER);
  assert.equal(task.attributedCommandCount, Number.MAX_SAFE_INTEGER);
  assert.equal(JSON.stringify(snapshot).includes(':null'), false);
});

test('metric capacity drops only new keys and reports health', () => {
  const aggregator = new SchedulerObservationAggregator({ maxMetricKeys: 1 });

  assert.equal(aggregator.recordCommand({ command: 'one', outcome: 'success' }), true);
  assert.equal(aggregator.recordCommand({ command: 'one', outcome: 'success' }), true);
  assert.equal(aggregator.recordTask({ task: 'two', outcome: 'success' }), false);

  assert.deepEqual(aggregator.getHealth(), {
    metricKeys: 1,
    anomalyCount: 0,
    droppedMetrics: 1,
    droppedAnomalies: 0,
  });

  const snapshot = aggregator.takeSnapshot();
  assert.equal(snapshot.commandMetrics[0].commandCount, 2);
  assert.equal(snapshot.totals.commandCount, 2);
  assert.equal(snapshot.health.droppedMetrics, 1);
});

test('anomaly capacity removes the oldest entry and sanitizes stored fields', () => {
  let timestamp = Date.parse('2026-07-15T00:00:00.000Z');
  const aggregator = new SchedulerObservationAggregator({
    now: () => timestamp,
    maxAnomalies: 2,
  });

  aggregator.recordAnomaly({ type: 'first', message: 'token=first-secret', stack: 'full-stack' });
  timestamp += 60_000;
  aggregator.recordAnomaly({ type: 'second', message: 'safe second' });
  timestamp += 60_000;
  aggregator.recordAnomaly({
    type: 'third',
    message: 'safe third',
    dimensions: {
      responseBody: 'raw-response-secret',
      stack: 'raw-stack-secret',
      proxy: 'http://raw.proxy.local:8080',
    },
  });

  const snapshot = aggregator.takeSnapshot();
  const serialized = JSON.stringify(snapshot);
  assert.deepEqual(snapshot.anomalies.map((entry) => entry.type), ['second', 'third']);
  assert.equal(snapshot.health.droppedAnomalies, 1);
  assert.equal(serialized.includes('first-secret'), false);
  assert.equal(serialized.includes('full-stack'), false);
  assert.equal(serialized.includes('raw-response-secret'), false);
  assert.equal(serialized.includes('raw-stack-secret'), false);
  assert.equal(serialized.includes('raw.proxy.local'), false);
});

test('takeSnapshot swaps buffers and returned data is unaffected by later records', () => {
  const aggregator = new SchedulerObservationAggregator({ now: () => 0 });
  aggregator.recordCommand({ command: 'before', outcome: 'sent' });

  const first = aggregator.takeSnapshot();
  aggregator.recordCommand({ command: 'after', outcome: 'success' });
  aggregator.recordAnomaly({ type: 'after', message: 'later' });

  assert.equal(first.commandMetrics.length, 1);
  assert.equal(first.commandMetrics[0].dimensions.command, 'before');
  assert.equal(first.anomalies.length, 0);
  assert.deepEqual(first.health, {
    metricKeys: 1,
    anomalyCount: 0,
    droppedMetrics: 0,
    droppedAnomalies: 0,
  });
  assert.deepEqual(aggregator.getHealth(), {
    metricKeys: 1,
    anomalyCount: 1,
    droppedMetrics: 0,
    droppedAnomalies: 0,
  });
});

test('mergeSnapshot combines matching metric rows, anomalies, and drop counters', () => {
  const source = new SchedulerObservationAggregator({ now: () => 0, maxMetricKeys: 1 });
  source.recordCommand({ command: 'shared', outcome: 'rate_limited' });
  source.recordTask({ task: 'dropped', outcome: 'error' });
  source.recordAnomaly({ type: 'source', message: 'source anomaly' });

  const target = new SchedulerObservationAggregator({ now: () => 0 });
  target.recordCommand({ command: 'shared', outcome: 'rate_limited' });
  assert.equal(target.mergeSnapshot(source.takeSnapshot()), true);

  const merged = target.takeSnapshot();
  assert.equal(merged.commandMetrics.length, 1);
  assert.equal(merged.commandMetrics[0].commandCount, 2);
  assert.equal(merged.totals.commandCount, 2);
  assert.equal(merged.totals.rateLimitedCount, 2);
  assert.deepEqual(merged.anomalies.map((entry) => entry.type), ['source']);
  assert.equal(merged.health.droppedMetrics, 1);
});

test('mergeSnapshot bypasses metric capacity and combines every command field losslessly', () => {
  const target = new SchedulerObservationAggregator({ now: () => 0, maxMetricKeys: 1 });
  target.recordCommand({ command: 'current', outcome: 'error', latencyMs: 10 });

  const source = new SchedulerObservationAggregator({ now: () => 0 });
  source.recordCommand({ command: 'current', outcome: 'error', latencyMs: 20 });
  source.recordCommand({ command: 'source', outcome: 'timeout', latencyMs: 7 });

  target.mergeSnapshot(source.takeSnapshot());
  const snapshot = target.takeSnapshot();
  const rows = Object.fromEntries(
    snapshot.commandMetrics.map((row) => [row.dimensions.command, row]),
  );

  assert.equal(snapshot.commandMetrics.length, 2);
  assert.equal(rows.current.commandCount, 2);
  assert.equal(rows.current.errorCount, 2);
  assert.equal(rows.current.latencyCount, 2);
  assert.equal(rows.current.latencySumMs, 30);
  assert.equal(rows.current.latencyMaxMs, 20);
  assert.equal(rows.source.commandCount, 1);
  assert.equal(rows.source.timeoutCount, 1);
  assert.equal(snapshot.health.droppedMetrics, 0);
});

test('mergeSnapshot combines every task field using sums and maxima', () => {
  const target = new SchedulerObservationAggregator({ now: () => 0 });
  target.recordTask({
    task: 'shared',
    outcome: 'success',
    durationMs: 10,
    queueWaitMs: 4,
    commandCount: 2,
  });

  const source = new SchedulerObservationAggregator({ now: () => 0 });
  source.recordTask({
    task: 'shared',
    outcome: 'success',
    durationMs: 30,
    queueWaitMs: 1,
    attributedCommandCount: 3,
  });

  target.mergeSnapshot(source.takeSnapshot());
  const row = target.takeSnapshot().taskMetrics[0];

  assert.equal(row.runCount, 2);
  assert.equal(row.durationCount, 2);
  assert.equal(row.durationSumMs, 40);
  assert.equal(row.durationMaxMs, 30);
  assert.equal(row.queueWaitCount, 2);
  assert.equal(row.queueWaitSumMs, 5);
  assert.equal(row.queueWaitMaxMs, 4);
  assert.equal(row.attributedCommandCount, 5);
});

test('mergeSnapshot saturates every command and task numeric field without Infinity', () => {
  const target = new SchedulerObservationAggregator({ now: () => 0 });
  target.recordCommand({ command: 'overflow', outcome: 'error', latencyMs: 1 });
  target.recordTask({ task: 'overflow', outcome: 'success', durationMs: 1, queueWaitMs: 1 });

  const source = new SchedulerObservationAggregator({ now: () => 0 });
  source.recordCommand({ command: 'overflow', outcome: 'error', latencyMs: 1 });
  source.recordTask({ task: 'overflow', outcome: 'success', durationMs: 1, queueWaitMs: 1 });
  const sourceSnapshot = source.takeSnapshot();

  for (const row of [...sourceSnapshot.commandMetrics, ...sourceSnapshot.taskMetrics]) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') row[key] = Number.MAX_VALUE;
    }
  }

  target.mergeSnapshot(sourceSnapshot);
  const merged = target.takeSnapshot();
  const rows = [...merged.commandMetrics, ...merged.taskMetrics];
  const numericValues = rows.flatMap((row) => (
    Object.values(row).filter((value) => typeof value === 'number')
  ));

  assert.ok(numericValues.every((value) => Number.isFinite(value)));
  assert.ok(numericValues.every((value) => value <= Number.MAX_SAFE_INTEGER));
  assert.equal(JSON.stringify(merged).includes(':null'), false);
});

test('mergeSnapshot prepends all older anomalies without applying current capacity', () => {
  const target = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T03:00:00.000Z'),
    maxAnomalies: 1,
  });
  target.recordAnomaly({ type: 'current', message: 'current' });

  let sourceTime = Date.parse('2026-07-15T01:00:00.000Z');
  const source = new SchedulerObservationAggregator({
    now: () => sourceTime,
    maxAnomalies: 5,
  });
  source.recordAnomaly({ type: 'oldest', message: 'oldest' });
  sourceTime += 60 * 60 * 1000;
  source.recordAnomaly({ type: 'older', message: 'older' });

  target.mergeSnapshot(source.takeSnapshot());
  const snapshot = target.takeSnapshot();

  assert.deepEqual(
    snapshot.anomalies.map((entry) => entry.type),
    ['oldest', 'older', 'current'],
  );
  assert.equal(snapshot.health.anomalyCount, 3);
  assert.equal(snapshot.health.droppedAnomalies, 0);
});

test('mergeSnapshot keeps chronological FIFO across multiple restores and stable ties', () => {
  const createSnapshot = (type, timestamp) => {
    const source = new SchedulerObservationAggregator({ now: () => timestamp });
    source.recordAnomaly({ type, message: type });
    return source.takeSnapshot();
  };

  const target = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T03:00:00.000Z'),
    maxAnomalies: 1,
  });
  target.recordAnomaly({ type: 'current', message: 'current' });
  target.mergeSnapshot(createSnapshot('oldest', Date.parse('2026-07-15T01:00:00.000Z')));
  target.mergeSnapshot(createSnapshot('older', Date.parse('2026-07-15T02:00:00.000Z')));

  assert.deepEqual(
    target.takeSnapshot().anomalies.map((entry) => entry.type),
    ['oldest', 'older', 'current'],
  );

  const tiedTarget = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T03:00:00.000Z'),
  });
  tiedTarget.recordAnomaly({ type: 'current', message: 'current' });
  const tiedTime = Date.parse('2026-07-15T01:00:00.000Z');
  tiedTarget.mergeSnapshot(createSnapshot('first', tiedTime));
  tiedTarget.mergeSnapshot(createSnapshot('second', tiedTime));

  assert.deepEqual(
    tiedTarget.takeSnapshot().anomalies.map((entry) => entry.type),
    ['first', 'second', 'current'],
  );
});

test('mergeSnapshot keeps same-millisecond restores before live anomalies in merge order', () => {
  const timestamp = Date.parse('2026-07-15T01:00:00.000Z');
  const createSnapshot = (type) => {
    const source = new SchedulerObservationAggregator({ now: () => timestamp });
    source.recordAnomaly({ type, message: type });
    return source.takeSnapshot();
  };

  const firstSnapshot = createSnapshot('snapshot-first');
  const target = new SchedulerObservationAggregator({ now: () => timestamp });
  target.recordAnomaly({ type: 'current-second', message: 'current-second' });
  target.mergeSnapshot(firstSnapshot);

  assert.deepEqual(
    target.takeSnapshot().anomalies.map((entry) => entry.type),
    ['snapshot-first', 'current-second'],
  );

  const multiTarget = new SchedulerObservationAggregator({ now: () => timestamp });
  multiTarget.recordAnomaly({ type: 'current', message: 'current' });
  multiTarget.mergeSnapshot(createSnapshot('first-snapshot'));
  multiTarget.mergeSnapshot(createSnapshot('second-snapshot'));

  assert.deepEqual(
    multiTarget.takeSnapshot().anomalies.map((entry) => entry.type),
    ['first-snapshot', 'second-snapshot', 'current'],
  );
});

test('recordAnomaly evicts only live anomalies after restored data exceeds capacity', () => {
  const timestamp = Date.parse('2026-07-15T01:00:00.000Z');
  const createSnapshot = (type) => {
    const source = new SchedulerObservationAggregator({ now: () => timestamp });
    source.recordAnomaly({ type, message: type });
    return source.takeSnapshot();
  };
  const target = new SchedulerObservationAggregator({ now: () => timestamp, maxAnomalies: 1 });
  target.recordAnomaly({ type: 'old-live', message: 'old-live' });
  target.mergeSnapshot(createSnapshot('restored-first'));
  target.mergeSnapshot(createSnapshot('restored-second'));

  target.recordAnomaly({ type: 'new-live', message: 'new-live' });
  const snapshot = target.takeSnapshot();

  assert.deepEqual(
    snapshot.anomalies.map((entry) => entry.type),
    ['restored-first', 'restored-second', 'new-live'],
  );
  assert.equal(snapshot.health.droppedAnomalies, 1);
});

test('mergeSnapshot preserves an anomaly ISO timestamp', () => {
  const source = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-15T01:02:03.000Z'),
  });
  source.recordAnomaly({ type: 'source', message: 'source anomaly' });

  const target = new SchedulerObservationAggregator({
    now: () => Date.parse('2026-07-16T04:05:06.000Z'),
  });
  target.mergeSnapshot(source.takeSnapshot());

  const merged = target.takeSnapshot();
  assert.equal(merged.anomalies[0].timestamp, '2026-07-15T01:02:03.000Z');
  assert.equal(merged.anomalies[0].minute, '2026-07-15 01:02:00');
});

test('mergeSnapshot rejects non-snapshot input without changing state', () => {
  const aggregator = new SchedulerObservationAggregator();

  assert.equal(aggregator.mergeSnapshot(null), false);
  assert.equal(aggregator.mergeSnapshot({}), false);
  assert.deepEqual(aggregator.getHealth(), {
    metricKeys: 0,
    anomalyCount: 0,
    droppedMetrics: 0,
    droppedAnomalies: 0,
  });
});

test('mergeSnapshot rejects invalid nested data atomically and remains idempotent', () => {
  const target = new SchedulerObservationAggregator({ now: () => 0 });
  target.recordCommand({ command: 'current', outcome: 'success' });
  target.recordAnomaly({ type: 'current', message: 'current' });
  const healthBefore = target.getHealth();

  const invalidSource = new SchedulerObservationAggregator({ now: () => 0 });
  invalidSource.recordCommand({ command: 'source', outcome: 'error' });
  invalidSource.recordAnomaly({ type: 'source', message: 'source' });
  const invalidSnapshot = invalidSource.takeSnapshot();
  invalidSnapshot.anomalies[0].timestamp = 9e15;

  assert.doesNotThrow(() => target.mergeSnapshot(invalidSnapshot));
  assert.equal(target.mergeSnapshot(invalidSnapshot), false);
  assert.equal(target.mergeSnapshot(invalidSnapshot), false);
  assert.deepEqual(target.getHealth(), healthBefore);

  const afterInvalid = target.takeSnapshot();
  assert.deepEqual(afterInvalid.commandMetrics.map((row) => row.dimensions.command), ['current']);
  assert.equal(afterInvalid.commandMetrics[0].commandCount, 1);
  assert.deepEqual(afterInvalid.anomalies.map((entry) => entry.type), ['current']);

  const validSource = new SchedulerObservationAggregator({ now: () => 0 });
  validSource.recordCommand({ command: 'source', outcome: 'error' });
  validSource.recordAnomaly({ type: 'source', message: 'source' });
  assert.equal(target.mergeSnapshot(validSource.takeSnapshot()), true);

  const afterValid = target.takeSnapshot();
  assert.deepEqual(afterValid.commandMetrics.map((row) => row.dimensions.command), ['source']);
  assert.deepEqual(afterValid.anomalies.map((entry) => entry.type), ['source']);
});
