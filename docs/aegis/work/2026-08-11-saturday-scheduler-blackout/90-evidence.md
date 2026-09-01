# Saturday Scheduler Blackout Evidence

Date: 2026-08-11

## Automated Verification

- `backend: node --test`: passed, 44 tests.
- `backend: node --test test/saturdaySchedulerBlackout.test.js`: passed, 6 tests.
- `backend: node --check src/scheduler/index.js`: passed.
- `backend: node --check src/batchScheduler/index.js`: passed.
- `backend: node --check src/utils/saturdaySchedulerBlackoutStore.js`: passed.
- `frontend: frontend/node_modules/.bin/vite.cmd build`: passed.
- `frontend: frontend/node_modules/.bin/tsc.cmd --noEmit -p tsconfig.typecheck.json`: passed.

## Behavior Covered

- Saturday Shanghai-local blackout boundaries and default-enabled policy.
- Automatic normal, catch-up, and batch source classification; manual source bypass.
- Stable deferred-run identity and replay sorting.
- Replay claim expiry calculation used for stale-claim recovery.
- Existing task coordinator concurrency, reconnect behavior, and smart-send delay regression tests.

## Uncovered Runtime Path

The local Node 24 process cannot load the repository's `better-sqlite3` native binding. SQLite-backed persistence, policy routes, and full scheduler admission/replay integration therefore require verification under the project's supported native dependency runtime.
