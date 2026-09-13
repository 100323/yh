import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import path from 'node:path';

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
  const expectedScripts = [
    { id: 'xingchi', file: 'xingchi.js' },
    { id: 'peach-auto', file: 'peach-auto.js' },
    { id: 'salt-lineup', file: 'salt-lineup.js' },
    { id: 'nightmareAccel', file: 'nightmare_accel.js' },
    { id: 'nightmareEnhance', file: 'nightmare_enhance.js' },
    { id: 'simulateBattle', file: 'simulate_battle.js' },
    { id: 'evoTowerMerge', file: 'evo_tower_merge.js' },
  ];

  assert.deepEqual(
    BUILTIN_GAME_SCRIPTS.map((script) => script.id),
    expectedScripts.map((script) => script.id),
  );

  const bootstrapSource = await import('node:fs').then((fs) =>
    fs.promises.readFile(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'xyzw-web-slim/bootstrap.js'),
      'utf8',
    ),
  );

  expectedScripts.forEach(({ id, file }) => {
    assert.match(
      bootstrapSource,
      new RegExp(`id:\\s*["']${id}["'][\\s\\S]{0,200}?url:\\s*["']/slim-game/builtin-scripts/${file}["']`),
    );
    assert.ok(
      existsSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'xyzw-web-slim/builtin-scripts', file),
      ),
      `missing bundled script: ${file}`,
    );
  });
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
