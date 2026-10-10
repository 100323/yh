# 咸鱼之王 0.32.0 逆向报告：IP 限频机制 & 盐场/蟠桃布阵加入战场

- 目标：`咸鱼之王_0.32.0.apk`（406 MB，Cocos Creator 3.x + `libcocos2djs.so`）
- 脚本：`assets/assets/game/index.9cc7e.jsc`(14 MB)、`launcher/index.5dbc4.jsc`(784 KB)
- 密钥：XXTEA key `0Aed5E79bbEa69f8`（复用仓库 `xyzw-web-slim/tools/decrypt-jsc.js`）
- 解密产物：`work/apk_raw/assets/assets/{game,launcher,TEST_REMOTE_MODULE}/index.*.js`

---

## 一、结论速览

| 问题 | 结论 |
|---|---|
| IP 限频是什么 | **服务端侧**，客户端只负责「别把 IP 玩坏」。客户端自保护阈值 = **1 分钟内 30 次 WS 连接**；服务端封禁返回 **`-10008 IPisBan`** |
| 客户端怎么应对 | 达到阈值 → 主动 `NetworkManager.close()` + 置 `exitWhenNetClose`（下次断线直接退出，不再重连） |
| 重连节奏 | 前 10 次 **1s** 间隔，之后 **60s** 间隔；最多 3 次（`repeatConnect` 时才无限） |
| 心跳/发送节流 | 心跳 **5s**，心跳超时 10s；**每渲染帧最多发 10 条、收 10 条**（60fps ≈ 上限 600 条/s，实际远低于此） |
| 盐场/蟠桃归属模块 | **`LEGION_PAYLOAD`（蟠桃/物资战）** 与 **`LEGION_WAR`（盐场/军团战）**，共用「独立战场服」连接模型 |
| 布阵加入战场的关键缺口 | **必须用响应里的 `sid` + `domainName` 连战场专用服**。本站**完全没实现 `domainName`**，硬编码了域名 → 这是「一直没弄好」的根因 |

---

## 二、IP 限频机制（完整还原）

### 2.1 客户端自保护：`FixO4eConnectErr`（核心）

位置：`game/index.9cc7e.js` @3128944（模块名 `FixO4eConnectErr`，由 `LoginManager._addListeners` 注册，
可用开关 `C_SwitchId.NotFixWsMaskFlag` 关闭）。

```js
function s(){ this.limit = 30; this.timeStamps = new Set() }

s.prototype.reset = function(){
  NetworkManager.wsDelegate.events.off(EVENT_CONNECTED, this._onWSConnected, this)
  NetworkManager.wsDelegate.events.on (EVENT_CONNECTED, this._onWSConnected, this)
  this.timeStamps.clear()
}

s.prototype._onWSConnected = function(){
  var e = this.timeStamps
  e.add(DateUtil.serverTime)          // 记录每次 WS 连上的服务端时间
  console.warn("ws connected:", e.size)
  this._checkLimit(Array.from(e))
}

s.prototype._checkLimit = function(e){
  var i = this.limit                                  // 30
  if (e.length < i) return
  var last = e.length - 1
  var back = e.length - i                             // 倒数第 30 个
  if (e[last] - e[back] < DateUtil.MinuteDuration) {  // MinuteDuration = 60000ms
    this.timeStamps.clear()
    LoginManager.instance.exitWhenNetClose = true     // ★ 标记：断线即退出
    NetworkManager.close()                            // ★ 主动断开
  }
}
```

**含义**：官方认为「**60 秒内建立 ≥30 次 WebSocket 连接**」= 异常行为（脚本/加速器特征），
于是**自己先断线并放弃重连**，以免把出口 IP 送进服务端黑名单。

> 这是「IP 限频」在客户端可见的全部内容 —— 阈值本身由服务端控制，客户端只是保守跟随。

`exitWhenNetClose = true` 后的表现（`LoginManager._onWSClosed`）：
弹窗「网络异常 / 检测到您的网络环境不稳定，请切换网络重启游戏再试」，然后 `exitGame()`。

### 2.2 服务端封禁错误码：`IPisBan = -10008`

位置：`game/index.9cc7e.js` @5864069（`LoginManager` 内）。

```js
LoginError   = { UserReturn: -10009, freeze: 200600 }
AuthUserError = {
  PlatformParamError: -10000,
  PlatformVerfyError: -10001,
  LoginParamError:    -10002,
  ServerIdError:      -10005,
  RoleIsBan:          -10007,   // 角色封禁
  IPisBan:            -10008,   // ★ IP 封禁（IP 限频/封禁的最终形态）
  ServerIsClose:      -10009,
  RoleCntMax:         -10010,   // 角色数超上限
  ParamError:          200020,
  LoginInfoExpire:     200550,
  Freeze:              200600,
  DeleteFreezeRole:    200610,
}
// 另有代码分支里出现的 -10011（走 _doLogout）
```

登录鉴权走 `LoginService.authUser(...)`（HTTP `POST /login/authuser`），
返回 `code = -10008` 即 IP 被封。`_authUser` 里的分支处理：

| code | 处理 |
|---|---|
| -10009 ServerIsClose | 弹窗 → 退出 |
| -10007 RoleIsBan | 弹窗 → 退出 |
| -10010 RoleCntMax | 清 `serverId` → 「角色超过上限」→ 退出 |
| -10011 / -10001 / 200610 / 200550 | `_doLogout()` |
| 200600 Freeze | `waitUnfreeze()` 轮询解冻 |
| **-10008 IPisBan** | 无专门分支 → 落到 `throw code+" "+error`，前端表现为登录失败 |

### 2.3 重连退避（`LoginManager._tryReLogin`）

```js
var t = this.repeatConnect ? 999999999 : 3        // 默认最多 3 次
if (this._tryReLoginTimes >= t) { /* 弹「断网 / 尝试重新连接？」*/ }
else {
  var delay = this._tryReLoginTimes > 10
            ? 60 * this._tryReLoginMaxTimes        // 60 * 1000 = 60000ms
            : this._tryReLoginMaxTimes             // 1000ms
  setTimeout(() => { this._tryReLoginTimes++; this.reLogin()... }, delay)
}
```

→ **1s × 10 次，之后 60s 一次**。这是刻意拉长的，配合 §2.1 的 30 次/分钟阈值。

### 2.4 网络层节流参数（`@o4e/core`，launcher @119592）

```js
d = { rpc: {
  connectTimeoutTotal:   1e4,   // 10s   总连接超时
  connectTimeoutOnce:    3e3,   // 3s    单次连接超时
  connectRetryMinInterval:1e3,  // 1s    重连最小间隔
  heartbeatInterval:     5e3,   // 5s    心跳间隔
  heartbeatTimeout:      1e4,   // 10s   心跳超时
  httpTimeout:           0,
  maxSendOnce:           10,    // ★ 每帧最多出队 10 条
  maxRecvOnce:           10,    // ★ 每帧最多入队 10 条
  networkState: () => 1
}}
```

驱动方式：`update()` 用 `requestAnimationFrame`（无则 `setTimeout(...,10)`）递归自调用
（launcher @139936 / @146330）。启动阶段会覆盖为 `connectTimeoutTotal:2e4, connectTimeoutOnce:1e4`。

**发送节流逻辑**（@148179）：
```js
if (now > _nextHeartbeatTime) sendHeartbeat()          // 心跳
for (r = maxSendOnce; _sndQueue.length && !nextState && r--; )
    doSend(_sndQueue.dequeue())                        // 每帧最多 10 条
for (i = maxRecvOnce; _recQueue.length && !nextState && i--; )
    doReceive(_recQueue.dequeue())
```

> 所以官方客户端的实际发送速率被两重限制：**队列每帧 10 条** + **心跳 5s**。
> 我们的自动化如果不做节流，很容易在短时间内产生远超官方的连接/请求密度 → 触发 §2.1/§2.2。

### 2.5 网络层其它事实（对写自动化有用）

- **WS URL 构造**（launcher @144368）：
  ```
  <url>?p=<encodeURIComponent(JSON.stringify({roleToken, sessId, connId, isRestore}))>
        &e=<encoding>
        [&ack=<recvSeq>]                       // 仅 isRestore=1 时
        [&sid=<sid>][&sid2=<sid2>][&lang=<lang>][&fs=<frameSize>]
        [&perMessageDeflate=0]                 // 第 2 次重连起
  ```
  参数名映射表：`et = { sid:"sid", sid2:"sid2", lang:"lang", frameSize:"fs" }`
  默认 base url = `d.url` 经 `http→ws / https→wss` 后 **+ `/agent`**。
- **HTTP 路径**（launcher @137644）：`<base>/<cmd 首个 _ 换成 />?_seq=N&_hint=&_lang=`
  （例：`legion_getpayloadbf` → `/legion/getpayloadbf`）
- **请求头**：`O4e-Token` / `O4e-Version` / `O4e-Encoding`，`Content-Type: application/octet-stream`
- **编码前缀**（@136113）：解密时按前 2 字节分流 —— `pl`→lx、`px`→x、`pt`→xtm
- **大包分帧**：超过 `frameSize` 时切块，每块前 8 字节头，`uint32(0)=1836213824`（小端 `@frm`），`uint32(4)=总长`
- **框架错误码**（@136113）：`TIMEOUT=-2, UNKNOWN=-1, NEED_AUTH=-3, AUTH_ERROR=-4, CANCELED=-5, SKIP=6`；
  `code<0` 即触发连接错误态
- **服务器环境表**（launcher @667500，`platform-browser`）：
  ```
  prod      https://xxz-xyzw.hortorgames.com        ← 正式服（主连接用这个）
  asia_prod https://asia-xyzw.hortorgames.com
  audit     https://xxz-ddsg-audit.hortorgames.com
  test      https://xxz-ddsg-test.hortorgames.com
  test2     https://xxz-ddsg-next-test.hortorgames.com
  test3     https://xxz-xyzw-test-03.hortorgames.com
  test4     https://xxz-xyzw-k8s-test.hortorgames.com
  dev       https://xxz-xyzw-dev.hortorgames.com
  asia_test https://asia-xyzw-test.hortorgames.com
  asia_audit https://asia-xyzw-audit.hortorgames.com
  内网：localhost:10101 / 10.1.5.250 / 10.1.7.242 / 10.2.0.16 / 10.1.3.248
        10.1.6.238 / 10.2.0.49 / 10.8.2.10 / 10.1.4.168
  ```
  ⚠️ **官方环境表里没有 `xxz-xyzw-new.hortorgames.com`**（本站盐场在用），它是另一个真实网关
  （实测 `https://xxz-xyzw-new.hortorgames.com/agent` → HTTP 500，`120.53.131.70`），
  但**不是官方代码里使用的战场地址**。

### 2.6 连接被服务端拒绝时的错误串协议

服务端在 WS close 事件里下发字符串，客户端 `indexOf` 匹配（`LoginManager._onWSClosed`）：

| 错误串 | 客户端表现 |
|---|---|
| 含 `kick` | 「掉线 / 已离线，请重新登录」→ 退出 |
| 含 `other login` / `redirect` | 「账号重复登录」→ 退出 |
| 含 `stopped` | 「游戏维护」→ 退出 |
| 含 `服务器正在停机维护中` | 提示 → 退出 |
| 含 `session busy` | 「游戏拥挤 / 当前登陆人数过多」→ 退出（仅 `AUDIT_SWITCH` 开时） |
| 其它 | `_tryReLogin()` 走 §2.3 退避 |

**自动化建议**：若我们自己的连接被服务端拒绝，优先看 close 原因串；
出现 `kick`/`redirect` 类说明是**账号级冲突**（多端同时在线），不是 IP 问题。

---

## 三、盐场 / 蟠桃「布阵 + 加入战场」完整链路

### 3.1 模块与场景归属

- 枚举：`BattleDeployType.LegionPayload = 20`（布阵面板类型）
- 布阵适配器：`LPDeployDataAdapter`（蟠桃）/ `LegionWarDeployDataAdapter`（盐场）
- 前端 bundle：`legion_payload`、`ui_lp_war_shop`、`LP_TM`、`LP_WAR`
- 关键类：`LPBattleFieldInfo` / `LPBattles` / `LPCarData` / `LPBuilding` / `LPSignal`

### 3.2 协议清单（从 0.32.0 主包提取）

**查询类（走主连接）**
```
Legion_GetBattlefieldResp        盐场战场信息
Legion_GetPayloadBfResp          蟠桃战场信息
Legion_GetPayloadRecordResp      战绩
Legion_GetPayloadCarRecordResp   车辆记录   (入参 {date})
Legion_GetPayloadKillRecordResp  击杀记录   (入参 {date})
Legion_GetPayloadDetailsResp     详情
Legion_InfoNotify
Flow_GetSidResp / FlowWar_EnterResp
```

**战场内（走战场专用连接）**
```
Payload_EnterBfResp              Payload_SetBattleTeamResp
Payload_StartBattleResp          Payload_StartMarchResp
Payload_CancelMarchResp          Payload_StartChangeCarPathResp
Payload_StartPickItemResp        Payload_UseItemResp
Payload_UpdateFlagResp           Payload_GetTeamImgInfoResp
Payload_GetTeamInfoResp
Payload_StateChangeNotify        Payload_SyncCarNotify
Payload_CarMoveNotify            Payload_EndMarchNotify
Payload_GenCarNotify             Payload_ItemRefreshNotify
Payload_ResurrectNotify          Payload_EndBattleNotify
Payload_EndLightingNotify        Payload_EndPickItemNotify
Payload_EndChangeCarPathNotify   Payload_UseSkillNotify
```

### 3.3 关键字段（服务端下发）

**`Legion_GetPayloadBfResp`**（@5004245 / `GDPayloadBfInfo` @5059095）
```jsonc
{
  "ended": false,
  "info": {
    "bfId":       "<战场ID>",      // 后续所有 payload_* 都要带
    "sid":        "<会话ID>",      // → WS 参数 sid2
    "domainName": "<战场服域名>",  // ★ → WS 连接地址
    "startTime":  1234567890
  },
  "legions": [ { "id": 12, "score": 0, ... } ]   // 我方/敌方军团
}
```

**`Legion_GetBattlefieldResp`**（盐场，@5593811）
```jsonc
{ "info": {
    "phase","type","legionWarMapType",
    "battlefieldId","readyTime","startTime","endTime",
    "signupStartTime","signupEndTime","battlefieldNumber",
    "canEnterWar",
    "sid","domainName",              // ★ 同上
    "subType"
  },
  "isInMonthWar":false, "isInWeekWar":false }
```

### 3.4 官方调用顺序（`LPBattleField`，@5061358）

```
1) 报名         legion_payloadsignup {}              (蟠桃)
                legion_signup {}                     (盐场)
2) 取战场信息   legion_getpayloadbf {}               (蟠桃)
                legion_getbattlefield {}             (盐场)
                → 记下 info.bfId / info.sid / info.domainName
3) ★ 连战场服   new WebSocketDelegate(true).connect({
                   token:  roleToken,
                   encoding: Encoding.X,
                   url:    info.domainName,          // ← 不是主服地址
                   lang:   lang,
                   sid2:   info.sid,                 // ← 注意是 sid2
                   version: version
                })
4) 注册监听     NetworkManager.on(RESPS.Payload_EnterBfResp, ...)
                ... 全部 Payload_*Resp / *Notify
5) 进战场       payload_enterbf { bfId }
6) 布阵上传     payload_setbattleteam { bfId, battleTeam, lordWeaponId }
7) 开战/行军    payload_startbattle { bfId, targetId }
                payload_startmarch  { bfId, carId, path:[{x,y},...] }
8) 心跳         PayloadService.ping({ bfId })         // 每 5s
```

`enterBattlefield` 失败会重试 **3 次**，然后 `SHOW_TIP("连接战场失败")`；
加载超时提示 `CODE_War_EnterBattlefieldTimeout`。

### 3.5 战场内请求参数（全部 @5008343~5009537）

| cmd | 参数 |
|---|---|
| `payload_enterbf` | `{ bfId }` |
| `payload_setbattleteam` | `{ bfId, battleTeam, lordWeaponId }` |
| `payload_startbattle` | `{ bfId, targetId }` |
| `payload_startmarch` | `{ bfId, carId, path: [{x,y}...] }` |
| `payload_cancelmarch` | `{ bfId }` |
| `payload_startchangecarpath` | `{ bfId }` |
| `payload_startpickitem` | `{ bfId }` |
| `payload_useitem` | `{ bfId, carId }` |
| `payload_useskill` | `{ bfId, point: {x,y}, skillId }` |
| `payload_updateflag` | `{ bfId, tileId, delete }` |
| `payload_getteaminfo` | `{ bfId, roleId }` |
| `payload_getteamimginfo` | `{ bfId, imgNameList }` |
| `PayloadService.ping` | `{ bfId }` |

### 3.6 战场错误码（`_onError` @4155486）

| code | 行为 |
|---|---|
| `10000100` / `10000050` / `12100038` / `10000090` | **强制退出战场** |
| `10000200` | 忽略 |
| `10000110` | `errTimes++`，>10 次且超过 `checkErrTime` → 重新拉取战场 |

---

## 四、本站现有实现 vs 官方：缺口清单

### 4.1 已经有的（不用重做）

- 命令注册：`legion_getpayloadbf` / `legion_getpayloadrecord` / `legion_getpayloadkillrecord` /
  `legion_getpayloadtask` / `legion_payloadsignup` / `legion_getbattlefield` / `legion_signup`
  （`frontend/src/utils/xyzwWebSocket.js` L199-221, L346-349）
- 战场命令：`payload_enterbf` / `payload_setbattleteam` / `payload_startbattle` /
  `payload_startmarch` / `payload_startpickitem` / `payload_useitem`
  （`frontend/src/utils/xyzwLegionWarWebSocket.js` L95-145）
- 战场独立连接骨架：`frontend/src/stores/legionWarStore.js` L62-152
- 记录展示：`Club/PeachInfo.vue`、`Club/PeachBattleRecords.vue`、`LegionWar.vue`

### 4.2 🔴 缺失 / 错误（按严重度）

| # | 问题 | 位置 | 后果 |
|---|---|---|---|
| 1 | **完全没有 `domainName`** —— 全仓库 0 处引用 | `legionWarStore.js:82`、`LegionWar.vue:709` | 连的是硬编码域名而非服务端指定的战场服 → 进不去/随机失败 |
| 2 | WS 地址硬编码 `wss://xxz-xyzw-new.hortorgames.com/agent` | `legionWarStore.js:82` | 该域名**不在官方环境表内**，官方用 `domainName` 动态下发 |
| 3 | `sid2` 参数**重复拼接两次** | `legionWarStore.js:84-85`、`LegionWar.vue:709` | 参数脏；应只出现一次 |
| 4 | 用 `legion_getbattlefield`（盐场）取蟠桃战场信息 | `legionWarStore.js:68-73` | 蟠桃应该用 `legion_getpayloadbf`；两者 `info` 结构不同（盐场 `battlefieldId`，蟠桃 `bfId`） |
| 5 | `battlefieldId` 字段名用错 | `legionWarStore.js:79` | 蟠桃链路的字段是 **`bfId`**；`payload_*` 全部要吃 `bfId` |
| 6 | 战场心跳写成 `cmd:"war_ping", body:{battlefieldId}` | `xyzwLegionWarWebSocket.js` L67-76 | 官方战场心跳是 `PayloadService.ping({bfId})`，字段是 `bfId` 不是 `battlefieldId` |
| 7 | 战场命令缺 `payload_cancelmarch` / `payload_startchangecarpath` / `payload_useskill` / `payload_updateflag` / `payload_getteaminfo` / `payload_getteamimginfo` | `xyzwLegionWarWebSocket.js` L95-120 | 行军后取消/改道/技能/插旗全部不可用 |
| 8 | 盐场用 `war_*` 命令族 | `xyzwLegionWarWebSocket.js` L100-107 | 官方 0.32.0 主包里**没有 `war_*` 这一族**（只有 `Payload_*` / `Legion_*` / `FlowWar_*`），需确认是否旧版协议 |
| 9 | 无 `p` 参数 JSON 化（`p={"roleToken",...}`） | `localTokenManager.js:204-211`、`gameClient.js:569` | 官方 `p` 是 JSON。当前用裸 token **能连通**（服务端兼容），但**不是官方格式**，风控友好度未知 |
| 10 | 无连接频率节流 | 全局 | 官方有 30 次/分钟自保护；我们没有 → 更容易触发服务端 IP 封禁 |

### 4.3 修复优先级建议

1. **P0**：`legion_getpayloadbf` → 读 `info.bfId` / `info.sid` / `info.domainName`，
   用 `domainName` 建连，`sid2 = info.sid`，`payload_*` 全部带 `bfId`。
2. **P0**：去掉重复 `sid2`，删掉硬编码域名兜底（仅在 `domainName` 为空时回退）。
3. **P1**：加连接频率节流（对齐官方：**60s 内 ≤30 次 WS 连接**；心跳 5s；发送排队 ≤10 条/帧）。
4. **P1**：补齐 §3.5 缺失的 `payload_*` 命令。
5. **P2**：`p` 参数改为官方 JSON 格式（`{roleToken, sessId, connId, isRestore}`）。
6. **P2**：处理 `-10008 IPisBan`（识别并退避，而不是无限重试）。

---

## 五、可复现命令

```bash
# 1) 解包
unzip -o -q 咸鱼之王_0.32.0.apk "assets/assets/*" -d work/apk_raw

# 2) 解密（密钥已内置在仓库工具里）
cd work/apk_raw/assets/assets
node E:/yh-main/xyzw-web-slim/tools/decrypt-jsc.js \
     game/index.9cc7e.jsc launcher/index.5dbc4.jsc TEST_REMOTE_MODULE/index.f8a54.jsc

# 3) 关键词检索（work/jsscan.js 是本报告用的扫描器）
cd E:/yh-main/work
MAX=6 CTX=300 node jsscan.js apk_raw/assets/assets/game/index.9cc7e.js \
    "FixO4eConnectErr" "IPisBan" "getPayloadBf" "domainName" "sid2"
```

关键锚点（偏移量，方便复现）：
```
@3128944   FixO4eConnectErr.limit=30            ← IP 限频客户端自保护
@5864069   LoginError / AuthUserError 枚举      ← IPisBan=-10008
@5867395   LoginManager._tryReLogin             ← 1s×10 → 60s
@119592    @o4e/core rpc 默认参数               ← heartbeat/maxSendOnce
@144368    WS URL 拼接（p/e/sid/sid2/lang/fs）  ← 连接格式
@5004245   sendGetPayloadBf                     ← 蟠桃战场信息
@5059095   GDPayloadBfInfo {bfId,sid,domainName}
@5061358   LPTask.enterBattlefield 完整流程      ← 布阵加入战场
@5008343~5009537  payload_* 全部入参
@4155486   战场 _onError 错误码
@5593811   盐场 _onGetBattlefield
```

---

## 六、实施记录（2026-10-10 第二轮）

### 6.1 ⚠️ 对第四章的两处更正

**更正 1：`war_*` 是真实存在的命令族**（原文 §4.2 第 8 条判断有误）

`game/index.9cc7e.js` 里有三个平行的「战场网络」类，各自用不同前缀路由命令：

| 类 | 前缀 | 判定方式 | 玩法 |
|---|---|---|---|
| `LegionWarNetworkData` | `war_` | **硬编码** `cmd.startsWith("war_")` | 盐场（俱乐部战 / 联赛 / 月度战） |
| `LegionPayloadNetworkData` | `payload_` | 构造函数 `this._prefix="payload_"` | 蟠桃 / 物资战 |
| `SkyNetworkData` | `skywar_` | 构造函数 `this._prefix="skywar_"` | 天空战 |

```js
// LegionWarNetworkData._socketSenderWrapper  (game @5680102)
r.setSender({
  send: function (e) {
    var t;
    null != (t = e.cmd) && t.startsWith("war_")
      ? i.wsDelegate && i.wsDelegate.send(e)     // → 战场专用 WS
      : r.WebSocketDelegate.current.send(e);     // → 主服
  }, ...
});
```

心跳也是分族的：

```js
// 盐场 (game @5644216)
x.prototype.sendWarPing = function () {
  if (this._battlefield && this._battlefield.self.isSignIn)
    return d.WarService.ping({ battlefieldId: this._battlefield.id });
};

// 蟠桃 (game @4155351)
a.prototype._sendWarPing = function () {
  if (this._battlefield && this._battlefield.self)
    return u.PayloadService.ping({ bfId: this.battlefield.serverData.id });
};
```

**更正 2：`sid2` 的取值来自 `info.sid`，`domainName` 是完整地址**

```js
// 两个类的建连实现完全一致（game @5677683 / @5014789）
o.prototype.connect = function () {
  var e, t, i, o, n;
  return this.connectType === a.Direct ? (
    this._wsDelegate = new r.WebSocketDelegate(!0),
    n = r.WebSocketDelegate.current.socket.connectOptions,
    e = n.lang, t = n.encoding, i = n.token,
    o = this.sId,
    n = n.url,
    this.useDomainName && (n = this.domainName, isAndroidAndNative) && (n = n.replace("wss", "ws")),
    this.wsDelegate.events.on(r.EVENT_PRECONNECT, function (e) { e.data.url += "&sid2=" + o }),
    this.wsDelegate.connect({ token: i, encoding: t, url: n, lang: e, sid2: o })
  ) : Promise.resolve(!0);
};
```

→ `domainName` **直接当完整 WS 地址**用（自带 `/agent`），不拼接；`sid2 = info.sid`。

**补充发现：通用 `flow_getsid` 入口**

除玩法专属的 `info.domainName` 外，还有一个与玩法无关的通用入口：

```js
// LWNetTestTask (game @4342589)
this.sendGetSId()                       // → FlowService.getSid({})
  → sidResp = Flow_GetSidResp { isOpen, domainName, sid }
if (!isOpen || domainName.length <= 0 || sid.length <= 0) return this.finish();
this.connect();                          // → { token, encoding, url: domainName, lang, sid2: sid }
```

**当 `legion_getbattlefield` / `legion_getpayloadbf` 返回的 `info.domainName` 为空时，
可以退一步用 `flow_getsid` 拿专用服地址。**（当前实现先退回硬编码主服，建议后续接上这一层。）

### 6.2 已落地的代码改动

#### 前端

| 文件 | 改动 |
|---|---|
| `src/utils/battleFieldUrl.js` | **新增**。`normalizeDomainName()` 兼容 `wss://h/agent`、`wss://h`、`https://h/agent`、`https://h`、`//h`、裸域名；`buildBattleFieldWsUrl()` 以 `domainName` 为主、硬编码为兜底，**`sid2` 只输出一次**，且用 `encodeURIComponent`（不用 `URLSearchParams`，避免 `+` → `%2B` 改变 token 语义） |
| `src/utils/wsConnectThrottle.js` | **新增**。滑动窗口闸门，默认 **24 次 / 60s**（官方 30 次即自杀，留 20% 余量）；导出 `AUTH_USER_ERROR` 全量枚举、`isIpBanned()`、`reconnectBackoffMs()`（前 10 次 1s、之后 60s） |
| `src/utils/xyzwLegionWarWebSocket.js` | 命令表补全：`WAR_COMMANDS`(25) + `PAYLOAD_COMMANDS`(15) + `BATTLE_QUERY_COMMANDS`(12)；心跳按 `kind` 切 `war_ping{battlefieldId}` / `payload_ping{bfId}`；`BATTLE_RESP_SUFFIX` 补全；新增 `enterBattlefield()` / `setBattleTeam()` / `startBattle()` / `startMarch()` 快捷方法；建连前过闸门，连接成功记账 |
| `src/stores/legionWarStore.js` | 重写。`connect({ kind })` 按盐场/蟠桃分支取信息；用 `info.domainName` 建连；新增 `setBattleTeam` / `startBattle` / `startMarch` action；暴露 `battlefieldKind` / `bfId` / `battleDomainName` |
| `src/views/LegionWar.vue` | `:709` 改用 `buildBattleFieldWsUrl`，去掉重复 `sid2` 与硬编码域名 |

#### 后端

| 文件 | 改动 |
|---|---|
| `src/utils/wsConnectThrottle.js` | **新增**。同前端逻辑，另加 `resolveThrottleKey()` —— **按出口 IP 分桶**：直连账号全部落 `direct` 桶（共用服务器公网 IP 配额），走代理的账号各自独立计数 |
| `src/utils/gameClient.js` | 支持 `options.domainName` / `options.sid`，`buildWsUrl()` 按官方 query 顺序拼接；`connect()` 外层包闸门；收到封禁类错误码时记录 `lastBanCode`，**`IPisBan(-10008)` 时把该出口的闸门配额直接打满**，强制后续连接排队等待 |
| `src/config/index.js` | `wsUrl` 改为读 `GAME_WS_URL`；新增 `game.connectThrottle{ enabled, limit=24, windowMs=60000 }` |
| `src/utils/proxyPool/ProxyValidator.js` | **修 bug**：`uncaughtException` 监听器由「每次验证 `prependListener` 一个」改为**进程级单例 + 引用计数** |
| `src/utils/proxyPool/ProxyPoolManager.js` | 账号级代理粘性 **30s → `accountProxyStickyMs`（默认 6h）**；新增 `maxAccountsPerProxy`（默认 1，即一账号一 IP），池子占满时自动放宽并优先选负载最低的 |
| `src/utils/proxyPool/config.js` | 新增 `accountProxyStickyMs` / `maxAccountsPerProxy` |

### 6.3 验证结果（全部实测）

```
前端 vite build                          ✅ 通过（产出 battleFieldUrl-*.js）
  └ LegionWar chunk 中 "xxz-xyzw-new"    → 0 次（硬编码已清除）
  └ battleFieldUrl chunk 中 "sid2="      → 1 处（URL 构建，另 1 处是日志格式化）

normalizeDomainName 10 个形态            ✅ 10/10 PASS
buildBattleFieldWsUrl                    ✅ sid2 出现 1 次；token 编码保持 encodeURIComponent 语义
后端 GameClient(domainName)              ✅ https://bf-1.h  → wss://bf-1.h/agent?p=..&e=x&sid2=..&lang=chinese
后端闸门                                 ✅ 25 次后 canConnect=false，waitMs=60000
ProxyValidator 监听器                    ✅ 20 并发时进程上只有 1 个 uncaughtException 监听器（旧实现 11+）
ProxyPoolManager 粘性                    ✅ 5 分钟后仍复用同一代理（旧实现会换）
ProxyPoolManager 一账号一 IP             ✅ 5 个账号分到 5 个不同代理
```

### 6.4 服务器现状与风险（193.112.151.193）

| 项 | 实测值 |
|---|---|
| `xyzw-backend` | id=6，online，**restarts=260**，mem=551MB，uptime=636min |
| 代码 HEAD | `c709c2415`（2026-10-01），工作区 5 个 `M` + 5 个 `.bak-invite` 未提交 |
| `backend/.env` | **只有 `ENCRYPTION_KEY` / `JWT_SECRET`** → 无 `ZENPROXY_API_KEY` |
| `data/proxy_config.json` | `enabled:true`、`fallbackToDirect:false`、whitelist 40 个账号 |
| `data/proxy_pool.json` | **25 个可用代理，全部来自免费公开源**（socks4/socks5/http） |
| 近 1500 行日志 | `proxyMode:'proxy'` 51 次 vs `'direct'` 1 次 |
| error 日志 | `MaxListenersExceededWarning: 11 uncaughtException listeners` × 56（最后 3000 行） |

**结论：IP 限频的真正风险不在「有没有用代理」，而在「用的代理质量」与「IP 与账号的对应关系」。**

1. **免费公开代理的出口 IP 被大量用户共用** —— 官方看到的这个 IP 可能已被无数脚本用过，
   命中风控的概率反而高于干净的直连。
2. **代理粘性只有 30 秒**（已修）—— 同一账号每隔几分钟换一个 IP，
   这正是「同账号短时间多 IP」的特征，最容易触发 `RoleIsBan` / 强制下线。
3. **`uncaughtException` 监听器泄漏**（已修）—— 刷屏掩盖真实错误，
   并且验证期间进程上挂着 `uncaughtException` 监听器，会让**真正的未捕获异常被静默吞掉**。
4. **无连接频率闸门**（已修）—— 免费代理频繁超时 → 重连 → 建连次数暴涨 → 逼近 30 次/60s 阈值。

**待决策项**

- `ZENPROXY_API_KEY` 缺失 → ZenProxy 付费代理池完全不可用，只能吃免费代理。
  需要补 key 才能恢复付费住宅/机房代理。
- 25 个代理 vs 40 个白名单账号 → 做不到严格「一账号一 IP」，
  `maxAccountsPerProxy=1` 在池子占满时会自动放宽。要么扩代理源，要么接受共享。

---

## §7 直连路径稳定性审计（上线前确认）

> 范围：按用户要求，**代理池暂不处理**（免费代理本身不稳定，非本次目标），
> 只审计**直连（direct）**路径上本轮优化是否引入新的不稳定因素。

### 7.1 本轮改动清单（8 改 + 4 新增）

| 文件 | 状态 | 作用 |
|---|---|---|
| `backend/src/utils/wsConnectThrottle.js` | 新增 | 后端建连闸门（按出口 IP 分桶，fail-open） |
| `backend/src/utils/gameClient.js` | 改 | `connect()` 前置闸门；`buildWsUrl()` 支持 domainName；`lastBanCode` 熔断 |
| `backend/src/config/index.js` | 改 | `game.connectThrottle.{enabled,limit,windowMs,maxWaitMs}` |
| `backend/src/utils/proxyPool/ProxyValidator.js` | 改 | 修复 `uncaughtException` 监听器泄漏（进程级单例 + 引用计数） |
| `backend/src/utils/proxyPool/ProxyPoolManager.js` | 改 | 账号-代理粘性 30s → 6h |
| `backend/src/utils/proxyPool/config.js` | 改 | `accountProxyStickyMs`、`maxAccountsPerProxy`（默认 0） |
| `frontend/src/utils/battleFieldUrl.js` | 新增 | domainName 归一化 + WS URL 拼装（sid2 只出现一次） |
| `frontend/src/utils/wsConnectThrottle.js` | 新增 | 前端建连闸门（每浏览器独立 IP，limit 28） |
| `frontend/src/utils/xyzwLegionWarWebSocket.js` | 改 | 战场 WS 客户端：命令表、心跳按家族切换、生命周期状态机 |
| `frontend/src/stores/legionWarStore.js` | 改 | 盐场/蟠桃双分支连接、`currentBattleId` |
| `frontend/src/views/LegionWar.vue` | 改 | 替换硬编码 URL（原 URL 里 `sid2` 重复了两次） |

### 7.2 自我审计：本轮代码自己引入的风险（7 项，全部已修）

| # | 风险 | 表现 | 修复 | 验证 |
|---|---|---|---|---|
| 1 | **串行化雪崩** | `waiters` Map 让 N 个并发调用排成队列，第 N 个要等 N×maxWaitMs | 删除跨调用串行化，只保留 `waitMs()` 窗口不变量 | 并发测试无队列堆积 |
| 2 | **fail-closed 会让任务失败** | 原 `connect()` 在闸门拒绝时 `throw 闸门未放行` | `acquire()` **恒返回 true**，超时 fail-open + 警告 | 后端闸门 7/7 PASS |
| 3 | **`disposed` 竞态** | `init()` 里的 `await` 期间发生 `disconnect()`，返回后继续建连 | 加 `closedByUser` 标志，每个 `await` 后重新检查 | 前端客户端 18/18 PASS |
| 4 | **主动关闭被复活** | 对已 `disconnect()` 的实例调 `send()` 会触发 `reconnect()` | `reconnect()` 在 `closedByUser \|\| disposed` 时直接 return | 生命周期用例 PASS |
| 5 | **记账时机错误** | 原在 `ws.on('open')` 才记账，失败握手不计入 | 改为**建连前**记账（与服务端计数口径一致） | 代码核对 |
| 6 | **`maxWaitMs: 0` 被 `\|\|` 吞掉** | `Number(0) \|\| 30000` → 30000，零等待失效 | 显式判 `undefined`/`null` | 实测 0ms（原 30002ms） |
| 7 | **`maxAccountsPerProxy` 默认值** | 默认 1 → 25 代理 vs 40 账号 → 反复走「无可用代理」分支刷日志 | 默认改 0（不限制），需要时再开 | 分配用例 PASS |

**共同设计原则：闸门只延迟、不阻断。** 任何异常路径都走 fail-open 并打警告，
最坏结果是「建连速率略高于 limit」，而 limit(24) 已是官方自杀阈值(30) 的 80%。

### 7.3 直连路径的实证数据（服务器 193.112.151.193）

| 指标 | 数值 | 解读 |
|---|---|---|
| 流量构成 | `direct` 361 : `proxy` 167 | **直连已是主路径**，与用户判断一致 |
| 180 秒实时采样 | 新增建连 **0** 次（同期日志 +2759 行） | 连接复用极好，稳态下几乎不新建连 |
| 全量 direct 建连 | 11006 次 / 636 分钟 ≈ **17 次/分钟** | 均值低于阈值 24，但**是突发型分布** |
| pm2 进程 | `xyzw-backend` id=6，单实例 fork 模式 | 单进程 → 进程内闸门**有效** |

### 7.4 直连路径的**真实残留风险**（需用户知晓，非代码 bug）

1. **结构性：直连账号共用服务器公网 IP 的配额。**
   25 个代理 vs 40 个白名单账号 → 至少 15 个账号走直连，共用同一出口 IP。
   该 IP 的 60s 配额 = 24 次。若这些账号被调度器同时触发 → 会排队，
   排队超 30s 则 fail-open 放行 → 瞬时可能超过 24。**这是既有限制，不是本轮引入**，
   本轮把它从「无保护」变成「有排队保护」。
2. **新引入的耦合：一个坏账号会拖慢同出口的其他账号。**
   `record()` 在建连**前**记账，若某账号 token 失效并反复重试，会快速填满 `direct` 桶，
   导致同出口正常账号的 `acquire()` 需要等待。缓解：单次等待上限 30s + fail-open，
   **不会永久阻塞**，但会让定时任务出现延迟。
   → **⚠️ 本条的实证复核与修正见 §8（结论已变：闸门阈值 24 校准错误，需改设计）。**
3. **熔断的副作用：收到 `IPisBan` 后打满该出口配额。**
   这是故意设计的熔断。若出现误判（非限频原因返回 -10008），会人为压制整个出口。
   因 fail-open 存在，30s 后仍会放行，不是硬熔断，可接受。
4. **闸门是进程内的。** 当前 pm2 单实例有效；若将来改 cluster 多实例，
   每个进程独立计数 → 闸门失效。**上多实例前必须先改成共享计数（Redis 等）。**
5. **`GameClient` 没有显式 connect 超时。** 依赖 `ws` 库默认值。
   闸门最坏多等 30s，需确保各调用点的上游超时 > 30s。已核对 5 个调用点
   全部 `await client.connect()` 且在 `try/catch` 内，30s 延迟被现有异常处理吸收。

### 7.5 兼容性核对

`GameClient.connect()` 由同步返回 Promise 改为 `async`：
- 全部调用点已核对：`batchScheduler/index.js:219,916`、`scheduler/index.js:1667,2834`、
  `routes/accounts.js:1264` —— **5/5 均为 `await client.connect()`**，无破坏。
- 3 处 `new GameClient(...)` 构造点全部显式传 `options.wsUrl`，
  短路 `buildWsUrl()` → 对它们**无行为变更**，只新增闸门 + `lastBanCode`。

### 7.6 部署状态

**全部改动未提交、未部署。** 本地 `git status`：8 改 + 12 新增（含脚本/文档/APK 解包产物）。

部署步骤（待确认后执行）：
1. 前端 `vite build`（已验证通过，`LegionWar` chunk 内 `xxz-xyzw-new` 出现 0 次）
2. `frontend/dist` **全量同步**（不要做增量清理，10-03 因此白屏过一次）
3. `scripts/_verify_dist.cjs` 完整性校验（期望缺失 = 0）
4. 后端改代码 → `pm2 restart xyzw-backend`
5. 改 env → `pm2 startOrReload ecosystem.config.cjs --only xyzw-backend`

---

## §8 直连负载实证复核：闸门阈值校准错误（推翻 §7.4-2 的处置建议）

> 触发：用户问「§7.4 第 2 项，你根据目前服务器的情况建不建议处理」。
> 方法：解析服务器 `xyzw-backend-out-6.log`（覆盖 2026-10-10 07:12→18:12 CST，约 11 小时）
> 的 7786 个 `handshake` 块，按 `startedAt` 做分钟级直方图。

### 8.1 实测负载（决定性数据）

| 指标 | 数值 |
|---|---|
| 握手总数（11h） | 7786 |
| 其中直连 / 代理 | **6987 / 799（直连占 90%）** |
| 直连峰值 | **135 次/分钟** |
| 直连稳态均值（移除异常账号后，最近 3.2h） | **28.2 次/分钟** |
| 直连整点峰值（移除异常账号后） | **70 次/分钟** |
| 活跃分钟中 >24 次/分的比例 | **50.4%（移除异常账号后仍为 26/41 = 63%）** |
| 活跃分钟中 >30 次/分的比例 | 43.0% |

**负载形状：整点聚集。** 建连集中在每小时 `:00–:13`（例：`08:00→42, 08:01→56, 08:02→70,
08:03→60, 08:04→68`），随后回落。原因是 163 个账号 × 各约 38 条任务配置，
大量 `0 */N * * *` cron 全部在整点触发。

### 8.2 关键否证：线上从未被封

| 检查项 | 结果 |
|---|---|
| `-10008`(IPisBan) / `-10007` / `-10009` / `-10010` | **10-04 至 10-10 全部 error 日志中 0 次** |
| out 日志 `IPisBan|RoleIsBan|被封|封禁|踢下线` | **0 次** |
| `❌ 任务执行失败`（10-09 全天） | **0**（成功 7428） |
| error 日志实际内容 | 仅 10× TLS 断连、1088× `MaxListenersExceededWarning`（本地已修） |

→ **在峰值 135 次/分钟、147 个账号共用同一公网 IP 的条件下连续跑 7 天，零封禁。**
说明官方服务端对 WS 建连的真实阈值**远高于 30/分钟**，或该限制**并非作用于我们使用的 WS 端点**。

### 8.3 结论：`limit=24` 是错误校准，且会误伤

结合 8.1 + 8.2：

- `limit=24` 低于实测**稳态均值(28)**，更低于是**整点峰值(70)** → 闸门**每个整点都会饱和**。
- 由于 `acquire()` 是 fail-open(30s)，饱和后**30s 照样放行** →
  闸门退化为「给整点任务波注入 0–30s 延迟」，**既不降低建连速率，也没有实证的封禁防护收益**。
- 即 §7.4-2 描述的耦合**确实会发生**，但根因不是「坏账号」，
  而是 **163 个账号的整点 cron 撞车**。

### 8.4 修正后的处置建议（按性价比排序）

1. **给调度器加 jitter（治本）**：把整点 `0 */N * * *` 任务随机打散到 ±X 分钟，
   峰值可由 70/min 摊平到接近稳态 30/min。同时对官方侧也更像正常用户行为。
2. **增加 per-account 桶（§7.4-2 的正解）**：出口桶管总量、账号桶管个体。
   账号桶 limit 取小值（如 6/分钟），使单个风暴账号在自己的桶里排队，
   **不再吃掉整个出口桶**——这才是「一个坏账号拖慢所有人」的正确解法。
3. **出口桶 limit 24 → 90**（或先关闭）：只作为**病态熔断器**（拦截未来可能出现的
   1 秒重连 10 次级风暴），不再充当限速器。
4. **`maxWaitMs` 30s → 10s**：limit 放宽后正常几乎不触发；真触发时也不该让任务等 30s。

### 8.5 附带发现：异常账号已被移除

`云海-2-712760060`（user_id=36）在日志前半段是 `accountId=535`：
11 小时内建连 **1658 次（占全部 21%）**，峰值 68 次/分钟，100% 直连。
该账号已于 **2026-10-10 07:00:34 UTC（15:00 CST）被删除并重建为 `id=609`**，
新实例 3 小时仅 14 次建连、峰值 2 次/分钟，**已恢复正常**。
→ 但这**不是**直连高负载的主因（移除后负载仍为 28/min），主因见 8.1 的整点聚集。

### 8.6 待用户确认

用户最初描述「官方搞了 IP 限频导致项目跑不动」，但 7 天日志中**找不到任何封禁证据**。
需要确认当时观察到的**实际症状**（HTTP 状态码 / 错误码 / 具体表现），
否则整轮限频防护可能瞄准了错误的目标。

---

## §9 部署记录（2026-10-10 18:20–18:35）

### 9.1 根因更正（推翻 §8 的「错峰没接」判断）

复核后发现 **错峰一直在生效**：

- 执行层错峰 = `getAccountBatchDelayMs`（`backend/src/scheduler/index.js:795`），
  对 `${source}:${accountId}:${YYYY-MM-DD HH:MM}` 做确定性哈希取模，
  经 `schedulePendingAccountTaskBatch` 的 timer 延迟入队（**不阻塞 cron 回调**）。
- **窗口值的真实来源是 `ecosystem.config.cjs` 的 `SCHEDULER_STAGGER_WINDOW_MS`**，
  线上是 **300000（5 分钟）**，不是 `config/index.js` 的默认 600000。
  反推依据：本地复算哈希，window=600000 时延迟均匀铺满 0–600s；
  window=300000 时上限 299629 —— 与线上实测最大 299917 吻合。
- 所以「线上错峰日志 0 次」只是因为 `waitForScheduledTaskStagger` 仅被
  `batchScheduler` 调用、不打日志，**不代表 cron 路径没错峰**。

### 9.2 真正的两个问题

1. **任务 cron 高度集中**：全库 5535 个启用任务，最大簇 `1 12 * * *` **576 个**，
   其次 `1 0 * * *` 290、`4 12 * * *` 266、`0 8 * * *` 251；
   **TOWER 158 个里有 138 个是 `0 4 * * *`**。5 分钟窗口把 138 个摊成 ~28 次/分，
   仍会在 04:00 触发服务端「操作过快」。
2. **`SENSITIVE_TASK_TYPES` 漏了 TOWER**：
   `const SENSITIVE_TASK_TYPES = new Set(['HANGUP_ADD_TIME','LEGACY_CLAIM'])`
   → `allowTooFastRetry=false` → 「操作过快」**从不退避重试**
   （线上「敏感任务触发操作过快，退避后重试」日志 **0 次**，而失败 **41 次**）。

### 9.3 本次改动

| 文件 | 改动 |
|---|---|
| `ecosystem.config.cjs` | `SCHEDULER_STAGGER_WINDOW_MS` 300000 → **900000** |
| `backend/src/config/index.js` | `connectThrottle.limit` 24 → **90**；`maxWaitMs` 30000 → **10000**；`sensitiveTaskRetry` 2次/3s/8s → **3次/5s/30s** |
| `backend/src/scheduler/index.js` | `SENSITIVE_TASK_TYPES` += **TOWER / WEIRD_TOWER** |
| `backend/src/batchScheduler/index.js` | 同上 |
| `scripts/_ssh_upload.py` | 修两个静默写错缺陷（见 9.6） |

**错峰摊平效果（按真实 accountId 复算）**

| 簇 | 旧 5 分钟 | 新 15 分钟 |
|---|---|---|
| 04:00 TOWER（138） | 峰值 32 次/分 | **15 次/分** |
| 12:01（576） | 峰值 125 次/分 | **49 次/分** |
| 00:01（290） | 峰值 67 次/分 | **29 次/分** |

### 9.4 提交与部署

| 位置 | 提交 | 说明 |
|---|---|---|
| GitHub `codex/integrate-release` | `70d8ea85a` → `d41273363` | 21 文件（`4f8c6545a..d41273363`） |
| 服务器 `deploy/production` | `b978cfbc0` | 16 文件，本地登记不 push |
| 服务器备份 | `backups/predeploy-20261010-182650/` | 部署前 8 个文件 |

**验收结果（部署后）**

| 项 | 结果 |
|---|---|
| pm2 | `status=online`，restarts=262，mem 337MB |
| `SCHEDULER_STAGGER_WINDOW_MS` | **900000**（运行进程 env 确认） |
| 本地健康 5 连测 | 200 / 200 / 200 / 200 / 200 |
| 公网首页 | 200 |
| 关键产物（index / vendor-vue / vendor-icons） | 均 200 |
| `_verify_dist.cjs` 完整性 | 引用 118，可达 100，**缺失 0** |
| 错峰延迟实测 | 最大 **893879ms ≈ 14.9 分钟**（原上限 5 分钟） |
| 闸门回归测试 | **10/10 PASS** |

### 9.5 ⚠️ 部署过程中的事故与恢复

部署后端 9 文件 + 前端 dist 后重启，进程立刻崩溃：

```
ERR_MODULE_NOT_FOUND: Cannot find module
'/home/ubuntu/zy/frontend/src/utils/battleFieldUrl.js'
imported from '/home/ubuntu/zy/backend/src/utils/gameClient.js'
```

HTTP 连续 000（中断约 2 分钟）。**根因：后端直接 import 前端源码**：

- `backend/src/utils/gameClient.js:2` → `frontend/src/utils/bonProtocol.js`
- `backend/src/utils/gameClient.js:15` → `frontend/src/utils/battleFieldUrl.js`
- `backend/src/routes/accounts.js:16`、`backend/src/utils/accountTokenRefresh.js:2` → 同上

只同步 `frontend/dist/` **不够**，必须把后端引用的前端源码一并上传到
`/home/ubuntu/zy/frontend/src/utils/`。补传该文件后 `pm2 restart` 即恢复。

→ **已写入 `MEMORY.md` 的部署检查清单。**

### 9.6 `scripts/_ssh_upload.py` 的两个静默缺陷（已修）

1. **staging 重名覆盖**：原用 `basename` 做暂存名，而 manifest 里
   `backend/src/scheduler/index.js` 与 `backend/src/batchScheduler/index.js`
   basename 都是 `index.js` → 互相覆盖 → **把同一份内容写到两个目标**（静默写错代码）。
   → 改为 `md5(remote)[:12] + '_' + basename`。
2. **新增文件静默不写**：原 `cp -f {remote} {remote}.bak-invite && cat ...`，
   目标不存在时 `cp` 失败、`&&` 短路 → **文件没写但仍打印 DONE**。
   → 改为 `mkdir -p 目标目录 && ([ -f remote ] && cp || true) && cat ...` 并检查 rc。

### 9.7 后续建议

- 观察下一个 **04:00**（明日）与 **12:01**（今日）的实际效果：
  看 `❌ 任务执行失败: * - TOWER: 爬塔执行失败: 操作过快` 是否归零。
- 若仍不足：**根治方向是按账号错开 cron 分钟**（如 `{hash%60} 4 * * *`），
  而不是继续拉长错峰窗口（窗口越长任务实际执行时刻越晚）。
