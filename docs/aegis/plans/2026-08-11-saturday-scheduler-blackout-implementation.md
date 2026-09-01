# Saturday Scheduler Blackout Implementation Plan

## Goal

Implement the approved Saturday automatic-execution blackout: each user's default-enabled policy prevents new automatic task logins from Saturday 20:00:00 until 21:00:00 in `Asia/Shanghai`; normal, catch-up, and batch work is persisted for replay after 21:00. Running work and manual execution remain unchanged.

## Architecture

The shared backend `saturdaySchedulerBlackout` module owns local-time evaluation, effective user policy lookup, deferred-run persistence, idempotent claiming, and replay ordering. The normal and batch schedulers remain owners of their executors, connection setup, logs, account locks, throttles, and retries. They ask the shared module for automatic admission before they can start or reuse a game connection.

## Tech Stack

- Node.js ESM and Node built-in test runner.
- Express routes, `node-cron`, and SQLite through the existing database wrapper.
- Vue 3 / Naive UI task configuration page.

## Baseline and Authority

- `docs/aegis/specs/2026-08-08-saturday-scheduler-blackout-design.md`
- `docs/aegis/baseline/2026-07-15-initial-baseline.md`
- `backend/src/scheduler/index.js`
- `backend/src/batchScheduler/index.js`
- `backend/src/routes/tasks.js`
- `backend/src/database/index.js`
- `frontend/src/views/Tasks.vue`

## Compatibility Boundary

- Keep `runAccountTaskExclusive(...)`, lane selection, stagger, retries, warmup, reconnect, delayed reward claims, and task log ownership unchanged.
- Do not interrupt an execution already admitted before the blackout.
- Only automatic scheduled/catch-up/batch execution is gated. Manual `/tasks/execute` and manual `/batch-scheduler/:id/execute` remain ungated.
- Preserve strict planned-time ordering for deferred work within one account while preserving existing cross-account concurrency.

## File Map

| File | Change |
| --- | --- |
| `backend/src/utils/saturdaySchedulerBlackout.js` | New policy, time-window, persistence, idempotency, claim, and replay-order helpers. |
| `backend/src/database/index.js` | Create policy and deferred-run tables plus indexes in existing schema initialization. |
| `backend/src/routes/tasks.js` | Add current-user policy read/write endpoints. |
| `backend/src/scheduler/index.js` | Gate scheduled and catch-up admission, run the 21:00/recovery replay job, and replay normal records through existing account batching. |
| `backend/src/batchScheduler/index.js` | Gate batch cron admission and expose a batch deferred-run replay function without gating manual execution. |
| `frontend/src/stores/task.js` | Add policy fetch/update API calls. |
| `frontend/src/views/Tasks.vue` | Render and save the user-scoped, default-enabled policy switch separately from account task configurations. |
| `backend/test/saturdaySchedulerBlackout.test.js` | Unit coverage for time boundaries, policy defaults, deduplication, ordering, and durable claims. |
| `backend/test/schedulerBlackoutAdmission.test.js` | Integration coverage for automatic normal/batch/catch-up admission and manual bypass using injected scheduler seams. |

## Ripple Signal Triage

- Owner expansion: one shared policy module replaces duplicated normal/batch time checks.
- Downstream expansion: normal scheduler, batch scheduler, catch-up scheduling, task API, and task page all consume the policy.
- Contract expansion: task route gains user-scoped policy endpoints; no existing request payload changes.
- Source-of-truth: SQLite is authoritative for policy and deferred work; process timers are only triggers.
- Verification expansion: unit, admission-path integration, backend regression, and frontend build/type-check are required.

## Task 1: Add Schema and Pure Policy Tests

Files:

- Create `backend/src/utils/saturdaySchedulerBlackout.js`.
- Modify `backend/src/database/index.js`.
- Create `backend/test/saturdaySchedulerBlackout.test.js`.

Why: Establish one authoritative, restart-safe implementation for the window decision and deferred-run lifecycle before a scheduler consumes it.

Impact/Compatibility: The new tables are additive. Effective policy is `enabled` when a user has no explicit row, so existing users are automatically protected without migration writes.

1. Write failing tests for `isSaturdayBlackout(date)`, covering Shanghai local Saturday 19:59:59, 20:00:00, 20:59:59, 21:00:00, and a non-Saturday instant. Add tests that `getEffectivePolicy` defaults to enabled, an explicit disabled row overrides it, `deferRun` deduplicates by business date/source/reference/planned time, and ordered records sort by planned time then insertion ID.
2. Run `pnpm --dir backend test -- saturdaySchedulerBlackout.test.js` and confirm the tests fail because the module and schema helpers do not exist.
3. Implement only the helpers required by the tests. Use `Intl.DateTimeFormat` with `Asia/Shanghai` instead of server-local time. Create additive `scheduler_execution_policies` and `scheduler_deferred_runs` tables with foreign keys, a unique deferred-run identity, status indexes, and a lease-based atomic claim/update helper. Export narrow functions for policy lookup/update, admission deferral, pending-run lookup, claim, complete, and release-on-error.
4. Re-run `pnpm --dir backend test -- saturdaySchedulerBlackout.test.js` and confirm it passes.
5. Run `pnpm --dir backend test -- towerTaskConfig.test.js accountTaskCoordinator.test.js` to verify existing configuration and coordinator behavior remains intact. Commit this slice separately.

## Task 2: Expose the Default-Enabled User Policy

Files:

- Modify `backend/src/routes/tasks.js`.
- Modify `frontend/src/stores/task.js`.
- Modify `frontend/src/views/Tasks.vue`.
- Extend `backend/test/saturdaySchedulerBlackout.test.js` or add `backend/test/taskPolicyRoute.test.js` for route-helper contract tests.

Why: Users need a visible, durable switch for the policy. A user-scoped policy covers both per-account normal tasks and historical batch schedules without adding a pseudo game task to every account.

Impact/Compatibility: The switch loads independently of account selection and saving it does not update `task_configs`, cron expressions, or batch schedules.

1. Write failing tests for the policy response shape: `saturdayBlackoutEnabled` is true for a user without a stored override, and a validated update persists false/true only for the authenticated user.
2. Run the target backend test and confirm the policy API/helper test fails.
3. Add authenticated `GET /api/tasks/policy` and `PUT /api/tasks/policy` endpoints. Validate that the body contains a boolean; return the effective value. Add `fetchSchedulerPolicy` and `updateSchedulerPolicy` to the task store. Add a compact policy row above account selection in `Tasks.vue` with a Naive UI switch, a save command, loading/error state, and text that limits scope to automatic Saturday execution. Do not add it to the per-account task payload loop.
4. Re-run the target backend test and confirm it passes.
5. Run `pnpm --dir frontend build` and `pnpm --dir frontend typecheck`; confirm the page compiles without changing account task serialization. Commit this slice separately.

## Task 3: Gate and Persist Normal Scheduled and Catch-up Work

Files:

- Modify `backend/src/scheduler/index.js`.
- Extend `backend/test/schedulerBlackoutAdmission.test.js`.

Why: A cron callback is not sufficient because an account can wait for an execution slot before connecting. The normal scheduler must check at both scheduling and pre-connection admission points.

Impact/Compatibility: Only `source: 'scheduler'` and `source: 'scheduler-catchup'` use the admission policy. Existing manual `executeTask` callers preserve the default `manual` source and bypass it.

1. Write failing tests that a scheduled normal task at Saturday 20:00 becomes one pending record and does not call the connection factory; a duplicate callback keeps one record; a task queued before 20:00 is deferred at the inner admission point; catch-up admission is deferred; and an explicit manual execution remains admitted.
2. Run `pnpm --dir backend test -- schedulerBlackoutAdmission.test.js` and confirm the scheduler admission tests fail.
3. Add a small source-aware admission option to scheduler enqueue/execute paths. At cron arrival, persist a normal deferred record immediately when the blackout applies. At the existing execution path just before `buildTaskConnectionContext`/`ensureConnectedClient`, re-check automatic admission and defer if time crossed into the blackout. Keep `runAccountTaskExclusive` and its lane option unchanged. Have catch-up use source `scheduler-catchup` and the same admission helper. Record an informational deferral log without marking the task successful or failed.
4. Re-run `pnpm --dir backend test -- schedulerBlackoutAdmission.test.js` and confirm normal, queued, catch-up, and manual cases pass.
5. Run `pnpm --dir backend test -- accountTaskCoordinator.test.js taskExecutionControl.test.js` to verify locks and flow-control behavior. Commit this slice separately.

## Task 4: Gate Persistent Batch Cron Work Without Affecting Manual Batch Runs

Files:

- Modify `backend/src/batchScheduler/index.js`.
- Extend `backend/test/schedulerBlackoutAdmission.test.js`.

Why: The historical batch scheduler has a separate cron entry and must not bypass the user-level policy.

Impact/Compatibility: Only the `node-cron` callback is gated. The route's manual `executeBatchTask(task)` invocation remains unchanged.

1. Write failing tests that a batch cron invocation during the window persists a single batch deferred record and never reaches `executeBatchTask`; duplicate callbacks remain idempotent; manual batch execution is admitted.
2. Run `pnpm --dir backend test -- schedulerBlackoutAdmission.test.js` and confirm batch assertions fail.
3. In `scheduleBatchTask`, perform shared automatic admission after existing stagger behavior but before `executeBatchTask`. On deferral write a batch informational log and update the next-run marker normally. Add an explicit source/options argument to `executeBatchTask` only where needed so manual callers still bypass the policy and running-task protection remains unchanged.
4. Re-run the target test and confirm normal and batch assertions pass.
5. Run `pnpm --dir backend test -- smartSendCarDelay.test.js` plus any existing batch scheduler tests discovered in the repository. Commit this slice separately.

## Task 5: Replay and Post-Restart Recovery

Files:

- Modify `backend/src/scheduler/index.js`.
- Modify `backend/src/batchScheduler/index.js`.
- Extend `backend/test/schedulerBlackoutAdmission.test.js`.

Why: Deferral is useful only if records replay exactly once after 21:00 and survive a backend restart.

Impact/Compatibility: The new 21:00 cron/recovery job adds work only for pending deferred records. It re-enters existing executors rather than duplicating game commands or connection code.

1. Write failing tests for a Saturday 21:00 replay: normal records for one account run in planned-time/insertion order through the existing account-batch path; batch records run in planned-time order; a claimed/completed record does not rerun; a pending post-window record is replayed by recovery; and an execution failure releases or records an attempt without losing the record.
2. Run `pnpm --dir backend test -- schedulerBlackoutAdmission.test.js` and confirm replay tests fail.
3. Add a Saturday `21:00` cron job in the normal scheduler and invoke the same bounded recovery function during initialization/refresh. Claim records atomically before dispatch. Route normal records to the existing account batch enqueue/flush path with a replay source, preserving per-account sequence; route batch records to a narrow exported batch replay function that uses its existing executor. Complete or release records only after each original executor settles. Do not make replay a new account coordinator or client owner.
4. Re-run the target test and confirm replay/recovery assertions pass.
5. Run `pnpm --dir backend test` and inspect failures individually before changing code. Commit this slice separately.

## Task 6: End-to-End Regression and Documentation Closure

Files:

- Modify `docs/aegis/specs/2026-08-08-saturday-scheduler-blackout-design.md` only if implementation evidence requires a precise compatibility clarification.
- Modify `docs/aegis/INDEX.md` only if a follow-up record is created.

Why: Verify the implementation against the approved behavior rather than treating unit coverage as sufficient.

Impact/Compatibility: No unrelated refactor or retirement is authorized. Historical batch scheduling remains supported and now shares the blackout policy.

1. Run `pnpm --dir backend test` and record the command, exit code, and relevant target-test coverage.
2. Run `pnpm --dir frontend build` and `pnpm --dir frontend typecheck`.
3. Start the backend with its supported Node runtime and verify through authenticated API requests that policy defaults to true, disabling affects only that user, and re-enabling takes effect without editing task configurations. Do not use a production token or trigger a real game task.
4. Perform a deterministic test-clock/manual helper check for Saturday 20:00 and 21:00 boundaries; verify no game client factory is called during the window, automatic records are persisted once, and manual execution bypasses the policy.
5. Review `git diff --check`, verify staged paths exclude unrelated user edits, document residual environment limitations, and commit the final implementation.

## Risks and Rollback

- Incorrect time conversion could block work outside the window. Unit tests must use explicit UTC instants and Shanghai assertions.
- A scheduler restart near 21:00 can cause duplicate replay without atomic record claims. The unique key and claim state are mandatory.
- Existing task starts queued before 20:00 require the inner admission check; cron-only logic is not acceptable.
- Rollback is additive: disable a user's policy to immediately bypass future admissions, then deploy a rollback that leaves additive tables unused. Deferred records are retained for diagnosis rather than deleted automatically.

## Retirement Track

No existing executor, scheduler, or fallback is retired. The rejected duplicate normal/batch blackout checks are never introduced; `saturdaySchedulerBlackout` is the one canonical owner for time and persistence rules.

## Plan Self-Review

- Spec coverage: Tasks 1-5 cover policy, persistence, normal, catch-up, batch, replay, recovery, UI, and manual boundaries.
- Placeholder scan: no implementation placeholders remain.
- Type consistency: all automatic admission uses a source and planned time; manual callers omit the automatic source.
- Compatibility: account locks, clients, retries, and manual operations are explicitly preserved.
- Verification: every implementation slice has a failing-test command and a passing-test command.
