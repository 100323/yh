<template>
  <div class="token-import-page">
    <el-card class="header-card">
      <div class="page-header">
        <div class="header-left">
          <h2>账号管理</h2>
          <p>
            管理您的所有游戏账号
            <template v-if="accountLimitText">
              （{{ accountLimitText }}）
            </template>
          </p>
        </div>
        <div class="header-right">
          <el-button type="primary" :disabled="accountLimitReached" @click="openImportForm">
            <el-icon><Plus /></el-icon>
            添加账号
          </el-button>
        </div>
      </div>
    </el-card>

    <el-alert
      v-if="accountLimitReached"
      type="warning"
      show-icon
      :closable="false"
      class="limit-alert"
      :title="`你当前最多可添加 ${maxGameAccounts} 个游戏账号，已达到上限。若需继续添加，请在用户管理中调整上限。`"
    />

    <a-modal
      class="token-import-modal"
      v-model:visible="showImportForm"
      width="40rem"
      :footer="false"
      :default-visible="!tokenStore.hasTokens"
    >
      <template #title>
        <h2 class="modal-title">
          <n-icon>
            <Add />
          </n-icon>
          添加游戏账号
        </h2>
      </template>
      <div class="card-header">
        <div class="import-method-grid" role="tablist" aria-label="账号导入方式">
          <button
            v-for="option in importMethodOptions"
            :key="option.value"
            type="button"
            class="import-method-button"
            :class="{ active: importMethod === option.value }"
            :aria-pressed="importMethod === option.value"
            @click="importMethod = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div class="card-body">
        <WxQrcodeForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'wxQrcode'"
        />
        <PhoneLoginForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'phone'"
        />
        <BinTokenForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'bin'"
        />
        <SingleBinTokenForm
          @cancel="() => (showImportForm = false)"
          @ok="() => (showImportForm = false)"
          v-if="importMethod === 'singlebin'"
        />
      </div>
    </a-modal>

    <template v-if="tokenStore.hasTokens">
      <el-row :gutter="16" class="token-cards">
        <el-col :xs="24" :sm="12" :md="8" :lg="6" v-for="token in tokenStore.gameTokens" :key="token.id">
          <el-card class="token-card" :class="{ active: selectedTokenId === token.id }" @click="selectToken(token)">
            <div class="token-header">
              <div class="token-info">
                <el-avatar :size="40" :src="token.avatar || '/icons/tom_king.jpg'">
                  <img src="/icons/tom_king.jpg" alt="avatar" />
                </el-avatar>
                <div class="token-details">
                  <div class="token-name">{{ token.name }}</div>
                  <div class="token-meta">
                    <el-tag size="small" :type="getServerTagType(token.id)" v-if="token.server">
                      {{ token.server }}
                    </el-tag>
                    <el-tag size="small" :type="getTokenStatusType(token.id)">
                      {{ getConnectionStatusText(token.id) }}
                    </el-tag>
                  </div>
                </div>
              </div>
              <el-dropdown @command="(cmd) => handleTokenAction(cmd, token)" trigger="click">
                <el-button text circle @click.stop>
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">
                      <el-icon><Edit /></el-icon>编辑
                    </el-dropdown-item>
                    <el-dropdown-item command="copy">
                      <el-icon><CopyDocument /></el-icon>复制Token
                    </el-dropdown-item>
                    <el-dropdown-item command="refresh">
                      <el-icon><Refresh /></el-icon>刷新
                    </el-dropdown-item>
                    <el-dropdown-item command="backend-test">
                      <el-icon><RefreshIcon /></el-icon>后端连接测试
                    </el-dropdown-item>
                    <el-dropdown-item divided command="delete">
                      <el-icon><Delete /></el-icon>删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>

            <div class="token-body">
              <div class="info-item">
                <span class="label">Token:</span>
                <span class="value">{{ maskToken(token.token) }}</span>
              </div>
              <div class="info-item" v-if="token.remark">
                <span class="label">备注:</span>
                <span class="value">{{ token.remark }}</span>
              </div>
              <div class="info-item">
                <span class="label">创建时间:</span>
                <span class="value">{{ formatTime(token.createdAt) }}</span>
              </div>
              <div class="info-item">
                <span class="label">最后使用:</span>
                <span class="value">{{ formatTime(token.lastUsed) }}</span>
              </div>
            </div>

            <div class="token-actions" @click.stop>
              <el-button
                type="primary"
                class="enter-game-button"
                @click.stop="enterGame(token)"
              >
                进入游戏
              </el-button>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </template>

    <el-empty v-else description="暂无游戏账号" :image-size="200">
      <el-button type="primary" @click="showImportForm = true">添加第一个账号</el-button>
    </el-empty>

    <n-modal
      v-model:show="showEditModal"
      preset="card"
      title="编辑账号"
      style="width: 500px"
    >
      <n-form
        ref="editFormRef"
        :model="editForm"
        :rules="editRules"
        label-placement="left"
        label-width="80px"
      >
        <n-form-item label="名称" path="name">
          <n-input v-model:value="editForm.name" />
        </n-form-item>
        <n-form-item label="Token字符串" path="token">
          <n-input
            v-model:value="editForm.token"
            type="textarea"
            :rows="3"
            placeholder="粘贴Token字符串..."
            clearable
          />
        </n-form-item>
        <n-form-item label="服务器">
          <n-input v-model:value="editForm.server" />
        </n-form-item>
        <n-form-item label="WebSocket地址">
          <n-input v-model:value="editForm.wsUrl" />
        </n-form-item>
        <n-form-item label="备注">
          <n-input
            v-model:value="editForm.remark"
            type="textarea"
            :rows="2"
            placeholder="添加备注信息..."
          />
        </n-form-item>
      </n-form>

      <template #footer>
        <div class="modal-actions">
          <n-button @click="showEditModal = false"> 取消 </n-button>
          <n-button type="primary" @click="saveEdit"> 保存 </n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<script setup>
import { useTokenStore, selectedTokenId } from "@/stores/tokenStore";
import { Add } from "@vicons/ionicons5";
import { Plus, MoreFilled, Edit, CopyDocument, Delete, Refresh as RefreshIcon } from '@element-plus/icons-vue';
import { NIcon, useDialog, useMessage } from "naive-ui";
import { computed, defineAsyncComponent, onMounted, reactive, ref } from "vue";
import { transformToken } from "@/utils/token";
import useIndexedDB from "@/hooks/useIndexedDB";
import api from "@/api";
import { useAuthStore } from "@stores/auth";
import { useGameWorkbenchStore } from "@stores/gameWorkbench";

const BinTokenForm = defineAsyncComponent(() => import("./bin.vue"));
const SingleBinTokenForm = defineAsyncComponent(() => import("./singlebin.vue"));
const WxQrcodeForm = defineAsyncComponent(() => import("./wxqrcode.vue"));
const PhoneLoginForm = defineAsyncComponent(() => import("./phone.vue"));

const { getArrayBuffer, storeArrayBuffer, deleteArrayBuffer } = useIndexedDB();

const props = defineProps({
  token: String,
  name: String,
  server: String,
  wsUrl: String,
  api: String,
  auto: Boolean,
});

const message = useMessage();
const dialog = useDialog();
const tokenStore = useTokenStore();
const authStore = useAuthStore();
const gameWorkbenchStore = useGameWorkbenchStore();

const showImportForm = ref(false);
const showEditModal = ref(false);
const editFormRef = ref(null);
const editingToken = ref(null);
const importMethod = ref("wxQrcode");
const importMethodOptions = [
  { value: "wxQrcode", label: "微信扫码" },
  { value: "phone", label: "手机号登录" },
  { value: "bin", label: "BIN多角色" },
  { value: "singlebin", label: "BIN单角色" },
];

const editForm = reactive({
  name: "",
  token: "",
  server: "",
  wsUrl: "",
  remark: "",
});

const editRules = {
  name: [{ required: true, message: "请输入账号名称", trigger: "blur" }],
  token: [{ required: true, message: "请输入Token字符串", trigger: "blur" }],
};

const maxGameAccounts = computed(() => {
  const raw = authStore.user?.max_game_accounts;
  if (raw === null || raw === undefined || raw === '') return null;
  const normalized = Number(raw);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
});

const accountLimitReached = computed(() => {
  return maxGameAccounts.value !== null && tokenStore.gameTokens.length >= maxGameAccounts.value;
});

const accountLimitText = computed(() => {
  if (maxGameAccounts.value === null) {
    return `已添加 ${tokenStore.gameTokens.length} 个账号，不限数量`;
  }
  return `已添加 ${tokenStore.gameTokens.length}/${maxGameAccounts.value} 个账号`;
});

const openImportForm = () => {
  if (accountLimitReached.value) {
    message.warning(`当前账号最多只能添加 ${maxGameAccounts.value} 个游戏账号，已达到上限`);
    return;
  }
  if (!importMethodOptions.some((option) => option.value === importMethod.value)) {
    importMethod.value = 'wxQrcode';
  }
  showImportForm.value = true;
};

const maskToken = (token) => {
  if (!token) return "";
  const len = token.length;
  if (len <= 8) return token;
  return token.substring(0, 4) + "***" + token.substring(len - 4);
};

const formatTime = (timestamp) => {
  return new Date(timestamp).toLocaleString("zh-CN");
};

const getConnectionStatus = (tokenId) => {
  return tokenStore.getWebSocketStatus(tokenId);
};

const getConnectionStatusText = (tokenId) => {
  const status = getConnectionStatus(tokenId);
  const statusMap = {
    connected: "已连接",
    connecting: "连接中...",
    disconnected: "已断开",
    error: "连接错误",
    disconnecting: "断开中...",
  };
  return statusMap[status] || "未连接";
};

const getTokenStatusType = (tokenId) => {
  const status = getConnectionStatus(tokenId);
  const statusMap = {
    connected: "success",
    connecting: "warning",
    disconnected: "info",
    error: "danger",
    disconnecting: "warning",
  };
  return statusMap[status] || "info";
};

const getServerTagType = (tokenId) => {
  const status = getConnectionStatus(tokenId);
  return status === "connected" ? "success" : "info";
};

const handleTokenAction = async (action, token) => {
  switch (action) {
    case "edit":
      editToken(token);
      break;
    case "copy":
      copyToken(token);
      break;
    case "refresh":
      refreshToken(token);
      break;
    case "backend-test":
      testBackendConnection(token);
      break;
    case "delete":
      deleteToken(token);
      break;
  }
};

const testBackendConnection = async (token) => {
  try {
    const accountId = String(token.id || "");
    if (!/^\d+$/.test(accountId)) {
      message.warning("该账号尚未同步到后端，无法进行后端连接测试");
      return;
    }

    message.info(`正在测试后端连接: ${token.name}`);
    const backendBin = await tokenStore.getBackendBinPayload(token);
    const res = await api.post(
      `/accounts/${accountId}/test-connection`,
      {
        timeout: 30000,
        token: token.token || "",
        wsUrl: token.wsUrl || "",
        binData: backendBin?.binData || "",
        persist: true,
      },
      { timeout: 30000 }
    );
    if (res?.success) {
      const elapsed = res?.data?.elapsedMs != null ? `${res.data.elapsedMs}ms` : "未知耗时";
      message.success(`后端连接成功 (${elapsed})`);
    } else {
      message.error(res?.error || "后端连接测试失败");
    }
  } catch (error) {
    message.error(error?.response?.data?.error || error?.message || "后端连接测试失败");
  }
};

const editToken = (token) => {
  editingToken.value = token;
  Object.assign(editForm, {
    name: token.name,
    token: token.token,
    server: token.server || "",
    wsUrl: token.wsUrl || "",
    remark: token.remark || "",
  });
  showEditModal.value = true;
};

const saveEdit = async () => {
  if (!editFormRef.value || !editingToken.value) return;

  try {
    await editFormRef.value.validate();

    const nextTokenData = {
      ...editingToken.value,
      name: editForm.name,
      token: editForm.token,
      server: editForm.server,
      wsUrl: editForm.wsUrl,
      remark: editForm.remark,
    };

    tokenStore.updateToken(editingToken.value.id, nextTokenData);

    const accountId = String(editingToken.value.id || "");
    if (/^\d+$/.test(accountId)) {
      try {
        const backendBin = await tokenStore.getBackendBinPayload(nextTokenData);
        await api.put(`/accounts/${accountId}`, {
          name: editForm.name,
          token: editForm.token,
          server: editForm.server,
          wsUrl: editForm.wsUrl,
          remark: editForm.remark,
          binData: backendBin?.binData || "",
        });
      } catch (error) {
        message.warning("账号已更新，但同步后端失败");
      }
    }

    message.success("账号信息已更新");
    showEditModal.value = false;
    editingToken.value = null;
  } catch (error) {
    // 验证失败
  }
};

const copyToken = async (token) => {
  try {
    await navigator.clipboard.writeText(token.token);
    message.success("Token已复制到剪贴板");
  } catch (error) {
    message.error("复制失败");
  }
};

const refreshToken = async (token) => {
  try {
    if (token.importMethod === "url") {
      let response;

      const isLocalUrl =
        token.sourceUrl.startsWith(window.location.origin) ||
        token.sourceUrl.startsWith("/") ||
        token.sourceUrl.startsWith("http://localhost") ||
        token.sourceUrl.startsWith("http://127.0.0.1");

      if (isLocalUrl) {
        response = await fetch(token.sourceUrl);
      } else {
        try {
          response = await fetch(token.sourceUrl, {
            method: "GET",
            headers: {
              Accept: "application/json",
            },
            mode: "cors",
          });
        } catch (corsError) {
          throw new Error(
            `跨域请求被阻止。请确保目标服务器支持CORS。错误详情: ${corsError.message}`,
          );
        }
      }

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.token) {
        throw new Error("返回数据中未找到token字段");
      }

      tokenStore.updateToken(token.id, {
        token: data.token,
        server: data.server || token.server,
        lastRefreshed: Date.now(),
      });
      const updatedToken = {
        ...token,
        token: data.token,
        server: data.server || token.server,
        lastRefreshed: Date.now(),
      };
      const accountId = String(token.id || "");
      if (/^\d+$/.test(accountId)) {
        try {
          const backendBin = await tokenStore.getBackendBinPayload(updatedToken);
          await api.put(`/accounts/${accountId}`, {
            token: data.token,
            server: data.server || token.server,
            wsUrl: token.wsUrl || "",
            remark: token.remark || "",
            binData: backendBin?.binData || "",
          });
        } catch {
          // 忽略同步失败
        }
      }

      message.success("Token刷新成功");
    } else if (
      token.importMethod === "wxQrcode" ||
      token.importMethod === "phone" ||
      token.importMethod === "bin"
    ) {
      const candidateKeys = Array.from(
        new Set(
          [
            token.id,
            token.storageKey,
            ...(Array.isArray(token.legacyStorageKeys) ? token.legacyStorageKeys : []),
            token.name,
          ]
            .map((key) => String(key || "").trim())
            .filter(Boolean),
        ),
      );

      let userToken = null;
      let matchedKey = null;
      for (const key of candidateKeys) {
        userToken = await getArrayBuffer(key);
        if (userToken) {
          matchedKey = key;
          break;
        }
      }
      if (userToken) {
        const newToken = await transformToken(userToken);
        const updatedToken = {
          ...token,
          token: newToken,
          lastRefreshed: Date.now(),
          storageKey: token.id,
          legacyStorageKeys: Array.from(
            new Set(
              [
                ...(Array.isArray(token.legacyStorageKeys) ? token.legacyStorageKeys : []),
                token.storageKey,
                matchedKey,
              ]
                .map((key) => String(key || "").trim())
                .filter(Boolean),
            ),
          ),
        };
        tokenStore.updateToken(token.id, updatedToken);
        const accountId = String(token.id || "");
        if (/^\d+$/.test(accountId)) {
          try {
            const backendBin = await tokenStore.getBackendBinPayload(updatedToken);
            await api.put(`/accounts/${accountId}`, {
              token: newToken,
              wsUrl: token.wsUrl || "",
              remark: token.remark || "",
              binData: backendBin?.binData || "",
            });
          } catch {
            // 忽略同步失败
          }
        }
        if (matchedKey && matchedKey !== token.id) {
          await storeArrayBuffer(token.id, userToken);
          await deleteArrayBuffer(matchedKey);
        }
        message.success("Token刷新成功");
      } else {
        throw new Error(`未找到可用于刷新的BIN数据，已尝试: ${candidateKeys.join(", ")}`);
      }
    } else {
      message.info("该Token需要手动刷新");
    }

    if (tokenStore.getWebSocketStatus(token.id) === "connected") {
      tokenStore.closeWebSocketConnection(token.id);
      setTimeout(() => {
        tokenStore.createWebSocketConnection(
          token.id,
          token.token,
          token.wsUrl,
        );
      }, 500);
    }
  } catch (error) {
    console.error("刷新Token失败:", error);
    message.error(error.message || "Token刷新失败");
  }
};

const selectToken = (token) => {
  const isAlreadySelected = selectedTokenId.value === token.id;
  const connectionStatus = getConnectionStatus(token.id);

  if (
    isAlreadySelected &&
    connectionStatus === "connected"
  ) {
    tokenStore.closeWebSocketConnection(token.id);
    message.success(`已断开 ${token.name} 的连接`);
    return;
  }

  if (
    !isAlreadySelected &&
    connectionStatus === "connected"
  ) {
    tokenStore.closeWebSocketConnection(token.id);
    message.success(`已断开 ${token.name} 的连接`);
    return;
  }

  if (
    isAlreadySelected &&
    connectionStatus === "connecting"
  ) {
    message.info(`${token.name} 正在连接中...`);
    return;
  }

  const result = tokenStore.selectToken(token.id);

  if (result) {
    if (isAlreadySelected) {
      message.success(`重新连接：${token.name}`);
    } else {
      message.success(`已选择：${token.name}`);
    }
  } else {
    message.error(`选择账号失败：${token.name}`);
  }
};

const deleteToken = (token) => {
  dialog.warning({
    title: "删除账号",
    content: `确定要删除账号 "${token.name}" 吗？此操作无法恢复。`,
    positiveText: "确定删除",
    negativeText: "取消",
    onPositiveClick: async () => {
      await tokenStore.removeToken(token.id);
      message.success("账号已删除");
    },
  });
};

const resolveLaunchAccount = async (token) => {
  let launchAccount = {
    ...token,
  };

  const accountId = String(token?.id || '').trim();
  if (/^\d+$/.test(accountId)) {
    const res = await api.get(`/accounts/${accountId}/launch-payload`);
    if (!res?.success || !res?.data?.token) {
      throw new Error(res?.error || '获取账号启动数据失败');
    }

    launchAccount = {
      ...launchAccount,
      id: String(res.data.accountId || accountId),
      name: res.data.name || token.name,
      server: res.data.server || token.server,
      wsUrl: res.data.wsUrl || token.wsUrl || '',
      token: res.data.token,
      binData: res.data.binData || '',
      authPayload:
        res.data.authPayload && typeof res.data.authPayload === 'object'
          ? res.data.authPayload
          : (launchAccount.authPayload || launchAccount.launchContext?.authPayload || null),
      launchContext:
        res.data.launchContext && typeof res.data.launchContext === 'object'
          ? res.data.launchContext
          : launchAccount.launchContext || null,
    };
  } else {
    const backendBin = await tokenStore.getBackendBinPayload(token);
    launchAccount = {
      ...launchAccount,
      binData: backendBin?.binData || '',
    };
  }

  return launchAccount;
};

const enterGame = async (token) => {
  try {
    const launchAccount = await resolveLaunchAccount(token);
    gameWorkbenchStore.openSession(launchAccount);
    message.success(`已在当前页打开 ${token.name}`);
  } catch (error) {
    message.error(error?.message || "进入游戏失败");
  }
};

onMounted(async () => {
  if (authStore.isAuthenticated && authStore.user && authStore.user.max_game_accounts === undefined) {
    await authStore.fetchUser();
  }
  await tokenStore.initTokenStore();

  if (!tokenStore.hasTokens && !props.token && !props.api) {
    showImportForm.value = true;
  }
});
</script>

<style scoped lang="scss">
.token-import-page {
  display: flex;
  flex-direction: column;
  gap: 18px;

  .header-card {
    margin-bottom: 0;
  }

  .limit-alert {
    margin-bottom: 0;
    border-radius: 18px;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 18px;

    .header-left {
      h2 {
        margin: 0 0 4px 0;
        font-size: 22px;
        color: var(--text-primary);
      }

      p {
        margin: 0;
        color: var(--text-secondary);
        font-size: 14px;
      }
    }
  }

  .token-cards {
    margin-bottom: 0;
  }

  .token-card {
    margin-bottom: 16px;
    cursor: pointer;
    transition: all 0.28s ease;
    position: relative;
    overflow: hidden;

    &:hover {
      box-shadow: 0 20px 42px rgba(24, 39, 75, 0.12);
      transform: translateY(-3px);
    }

    &.active {
      border-color: rgba(91, 124, 255, 0.28);
      box-shadow:
        0 0 0 2px rgba(91, 124, 255, 0.18),
        0 20px 42px rgba(24, 39, 75, 0.14);
    }

    .token-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .token-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .token-details {
      flex: 1;
      min-width: 0;
    }

    .token-name {
      font-weight: 700;
      font-size: 16px;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .token-meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .token-body {
      font-size: 13px;
      color: var(--text-secondary);
      display: grid;
      gap: 8px;

      .info-item {
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(91, 124, 255, 0.05);

        .label {
          color: var(--text-secondary);
          min-width: 70px;
          flex-shrink: 0;
          font-weight: 600;
        }

        .value {
          flex: 1;
          word-break: break-all;
          color: var(--text-primary);
        }
      }
    }

    .token-actions {
      margin-top: 14px;
      display: flex;
    }

    .enter-game-button {
      width: 100%;
      border-radius: 14px;
      min-height: 40px;
      font-weight: 700;
      box-shadow: 0 12px 24px rgba(91, 124, 255, 0.18);
    }
  }
}

.modal-actions {
  display: flex;
  gap: var(--spacing-md);
  justify-content: flex-end;
}

@media (max-width: 768px) {
  .token-import-page {
    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-md);

      .header-right {
        width: 100%;

        .el-button {
          width: 100%;
        }
      }

      .header-left {
        h2 {
          font-size: 20px;
        }

        p {
          font-size: var(--font-size-sm);
        }
      }
    }

    .token-card {
      .token-header {
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .token-info {
        flex-wrap: wrap;
      }

      .token-body {
        .info-item {
          flex-direction: column;
          gap: 2px;

          .label {
            min-width: auto;
          }
        }
      }

      .token-actions {
        margin-top: 12px;
      }
    }
  }
}

@media (max-width: 480px) {
  .token-import-page {
    .page-header {
      .header-left {
        h2 {
          font-size: 18px;
        }
      }
    }

    .token-card {
      .token-name {
        font-size: var(--font-size-sm);
      }

      .token-body {
        font-size: var(--font-size-xs);
      }
    }
  }
}

.token-import-modal {
  :deep(.arco-modal-content) {
    border-radius: 26px;
    background: var(--bg-elevated-strong);
    box-shadow: var(--shadow-heavy);
    overflow: hidden;
  }

  :deep(.arco-modal-header) {
    border-bottom: 1px solid rgba(138, 151, 185, 0.14);
    padding: 18px 22px 14px;
  }

  :deep(.arco-modal-body) {
    padding: 18px 22px 20px;
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-size: var(--font-size-lg);
    margin: 0;
  }

  .card-header {
    margin-bottom: var(--spacing-md);
  }

  .import-method-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--spacing-xs);
  }

  .import-method-button {
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid rgba(138, 151, 185, 0.18);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.84);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    line-height: 1.4;
    text-align: center;
    transition: all var(--transition-fast);
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;

    &.active {
      color: #fff;
      background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
      border-color: transparent;
      box-shadow: 0 14px 28px rgba(91, 124, 255, 0.24);
    }
  }

  .card-body {
    max-height: 60vh;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }
}

@media (max-width: 768px) {
  .token-import-modal {
    :deep(.arco-modal-content) {
      border-radius: 22px 22px 0 0;
    }

    .modal-title {
      font-size: var(--font-size-md);
    }

    .import-method-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .import-method-button {
      min-height: 44px;
      font-size: var(--font-size-xs);
    }
  }
}

@media (max-width: 480px) {
  .token-import-modal {
    :deep(.arco-modal-header) {
      padding-inline: 16px;
    }

    :deep(.arco-modal-body) {
      padding: 16px;
    }

    .import-method-grid {
      grid-template-columns: 1fr;
    }
  }
}
</style>
