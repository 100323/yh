# Evidence

- RED: `npm.cmd test -- test/dreamPurchaseTask.test.js` failed on the old cron, missing batch metadata, and missing test hook.
- GREEN: `npm.cmd test -- test/dreamPurchaseTask.test.js` passed 3/3.
- Regression: `npm.cmd test` passed 38/38.
- Frontend: `npm.cmd run build` passed with Vite; only existing chunk-size and dependency annotation warnings remained.
- `git diff --check` passed for the scoped changes.

## Scope evidence

The intended files are the dream constants, task config panel, task mapping, task routes, batch scheduler, and the new regression test. Existing `gameClient.js`, `scheduledTaskHelpers.js`, observability files, temporary directories, and smart-car test changes remain unstaged.
