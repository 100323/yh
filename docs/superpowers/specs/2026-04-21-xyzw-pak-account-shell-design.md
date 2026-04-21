# XYZW 本地账号管理壳 + `xyzw-pak` 集成设计

日期：2026-04-21  
状态：已确认方案，待开始实现

## 1. 背景

当前仓库内已有两类资产：

- 管理端前端：`/Users/macbook2/Desktop/zy-main/frontend`
  - 其中“账号管理”主流程位于 `/Users/macbook2/Desktop/zy-main/frontend/src/views/TokenImport`
  - 已包含扫码登录、手机号登录、BIN 导入、账号删除、进入游戏等能力
- 游戏包：`/Users/macbook2/Desktop/zy-main/xyzw-pak`
  - 当前为独立 H5/资源包结构

用户希望将“账号管理前端相关功能”提取并合并到 `xyzw-pak` 的最终产品形态中，但不直接把管理页硬塞进游戏脚本内部，而是做成一个**统一应用壳**：

- 启动后先进入壳层页面
- 如后续需要可挂接激活码逻辑；若现有仓库没有稳定激活能力，则一期先不做
- 进入账号管理页
- 通过账号进入游戏
- 最终发布为：
  - Android APK
  - macOS 安装包

同时，用户明确要求：

- 账号**保存与管理离线化**
- 扫码登录 / 手机号登录 **允许联网**
- 优先解决“加载慢、白屏久、不丝滑”的问题

## 2. 一期目标

一期必须完成以下目标：

1. 做出一个新的应用壳，而不是继续依赖当前 `frontend + backend` 运行模式
2. 保留以下账号管理能力：
   - 微信扫码登录导入
   - 手机号登录导入
   - BIN 导入
   - 删除账号
   - 进入游戏
3. 账号信息改为本地存储，不依赖 `/Users/macbook2/Desktop/zy-main/backend`
4. 将 `xyzw-pak` 作为应用内游戏容器接入
5. 同一窗口/同一应用内完成“账号管理 → 游戏”的切换
6. 为后续打包 Android / macOS 提前整理清晰的壳层结构

## 3. 一期不做

以下内容不纳入本期范围：

- 后端 `/api/accounts` 账号同步
- 后端连接测试
- 后端 `launch-payload` 获取
- 用户体系、邀请/激活码后台管理
- 多账号批量任务、日志中心、任务配置页整体迁移
- 把全部 `frontend` 页面都迁入新壳

若仓库里已有可复用激活逻辑，后续可以挂载在壳层入口；否则一期先不阻塞主路径。

## 4. 推荐方案

采用“**统一壳前端 + 平台包装层 + 内嵌游戏容器**”方案。

### 4.1 总体结构

新增一个面向发布的壳层应用，承担四类职责：

1. **壳层页面**
   - 启动页
   - 可选激活页
   - 账号管理页
   - 游戏容器页
2. **本地账号仓库**
   - 负责账号元数据、本地 BIN、启动上下文持久化
3. **导入服务层**
   - 负责扫码登录、手机号登录、BIN 导入
4. **游戏启动桥**
   - 负责把本地账号数据注入 `xyzw-pak`

平台包装层建议为：

- macOS：Electron
- Android：Capacitor + Android WebView

这样可以共享绝大多数前端代码，仅保留少量平台桥接差异。

### 4.2 为什么不直接把账号管理硬塞进 `xyzw-pak`

不采用“直接改 `xyzw-pak` 为主壳”的原因：

- `xyzw-pak` 本身是游戏运行载体，启动链复杂
- 账号管理页面与游戏脚本生命周期差异很大
- 如果把管理 UI 直接揉进游戏包，后续容易出现：
  - 白屏链路变长
  - 页面状态污染
  - 加载顺序耦合
  - 打包与调试复杂度陡增

因此推荐保留 `xyzw-pak` 作为“游戏容器资产”，由外部壳层调度。

## 5. 页面与流程设计

### 5.1 页面流转

壳层首期流转如下：

1. 应用启动
2. 检查是否需要激活
   - 若已启用且未激活：进入激活页
   - 否则：直接进入账号管理页
3. 在账号管理页导入或选择账号
4. 点击“进入游戏”
5. 切换到同一应用内的游戏容器页
6. 游戏容器读取启动数据后启动 `xyzw-pak`
7. 用户可返回账号管理页

### 5.2 交互要求

- 不新开浏览器窗口
- 不通过外部 URL 跳转切系统
- 不出现“管理页是一个系统，游戏页又是另一个系统”的割裂感
- 第一次进入游戏允许出现受控加载过渡，但不能直接长时间白屏

## 6. 性能设计

用户最关注的是性能，因此一期设计围绕“减少白屏、减少冷启动次数、让切换可感知但不突兀”展开。

### 6.1 分层加载

应用启动时只加载壳层前端，不同步完整初始化 `xyzw-pak`。  
账号管理页出现后，再由后台空闲时机预热游戏容器。

收益：

- 首屏更快
- 避免一打开就把游戏资源包全部拖上来

### 6.2 游戏容器单实例复用

游戏容器采用**单实例可复用**策略：

- 第一次进入游戏时创建容器
- 后续进入游戏优先复用同一容器
- 切账号时注入新的启动数据，而不是每次重新创建独立容器

收益：

- 降低重复初始化成本
- 降低反复白屏概率

### 6.3 受控过渡层

点击“进入游戏”后不直接切空白页，而是：

1. 立即展示“正在进入游戏”过渡层
2. 后台准备启动载荷
3. 通知游戏容器加载
4. 游戏容器 ready 后再显示游戏画面

收益：

- 避免裸白屏
- 将不可避免的冷启动时间变成可接受的等待体验

### 6.4 本地数据分层

本地存储拆成两层：

#### 元数据层

保存：

- `id`
- `name`
- `importMethod`
- `server`
- `roleId`
- `wsUrl`
- `createdAt`
- `updatedAt`
- `lastUsedAt`
- `launchContextSummary`

#### 大对象层

保存：

- `token`
- `binData`
- `launchContext`
- `authPayload`

收益：

- 账号列表页只读轻量元数据
- 大对象读取仅在刷新或进入游戏时发生

## 7. 本地数据模型

建议本地账号对象至少包含：

```ts
interface LocalGameAccount {
  id: string;
  name: string;
  importMethod: "wxQrcode" | "phone" | "bin";
  token: string;
  server?: string;
  roleId?: string | number;
  wsUrl?: string;
  binData?: string;
  launchContext?: Record<string, any> | null;
  authPayload?: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}
```

### 删除规则

删除账号时必须同时清理：

- 元数据
- BIN 数据
- 最近进入记录
- 与该账号相关的启动缓存

## 8. 功能迁移范围

### 8.1 必迁移前端能力

来源于当前管理端的以下模块：

- `/Users/macbook2/Desktop/zy-main/frontend/src/views/TokenImport/index.vue`
- `/Users/macbook2/Desktop/zy-main/frontend/src/views/TokenImport/wxqrcode.vue`
- `/Users/macbook2/Desktop/zy-main/frontend/src/views/TokenImport/phone.vue`
- `/Users/macbook2/Desktop/zy-main/frontend/src/views/TokenImport/bin.vue`
- `/Users/macbook2/Desktop/zy-main/frontend/src/views/TokenImport/singlebin.vue`
- `/Users/macbook2/Desktop/zy-main/frontend/src/hooks/useIndexedDB.ts`
- `/Users/macbook2/Desktop/zy-main/frontend/src/utils/token.ts`
- `/Users/macbook2/Desktop/zy-main/frontend/src/utils/loginAuthPayload.js`
- 与账号本地 CRUD 相关的 store 逻辑

### 8.2 必裁剪部分

以下逻辑必须从当前实现中剥离或替换：

- `frontend/src/stores/token/tokenSync.ts` 中对 `/accounts` 的后端同步依赖
- `frontend/src/views/TokenImport/index.vue` 中对 `/accounts/:id/test-connection`、`/accounts/:id/launch-payload`、`/accounts/:id` 的调用
- `frontend/src/stores/tokenStore.ts` 中删除后端账号、恢复后端账号的逻辑

替代方式：统一改为本地账号仓库提供数据。

## 9. 游戏启动桥设计

壳层“进入游戏”时，启动桥负责完成以下步骤：

1. 根据账号 ID 从本地账号仓库读取完整账号对象
2. 规范化为游戏启动载荷：
   - token
   - wsUrl
   - binData
   - authPayload
   - launchContext
3. 将启动载荷写入壳层与 `xyzw-pak` 共享的本地桥接通道
4. 通知游戏容器开始启动

### 9.1 推荐桥接方式

优先级建议如下：

1. 同进程桥接对象 + 本地存储兜底
2. 受控 localStorage/sessionStorage 注入
3. 避免把大体积 payload 直接塞进 URL query

不建议使用大 querystring 传 token / binData，因为：

- 影响稳定性
- 容易污染日志
- 刷新/回退行为难控

## 10. 激活码策略

用户提到“激活可能已有”。因此本设计定义为：

- 壳层保留激活检查插槽
- 若仓库中存在稳定可复用的激活能力，则挂接在启动页之后
- 若不存在，则一期默认跳过激活检查

这样不会阻塞主路径实现，也不会把未确定功能硬编码进首版。

## 11. 打包设计

### 11.1 macOS

使用 Electron：

- 壳层前端作为主界面
- `xyzw-pak` 作为应用内可加载的本地静态资源
- 最终产出 `.dmg` 或 `.app`

### 11.2 Android

使用 Capacitor：

- 复用同一套壳层前端
- 游戏容器运行在 WebView 中
- 最终产出 APK

### 11.3 统一要求

- 应用资源尽量本地化打包
- 避免首次运行还要额外下载 `xyzw-pak`
- 平台差异尽量收敛在桥接层，不扩散到业务组件

## 12. 目录与模块建议

建议新增一个独立发布工作区，而不是继续把发布逻辑塞回当前 `frontend`：

- `app-shell/` 或 `shell/`
  - `src/views/Activation`
  - `src/views/Accounts`
  - `src/views/GameContainer`
  - `src/stores/localAccounts`
  - `src/services/importers`
  - `src/services/gameLaunchBridge`
  - `src/platform`

`xyzw-pak` 作为静态游戏资产目录被壳层引用，不作为壳业务代码目录。

## 13. 风险与缓解

### 风险 1：扫码/手机号登录链路耦合浏览器环境

缓解：

- 保留现有前端实现思路
- 优先在壳层 WebView 环境中复用
- 对必须依赖浏览器能力的部分做桥接封装

### 风险 2：`xyzw-pak` 首次加载过重

缓解：

- 壳层首屏不立刻初始化游戏
- 游戏容器延迟预热
- 单实例复用

### 风险 3：离线存储中大对象过多导致列表卡顿

缓解：

- 元数据 / 大对象分层
- 列表页只读元数据

### 风险 4：现有管理逻辑与后端强耦合

缓解：

- 先做本地账号仓库抽象
- 让 UI 改为只依赖本地仓库接口
- 再替换具体实现

## 14. 测试要求

一期至少验证以下链路：

1. 首次打开应用，直接进入账号管理页
2. BIN 导入成功，本地持久化成功，重启应用后仍存在
3. 微信扫码导入成功，本地持久化成功
4. 手机号登录导入成功，本地持久化成功
5. 删除账号后，本地数据彻底移除
6. 点击“进入游戏”后出现受控过渡，不出现长时间裸白屏
7. 第一次进入游戏成功
8. 返回账号管理，再次进入游戏时比首次更顺畅
9. mac 打包运行正常
10. Android APK 安装运行正常

## 15. 推荐实施顺序

1. 抽出本地账号仓库接口
2. 将账号管理页改造成只依赖本地仓库
3. 接入扫码 / 手机号 / BIN 三类导入
4. 接入本地 `xyzw-pak` 游戏容器
5. 实现游戏启动桥
6. 做过渡层和预热
7. 打通 Electron
8. 打通 Android 包装

## 16. 最终结论

本项目不应直接改造 `xyzw-pak` 为账号管理主壳，而应采用“**统一壳前端 + 本地离线账号仓库 + 内嵌 `xyzw-pak` 游戏容器 + 双平台包装**”方案。

这样可以同时满足：

- 保留扫码登录 / 手机号登录 / BIN 导入
- 离线保存和管理账号
- 降低白屏与冷启动问题
- 支持后续输出 Android APK 与 macOS 安装包

这是当前约束下最稳妥、后续维护成本最低、也最容易做出“看起来像一个完整产品”的路线。
