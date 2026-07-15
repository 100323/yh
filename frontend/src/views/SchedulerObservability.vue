<template>
  <main
    class="observability-workspace"
    :aria-busy="initialLoading || refreshing"
    aria-labelledby="observability-title"
  >
    <header class="workspace-heading">
      <div>
        <p class="workspace-kicker">管理员只读 · 调度运行面</p>
        <h1 id="observability-title">调度观测</h1>
        <p class="workspace-description">查看命令吞吐、任务放大、出口质量与脱敏异常。</p>
      </div>
      <div class="freshness" role="status" aria-live="polite">
        <span class="freshness-mark" :class="{ 'is-refreshing': refreshing }" aria-hidden="true"></span>
        <span>{{ freshnessText }}</span>
        <span v-if="refreshing" class="refreshing-label">后台刷新中</span>
        <span v-else>30 秒自动刷新</span>
      </div>
    </header>

    <section class="filter-strip" aria-label="调度观测筛选">
      <div class="filter-field filter-field--range">
        <label for="observability-range">时间范围</label>
        <el-select id="observability-range" v-model="filters.range" aria-label="时间范围">
          <el-option
            v-for="option in OBSERVABILITY_RANGE_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>

      <div class="filter-field">
        <label for="observability-source">来源</label>
        <el-select
          id="observability-source"
          v-model="filters.source"
          aria-label="来源"
          clearable
          filterable
          allow-create
          default-first-option
          placeholder="全部来源"
        >
          <el-option v-for="source in sourceOptions" :key="source" :label="source" :value="source" />
        </el-select>
      </div>

      <div class="filter-field">
        <label for="observability-task">任务类型</label>
        <el-select
          id="observability-task"
          v-model="filters.taskType"
          aria-label="任务类型"
          clearable
          filterable
          allow-create
          default-first-option
          placeholder="全部任务"
        >
          <el-option v-for="taskType in taskTypeOptions" :key="taskType" :label="taskType" :value="taskType" />
        </el-select>
      </div>

      <div class="filter-field">
        <label for="observability-command">命令类别（仅汇总）</label>
        <el-select
          id="observability-command"
          v-model="filters.commandClass"
          aria-label="命令类别（仅汇总）"
          clearable
          placeholder="全部命令"
        >
          <el-option label="游戏命令" value="game" />
          <el-option label="系统命令" value="system" />
        </el-select>
      </div>

      <div class="filter-field">
        <label for="observability-egress">出口类型</label>
        <el-select
          id="observability-egress"
          v-model="filters.egressType"
          aria-label="出口类型"
          clearable
          placeholder="全部出口"
        >
          <el-option label="直连" value="direct" />
          <el-option label="匿名代理" value="proxy" />
        </el-select>
      </div>
    </section>

    <el-alert
      v-if="summaryError || anomaliesError"
      class="data-alert"
      type="warning"
      :closable="false"
      show-icon
      title="部分观测数据刷新失败"
      :description="errorDescription"
    />

    <section v-if="initialLoading" class="initial-loading" aria-label="正在加载调度观测数据">
      <el-skeleton :rows="8" animated />
    </section>

    <template v-else>
      <section class="overview-surface" aria-labelledby="overview-title">
        <div class="section-heading">
          <div>
            <p class="section-index">01</p>
            <h2 id="overview-title">关键指标与命令趋势</h2>
          </div>
          <p>速率按分钟聚合，延迟与排队值按当前筛选区间计算。</p>
        </div>

        <div class="kpi-grid" role="list" aria-label="六项关键指标">
          <div v-for="metric in model.headline" :key="metric.key" class="kpi-item" role="listitem">
            <span class="kpi-label">{{ metric.label }}</span>
            <span class="kpi-value">
              {{ model.hasSummaryData ? metric.display : '—' }}
              <small v-if="model.hasSummaryData && metric.unit">{{ metric.unit }}</small>
            </span>
          </div>
        </div>

        <figure class="trend-figure" aria-labelledby="trend-caption">
          <figcaption id="trend-caption">
            <span>命令吞吐趋势</span>
            <span>{{ model.trend.length ? `${model.trend.length} 个时间桶` : '暂无时间桶' }}</span>
          </figcaption>
          <div v-if="model.trend.length" class="trend-bars" role="img" aria-label="区间命令吞吐柱状趋势">
            <div
              v-for="bar in model.trend"
              :key="bar.key"
              class="trend-column"
              :title="`${formatTimestamp(bar.bucket)} · ${bar.value} 条命令`"
            >
              <span class="trend-value">{{ bar.value }}</span>
              <span class="trend-track">
                <span
                  class="trend-bar"
                  :class="{ 'is-zero': bar.height === 0 }"
                  :style="{ height: `${bar.height}%` }"
                ></span>
              </span>
            </div>
          </div>
          <el-empty v-else :image-size="64" description="当前筛选范围内暂无趋势数据" />
        </figure>
      </section>

      <section class="table-surface" aria-labelledby="tasks-title">
        <div class="section-heading">
          <div>
            <p class="section-index">02</p>
            <h2 id="tasks-title">任务表现</h2>
          </div>
          <p>运行量、命令放大与耗时异常集中对照。</p>
        </div>
        <div class="table-scroll" tabindex="0" aria-label="任务表现表，可横向滚动">
          <el-table :data="model.tasks" row-key="key" empty-text="当前筛选范围内暂无任务数据">
            <el-table-column prop="taskType" label="任务类型" min-width="180" fixed="left" />
            <el-table-column prop="runCount" label="运行" width="96" align="right" />
            <el-table-column prop="commandCount" label="命令" width="96" align="right" />
            <el-table-column prop="amplificationDisplay" label="放大倍数" width="112" align="right" />
            <el-table-column prop="averageDurationDisplay" label="平均耗时" width="116" align="right" />
            <el-table-column prop="maxDurationDisplay" label="最大耗时" width="116" align="right" />
            <el-table-column prop="errorRateDisplay" label="异常率" width="106" align="right">
              <template #default="scope">
                <span class="rate-value" :class="{ 'has-issue': scope.row.errorRate > 0 }">
                  {{ scope.row.errorRateDisplay }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section class="table-surface" aria-labelledby="egresses-title">
        <div class="section-heading">
          <div>
            <p class="section-index">03</p>
            <h2 id="egresses-title">出口质量</h2>
          </div>
          <p>出口仅显示直连或匿名标识，不展示代理地址。</p>
        </div>
        <div class="table-scroll" tabindex="0" aria-label="出口质量表，可横向滚动">
          <el-table :data="model.egresses" row-key="key" empty-text="当前筛选范围内暂无出口数据">
            <el-table-column prop="label" label="匿名出口" min-width="220" fixed="left" />
            <el-table-column prop="commandCount" label="命令量" width="110" align="right" />
            <el-table-column prop="errorCount" label="错误" width="96" align="right" />
            <el-table-column prop="timeoutCount" label="超时" width="96" align="right" />
            <el-table-column prop="rateLimitedCount" label="限频" width="96" align="right" />
            <el-table-column prop="errorRateDisplay" label="错误率" width="106" align="right">
              <template #default="scope">
                <span class="rate-value" :class="{ 'has-issue': scope.row.errorRate > 0 }">
                  {{ scope.row.errorRateDisplay }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </section>

      <section class="table-surface" aria-labelledby="anomalies-title">
        <div class="section-heading">
          <div>
            <p class="section-index">04</p>
            <h2 id="anomalies-title">异常明细</h2>
          </div>
          <p>异常明细不受命令类别筛选影响；共 {{ model.anomalies.total }} 条脱敏异常。</p>
        </div>
        <div class="table-scroll" tabindex="0" aria-label="异常明细表，可横向滚动">
          <el-table :data="model.anomalies.items" row-key="key" empty-text="当前筛选范围内暂无异常">
            <el-table-column label="时间" min-width="176" fixed="left">
              <template #default="scope">{{ formatTimestamp(scope.row.occurredAt) }}</template>
            </el-table-column>
            <el-table-column label="账号" width="96" align="right">
              <template #default="scope">{{ formatAccount(scope.row.accountId) }}</template>
            </el-table-column>
            <el-table-column prop="taskType" label="任务" min-width="160">
              <template #default="scope">{{ scope.row.taskType || '未归类' }}</template>
            </el-table-column>
            <el-table-column prop="command" label="命令" min-width="170">
              <template #default="scope">{{ scope.row.command || '—' }}</template>
            </el-table-column>
            <el-table-column label="类别" min-width="130">
              <template #default="scope">
                <span class="category-label" :class="`category-${scope.row.category}`">
                  {{ scope.row.categoryLabel }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="错误码" width="100" align="right">
              <template #default="scope">{{ scope.row.errorCode ?? '—' }}</template>
            </el-table-column>
            <el-table-column prop="latencyDisplay" label="延迟" width="108" align="right" />
          </el-table>
        </div>
        <nav v-if="model.anomalies.total > model.anomalies.pageSize" class="pagination-row" aria-label="异常分页">
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="model.anomalies.page"
            :page-size="model.anomalies.pageSize"
            :total="model.anomalies.total"
            @current-change="handleAnomalyPageChange"
          />
        </nav>
      </section>

      <section
        class="health-surface"
        :class="[`health-${model.health.state}`, `health-tone-${model.health.tone}`]"
        aria-labelledby="health-title"
      >
        <div class="section-heading health-heading">
          <div>
            <p class="section-index">05</p>
            <h2 id="health-title">观测链路健康</h2>
          </div>
          <div class="health-status" role="status">
            <span class="health-status-mark" aria-hidden="true"></span>
            {{ model.health.label }}
          </div>
        </div>

        <dl class="flush-facts">
          <div>
            <dt>服务状态</dt>
            <dd>{{ model.health.label }}</dd>
          </div>
          <div>
            <dt>最近写入</dt>
            <dd>{{ formatTimestamp(model.health.lastFlushAt) }}</dd>
          </div>
          <div>
            <dt>写入耗时</dt>
            <dd>{{ formatDuration(model.health.lastFlushDurationMs) }}</dd>
          </div>
        </dl>

        <dl class="health-counters">
          <div
            v-for="counter in model.health.counterRows"
            :key="counter.key"
            :class="{ 'has-issue': isHealthIssueCounter(counter.key, counter.value) }"
          >
            <dt>{{ counter.label }}</dt>
            <dd>{{ counter.value }}</dd>
          </div>
        </dl>
      </section>
    </template>
  </main>
</template>

<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import api from '@/api';
import {
  OBSERVABILITY_RANGE_OPTIONS,
  buildSchedulerObservabilityRequestParams,
  buildSchedulerObservabilityViewModel,
  formatMetricDuration,
} from '@/utils/schedulerObservabilityViewModel';

const POLL_INTERVAL_MS = 30_000;
const ANOMALY_PAGE_SIZE = 25;
const sourceOptions = ['scheduler', 'scheduler-manual', 'scheduler-catchup', 'batch', 'system'];
const healthIssueKeys = new Set([
  'flushErrors',
  'mergeErrors',
  'droppedRetrySnapshots',
  'observationErrors',
  'healthErrors',
  'droppedQueueWaits',
  'droppedMetrics',
  'droppedAnomalies',
]);
const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const filters = reactive({
  range: '24h',
  source: '',
  taskType: '',
  commandClass: '',
  egressType: '',
});
const anomalyPage = ref(1);
const summaryPayload = ref(null);
const anomaliesPayload = ref(null);
const initialLoading = ref(true);
const refreshing = ref(false);
const hasLoaded = ref(false);
const summaryError = ref(false);
const anomaliesError = ref(false);
let pollTimer = null;
let requestGeneration = 0;
let isMounted = false;

const model = computed(() => buildSchedulerObservabilityViewModel(
  summaryPayload.value || {},
  anomaliesPayload.value || {},
));

const taskTypeOptions = computed(() => {
  const options = new Set(['BATCH', 'DAILY_TASK', 'DAILY_TASK_CLAIM']);
  for (const task of model.value.tasks) {
    if (task.taskType && task.taskType !== '未归类') options.add(task.taskType);
  }
  return Array.from(options).sort((left, right) => left.localeCompare(right));
});

const freshnessText = computed(() => (
  model.value.generatedAt
    ? `数据生成于 ${formatTimestamp(model.value.generatedAt)}`
    : '尚无数据新鲜度信息'
));

const errorDescription = computed(() => {
  if (summaryError.value && anomaliesError.value) {
    return '汇总与异常数据均未更新；若已有成功结果，页面会继续保留。';
  }
  return summaryError.value
    ? '汇总数据未更新，异常明细仍可继续查看。'
    : '异常明细未更新，汇总与健康数据仍可继续查看。';
});

function successfulData(result) {
  return result.status === 'fulfilled'
    && result.value?.success === true
    && result.value.data !== null
    && typeof result.value.data === 'object';
}

async function refreshObservability({ background = false } = {}) {
  if (!isMounted) return;
  const requestId = ++requestGeneration;
  const firstRequest = !hasLoaded.value;
  if (firstRequest) initialLoading.value = true;
  else if (background || hasLoaded.value) refreshing.value = true;

  try {
    const requestParams = buildSchedulerObservabilityRequestParams(
      filters,
      anomalyPage.value,
      ANOMALY_PAGE_SIZE,
    );
    const [summaryResult, anomaliesResult] = await Promise.allSettled([
      api.stats.getSchedulerObservabilitySummary(requestParams.summary),
      api.stats.getSchedulerObservabilityAnomalies(requestParams.anomalies),
    ]);
    if (!isMounted || requestId !== requestGeneration) return;

    summaryError.value = !successfulData(summaryResult);
    anomaliesError.value = !successfulData(anomaliesResult);
    if (!summaryError.value) summaryPayload.value = summaryResult.value.data;
    if (!anomaliesError.value) anomaliesPayload.value = anomaliesResult.value.data;
  } finally {
    if (isMounted && requestId === requestGeneration) {
      initialLoading.value = false;
      refreshing.value = false;
      hasLoaded.value = true;
    }
  }
}

function handleAnomalyPageChange(page) {
  anomalyPage.value = page;
  void refreshObservability();
}

function formatTimestamp(value) {
  if (!value) return '暂无';
  try {
    return dateTimeFormatter.format(new Date(value));
  } catch {
    return '暂无';
  }
}

function formatAccount(value) {
  return value === null ? '—' : `#${value}`;
}

function formatDuration(value) {
  return value === null ? '暂无' : formatMetricDuration(value);
}

function isHealthIssueCounter(key, value) {
  return healthIssueKeys.has(key) && value > 0;
}

watch(
  () => [filters.range, filters.source, filters.taskType, filters.commandClass, filters.egressType],
  () => {
    if (!isMounted) return;
    anomalyPage.value = 1;
    void refreshObservability();
  },
);

onMounted(() => {
  isMounted = true;
  void refreshObservability();
  pollTimer = setInterval(() => {
    void refreshObservability({ background: true });
  }, POLL_INTERVAL_MS);
});

onUnmounted(() => {
  isMounted = false;
  requestGeneration += 1;
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
});
</script>

<style lang="scss" scoped>
.observability-workspace {
  --observation-accent: #3d67d8;
  --observation-accent-soft: rgba(61, 103, 216, 0.1);
  --observation-border: rgba(116, 134, 173, 0.2);
  --observation-surface: rgba(255, 255, 255, 0.82);
  display: grid;
  gap: 16px;
  color: var(--text-primary);
}

.workspace-heading,
.section-heading,
.filter-strip,
.freshness,
.health-status {
  display: flex;
  align-items: center;
}

.workspace-heading {
  justify-content: space-between;
  gap: 24px;
  padding: 2px 2px 6px;

  h1 {
    margin: 4px 0 6px;
    font-size: clamp(24px, 3vw, 34px);
    line-height: 1.15;
    letter-spacing: -0.025em;
  }
}

.workspace-kicker,
.section-index {
  margin: 0;
  color: var(--observation-accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.workspace-description,
.section-heading > p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.freshness {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px 12px;
  min-width: 260px;
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.freshness-mark {
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #35a46f;
  box-shadow: 0 0 0 4px rgba(53, 164, 111, 0.12);
  transition: background-color 180ms ease, box-shadow 180ms ease;
}

.freshness-mark.is-refreshing {
  background: var(--observation-accent);
  box-shadow: 0 0 0 4px var(--observation-accent-soft);
  animation: freshness-pulse 1.2s ease-in-out infinite;
}

.refreshing-label {
  color: var(--observation-accent);
  font-weight: 700;
}

.filter-strip {
  flex-wrap: wrap;
  gap: 12px;
  padding: 14px 16px;
  border: 1px solid var(--observation-border);
  border-radius: 14px;
  background: var(--observation-surface);
  box-shadow: 0 10px 28px rgba(21, 34, 68, 0.05);
}

.filter-field {
  width: min(100%, 188px);

  &--range {
    width: min(100%, 168px);
  }

  label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
  }

  :deep(.el-select) {
    width: 100%;
  }

  :deep(.el-select__wrapper) {
    min-height: 36px;
    box-shadow: 0 0 0 1px var(--observation-border) inset;
  }
}

.data-alert {
  border-radius: 12px;
}

.initial-loading,
.overview-surface,
.table-surface,
.health-surface {
  border: 1px solid var(--observation-border);
  border-radius: 16px;
  background: var(--observation-surface);
  box-shadow: 0 12px 34px rgba(18, 31, 64, 0.055);
}

.initial-loading {
  padding: 28px;
}

.overview-surface,
.table-surface,
.health-surface {
  overflow: hidden;
}

.section-heading {
  justify-content: space-between;
  gap: 20px;
  padding: 17px 20px;
  border-bottom: 1px solid var(--observation-border);

  h2 {
    margin: 3px 0 0;
    font-size: 16px;
    line-height: 1.35;
  }

  > p {
    max-width: 520px;
    text-align: right;
  }
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(138px, 1fr));
  border-bottom: 1px solid var(--observation-border);
  overflow-x: auto;
}

.kpi-item {
  min-width: 138px;
  padding: 18px 20px;
  border-right: 1px solid var(--observation-border);

  &:last-child {
    border-right: 0;
  }
}

.kpi-label,
.kpi-value {
  display: block;
}

.kpi-label {
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-size: 12px;
}

.kpi-value {
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 720;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.035em;
  transition: color 180ms ease;

  small {
    margin-left: 4px;
    color: var(--text-secondary);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0;
  }
}

.trend-figure {
  margin: 0;
  padding: 18px 20px 20px;

  figcaption {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    color: var(--text-secondary);
    font-size: 12px;

    span:first-child {
      color: var(--text-primary);
      font-weight: 700;
    }
  }
}

.trend-bars {
  display: flex;
  align-items: flex-end;
  gap: clamp(3px, 0.6vw, 9px);
  min-height: 164px;
  overflow-x: auto;
}

.trend-column {
  display: flex;
  flex: 1 0 8px;
  flex-direction: column;
  justify-content: flex-end;
  min-width: 6px;
  max-width: 30px;
  height: 164px;
}

.trend-value {
  min-height: 16px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 9px;
  line-height: 16px;
  text-align: center;
  text-overflow: ellipsis;
}

.trend-track {
  display: flex;
  align-items: flex-end;
  height: 140px;
  border-bottom: 1px solid var(--observation-border);
}

.trend-bar {
  width: 100%;
  min-height: 2px;
  border-radius: 3px 3px 0 0;
  background: var(--observation-accent);
  opacity: 0.86;
  transition: height 260ms ease, opacity 180ms ease;

  &.is-zero {
    background: rgba(116, 134, 173, 0.3);
    opacity: 0.45;
  }
}

.table-scroll {
  width: 100%;
  overflow-x: auto;

  &:focus-visible {
    outline: 2px solid var(--observation-accent);
    outline-offset: -2px;
  }

  :deep(.el-table) {
    min-width: 760px;
    --el-table-border-color: var(--observation-border);
    --el-table-header-bg-color: rgba(61, 103, 216, 0.045);
    --el-table-row-hover-bg-color: rgba(61, 103, 216, 0.04);
    background: transparent;
  }

  :deep(.el-table__inner-wrapper::before) {
    display: none;
  }

  :deep(.el-table th.el-table__cell) {
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 700;
  }

  :deep(.el-table td.el-table__cell) {
    color: var(--text-primary);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
}

.rate-value,
.category-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.rate-value.has-issue {
  color: #b94a3d;
  font-weight: 700;
}

.category-label::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #8090ad;
}

.category-command_timeout::before,
.category-command_error::before {
  background: #c05245;
}

.category-command_rate_limited::before,
.category-slow_command::before {
  background: #c2812b;
}

.pagination-row {
  display: flex;
  justify-content: flex-end;
  padding: 14px 18px;
  border-top: 1px solid var(--observation-border);
}

.health-surface {
  border-left: 3px solid #8090ad;
}

.health-heading {
  .health-status {
    gap: 8px;
    color: #66738d;
    font-size: 12px;
    font-weight: 700;
  }
}

.health-status-mark {
  display: inline-grid;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #8090ad;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;

  &::before {
    content: '?';
  }
}

.health-unknown {
  border-left-color: #8090ad;
}

.health-disabled {
  border-left-color: #c2812b;

  .health-status { color: #9b661d; }
  .health-status-mark { background: #c2812b; }
  .health-status-mark::before { content: '–'; }
}

.health-stopped {
  border-left-color: #c2812b;

  .health-status { color: #9b661d; }
  .health-status-mark { background: #c2812b; }
  .health-status-mark::before { content: '■'; font-size: 8px; }
}

.health-degraded {
  border-left-color: #c05245;

  .health-status { color: #a33f34; }
  .health-status-mark { background: #c05245; }
  .health-status-mark::before { content: '!'; }
}

.health-healthy {
  border-left-color: #35a46f;

  .health-status { color: #247d55; }
  .health-status-mark { background: #35a46f; }
  .health-status-mark::before { content: '✓'; }
}

.flush-facts,
.health-counters {
  display: grid;
  margin: 0;

  div {
    min-width: 0;
  }

  dt {
    color: var(--text-secondary);
    font-size: 11px;
  }

  dd {
    margin: 6px 0 0;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
}

.flush-facts {
  grid-template-columns: repeat(3, minmax(150px, 1fr));
  border-bottom: 1px solid var(--observation-border);

  div {
    padding: 16px 20px;
    border-right: 1px solid var(--observation-border);

    &:last-child {
      border-right: 0;
    }
  }
}

.health-counters {
  grid-template-columns: repeat(6, minmax(116px, 1fr));
  gap: 1px;
  background: var(--observation-border);

  div {
    padding: 14px 16px;
    background: var(--observation-surface);

    &.has-issue {
      box-shadow: inset 3px 0 #c2812b;

      dd {
        color: #9b661d;
      }
    }
  }
}

@keyframes freshness-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

@media (max-width: 1100px) {
  .kpi-grid {
    grid-template-columns: repeat(3, minmax(150px, 1fr));
  }

  .kpi-item:nth-child(3) {
    border-right: 0;
  }

  .kpi-item:nth-child(-n + 3) {
    border-bottom: 1px solid var(--observation-border);
  }

  .health-counters {
    grid-template-columns: repeat(3, minmax(130px, 1fr));
  }
}

@media (max-width: 720px) {
  .observability-workspace {
    gap: 12px;
  }

  .workspace-heading,
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }

  .freshness {
    justify-content: flex-start;
    min-width: 0;
  }

  .filter-field,
  .filter-field--range {
    width: calc(50% - 6px);
    min-width: 140px;
    flex: 1 1 150px;
  }

  .section-heading {
    padding: 15px 16px;

    > p {
      max-width: none;
      text-align: left;
    }
  }

  .kpi-grid {
    grid-template-columns: repeat(2, minmax(142px, 1fr));
  }

  .kpi-item {
    min-width: 142px;
    padding: 15px 16px;
    border-bottom: 1px solid var(--observation-border);

    &:nth-child(odd) {
      border-right: 1px solid var(--observation-border);
    }

    &:nth-child(even) {
      border-right: 0;
    }

    &:nth-last-child(-n + 2) {
      border-bottom: 0;
    }
  }

  .trend-figure {
    padding: 16px;
  }

  .flush-facts {
    grid-template-columns: 1fr;

    div {
      border-right: 0;
      border-bottom: 1px solid var(--observation-border);

      &:last-child {
        border-bottom: 0;
      }
    }
  }

  .health-counters {
    grid-template-columns: repeat(2, minmax(130px, 1fr));
  }
}

@media (max-width: 420px) {
  .filter-field,
  .filter-field--range {
    width: 100%;
    flex-basis: 100%;
  }

  .health-counters {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .freshness-mark,
  .kpi-value,
  .trend-bar {
    animation: none !important;
    transition: none !important;
  }
}
</style>
