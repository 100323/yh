import Database from 'better-sqlite3';
import { decrypt } from '../src/utils/crypto.js';
import { parseTokenPayload } from '../src/utils/token.js';
import GameClient from '../src/utils/gameClient.js';
import { warmupGameClient } from '../src/utils/wsWarmup.js';
import config from '../src/config/index.js';

const databasePath = config.database.path;
const database = new Database(databasePath, { readonly: true });
const accounts = database
  .prepare(
    `SELECT id, name, token_encrypted, token_iv, bin_encrypted, bin_iv, ws_url, server
     FROM game_accounts
     ORDER BY updated_at DESC`
  )
  .all();

if (!accounts.length) {
  console.log(JSON.stringify({ ok: false, reason: 'no-accounts' }));
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      hasToken: !!account.token_encrypted,
      hasBin: !!account.bin_encrypted,
      wsUrl: !!account.ws_url,
      server: account.server,
    })),
  })
);

if (process.argv[2] !== 'run' || !process.argv[3]) {
  process.exit(0);
}

const accountId = Number(process.argv[3]);
const account = accounts.find((item) => Number(item.id) === accountId);
if (!account) {
  console.log(JSON.stringify({ ok: false, reason: 'account-not-found', accountId }));
  process.exit(1);
}

const tokenMeta = parseTokenPayload(decrypt(account.token_encrypted, account.token_iv));
const token = tokenMeta.candidates?.[0] || tokenMeta.token;
const payload = (() => {
  const raw = String(token || '').trim();
  if (!raw) return '';
  const now = Date.now();
  const sessId = now * 100 + Math.floor(Math.random() * 100);
  const connId = now + Math.floor(Math.random() * 10);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.roleToken) {
      return JSON.stringify({
        ...parsed,
        sessId,
        connId,
        isRestore: 0,
        version: parsed.version || config.game.clientVersion,
      });
    }
  } catch {
    // Ignore non-JSON tokens; they still need the roleToken envelope.
  }
  return JSON.stringify({
    roleToken: raw,
    sessId,
    connId,
    isRestore: 0,
    version: config.game.clientVersion,
  });
})();

const wsUrl = `${config.game.wsUrl}?p=${encodeURIComponent(payload)}&e=x&lang=chinese`;
const client = new GameClient(token, { roleId: tokenMeta.roleId, wsUrl });
await client.connect();
const warmup = await warmupGameClient(client, { roleInfoTimeout: 10000, includeRoleId: false });

const mapEntries = (value) => {
  if (value instanceof Map) return [...value.entries()];
  if (value && typeof value === 'object') return Object.entries(value);
  return [];
};

const summarizeMap = (value) => mapEntries(value).map(([key, rows]) => ({
  key: { value: String(key), type: typeof key },
  count: Array.isArray(rows) ? rows.length : (rows instanceof Map ? rows.size : Object.keys(rows || {}).length),
}));

const sendMaybe = async (label, cmd, params = {}) => {
  try {
    return await client.sendWithPromise(cmd, params, 10000);
  } catch (error) {
    console.error(JSON.stringify({
      step: label,
      cmd,
      code: error.code,
      error: error.rawError || error.message,
    }));
    return null;
  }
};

const shortDate = process.argv[4] || '260913';
const legionInfo = await sendMaybe('legion_getinfo', 'legion_getinfo');
const ownLegionId = legionInfo?.info?.id;
const payloadRecord = await sendMaybe('legion_getpayloadrecord', 'legion_getpayloadrecord');
const recordEntries = mapEntries(payloadRecord?.enemyLegionMap);
const targetRecord = recordEntries.find(([key]) => key === shortDate);
const opponentLegionId = targetRecord?.[1]?.id;

const killRecord = await sendMaybe(
  'legion_getpayloadkillrecord',
  'legion_getpayloadkillrecord',
  { date: shortDate },
  10000
);

const ownInfo = ownLegionId
  ? await sendMaybe('own_getinfobyid', 'legion_getinfobyid', { legionId: ownLegionId })
  : null;
const opponentInfo = opponentLegionId
  ? await sendMaybe('opponent_getinfobyid', 'legion_getinfobyid', { legionId: opponentLegionId })
  : null;

const summarizeMembers = (members) => {
  const entries = mapEntries(members);
  return {
    isMap: members instanceof Map,
    count: entries.length,
    keyTypes: [...new Set(entries.map(([key]) => typeof key))],
    firstKeys: entries.slice(0, 3).map(([key]) => String(key)),
  };
};

const inspectRecordRows = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 3).map((row) => ({
  rowType: typeof row,
  rowKeys: row && typeof row === 'object' ? Object.keys(row) : [],
  roleId: { value: String(row?.roleInfo?.roleId ?? ''), type: typeof row?.roleInfo?.roleId },
  name: row?.roleInfo?.name || '',
  serverId: { value: String(row?.roleInfo?.serverId ?? ''), type: typeof row?.roleInfo?.serverId },
  roleInfoKeys: row?.roleInfo && typeof row.roleInfo === 'object' ? Object.keys(row.roleInfo) : [],
}));

const rankParams = (roleId) => ({
  roleId: parseInt(roleId),
  includeBottleTeam: false,
  isSearch: false,
  bottleType: 0,
  includeHero: true,
  includeHeroDetail: true,
  includePearl: true,
});

const ownRows = killRecord?.recordsMap?.[ownLegionId];
const opponentRows = killRecord?.recordsMap?.[opponentLegionId];
const firstOwnRoleId = ownRows?.[0]?.roleInfo?.roleId;
const firstOpponentRoleId = opponentRows?.[0]?.roleInfo?.roleId;
const rankOwnCurrent = firstOwnRoleId
  ? await sendMaybe('rank_own_current', 'rank_getroleinfo', rankParams(firstOwnRoleId))
  : null;
const rankOpponentCurrent = firstOpponentRoleId
  ? await sendMaybe('rank_opponent_current', 'rank_getroleinfo', rankParams(firstOpponentRoleId))
  : null;
const rankOpponentReference = firstOpponentRoleId
  ? await sendMaybe('rank_opponent_reference', 'rank_getroleinfo', {
    roleId: firstOpponentRoleId,
    bottleType: 0,
    includeBottleTeam: false,
    isSearch: false,
  })
  : null;

console.log(
  JSON.stringify(
    {
      ok: true,
      accountId: account.id,
      accountName: account.name,
      server: account.server,
      warmup: {
        ok: !!warmup.roleInfo,
        elapsedMs: warmup.elapsedMs,
        roleInfoError: warmup.roleInfoError,
      },
      ownLegionId: { value: String(ownLegionId || ''), type: typeof ownLegionId },
      payloadRecord: {
        isMap: payloadRecord?.enemyLegionMap instanceof Map,
        entries: recordEntries.map(([key, value]) => ({
          key: String(key),
          id: String(value?.id || ''),
          idType: typeof value?.id,
          name: value?.name || '',
        })),
      },
      killRecord: {
        isMap: killRecord?.recordsMap instanceof Map,
        entries: summarizeMap(killRecord?.recordsMap),
        firstRows: {
          own: inspectRecordRows(ownRows),
          opponent: inspectRecordRows(opponentRows),
        },
        ownLookup: {
          raw: !!killRecord?.recordsMap?.[ownLegionId],
          number: !!killRecord?.recordsMap?.[Number(ownLegionId)],
        },
        opponentLookup: {
          raw: !!killRecord?.recordsMap?.[opponentLegionId],
          number: !!killRecord?.recordsMap?.[Number(opponentLegionId)],
        },
      },
      ownInfo: {
        name: ownInfo?.legionData?.name || '',
        memberCount: summarizeMembers(ownInfo?.legionData?.members).count,
      },
      opponentInfo: {
        name: opponentInfo?.legionData?.name || '',
        level: opponentInfo?.legionData?.level || 0,
        power: opponentInfo?.legionData?.power || 0,
        members: summarizeMembers(opponentInfo?.legionData?.members),
      },
      rankProbe: {
        firstOwnRoleId: String(firstOwnRoleId || ''),
        firstOpponentRoleId: String(firstOpponentRoleId || ''),
        ownCurrent: {
          ok: !!rankOwnCurrent?.roleInfo,
          error: rankOwnCurrent?.error || null,
          name: rankOwnCurrent?.roleInfo?.name || '',
        },
        opponentCurrent: {
          ok: !!rankOpponentCurrent?.roleInfo,
          error: rankOpponentCurrent?.error || null,
          name: rankOpponentCurrent?.roleInfo?.name || '',
        },
        opponentReference: {
          ok: !!rankOpponentReference?.roleInfo,
          error: rankOpponentReference?.error || null,
          name: rankOpponentReference?.roleInfo?.name || '',
        },
      },
    },
    null,
    2
  )
);

client.disconnect();
