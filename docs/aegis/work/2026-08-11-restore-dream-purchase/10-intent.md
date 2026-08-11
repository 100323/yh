# Restore Dream Purchase Configuration

## Requested outcome

Restore the previously implemented dream purchase configuration, commit it, push it to GitHub, and deploy it to all three production servers.

## Scope

- Restore shared dream opening weekdays and gold-item defaults.
- Restore checkbox-based frontend configuration and array mapping.
- Restore backend scheduled-task migration and batch execution routing.
- Verify, commit only task-related changes, push, and deploy.

## Non-goals

- Do not modify or stage existing scheduler observability, smart car, or temporary workspace changes.
- Do not alter the existing `gameClient.buyDreamItems()` implementation unless verification proves it is required.

## Baseline and risks

- Current branch is `codex/tower-floor-limits`, ahead of its remote by four commits.
- Existing unrelated modifications are present in the worktree and must remain untouched.
- Deployment requires preserving server data and restarting the PM2 backend only after backups and verification.
