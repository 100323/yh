# Scheduler Command Observability Design

Date: 2026-07-15  
Status: Approved design, awaiting written-spec review

## 1. Task Intent Draft

### Outcome

Add low-overhead observability to the production backend's normal scheduler and persistent batch scheduler so operators can measure real command rate, task-to-command amplification, queue wait, response latency, and rate-limit symptoms before changing concurrency or throttling.

### Scope

- Backend normal persistent scheduler.
- Backend persistent batch scheduler.
- Shared account coordinator and backend `GameClient` transport boundary.
- SQLite aggregation and anomaly persistence.
- Admin-only read APIs and a read-only administration page.

### Risks

- Instrumentation could add event-loop or SQLite pressure.
- Sensitive game or proxy data could leak into diagnostics.
- Instrumentation failures could accidentally affect task outcomes.
- Metrics can be misleading if execution lane and actual egress are conflated.

## 2. Baseline Read Set Hint

Implementation and review should begin with:

- `AGENTS.md`
- `docs/aegis/baseline/2026-07-15-initial-baseline.md`
- `backend/src/scheduler/index.js`
- `backend/src/batchScheduler/index.js`
- `backend/src/utils/accountTaskCoordinator.js`
- `backend/src/utils/taskExecutionControl.js`
- `backend/src/utils/gameClient.js`
- `backend/src/database/index.js`
- `backend/src/routes/stats.js`
- frontend router, navigation, API wrapper, and the closest existing admin status page

## 3. Impact Statement Draft

### Affected layers

- Scheduler triggers and task lifecycle wrappers.
- Account queue acquisition and release.
- WebSocket command send/settle lifecycle.
- SQLite schema, aggregation writes, retention maintenance, and read queries.
- Admin API and frontend navigation/view layers.

### Canonical owners

- Runtime metric context and aggregation: a new isolated backend observability module.
- Persistence and aggregate queries: database-facing observability repository.
- Actual command lifecycle: `GameClient` remains the transport owner and emits observations at its existing send boundary.
- Queue lifecycle: `accountTaskCoordinator` remains the queue owner and emits queue timing observations.

### Invariants

- `runAccountTaskExclusive(...)` remains mandatory.
- Existing stagger, throttle, retry, warmup, reconnect, and delayed-claim behavior remains unchanged.
- Observability is best-effort and cannot fail game work.
- Actual egress is derived from the connected client, not from the scheduling lane.

### Non-goals

- No IP-level rate limiter or adaptive throttling.
- No proxy behavior correction.
- No durable scheduler queue.
- No browser/manual task instrumentation.
- No alerts, notifications, pause controls, or concurrency controls.
- No new charting dependency.

## 4. Alternatives Considered

### A. Console logs only

Lowest implementation cost, but logs are difficult to aggregate, retention is deployment-dependent, and command-rate or amplification analysis is unreliable.

### B. Persist every command event

Highest fidelity, but 3,500 task runs can expand into tens of thousands of commands per day. Per-command SQLite writes and indexes would add avoidable storage and event-loop pressure.

### C. In-memory aggregation plus bounded anomaly details

Selected approach. Every command contributes to compact minute buckets; only actionable anomalies are stored as individual records. It preserves the diagnostic signals required for rate-limit design while bounding write amplification and database growth.

## 5. Architecture

```text
normal scheduler / batch scheduler
              |
              v
task observation context
(source, account, task type, run id, lane)
              |
              +----------------------+
              v                      v
account queue lifecycle       GameClient command lifecycle
(wait/start/end/outcome)       (sent/response/error/timeout)
              |                      |
              +----------+-----------+
                         v
               in-memory minute buckets
               + bounded anomaly queue
                         |
                  every 10 seconds
                         v
                short SQLite transaction
                         |
                         v
              admin-only query API and UI
```

The observability module is a passive sink. Producers call narrow, synchronous, non-throwing observation functions. Persistence runs outside the game-command call stack on a timer.

## 6. Context Propagation

Use Node `AsyncLocalStorage` to associate nested game commands with an observation context without mutating shared clients or changing every task helper signature.

Context fields:

- `runId`: random non-secret identifier for correlation.
- `source`: `scheduler`, `scheduler-catchup`, or `batch`.
- `accountId`.
- `taskType`.
- `executionLane`: `direct` or `proxy` as selected by the coordinator.
- optional batch task ID.

Commands without task context, including warmup and heartbeat work, are still counted with a system/unattributed category because they consume the same egress budget. System commands must be separable in API results and UI filters.

## 7. Observation Points

### Task lifecycle

Both scheduler implementations wrap the smallest existing task execution boundary with a task context and emit start/settle events. Outcomes are normalized to success, ignored, error, timeout, disconnected, or rate-limited without changing the original return or throw behavior.

### Account queue lifecycle

`runAccountTaskExclusive` measures time from slot request to acquisition and records lane, active count, and queue wait. Existing queue behavior is not changed.

### Command lifecycle

`GameClient.sendWithPromise` records:

- command accepted for immediate sending;
- actual `ws.send` timestamp;
- response settlement and latency;
- timeout, disconnection, and game/protocol error outcomes.

`GameClient.send` records fire-and-forget sends. Heartbeats are included as system commands, not business commands. No timer or Promise semantics are changed.

Actual egress metadata is derived from the client:

- direct: a constant anonymous `direct` key;
- proxy: a short SHA-256 fingerprint of normalized protocol, host, and port;
- raw proxy addresses are never persisted or returned.

The selected execution lane is stored separately from actual egress so mismatches are measurable rather than hidden.

## 8. Aggregation Model

### Command minute metrics

Group by:

- UTC minute bucket;
- source;
- business/system command class;
- task type;
- command;
- execution lane;
- actual egress type and anonymous fingerprint;
- outcome.

Store additive values:

- command count;
- error, timeout, disconnected, and rate-limited counts;
- latency count, total, and maximum.

### Task minute metrics

Group by minute, source, task type, lane, and outcome. Store:

- run count;
- duration count, total, and maximum;
- queue-wait count, total, and maximum;
- attributed command count.

Task-to-command amplification is calculated as attributed command count divided by run count for the selected range.

### Runtime self-metrics

Expose without creating recursive observation events:

- pending metric keys;
- pending anomalies;
- last successful flush time and duration;
- flush failure count;
- dropped metric and anomaly counts.

## 9. Anomaly Details

Persist an individual anomaly only for:

- recognized official rate-limit or too-fast responses;
- command timeout;
- WebSocket disconnection during a pending command;
- response latency greater than or equal to 5 seconds;
- an unclassified command error.

Allowed fields:

- occurrence time and run ID;
- account ID;
- source, task type, and command;
- execution lane and anonymous actual egress;
- anomaly category, numeric error code, latency, and queue wait;
- sanitized error summary capped at 300 characters.

Sanitization removes URL query strings, token-like values, long encoded strings, and control characters. It must run before data enters the anomaly buffer.

## 10. Persistence and Retention

Create three idempotent schema surfaces:

- `command_metric_minutes`;
- `task_metric_minutes`;
- `command_anomalies`.

Use unique keys for aggregate dimensions and `INSERT ... ON CONFLICT DO UPDATE` inside one short transaction per flush. Flush every 10 seconds using snapshot-and-swap so new observations continue accumulating while a snapshot is written.

Failure behavior:

- a failed snapshot is merged back once if capacity permits;
- buffers have hard limits;
- oldest data is dropped when limits are exceeded;
- failures and drops increment self-metrics and produce rate-limited console warnings;
- no persistence exception reaches a scheduler or game command.

Retention:

- all minute metrics: 3 days;
- all anomaly details: 3 days and at most 50,000 rows;
- aggregate tables also have defensive row caps sized during implementation load tests;
- time or row limit, whichever is reached first, removes oldest rows;
- cleanup runs through the existing daily database-maintenance job, never per command;
- existing weekly `VACUUM` remains in place;
- the first release does not change SQLite journal mode or WAL settings.

## 11. API Design

Add admin-only endpoints under the existing stats surface:

- `GET /api/stats/observability/summary`
- `GET /api/stats/observability/anomalies`

Summary query parameters:

- range: `1h`, `6h`, `24h`, `3d`;
- optional source, task type, command class, and egress type.

The response contains headline values, time-series buckets, task breakdown, egress breakdown, and runtime self-metrics. The anomaly endpoint requires bounded page size and cursor or offset pagination.

The endpoints must apply both existing authentication and `adminOnly`. Range input is allow-listed; query dimensions are parameterized. No endpoint accepts arbitrary SQL grouping or sorting fields.

## 12. Administration Page

Add an admin-only `Scheduler Observability` route and menu item using existing frontend routing and layout conventions.

The first version is read-only and contains:

- headline metrics: current command rate, selected-range peak, rate-limit count, timeout count, average response latency, and maximum account queue wait;
- a lightweight command/anomaly trend without a new chart library;
- task table: runs, commands, amplification, average/maximum latency, and anomaly rate;
- egress table: direct/anonymous proxy fingerprint, command volume, and anomaly rate;
- recent anomaly table: time, account, task, command, category, code, and latency;
- filters for `1h`, `6h`, `24h`, and `3d` plus source/task/egress dimensions;
- 30-second polling and a visible last-refresh timestamp;
- visible observer health: dropped events, flush failures, and last successful flush.

## 13. Configuration

Introduce bounded environment-backed settings with conservative defaults:

- enabled flag;
- 10-second flush interval;
- 5-second slow-command threshold;
- three-day retention;
- metric-key, anomaly-buffer, and persisted-row caps.

The deployment documentation must show how to enable or disable observation. Disabling observation performs no persistence or timers and adds only a fast guard at producer call sites.

## 14. Error Classification

Classification uses structured game error codes first and sanitized message patterns second. Categories are stable API values, not localized display text.

Unknown errors remain `command_error`; the observer must not reinterpret ignored business outcomes or alter existing retry decisions. Classification logic is independently tested and reusable by later rate-limiter design, but it does not become an execution authority in this release.

## 15. Testing

### Unit tests

- error classification and slow-response classification;
- sanitizer redaction and truncation;
- egress fingerprint stability without address disclosure;
- minute bucket grouping and additive merges;
- amplification calculations;
- memory and persistence caps;
- snapshot re-merge and drop behavior after write failures.

### Integration tests

- successful, business-error, timeout, disconnection, and slow command lifecycles;
- normal and batch task context association;
- unattributed warmup and heartbeat accounting;
- queue-wait measurement without queue-order changes;
- admin-only API authorization, range validation, aggregation, and pagination;
- observer-disabled behavior.

### Load and regression tests

- simulate 100,000 observation events and prove writes scale with aggregate keys rather than command count;
- measure bounded memory and flush duration;
- run backend tests;
- run frontend build and type-check;
- verify account serialization, stagger, retry, reconnect, and delayed daily-reward claim behavior remains unchanged.

## 16. Rollout and Success Criteria

Roll out without changing scheduler concurrency, dispatch intervals, stagger windows, retries, or task definitions.

Sequence:

1. deploy schema and observer with its production flag explicitly enabled;
2. verify observer health, database growth, flush duration, and API access;
3. observe at least one complete daily cycle, preferably 24–72 hours;
4. use the collected peak rate, amplification, egress, and anomaly data to design the later IP-level rate limiter.

Success means:

- operators can identify which source, task, command, and actual egress drives command peaks and anomalies;
- command and task execution behavior is unchanged;
- observer failures never fail tasks;
- storage remains bounded by three-day retention and row caps;
- no sensitive tokens, parameters, bodies, or proxy addresses are persisted or returned.

## 17. Compatibility and Retirement

This feature adds a new passive owner for metrics; it does not replace existing task logs or system-status data. Existing logs remain the business audit surface, while observability tables are operational aggregates.

No old execution path is retired in this release. A later review may consolidate duplicate scheduler task executors or reuse error classification for active throttling, but those changes require separate designs and regression coverage.

## 18. Spec Self-Review

- Placeholder scan: no TBD or TODO items remain.
- Consistency: three-day retention is used for both metrics and anomalies throughout.
- Scope: backend scheduler observation only; browser and active rate limiting are explicit non-goals.
- Ambiguity: actual egress and execution lane are separate dimensions.
- Boundary: passive, non-throwing behavior and sensitive-data exclusions are explicit.
