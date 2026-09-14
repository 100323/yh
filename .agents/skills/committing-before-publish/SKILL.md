---
name: committing-before-publish
description: Use when pushing to GitHub or deploying a frontend, backend, static build, server bundle, or PM2 service; require an explicit branch, committed SHA, verified build manifest, and safe publish order before any push, upload, sync, restart, or production directory switch.
---

# Commit Before Publish

Publishing must be reproducible from one explicit Git commit. Treat GitHub push and server deployment as separate operations, and stop before either one when the source or artifact cannot be proven.

## Workflow

1. Identify the release source branch and exact commit. Do not silently use `main`, a server checkout, a detached worktree, or the current branch when the user named another source.
2. Inspect `git status --short`, staged and unstaged diffs, untracked files, and `git branch -vv`. Separate task-owned files from unrelated work.
3. Never use `git add .`, `git add -A`, auto-stash, reset, checkout, cleanup, force-push, or a server-side `git pull`/`reset --hard` to make publishing convenient. Stage only exact task paths after ownership is clear.
4. Build from the verified commit. Generate a release manifest containing `schemaVersion`, `branch`, `commitSha`, `buildTimestamp`, `entry`, `indexSha256`, `entrySha256`, and `requiredMarkers`.
5. Run the read-only gate from the repository root:

   `node .agents/skills/committing-before-publish/scripts/release-preflight.mjs --expected-branch <branch> --build-dir <dist> --manifest <dist>/release-manifest.json`

   Add `--remote-manifest <path>` when an existing production manifest is available. A non-zero result is a hard stop.
6. Publish only the artifact tied to the reported `commitSha`. Upload to a temporary server directory, verify its manifest and required markers there, then switch directories atomically. Keep the previous directory as a timestamped rollback copy.
7. Push the exact commit separately from deployment. Never deploy from a server working tree that may contain another branch's code or local edits.
8. After publishing, fetch the real HTTP `index.html` and its referenced entry bundle. Verify the entry, hashes where available, and every required marker. Report branch, SHA, manifest, backup path, and verification result.

## Hard Stops

- Working tree is dirty, ownership is unclear, or `HEAD` is missing.
- Current branch differs from the explicit release branch.
- Manifest SHA, branch, entry hash, or build hash does not match.
- Required game/plugin/script markers are missing.
- Remote manifest is newer, from another branch, or cannot be compared.
- Build or upload cannot be tied to the verified SHA.

Do not continue with `git push`, `scp`, `rsync`, `ssh` deployment commands, `pm2 restart`, or a production directory replacement after a hard stop. Report the exact blocking evidence instead.

## Recovery Rules

Preserve unrelated user changes. If only the release task is dirty, stage its exact paths, review `git diff --cached --check` and `git diff --cached`, create a descriptive non-empty commit, then rerun the gate. If unrelated changes remain, leave them untouched and ask for a clean release boundary; do not mix them into the release commit.

## Tool

`release-preflight.mjs` is read-only. It validates Git repository state, branch, clean snapshot, build directory, manifest, hashes, required text markers, and an optional remote manifest. It never stages, commits, pushes, uploads, restarts, resets, or deletes application data.
