/**
 * 批量日常任务常量配置
 */

export const FISH_TARGET = 320;
export const ARENA_TARGET = 240;

// 宝箱类型选项
export const boxTypeOptions = [
  { label: "木质宝箱", value: 2001 },
  { label: "青铜宝箱", value: 2002 },
  { label: "黄金宝箱", value: 2003 },
  { label: "铂金宝箱", value: 2004 },
];

// 鱼竿类型选项
export const fishTypeOptions = [
  { label: "普通鱼竿", value: 1 },
  { label: "黄金鱼竿", value: 2 },
];

// 阵容选项
export const formationOptions = [1, 2, 3, 4, 5, 6].map((v) => ({
  label: `阵容${v}`,
  value: v,
}));

// BOSS次数选项
export const bossTimesOptions = [0, 1, 2, 3, 4].map((v) => ({
  label: `${v}次`,
  value: v,
}));

// 任务分组定义
export const taskGroupDefinitions = [
  { name: "daily", label: "日常", icon: "📅" },
  { name: "dungeon", label: "副本", icon: "🏰" },
  { name: "resource", label: "资源", icon: "💰" },
];

// 任务详细配置定义
export const taskConfigDefinitions = {
  startBatch: {
    label: "日常任务",
    group: "daily",
    description: "执行完整的日常任务流程",
    defaultEnabled: true,
    configFields: [],
  },
  claimHangUpRewards: {
    label: "领取挂机",
    group: "daily",
    description: "领取挂机奖励",
    defaultEnabled: true,
    configFields: [
      { key: "hangupClaimCount", label: "领取次数", type: "number", min: 1, max: 20, default: 5 },
    ],
  },
  batchAddHangUpTime: {
    label: "一键加钟",
    group: "daily",
    description: "一键添加挂机时间",
    defaultEnabled: true,
    configFields: [],
  },
  resetBottles: {
    label: "重置罐子",
    group: "daily",
    description: "重置盐罐",
    defaultEnabled: true,
    configFields: [],
  },
  batchlingguanzi: {
    label: "一键领取罐子",
    group: "daily",
    description: "一键领取所有盐罐",
    defaultEnabled: true,
    configFields: [],
  },
  batchclubsign: {
    label: "俱乐部签到",
    group: "daily",
    description: "一键俱乐部签到",
    defaultEnabled: true,
    configFields: [],
  },
  batchFriendGold: {
    label: "送好友金币",
    group: "daily",
    description: "一键赠送好友金币",
    defaultEnabled: true,
    configFields: [
      { key: "friendGoldCount", label: "赠送次数", type: "number", min: 1, max: 20, default: 3 },
    ],
  },
  batchMailClaim: {
    label: "领取邮件",
    group: "daily",
    description: "领取全部邮件附件",
    defaultEnabled: true,
    configFields: [],
  },
  batchStudy: {
    label: "答题",
    group: "daily",
    description: "一键答题",
    defaultEnabled: true,
    configFields: [],
  },
  batcharenafight: {
    label: "竞技场战斗",
    group: "daily",
    description: "一键竞技场战斗3次",
    defaultEnabled: true,
    configFields: [
      { key: "arenaFormation", label: "竞技场阵容", type: "select", options: "formationOptions", default: 1 },
      { key: "arenaBattleCount", label: "战斗次数", type: "number", min: 1, max: 10, default: 3 },
    ],
  },
  batchSmartSendCar: {
    label: "智能发车",
    group: "daily",
    description: "根据车辆奖励自动判断是否发车\n\n场景1：金砖阈值=5000\n 8000金砖→✅发车\n 3000金砖→❌刷新\n\n场景2：金砖=5000,招募令=5\n 不勾选\"需满足所有\":\n 3000金砖+10招募令→✅\n 8000金砖+2招募令→✅\n 3000金砖+2招募令→❌\n\n场景3：金砖=5000,招募令=5\n 勾选\"需满足所有\":\n 8000金砖+10招募令→✅\n 8000金砖+2招募令→❌\n 3000金砖+10招募令→❌",
    defaultEnabled: true,
    configFields: [
      { key: "smartDepartureGoldThreshold", label: "金砖阈值", type: "number", min: 0, default: 0, description: "0表示不限制" },
      { key: "smartDepartureRecruitThreshold", label: "招募令阈值", type: "number", min: 0, default: 0 },
      { key: "smartDepartureJadeThreshold", label: "白玉阈值", type: "number", min: 0, default: 0 },
      { key: "smartDepartureTicketThreshold", label: "门票阈值", type: "number", min: 0, default: 0 },
      { key: "smartDepartureMatchAll", label: "需满足所有条件", type: "switch", default: false },
    ],
  },
  batchClaimCars: {
    label: "一键收车",
    group: "daily",
    description: "一键收取所有车辆",
    defaultEnabled: true,
    configFields: [],
  },
  store_purchase: {
    label: "黑市采购",
    group: "daily",
    description: "一键黑市采购",
    defaultEnabled: true,
    configFields: [
      { key: "blackMarketPurchase", label: "启用黑市采购", type: "switch", default: true },
    ],
  },
  collection_claimfreereward: {
    label: "免费领取珍宝阁",
    group: "daily",
    description: "免费领取珍宝阁奖励",
    defaultEnabled: true,
    configFields: [],
  },
  batchLegacyClaim: {
    label: "残卷收取",
    group: "daily",
    description: "批量领取功法残卷",
    defaultEnabled: true,
    configFields: [
      { key: "legacyClaimInterval", label: "收取间隔(分钟)", type: "number", min: 1, max: 1440, default: 360, description: "每次收取的时间间隔" },
    ],
  },

  climbTower: {
    label: "爬塔",
    group: "dungeon",
    description: "一键爬塔",
    defaultEnabled: true,
    configFields: [
      { key: "towerFormation", label: "爬塔阵容", type: "select", options: "formationOptions", default: 1 },
      { key: "towerMaxFloors", label: "最大层数", type: "number", min: 1, max: 100, default: 10 },
    ],
  },
  climbWeirdTower: {
    label: "爬怪异塔",
    group: "dungeon",
    description: "一键爬怪异塔",
    defaultEnabled: true,
    configFields: [
      { key: "weirdTowerFormation", label: "怪异塔阵容", type: "select", options: "formationOptions", default: 1 },
      { key: "weirdTowerMaxFloors", label: "最大层数", type: "number", min: 1, max: 100, default: 10 },
    ],
  },
  batchLegionBoss: {
    label: "军团BOSS",
    group: "dungeon",
    description: "一键挑战军团BOSS",
    defaultEnabled: true,
    configFields: [
      { key: "bossFormation", label: "BOSS阵容", type: "select", options: "formationOptions", default: 1 },
      { key: "bossTimes", label: "挑战次数", type: "select", options: "bossTimesOptions", default: 2 },
    ],
  },
  batchDailyBoss: {
    label: "每日咸王",
    group: "dungeon",
    description: "挑战每日咸王考验BOSS",
    defaultEnabled: true,
    configFields: [],
  },
  batchWelfareClaim: {
    label: "福利奖励领取",
    group: "daily",
    description: "领取福利签到、每日礼包、免费礼包、永久卡礼包等福利奖励",
    defaultEnabled: true,
    configFields: [],
  },
  batchDailyTaskClaim: {
    label: "每日任务奖励",
    group: "daily",
    description: "领取每日任务奖励、日常任务宝箱、周常任务宝箱",
    defaultEnabled: true,
    configFields: [],
  },

  batchmengjing: {
    label: "梦境",
    group: "dungeon",
    description: "一键梦境",
    defaultEnabled: true,
    configFields: [],
  },
  skinChallenge: {
    label: "换皮闯关",
    group: "dungeon",
    description: "一键换皮闯关",
    defaultEnabled: true,
    configFields: [],
  },

  batchBuyDreamItems: {
    label: "购买梦境商品",
    group: "dungeon",
    description: "一键购买梦境商品",
    defaultEnabled: true,
    configFields: [
      { key: "dreamPurchaseList", label: "购买清单", type: "input", default: "1-3,1-5,2-6,2-7,3-1,3-2,3-7", description: "格式: 商人ID-商品索引,多个用逗号分隔。如: 1-5,1-6,2-6,3-5" },
    ],
  },
  batchClaimFreeEnergy: {
    label: "怪异塔免费道具",
    group: "dungeon",
    description: "一键领取怪异塔免费道具",
    defaultEnabled: true,
    configFields: [],
  },
  batchUseItems: {
    label: "使用怪异塔道具",
    group: "dungeon",
    description: "一键使用怪异塔道具",
    defaultEnabled: true,
    configFields: [],
  },
  batchMergeItems: {
    label: "怪异塔合成",
    group: "dungeon",
    description: "一键怪异塔合成",
    defaultEnabled: true,
    configFields: [],
  },

  legion_storebuygoods: {
    label: "购买四圣碎片",
    group: "resource",
    description: "一键购买四圣碎片",
    defaultEnabled: true,
    configFields: [],
  },
  batchBuyGold: {
    label: "点金",
    group: "resource",
    description: "一键点金",
    defaultEnabled: true,
    configFields: [
      { key: "buyGoldTimes", label: "点金次数", type: "number", min: 1, max: 50, default: 3 },
    ],
  },
  batchRecruit: {
    label: "招募",
    group: "resource",
    description: "一键武将招募",
    defaultEnabled: true,
    configFields: [
      { key: "useFreeRecruit", label: "免费招募", type: "switch", default: true },
      { key: "usePaidRecruit", label: "付费招募", type: "switch", default: true },
      { key: "freeRecruitCount", label: "免费次数", type: "number", min: 1, max: 10, default: 1 },
      { key: "paidRecruitCount", label: "付费次数", type: "number", min: 0, max: 100, default: 1, description: "输入0等于关闭付费招募" },
    ],
  },
  batchFish: {
    label: "钓鱼",
    group: "resource",
    description: "批量钓鱼",
    defaultEnabled: true,
    configFields: [
      { key: "fishType", label: "鱼竿类型", type: "select", options: "fishTypeOptions", default: 1 },
      { key: "fishCount", label: "钓鱼次数", type: "number", min: 1, max: 500, default: 3 },
    ],
  },
  batchOpenBox: {
    label: "开宝箱",
    group: "resource",
    description: "批量开宝箱",
    defaultEnabled: true,
    configFields: [
      { key: "boxType", label: "宝箱类型", type: "select", options: "boxTypeOptions", default: 2001 },
      { key: "boxCount", label: "开箱次数", type: "number", min: 1, max: 500, default: 10 },
    ],
  },
  batchGenieSweep: {
    label: "灯神扫荡",
    group: "resource",
    description: "一键扫荡灯神",
    defaultEnabled: true,
    configFields: [],
  },
};

// 可用的定时任务列表（向后兼容）
export const availableTasks = Object.entries(taskConfigDefinitions).map(([value, config]) => ({
  label: config.label,
  value,
  group: config.group,
  description: config.description,
  defaultEnabled: config.defaultEnabled,
  configFields: config.configFields,
}));

const createDefaultRunTime = (hour, minute = 0) => new Date(2000, 0, 1, hour, minute, 0, 0).getTime();

const defaultTaskScheduleOverrides = {
  claimHangUpRewards: { scheduleType: "interval", intervalHours: 8 },
  batchAddHangUpTime: { scheduleType: "interval", intervalHours: 3 },
  resetBottles: { scheduleType: "interval", intervalHours: 7 },
  batchlingguanzi: { runTime: createDefaultRunTime(12, 1) },
  batchclubsign: { runTime: createDefaultRunTime(12, 1) },
  batchFriendGold: { runTime: createDefaultRunTime(12, 1) },
  batchMailClaim: { runTime: createDefaultRunTime(8, 0) },
  batchStudy: { runTime: createDefaultRunTime(12, 1) },
  batcharenafight: { runTime: createDefaultRunTime(12, 1) },
  batchSmartSendCar: { runTime: createDefaultRunTime(12, 1) },
  batchClaimCars: { runTime: createDefaultRunTime(18, 1) },
  store_purchase: { runTime: createDefaultRunTime(12, 1) },
  collection_claimfreereward: { runTime: createDefaultRunTime(0, 1) },
  batchLegacyClaim: { scheduleType: "interval", intervalHours: 6 },
  climbTower: { runTime: createDefaultRunTime(12, 1) },
  climbWeirdTower: { runTime: createDefaultRunTime(12, 1) },
  batchClaimFreeEnergy: { runTime: createDefaultRunTime(12, 1) },
  batchUseItems: { runTime: createDefaultRunTime(12, 1) },
  batchMergeItems: { runTime: createDefaultRunTime(12, 1) },
  legion_storebuygoods: { runTime: createDefaultRunTime(12, 1) },
  batchLegionBoss: { runTime: createDefaultRunTime(0, 1) },
  batchDailyBoss: { runTime: createDefaultRunTime(12, 1) },
  batchWelfareClaim: { runTime: createDefaultRunTime(12, 1) },
  batchDailyTaskClaim: { runTime: createDefaultRunTime(12, 1) },
  batchmengjing: { runTime: createDefaultRunTime(12, 1) },
  skinChallenge: { runTime: createDefaultRunTime(12, 1) },
  batchBuyDreamItems: { runTime: createDefaultRunTime(12, 1) },
  batchBuyGold: { runTime: createDefaultRunTime(12, 1) },
  batchRecruit: { runTime: createDefaultRunTime(12, 1) },
  batchFish: { runTime: createDefaultRunTime(12, 1) },
  batchOpenBox: { runTime: createDefaultRunTime(12, 1) },
  batchGenieSweep: { runTime: createDefaultRunTime(0, 1) },
};

const defaultTaskConfigOverrides = {
  batchLegionBoss: {
    bossFormation: 2,
    bossTimes: 4,
  },
};

// 默认任务配置
export const defaultTaskConfigs = {};
Object.entries(taskConfigDefinitions).forEach(([key, config]) => {
  defaultTaskConfigs[key] = {
    enabled: config.defaultEnabled,
    config: {},
    scheduleType: "daily",
    runTime: null,
    intervalHours: 4,
  };
  config.configFields.forEach((field) => {
    defaultTaskConfigs[key].config[field.key] = field.default;
  });
  if (defaultTaskConfigOverrides[key]) {
    defaultTaskConfigs[key].config = {
      ...defaultTaskConfigs[key].config,
      ...defaultTaskConfigOverrides[key],
    };
  }
  if (defaultTaskScheduleOverrides[key]) {
    defaultTaskConfigs[key] = {
      ...defaultTaskConfigs[key],
      ...defaultTaskScheduleOverrides[key],
    };
  }
});

// 车辆研究消耗表
export const CarresearchItem = [
  20, 21, 22, 23, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 47, 50, 53, 56,
  59, 62, 65, 68, 71, 74, 78, 82, 86, 90, 94, 99, 104, 109, 114, 119, 126, 133,
  140, 147, 154, 163, 172, 181, 190, 199, 210, 221, 232, 243, 369, 393, 422,
  457, 498, 548, 607, 678, 763, 865, 1011,
];

// 任务表列配置
export const taskColumns = [
  { title: "任务名称", key: "name", width: 150 },
  { title: "运行类型", key: "runType", width: 100 },
  {
    title: "运行时间",
    key: "runTime",
    width: 150,
    render: (row) => {
      return row.runType === "daily" ? row.runTime : row.cronExpression;
    },
  },
  {
    title: "选中账号",
    key: "selectedTokens",
    width: 150,
    render: (row) => `${row.selectedTokens.length} 个`,
  },
  {
    title: "选中任务",
    key: "selectedTasks",
    width: 150,
    render: (row) => `${row.selectedTasks.length} 个`,
  },
  {
    title: "状态",
    key: "enabled",
    width: 80,
    render: (row) => (row.enabled ? "启用" : "禁用"),
  },
  { title: "操作", key: "actions", width: 150 },
];

// 默认设置
export const defaultSettings = {
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
};

// 默认批量设置
export const defaultBatchSettings = {
  boxCount: 100,
  fishCount: 100,
  recruitCount: 100,
  defaultBoxType: 2001,
  defaultFishType: 1,
  receiverId: "",
  password: "",
  useGoldRefreshFallback: false,
  tokenListColumns: 2,
  commandDelay: 500,
  taskDelay: 500,
  maxActive: 2,
  carMinColor: 4,
  connectionTimeout: 10000,
  reconnectDelay: 1000,
  maxLogEntries: 1000,
  // 智能发车阈值设置
  smartDepartureGoldThreshold: 0,
  smartDepartureRecruitThreshold: 0,
  smartDepartureJadeThreshold: 0,
  smartDepartureTicketThreshold: 0,
  smartDepartureMatchAll: false,
};

// 默认模板
export const defaultTemplate = {
  arenaFormation: 1,
  towerFormation: 1,
  bossFormation: 1,
  bossTimes: 2,
  claimBottle: true,
  payRecruit: true,
  openBox: true,
  arenaEnable: true,
  claimHangUp: true,
  claimEmail: true,
  blackMarketPurchase: true,
};

// 默认任务表单
export const defaultTaskForm = {
  name: "",
  runType: "daily",
  runTime: undefined,
  cronExpression: "",
  selectedTokens: [],
  selectedTasks: [],
  enabled: true,
};

// 默认助手设置
export const defaultHelperSettings = {
  boxType: 2001,
  fishType: 1,
  count: 100,
};
