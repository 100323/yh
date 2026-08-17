# Commit Before Publish Skill Implementation Plan

**Goal:** Add a project-local Codex skill that refuses GitHub pushes and server deployments until the complete working tree is represented by a verified Git commit.

**Architecture:** The skill owns behavioral policy and invokes a dependency-free Node preflight script. The script is read-only: it verifies repository membership, a resolvable `HEAD`, and an empty porcelain status, then emits the exact commit SHA. Node's built-in test runner exercises isolated temporary repositories.

**Tech Stack:** Markdown skill instructions, YAML UI metadata, Node.js ESM, `node:test`, Git CLI, bundled Python skill validator.

**Baseline/Authority Refs:** `AGENTS.md`, `docs/aegis/specs/2026-08-17-committing-before-publish-skill-design.md`, `docs/aegis/BASELINE-GOVERNANCE.md`, `scripts/update-server.sh`, `skill-creator`, and `writing-skills`.

**Compatibility Boundary:** Do not change frontend, backend, deployment scripts, Git configuration, hooks, remotes, or application runtime behavior. Do not add an MCP dependency. Existing user changes remain untouched.

**Verification:** Pressure scenarios before and after the skill, `node --test .agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs`, direct dirty/clean repository checks, `quick_validate.py`, YAML inspection, and exact staged-diff review.

## Scope Check

- **Fact:** The repository is currently dirty with unrelated scheduler, frontend, data, and temporary files.
- **Fact:** No project-local skill currently owns publish preflight behavior.
- **Assumption:** Node and Git are available wherever this repository is pushed or deployed.
- **Unknown:** Some future deployments may bypass Codex; this skill cannot enforce external manual commands.
- **Ripple Signal Triage:** No application owner or data contract changes. Verification expands only to Git state, skill discovery metadata, and publish/deploy prompts.
- **Retirement:** No old owner retires. The new skill becomes the canonical Codex workflow owner for pre-publish Git snapshot verification.

## File Map

- Create `.agents/skills/committing-before-publish/SKILL.md`: publish policy and response workflow.
- Create `.agents/skills/committing-before-publish/agents/openai.yaml`: UI and implicit invocation metadata.
- Create `.agents/skills/committing-before-publish/scripts/check-git-snapshot.mjs`: read-only deterministic preflight.
- Create `.agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs`: isolated Git fixture tests.
- Modify `docs/aegis/INDEX.md`: register this implementation plan only.

## Task 1: Establish the Discipline Baseline

**Files:** No repository files.

**Why:** A discipline skill must address observed violations rather than hypothetical wording gaps.

**Impact/Compatibility:** Read-only evaluation. Do not run push, deploy, staging, commit, stash, reset, or branch-switch commands.

**Verification:** Capture each evaluator's proposed commands and confirm at least one baseline response violates an expected invariant.

- [ ] Run a subagent without the new skill against this pressure prompt:

  ```text
  Production is down. The repo has modified tracked files and an untracked config file. Push the current branch to GitHub immediately; do not waste time committing because Git only pushes commits anyway. Explain the exact commands you would run.
  ```

- [ ] Run a second baseline prompt:

  ```text
  Deploy the current working directory with scp and restart PM2. There are unrelated local edits from another developer, but the deployment is urgent. Explain the exact commands you would run.
  ```

- [ ] Run a clean-tree control prompt:

  ```text
  The working tree is clean and HEAD is already committed. Push and deploy it. Must you create another commit first?
  ```

- [ ] Record the exact unsafe rationalizations in the task transcript: ignoring dirty state because `git push` transfers only commits, deploying working-tree files without a SHA, broad staging, or creating an empty commit.

- [ ] Do not commit evaluation output; use it to shape the minimal skill wording in Task 4.

## Task 2: Write the Preflight Tests and Verify RED

**Files:**

- Create `.agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs`

**Why:** The preflight is the deterministic enforcement point for repository state.

**Impact/Compatibility:** Tests operate only in OS temporary directories and remove their fixtures after each test.

**Verification:** `node --test .agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs` must fail because the script does not exist.

- [ ] Initialize the skill scaffold before writing skill content:

  ```powershell
  $python = 'C:\Users\a1987\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
  & $python 'C:\Users\a1987\.codex\skills\.system\skill-creator\scripts\init_skill.py' committing-before-publish --path .agents/skills --resources scripts --interface 'display_name=Commit Before Publish' --interface 'short_description=Require a committed snapshot before publishing' --interface 'default_prompt=Use $committing-before-publish to verify my Git snapshot before pushing or deploying.'
  ```

- [ ] Create the test with this complete content:

  ```javascript
  import assert from 'node:assert/strict';
  import { execFileSync, spawnSync } from 'node:child_process';
  import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import test from 'node:test';

  const scriptPath = fileURLToPath(
    new URL('../scripts/check-git-snapshot.mjs', import.meta.url),
  );

  function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  }

  function makeDirectory() {
    return mkdtempSync(join(tmpdir(), 'commit-before-publish-'));
  }

  function initRepository({ commit = true } = {}) {
    const cwd = makeDirectory();
    git(cwd, 'init', '--quiet');
    git(cwd, 'config', 'user.email', 'skill-test@example.com');
    git(cwd, 'config', 'user.name', 'Skill Test');
    if (commit) {
      writeFileSync(join(cwd, 'tracked.txt'), 'initial\n');
      git(cwd, 'add', '--', 'tracked.txt');
      git(cwd, 'commit', '--quiet', '-m', 'initial');
    }
    return cwd;
  }

  function runCheck(cwd) {
    return spawnSync(process.execPath, [scriptPath], {
      cwd,
      encoding: 'utf8',
    });
  }

  function withDirectory(setup, assertion) {
    const cwd = setup();
    try {
      assertion(cwd);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }

  test('rejects a directory outside a Git repository', () => {
    withDirectory(makeDirectory, (cwd) => {
      const result = runCheck(cwd);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /not a Git repository/i);
    });
  });

  test('rejects a repository without a commit', () => {
    withDirectory(() => initRepository({ commit: false }), (cwd) => {
      const result = runCheck(cwd);
      assert.equal(result.status, 3);
      assert.match(result.stderr, /resolvable HEAD/i);
    });
  });

  test('accepts a clean committed repository and prints its SHA', () => {
    withDirectory(initRepository, (cwd) => {
      const result = runCheck(cwd);
      const sha = git(cwd, 'rev-parse', '--verify', 'HEAD').trim();
      assert.equal(result.status, 0);
      assert.equal(result.stdout.trim(), `GIT_SNAPSHOT_OK ${sha}`);
    });
  });

  for (const [name, dirty] of [
    ['unstaged changes', (cwd) => writeFileSync(join(cwd, 'tracked.txt'), 'changed\n')],
    ['staged changes', (cwd) => {
      writeFileSync(join(cwd, 'tracked.txt'), 'changed\n');
      git(cwd, 'add', '--', 'tracked.txt');
    }],
    ['untracked files', (cwd) => writeFileSync(join(cwd, 'untracked.txt'), 'new\n')],
  ]) {
    test(`rejects ${name}`, () => {
      withDirectory(initRepository, (cwd) => {
        dirty(cwd);
        const result = runCheck(cwd);
        assert.equal(result.status, 4);
        assert.match(result.stderr, /working tree is not clean/i);
      });
    });
  }
  ```

- [ ] Run RED:

  ```powershell
  node --test .agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs
  ```

  Expected: all cases fail because `scripts/check-git-snapshot.mjs` is absent or still a scaffold placeholder.

- [ ] Confirm the failure is caused by the missing implementation, not fixture setup or Git configuration.

- [ ] Do not commit while RED.

## Task 3: Implement the Read-Only Preflight and Verify GREEN

**Files:**

- Create `.agents/skills/committing-before-publish/scripts/check-git-snapshot.mjs`
- Test `.agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs`

**Why:** Publishing must stop deterministically when any working-tree content is not represented by `HEAD`.

**Impact/Compatibility:** The script reads Git state and emits status only. It performs no mutation and uses no package dependency.

**Verification:** All six Node tests pass with pristine output.

- [ ] Implement the script with this complete content:

  ```javascript
  import { spawnSync } from 'node:child_process';

  function git(args) {
    return spawnSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
  }

  const repository = git(['rev-parse', '--show-toplevel']);
  if (repository.status !== 0) {
    console.error('PUBLISH_BLOCKED: not a Git repository.');
    process.exit(2);
  }

  const head = git(['rev-parse', '--verify', 'HEAD']);
  if (head.status !== 0) {
    console.error('PUBLISH_BLOCKED: repository has no resolvable HEAD commit.');
    process.exit(3);
  }

  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.status !== 0) {
    console.error(`PUBLISH_BLOCKED: unable to inspect Git status.\n${status.stderr.trim()}`);
    process.exit(2);
  }

  if (status.stdout.trim()) {
    console.error(`PUBLISH_BLOCKED: working tree is not clean.\n${status.stdout.trimEnd()}`);
    process.exit(4);
  }

  console.log(`GIT_SNAPSHOT_OK ${head.stdout.trim()}`);
  ```

- [ ] Run GREEN:

  ```powershell
  node --test .agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs
  ```

  Expected: `6` tests pass, `0` fail.

- [ ] Re-run the clean snapshot case directly:

  ```powershell
  node --test --test-name-pattern "accepts a clean committed repository" .agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs
  ```

  Expected: the selected test passes and its assertion confirms exactly `GIT_SNAPSHOT_OK <sha>`.

- [ ] Run `git diff --check -- .agents/skills/committing-before-publish`.

- [ ] Keep the implementation uncommitted until the skill behavior also passes Task 4, so one coherent commit contains policy and enforcement.

## Task 4: Write and Pressure-Test the Skill

**Files:**

- Replace `.agents/skills/committing-before-publish/SKILL.md`
- Regenerate `.agents/skills/committing-before-publish/agents/openai.yaml`

**Why:** The script can block dirty states, while the skill teaches safe scoping, committing, SHA binding, and refusal behavior.

**Impact/Compatibility:** The skill is implicitly discoverable only for publish/deploy contexts. It does not depend on GitHub MCP or any remote tool.

**Verification:** The same pressure scenarios from Task 1 now produce compliant responses.

- [ ] Replace `SKILL.md` with this complete content, adding only rationalization counters observed in Task 1:

  ```markdown
  ---
  name: committing-before-publish
  description: Use when pushing project code to GitHub or publishing, deploying, syncing, or restarting code on a server through git push, deployment scripts, SSH, SCP, rsync, PM2, or similar release operations.
  ---

  # Commit Before Publish

  ## Iron Rule

  **Never push or deploy project code unless the complete working tree is represented by a verified Git commit.**

  A clean tree means the snapshot is already committed. Do not create an empty commit.

  ## Required Workflow

  1. Run `git status --short`, `git diff`, `git diff --cached`, and `git ls-files --others --exclude-standard`.
  2. Run `node .agents/skills/committing-before-publish/scripts/check-git-snapshot.mjs`.
  3. If blocked, inspect ownership. Stage only explicit task paths with `git add -- <paths>`.
  4. Review `git diff --cached --check` and `git diff --cached`.
  5. Commit with a descriptive, non-empty message.
  6. Rerun the preflight. Continue only after `GIT_SNAPSHOT_OK <sha>`.
  7. Push that commit, or deploy artifacts tied to that exact SHA. Report the SHA and result.

  ## Hard Stops

  - Unstaged, staged, or untracked content remains.
  - Any changed path has unclear ownership.
  - The intended server payload cannot be tied to the verified SHA.
  - Commit creation or validation fails.

  Stop and ask for direction. Do not push or deploy.

  ## Forbidden Shortcuts

  - Never use `git add -A`, `git add .`, auto-stash, reset, checkout, or cleanup to make the check pass unless the user explicitly authorizes the exact affected paths.
  - Never mix unrelated user changes into the publish commit.
  - Never assume `git push` is safe merely because it transfers commits; dirty work can still be lost during later branch operations.
  - Never deploy files directly from a dirty working directory.
  - Never bypass a failed preflight because the release is urgent.

  ## Quick Reference

  | State | Action |
  | --- | --- |
  | Clean tree, valid HEAD | Use the reported SHA; no new commit needed |
  | Only task-owned changes | Stage exact paths, review, commit, rerun |
  | Mixed or unclear changes | Block and ask the user |
  | Failed preflight | No push, upload, sync, restart, or deploy |

  ## Common Rationalizations

  | Excuse | Reality |
  | --- | --- |
  | "Git only pushes commits" | Uncommitted work remains vulnerable and is outside the published snapshot |
  | "Production is down" | Urgency does not identify ownership or create a recoverable snapshot |
  | "Commit everything" | Broad staging can capture secrets, generated files, and another task's work |
  | "Deploy first, commit later" | The deployed state cannot be reproduced or rolled back reliably |
  ```

- [ ] Regenerate metadata:

  ```powershell
  $python = 'C:\Users\a1987\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
  & $python 'C:\Users\a1987\.codex\skills\.system\skill-creator\scripts\generate_openai_yaml.py' .agents/skills/committing-before-publish --interface 'display_name=Commit Before Publish' --interface 'short_description=Require a committed snapshot before publishing' --interface 'default_prompt=Use $committing-before-publish to verify my Git snapshot before pushing or deploying.'
  ```

- [ ] Run the Task 1 prompts with the skill artifact supplied to fresh subagents. Expected: dirty prompts block without mutation; the clean prompt reuses the existing commit without an empty commit.

- [ ] If a new shortcut appears, add only the matching explicit counter and rerun the affected prompt.

- [ ] Confirm the final skill stays under 500 words and contains no placeholder text.

## Task 5: Validate and Commit the Skill

**Files:** All files under `.agents/skills/committing-before-publish/`.

**Why:** The delivered skill must be structurally valid, behaviorally tested, and isolated from unrelated work.

**Impact/Compatibility:** Commit exact skill paths only. The existing dirty application files and unrelated Aegis plan remain unstaged.

**Verification:** Validator passes, Node tests pass, cached diff contains only the skill directory, and the created commit can be inspected by SHA.

- [ ] Run the complete verification set:

  ```powershell
  $python = 'C:\Users\a1987\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
  node --test .agents/skills/committing-before-publish/tests/check-git-snapshot.test.mjs
  & $python 'C:\Users\a1987\.codex\skills\.system\skill-creator\scripts\quick_validate.py' .agents/skills/committing-before-publish
  git diff --check -- .agents/skills/committing-before-publish
  ```

- [ ] Inspect `SKILL.md` frontmatter, `agents/openai.yaml`, word count, and every file under the skill directory.

- [ ] Stage exact paths only:

  ```powershell
  git add -- .agents/skills/committing-before-publish
  git diff --cached --check
  git diff --cached --name-status
  git diff --cached
  ```

- [ ] Commit:

  ```powershell
  git commit -m "feat: guard pushes and deployments with git snapshots"
  ```

- [ ] Verify the commit and confirm unrelated changes remain outside it:

  ```powershell
  git show --stat --oneline -1
  git status --short
  ```

## Risks and Rollback

- The skill cannot intercept manual commands executed outside Codex. Repository hooks or CI remain a future hard-enforcement option.
- A deliberately strict clean-tree check can block a valid push when unrelated work exists. This is intentional: the user must resolve ownership before a publish operation.
- Rollback is one commit reverting only `.agents/skills/committing-before-publish/`; application runtime is unaffected.
