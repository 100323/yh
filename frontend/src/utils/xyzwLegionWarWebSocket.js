/**
 * XYZW WebSocket 客户端
 * 基于 readable-xyzw-ws.js 重构，适配本项目架构
 */
 import { bonProtocol, g_utils } from './bonProtocol.js'
 import { wsLogger, gameLogger } from './logger.js'
 import { getWsConnectThrottle } from './wsConnectThrottle.js'
 
 /** 为日志生成安全的 body 预览，避免控制台再次解析原始对象 */
 const formatBodyForLog = (body) => {
   if (!body) return ''
 
   if (body instanceof Uint8Array) {
     return `[BON:${body.length}b]`
   }
 
   if (Array.isArray(body)) {
     return `[Array:${body.length}]`
   }
 
   if (typeof body === 'object') {
     const isNumericObject = Object.keys(body).every((key) => !Number.isNaN(parseInt(key)))
     if (isNumericObject) {
       return `[BON:Object:${Object.keys(body).length}]`
     }
     try {
       return JSON.stringify(body)
     } catch {
       return '[Object]'
     }
   }
 
   return String(body)
 }
 
 /**
  * 命令注册器：保存每个 cmd 的默认体，发送时与 params 合并
  */
 export class CommandRegistry {
   constructor(encoder, enc,hint) {
     this.encoder = encoder
     this.enc = enc
     this.hint = hint
     this.commands = new Map()
   }
 
   /** 注册命令 */
   register(cmd, defaultBody = {}) {
     this.commands.set(cmd, (ack = 0, seq = 0, params = {}) => ({
       cmd,
       ack,
       seq,
       hint:this.hint,
       time: Date.now(),
       body: this.encoder?.bon?.encode
         ? this.encoder.bon.encode({ ...defaultBody, ...params })
         : { ...defaultBody, ...params },
     }))
     return this
   }
 
  /**
   * 系统心跳。
   *
   * 官方实现里两个战场族的 ping 命令与入参字段是**不同**的：
   *   盐场（LegionWarNetworkData）     ：WarService.ping({ battlefieldId })
   *                                     → cmd = war_ping，      body = { battlefieldId }
   *   蟠桃（LegionPayloadNetworkData） ：PayloadService.ping({ bfId })
   *                                     → cmd = payload_ping，  body = { bfId }
   *
   * 两者都由 TimerManager 按 battlefield.rTimeoutTime 秒周期触发。
   * 早期实现写死了 war_ping + battlefieldId，蟠桃战场会一直拿不到心跳响应。
   *
   * @param {{ cmd?: string, bodyKey?: string }} [options]
   */
  registerHeartbeat(options = {}) {
    const cmd = options.cmd || "war_ping"
    const bodyKey = options.bodyKey || "battlefieldId"
    this.commands.set("heart_beat", (ack, seq) => ({
      cmd,
      ack,
      seq,
      hint: this.hint,
      time: Date.now(),
      body: { [bodyKey]: this.hint },
    }))
    return this
  }

  /** 运行时切换心跳族（战场类型确定后再调用，见 setBattlefieldKind） */
  setHeartbeat(cmd, bodyKey) {
    return this.registerHeartbeat({ cmd, bodyKey })
  }
 
   /** 生成最终可发送的二进制 */
   encodePacket(raw) {
     if (this.encoder?.encode && this.enc) {
       // 使用加密编码
       return this.encoder.encode(raw, this.enc)
     } else {
       // 降级到JSON字符串
       return JSON.stringify(raw)
     }
   }
 
   /** 构造报文 */
   build(cmd, ack, seq, params) {
     const fn = this.commands.get(cmd)
     if (!fn) throw new Error(`Unknown cmd: ${cmd}`)
     return fn(ack, seq, params)
   }
 }
 
/**
 * 盐场命令族（war_*）
 *
 * 从 0.32.0 客户端字符串表 assets/assets/TEST_REMOTE_MODULE/index.f8a54.js 提取，
 * 对应 LegionWarNetworkData（cmd.startsWith("war_") 才会路由到战场专用 WS）。
 */
export const WAR_COMMANDS = [
  // —— 进入 / 离开战场 ——
  "war_enterbattlefield",
  "war_leavebattlefield",
  "war_guestenterbattlefield",
  "war_enterwatchwar",
  // —— 战场快照 / 队伍信息 ——
  "war_getbattlefieldinfo",
  "war_getteaminfo",
  "war_getteamimginfo",
  "war_getwatchid",
  // —— 布阵 / 开战 / 行军 ——
  "war_setbattleteam",
  "war_teamsetbattleteam",
  "war_adjustteampos",
  "war_startbattle",
  "war_startmarch",
  "war_startattackbuilding",
  "war_endattackbuilding",
  // —— 复活 / 加速 / 自杀 ——
  "war_resurrect",
  "war_speedup",
  "war_suicide",
  // —— 队伍管理（组队玩法）——
  "war_invitejointeam",
  "war_kickoutteam",
  "war_leaveteam",
  "war_refusejointeam",
  // —— 心跳 ——
  "war_ping",
];

/**
 * 蟠桃 / 物资战命令族（payload_*）
 *
 * 对应 LegionPayloadNetworkData（_prefix 默认 "payload_"）。
 * 注意：`payload_ping` 是心跳，不是普通请求。
 */
export const PAYLOAD_COMMANDS = [
  // —— 进入战场 ——
  "payload_enterbf",
  // —— 队伍信息 ——
  "payload_getteaminfo",
  "payload_getteamimginfo",
  // —— 布阵 / 开战 ——
  "payload_setbattleteam",
  "payload_startbattle",
  // —— 行军 / 车辆 ——
  "payload_startmarch",
  "payload_cancelmarch",
  "payload_startchangecarpath",
  // —— 拾取 / 道具 / 技能 / 标记 ——
  "payload_startpickitem",
  "payload_useitem",
  "payload_useskill",
  "payload_updateflag",
  // —— 心跳 ——
  "payload_ping",
];

/** 主服（非战场专用连接）上的战场查询命令 */
export const BATTLE_QUERY_COMMANDS = [
  // 盐场
  "legion_getbattlefield",
  "legion_getbattlefieldid",
  "legion_signup",
  // 蟠桃
  "legion_getpayloadbf",
  "legion_getpayloadtask",
  "legion_getpayloadrecord",
  "legion_getpayloadkillrecord",
  "legion_getpayloadcarrecord",
  "legion_getpayloaddetails",
  "legion_getpayloadlegioninfo",
  "legion_payloadsignup",
  "legion_buypayloaditem",
  "legion_claimpayloadtask",
  "legion_claimpayloadtaskprogress",
];

/**
 * 战场类型 → 心跳配置
 * 盐场：war_ping / battlefieldId
 * 蟠桃：payload_ping / bfId
 */
export const BATTLE_HEARTBEAT = Object.freeze({
  war: { cmd: "war_ping", bodyKey: "battlefieldId" },
  payload: { cmd: "payload_ping", bodyKey: "bfId" },
});

/**
 * 预注册游戏命令
 *
 * @param {CommandRegistry} reg
 * @param {{ kind?: 'war'|'payload' }} [options] 战场类型，决定心跳族；默认 'war'
 */
export function registerDefaultCommands(reg, options = {}) {
  const kind = options.kind === "payload" ? "payload" : "war";
  const heartbeat = BATTLE_HEARTBEAT[kind];

  // 心跳按战场族注册
  const registry = reg.registerHeartbeat(heartbeat);

  // 两个族的命令都注册：同一客户端实例可能被复用于盐场/蟠桃，
  // 不注册的命令在 build() 时会直接抛 "Unknown cmd"，这正是之前
  // 「布阵 / 开战 / 行军」全线缺失的根因。
  for (const cmd of WAR_COMMANDS) registry.register(cmd);
  for (const cmd of PAYLOAD_COMMANDS) registry.register(cmd);
  for (const cmd of BATTLE_QUERY_COMMANDS) registry.register(cmd);

  return registry;
}

/**
 * 战场命令的响应后缀映射。
 *
 * 服务端对大多数 war_ / payload_ 命令回 "<cmd>resp"，但有一批是
 * notify / gzipresp / 独立命名。send() 时把 respKey 设成对应值
 * 才能匹配到响应（否则会一直等到超时）。
 */
export const BATTLE_RESP_SUFFIX = {
  // ===== 盐场 war_* =====
  war_enterbattlefield: "war_enterbattlefieldresp",
  war_enterbattlefieldgzipresp: "war_enterbattlefield",
  war_leavebattlefield: "war_leavebattlefieldresp",
  war_guestenterbattlefield: "war_guestenterbattlefieldresp",
  war_enterwatchwar: "war_enterwatchwarresp",
  war_getbattlefieldinfo: "war_getbattlefieldinforesp",
  war_getteaminfo: "war_getteaminforesp",
  war_getteamimginfo: "war_getteamimginforesp",
  war_getwatchid: "war_getwatchidresp",
  war_setbattleteam: "war_setbattleteamresp",
  war_teamsetbattleteam: "war_teamsetbattleteamresp",
  war_adjustteampos: "war_adjustteamposresp",
  war_startbattle: "war_startbattleresp",
  war_startmarch: "war_startmarchresp",
  war_startattackbuilding: "war_startattackbuildingresp",
  war_resurrect: "war_resurrectnotify",
  war_speedup: "war_speedupresp",
  war_suicide: "war_suicideresp",
  war_invitejointeam: "war_invitejointeamresp",
  war_kickoutteam: "war_kickoutteamresp",
  war_leaveteam: "war_leaveteamresp",
  war_refusejointeam: "war_refusejointeamresp",
  war_ping: "war_pingresp",

  // ===== 蟠桃 payload_* =====
  payload_enterbf: "payload_enterbfresp",
  payload_getteaminfo: "payload_getteaminforesp",
  payload_getteamimginfo: "payload_getteamimginforesp",
  payload_setbattleteam: "payload_setbattleteamresp",
  payload_startbattle: "payload_startbattleresp",
  payload_startmarch: "payload_startmarchresp",
  payload_cancelmarch: "payload_cancelmarchresp",
  payload_startchangecarpath: "payload_startchangecarpathresp",
  payload_startpickitem: "payload_startpickitemresp",
  payload_useitem: "payload_useitemresp",
  payload_useskill: "payload_useskillnotify",
  payload_updateflag: "payload_updateflagresp",
  payload_ping: "payload_pingresp",

  // ===== 主服查询 =====
  legion_getbattlefield: "legion_getbattlefieldresp",
  legion_getbattlefieldid: "legion_getbattlefieldidresp",
  legion_getpayloadbf: "legion_getpayloadbfresp",
  legion_getpayloadtask: "legion_getpayloadtaskresp",
  legion_getpayloadrecord: "legion_getpayloadrecordresp",
  legion_getpayloadkillrecord: "legion_getpayloadkillrecordresp",
};

/** 取某战场命令对应的响应 cmd（默认回退为 "<cmd>resp"） */
export function battleRespKey(cmd) {
  return BATTLE_RESP_SUFFIX[cmd] || `${cmd}resp`;
}
 
 /**
  * XYZW WebSocket 盐场客户端
  */
 export class XyzwLegionWarWebSocketClient {
   /**
    * @param {object} options
    * @param {string} options.url    战场专用服地址（由 buildBattleFieldWsUrl 生成）
    * @param {object} [options.utils]
    * @param {string|number} [options.hint]  战场 id（盐场 battlefieldId / 蟠桃 bfId）
    * @param {number} [options.heartbeatMs]
    * @param {'war'|'payload'} [options.kind] 战场类型，决定心跳命令与入参字段
    * @param {boolean} [options.throttle] 是否走全局连接频率闸门，默认 true
    * @param {string} [options.throttleKey] 闸门分桶 key，默认按战场类型
    */
   constructor({ url, utils, hint, heartbeatMs = 5000, kind = 'war', throttle = true, throttleKey } = {}) {
     this.url = url
     this.utils = utils || g_utils
     this.enc = this.utils?.getEnc ? this.utils.getEnc("auto") : undefined

     this.socket = null
     this.ack = 0
     this.seq = 0
     this.hint = hint
     this.kind = kind === 'payload' ? 'payload' : 'war'
     this.throttleEnabled = throttle !== false
     this.throttleKey = throttleKey || `battle:${this.kind}`
     this.sendQueue = []
     this.sendQueueTimer = null
     this.heartbeatTimer = null
     this.heartbeatInterval = heartbeatMs

     this.dialogStatus = false
     this.messageListener = null
     this.showMsg = false
     this.connected = false
     this.isReconnecting = false // 重连状态标志
     this.reconnectAttempts = 0
     /** 实例已被销毁：init() 直接返回，不再建连 */
     this.disposed = false
     /**
      * 是否由调用方**显式**关闭（disconnect）。
      * 显式关闭后禁止自动重连——否则 send() 触发的 reconnect() 会把
      * 已经关掉的连接悄悄复活（旧实现没有这个区分）。
      */
     this.closedByUser = false

     this.promises = Object.create(null)
     this.registry = registerDefaultCommands(
       new CommandRegistry(this.utils, this.enc, this.hint),
       { kind: this.kind }
     )

     // WebSocket客户端初始化

     // 状态回调
     this.onConnect = null
     this.onDisconnect = null
     this.onError = null
   }

   /** 切换战场类型（同步切换心跳命令与入参字段） */
   setBattlefieldKind(kind, hint) {
     this.kind = kind === 'payload' ? 'payload' : 'war'
     this.throttleKey = `battle:${this.kind}`
     if (hint !== undefined) {
       this.hint = hint
       this.registry.hint = hint
     }
     const hb = BATTLE_HEARTBEAT[this.kind]
     this.registry.setHeartbeat(hb.cmd, hb.bodyKey)
     return this
   }

   /** 当前心跳配置 */
   get heartbeatConfig() {
     return BATTLE_HEARTBEAT[this.kind] || BATTLE_HEARTBEAT.war
   }

   /** 初始化连接 */
   async init() {
     if (this.disposed || this.closedByUser) return

     // 连接频率闸门：官方在 60s 内建 30 条 WS 就会主动断网退出，
     // 服务端另有 IPisBan(-10008) 封禁。这里在**建连前**先排队。
     if (this.throttleEnabled) {
       try {
         const gate = getWsConnectThrottle()
         const allowed = await gate.acquire(this.throttleKey)

         // ⚠️ 关键：await 期间实例可能已被 disconnect()，必须重新检查，
         // 否则会在"已销毁"的实例上建出一条没人管的连接。
         if (this.disposed || this.closedByUser) return

         if (!allowed) {
           const snap = gate.snapshot(this.throttleKey)
           const msg = `连接过于频繁（${snap.used}/${snap.limit} 次 / ${Math.round(snap.windowMs / 1000)}s），已暂停建连以规避风控`
           wsLogger.error(msg)
           if (this.onError) this.onError(new Error(msg))
           return
         }
       } catch (error) {
         wsLogger.warn('连接频率闸门不可用，跳过限流:', error?.message || error)
       }
     }

     // 同样再确认一次（闸门异常分支也要走这里）
     if (this.disposed || this.closedByUser) return

     // 建连前记账：计「尝试」而非「成功」，与官方 _onWSConnected 语义对齐且更保守
     if (this.throttleEnabled) {
       try {
         getWsConnectThrottle().record(this.throttleKey)
       } catch {
         /* ignore */
       }
     }

     wsLogger.info(`连接: ${this.url.split('?')[0]}`)

     this.socket = new WebSocket(this.url)

     this.socket.onopen = () => {
       wsLogger.info('连接成功')
       this.connected = true
       this.reconnectAttempts = 0

       // 启动心跳机制
       this._setupHeartbeat()
       // 启动消息队列处理
       this._processQueueLoop()
       if (this.onConnect) this.onConnect()
     }
 
     this.socket.onmessage = (evt) => {
       try {
         let packet
         if (typeof evt.data === "string") {
           packet = JSON.parse(evt.data)
         } else if (evt.data instanceof ArrayBuffer) {
           // 二进制数据需要自动检测并解码
           packet = this.utils?.parse ? this.utils.parse(evt.data, "auto",true) : evt.data
 
           // 移除特定命令的控制台直出日志，统一用 wsLogger/gameLogger 控制
         } else if (evt.data instanceof Blob) {
           // 处理Blob数据
           // 收到Blob数据
           evt.data.arrayBuffer().then(buffer => {
             try {
               packet = this.utils?.parse ? this.utils.parse(buffer, "auto",true) : buffer
               // Blob解析完成
 
               // 处理消息体解码（ProtoMsg会自动解码）
               if (packet instanceof Object && packet.rawData !== undefined) {
                 gameLogger.verbose('ProtoMsg Blob消息，使用rawData:', packet.rawData)
               } else if (packet.body && this.shouldDecodeBody(packet.body)) {
                 try {
                   if (this.utils && this.utils.bon && this.utils.bon.decode) {
                     // 转换body数据为Uint8Array
                     const bodyBytes = this.convertToUint8Array(packet.body)
                     if (bodyBytes) {
                       const decodedBody = this.utils.bon.decode(bodyBytes)
                       gameLogger.debug('BON Blob解码成功:', packet.cmd, decodedBody)
                       // 不修改packet.body，而是创建一个新的属性存储解码后的数据
                       packet.decodedBody = decodedBody
                     }
                   } else {
                     gameLogger.warn('BON解码器不可用 (Blob)')
                   }
                 } catch (error) {
                   gameLogger.error('BON Blob消息体解码失败:', error.message, packet.cmd)
                 }
               }
               // 更新 ack 为服务端最新的 seq（若存在）
               const actualPacket = packet._raw || packet
               const incomingSeq = (typeof actualPacket?.seq === 'number') ? actualPacket.seq :
                 (typeof packet?.seq === 'number') ? packet.seq : undefined
               if (typeof incomingSeq === 'number' && incomingSeq >= 0) {
                 this.ack = incomingSeq
               }
 
               if (this.showMsg) {
                 // 收到Blob消息
               }
 
               // 回调处理
               if (this.messageListener) {
                 this.messageListener(packet)
               }
 
               // Promise 响应处理
               this._handlePromiseResponse(packet)
 
             } catch (error) {
               gameLogger.error('Blob解析失败:', error.message)
             }
           })
           return // 异步处理，直接返回
         } else {
           gameLogger.warn('未知数据类型:', typeof evt.data, evt.data)
           packet = evt.data
         }
 
         if (this.showMsg) {
           gameLogger.verbose('收到消息:', packet)
         }
 
         // 处理消息体解码（ProtoMsg会自动解码）
         if (packet instanceof Object && packet.rawData !== undefined) {
           gameLogger.verbose('ProtoMsg消息，使用rawData:', packet.rawData)
         } else {
           // 处理可能存在_raw包装的情况
           const actualPacket = packet._raw || packet
 
           // 更新 ack 为服务端最新的 seq（若存在）
           const incomingSeq = (typeof actualPacket.seq === 'number') ? actualPacket.seq :
             (typeof packet.seq === 'number') ? packet.seq : undefined
           if (typeof incomingSeq === 'number' && incomingSeq >= 0) {
             this.ack = incomingSeq
           }
 
           if (actualPacket.body && this.shouldDecodeBody(actualPacket.body)) {
             try {
               if (this.utils && this.utils.bon && this.utils.bon.decode) {
                 // 转换body数据为Uint8Array
                 const bodyBytes = this.convertToUint8Array(actualPacket.body)
                 if (bodyBytes) {
                   const decodedBody = this.utils.bon.decode(bodyBytes)
                   gameLogger.debug('BON解码成功:', actualPacket.cmd || packet.cmd, decodedBody)
                   // 将解码后的数据存储到原始packet中
                   packet.decodedBody = decodedBody
                   // 如果有_raw结构，也存储到_raw中
                   if (packet._raw) {
                     packet._raw.decodedBody = decodedBody
                   }
                 }
               } else {
                 gameLogger.warn('BON解码器不可用')
               }
             } catch (error) {
               gameLogger.error('BON消息体解码失败:', error.message, actualPacket.cmd || packet.cmd)
             }
           }
         }
 
         // 回调处理
         if (this.messageListener) {
           this.messageListener(packet)
         }
 
         // Promise 响应处理
         this._handlePromiseResponse(packet)
 
       } catch (error) {
         gameLogger.error('消息处理失败:', error.message)
       }
     }
 
     this.socket.onclose = (evt) => {
       wsLogger.info(`WebSocket 连接关闭: ${evt.code} ${evt.reason || ''}`)
       wsLogger.debug('关闭详情:', {
         code: evt.code,
         reason: evt.reason || '未提供原因',
         wasClean: evt.wasClean,
         timestamp: new Date().toISOString()
       })
       this.connected = false
       this._clearTimers()
       if (this.onDisconnect) this.onDisconnect(evt)
     }
 
     this.socket.onerror = (error) => {
       wsLogger.error('WebSocket 错误:', error)
       this.connected = false
       this._clearTimers()
       if (this.onError) this.onError(error)
     }
   }
 
   /** 注册消息回调 */
   setMessageListener(fn) {
     this.messageListener = fn
   }
 
   /** 控制台消息开关 */
   setShowMsg(val) {
     this.showMsg = !!val
   }
 
   /** 判断是否需要解码body */
   shouldDecodeBody(body) {
     if (!body) return false
 
     // Uint8Array或Array格式
     if (body instanceof Uint8Array || Array.isArray(body)) {
       return true
     }
 
     // 对象格式的数字数组（从图片中看到的格式）
     if (typeof body === 'object' && body.constructor === Object) {
       // 检查是否是数字键的对象（例如 {"0": 8, "1": 2, ...}）
       const keys = Object.keys(body)
       return keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))
     }
 
     return false
   }
 
   /** 转换body为Uint8Array */
   convertToUint8Array(body) {
     if (!body) return null
 
     if (body instanceof Uint8Array) {
       return body
     }
 
     if (Array.isArray(body)) {
       return new Uint8Array(body)
     }
 
     // 对象格式的数字数组转换为Uint8Array
     if (typeof body === 'object' && body.constructor === Object) {
       const keys = Object.keys(body).map(k => parseInt(k)).sort((a, b) => a - b)
       if (keys.length > 0) {
         const maxIndex = Math.max(...keys)
         const arr = new Array(maxIndex + 1).fill(0)
         for (const [key, value] of Object.entries(body)) {
           const index = parseInt(key)
           if (!isNaN(index) && typeof value === 'number') {
             arr[index] = value
           }
         }
         gameLogger.debug('转换对象格式body为Uint8Array:', arr.length, 'bytes')
         return new Uint8Array(arr)
       }
     }
 
     return null
   }
 
   /** 尝试为日志解码BON体，成功返回对象 */
   decodeBodyForLog(body) {
     if (!body) return null
     const decoder = this.utils?.bon?.decode
     if (typeof decoder !== 'function') return null
 
     let bytes = null
     if (body instanceof Uint8Array) {
       bytes = body
     } else if (Array.isArray(body)) {
       bytes = new Uint8Array(body)
     } else if (this.shouldDecodeBody(body)) {
       bytes = this.convertToUint8Array(body)
     }
 
     if (!bytes) return null
 
     try {
       return decoder(bytes)
     } catch (error) {
       gameLogger.warn('日志解析BON失败:', error.message)
       return null
     }
   }
 
   /** 重连（防重复连接版本，退避策略对齐官方 _tryReLogin） */
   reconnect() {
     // 调用方显式关闭过 → 不再自动复活
     if (this.closedByUser || this.disposed) {
       wsLogger.debug('实例已显式关闭，跳过自动重连')
       return
     }

     // 防止重复重连
     if (this.isReconnecting) {
       wsLogger.debug('重连已在进行中，跳过此次重连请求')
       return
     }

     this.isReconnecting = true
     this.reconnectAttempts += 1
     // 官方：前 10 次 1s，之后退到 60s
     const delay = this.reconnectAttempts > 10 ? 60000 : 1000
     wsLogger.info(`开始WebSocket重连... 第 ${this.reconnectAttempts} 次，延迟 ${delay}ms`)

     // 先断开现有连接（这里用 _teardownSocket，不置 closedByUser）
     this._teardownSocket()

     // 延迟重连，避免过于频繁
     setTimeout(() => {
       try {
         if (this.closedByUser || this.disposed) return
         this.init()
       } finally {
         // 无论成功或失败都重置重连状态
         setTimeout(() => {
           this.isReconnecting = false
         }, 2000) // 2秒后允许下次重连
       }
     }, delay)
   }

   /** 关闭底层 socket 与定时器，但不改变「实例是否已销毁」的语义 */
   _teardownSocket() {
     if (this.socket) {
       try {
         this.socket.close()
       } catch {
         /* ignore */
       }
       this.socket = null
     }
     this.connected = false
     this._clearTimers()
   }

   /**
    * 断开连接（**终态**）。
    *
    * 置 closedByUser/disposed 后，send() 触发的 reconnect() 与任何 init()
    * 都不会再把这个实例复活。需要重新连接请新建实例。
    */
   disconnect() {
     this.closedByUser = true
     this.disposed = true
     this.sendQueue.length = 0
     this.messageListener = null
     this._teardownSocket()
   }
 
   /** 发送消息 */
   send(cmd, params = {}, options = {}) {
     if (!this.connected) {
       wsLogger.warn(`WebSocket 未连接，消息已入队: ${cmd}`)
       // 防止频繁重连
       if (!this.dialogStatus && !this.isReconnecting) {
         this.dialogStatus = true
         wsLogger.info('自动触发重连...')
         this.reconnect()
         setTimeout(() => { this.dialogStatus = false }, 2000)
       }
     }
 
     // 移除特定命令的控制台直出日志，统一用 wsLogger 控制
 
     // 统一在入队时分配 seq，避免与 Promise 版本竞争导致重复
     const assignedSeq = (options.seq !== undefined)
       ? options.seq
       : (cmd === 'heart_beat' ? 0 : ++this.seq)
    const task = {
      cmd,
      params,
      seq: assignedSeq,
      hint: this.hint,
      respKey: options.respKey || battleRespKey(cmd),
      sleep: options.sleep || 0,
      onSent: options.onSent
    }
    this.sendQueue.push(task)
    return task
  }

  /* ==================== 战场业务快捷方法 ==================== */

  /**
   * 把「抽象动作」映射成当前战场族的具体命令。
   * 盐场走 war_*，蟠桃走 payload_*，调用方不必关心前缀。
   */
  battleCommand(action) {
    const map = {
      war: {
        enter: "war_enterbattlefield",
        leave: "war_leavebattlefield",
        snapshot: "war_getbattlefieldinfo",
        setTeam: "war_setbattleteam",
        startBattle: "war_startbattle",
        march: "war_startmarch",
        attackBuilding: "war_startattackbuilding",
        resurrect: "war_resurrect",
        speedup: "war_speedup",
        ping: "war_ping",
      },
      payload: {
        enter: "payload_enterbf",
        leave: "payload_leavebf",
        snapshot: "payload_enterbf",
        setTeam: "payload_setbattleteam",
        startBattle: "payload_startbattle",
        march: "payload_startmarch",
        attackBuilding: "payload_startbattle",
        resurrect: "payload_useitem",
        speedup: "payload_startchangecarpath",
        ping: "payload_ping",
      },
    }
    return (map[this.kind] || map.war)[action] || null
  }

  /** 战场 id 字段名：盐场 battlefieldId / 蟠桃 bfId */
  get idField() {
    return this.kind === "payload" ? "bfId" : "battlefieldId"
  }

  /**
   * 进入战场。
   * 盐场：war_enterbattlefield { battlefieldId, useGzip }
   * 蟠桃：payload_enterbf       { bfId }
   */
  enterBattlefield(extra = {}) {
    if (this.kind === "payload") {
      return this.send("payload_enterbf", { bfId: this.hint, ...extra });
    }
    return this.send("war_enterbattlefield", {
      battlefieldId: this.hint,
      useGzip: true,
      ...extra,
    });
  }

  /**
   * 布阵。
   * 盐场：war_setbattleteam     { battlefieldId, battleTeam, lordWeaponId }
   * 蟠桃：payload_setbattleteam { bfId,          battleTeam, lordWeaponId }
   */
  setBattleTeam(battleTeam = {}, lordWeaponId = 0, extra = {}) {
    const cmd = this.battleCommand("setTeam");
    return this.send(cmd, {
      [this.idField]: this.hint,
      battleTeam,
      lordWeaponId,
      ...extra,
    });
  }

  /**
   * 开战。
   * 盐场：war_startbattle     { battlefieldId, targetId }
   * 蟠桃：payload_startbattle { bfId,          targetId }
   */
  startBattle(targetId = 0, extra = {}) {
    const cmd = this.battleCommand("startBattle");
    return this.send(cmd, {
      [this.idField]: this.hint,
      targetId,
      ...extra,
    });
  }

  /**
   * 行军。
   * 盐场：war_startmarch     { battlefieldId, carId, path }
   * 蟠桃：payload_startmarch { bfId,          carId, path }
   */
  startMarch(carId = 0, path = [], extra = {}) {
    const cmd = this.battleCommand("march");
    return this.send(cmd, {
      [this.idField]: this.hint,
      carId,
      path,
      ...extra,
    });
  }

   /** Promise 版发送 */
   sendWithPromise(cmd, params = {}, timeoutMs = 5000) {
     return new Promise((resolve, reject) => {
       if (!this.connected && !this.socket) {
         return reject(new Error("WebSocket 连接已关闭"))
       }
       // 为此请求生成唯一的seq值
       const requestSeq = ++this.seq
 
       // 设置 Promise 状态，使用seq作为键
       this.promises[requestSeq] = { resolve, reject, originalCmd: cmd }
 
       // 超时处理
       const timer = setTimeout(() => {
         delete this.promises[requestSeq]
         reject(new Error(`请求超时: ${cmd} (${timeoutMs}ms)`))
       }, timeoutMs)
 
       // 发送消息，直接传递seq
       this.send(cmd, params, {
         seq: requestSeq,
         onSent: () => {
           // 消息发送成功后，不要清除超时器，让它继续等待响应
           // 只有在收到响应或超时时才清除
         }
       })
     })
   }
 
  /** 发送心跳 */
  sendHeartbeat() {
    const hb = this.heartbeatConfig
    wsLogger.verbose(`发送心跳消息 (${hb.cmd})`)
    this.send("heart_beat", {}, { respKey: hb.cmd })
  }

   /** =============== 内部方法 =============== */
 
   /** 设置心跳 */
   _setupHeartbeat() {
     // 延迟3秒后开始发送第一个心跳，避免连接刚建立就发送
     setTimeout(() => {
       if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
         wsLogger.debug('开始发送首次心跳')
         this.sendHeartbeat()
       }
     }, 3000)
 
     // 设置定期心跳
     this.heartbeatTimer = setInterval(() => {
       if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
         this.sendHeartbeat()
       } else {
         wsLogger.warn('心跳检查失败: 连接状态异常')
       }
     }, this.heartbeatInterval)
   }
 
   /** 队列处理循环 */
   _processQueueLoop() {
     if (this.sendQueueTimer) clearInterval(this.sendQueueTimer)
 
     this.sendQueueTimer = setInterval(async () => {
       if (!this.sendQueue.length) return
       if (!this.connected || this.socket?.readyState !== WebSocket.OPEN) return
 
       const task = this.sendQueue.shift()
       if (!task) return
        
       try {
         // 直接使用任务指定的 seq（已在入队时分配）
         const raw = this.registry.build(task.cmd, this.ack, task.seq, task.params)
         // 发送前日志（仅标准五段，心跳不打印）
         if (raw && raw.cmd !== 'war_ping' && raw.cmd !== 'payload_ping') {
           const decodedBody = this.decodeBodyForLog(raw.body)
           wsLogger.info('📤 发送报文', {
             cmd: raw.cmd,
             hint: raw.hint ?? 0,
             ack: raw.ack ?? 0,
             seq: raw.seq ?? 0,
             time: raw.time,
             body: decodedBody ?? formatBodyForLog(raw.body)
           })
         }
 
         // 编码并发送
         const bin = this.registry.encodePacket(raw)
         this.socket?.send(bin)
         if (this.showMsg || task.cmd === "heart_beat") {
           wsLogger.wsMessage('local', task.cmd, false)
           if (this.showMsg) {
             wsLogger.verbose('原始数据:', raw)
             wsLogger.verbose('编码后数据:', bin)
             wsLogger.verbose('编码类型:', typeof bin, bin instanceof Uint8Array ? 'Uint8Array (加密)' : 'String (明文)')
             if (bin instanceof Uint8Array && bin.length > 0) {
               wsLogger.verbose(`加密验证: 前8字节 [${Array.from(bin.slice(0, 8)).join(', ')}]`)
             }
           }
         }
 
         // 触发发送回调
         if (task.onSent) {
           try {
             const meta = {
               respKey: task.respKey,
               cmd: task.cmd,
               seq: raw?.seq ?? task.seq,
               ack: raw?.ack ?? this.ack,
               time: raw?.time ?? Date.now()
             }
             task.onSent(meta)
           } catch (error) {
             wsLogger.warn('发送回调执行失败:', error)
           }
         }
 
         // 可选延时
         if (task.sleep) await sleep(task.sleep)
 
       } catch (error) {
         wsLogger.error(`发送消息失败: ${task.cmd}`, error)
       }
     }, 50)
   }
 
   /** 处理 Promise 响应 */
   _handlePromiseResponse(packet) {
     // 优先使用resp字段进行响应匹配（新的正确方式）
     if (packet.resp !== undefined && this.promises[packet.resp]) {
       const promiseData = this.promises[packet.resp]
       delete this.promises[packet.resp]
 
       // 获取响应数据，优先使用 rawData（ProtoMsg 自动解码），然后 decodedBody（手动解码），最后 body
       const responseBody = packet.rawData !== undefined ? packet.rawData :
         packet.decodedBody !== undefined ? packet.decodedBody :
           packet.body
 
       if (packet.code === 0 || packet.code === undefined) {
         promiseData.resolve(responseBody || packet)
       } else {
         promiseData.reject(new Error(`服务器错误: ${packet.code} - ${packet.hint || '未知错误'}`))
       }
       return
     }
 
     // 兼容旧的基于cmd名称的匹配方式（保留为向后兼容）
     const cmd = packet.cmd
     if (!cmd) return
     const respCmdKey = typeof cmd === 'string' ? cmd.toLowerCase() : cmd
 
     // 命令到响应的映射 - 处理响应命令与原始命令不匹配的情况
     const responseToCommandMap = {
       // 1:1 响应映射（优先级高）
       'fight_startpvpresp': 'fight_startpvp',
       'activity_getresp': 'activity_get',
       'collection_goodslistresp': 'collection_goodslist',
       'collection_claimfreerewardresp': 'collection_claimfreereward',
       'legion_getarearankresp': 'legion_getarearank',
       'legionwar_getdetailsresp': 'legionwar_getdetails',
       'legionwar_getgoldmonthwarrankresp': 'legionwar_getgoldmonthwarrank',
       'nightmare_getroleinforesp': 'nightmare_getroleinfo',
       'studyresp': 'study_startgame',
       'role_getroleinforesp': 'role_getroleinfo',
       'hero_recruitresp': 'hero_recruit',
       'friend_batchresp': 'friend_batch',
       'system_claimhanguprewardresp': 'system_claimhangupreward',
       'item_openboxresp': ['item_openbox', 'item_batchclaimboxpointreward'],
       'bottlehelper_claimresp': 'bottlehelper_claim',
       'bottlehelper_startresp': 'bottlehelper_start',
       'bottlehelper_stopresp': 'bottlehelper_stop',
       'legion_signinresp': 'legion_signin',
       'fight_startbossresp': 'fight_startboss',
       'fight_startlegionbossresp': 'fight_startlegionboss',
       'fight_startareaarenaresp': 'fight_startareaarena',
       'arena_startarearesp': 'arena_startarea',
       'arena_getareatargetresp': 'arena_getareatarget',
       'arena_getarearankresp': 'arena_getarearank',
       'presetteam_saveteamresp': 'presetteam_saveteam',
       'presetteam_getinforesp': 'presetteam_getinfo',
       'mail_claimallattachmentresp': 'mail_claimallattachment',
       'store_buyresp': 'store_purchase',
       'system_getdatabundleverresp': 'system_getdatabundlever',
       'tower_claimrewardresp': 'tower_claimreward',
       'fight_starttowerresp': 'fight_starttower',
       'evotowerinforesp': 'evotower_getinfo',
       'evotower_fightresp': 'evotower_fight',
     'item_openpackresp': 'item_openpack',
       // 咸王宝库
       'matchteam_getroleteaminforesp': 'matchteam_getroleteaminfo',
       'bosstower_getinforesp': 'bosstower_getinfo',
       'bosstower_startbossreso': 'bosstower_startboss',
       'bosstower_startboxresp': 'bosstower_startbox',
       'discount_getdiscountinforesp': 'discount_getdiscountinfo',
       // 升星相关响应映射
       'hero_heroupgradestarresp': 'hero_heroupgradestar',
       'book_upgraderesp': 'book_upgrade',
       'book_claimpointrewardresp': 'book_claimpointreward',
       // 军团信息
       'legion_getinforesp': 'legion_getinfo',
       'legion_getinforresp': 'legion_getinfo',
       // 车辆相关响应映射
       'car_getrolecarresp': 'car_getrolecar',
       'car_refreshresp': 'car_refresh',
       'car_claimresp': 'car_claim',
       'car_sendresp': 'car_send',
       'car_getmemberhelpingcntresp': 'car_getmemberhelpingcnt',
       'role_gettargetteamresp': 'role_gettargetteam',
       'activity_warorderclaimresp': 'activity_recyclewarorderrewardclaim',
       'arena_getarearankresp': 'arena_getarearank',
       'bosstower_gethelprankresp': 'bosstower_gethelprank',
       // 特殊响应映射 - 有些命令有独立响应，有些用同步响应
       'task_claimdailyrewardresp': 'task_claimdailyreward',
       'task_claimweekrewardresp': 'task_claimweekreward',
 
       // 同步响应映射（优先级低）
       'syncresp': ['system_mysharecallback', 'task_claimdailypoint'],
       'syncrewardresp': ['system_buygold', 'discount_claimreward', 'card_claimreward',
         'artifact_lottery', 'genie_sweep', 'genie_buysweep', 'system_signinreward', 'dungeon_selecthero']
     }
 
     // 获取原始命令名（支持一对一和一对多映射）
     // 使用小写进行映射匹配，兼容服务端大小写差异
     let originalCmds = responseToCommandMap[respCmdKey]
     if (!originalCmds) {
       originalCmds = [respCmdKey] // 如果没有映射，使用响应命令本身（小写）
     } else if (typeof originalCmds === 'string') {
       originalCmds = [originalCmds] // 转换为数组
     }
 
     // 查找对应的 Promise - 遍历所有等待中的 Promise（向后兼容）
     for (const [requestId, promiseData] of Object.entries(this.promises)) {
       // 检查 Promise 是否匹配当前响应的任一原始命令
       if (originalCmds.includes(promiseData.originalCmd)) {
         delete this.promises[requestId]
 
         // 获取响应数据，优先使用 rawData（ProtoMsg 自动解码），然后 decodedBody（手动解码），最后 body
         const responseBody = packet.rawData !== undefined ? packet.rawData :
           packet.decodedBody !== undefined ? packet.decodedBody :
             packet.body
 
         if (packet.code === 0 || packet.code === undefined) {
           promiseData.resolve(responseBody || packet)
         } else {
           promiseData.reject(new Error(`服务器错误: ${packet.code} - ${packet.hint || '未知错误'}`))
         }
         break
       }
     }
   }
 
   /** 清理定时器 */
   _clearTimers() {
     if (this.heartbeatTimer) {
       clearInterval(this.heartbeatTimer)
       this.heartbeatTimer = null
     }
     if (this.sendQueueTimer) {
       clearInterval(this.sendQueueTimer)
       this.sendQueueTimer = null
     }
   }
 }
 
 /** 默认导出 */
 export default XyzwLegionWarWebSocketClient
 