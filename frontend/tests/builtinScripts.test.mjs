import assert from 'node:assert/strict';
import { test } from 'node:test';

test('normalizes enabled builtin script IDs to known values', async () => {
  const { normalizeEnabledBuiltinScriptIds } = await import('../src/utils/builtinScripts.js');

  const knownIds = ['sample-script'];
  assert.deepEqual(
    normalizeEnabledBuiltinScriptIds(['sample-script', '', 'unknown', 'sample-script'], knownIds),
    ['sample-script'],
  );
  assert.deepEqual(normalizeEnabledBuiltinScriptIds('not-array', knownIds), []);
});

test('launch payload contains enabled builtin script IDs', async () => {
  const { createLaunchPayload } = await import('../src/utils/slimGameLauncher.js');

  const payload = createLaunchPayload({ id: 'account-1', token: 'token-value' });
  assert.deepEqual(payload.builtinScripts, []);
});

test('exposes the bundled scripts as opt-in entries', async () => {
  const { BUILTIN_GAME_SCRIPTS } = await import('../src/utils/builtinScripts.js');

  assert.deepEqual(
    BUILTIN_GAME_SCRIPTS.map((script) => script.id),
    ['xingchi', 'peach-auto', 'salt-lineup'],
  );
});

test('persists and reads enabled builtin script IDs', async () => {
  const { readEnabledBuiltinScriptIds, writeEnabledBuiltinScriptIds } = await import(
    '../src/utils/builtinScripts.js'
  );
  const items = new Map();
  const storage = {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };

  assert.deepEqual(readEnabledBuiltinScriptIds(storage), []);
  const saved = writeEnabledBuiltinScriptIds(storage, ['peach-auto', 'unknown']);
  assert.deepEqual(saved, ['peach-auto']);
  assert.equal(items.get('xyzw-builtin-scripts-enabled'), '["peach-auto"]');
  assert.deepEqual(readEnabledBuiltinScriptIds(storage), ['peach-auto']);
});
