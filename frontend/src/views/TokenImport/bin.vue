<template>
  <div class="bin-import">
    <div class="import-intro">
      <h3>BIN多角色导入</h3>
      <p>上传多角色 BIN 后，在角色列表里点击“添加”即可直接加入账号管理。</p>
    </div>

    <n-form :model="importForm" :label-placement="'top'" :size="'large'" :show-label="true">
      <n-form-item :label="'bin文件'" :show-label="true">
        <a-upload accept="*.bin,*.dmp" @before-upload="uploadBin" draggable dropzone placeholder="粘贴Token字符串..."
          clearable>
        </a-upload>
      </n-form-item>

      <n-card v-if="serverListData && serverListData.length > 0" title="服务器角色列表" class="role-list-card">
        <template #header-extra>
          <span class="role-list-tip">点击“添加”直接加入账号管理</span>
        </template>
        <n-data-table :columns="columns" :data="serverListData" :pagination="{ pageSize: 5 }" :scroll-x="600" />
      </n-card>

      <div class="form-actions">
        <n-button v-if="tokenStore.hasTokens" size="large" block @click="cancel">
          取消
        </n-button>
      </div>
    </n-form>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, h } from "vue";
import { useTokenStore } from "@/stores/tokenStore";
import {
  NForm,
  NFormItem,
  NButton,
  useMessage,
  NCard,
  NDataTable,
} from "naive-ui";

import PQueue from "p-queue";
import useIndexedDB from "@/hooks/useIndexedDB";
import { getTokenId, transformToken, getServerList } from "@/utils/token";
import { g_utils } from "@/utils/bonProtocol";
import { formatPower } from "@/utils/legionWar";
import { useAuthStore } from "@stores/auth";

const $emit = defineEmits(["cancel"]);

const { storeArrayBuffer } = useIndexedDB();

const cancel = () => {
  serverListData.value = [];
  originalBinData.value = null;
  $emit("cancel");
};

const tokenStore = useTokenStore();
const authStore = useAuthStore();
const message = useMessage();
const importForm = {};
const serverListData = ref<any[]>([]);
const originalBinData = ref<any>(null);
const maxGameAccounts = computed(() => {
  const raw = authStore.user?.max_game_accounts;
  return raw === null || raw === undefined || raw === "" ? null : Number(raw);
});
const accountLimitReached = computed(() => {
  return maxGameAccounts.value !== null && tokenStore.gameTokens.length >= maxGameAccounts.value;
});

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

const buildRoleName = (roleInfo: any, roleIndex: number) => {
  const roleName = String(roleInfo?.name || `角色_${roleInfo?.roleId || "unknown"}`).trim();
  return `${roleName}-${roleIndex}-${roleInfo.roleId}`;
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
      return h(
        "div",
        { style: "display: flex; gap: 8px;" },
        [
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
        ]
      );
    },
  },
];

const tQueue = new PQueue({ concurrency: 1, interval: 1000 });

const handleDownload = (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin数据丢失，请重新上传");
    return;
  }
  try {
    const newData = { ...originalBinData.value };
    newData.serverId = roleInfo.serverId; // 确保类型一致
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;
    
    const roleIndex = getRoleIndex(roleInfo.serverId);
    const serverNum = getServerNum(roleInfo.serverId);
    const fileName = `bin-${serverNum}服-${roleIndex}-${roleInfo.roleId}-${roleInfo.name}.bin`;
    
    downloadBinFile(fileName, newBinBuffer);
    message.success(`已开始下载: ${fileName}`);
  } catch (e: any) {
    console.error("下载失败", e);
    message.error("下载失败: " + e.message);
  }
};

const addSelectedRole = async (roleInfo: any) => {
  if (!originalBinData.value) {
    message.error("Bin数据丢失，请重新上传");
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
    newData.serverId = roleInfo.serverId; // 确保类型一致
    const newBinBuffer = g_utils.encode(newData) as ArrayBuffer;
    const tokenId = getTokenId(newBinBuffer);
    const roleToken = await transformToken(newBinBuffer);

    // 刷新indexDB数据库token数据 (保存原始bin)
    const saved = await storeArrayBuffer(tokenId, newBinBuffer);
    if (!saved) {
      throw new Error("保存BIN数据到IndexedDB失败，请检查浏览器存储空间或权限");
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
      server: String(serverNum) + "服",
      roleIndex: roleIndex,
      wsUrl: "",
      importMethod: "bin",
    });

    message.success(`已添加角色: ${finalName}`);
  } catch (e: any) {
    console.error("添加角色失败", e);
    message.error("添加角色失败: " + e.message);
  }
};

const uploadBin = (binFile: File) => {
  tQueue.add(async () => {
    console.log("上传文件数据:", binFile);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const userToken = e.target?.result as ArrayBuffer;

      // 获取服务器角色列表
      try {
        const listStr = await getServerList(userToken);
        const parsedList = JSON.parse(listStr);
        // 转换为数组
        if (parsedList && typeof parsedList === 'object') {
          serverListData.value = Object.values(parsedList).sort((a: any, b: any) => b.power - a.power);
        } else {
          serverListData.value = [];
        }
        console.log("Server List:", parsedList);
        message.success("获取服务器角色列表成功，请选择角色添加");
      } catch (err) {
        console.error("Failed to get server list", err);
        message.warning("获取服务器角色列表失败，请检查文件是否正确");
        serverListData.value = [];
      }

      // 尝试解析 bin 文件内容
      try {
        const binMsg = g_utils.parse(userToken);
        let binData = binMsg.getData();
        if (!binData && (binMsg as any)._raw) {
          console.log("Bin文件 getData() 为空，尝试使用 _raw");
          binData = { ...(binMsg as any)._raw };
        }

        console.log("Bin文件解析:", binData);
        originalBinData.value = binData;
      } catch (err: any) {
        console.error("Bin文件解析失败", err);
        originalBinData.value = null;
      }
    };
    reader.onerror = () => {
      message.error("读取文件失败，请重试");
    };
    reader.readAsArrayBuffer(binFile);
  });
  return false; // 阻止自动上传
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
</script>

<style scoped lang="scss">
.bin-import {
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

.role-list-card {
  margin-bottom: 16px;
}

.role-list-tip {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.form-actions {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
