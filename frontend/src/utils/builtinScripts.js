const BUILTIN_SCRIPT_STORAGE_KEY = 'xyzw-builtin-scripts-enabled';

export const BUILTIN_GAME_SCRIPTS = [
  {
    id: 'xingchi',
    title: '星驰脚本',
    description: '游戏增强与自动化面板，默认关闭。',
  },
  {
    id: 'peach-auto',
    title: '蟠桃自动',
    description: '蟠桃园自动助手，默认关闭。',
  },
  {
    id: 'salt-lineup',
    title: '盐场显示阵容',
    description: '盐场排队阵容显示助手，默认关闭。',
  },
];

export function normalizeEnabledBuiltinScriptIds(value, knownIds = BUILTIN_GAME_SCRIPTS) {
  if (!Array.isArray(value)) return [];

  const known = new Set(
    knownIds
      .map((script) => (typeof script === 'string' ? script : String(script?.id ?? '')))
      .filter(Boolean),
  );
  const result = [];

  value.forEach((id) => {
    const normalizedId = String(id ?? '').trim();
    if (normalizedId && known.has(normalizedId) && !result.includes(normalizedId)) {
      result.push(normalizedId);
    }
  });

  return result;
}

function getSafeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readEnabledBuiltinScriptIds(storage = getSafeStorage()) {
  if (!storage) return [];

  try {
    return normalizeEnabledBuiltinScriptIds(JSON.parse(storage.getItem(BUILTIN_SCRIPT_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function writeEnabledBuiltinScriptIds(storage, value) {
  const enabledIds = normalizeEnabledBuiltinScriptIds(value);
  if (storage) {
    storage.setItem(BUILTIN_SCRIPT_STORAGE_KEY, JSON.stringify(enabledIds));
  }
  return enabledIds;
}
