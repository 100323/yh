# XYZW Pak 运行时顶部导航固定兼容修复设计

日期：2026-04-29  
状态：已确认方案，待开始实现

## 1. 背景与问题

当前 Android 包进入游戏后，壳层顶部导航在首次点击游戏画面后会消失。用户要求：

- 顶部导航固定在应用顶部
- 游戏画面整体下移，为顶部导航让出稳定高度
- Android / macOS 共用同一套实现
- 不再使用“点击后偶发消失”的悬浮叠层策略

现状代码已经接近“两段式布局”，但还不彻底：

- `/Users/macbook2/Desktop/zy-main/xyzw-pak/shell/src/components/runtime/RuntimeStage.vue`
  - 顶栏使用 `position: fixed`
  - 游戏区使用 `padding-top` 让位
  - 游戏通过 `iframe` 承载
- 游戏 runtime 仍可能触发 Cocos 自动全屏逻辑：
  - `/Users/macbook2/Desktop/zy-main/xyzw-web-slim/main.2a00e.js`
  - `/Users/macbook2/Desktop/zy-main/xyzw-web-slim/cocos2d-js-min.a5841.js`
  - `/Users/macbook2/Desktop/zy-main/xyzw-pak/shell/src/xyzw/cocos2d-js-min.js`

这会导致 Android WebView 中：点击游戏画面后，Canvas / runtime 尝试接管全屏或重算显示区域，进而让壳层顶部导航在视觉上被“吃掉”。

## 2. 目标

本次修复完成后，应满足：

1. 顶部导航始终可见，不因点击游戏画面而消失
2. 顶部导航占用固定高度，游戏区整体下移
3. Android / macOS 共用一套壳层布局与运行时约束
4. 游戏运行时不得再主动请求 fullscreen 或 auto fullscreen
5. 保持现有单实例 iframe/runtime 复用能力
6. 不引入 Android 原生单独 Toolbar 兜底分支

## 3. 不做事项

本次不纳入范围：

- 改成 Android 原生 Toolbar + 前端双实现
- 大规模重构 Cocos 游戏主包业务逻辑
- 改动账号管理流程或 runtime 单实例复用策略
- 修改 macOS 与 Android 的页面结构为两套不同壳层

## 4. 方案对比

### 方案 A：继续保留悬浮顶栏，仅修 CSS 与 z-index

优点：改动小。  
缺点：Android 上仍可能被 fullscreen / 合成层行为击穿，问题难彻底收口。

### 方案 B：固定头部 + 游戏内容区整体下移（推荐）

优点：

- 布局模型明确
- 头部与游戏区职责分离
- 点击游戏不影响头部显示
- Android / macOS 可复用同一套实现

缺点：

- 需要重构 runtime 容器布局
- 游戏可视高度会减少一条头部高度

### 方案 C：Android 原生 Toolbar 单独兜底

优点：Android 稳。  
缺点：双实现，维护成本高，不符合“共用一套方案”的要求。

**结论：采用方案 B。**

## 5. 设计总览

本次修复分两层完成：

1. **壳层布局修复**
   - 把 runtime 页面改成真正的“固定头部区 + 游戏内容区”
   - 头部成为正式布局区域，不再视作浮在游戏上的 overlay
2. **游戏 runtime 约束修复**
   - 在 embed/runtime-shell 模式下，禁用 auto fullscreen / requestFullscreen
   - 让游戏只在壳层内容区内计算尺寸和渲染

两层同时落地，才能避免“壳层想固定，游戏层抢全屏”的冲突。

## 6. 组件与职责

### 6.1 `RuntimeStage.vue`

文件：`/Users/macbook2/Desktop/zy-main/xyzw-pak/shell/src/components/runtime/RuntimeStage.vue`

职责调整：

- `runtime-stage` 继续作为整屏 runtime 容器
- 顶部栏改成 runtime 内的稳定头部区
- 游戏区改成头部下方唯一内容区
- `iframe.runtime-frame` 只填充内容区，不再依赖“悬浮顶栏 + padding-top 撑开”的脆弱组合

关键要求：

- 顶栏高度明确、稳定、可复用
- 顶栏与内容区的层级关系固定
- 头部不参与游戏点击事件竞争
- 内容区 `overflow: hidden`
- 小屏与安全区统一由壳层处理

### 6.2 `runtimeStore.js`

文件：`/Users/macbook2/Desktop/zy-main/xyzw-pak/shell/src/stores/runtimeStore.js`

职责保持：

- runtime 显隐
- 单实例 iframe 复用
- 当前账号 / session 状态管理

限制：

- 不把布局常量与 DOM 逻辑塞进 store
- 仅在需要时补充 runtime 模式标记或 reload 条件

### 6.3 `slimGameLauncher.js`

文件：`/Users/macbook2/Desktop/zy-main/xyzw-pak/shell/src/utils/slimGameLauncher.js`

职责调整：

- 继续生成 runtime 启动 URL
- 明确传递 embed/runtime-shell 上下文
- 让运行时知道自己处于“壳内内容区”，不得抢全屏

要求：

- 保持现有 `embed=1` 能力
- 补充更明确的 shell 模式参数（如 `runtimeShell=1` 或等价标记）
- 保持与单实例复用逻辑兼容

### 6.4 runtime 注入补丁

优先修改：

- `/Users/macbook2/Desktop/zy-main/xyzw-web-slim/bootstrap.js`

同步产物：

- `/Users/macbook2/Desktop/zy-main/xyzw-pak/shell/dist/runtime/bootstrap.js`

职责：

- 在 embed/runtime-shell 模式下注入兼容补丁
- 禁止 auto fullscreen / requestFullscreen / screen.autoFullScreen
- 锁定 canvas/game container 的渲染边界在当前页面内容区
- 保持现有 embed 模式样式注入能力

## 7. 布局规则

### 7.1 壳层布局规则

runtime 页面必须是固定两段：

- 顶部固定头部区
- 下方自适应内容区

行为规则：

1. 头部高度固定，包含 safe-area top
2. 内容区高度 = 视口高度 - 头部总高度
3. iframe 高度严格跟随内容区
4. 头部永远不因游戏点击、焦点变化、重绘而隐藏
5. 头部按钮点击只作用于壳层，不透传给游戏

### 7.2 游戏容器规则

在 embed/runtime-shell 模式下：

1. `#Cocos2dGameContainer` 与 `canvas` 只能铺满 runtime 内容区
2. 不允许再把 body / canvas 拉满整个 viewport 覆盖头部
3. 不允许 runtime 主动切换浏览器 fullscreen
4. 若第三方逻辑尝试请求 fullscreen，应被拦截并安全降级

## 8. 数据流与状态流

### 启动流程

1. 用户从账号管理页点击进入游戏
2. `runtimeStore.launchAccount()` 复用或生成 runtime URL
3. `slimGameLauncher.js` 生成带 shell/embed 标记的启动地址
4. `RuntimeStage.vue` 展示固定头部与内容区
5. iframe 加载 runtime 页面
6. runtime `bootstrap.js` 识别 shell/embed 模式
7. 注入 fullscreen 禁用补丁与内容区渲染约束
8. 游戏在内容区内完成初始化并显示

### 点击游戏画面后的行为

1. 用户点击游戏画面
2. 游戏仍接收输入
3. 如果内部触发 auto fullscreen / requestFullscreen
4. 补丁层拦截该行为，不允许接管整个 viewport
5. 头部保持不变，游戏继续在内容区渲染

## 9. 错误处理

### 9.1 补丁注入失败

若 runtime fullscreen 补丁注入失败：

- 不中断游戏启动
- 记录明确 debug log
- 保持壳层头部与内容区布局
- 允许后续继续加强日志定位

### 9.2 头部高度计算异常

若安全区或视口计算异常：

- 回退到固定最小头部高度
- 内容区使用 `calc(100vh - fallbackHeight)` 或等价稳定布局
- 不允许出现头部与游戏区重叠

### 9.3 旧缓存 runtime 未生效

如果 Android 包仍加载旧 runtime 资源：

- 通过 `forceReload` / 构建产物同步确保新补丁生效
- 验证 `xyzw-pak/shell/dist/runtime/` 与源补丁一致

## 10. 测试与验收

### 10.1 必测场景

1. Android 包首次进入游戏
2. Android 包进入后连续点击游戏画面
3. Android 包返回账号管理，再次进入同账号
4. Android 包切换不同账号进入游戏
5. macOS 壳层进入游戏
6. 窄屏设备 / 带 safe-area 顶部区域设备

### 10.2 验收标准

满足以下全部条件才算完成：

1. 顶部导航始终可见
2. 点击游戏画面后顶部导航不消失
3. 游戏画面整体位于顶部导航下方
4. 返回账号管理按钮稳定可点
5. Android 与 macOS 视觉结构一致
6. runtime 单实例复用不退化
7. 不出现新的白边、头部重叠、内容被裁切异常

### 10.3 观察点

重点观察：

- Android WebView 中点击后是否仍触发 fullscreen 视觉变化
- iframe / canvas 是否越过内容区顶部
- safe-area 顶部高度是否稳定
- 再次进入时头部是否重复叠加或尺寸漂移

## 11. 实施顺序

1. 重构 `RuntimeStage.vue` 为正式两段式布局
2. 在 `slimGameLauncher.js` 增加明确 shell/embed 标记
3. 在 `xyzw-web-slim/bootstrap.js` 增加 fullscreen 禁用与内容区约束补丁
4. 同步 runtime 产物到 `xyzw-pak/shell/dist/runtime/bootstrap.js`
5. 本地验证 Android / macOS 运行表现
6. 如仍有 Android 特例，再做最小补丁，不提前引入原生双实现

## 12. 结论

本次修复不再把顶部导航当作“浮在游戏上面的悬浮层问题”，而是把它定义为 **runtime 的正式头部区**。同时，游戏运行时在 shell/embed 模式下被明确约束为 **只能渲染在头部以下的内容区、不得接管 fullscreen**。

这是当前最符合用户要求、且后续维护成本最低的统一方案。
