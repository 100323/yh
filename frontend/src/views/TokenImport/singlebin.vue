<template>
  <div class="single-bin-import">
    <div class="import-intro">
      <h3>BIN单角色导入</h3>
      <p>上传单角色 BIN 文件后，会直接加入账号管理，无需再点“添加Token”。</p>
    </div>

    <n-form :model="importForm" label-placement="top" size="large" :show-label="true">
      <n-form-item label="bin文件">
        <a-upload
          accept="*.bin,*.dmp"
          @before-upload="uploadBin"
          draggable
          dropzone
          :disabled="accountLimitReached"
          clearable
        />
      </n-form-item>

      <div class="form-actions">
        <n-button v-if="tokenStore.hasTokens" size="large" block @click="cancel">
          取消
        </n-button>
      </div>
    </n-form>
  </div>
</template>

<script lang="ts" setup>
import { computed, reactive } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import { useAuthStore } from "@stores/auth";
import { NForm, NFormItem, NButton, useMessage } from "naive-ui";
import useIndexedDB from "@/hooks/useIndexedDB";
import { g_utils } from "@/utils/bonProtocol";
import { buildLaunchContextFromAuthPayload } from "@/utils/loginAuthPayload";
import { getTokenId, transformToken } from "@/utils/token";

const emit = defineEmits(["cancel"]);

const { storeArrayBuffer } = useIndexedDB();
const tokenStore = useTokenStore();
const authStore = useAuthStore();
const message = useMessage();

const importForm = reactive({});

const maxGameAccounts = computed(() => {
  const raw = authStore.user?.max_game_accounts;
  return raw === null || raw === undefined || raw === "" ? null : Number(raw);
});

const accountLimitReached = computed(() => {
  return maxGameAccounts.value !== null && tokenStore.gameTokens.length >= maxGameAccounts.value;
});

const cancel = () => {
  emit("cancel");
};

const parseFileMeta = (fileName: string) => {
  const name = String(fileName || "").trim();
  const match = name.match(/^bin-(.*?)服-([0-2])-([0-9]{6,12})-(.*)\.bin$/);
  if (!match) {
    return {
      server: "",
      roleIndex: "",
      roleId: "",
      roleName: name.replace(/\.(bin|dmp)$/i, ""),
    };
  }

  return {
    server: match[1],
    roleIndex: match[2],
    roleId: match[3],
    roleName: match[4],
  };
};

const buildFallbackName = (meta: ReturnType<typeof parseFileMeta>, tokenId: string) => {
  const roleName = String(meta.roleName || "未命名角色").trim();
  if (meta.roleId) {
    return `${roleName}-${meta.roleIndex || 0}-${meta.roleId}`;
  }
  return `${roleName}-${tokenId.slice(0, 6)}`;
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

const uploadBin = async (binFile: File) => {
  if (accountLimitReached.value) {
    message.warning(`当前账号最多只能添加 ${maxGameAccounts.value} 个游戏账号，已达到上限`);
    return false;
  }

  const fileMeta = parseFileMeta(binFile.name);

  try {
    const userToken = await binFile.arrayBuffer();
    const tokenId = getTokenId(userToken);
    const roleToken = await transformToken(userToken);
    let parsedBinData: any = null;
    try {
      const binMsg = g_utils.parse(userToken);
      parsedBinData = binMsg?.getData?.();
      if (!parsedBinData && (binMsg as any)?._raw) {
        parsedBinData = { ...(binMsg as any)._raw };
      }
    } catch (error) {
      console.warn("单角色 BIN 解析失败，继续按纯 BIN 导入", error);
    }

    const launchContext = buildLaunchContextFromAuthPayload(parsedBinData, "bin");
    const authServerId = Number(launchContext?.authPayload?.serverId);
    const finalName =
      launchContext?.authPayload?.serverId != null && fileMeta.roleId
        ? `${fileMeta.roleName || "未命名角色"}-${getRoleIndex(authServerId)}-${fileMeta.roleId}`
        : buildFallbackName(fileMeta, tokenId);

    const exists = tokenStore.gameTokens.some((token) => {
      if (String(token.id) === tokenId) return true;
      if (fileMeta.roleId && String(token.roleId || "") === String(fileMeta.roleId)) return true;
      return String(token.name || "").trim() === finalName;
    });

    if (exists) {
      message.warning("该角色已在账号管理中");
      return false;
    }

    const saved = await storeArrayBuffer(tokenId, userToken);
    if (!saved) {
      message.error("保存BIN数据到IndexedDB失败");
      return false;
    }

    tokenStore.addToken({
      id: tokenId,
      storageKey: tokenId,
      legacyStorageKeys: [tokenId],
      roleId: fileMeta.roleId || undefined,
      token: roleToken,
      name: finalName,
      server:
        fileMeta.server
          ? `${fileMeta.server}${fileMeta.roleIndex || ""}`
          : (Number.isFinite(authServerId) ? `${getServerNum(authServerId)}服` : ""),
      wsUrl: "",
      importMethod: "bin",
      launchContext,
    });

    if (!launchContext?.authPayload) {
      message.warning("BIN 已导入，但未提取到登录注入信息，进入游戏可能仍会失败");
    }
    message.success("账号添加成功");
  } catch (error: any) {
    console.error("单角色BIN导入失败", error);
    message.error("导入失败: " + (error?.message || error));
  }

  return false;
};
</script>

<style scoped lang="scss">
.single-bin-import {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
  padding: var(--spacing-lg) 0;
}

.import-intro {
  padding: var(--spacing-lg);
  border-radius: var(--border-radius-large);
  background: var(--bg-secondary);
  border: 1px solid var(--border-light);

  h3 {
    margin: 0 0 var(--spacing-xs);
    font-size: var(--font-size-md);
    color: var(--text-primary);
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    line-height: 1.6;
  }
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
}
</style>
