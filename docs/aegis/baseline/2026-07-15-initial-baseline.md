# Initial Architecture Baseline

Date: 2026-07-15

## 1. Project Structure

The maintained runtime is the split application:

- `frontend/`: Vue 3 administration UI and browser-triggered manual/batch game tasks.
- `backend/`: Express API, SQLite persistence, cron schedulers, WebSocket game clients, and proxy integration.
- `server/` and `source/`: legacy/reference-only code.

Primary entry points:

- Frontend: `frontend/src/main.js`
- Backend: `backend/src/index.js`

## 2. Technology Stack

- Frontend: Vue 3, Vite, Pinia, Element Plus, Naive UI, Arco Design, and `p-queue`.
- Backend: Node.js ESM, Express, `node-cron`, `ws`, and `better-sqlite3`.
- Protocol: custom BON-encoded WebSocket messages.
- Deployment: one PM2 fork-mode backend process by default.

## 3. Ownership Mapping

| Concern | Current owner |
| --- | --- |
| Normal persistent account scheduling | `backend/src/scheduler/index.js` |
| Persistent batch scheduling | `backend/src/batchScheduler/index.js` |
| Account exclusivity and global account slots | `backend/src/utils/accountTaskCoordinator.js` |
| Staggering and sensitive retry controls | `backend/src/utils/taskExecutionControl.js` |
| Backend game command transport | `backend/src/utils/gameClient.js` |
| Scheduler settings | `backend/src/utils/systemSettings.js` |
| Task definitions and task logs | `backend/src/routes/tasks.js` |
| Batch definitions and batch logs | `backend/src/routes/batchScheduler.js` |
| Database schema and maintenance | `backend/src/database/index.js` |
| Scheduler status API | `backend/src/routes/stats.js` |
| Browser manual task sequencing | `frontend/src/utils/dailyTaskRunner.js` |
| Browser batch helpers | `frontend/src/utils/batch/` |

## 4. Contract Inventory

- `runAccountTaskExclusive(accountId, executor, options)` serializes work per account and caps active accounts by execution lane.
- Scheduler cron semantics use the `Asia/Shanghai` timezone.
- Backend `GameClient.send()` and `sendWithPromise()` are the final command transport boundary.
- Task outcomes are persisted in task logs; normal scheduler outcomes also update execution markers used by daily catch-up.
- Scheduler settings can be changed at runtime through admin APIs and are stored in `system_settings`.
- Existing task delay, retry, reconnect, warmup, and delayed daily-reward claim behavior are runtime compatibility boundaries.

## 5. Dependency Direction

- Routes and schedulers depend on shared task, connection, protocol, and database utilities.
- Game command transport must not depend on scheduler implementations.
- Observability may consume lifecycle events from scheduler and transport layers, but task execution must not depend on observability success.

## 6. Test System

- Backend uses Node's built-in test runner under `backend/test/`.
- Frontend provides build and TypeScript type-check scripts.
- Existing scheduler-focused coverage includes task-type concurrency, command throttling, and queued-client reconnection behavior.

## 7. Build and Deploy

- Backend: `pnpm --dir backend test` and `pnpm --dir backend start`.
- Frontend: `pnpm --dir frontend build` and `pnpm --dir frontend typecheck`.
- PM2 runs a single backend instance in fork mode; in-memory locks and queues assume this deployment shape.

## 8. Known Anti-Patterns and Risks

- Account concurrency is not equivalent to command-rate limiting by real egress IP.
- Account dispatch intervals release waves of accounts rather than strictly spacing every account start.
- Normal and batch schedulers duplicate many task executors, allowing behavior drift.
- Batch scheduling classifies proxy lanes but its current client construction does not pass a proxy to `GameClient`.
- Command-level throughput, latency, queue wait, and rate-limit outcomes are not persisted as metrics.
- Scheduler queues and locks are process-local and non-durable.
- Task-log cleanup is invoked on individual log writes despite scheduled database maintenance.
- The configured `dailyCatchupMaxConcurrency` value is not currently consumed.

## 9. Last Review Findings

The 2026-07-15 review concluded that roughly 3,500 task runs per day are not inherently high volume, but cron clustering and multi-command task amplification can create unsafe command bursts on a shared egress. The first approved response is passive observability, not a concurrency or retry behavior change.

## 10. Compatibility Boundaries

The first observability release must not:

- change task ordering, concurrency, staggering, delays, timeouts, retries, or reconnect behavior;
- change `GameClient` command return values or error types;
- store tokens, command parameters, response bodies, raw proxy addresses, or full stack traces;
- block or fail a game task when metric collection or persistence fails;
- include browser/manual task observability in its initial scope.
