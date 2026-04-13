<template>
  <div class="phone-login-import">
    <div class="login-flow-info">
      <h3>手机号登录流程</h3>
      <ol class="flow-steps">
        <li>输入手机号并发送短信验证码</li>
        <li>填写收到的验证码后点击“手机号登录”</li>
        <li>登录成功后会自动拉取该手机号下的服务器角色列表</li>
        <li>在列表里点击“添加”即可直接加入账号管理</li>
      </ol>
    </div>

    <n-form :model="formState" label-placement="top" size="large">
      <n-form-item label="手机号">
        <n-input
          v-model:value="formState.phone"
          maxlength="11"
          show-count
          placeholder="请输入 11 位手机号"
          :disabled="isProcessing"
        />
      </n-form-item>

      <div class="code-row">
        <n-form-item label="验证码" class="code-input-item">
          <n-input
            v-model:value="formState.smsCode"
            maxlength="8"
            placeholder="请输入短信验证码"
            :disabled="isProcessing"
          />
        </n-form-item>

        <n-form-item label="操作" class="code-action-item">
          <n-button
            block
            secondary
            :loading="sendingCode"
            :disabled="sendCodeDisabled"
            @click="handleSendCode"
          >
            {{ sendCodeButtonText }}
          </n-button>
        </n-form-item>
      </div>
    </n-form>

    <div class="status-box" :class="statusType">
      {{ statusMessage }}
    </div>

    <div class="form-actions">
      <n-button type="primary" block :loading="isProcessing" @click="handlePhoneLogin">
        手机号登录
      </n-button>
      <n-button block :disabled="isProcessing" @click="$emit('cancel')">
        取消
      </n-button>
    </div>

    <n-card
      v-if="serverListData && serverListData.length > 0"
      title="服务器角色列表"
      class="role-list-card"
    >
      <template #header-extra>
        <span class="role-list-tip">点击“添加”直接加入账号管理</span>
      </template>
      <n-data-table :columns="columns" :data="serverListData" :pagination="{ pageSize: 5 }" :scroll-x="600" />
    </n-card>
  </div>
</template>

<script lang="ts" setup>
import axios from "axios";
import { computed, h, onMounted, onUnmounted, reactive, ref } from "vue";
import { NButton, NCard, NDataTable, NForm, NFormItem, NInput, useMessage } from "naive-ui";
import { g_utils } from "@/utils/bonProtocol";
import { formatPower } from "@/utils/legionWar";
import { getServerList, getTokenId, transformToken } from "@/utils/token";
import useIndexedDB from "@/hooks/useIndexedDB";
import { useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@stores/auth";

defineEmits(["cancel"]);

const message = useMessage();
const tokenStore = useTokenStore();
const authStore = useAuthStore();
const { storeArrayBuffer } = useIndexedDB();

const STORAGE = {
  phoneDistinctId: "xyzw_toolbox_phone_distinct_id_v2",
};

const COMMON_DEVICE = {
  gameId: "xyzwapp",
  gameTp: "app",
  channel: "android",
  packageName: "com.hortor.games.xyzw",
  signPrint: "E6:F7:FE:A9:EC:8E:24:D0:4F:2A:32:50:28:78:E1:C5:5E:70:81:13",
};

const PHONE_DEVICE = {
  system: "Android 12",
  hortorSDKVersion: "4.2.1-cn-release",
  model: "22081212C",
  brand: "Redmi",
  androidId: "554e4fb740b853e1",
  deviceUniqueId: "6b6c5c4c256562fb90e6f70b97276339",
  tp: "app-mobile",
  verifyCodeTp: "login",
};

const PAYLOAD_KEY = [
  "eW7ir7i9sgPt5RdneMbjr7VvRZjy5I0vz2TPgOyJuba2zNGSIYGteC3VjJG5rJQAgKLlV6DOH6FZvlcen5RidkN47LQRkH9r4VUdV71RmlHSucVCjiwGiuqo",
  "N6mfZEob88ng8VRyFLQMHJIu1id2oEeUWGbluAKb3gAo05EUynYvdYOIzIUagxZ4Tat2ooo0OfZlh7swZHEP6prlhiYE1Mms0E1MEMb69Rx8fsXFeIE8Ozmx",
  "yXNKAROFDbQErSAXar60p31wMvnknnNOXiZpVFoR7uz7mubJv8FJuGX94AGKaPqAgRB2S0PtpCrXis5bJRkWwHxy8iAh1sM1ft96wAycIEjikzdw5J5rJaaD",
  "EqHeGB3NHHQuxPpKuUQTovfpQNyNqwwsORkpsQf5yjd3CHECX8oAMHDgZYM3cWA7E0RqCE4Ojlbtf6IFlDQlaCEUnKbqstmnSaxQ3XZJS8Vkk1tjhye034fx",
  "MzCtYT6hMtUmFYTcUJifArFzjNCVYCIi9Ug2r2htSFDDHgNNd9kUj2pdhKGm69HBRMSsZmokMCePo10iwZGf7oV9vNnkS0rV9LSSSu8OeoGPEN2xv5I7Z5Kw",
  "Q1AIWjTC3mLh5h8fHBe1u8HNVXtX4zIUErEEsXdhx4JkE0TcFwjfx1lKLYRPXE40y8Nh6CZq2gnzXYWnelJI9MVfj8BTK4DFajVBjGrrIPv0iBr4wa055jTT",
  "QcxCHLnse0G81ZP3JxkLMQms6wLfJg3cgLj1PHqbrNH7bH6WPlNdLy5aLOnkknr5FfgeDjwq47nG7wJX5EJTlNlsizOq7V2M2VBz556R14Hmxm8mVk2QTUUz",
  "zaPWSyI1Ef1zqfchUdp9OuvOwVX8oqyNgEWK2oGiJsd5mjLJftHonZ1RIxs4GWUjCFhoOiO2JtJyOAyDyS774RgwFvH4zgQyfWoq906rNO2k1PDH9eg6P0tr",
  "YEhnFWAHO0zUgRePGCnUy6GPOROMJ0PENjlmjGzckUlUfW7YpNjFYFJSBasY4goKEb2OSqH8WisOew3iSAttq2pmiylmTkYWLZ5OiNFsBDdDiNPgK6w91i0o",
  "k0tbyMyJ56twP3qzIrp88qgPctTS4yd1QT0tndm1MkvYQz6E0kerzXvor8nOjxz612c9Cjnzqyg3bztFop29nI0P4FP3v3YLytnuub0AByYlB6XpA9QdBQ2T",
  "DaCCvrKkPu24xWV6ZE8Jbf3zVOe2pn9zlGlllh5dJm09PW3Z452Tw5KEFkyhvItWrxyNA87axNl2LdrSo4QLxsrCNuAiQtiunxG4V9hbg6YEWvoqfAns4zeL",
  "zsH8nYWcIxlxAKGhcZPXjuovBWPM2gGSLgzqWJ2fOOyM6",
].join("");

const formState = reactive({
  phone: "",
  smsCode: "",
});

const isProcessing = ref(false);
const sendingCode = ref(false);
const statusMessage = ref("请先输入手机号并获取验证码");
const statusType = ref("info");
const serverListData = ref<any[]>([]);
const originalBinData = ref<any>(null);
const currentPhoneLoginMatchId = ref("");
const sendCodeLeftSeconds = ref(0);
let sendCodeTimer: ReturnType<typeof setInterval> | null = null;
let encryptionModuleLoadPromise: Promise<void> | null = null;

const maxGameAccounts = computed(() => {
  const raw = authStore.user?.max_game_accounts;
  return raw === null || raw === undefined || raw === "" ? null : Number(raw);
});
const accountLimitReached = computed(() => {
  return maxGameAccounts.value !== null && tokenStore.gameTokens.length >= maxGameAccounts.value;
});
const sendCodeDisabled = computed(() => sendingCode.value || isProcessing.value || sendCodeLeftSeconds.value > 0);
const sendCodeButtonText = computed(() => {
  if (sendCodeLeftSeconds.value > 0) {
    return `${sendCodeLeftSeconds.value} 秒后重试`;
  }
  return "获取验证码";
});

const updateStatus = (messageText: string, type = "info") => {
  statusMessage.value = messageText;
  statusType.value = type;
};

const randomHex = (len: number) => {
  const alphabet = "0123456789abcdef";
  let out = "";
  for (let index = 0; index < len; index += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
};

const createDid = () => `DID-${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`;

const getOrCreateStorageValue = (key: string, creator: () => string) => {
  const existing = String(localStorage.getItem(key) || "").trim();
  if (existing) {
    return existing;
  }
  const created = creator();
  localStorage.setItem(key, created);
  return created;
};

const getPhoneDistinctId = () => getOrCreateStorageValue(STORAGE.phoneDistinctId, createDid);
const generateLoginMatchId = () => `${Date.now()}_${getPhoneDistinctId()}`;

const utf8Base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const encodePayload = (rawText: string) => {
  if (!rawText) return "";
  const base64 = utf8Base64(rawText);
  let keyIndex = Math.floor(PAYLOAD_KEY.length / 2);
  let mixed = "";
  for (let index = 0; index < base64.length; index += 1) {
    if (keyIndex === PAYLOAD_KEY.length) keyIndex = 0;
    mixed += String.fromCharCode(base64.charCodeAt(index) ^ PAYLOAD_KEY.charCodeAt(keyIndex));
    keyIndex += 1;
  }
  return btoa(mixed);
};

const parseJsonSafe = (text: string) => {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const tryParseJsonString = (value: any) => {
  if (typeof value !== "string") return value;
  const parsed = parseJsonSafe(value);
  return parsed ?? value;
};

const pickFirstDefined = (...values: any[]) => values.find((value) => value !== undefined && value !== null && value !== "");

const getApiMeta = (parsed: any) => {
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, code: null, message: "返回不是 JSON 对象" };
  }
  if (parsed.meta && typeof parsed.meta === "object") {
    const code = Number(parsed.meta.errCode);
    return {
      ok: Number.isFinite(code) ? code === 0 : false,
      code: Number.isFinite(code) ? code : null,
      message: parsed.meta.errMsg || parsed.meta.msg || "",
    };
  }
  if ("code" in parsed) {
    const code = Number(parsed.code);
    return {
      ok: Number.isFinite(code) ? code === 0 : false,
      code: Number.isFinite(code) ? code : null,
      message: parsed.msg || parsed.error || "",
    };
  }
  if ("success" in parsed) {
    return {
      ok: Boolean(parsed.success),
      code: parsed.success ? 0 : 1,
      message: parsed.msg || parsed.error || "",
    };
  }
  return { ok: false, code: null, message: "未识别返回格式" };
};

const assertApiSuccess = (parsed: any, fallbackMessage: string) => {
  const meta = getApiMeta(parsed);
  if (!meta.ok) {
    throw new Error(meta.message || fallbackMessage);
  }
  return meta;
};

const getAxiosErrorMessage = (error: any) => {
  const response = error?.response?.data;
  if (response?.error) return response.error;
  if (response?.message) return response.message;
  if (typeof response === "string" && response.trim()) return response.trim();
  return error?.message || "请求失败";
};

const phoneSysInfo = () => JSON.stringify({
  system: PHONE_DEVICE.system,
  hortorSDKVersion: PHONE_DEVICE.hortorSDKVersion,
  model: PHONE_DEVICE.model,
  brand: PHONE_DEVICE.brand,
});

const buildPhoneLoginUrl = () => {
  const params = new URLSearchParams({
    gameId: COMMON_DEVICE.gameId,
    timestamp: String(Date.now()),
    version: `android-${PHONE_DEVICE.hortorSDKVersion}`,
    cryptVersion: "1.1.0",
    gameTp: COMMON_DEVICE.gameTp,
    system: "android",
    deviceUniqueId: PHONE_DEVICE.deviceUniqueId,
    packageName: COMMON_DEVICE.packageName,
  });
  return `/api/hortor/comb-login-server/api/v1/login?${params.toString()}`;
};

const getGameEncryptModule = () => {
  const gameRequire = (window as any).__require;
  if (typeof gameRequire !== "function") return null;

  const moduleIds: Array<string | number> = ["13", "@o4e/core", 13];
  for (const moduleId of moduleIds) {
    try {
      const mod = gameRequire(moduleId);
      if (mod?.encMsg && mod?.lz4XorEncode) return mod;
    } catch {
      // ignore
    }
  }
  return null;
};

const ensureGameEncryptModule = async () => {
  const loadedModule = getGameEncryptModule();
  if (loadedModule) return loadedModule;

  if (!encryptionModuleLoadPromise) {
    encryptionModuleLoadPromise = (async () => {
      await import("@/xyzw/game-defines.js");

      const globalScope = globalThis as any;
      if (typeof globalScope.PLATFORM === "undefined") globalScope.PLATFORM = "wx";
      if (typeof globalScope.SUB_PLATFORM === "undefined") globalScope.SUB_PLATFORM = "";
      if (typeof globalScope.ENV === "undefined") globalScope.ENV = "Prod";

      await import("@/xyzw/cocos2d-js-min.js");
      await import("@/xyzw/index.js");
    })().catch((error) => {
      encryptionModuleLoadPromise = null;
      throw error;
    });
  }

  await encryptionModuleLoadPromise;

  const moduleAfterLoad = getGameEncryptModule();
  if (!moduleAfterLoad) {
    throw new Error("游戏加密模块加载失败，请刷新页面后重试");
  }
  return moduleAfterLoad;
};

const normalizeAccountPayload = (parsed: any, sourceLabel = "手机号登录") => {
  const candidates = [
    parsed,
    parsed?.data,
    parsed?.rawData,
    parsed?.result,
    parsed?.payload,
    parsed?.data?.data,
    parsed?.data?.rawData,
    parsed?.meta?.data,
  ].filter(Boolean);

  for (const item of candidates) {
    const info = tryParseJsonString(
      pickFirstDefined(item.info, item.authInfo, item.encryptUserInfo, item.userInfo, item.loginInfo),
    );
    const platformExt = pickFirstDefined(item.platformExt, item.platform_ext, item.ext);
    const serverIdRaw = pickFirstDefined(item.serverId, item.serverID, item.sid, item.realServerId);
    const serverId = serverIdRaw === null || serverIdRaw === undefined || serverIdRaw === ""
      ? null
      : Number(serverIdRaw);

    if (platformExt && info && (serverId === null || Number.isFinite(serverId))) {
      return {
        platformExt: String(platformExt),
        info,
        serverId,
        type: sourceLabel,
      };
    }
  }

  return null;
};

const extractLoginSource = (parsed: any) => {
  const combUser = tryParseJsonString(pickFirstDefined(parsed?.data?.combUser, parsed?.combUser));
  const platformExt = String(
    pickFirstDefined(parsed?.data?.platformExt, parsed?.platformExt, parsed?.data?.ext, parsed?.ext, "mix"),
  );

  if (combUser) {
    return {
      platform: "hortor",
      platformExt,
      info: combUser,
      serverId: null,
      scene: 0,
      referrerInfo: "",
    };
  }

  const normalized = normalizeAccountPayload(parsed);
  if (!normalized) {
    return null;
  }

  return {
    platform: "hortor",
    platformExt: String(normalized.platformExt || "mix"),
    info: normalized.info,
    serverId: null,
    scene: 0,
    referrerInfo: "",
  };
};

const getEncryptedDataForPhone = async (phone: string, smsCode: string, activeLoginMatchId: string) => {
  const body = {
    gameId: COMMON_DEVICE.gameId,
    gameTp: COMMON_DEVICE.gameTp,
    sysInfo: phoneSysInfo(),
    activeLoginMatchId,
    smsCode,
    mobile: phone,
    channel: COMMON_DEVICE.channel,
    distinctId: getPhoneDistinctId(),
    oaidThirdSdk: "",
    ipv6: "",
    packageName: COMMON_DEVICE.packageName,
    signPrint: COMMON_DEVICE.signPrint,
    tp: PHONE_DEVICE.tp,
    androidId: PHONE_DEVICE.androidId,
    oaId: "",
    oaid: "",
  };

  const response = await axios.post(buildPhoneLoginUrl(), encodePayload(JSON.stringify(body)), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Hortor-Login-Mode": "phone",
    },
    timeout: 15000,
  });

  const parsed = response.data;
  assertApiSuccess(parsed, "手机号登录失败");

  const loginSource = extractLoginSource(parsed);
  if (!loginSource) {
    throw new Error("手机号登录成功，但未能提取认证信息，请检查返回结构");
  }

  const encryptModule = await ensureGameEncryptModule();
  const encryptedBuffer = encryptModule.encMsg(loginSource, {
    decrypt: encryptModule.lz4XorDecode,
    encrypt: encryptModule.lz4XorEncode,
  });

  return new Uint8Array(encryptedBuffer);
};

const startCountdown = () => {
  if (sendCodeTimer) {
    clearInterval(sendCodeTimer);
    sendCodeTimer = null;
  }

  sendCodeTimer = setInterval(() => {
    if (sendCodeLeftSeconds.value <= 1) {
      sendCodeLeftSeconds.value = 0;
      if (sendCodeTimer) {
        clearInterval(sendCodeTimer);
        sendCodeTimer = null;
      }
      return;
    }

    sendCodeLeftSeconds.value -= 1;
  }, 1000);
};

const clearCountdown = () => {
  if (sendCodeTimer) {
    clearInterval(sendCodeTimer);
    sendCodeTimer = null;
  }
  sendCodeLeftSeconds.value = 0;
};

const getRoleIndex = (serverId: number | string) => {
  const sid = Number(serverId);
  if (sid >= 2000000) return 2;
  if (sid >= 1000000) return 1;
  return 0;
};

const getServerNum = (serverId: number | string) => {
  let sid = Number(serverId);
  if (sid >= 2000000) sid -= 2000000;
  else if (sid >= 1000000) sid -= 1000000;
  return sid - 27;
};

const buildRoleName = (roleInfo: any, roleIndex: number) => {
  const roleName = String(roleInfo?.name || `角色_${roleInfo?.roleId || "unknown"}`).trim();
  return `${roleName}-${roleIndex}-${roleInfo.roleId}`;
};

const hasRoleAdded = (roleInfo: any) => {
  const roleId = String(roleInfo?.roleId || "");
  const finalName = buildRoleName(roleInfo, getRoleIndex(roleInfo?.serverId));
  return tokenStore.gameTokens.some((token) => {
    if (String(token.roleId || "") === roleId && roleId) {
      return true;
    }
    return String(token.name || "").trim() === finalName;
  });
};

const downloadBinFile = (fileName: string, bin: ArrayBuffer) => {
  const blob = new Blob([new Uint8Array(bin)], {
    type: "application/octet-stream",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const handleDownload = (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin 数据丢失，请重新登录");
    return;
  }

  try {
    const newData = { ...originalBinData.value };
    newData.serverId = roleInfo.serverId;
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;
    const roleIndex = getRoleIndex(roleInfo.serverId);
    const serverNum = getServerNum(roleInfo.serverId);
    const fileName = `bin-${serverNum}服-${roleIndex}-${roleInfo.roleId}-${roleInfo.name}.bin`;

    downloadBinFile(fileName, newBinBuffer);
    message.success(`已开始下载: ${fileName}`);
  } catch (error: any) {
    console.error("下载失败", error);
    message.error(`下载失败: ${error?.message || error}`);
  }
};

const addSelectedRole = async (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin 数据丢失，请重新登录");
    return;
  }
  if (accountLimitReached.value) {
    message.warning(`当前账号最多只能添加 ${maxGameAccounts.value} 个游戏账号，已达到上限`);
    return;
  }
  if (hasRoleAdded(roleInfo)) {
    message.warning("该角色已在账号管理中");
    return;
  }

  try {
    const newData = { ...originalBinData.value };
    newData.serverId = roleInfo.serverId;
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;
    const tokenId = getTokenId(newBinBuffer);
    const roleToken = await transformToken(newBinBuffer);

    const saved = await storeArrayBuffer(tokenId, newBinBuffer);
    if (!saved) {
      throw new Error("保存 BIN 数据到 IndexedDB 失败，请检查浏览器存储空间或权限");
    }

    const roleIndex = getRoleIndex(roleInfo.serverId);
    const serverNum = getServerNum(roleInfo.serverId);
    const finalName = buildRoleName(roleInfo, roleIndex);

    tokenStore.addToken({
      id: tokenId,
      storageKey: tokenId,
      legacyStorageKeys: [tokenId],
      roleId: roleInfo.roleId,
      token: roleToken,
      name: finalName,
      server: `${serverNum}服`,
      roleIndex,
      wsUrl: "",
      importMethod: "phone",
    });

    message.success(`已添加角色: ${finalName}`);
  } catch (error: any) {
    console.error("添加角色失败", error);
    message.error(`添加角色失败: ${error?.message || error}`);
  }
};

const columns = [
  {
    title: "区服",
    key: "serverId",
    render(row: any) {
      return getServerNum(row.serverId);
    },
  },
  {
    title: "角色序号",
    key: "roleIndex",
    render(row: any) {
      return getRoleIndex(row.serverId);
    },
  },
  {
    title: "角色ID",
    key: "roleId",
  },
  {
    title: "角色名称",
    key: "name",
  },
  {
    title: "战力",
    key: "power",
    render(row: any) {
      return formatPower(row.power);
    },
    sorter: (row1: any, row2: any) => row1.power - row2.power,
  },
  {
    title: "操作",
    key: "actions",
    render(row: any) {
      const added = hasRoleAdded(row);
      return h("div", { class: "table-action-group" }, [
        h(
          NButton,
          {
            size: "small",
            type: added ? "success" : "primary",
            disabled: added || accountLimitReached.value,
            onClick: () => addSelectedRole(row),
          },
          { default: () => (added ? "已添加" : "添加") },
        ),
        h(
          NButton,
          {
            size: "small",
            type: "info",
            onClick: () => handleDownload(row),
          },
          { default: () => "下载" },
        ),
      ]);
    },
  },
];

const saveAccount = async (arrBuf: ArrayBuffer) => {
  const bin = new Uint8Array(arrBuf);

  try {
    const listStr = await getServerList(bin.buffer);
    const parsedList = JSON.parse(listStr);
    if (parsedList && typeof parsedList === "object") {
      serverListData.value = Object.values(parsedList).sort((a: any, b: any) => b.power - a.power);
    } else {
      serverListData.value = [];
    }
    message.success("获取服务器角色列表成功，请选择角色添加");
    updateStatus("手机号登录成功，请在下方选择角色添加", "success");
  } catch (error) {
    console.error("Failed to get server list", error);
    message.warning("获取服务器角色列表失败");
    updateStatus("登录成功，但获取服务器角色列表失败", "error");
    serverListData.value = [];
  }

  try {
    const binMsg = g_utils.parse(bin.buffer);
    let binData = binMsg.getData();
    if (!binData && (binMsg as any)._raw) {
      binData = { ...(binMsg as any)._raw };
    }
    originalBinData.value = binData;
  } catch (error) {
    console.error("Bin 文件解析失败", error);
    originalBinData.value = null;
  }
};

const handleSendCode = async () => {
  const phone = String(formState.phone || "").trim();
  if (!/^\d{11}$/.test(phone)) {
    updateStatus("请输入 11 位手机号", "error");
    return;
  }

  try {
    sendingCode.value = true;
    updateStatus("验证码发送中...", "info");

    const activeLoginMatchId = generateLoginMatchId();
    const body = {
      gameId: COMMON_DEVICE.gameId,
      gameTp: COMMON_DEVICE.gameTp,
      accountNum: phone,
      sysInfo: phoneSysInfo(),
      activeLoginMatchId,
      channel: COMMON_DEVICE.channel,
      verifyCodeTp: PHONE_DEVICE.verifyCodeTp,
      distinctId: getPhoneDistinctId(),
      oaidThirdSdk: "",
      ipv6: "",
      limit: true,
      packageName: COMMON_DEVICE.packageName,
      signPrint: COMMON_DEVICE.signPrint,
      androidId: PHONE_DEVICE.androidId,
      oaId: "",
      oaid: "",
    };

    const response = await axios.post("/api/hortor/ucenter-app-server/api/v1/login/verify/code", body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      timeout: 15000,
    });

    assertApiSuccess(response.data, "发送验证码失败");
    currentPhoneLoginMatchId.value = activeLoginMatchId;
    sendCodeLeftSeconds.value = 60;
    startCountdown();
    updateStatus("获取验证码成功", "success");
  } catch (error: any) {
    updateStatus(getAxiosErrorMessage(error), "error");
  } finally {
    sendingCode.value = false;
  }
};

const handlePhoneLogin = async () => {
  const phone = String(formState.phone || "").trim();
  const smsCode = String(formState.smsCode || "").trim();

  if (!/^\d{11}$/.test(phone)) {
    updateStatus("请输入 11 位手机号", "error");
    return;
  }
  if (!/^\d{4,8}$/.test(smsCode)) {
    updateStatus("请输入验证码", "error");
    return;
  }

  try {
    isProcessing.value = true;
    serverListData.value = [];
    originalBinData.value = null;

    if (accountLimitReached.value) {
      message.warning(`当前账号最多只能添加 ${maxGameAccounts.value} 个游戏账号，已达到上限`);
      return;
    }

    const matchId = currentPhoneLoginMatchId.value || generateLoginMatchId();
    currentPhoneLoginMatchId.value = matchId;
    updateStatus("登录中，正在拉取角色列表...", "info");

    const encrypted = await getEncryptedDataForPhone(phone, smsCode, matchId);
    await saveAccount(encrypted.buffer);
  } catch (error: any) {
    console.error("手机号登录失败", error);
    updateStatus(error?.message || String(error), "error");
  } finally {
    isProcessing.value = false;
  }
};

onMounted(() => {
  void ensureGameEncryptModule().catch((error) => {
    console.warn("预加载游戏加密模块失败:", error);
  });
});

onUnmounted(() => {
  clearCountdown();
});
</script>

<style scoped lang="scss">
.phone-login-import {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg) 0;
}

.login-flow-info {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-md);

  h3 {
    margin: 0 0 var(--spacing-sm);
    font-size: var(--font-size-md);
    color: var(--text-primary);
  }
}

.flow-steps {
  margin: 0;
  padding-left: 20px;
  color: var(--text-secondary);
  line-height: 1.8;
}

.code-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 180px;
  gap: 12px;
}

.code-input-item,
.code-action-item {
  margin-bottom: 0;
}

.status-box {
  padding: 12px 14px;
  border-radius: var(--border-radius-medium);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  line-height: 1.6;
  word-break: break-word;

  &.success {
    background: rgba(24, 160, 88, 0.12);
    color: #18a058;
  }

  &.error {
    background: rgba(208, 48, 80, 0.12);
    color: #d03050;
  }
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.role-list-card {
  margin-top: 4px;
}

.role-list-tip {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

:deep(.table-action-group) {
  display: flex;
  gap: 8px;
}

@media (max-width: 768px) {
  .code-row {
    grid-template-columns: 1fr;
  }
}
</style>
