# Saturday Scheduler Blackout Design

Date: 2026-08-08
Status: Approved design, awaiting written-spec review

## 1. Task Intent Draft

### Outcome

Add a user-scoped, default-enabled automatic-execution policy that prevents new automated game logins and task starts every Saturday from 20:00:00 through 20:59:59 in the `Asia/Shanghai` timezone. Automatically triggered work deferred by the policy is durably replayed after 21:00 in its original task order.

### Scope

- Normal persistent account task configurations in `backend/src/scheduler/index.js`.
- Persistent batch scheduled tasks in `backend/src/batchScheduler/index.js`.
- Scheduler catch-up work when it reaches an execution admission point during the blackout.
- A shared user-scoped setting, defaulted to enabled, exposed from the task configuration page.
- Durable deferred-run records and a 21:00 replay/recovery job.

### Explicit behavior

- Existing task executions continue; the policy never interrupts a running task or closes a live connection.
- Manual "run now" requests are outside the policy and run normally.
- Automatic work due during the blackout, or queued before it but not yet admitted to connect until the blackout, must not log in during the blackout.
- Normal task configurations replay sequentially per account according to their planned execution time, then stable record order. Existing account concurrency, lane selection, stagger, throttles, retries, warmup, reconnect, and delayed reward claims remain in effect.
- Deferred batch schedules replay in planned-time order. A batch task preserves its current account/task execution behavior after admission.
- A restart cannot lose a deferred run or create a duplicate replay.

## 2. Baseline Read Set Hint

- `AGENTS.md`
- `docs/aegis/baseline/2026-07-15-initial-baseline.md`
- `backend/src/scheduler/index.js`
- `backend/src/batchScheduler/index.js`
- `backend/src/routes/tasks.js`
- `backend/src/routes/batchScheduler.js`
- `backend/src/database/index.js`
- `backend/src/utils/accountTaskCoordinator.js`
- `backend/src/utils/taskExecutionControl.js`
- `frontend/src/views/Tasks.vue`
- `frontend/src/stores/task.js`
- `backend/test/accountTaskCoordinator.test.js`

## 3. Impact Statement Draft

### Affected layers

- User task configuration API and task configuration UI.
- Normal scheduler, batch scheduler, and scheduled catch-up admission paths.
- SQLite schema for user policy and deferred-run state.
- Scheduler recovery and task logging.

### Canonical owners

- Automatic execution blackout decision and deferred-run persistence: a new shared backend scheduling-policy module.
- Normal task admission and replay: `backend/src/scheduler/index.js`.
- Batch task admission and replay: `backend/src/batchScheduler/index.js`.
- Account serialization, lane limits, and command throttles: `backend/src/utils/accountTaskCoordinator.js` remains unchanged as the owner.
- User-facing policy configuration: `backend/src/routes/tasks.js` and `frontend/src/views/Tasks.vue`.

### Invariants

- All scheduler timezone decisions use `Asia/Shanghai`.
- `runAccountTaskExclusive(...)` remains mandatory for actual account work.
- The decision is made again immediately before an automatic execution can open or reuse a game connection; checking only the cron callback is insufficient.
- Manual task execution retains existing behavior.
- Existing queued/running work is never cancelled by this policy.
- A unique deferred-run identity prevents cron callbacks, minute refreshes, restarts, and replay recovery from creating duplicates.

### Non-goals

- No change to task definitions, cron expressions, daily catch-up eligibility, or default task parameters.
- No blanket pause of WebSocket clients, active account queues, or manual tools.
- No change to cross-account concurrency, proxy lanes, retry budgets, or command-rate controls.
- No migration or deletion of the historical batch scheduler feature.

## 4. Alternatives Considered

### A. Duplicate a time check in each scheduler

This has a low initial code cost but duplicates timezone and replay behavior. It cannot reliably protect queued work that only reaches a connection after 20:00, and scheduler restart recovery would drift between normal and batch paths.

### B. Keep deferred work in a process-local timer until 21:00

This is simple but loses work on process restart and cannot provide idempotent replay. It is rejected for persistent automation.

### C. Shared policy plus durable deferred-run queue

Selected. The policy is evaluated by each automatic execution admission path, while a shared SQLite-backed deferred-run queue records exactly what must be replayed. This keeps normal and batch schedulers consistent, preserves restart recovery, and avoids changing connection or account-coordination ownership.

## 5. Data Model and Configuration

Create a user-scoped scheduler policy record with these effective values:

- `saturday_blackout_enabled`: boolean, default `true` for every user without an explicit record.
- fixed window: Saturday 20:00:00 inclusive to 21:00:00 exclusive, Shanghai local time.

The task configuration page shows a single shared switch labeled for the Saturday automatic-execution blackout. It defaults to enabled and affects all of that user's normal and batch scheduled tasks. It is intentionally not represented as a per-account game task because batch schedules are user-scoped.

Create a durable deferred-run table with at least:

- user ID;
- source (`scheduler`, `scheduler-catchup`, or `batch`);
- normal task configuration ID or batch task ID;
- optional account ID and task type for normal tasks;
- original planned time in Shanghai-compatible sortable form;
- stable insertion sequence;
- lifecycle state (`pending`, `running`, `completed`, `failed`);
- replay attempts, timestamps, and a bounded last error summary.

Use a database unique key derived from the business date, source, referenced task, and original planned time. The implementation must create the record with an idempotent insert before reporting a deferral.

## 6. Admission and Replay Flow

```text
scheduled cron / catch-up / batch cron
              |
              v
      automatic execution admission
              |
      +-------+--------+
      |                |
outside blackout    Saturday 20:00-20:59
      |                |
      v                v
existing execution   durable deferred-run record
and connection flow          |
                             v
                  Saturday 21:00 replay/recovery
                             |
                             v
      existing per-account exclusive execution and connection flow
```

Normal scheduler cron callbacks may record a deferral before queueing account work. The normal execution path performs a second admission check after it acquires the account execution opportunity and before it can connect. This closes the race where a task queues before 20:00 but would log in during the blackout.

Batch scheduler cron callbacks use the same admission policy. A deferred batch record represents one scheduled batch invocation, not a copied record for every selected account. Its normal executor retains the existing per-account locking and task order.

Scheduled catch-up work is considered automatic. If it reaches the admission boundary during the window, it becomes a deferred record with source `scheduler-catchup` and re-enters its existing catch-up execution path after 21:00.

At 21:00 every Saturday, a replay job loads pending records in original planned-time order and uses an atomic state transition to claim each record. For normal tasks, records are grouped by account but preserve per-account order before invoking the existing account batch path. Different accounts retain the current lane concurrency and stagger behavior. Batch records are replayed in their original planned-time order through the existing batch executor.

The replay job also runs a bounded recovery scan after startup and during scheduler refresh. It only processes pending blackout records whose release time has passed. Running records with a stale lease are returned to pending according to a defined retry/lease policy; completed records are never replayed.

## 7. Logging and Failure Behavior

When automatic work is deferred, add an informational scheduler or batch log containing the original planned time and the 21:00 release time. Deferral is not a task failure and must not create a misleading failed-task marker.

Replay uses the existing success, ignored, retry, error, next-run, and connection-recovery behavior of its original executor. The deferred record records completion only after that executor settles. A replay failure remains visible in the original task or batch logs and in the deferred-run state for recovery diagnostics.

The existing daily catch-up job at 19:15 is not moved or broadened. It remains an independent missed-work mechanism; only its actual automatic admission is subject to the Saturday blackout.

## 8. API and UI Contract

Add authenticated task-policy read/write endpoints scoped to the current user. The response contains the effective default when no policy row exists so older users see the switch enabled without a manual migration step.

The task configuration page loads the policy independently of the selected account. Saving the policy must not rewrite account task configurations, task crons, or batch schedules. A disabled policy affects future automatic admission immediately; it does not cancel deferred records already created unless the implementation explicitly provides a separate user action, which is out of scope for this release.

## 9. Testing

### Unit tests

- Shanghai-local window classification at 19:59:59, 20:00:00, 20:59:59, 21:00:00, and non-Saturday times.
- default-enabled effective policy and user-specific disable override.
- deferred-run identity deduplication.
- stable replay sorting and per-account grouping.
- replay claim and stale-lease recovery state transitions.

### Scheduler integration tests

- normal cron work due during the window records a deferral and does not instantiate/connect a game client;
- work queued before 20:00 but admitted during the window is deferred before connection;
- an already-running execution is not interrupted;
- 21:00 replay invokes normal tasks in the original per-account order while retaining account exclusivity;
- batch cron work is deferred and replayed once;
- catch-up work admitted during the window is deferred;
- manual normal and manual batch execute endpoints bypass the policy;
- restart/recovery finds pending post-window work exactly once.

### Regression tests

- current account coordinator concurrency, lane, and throttle tests;
- current normal and batch scheduler tests;
- backend test suite;
- frontend build and type check after the policy switch is added.

## 10. Compatibility and Retirement

This design introduces a single policy owner and a durable deferred-run owner. It does not retire normal task logs, batch logs, the 19:15 daily catch-up job, account locks, or existing batch scheduler APIs.

The old duplicate behavior proposed in Alternative A is never added. The policy is intentionally limited to automatically triggered work, so manual operations remain a compatibility boundary.

## 11. Spec Self-Review

- Placeholder scan: no TBD or TODO placeholders remain.
- Consistency: all descriptions use a Shanghai-local Saturday window and apply only to automatic work.
- Scope: normal scheduler, batch scheduler, and catch-up admission are covered; manual execution and active work interruption are explicitly excluded.
- Ambiguity: replay ordering is strict per account, while existing cross-account concurrency is retained.
- Boundary: scheduler ownership, account exclusivity, and connection/retry behavior remain unchanged.
