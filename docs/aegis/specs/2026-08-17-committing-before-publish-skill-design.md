# Commit Before Publish Skill Design

## Intent

Create a project-local Codex skill that protects work before code is pushed to GitHub or deployed to a server. Every publish operation must use an existing Git commit as its source of truth so uncommitted work cannot be lost or overwritten by branch operations.

## Scope

- Add the project skill at `.agents/skills/committing-before-publish/`.
- Trigger it for GitHub pushes and server publish/deploy operations, including workflows using `git push`, `ssh`, `scp`, `rsync`, PM2, or deployment scripts.
- Add a cross-platform Node preflight script that rejects a missing Git repository, missing `HEAD`, or any tracked, staged, or untracked working-tree changes.
- Require agents to inspect changes, stage only task-owned paths, create a descriptive commit, and rerun the preflight before publishing.
- Record the exact commit SHA used for server deployment.

## Workflow

1. Detect that a push or server deployment is about to occur.
2. Run the preflight script from the repository root.
3. If the tree is dirty, stop publishing and inspect `git status`, staged diff, unstaged diff, and untracked files.
4. Separate task-owned changes from unrelated user work. Never use broad staging when ownership is unclear.
5. Stage only intended paths, review the staged diff, and create a non-empty descriptive commit.
6. Rerun the preflight and obtain the current commit SHA.
7. Push that commit or deploy artifacts associated with that SHA.
8. Report the commit SHA and publish result.

## Components

### Skill Instructions

`SKILL.md` owns the decision rules, commands, failure behavior, red flags, and rationalization counters. Its description is optimized to trigger before GitHub pushes and server deployments.

### UI Metadata

`agents/openai.yaml` exposes a concise display name and default prompt consistent with the skill instructions.

### Deterministic Preflight

`scripts/check-git-snapshot.mjs` performs read-only Git checks and exits non-zero when publishing would not be based on a complete commit. It never stages, commits, stashes, resets, switches branches, pushes, or deploys.

## Failure Handling

- Dirty worktree: block and list the status entries without changing them.
- Unrelated changes: leave them untouched and ask for direction if they prevent a clean publish snapshot.
- No commit or detached repository state without a resolvable `HEAD`: block.
- Commit failure or hook rejection: block publishing and report the exact failure.
- Deployment source cannot be tied to the verified SHA: block server deployment.

## Safety Invariants

- Never run `git add -A`, `git add .`, or equivalent broad staging without explicit user authorization and verified ownership of every path.
- Never create an empty commit merely to satisfy the rule.
- Never auto-stash, reset, discard, or overwrite unrelated work.
- Never push or deploy after a failed preflight.
- A clean tree means the current snapshot is already committed; it does not require another empty commit.

## Verification

- Baseline pressure scenarios demonstrate that an agent without the skill may push a clean-looking branch while ignoring unstaged or untracked work, broadly stage unrelated changes, or deploy from an unverifiable working tree.
- Forward scenarios verify that the skill blocks all dirty states, commits only explicitly owned paths, refuses ambiguous ownership, and reports the verified SHA.
- Script tests cover clean, staged, unstaged, untracked, unborn-branch, and non-repository fixtures.
- Run the official skill validator and confirm `agents/openai.yaml` matches `SKILL.md`.

## Compatibility Boundary

The skill does not replace GitHub branch protection, repository hooks, CI/CD checks, or server-side deployment controls. Existing application runtime behavior, deployment scripts, and Git configuration remain unchanged.

## Non-Goals

- No MCP server or external service integration.
- No automatic push or deployment.
- No automatic commit of all repository changes.
- No installation of global Git hooks.
- No modification of application source code.

## Working Artifacts

### TaskIntentDraft

Protect project code from being lost or overwritten by requiring a committed Git snapshot before GitHub push or server deployment.

### BaselineReadSetHint

`AGENTS.md`, repository status and remotes, `.agents/`, `scripts/update-server.sh`, and the Aegis workspace governance files.

### ImpactStatementDraft

The change affects agent workflow metadata and a read-only Git preflight tool. It does not alter frontend, backend, protocol, scheduler, database, or deployment runtime ownership.
