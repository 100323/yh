import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gameCommands } from '../src/utils/gameCommands.js';

const websocketClientSource = fs.readFileSync(
  fileURLToPath(new URL('../src/utils/xyzwWebSocket.js', import.meta.url)),
  'utf8',
);

test('registers the three new signup commands', () => {
  for (const command of ['legion_signup', 'legion_payloadsignup', 'club_signup', 'genie_sweep']) {
    assert.match(
      websocketClientSource,
      new RegExp(`\\.register\\("${command}"(?:,|\\))`),
    );
  }
});

test('builds empty signup command payloads', () => {
  for (const command of ['legion_signup', 'legion_payloadsignup', 'club_signup']) {
    const message = gameCommands[command](0, 7);
    assert.deepEqual(message, {
      ack: 0,
      body: message.body,
      cmd: command,
      seq: 7,
      time: message.time,
    });
    assert.equal(message.body instanceof Uint8Array, true);
  }
});
