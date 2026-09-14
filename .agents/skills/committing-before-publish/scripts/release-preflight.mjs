import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function fail(message, code = 1) {
  console.error('PUBLISH_BLOCKED: ' + message);
  process.exit(code);
}

function option(name, required = true) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--'))) fail('missing ' + name);
  return value;
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim();
  } catch (error) {
    fail('Git command failed: git ' + args.join(' '));
  }
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function filesUnder(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...filesUnder(path));
    else files.push(path);
  }
  return files;
}

const expectedBranch = option('--expected-branch');
const buildDir = resolve(option('--build-dir'));
const manifestPath = resolve(option('--manifest'));
const remoteManifestPath = option('--remote-manifest', false);

const repository = git(['rev-parse', '--show-toplevel']);
if (!repository) fail('not a Git repository', 2);
const head = git(['rev-parse', '--verify', 'HEAD']);
if (!head) fail('repository has no resolvable HEAD commit', 3);
const branch = git(['branch', '--show-current']);
if (branch !== expectedBranch) fail('unexpected branch ' + JSON.stringify(branch) + '; expected ' + JSON.stringify(expectedBranch));
const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
if (status) fail('working tree is not clean. Resolve ownership before publishing.\n' + status);

if (!existsSync(buildDir) || !statSync(buildDir).isDirectory()) fail('build directory does not exist: ' + buildDir);
if (!existsSync(manifestPath)) fail('release manifest does not exist: ' + manifestPath);

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail('release manifest is not valid JSON: ' + manifestPath);
}
if (manifest.schemaVersion !== 1) fail('release manifest schemaVersion must be 1');
if (typeof manifest.buildTimestamp !== 'string' || !manifest.buildTimestamp) fail('release manifest buildTimestamp is required');
if (manifest.branch !== branch) fail('manifest branch does not match current branch');
if (manifest.commitSha !== head) fail('manifest commit SHA does not match HEAD');

const entry = typeof manifest.entry === 'string' ? manifest.entry : '';
const indexPath = join(buildDir, 'index.html');
const entryPath = entry ? join(buildDir, entry) : '';
const relativeEntry = entryPath ? relative(buildDir, resolve(entryPath)) : '';
if (!entry || isAbsolute(entry) || relativeEntry.startsWith('..' + sep) || relativeEntry === '..') fail('manifest entry escapes the build directory');
if (!entry || !existsSync(indexPath) || !existsSync(entryPath)) fail('manifest entry or index.html is missing from build');
if (manifest.indexSha256 !== hashFile(indexPath)) fail('index.html SHA-256 does not match manifest');
if (manifest.entrySha256 !== hashFile(entryPath)) fail('entry SHA-256 does not match manifest');

const requiredMarkers = Array.isArray(manifest.requiredMarkers) ? manifest.requiredMarkers : [];
if (requiredMarkers.length === 0) fail('release manifest must declare requiredMarkers');
const textFiles = filesUnder(buildDir).filter((path) => /\.(?:js|mjs|cjs|html|css)$/i.test(path));
const contents = textFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
for (const marker of requiredMarkers) {
  if (typeof marker !== 'string' || !marker || !contents.includes(marker)) {
    fail('missing required marker: ' + String(marker));
  }
}

if (remoteManifestPath) {
  const remotePath = resolve(remoteManifestPath);
  if (!existsSync(remotePath)) fail('remote release manifest does not exist: ' + remotePath);
  let remote;
  try {
    remote = JSON.parse(readFileSync(remotePath, 'utf8'));
  } catch (error) {
    fail('remote release manifest is not valid JSON: ' + remotePath);
  }
  if (remote.branch !== expectedBranch) fail('remote manifest branch does not match expected branch');
  if (remote.commitSha && remote.commitSha !== head) {
    let remoteIsAhead = false;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', head, remote.commitSha], { cwd: process.cwd(), stdio: 'ignore' });
      remoteIsAhead = true;
    } catch (error) {
      remoteIsAhead = false;
    }
    if (remoteIsAhead) fail('remote manifest points to a newer commit than the release HEAD');
    fail('remote manifest commit differs from release HEAD');
  }
}

console.log(JSON.stringify({
  status: 'RELEASE_PREFLIGHT_OK',
  repository,
  branch,
  commitSha: head,
  buildDir,
  manifest: manifestPath,
  entry,
  requiredMarkers,
}, null, 2));
