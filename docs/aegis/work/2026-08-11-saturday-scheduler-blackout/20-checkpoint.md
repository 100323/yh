# Saturday Scheduler Blackout Checkpoint

## Completed

1. Added a Shanghai-local Saturday 20:00-21:00 automatic-execution policy, default enabled per user.
2. Added durable deferred-run policy and queue tables, idempotent records, replay claims, and stale-claim recovery.
3. Added authenticated policy read/write endpoints and the independent task-page switch.
4. Gated normal scheduler, catch-up admission, and batch cron admission while leaving manual execution paths unchanged.
5. Added Saturday 21:00 replay plus startup recovery; normal work remains ordered per account and uses the existing account coordinator.
6. Added pure policy coverage and completed backend/frontend verification.

## Evidence

- `node --test` from `backend/`: 44 passing tests.
- `node --test test/saturdaySchedulerBlackout.test.js` from `backend/`: 6 passing tests, including the claim-lease boundary.
- `frontend/node_modules/.bin/vite.cmd build`: production build completed.
- `frontend/node_modules/.bin/tsc.cmd --noEmit -p tsconfig.typecheck.json`: completed without errors.
- `node --check` passed for the changed scheduler and blackout modules.

## Residual Risk

- The current Node 24 environment cannot load the local `better-sqlite3` native binding, so the new SQLite policy/deferred-run state transitions were validated by static review and pure tests rather than a live database integration test.
- Git index writes remain blocked by the environment; the implementation cannot be staged or committed from this session.

## Drift Check

- Scope remains limited to automatic scheduler admissions, durable replay, and the user policy switch.
- Existing account exclusivity, lanes, throttles, retries, reconnect, and manual execution paths are retained.
- No existing scheduler path was retired.
