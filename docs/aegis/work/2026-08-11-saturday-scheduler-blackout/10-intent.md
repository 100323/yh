# Task Intent Draft

## Requested Outcome

Default-enable a user-scoped automatic scheduling blackout every Saturday from 20:00 to 21:00 Shanghai time. Defer automatic normal, catch-up, and batch work without logging in; replay it after 21:00. Allow running work and manual executions to continue unchanged.

## Baseline Read Set Hint

- `docs/aegis/specs/2026-08-08-saturday-scheduler-blackout-design.md`
- `docs/aegis/plans/2026-08-11-saturday-scheduler-blackout-implementation.md`
- `docs/aegis/baseline/2026-07-15-initial-baseline.md`
- `backend/src/scheduler/index.js`
- `backend/src/batchScheduler/index.js`
- `backend/src/routes/tasks.js`
- `backend/src/database/index.js`
- `frontend/src/views/Tasks.vue`

## Impact Statement Draft

The implementation adds a shared policy/persistence owner, then adapts normal, catch-up, and batch schedulers to ask it before automatic connection admission. Existing account coordination and game client ownership are compatibility boundaries. The task page exposes the user-level default-enabled switch without changing account task serialization.

## Risks

- Timezone boundary errors can over-block work.
- Duplicate or non-durable deferred records can cause loss or repeat execution.
- Current worktree contains unrelated modifications and Git index writes are unavailable in this session.
