# Frontend Page Inventory

## Route Source of Truth

- Current runtime router is `frontend/src/router/index.js`.
- Current Vite config only registers `@vitejs/plugin-vue` in `frontend/vite.config.js`.
- `unplugin-vue-router` is no longer present in the active build chain, so the old generated `typed-router.d.ts` file was stale and has been removed.

## Routed Pages

These pages are currently reachable from the app router:

- `frontend/src/views/Login.vue` -> `/login`
- `frontend/src/views/Home.vue` -> `/`
- `frontend/src/views/TokenImport/index.vue` -> `/tokens`
- `frontend/src/views/GameFeatures.vue` -> `/game-features`
- `frontend/src/views/DailyTasks.vue` -> `/daily-tasks`
- `frontend/src/views/BatchDailyTasks.vue` -> `/batch-daily-tasks`
- `frontend/src/views/LegionWar.vue` -> `/legion-war`
- `frontend/src/views/Tasks.vue` -> `/tasks`
- `frontend/src/views/Logs.vue` -> `/logs`
- `frontend/src/views/Profile.vue` -> `/profile`
- `frontend/src/views/Changelog.vue` -> `/changelog`
- `frontend/src/views/InviteCodes.vue` -> `/invite-codes`
- `frontend/src/views/UserManagement.vue` -> `/user-management`
- `frontend/src/views/NotFound.vue` -> catch-all 404

## Floating Pages

These view files still exist but are not connected to the current router.

### Likely Legacy Or Duplicate

These pages are better treated as legacy until someone explicitly wants them back:

- `frontend/src/views/Accounts.vue`
- `frontend/src/views/Dashboard.vue`
- `frontend/src/views/GameRoles.vue`
- `frontend/src/views/Register.vue`
- `frontend/src/views/Test.vue`
- `frontend/src/views/Tokens/index.vue`

## Token Import Subviews

These files exist under `TokenImport/` but are not wired as standalone routes in the current manual router:

- `frontend/src/views/TokenImport/bin.vue`
- `frontend/src/views/TokenImport/manual.vue`
- `frontend/src/views/TokenImport/singlebin.vue`
- `frontend/src/views/TokenImport/url.vue`
- `frontend/src/views/TokenImport/wxqrcode.vue`

They should be treated as one of the following on the next cleanup pass:

- embedded subviews owned by `frontend/src/views/TokenImport/index.vue`, or
- old file-based route leftovers that can be removed after confirming no imports remain

## Recommended Stop Line

At this stage, avoid more structural refactors.

The next small, safe cleanup should only be one of these:

- give `Profile` an explicit UI entry in the user dropdown if needed
- give `Changelog` an explicit menu or footer entry if release notes need exposure
- delete confirmed legacy pages after one last owner confirmation
