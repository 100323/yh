<template>
  <div class="game-features-page">
    <el-card class="header-card">
      <div class="page-header">
        <div class="header-left">
          <h2>游戏功能</h2>
          <p>手动执行游戏操作</p>
        </div>
        <div class="header-right">
          <el-select v-model="selectedTokenId" placeholder="选择账号" style="width: 200px">
            <el-option
              v-for="token in tokenStore.gameTokens"
              :key="token.id"
              :label="token.name"
              :value="token.id"
            />
          </el-select>
        </div>
      </div>
    </el-card>

    <template v-if="selectedTokenId">
      <el-tabs v-model="activeTab" type="card">
        <el-tab-pane label="活动" name="activity">
          <div class="card-section">
            <MonthlyTasksCard />
            <StudyChallengeCard />
            <SkinChallengeCard />
            <Unlimitedlineup />
          </div>
        </el-tab-pane>

        <el-tab-pane label="工具" name="tools" lazy>
          <div class="card-section">
            <BoxHelperCard />
            <FishHelperCard />
            <RecruitHelperCard />
            <StarUpgradeCard />
            <FightHelperCard />
            <DreamHelperCard />
            <HeroUpgradeCard />
            <RefineHelperCard />
            <ConsumptionProgressCard />
            <BossTower />
          </div>
        </el-tab-pane>

        <el-tab-pane label="盐场" name="saltField" lazy>
          <el-tabs v-model="saltFieldSubTab" type="border-card">
            <el-tab-pane label="盐场" name="warrank">
              <ClubWarrank />
            </el-tab-pane>
            <el-tab-pane label="本周战绩" name="weekBattle">
              <ClubBattleRecords />
            </el-tab-pane>
            <el-tab-pane label="本月战绩" name="monthBattle">
              <ClubMonthBattleRecords />
            </el-tab-pane>
            <el-tab-pane label="盐场地图" name="legionWarMap">
              <LegionWarMap />
            </el-tab-pane>
            <el-tab-pane label="盐场战况" name="legionWarStatistics">
              <LegionWarStatistics />
            </el-tab-pane>
          </el-tabs>
        </el-tab-pane>

        <el-tab-pane label="蟠桃园" name="peach" lazy>
          <el-tabs v-model="peachSubTab" type="border-card">
            <el-tab-pane label="蟠桃园信息" name="peach">
              <PeachInfo />
            </el-tab-pane>
            <el-tab-pane label="蟠桃园战绩" name="peachBattle">
              <PeachBattleRecords />
            </el-tab-pane>
          </el-tabs>
        </el-tab-pane>

        <el-tab-pane label="切磋" name="fightPvp" lazy>
          <FightPvp />
        </el-tab-pane>
      </el-tabs>
    </template>

    <el-empty v-else description="请先在账号管理中添加账号" />
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useTokenStore } from '@stores/tokenStore';

const MonthlyTasksCard = defineAsyncComponent(() => import('@components/cards/MonthlyTasksCard.vue'));
const StudyChallengeCard = defineAsyncComponent(() => import('@components/cards/StudyChallengeCard.vue'));
const SkinChallengeCard = defineAsyncComponent(() => import('@components/cards/SkinChallengeCard.vue'));
const Unlimitedlineup = defineAsyncComponent(() => import('@components/cards/Unlimitedlineup.vue'));
const BoxHelperCard = defineAsyncComponent(() => import('@components/cards/BoxHelperCard.vue'));
const FishHelperCard = defineAsyncComponent(() => import('@components/cards/FishHelperCard.vue'));
const RecruitHelperCard = defineAsyncComponent(() => import('@components/cards/RecruitHelperCard.vue'));
const StarUpgradeCard = defineAsyncComponent(() => import('@components/cards/StarUpgradeCard.vue'));
const FightHelperCard = defineAsyncComponent(() => import('@components/cards/FightHelperCard.vue'));
const DreamHelperCard = defineAsyncComponent(() => import('@components/cards/DreamHelperCard.vue'));
const HeroUpgradeCard = defineAsyncComponent(() => import('@components/cards/HeroUpgradeCard.vue'));
const RefineHelperCard = defineAsyncComponent(() => import('@components/cards/RefineHelperCard.vue'));
const ConsumptionProgressCard = defineAsyncComponent(() => import('@components/cards/ConsumptionProgressCard.vue'));
const BossTower = defineAsyncComponent(() => import('@components/Tower/BossTower.vue'));
const ClubWarrank = defineAsyncComponent(() => import('@components/Club/ClubWarrank.vue'));
const ClubBattleRecords = defineAsyncComponent(() => import('@components/Club/ClubBattleRecords.vue'));
const ClubMonthBattleRecords = defineAsyncComponent(() => import('@components/Club/ClubMonthBattleRecords.vue'));
const LegionWarMap = defineAsyncComponent(() => import('@components/Club/LegionWarMap.vue'));
const LegionWarStatistics = defineAsyncComponent(() => import('@components/Club/LegionWarStatistics.vue'));
const PeachInfo = defineAsyncComponent(() => import('@components/Club/PeachInfo.vue'));
const PeachBattleRecords = defineAsyncComponent(() => import('@components/Club/PeachBattleRecords.vue'));
const FightPvp = defineAsyncComponent(() => import('@components/cards/FightPvp.vue'));

const tokenStore = useTokenStore();

const activeTab = ref('activity');
const selectedTokenId = computed({
  get: () => tokenStore.selectedTokenId || '',
  set: (value) => {
    if (!value) return;
    tokenStore.selectToken(value);
  }
});
const saltFieldSubTab = ref('warrank');
const peachSubTab = ref('peach');

onMounted(async () => {
  await tokenStore.initTokenStore();

  if (tokenStore.gameTokens.length === 0) {
    return;
  }

  const currentId = String(tokenStore.selectedTokenId || '');
  const hasCurrentToken = tokenStore.gameTokens.some((token) => token.id === currentId);
  const targetId = hasCurrentToken ? currentId : tokenStore.gameTokens[0].id;

  if (targetId) {
    tokenStore.selectToken(targetId);
  }
});

watch(() => tokenStore.gameTokens, (tokens) => {
  if (tokens.length === 0) {
    return;
  }

  const currentId = String(tokenStore.selectedTokenId || '');
  const hasCurrentToken = tokens.some((token) => token.id === currentId);
  if (!hasCurrentToken) {
    tokenStore.selectToken(tokens[0].id);
  }
}, { deep: true, immediate: true });
</script>

<style lang="scss" scoped>
.game-features-page {
  position: relative;
  padding: var(--spacing-md);

  .header-card {
    margin-bottom: 20px;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;

    .header-left {
      h2 {
        margin: 0 0 4px 0;
        font-size: 18px;
      }

      p {
        margin: 0;
        color: var(--el-text-color-secondary);
        font-size: 14px;
      }
    }
  }

  .card-section {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;

    @media (max-width: 1200px) {
      grid-template-columns: 1fr;
    }

    > * {
      margin-bottom: 0;
    }
  }

  :deep(.el-tabs__content) {
    padding: 20px 0;
  }

  :deep(.el-tabs--border-card) {
    border-radius: 8px;
    overflow: hidden;
  }
}

@media (max-width: 768px) {
  .game-features-page {
    padding: var(--spacing-sm);

    .header-card {
      margin-bottom: var(--spacing-md);
    }

    .page-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--spacing-md);

      .header-right {
        width: 100%;
        
        .el-select {
          width: 100% !important;
        }
      }

      .header-left {
        h2 {
          font-size: var(--font-size-lg);
        }

        p {
          font-size: var(--font-size-sm);
        }
      }
    }

    .card-section {
      gap: var(--spacing-md);
    }

    :deep(.el-tabs__header) {
      margin-bottom: var(--spacing-md) !important;
    }

    :deep(.el-tabs__content) {
      padding: var(--spacing-md) 0;
    }

    :deep(.el-tabs--border-card) {
      .el-tabs__content {
        padding: var(--spacing-sm) !important;
      }
    }

    :deep(.el-tabs--border-card) {
      .el-tabs__header {
        border-bottom: 1px solid var(--border-light);
      }
    }
  }
}

@media (max-width: 480px) {
  .game-features-page {
    padding: var(--spacing-xs);

    .page-header {
      .header-left {
        h2 {
          font-size: var(--font-size-md);
        }
      }
    }

    .card-section {
      gap: var(--spacing-sm);
    }
  }
}
</style>
