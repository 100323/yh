import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptPath = fileURLToPath(new URL('../scripts/release-preflight.mjs', import.meta.url));
const isolated = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR'];
const envFor = (cwd) => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (isolated.includes(name.toUpperCase())) delete env[name];
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CEILING_DIRECTORIES: cwd };
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: envFor(cwd) });
const sha256 = (path) => execFileSync(process.execPath, ['-e', 'const fs=require("fs"),c=require("crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))', path], { encoding: 'utf8' });

function repo() {
  const cwd = mkdtempSync(join(tmpdir(), 'release-preflight-'));
  git(cwd, 'init', '--quiet', '--template=');
  for (const [key, value] of [['user.email', 'test@example.com'], ['user.name', 'Test'], ['commit.gpgSign', 'false'], ['tag.gpgSign', 'false'], ['core.autocrlf', 'false']]) git(cwd, 'config', key, value);
  writeFileSync(join(cwd, '.gitignore'), 'dist/\nremote.json\n');
  writeFileSync(join(cwd, 'tracked.txt'), 'initial\n');
  git(cwd, 'add', '--', '.gitignore', 'tracked.txt');
  git(cwd, 'commit', '--quiet', '-m', 'initial');
  git(cwd, 'branch', '-M', 'main');
  return cwd;
}

function artifact(cwd, marker = 'feature-a') {
  const dist = join(cwd, 'dist');
  const assets = join(dist, 'assets');
  execFileSync(process.execPath, ['-e', 'require("fs").mkdirSync(process.argv[1], { recursive: true })', assets]);
  writeFileSync(join(dist, 'index.html'), '<script type="module" src="/assets/index.js"></script>\n');
  writeFileSync(join(assets, 'index.js'), 'window.feature=' + JSON.stringify(marker) + ';\n');
  return dist;
}

function manifest(cwd, dist, extra = {}) {
  const value = { schemaVersion: 1, branch: 'main', commitSha: git(cwd, 'rev-parse', 'HEAD').trim(), buildTimestamp: '2026-09-14T00:00:00.000Z', entry: 'assets/index.js', indexSha256: sha256(join(dist, 'index.html')), entrySha256: sha256(join(dist, 'assets', 'index.js')), requiredMarkers: ['feature-a'], ...extra };
  const path = join(dist, 'release-manifest.json');
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function check(cwd, args = []) {
  return spawnSync(process.execPath, [scriptPath, '--expected-branch', 'main', '--build-dir', join(cwd, 'dist'), ...args], { cwd, encoding: 'utf8', env: envFor(cwd) });
}

function withRepo(fn) {
  const cwd = repo();
  try { fn(cwd); } finally { rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}

test('accepts a clean artifact tied to branch and HEAD', () => withRepo((cwd) => {
  const dist = artifact(cwd);
  const file = manifest(cwd, dist);
  const result = check(cwd, ['--manifest', file]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RELEASE_PREFLIGHT_OK/);
}));

test('blocks dirty worktrees', () => withRepo((cwd) => {
  const dist = artifact(cwd);
  const file = manifest(cwd, dist);
  writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
  const result = check(cwd, ['--manifest', file]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /working tree is not clean/i);
}));

test('blocks unexpected branches', () => withRepo((cwd) => {
  git(cwd, 'switch', '-c', 'feature');
  const dist = artifact(cwd);
  const file = manifest(cwd, dist, { branch: 'feature' });
  const result = check(cwd, ['--manifest', file]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected branch|unexpected branch/i);
}));

test('blocks missing markers and mismatched SHA', () => withRepo((cwd) => {
  const dist = artifact(cwd, 'other');
  const file = manifest(cwd, dist, { requiredMarkers: ['feature-a'] });
  let result = check(cwd, ['--manifest', file]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required marker/i);
  const file2 = manifest(cwd, dist, { commitSha: '0'.repeat(40) });
  result = check(cwd, ['--manifest', file2]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest commit SHA.*HEAD/i);
}));

test('blocks a remote manifest that is ahead', () => withRepo((cwd) => {
  const dist = artifact(cwd);
  const file = manifest(cwd, dist);
  const base = git(cwd, 'rev-parse', 'HEAD').trim();
  const tree = git(cwd, 'write-tree').trim();
  const newer = git(cwd, 'commit-tree', tree, '-p', base, '-m', 'newer').trim();
  const remote = join(cwd, 'remote.json');
  writeFileSync(remote, JSON.stringify({ branch: 'main', commitSha: newer }));
  const result = check(cwd, ['--manifest', file, '--remote-manifest', remote]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /remote manifest.*newer|remote.*ahead/i);
}));
