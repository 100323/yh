import { normalizeErrorMessage } from './wsDiagnostics.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDisconnectedError(client, error) {
  const message = normalizeErrorMessage(error);
  return (
    message.includes('WebSocket未连接')
    || message.includes('WebSocket连接已断开')
    || !client?.isSocketOpen?.()
  );
}

export async function warmupGameClient(client, options = {}) {
  const {
    roleInfoTimeout = 8000,
    battleVersionTimeout = 5000,
    includeRoleId = false,
  } = options;

  const startedAt = Date.now();
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: 0,
    roleInfo: null,
    roleInfoError: null,
    battleVersion: null,
    steps: [],
  };

  const runStep = async (name, action, stepOptions = {}) => {
    const {
      delayBeforeMs = 0,
      optional = true,
    } = stepOptions;

    if (delayBeforeMs > 0) {
      await sleep(delayBeforeMs);
    }

    if (!client?.isSocketOpen?.()) {
      throw new Error('WebSocket未连接');
    }

    const stepStartedAt = Date.now();

    try {
      const result = await action();
      summary.steps.push({
        name,
        ok: true,
        elapsedMs: Date.now() - stepStartedAt,
      });
      return result;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      summary.steps.push({
        name,
        ok: false,
        elapsedMs: Date.now() - stepStartedAt,
        error: message,
      });

      if (!optional || isDisconnectedError(client, error)) {
        throw error;
      }

      return null;
    }
  };

  summary.roleInfo = await runStep(
    'role_getroleinfo',
    () => client.getRoleInfo(roleInfoTimeout, { includeRoleId }),
    { delayBeforeMs: 300, optional: true }
  );

  if (!summary.roleInfo) {
    summary.roleInfoError = summary.steps.find((step) => step.name === 'role_getroleinfo' && !step.ok)?.error || null;
  }

  await runStep(
    'system_getdatabundlever',
    () => {
      client.sendDataBundleVer();
      return { ok: true };
    },
    { delayBeforeMs: 200, optional: true }
  );

  const battleVersion = await runStep(
    'fight_startlevel',
    () => client.ensureBattleVersion(battleVersionTimeout),
    { delayBeforeMs: 200, optional: true }
  );

  summary.battleVersion = Number(client?.battleVersion || battleVersion || 0) || null;
  summary.elapsedMs = Date.now() - startedAt;

  return summary;
}

export default warmupGameClient;
