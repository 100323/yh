# Evidence

- RED: `npm.cmd test -- test/dreamPurchaseTask.test.js` failed on the old cron, missing batch metadata, and missing test hook.
- GREEN: `npm.cmd test -- test/dreamPurchaseTask.test.js` passed 3/3.
- Regression: `npm.cmd test` passed 38/38.
- Frontend: `npm.cmd run build` passed with Vite; only existing chunk-size and dependency annotation warnings remained.
- `git diff --check` passed for the scoped changes.
- GitHub: `refs/heads/codex/tower-floor-limits` resolved to `b803a2cda2abd072deb2e1cb2d1d2662ba1b8287` after push.
- Deployment: each server retained a backup under `.deploy-backups/20260811-1055`.
- Remote tests: `node --test test/dreamPurchaseTask.test.js` passed 3/3 independently on all three servers.
- Runtime: PM2 reported `xyzw-backend` online on all three servers, and each public `/api/health` endpoint returned `status: ok` with database, scheduler, and batch scheduler ready.
- Frontend serving: all three HTTP roots returned the deployed `index.html` SHA-256 `d4ae764703ec6131ea0c569f4bcd92bfb26e9d4dbd907bd6927a89f32d23cf50`.

## Scope evidence

The intended files are the dream constants, task config panel, task mapping, task routes, batch scheduler, and the new regression test. Existing `gameClient.js`, `scheduledTaskHelpers.js`, observability files, temporary directories, and smart-car test changes remain unstaged.
