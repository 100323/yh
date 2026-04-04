<template>
  <MyCard class="lineup-saver" :statusClass="{ active: state.isRunning }">
    <template #icon>
      <img
        src="/icons/1733492491706152.png"
        alt="无限阵容图标"
      />
    </template>
    <template #title>
      <h3>无限阵容</h3>
      <p>保存阵容、快速切换</p>
    </template>
    <template #badge>
      <span>{{ state.isRunning ? "运行中" : "已停止" }}</span>
    </template>
    <template #default>
      <div class="lineup-container">
        <div class="toolbar">
          <n-button
            type="primary"
            size="small"
            @click="refreshTeamInfo({ force: true })"
            :loading="loading"
            :disabled="state.isRunning"
          >
            刷新数据
          </n-button>
          <n-button
            size="small"
            @click="saveCurrentLineup"
            :disabled="editingHeroes.length === 0 || state.isRunning"
          >
            保存阵容
          </n-button>
          <n-button
            type="success"
            size="small"
            @click="openAddHeroModal"
            :disabled="editingHeroes.length >= 5 || state.isRunning"
          >
            上阵英雄
          </n-button>
          <n-button
            type="info"
            size="small"
            @click="savedLineupsModalVisible = true"
            :loading="lineupsLoading"
          >
            已保存无限阵容 ({{ savedLineups.length }}/{{ MAX_SAVED_LINEUPS }}){{ lineupsSyncing ? " · 同步中" : "" }}
          </n-button>
          <n-button size="small" @click="clearApplyLogs">清空日志</n-button>
        </div>

        <div
          v-if="state.isRunning || state.stepLogs.length > 0"
          class="apply-log-panel"
        >
          <div class="apply-log-header">
            <div class="apply-log-title">
              <span>应用日志</span>
              <span v-if="state.totalSteps" class="apply-log-progress">
                {{ state.currentStepIndex }}/{{ state.totalSteps }}
                {{ state.currentStepTitle || "-" }}
              </span>
            </div>
          </div>
          <div class="apply-log-list">
            <div
              v-for="log in state.stepLogs"
              :key="log.id"
              class="apply-log-item"
              :class="`level-${log.level}`"
            >
              <span class="log-time">{{ log.time }}</span>
              <span class="log-level">{{ log.level.toUpperCase() }}</span>
              <span class="log-message">{{ log.message }}</span>
            </div>
          </div>
        </div>

        <div class="quick-switch-section">
          <h4>阵容槽位</h4>
          <div class="team-selector">
            <n-button
              v-for="teamId in availableTeams"
              :key="teamId"
              :type="currentTeamId === teamId ? 'primary' : 'default'"
              size="small"
              @click="switchTeam(teamId)"
              :loading="switchingTeamId === teamId"
              :disabled="state.isRunning"
            >
              阵容{{ teamId }}
            </n-button>
          </div>
        </div>

        <div class="current-team-section" v-if="currentTeamInfo">
          <h4>
            编辑阵容 (阵容槽位{{ currentTeamId }})
            <span class="drag-tip">拖拽调整站位</span>
          </h4>
          <div class="heroes-grid">
            <div
              v-for="(hero, index) in editingHeroes"
              :key="hero.heroId + '-' + hero.position"
              class="hero-item"
              :class="{
                dragging: draggedHeroId === hero.heroId,
                'drag-over': dragOverPosition === hero.position,
              }"
              draggable="true"
              @dragstart="onDragStart($event, hero)"
              @dragend="onDragEnd"
              @dragover.prevent="onDragOver($event, hero)"
              @dragleave="onDragLeave"
              @drop="onDrop($event, hero)"
            >
              <div class="hero-position">{{ hero.position + 1 }}</div>
              <div class="hero-left" @click="showHeroRefineModal(hero)">
                <div class="hero-avatar">
                  <img
                    v-if="getHeroAvatar(hero.heroId)"
                    :src="getHeroAvatar(hero.heroId)"
                    :alt="getHeroName(hero.heroId)"
                  />
                  <div v-else class="hero-placeholder">
                    {{ getHeroName(hero.heroId)?.substring(0, 2) || "?" }}
                  </div>
                </div>
                <div class="hero-avatar-info">
                  <div class="hero-name-small-inline">
                    {{ getHeroName(hero.heroId) || `武将${hero.heroId}` }}
                  </div>
                  <div class="hero-level-small-inline" v-if="hero.level">
                    Lv.{{ hero.level }}
                  </div>
                </div>
              </div>
              <div class="hero-info" @click="showHeroRefineModal(hero)">
                <div class="hero-fish" v-if="getFishInfo(hero.artifactId)">
                  {{ getFishInfo(hero.artifactId).name }}
                  <span
                    v-if="getPearlSkillNameByArtifactId(hero.artifactId)"
                    class="hero-fish-skill-inline"
                  >
                    {{ getPearlSkillNameByArtifactId(hero.artifactId) }}
                  </span>
                  <span
                    v-if="getSlotColorsByArtifactId(hero.artifactId)"
                    class="hero-fish-slots-inline"
                  >
                    <span
                      v-for="(color, idx) in getSlotColorsByArtifactId(
                        hero.artifactId,
                      )"
                      :key="idx"
                      class="slot-dot-small"
                      :style="{ backgroundColor: color }"
                    ></span>
                  </span>
                </div>
                <div class="hero-stats" v-if="hero.power">
                  <div class="stat-row">
                    <span class="stat-power"
                      >战力{{ formatPower(hero.power) }}</span
                    >
                    <span class="stat-speed" v-if="hero.speed"
                      >速度{{ hero.speed }}</span
                    >
                  </div>
                  <div class="stat-row">
                    <span class="stat-attack" v-if="hero.attack"
                      >攻击{{ formatPower(hero.attack) }}</span
                    >
                    <span class="stat-hp" v-if="hero.hp"
                      >血量{{ formatPower(hero.hp) }}</span
                    >
                  </div>
                </div>
              </div>
              <div class="hero-actions">
                <n-button
                  class="exchange-btn"
                  size="tiny"
                  type="warning"
                  @click.stop="openExchangeModal(hero)"
                >
                  更换
                </n-button>
                <n-button
                  class="remove-btn"
                  size="tiny"
                  type="error"
                  @click.stop="removeHero(hero)"
                >
                  下阵
                </n-button>
              </div>
            </div>
          </div>
        </div>

        <div class="star-temple-section">
          <div class="star-temple-header">
            <div>
              <h4>星级十殿</h4>
              <p>绑定无限阵容后，按所选阵容与玩具挑战 1-8 关</p>
            </div>
            <div class="star-temple-header-actions">
              <span v-if="starTempleResetTimeText" class="star-temple-reset">
                重置：{{ starTempleResetTimeText }}
              </span>
              <n-button
                size="small"
                @click="refreshStarTempleInfo"
                :loading="starTemple.loading"
                :disabled="state.isRunning || starTemple.running"
              >
                刷新十殿
              </n-button>
            </div>
          </div>

          <div class="star-temple-toolbar">
            <n-select
              v-model:value="starTemple.selectedLineupId"
              class="star-temple-lineup-select"
              :options="starTempleLineupOptions"
              placeholder="选择要用于十殿的无限阵容"
              :disabled="state.isRunning || starTemple.running"
            />
            <div class="star-temple-selected-boss">
              当前关卡：第 {{ starTemple.selectedBossId }} 关
            </div>
            <n-button
              type="primary"
              @click="startStarTempleBattle"
              :loading="starTemple.running"
              :disabled="!selectedStarTempleLineup || state.isRunning || starTemple.loading"
            >
              开始挑战
            </n-button>
          </div>

          <div class="star-temple-stage-grid">
            <button
              v-for="stage in starTempleBossSummaries"
              :key="stage.bossId"
              type="button"
              class="star-stage-card"
              :class="{
                active: starTemple.selectedBossId === stage.bossId,
                completed: stage.starCount > 0,
              }"
              :disabled="state.isRunning || starTemple.running"
              @click="starTemple.selectedBossId = stage.bossId"
            >
              <span class="stage-name">第{{ stage.bossId }}关</span>
              <span class="stage-stars">{{ formatStarDisplay(stage.starCount) }}</span>
              <span class="stage-meta">已达成 {{ stage.starCount }}/3 星</span>
              <span class="stage-meta">次数值 {{ stage.fightCount }}</span>
              <span
                v-if="stage.rewardClaimed"
                class="stage-reward claimed"
              >
                奖励已领
              </span>
              <span v-else class="stage-reward">奖励未领</span>
            </button>
          </div>

          <div class="star-temple-summary" v-if="selectedStarTempleLineup">
            <span>
              已选阵容：槽位{{ selectedStarTempleLineup.teamId }} ·
              {{ selectedStarTempleLineup.name }}
            </span>
            <span>
              玩具：{{ weapon[selectedStarTempleLineup.weaponId] || selectedStarTempleLineup.weaponId || "沿用当前阵容" }}
            </span>
          </div>

          <div v-if="starTemple.lastResult" class="star-temple-result">
            <span :class="['result-badge', starTemple.lastResult.isWin ? 'win' : 'loss']">
              {{ starTemple.lastResult.isWin ? "挑战成功" : "挑战失败" }}
            </span>
            <span>
              第 {{ starTemple.lastResult.bossId }} 关 ·
              {{ starTemple.lastResult.isWin ? `${starTemple.lastResult.starCount} 星` : "0 星" }}
            </span>
            <span v-if="starTemple.lastResult.starIndexes.length > 0">
              星标：{{ starTemple.lastResult.starIndexes.map((index) => index + 1).join(", ") }}
            </span>
          </div>

          <div
            v-if="starTemple.logs.length > 0"
            class="star-temple-log-panel"
          >
            <div class="star-temple-log-header">
              <span>十殿日志</span>
              <n-button text size="tiny" @click="clearStarTempleLogs">
                清空
              </n-button>
            </div>
            <div class="star-temple-log-list">
              <div
                v-for="log in starTemple.logs"
                :key="log.id"
                class="star-temple-log-item"
                :class="`level-${log.level}`"
              >
                <span class="log-time">{{ log.time }}</span>
                <span class="log-level">{{ log.level.toUpperCase() }}</span>
                <span class="log-message">{{ log.message }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Teleport :to="savedLineupsModalTarget">
        <div
          v-if="savedLineupsModalVisible"
          class="lineup-page-modal-mask"
          @click.self="savedLineupsModalVisible = false"
        >
          <div class="lineup-page-modal-card">
            <div class="lineup-page-modal-header">
              <div class="lineup-page-modal-title">
                <h3>已保存的无限阵容</h3>
                <p>当前页面内查看、导入、导出和应用阵容（{{ savedLineups.length }}/{{ MAX_SAVED_LINEUPS }}）</p>
              </div>
              <n-button quaternary circle @click="savedLineupsModalVisible = false">
                ✕
              </n-button>
            </div>
            <div class="lineup-page-modal-body">
              <div v-if="savedLineups.length === 0" class="empty-tip">
                暂无保存的阵容，点击"保存阵容"开始使用
              </div>
              <div v-else class="saved-lineups-modal-content">
                <div class="team-tabs">
                  <div class="team-tabs-left">
                    <div
                      v-for="teamId in availableTeams"
                      :key="teamId"
                      class="team-tab"
                      :class="{ active: selectedTeamTab === teamId }"
                      @click="selectedTeamTab = teamId"
                    >
                      槽位{{ teamId }}
                      <span class="tab-count"
                        >({{ getLineupsByTeamId(teamId).length }})</span
                      >
                    </div>
                  </div>
                  <div class="team-tabs-right">
                    <n-button size="tiny" @click="exportLineups"> 导出 </n-button>
                    <n-upload
                      :show-file-list="false"
                      :custom-request="importLineups"
                      accept=".json"
                    >
                      <n-button size="tiny">导入</n-button>
                    </n-upload>
                  </div>
                </div>
                <div class="lineups-list">
                  <div
                    v-for="(lineup, index) in getLineupsByTeamId(selectedTeamTab)"
                    :key="index"
                    class="lineup-card"
                  >
                    <div class="lineup-title-bar" @click="toggleLineupExpand(lineup)">
                      <div class="lineup-title-left">
                        <span class="expand-icon">{{
                          expandedLineup === lineup ? "▼" : "▶"
                        }}</span>
                        <span class="lineup-name">{{ lineup.name }}</span>
                        <span
                          v-if="
                            lineup.weaponId !== undefined && lineup.weaponId !== null
                          "
                          class="lineup-weapon-tag"
                        >
                          {{ weapon[lineup.weaponId] || lineup.weaponId }}
                        </span>
                        <span class="lineup-time">{{
                          formatTime(lineup.savedAt)
                        }}</span>
                      </div>
                      <div class="lineup-quick-actions">
                        <n-button
                          size="tiny"
                          @click.stop="openRenameLineupDialog(savedLineups.indexOf(lineup))"
                          :disabled="state.isRunning"
                        >
                          重命名
                        </n-button>
                        <n-button
                          size="tiny"
                          @click.stop="showTechModal(lineup)"
                          :disabled="
                            !lineup.legionResearch ||
                            Object.keys(lineup.legionResearch).length === 0
                          "
                        >
                          科技
                        </n-button>
                        <n-button
                          type="error"
                          size="tiny"
                          @click.stop="openDeleteLineupDialog(savedLineups.indexOf(lineup))"
                          :disabled="state.isRunning"
                        >
                          删除
                        </n-button>
                        <n-button
                          type="primary"
                          size="tiny"
                          @click.stop="handleApplySavedLineup(lineup)"
                          :loading="lineup.applying"
                          :disabled="state.isRunning || lineup.teamId !== currentTeamId"
                        >
                          应用
                        </n-button>
                      </div>
                    </div>
                    <div v-if="expandedLineup === lineup" class="lineup-detail">
                      <div class="lineup-heroes-row">
                        <div
                          v-for="(hero, hIdx) in lineup.heroes"
                          :key="hIdx"
                          class="lineup-hero-card"
                        >
                          <img
                            v-if="getHeroAvatar(hero.heroId)"
                            :src="getHeroAvatar(hero.heroId)"
                            class="hero-avatar"
                          />
                          <div v-else class="hero-avatar-placeholder">
                            {{ getHeroName(hero.heroId)?.[0] || "?" }}
                          </div>
                          <div class="hero-info-small">
                            <div class="hero-header-small">
                              <div class="hero-name-small">
                                {{ getHeroName(hero.heroId) || `武将${hero.heroId}` }}
                              </div>
                              <div v-if="hero.level" class="hero-level-small">
                                Lv.{{ formatLevel(hero.level) }}
                              </div>
                            </div>
                            <div v-if="hero.fishId" class="hero-fish-info">
                              <div class="hero-fish-row">
                                <span class="hero-fish-name">
                                  {{ getFishNameById(hero.fishId) }}
                                  <span
                                    v-if="hero.skillId"
                                    class="hero-fish-skill-name"
                                  >
                                    {{ getPearlSkillNameById(hero.skillId) }}
                                  </span>
                                </span>
                                <div
                                  v-if="getSlotColors(hero.slotMap)"
                                  class="hero-fish-slots"
                                >
                                  <span
                                    v-for="(color, idx) in getSlotColors(
                                      hero.slotMap,
                                    )"
                                    :key="idx"
                                    class="slot-dot"
                                    :style="{ backgroundColor: color }"
                                  ></span>
                                </div>
                              </div>
                            </div>
                            <div v-if="hero.power" class="hero-stats-small">
                              <div class="stat-row-small">
                                <span class="stat-power"
                                  >战力{{ formatPower(hero.power) }}</span
                                >
                                <span class="stat-speed" v-if="hero.speed"
                                  >速度{{ hero.speed }}</span
                                >
                              </div>
                              <div class="stat-row-small">
                                <span class="stat-attack" v-if="hero.attack"
                                  >攻击{{ formatPower(hero.attack) }}</span
                                >
                                <span class="stat-hp" v-if="hero.hp"
                                  >血量{{ formatPower(hero.hp) }}</span
                                >
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    v-if="getLineupsByTeamId(selectedTeamTab).length === 0"
                    class="no-lineup-tip"
                  >
                    暂无保存的阵容
                  </div>
                </div>
              </div>
            </div>

            <div
              v-if="lineupActionDialog.visible"
              class="lineup-inline-dialog-mask"
              @click.self="closeLineupActionDialog"
            >
              <div class="lineup-inline-dialog-card" @click.stop>
                <div class="lineup-inline-dialog-header">
                  <h4>
                    {{ lineupActionDialog.mode === "rename" ? "重命名阵容" : "删除阵容" }}
                  </h4>
                  <n-button quaternary circle @click="closeLineupActionDialog">
                    ✕
                  </n-button>
                </div>
                <div class="lineup-inline-dialog-body">
                  <template v-if="lineupActionDialog.mode === 'rename'">
                    <p class="lineup-inline-dialog-tip">
                      直接在当前弹窗内修改名称，不再额外跳窗。
                    </p>
                    <n-input
                      v-model:value="lineupActionDialog.inputValue"
                      placeholder="请输入阵容名称"
                      maxlength="24"
                      show-count
                      @keydown.enter.prevent="confirmRenameLineup"
                    />
                  </template>
                  <template v-else>
                    <p class="lineup-inline-dialog-tip danger">
                      确定删除阵容“{{ lineupActionDialog.targetName }}”吗？删除后不可恢复。
                    </p>
                  </template>
                </div>
                <div class="lineup-inline-dialog-actions">
                  <n-button @click="closeLineupActionDialog">取消</n-button>
                  <n-button
                    v-if="lineupActionDialog.mode === 'rename'"
                    type="primary"
                    @click="confirmRenameLineup"
                  >
                    确定
                  </n-button>
                  <n-button
                    v-else
                    type="error"
                    @click="confirmDeleteLineup"
                  >
                    删除
                  </n-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Teleport>

      <n-modal
        v-model:show="techModalVisible"
        preset="card"
        title="俱乐部科技"
        style="width: 700px; max-width: 90vw"
        :bordered="false"
      >
        <div v-if="selectedTechData" class="tech-modal-content">
          <div
            v-for="type in [1, 2, 3, 4, 5, 6]"
            :key="type"
            class="tech-type-section"
          >
            <div class="tech-type-header">
              {{ LEGION_TECH_TYPE_NAME[type] }}
            </div>
            <div class="tech-items">
              <div
                v-for="techId in LEGION_TECH_TYPE_MAP[type]"
                :key="techId"
                class="tech-item"
              >
                <span class="tech-name">{{ LEGION_TECH_NAME[techId] }}</span>
                <span class="tech-level">
                  {{ selectedTechData[techId] || 0 }}/{{
                    LEGION_TECH_MAX_LEVEL[techId]
                  }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="no-tech-data">暂无科技数据</div>
      </n-modal>

      <n-modal
        v-model:show="refineModalVisible"
        preset="card"
        :title="refineModalTitle"
        style="width: 600px; max-width: 90vw"
        :bordered="false"
      >
        <n-spin :show="refineModalLoading">
          <div v-if="selectedHeroEquipment" class="refine-modal-content">
            <div
              v-for="partId in [1, 2, 3, 4]"
              :key="partId"
              class="equip-refine-section"
            >
              <div class="equip-header">
                <span class="equip-name">{{ partMap[partId] }}</span>
                <span class="equip-level">
                  Lv.{{ selectedHeroEquipment[partId]?.level || 0 }}
                </span>
                <span class="equip-bonus" v-if="selectedHeroEquipment[partId]">
                  +{{ getEquipBonus(partId) }}
                  {{ partId === 1 ? "攻击" : partId === 3 ? "防御" : "血量" }}
                </span>
              </div>
              <div class="slots-container">
                <div
                  v-for="slot in getEquipSlots(partId)"
                  :key="slot.id"
                  class="slot-item"
                  :class="{
                    locked: slot.isLocked,
                    [`color-${slot.colorId}`]: slot.colorId > 0,
                  }"
                >
                  <span class="slot-label">孔{{ slot.id }}</span>
                  <div v-if="slot.attrId" class="slot-attr">
                    <span class="attr-name">{{
                      getAttrName(slot.attrId)
                    }}</span>
                    <span class="attr-value">+{{ slot.attrNum }}%</span>
                  </div>
                  <div v-else class="slot-empty">未淬炼</div>
                  <n-tag v-if="slot.isLocked" size="small" type="warning"
                    >锁定</n-tag
                  >
                </div>
              </div>
            </div>
          </div>
          <div v-else class="no-equipment">暂无装备数据</div>
        </n-spin>
      </n-modal>

      <n-modal
        v-model:show="exchangeModalVisible"
        preset="card"
        :title="exchangeMode === 'add' ? '上阵英雄' : '更换武将'"
        style="width: 700px; max-width: 90vw"
        :bordered="false"
      >
        <div class="exchange-modal-content">
          <div v-if="exchangeMode === 'exchange'" class="current-hero-info">
            <span>当前武将：</span>
            <n-tag type="primary" size="large">
              {{
                getHeroName(exchangeHero?.heroId) ||
                `武将${exchangeHero?.heroId}`
              }}
            </n-tag>
          </div>
          <div v-else class="current-hero-info">
            <span>上阵位置：</span>
            <n-tag type="success" size="large">
              位置 {{ getFirstEmptySlot() + 1 }}
            </n-tag>
          </div>
          <n-input
            v-model:value="heroSearchKeyword"
            placeholder="搜索武将名称..."
            clearable
            style="margin-bottom: 12px"
          />
          <div class="hero-filter-section">
            <div class="filter-label">品质：</div>
            <div class="filter-tags">
              <n-tag
                v-for="q in heroQualities"
                :key="q"
                :type="selectedQuality === q ? 'primary' : 'default'"
                :bordered="false"
                style="cursor: pointer; margin-right: 8px"
                @click="selectedQuality = selectedQuality === q ? '全部' : q"
              >
                {{ q }}
              </n-tag>
            </div>
          </div>
          <div class="hero-filter-section">
            <div class="filter-label">国家：</div>
            <div class="filter-tags">
              <n-tag
                v-for="t in heroCountries"
                :key="t"
                :type="selectedCountry === t ? 'primary' : 'default'"
                :bordered="false"
                style="cursor: pointer; margin-right: 8px"
                @click="selectedCountry = selectedCountry === t ? '全部' : t"
              >
                {{ t }}
              </n-tag>
            </div>
          </div>
          <n-spin :show="exchangeLoading">
            <div class="hero-select-grid">
              <div
                v-for="hero in filteredHeroList"
                :key="hero.id"
                class="hero-select-item"
                :class="{
                  selected: exchangeTargetHeroId === hero.id,
                  'quality-red': hero.quality === '红将',
                  'quality-orange': hero.quality === '橙将',
                  'quality-purple': hero.quality === '紫将',
                }"
                @click="selectExchangeHero(hero)"
              >
                <div class="hero-select-avatar">
                  <img v-if="hero.avatar" :src="hero.avatar" :alt="hero.name" />
                  <div v-else class="hero-placeholder">
                    {{ hero.name?.substring(0, 2) || "?" }}
                  </div>
                </div>
                <div class="hero-select-name">{{ hero.name }}</div>
                <div class="hero-select-tags">
                  <n-tag
                    size="small"
                    :bordered="false"
                    :type="
                      hero.quality === '红将'
                        ? 'error'
                        : hero.quality === '橙将'
                          ? 'warning'
                          : hero.quality === '紫将'
                            ? 'info'
                            : 'default'
                    "
                  >
                    {{ hero.quality }}
                  </n-tag>
                  <n-tag size="small" :bordered="false" type="default">
                    {{ hero.type }}
                  </n-tag>
                </div>
              </div>
            </div>
          </n-spin>
        </div>
        <template #footer>
          <div style="display: flex; justify-content: flex-end; gap: 8px">
            <n-button @click="exchangeModalVisible = false">取消</n-button>
            <n-button
              type="primary"
              @click="confirmHeroAction"
              :loading="exchangeLoading"
              :disabled="!exchangeTargetHeroId"
            >
              {{ exchangeMode === "add" ? "确认上阵" : "确认更换" }}
            </n-button>
          </div>
        </template>
      </n-modal>
    </template>
  </MyCard>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useMessage, useDialog } from "naive-ui";
import { useTokenStore } from "@/stores/tokenStore";
import api from "@/utils/api";
import MyCard from "../Common/MyCard.vue";
import {
  HERO_DICT,
  FishMap,
  PearlMap,
  LEGION_TECH_MAX_LEVEL,
  LEGION_TECH_TYPE_MAP,
  LEGION_TECH_RESET_TYPE_MAP,
  LEGION_TECH_TYPE_NAME,
  LEGION_TECH_NAME,
  getTechType,
  weapon,
  color,
} from "@/utils/HeroList.js";

const tokenStore = useTokenStore();
const message = useMessage();
const dialog = useDialog();

const loading = ref(false);
const switchingTeamId = ref(null);
const currentTeamId = ref(1);
const availableTeams = ref([1, 2, 3, 4, 5, 6]);
const currentTeamInfo = ref(null);
const presetTeamData = ref(null);
const savedLineups = ref([]);
const lineupsLoading = ref(false);
const lineupsSyncing = ref(false);
const allHeroesData = ref({});
const roleHeroesData = ref({});
const editingTeamHeroes = ref({});
const artifactBooks = ref({});
const pearlMap = ref({});
let lastRefreshTime = 0;
const REFRESH_DEBOUNCE = 3000;
const COMMAND_DELAY = 500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatPower = (power) => {
  if (!power) return "0";
  if (power >= 100000000) {
    return (power / 100000000).toFixed(2) + "亿";
  }
  if (power >= 10000) {
    return (power / 10000).toFixed(2) + "万";
  }
  return power.toString();
};

const generateLineupId = () => {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const state = ref({
  isRunning: false,
  currentStepKey: "",
  currentStepTitle: "",
  currentStepIndex: 0,
  totalSteps: 0,
  stepResults: [],
  stepLogs: [],
});

const refineModalVisible = ref(false);
const refineModalLoading = ref(false);
const refineModalTitle = ref("");
const selectedHeroEquipment = ref(null);

const exchangeModalVisible = ref(false);
const exchangeLoading = ref(false);
const exchangeMode = ref("exchange");
const exchangeHero = ref(null);
const exchangeTargetHeroId = ref(null);
const heroSearchKeyword = ref("");
const selectedQuality = ref("全部");
const selectedCountry = ref("全部");
const savedLineupsModalVisible = ref(false);
const savedLineupsModalTarget = ref("body");
const selectedTeamTab = ref(1);
const expandedLineup = ref(null);
const techModalVisible = ref(false);
const selectedTechData = ref(null);
const activeApplyLineupId = ref(null);
const lineupActionDialog = ref({
  visible: false,
  mode: "rename",
  lineupIndex: -1,
  inputValue: "",
  targetName: "",
});

const draggedHeroId = ref(null);
const dragOverPosition = ref(null);

const STORAGE_KEY = "saved_lineups";
const MAX_SAVED_LINEUPS = 30;
const TEAM_SLOT_COUNT = 5;
const STAR_TEMPLE_BOSS_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
let lineupSyncPromise = Promise.resolve(false);

let applyLogId = 0;
let starTempleLogId = 0;
const STEP_RETRY_DELAY = 1200;
const LINEUP_WS_RECOVERY_RETRY_LIMIT = 1;
const RECOVERABLE_WS_ERROR_PATTERNS = [
  "websocket 连接关闭",
  "websocket连接关闭",
  "websocket未连接",
  "websocket 未连接",
  "websocket客户端不存在",
  "socket hang up",
  "connection closed",
  "not connected",
  "1005",
  "1006",
];

const addApplyLog = (level, message, extra = null) => {
  const entry = {
    id: `${Date.now()}-${applyLogId++}`,
    level,
    message,
    time: new Date().toLocaleTimeString(),
  };
  state.value.stepLogs.unshift(entry);
  if (state.value.stepLogs.length > 200) {
    state.value.stepLogs.length = 200;
  }

  const prefix = "[LineupApply]";
  if (level === "error") {
    console.error(prefix, message, extra || "");
  } else if (level === "warn") {
    console.warn(prefix, message, extra || "");
  } else {
    console.log(prefix, message, extra || "");
  }
};

const clearApplyLogs = () => {
  state.value.stepLogs = [];
};

const starTemple = ref({
  loading: false,
  running: false,
  selectedBossId: 1,
  selectedLineupId: null,
  info: null,
  lastResult: null,
  logs: [],
});

const addStarTempleLog = (level, message, extra = null) => {
  const entry = {
    id: `${Date.now()}-star-${starTempleLogId++}`,
    level,
    message,
    time: new Date().toLocaleTimeString(),
  };
  starTemple.value.logs.unshift(entry);
  if (starTemple.value.logs.length > 120) {
    starTemple.value.logs.length = 120;
  }

  const prefix = "[StarTemple]";
  if (level === "error") {
    console.error(prefix, message, extra || "");
  } else if (level === "warn") {
    console.warn(prefix, message, extra || "");
  } else {
    console.log(prefix, message, extra || "");
  }
};

const clearStarTempleLogs = () => {
  starTemple.value.logs = [];
};

const getLineupErrorMessage = (error) =>
  String(error?.message || error || "").trim();

const isRecoverableLineupError = (error) => {
  const message = getLineupErrorMessage(error).toLowerCase();
  if (!message) return false;
  return RECOVERABLE_WS_ERROR_PATTERNS.some((pattern) =>
    message.includes(pattern.toLowerCase()),
  );
};

const recoverLineupWebSocket = async (tokenId, stepTitle = "") => {
  addApplyLog(
    "warn",
    `检测到连接异常，准备自动重连${stepTitle ? `：${stepTitle}` : ""}`,
  );
  const connection = await tokenStore.ensureWebSocketConnected(tokenId, 12000);
  if (!connection?.client) {
    throw new Error("WebSocket 自动重连失败");
  }

  try {
    await tokenStore.ensureProtocolReady(
      tokenId,
      stepTitle ? `lineup:${stepTitle}` : "lineup-recovery",
    );
  } catch (error) {
    addApplyLog(
      "warn",
      `重连后协议预热失败，继续按当前连接重试：${error.message}`,
      error,
    );
  }

  addApplyLog(
    "info",
    `WebSocket 自动重连成功${stepTitle ? `：${stepTitle}` : ""}`,
  );
};

const getSelectedAccountId = () => {
  const rawId = tokenStore.selectedToken?.id;
  return rawId === undefined || rawId === null || rawId === ""
    ? null
    : String(rawId);
};

const getSavedLineupsStorageKey = (accountId = getSelectedAccountId()) =>
  accountId ? `${STORAGE_KEY}_${accountId}` : null;

const normalizeSavedLineup = (lineup = {}) => {
  const id = String(lineup?.id || lineup?.lineupKey || "").trim();
  if (!id) return null;

  const name = String(lineup?.name || "未命名阵容").trim() || "未命名阵容";
  const teamIdRaw = Number(lineup?.teamId ?? lineup?.team_id ?? 1);
  const savedAtRaw = Number(lineup?.savedAt ?? lineup?.saved_at ?? Date.now());

  return {
    ...lineup,
    id,
    name,
    heroes: Array.isArray(lineup?.heroes) ? lineup.heroes : [],
    teamId:
      Number.isInteger(teamIdRaw) && teamIdRaw > 0 ? teamIdRaw : 1,
    savedAt: Number.isFinite(savedAtRaw) ? savedAtRaw : Date.now(),
    applying: false,
    legionResearch:
      lineup?.legionResearch && typeof lineup.legionResearch === "object"
        ? lineup.legionResearch
        : {},
  };
};

const normalizeSavedLineupList = (lineups = []) =>
  (Array.isArray(lineups) ? lineups : [])
    .map((lineup) => normalizeSavedLineup(lineup))
    .filter(Boolean)
    .sort((a, b) => Number(b.savedAt || 0) - Number(a.savedAt || 0))
    .slice(0, MAX_SAVED_LINEUPS);

const serializeLineupForPersistence = (lineup) => {
  const normalized = normalizeSavedLineup(lineup);
  if (!normalized) return null;
  const { applying, ...rest } = normalized;
  return rest;
};

const readSavedLineupsFromLocalStorage = (accountId = getSelectedAccountId()) => {
  try {
    const key = getSavedLineupsStorageKey(accountId);
    if (!key) return [];
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return normalizeSavedLineupList(JSON.parse(raw));
  } catch (error) {
    console.error("加载本地阵容缓存失败:", error);
    return [];
  }
};

const persistLineupsToLocalStorage = (
  lineups,
  accountId = getSelectedAccountId(),
) => {
  try {
    const key = getSavedLineupsStorageKey(accountId);
    if (!key) return;
    const payload = normalizeSavedLineupList(lineups)
      .map((lineup) => serializeLineupForPersistence(lineup))
      .filter(Boolean);
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.error("保存阵容到缓存失败:", error);
    message.error("保存阵容失败");
  }
};

const fetchSavedLineupsFromBackend = async (accountId = getSelectedAccountId()) => {
  if (!accountId) return [];
  const response = await api.get(`/accounts/${accountId}/lineups`);
  return normalizeSavedLineupList(response?.data || []);
};

const queueSyncSavedLineupsToBackend = ({
  accountId = getSelectedAccountId(),
  lineups = savedLineups.value,
  silent = true,
} = {}) => {
  if (!accountId) {
    return Promise.resolve(false);
  }

  const payload = normalizeSavedLineupList(lineups)
    .map((lineup) => serializeLineupForPersistence(lineup))
    .filter(Boolean);

  lineupSyncPromise = lineupSyncPromise
    .catch(() => false)
    .then(async () => {
      lineupsSyncing.value = true;
      try {
        await api.put(`/accounts/${accountId}/lineups`, {
          lineups: payload,
        });
        return true;
      } catch (error) {
        console.error("同步阵容到后端失败:", error);
        if (!silent && getSelectedAccountId() === accountId) {
          message.error(error?.message || "同步阵容到后端失败");
        }
        return false;
      } finally {
        lineupsSyncing.value = false;
      }
    });

  return lineupSyncPromise;
};

const formatHeroListForLog = (heroes = []) => {
  if (!heroes.length) return "空";
  return heroes
    .map((hero) => {
      const name = getHeroName(hero.heroId) || hero.heroId;
      const position =
        hero.position === undefined || hero.position === null
          ? "?"
          : hero.position + 1;
      return `${name}@${position}`;
    })
    .join("、");
};

const normalizeId = (value) => {
  if (value === undefined || value === null || value === -1 || value === "-1") {
    return null;
  }
  const num = Number(value);
  return Number.isNaN(num) ? value : num;
};

const normalizePearlSkillId = (value) => {
  const normalized = normalizeId(value);
  return normalized === 0 ? null : normalized;
};

const getTeamHeroes = (teamInfo) => {
  if (!teamInfo) return [];
  return Object.entries(teamInfo)
    .map(([key, hero]) => ({
      position: hero?.battleTeamSlot ?? Number(key),
      heroId: normalizeId(hero?.heroId || hero?.id),
      artifactId: normalizeId(hero?.artifactId),
      attachmentUid: normalizeId(hero?.attachmentUid),
      pearlId: normalizeId(hero?.pearlId),
      level: hero?.level || null,
    }))
    .filter((h) => h.heroId)
    .sort((a, b) => a.position - b.position);
};

const buildTargetState = (lineup) => {
  return {
    teamId: Number(lineup.teamId),
    heroes: [...(lineup.heroes || [])]
      .map((hero) => ({
        heroId: normalizeId(hero.heroId),
        position: Number(hero.position),
        level: hero.level || null,
        attachmentUid: normalizeId(hero.attachmentUid),
        fishId: normalizeId(hero.fishId),
        pearlId: normalizeId(hero.pearlId),
        skillId: normalizePearlSkillId(hero.skillId),
      }))
      .filter((hero) => hero.heroId)
      .sort((a, b) => a.position - b.position),
    legionResearch: lineup.legionResearch || {},
    weaponId: normalizeId(lineup.weaponId),
  };
};

const loadLineupSnapshot = async (tokenId, teamId = null, options = {}) => {
  const { ensureTeamFresh = false } = options;
  const roleInfo = await tokenStore.sendMessageWithPromise(
    tokenId,
    "role_getroleinfo",
    {},
  );
  await delay(COMMAND_DELAY);

  let presetTeamResult = await tokenStore.sendMessageWithPromise(
    tokenId,
    "presetteam_getinfo",
    {},
  );
  await delay(COMMAND_DELAY);

  const role = roleInfo?.role || roleInfo || {};
  const heroesRaw = role?.heroes || {};
  const artifactBooksRaw = role?.artifactBooks || {};
  const pearlMapRaw = role?.pearlMap || {};
  const legionResearch = role?.legionResearch || {};

  roleHeroesData.value = heroesRaw;
  allHeroesData.value = heroesRaw;
  artifactBooks.value = artifactBooksRaw;
  pearlMap.value = pearlMapRaw;

  const presetInfo = presetTeamResult?.presetTeamInfo || {};
  const presetTeamMap = presetInfo?.presetTeamInfo || {};
  const resolvedTeamId = Number(
    teamId ?? presetInfo?.useTeamId ?? currentTeamId.value ?? 1,
  );

  if (ensureTeamFresh) {
    const teamIds = Object.keys(presetTeamMap)
      .filter((key) => /^\d+$/.test(key))
      .map(Number)
      .sort((a, b) => a - b);

    if (teamIds.length > 1) {
      const currentIndex = teamIds.indexOf(resolvedTeamId);
      const fallbackTeamId =
        teamIds[currentIndex === 0 ? 1 : currentIndex - 1] || teamIds[0];

      if (fallbackTeamId && fallbackTeamId !== resolvedTeamId) {
        try {
          await tokenStore.sendMessageWithPromise(tokenId, "presetteam_saveteam", {
            teamId: fallbackTeamId,
          });
          await delay(COMMAND_DELAY);
          await tokenStore.sendMessageWithPromise(tokenId, "presetteam_saveteam", {
            teamId: resolvedTeamId,
          });
          await delay(COMMAND_DELAY);
          presetTeamResult = await tokenStore.sendMessageWithPromise(
            tokenId,
            "presetteam_getinfo",
            {},
          );
          await delay(COMMAND_DELAY);
        } catch (error) {
          addApplyLog(
            "warn",
            `强制刷新阵容快照失败，继续使用普通快照：${error.message}`,
            error,
          );
        }
      }
    }
  }

  const refreshedPresetInfo = presetTeamResult?.presetTeamInfo || {};
  const refreshedPresetTeamMap = refreshedPresetInfo?.presetTeamInfo || {};
  const currentTeam =
    refreshedPresetTeamMap[resolvedTeamId] ||
    refreshedPresetTeamMap[String(resolvedTeamId)] ||
    {};
  const teamInfo = currentTeam?.teamInfo || {};
  const teamHeroes = getTeamHeroes(teamInfo);

  const heroesMap = {};
  const attachmentOwnerMap = {};
  const artifactOwnerMap = {};
  for (const [heroId, hero] of Object.entries(heroesRaw)) {
    const normalizedHeroId = normalizeId(heroId);
    const artifactId = normalizeId(hero?.artifactId);
    const attachmentUid = normalizeId(hero?.attachmentUid);
    heroesMap[normalizedHeroId] = {
      heroId: normalizedHeroId,
      level: hero?.level || null,
      order: hero?.order || 0,
      artifactId,
      attachmentUid,
    };
    if (attachmentUid) {
      attachmentOwnerMap[attachmentUid] = normalizedHeroId;
    }
    if (artifactId) {
      artifactOwnerMap[artifactId] = normalizedHeroId;
    }
  }

  const fishToArtifactMap = {};
  for (const [fishId, book] of Object.entries(artifactBooksRaw)) {
    const artifactId = normalizeId(book?.artifactId);
    if (artifactId) {
      fishToArtifactMap[normalizeId(fishId)] = artifactId;
    }
  }

  const pearlSkillMap = {};
  for (const [pearlId, pearlData] of Object.entries(pearlMapRaw)) {
    pearlSkillMap[normalizeId(pearlId)] = normalizePearlSkillId(
      pearlData?.skillId,
    );
  }

  return {
    roleId: normalizeId(role?.roleId || role?.id),
    teamId: resolvedTeamId,
    teamHeroes,
    teamInfo,
    heroesMap,
    artifactBooks: artifactBooksRaw,
    pearlMap: pearlMapRaw,
    legionResearch,
    weaponId: normalizeId(currentTeam?.weapon?.weaponId),
    attachmentOwnerMap,
    artifactOwnerMap,
    fishToArtifactMap,
    pearlSkillMap,
  };
};

const verifySuccess = (message, details = {}) => ({
  success: true,
  message,
  details,
});

const verifyFailure = (message, details = {}) => ({
  success: false,
  message,
  details,
});

const verifyTargetState = (targetState) => {
  if (!targetState?.heroes?.length) {
    return verifyFailure("目标阵容为空");
  }

  const positionSet = new Set();
  const heroSet = new Set();
  for (const hero of targetState.heroes) {
    if (positionSet.has(hero.position)) {
      return verifyFailure(`目标阵容存在重复站位: ${hero.position + 1}`);
    }
    if (heroSet.has(hero.heroId)) {
      return verifyFailure(`目标阵容存在重复武将: ${hero.heroId}`);
    }
    positionSet.add(hero.position);
    heroSet.add(hero.heroId);
  }

  return verifySuccess("目标阵容已构建");
};

const verifyAttachmentStep = (snapshot, targetState) => {
  const mismatches = targetState.heroes
    .filter((hero) => hero.attachmentUid)
    .filter(
      (hero) =>
        normalizeId(snapshot.heroesMap[hero.heroId]?.attachmentUid) !==
        normalizeId(hero.attachmentUid),
    );

  if (mismatches.length > 0) {
    return verifyFailure(
      `挂件归属未完成: ${mismatches.map((hero) => getHeroName(hero.heroId) || hero.heroId).join("、")}`,
      { mismatches },
    );
  }

  return verifySuccess("挂件归属检查通过");
};

const verifyNoExtraHeroesStep = (snapshot, targetState) => {
  const targetHeroIds = new Set(targetState.heroes.map((hero) => hero.heroId));
  const extraHeroes = snapshot.teamHeroes.filter(
    (hero) => !targetHeroIds.has(hero.heroId),
  );

  if (extraHeroes.length > 0) {
    return verifyFailure(
      `仍有多余武将未下阵: ${extraHeroes.map((hero) => getHeroName(hero.heroId) || hero.heroId).join("、")}`,
      {
        extraHeroes,
        currentTeam: formatHeroListForLog(snapshot.teamHeroes),
        targetTeam: formatHeroListForLog(targetState.heroes),
      },
    );
  }

  return verifySuccess("多余武将已清理");
};

const verifyAllTargetHeroesPresent = (snapshot, targetState) => {
  const currentHeroIds = new Set(snapshot.teamHeroes.map((hero) => hero.heroId));
  const missingHeroes = targetState.heroes.filter(
    (hero) => !currentHeroIds.has(hero.heroId),
  );

  if (missingHeroes.length > 0) {
    return verifyFailure(
      `仍有武将未上阵: ${missingHeroes.map((hero) => getHeroName(hero.heroId) || hero.heroId).join("、")}`,
      {
        missingHeroes,
        currentTeam: formatHeroListForLog(snapshot.teamHeroes),
        targetTeam: formatHeroListForLog(targetState.heroes),
      },
    );
  }

  return verifySuccess("目标武将均已上阵");
};

const verifyHeroPositions = (snapshot, targetState) => {
  const positionMap = Object.fromEntries(
    snapshot.teamHeroes.map((hero) => [hero.heroId, hero.position]),
  );
  const mismatches = targetState.heroes.filter(
    (hero) => positionMap[hero.heroId] !== hero.position,
  );

  if (mismatches.length > 0) {
    return verifyFailure(
      `站位未完全校正: ${mismatches.map((hero) => `${getHeroName(hero.heroId) || hero.heroId}->${hero.position + 1}`).join("、")}`,
      {
        mismatches,
        currentTeam: formatHeroListForLog(snapshot.teamHeroes),
        targetTeam: formatHeroListForLog(targetState.heroes),
      },
    );
  }

  return verifySuccess("站位校正完成");
};

const verifyHeroLevels = (snapshot, targetState) => {
  const mismatches = targetState.heroes.filter((hero) => {
    if (!hero.level || hero.level <= 0) return false;
    return (snapshot.heroesMap[hero.heroId]?.level || 1) !== hero.level;
  });

  if (mismatches.length > 0) {
    return verifyFailure(
      `等级未完全同步: ${mismatches.map((hero) => `${getHeroName(hero.heroId) || hero.heroId}(目标${hero.level})`).join("、")}`,
      { mismatches },
    );
  }

  return verifySuccess("武将等级同步完成");
};

const resolveTargetArtifactId = (snapshot, targetHero) => {
  if (targetHero.fishId) {
    return normalizeId(snapshot.fishToArtifactMap[targetHero.fishId]);
  }
  if (targetHero.pearlId) {
    return normalizeId(snapshot.pearlMap[targetHero.pearlId]?.artifactId);
  }
  return null;
};

const verifyHeroArtifacts = (snapshot, targetState) => {
  const mismatches = targetState.heroes.filter((hero) => {
    if (!hero.fishId && !hero.pearlId) return false;
    const targetArtifactId = resolveTargetArtifactId(snapshot, hero);
    const currentArtifactId = normalizeId(snapshot.heroesMap[hero.heroId]?.artifactId);
    return targetArtifactId !== currentArtifactId;
  });

  if (mismatches.length > 0) {
    return verifyFailure(
      `鱼灵未完全同步: ${mismatches.map((hero) => getHeroName(hero.heroId) || hero.heroId).join("、")}`,
      { mismatches },
    );
  }

  return verifySuccess("鱼灵同步完成");
};

const verifyPearlSkills = (snapshot, targetState) => {
  const mismatches = targetState.heroes.filter((hero) => {
    if (!hero.pearlId) return false;
    const currentSkillId = normalizePearlSkillId(
      snapshot.pearlSkillMap[hero.pearlId],
    );
    return currentSkillId !== normalizePearlSkillId(hero.skillId);
  });

  if (mismatches.length > 0) {
    return verifyFailure(
      `鱼珠技能未完全同步: ${mismatches.map((hero) => `${getHeroName(hero.heroId) || hero.heroId}(pearl:${hero.pearlId}, 当前:${normalizePearlSkillId(snapshot.pearlSkillMap[hero.pearlId]) ?? "-"}, 目标:${normalizePearlSkillId(hero.skillId) ?? "-"})`).join("、")}`,
      {
        mismatches,
        currentTeam: formatHeroListForLog(snapshot.teamHeroes),
        targetTeam: formatHeroListForLog(targetState.heroes),
      },
    );
  }

  return verifySuccess("鱼珠技能同步完成");
};

const verifyLegionResearchStep = (snapshot, targetState) => {
  const targetResearch = targetState.legionResearch || {};
  const keys = Object.keys(targetResearch);
  if (keys.length === 0) {
    return verifySuccess("无科技需要同步");
  }

  const mismatches = keys.filter(
    (techId) =>
      Number(snapshot.legionResearch?.[techId] || 0) !==
      Number(targetResearch[techId] || 0),
  );

  if (mismatches.length > 0) {
    return verifyFailure(
      `科技未完全同步: ${mismatches.slice(0, 5).join("、")}${mismatches.length > 5 ? "..." : ""}`,
      { mismatches },
    );
  }

  return verifySuccess("科技同步完成");
};

const verifyWeaponStep = (snapshot, targetState) => {
  if (normalizeId(targetState.weaponId) === normalizeId(snapshot.weaponId)) {
    return verifySuccess("玩具同步完成");
  }
  return verifyFailure(
    `玩具未同步，当前 ${snapshot.weaponId ?? "-"} / 目标 ${targetState.weaponId ?? "-"}`,
  );
};

const verifyFinalLineupState = (snapshot, targetState) => {
  const checks = [
    verifyNoExtraHeroesStep(snapshot, targetState),
    verifyAllTargetHeroesPresent(snapshot, targetState),
    verifyHeroPositions(snapshot, targetState),
    verifyHeroLevels(snapshot, targetState),
    verifyHeroArtifacts(snapshot, targetState),
    verifyPearlSkills(snapshot, targetState),
    verifyLegionResearchStep(snapshot, targetState),
    verifyWeaponStep(snapshot, targetState),
  ].filter((result) => !result.success);

  if (checks.length > 0) {
    return verifyFailure(
      checks.map((result) => result.message).join("；"),
      { checks },
    );
  }

  return verifySuccess("阵容最终校验通过");
};

const loadLineupSnapshotWithRecovery = async (
  ctx,
  step,
  consumeRecovery = null,
) => {
  try {
    return await loadLineupSnapshot(ctx.tokenId, ctx.teamId, {
      ensureTeamFresh: !!step.ensureTeamFreshSnapshot,
    });
  } catch (error) {
    if (!isRecoverableLineupError(error) || !consumeRecovery?.()) {
      throw error;
    }

    addApplyLog(
      "warn",
      `刷新阵容快照时连接异常，准备自动重连：${error.message}`,
      error,
    );
    await recoverLineupWebSocket(ctx.tokenId, step.title);
    return loadLineupSnapshot(ctx.tokenId, ctx.teamId, {
      ensureTeamFresh: !!step.ensureTeamFreshSnapshot,
    });
  }
};

const executeLineupSteps = async (ctx, steps) => {
  state.value.totalSteps = steps.length;
  state.value.stepResults = [];

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    state.value.currentStepKey = step.key;
    state.value.currentStepTitle = step.title;
    state.value.currentStepIndex = index + 1;
    const baseAttempts = Math.max(1, (step.retry || 0) + 1);
    const maxAttempts = baseAttempts + LINEUP_WS_RECOVERY_RETRY_LIMIT;
    let lastVerifyResult = null;
    let lastError = null;
    let wsRecoveryUsed = 0;
    const consumeRecovery = () => {
      if (wsRecoveryUsed >= LINEUP_WS_RECOVERY_RETRY_LIMIT) {
        return false;
      }
      wsRecoveryUsed += 1;
      return true;
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      addApplyLog(
        "info",
        `开始步骤 ${index + 1}/${steps.length}：${step.title}${
          maxAttempts > 1 ? `（尝试 ${attempt}/${maxAttempts}）` : ""
        }`,
      );

      try {
        await step.run(ctx);

        if (step.refreshSnapshot !== false) {
          addApplyLog("info", `步骤 ${step.title} 执行完毕，刷新快照校验`);
          ctx.currentSnapshot = await loadLineupSnapshotWithRecovery(
            ctx,
            step,
            consumeRecovery,
          );
        }

        const verifyResult = await step.verify(ctx);
        lastVerifyResult = verifyResult;

        if (verifyResult.success) {
          state.value.stepResults.push({
            key: step.key,
            title: step.title,
            attempt,
            ...verifyResult,
          });
          addApplyLog(
            "info",
            `步骤 ${index + 1}/${steps.length}【${step.title}】完成：${verifyResult.message}`,
          );
          lastError = null;
          break;
        }

        lastError = new Error(verifyResult.message);
        addApplyLog(
          attempt < maxAttempts ? "warn" : "error",
          `步骤 ${index + 1}/${steps.length}【${step.title}】校验失败：${verifyResult.message}`,
          verifyResult.details,
        );
      } catch (error) {
        lastError = error;
        addApplyLog(
          attempt < maxAttempts ? "warn" : "error",
          `步骤 ${index + 1}/${steps.length}【${step.title}】执行异常：${error.message}`,
          error,
        );
      }

      if (!lastError) {
        break;
      }

      if (attempt < maxAttempts) {
        const shouldRecover = isRecoverableLineupError(lastError)
          && consumeRecovery();

        if (shouldRecover) {
          await recoverLineupWebSocket(ctx.tokenId, step.title);
        }

        addApplyLog(
          "warn",
          `步骤 ${step.title} 将在 ${STEP_RETRY_DELAY}ms 后重试${shouldRecover ? "（已自动重连）" : ""}`,
        );
        await delay(STEP_RETRY_DELAY);
        ctx.currentSnapshot = await loadLineupSnapshotWithRecovery(
          ctx,
          step,
          consumeRecovery,
        );
      }
    }

    if (lastError) {
      state.value.stepResults.push({
        key: step.key,
        title: step.title,
        ...(lastVerifyResult || verifyFailure(lastError.message)),
      });
      throw new Error(`步骤 ${index + 1}/${steps.length}【${step.title}】失败：${lastError.message}`);
    }
  }
};

const syncLegionResearch = async (tokenId, targetResearch) => {
  if (!targetResearch || Object.keys(targetResearch).length === 0) {
    return { success: true, message: "无科技数据需要同步" };
  }

  const roleInfo = await tokenStore.sendMessageWithPromise(
    tokenId,
    "role_getroleinfo",
    {},
  );
  await delay(COMMAND_DELAY);
  const role = roleInfo?.role || roleInfo;
  const currentResearch = role?.legionResearch || {};

  const typesToReset = new Set();
  const typesToResetResearch = new Set();

  for (const type of [1, 2, 3, 4, 5, 6]) {
    const techIds = LEGION_TECH_RESET_TYPE_MAP[type];
    for (const techId of techIds) {
      const currentLevel = currentResearch[techId] || 0;
      const targetLevel = targetResearch[techId] || 0;
      if (
        currentLevel !== targetLevel &&
        (currentLevel > 0 || targetLevel > 0)
      ) {
        typesToResetResearch.add(type);
        break;
      }
    }
    const techIds2 = LEGION_TECH_TYPE_MAP[type];
    for (const techId of techIds2) {
      const currentLevel = currentResearch[techId] || 0;
      const targetLevel = targetResearch[techId] || 0;
      if (
        currentLevel !== targetLevel &&
        (currentLevel > 0 || targetLevel > 0)
      ) {
        typesToReset.add(type);
        break;
      }
    }
  }

  if (typesToResetResearch.size === 0 && typesToReset.size === 0) {
    return { success: true, message: "科技配置已匹配，无需调整" };
  }

  const errors = [];

  for (const type of typesToResetResearch) {
    try {
      await tokenStore.sendMessageWithPromise(tokenId, "legion_resetresearch", {
        advanced: false,
        type: type,
      });
    } catch (err) {}
    await delay(COMMAND_DELAY);
  }

  const sortedTypes = [...typesToReset].sort((a, b) => a - b);
  console.log(sortedTypes);

  for (const type of sortedTypes) {
    const techIds2 = LEGION_TECH_TYPE_MAP[type];
    for (const techId of techIds2) {
      const targetLevel = targetResearch[techId] || 0;
      if (targetLevel > 0) {
        const maxLevel = LEGION_TECH_MAX_LEVEL[techId];
        const isMax = targetLevel >= maxLevel;
        if (isMax) {
          try {
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "legion_research",
              {
                isMax: true,
                researchId: techId,
              },
            );
          } catch (err) {}
          await delay(COMMAND_DELAY);
        } else {
          for (let i = 0; i < targetLevel; i++) {
            try {
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "legion_research",
                {
                  isMax: false,
                  researchId: techId,
                },
              );
            } catch (err) {}
            await delay(COMMAND_DELAY);
          }
        }
      }
    }
  }

  return { success: true, message: "科技配置已同步" };
};

const partMap = {
  1: "武器",
  2: "铠甲",
  3: "头冠",
  4: "坐骑",
};

const attrMap = {
  1: "攻击",
  2: "血量",
  3: "防御",
  4: "速度",
  5: "破甲",
  6: "破甲抵抗",
  7: "精准",
  8: "格挡",
  9: "减伤",
  10: "暴击",
  11: "暴击抵抗",
  12: "爆伤",
  13: "爆伤抵抗",
  14: "技能伤害",
  15: "免控",
  16: "眩晕免疫",
  17: "冰冻免疫",
  18: "沉默免疫",
  19: "流血免疫",
  20: "中毒免疫",
  21: "灼烧免疫",
};

const heroQualities = computed(() => {
  return ["全部", "红将", "橙将", "紫将"];
});

const heroCountries = computed(() => {
  const countries = new Set(["全部"]);
  Object.values(HERO_DICT).forEach((hero) => {
    if (hero.type) countries.add(hero.type);
  });
  return Array.from(countries);
});

const getHeroQuality = (heroId) => {
  const prefix = Math.floor(heroId / 100);
  if (prefix === 1) return "红将";
  if (prefix === 2) return "橙将";
  if (prefix === 3) return "紫将";
  return "其他";
};

const getFishInfo = (artifactId) => {
  if (!artifactId || artifactId === -1) return null;

  for (const [fishId, book] of Object.entries(artifactBooks.value)) {
    if (book.artifactId === artifactId) {
      const fishData = FishMap[fishId];
      if (fishData) {
        return {
          fishId: Number(fishId),
          name: fishData.name,
          artifactId: book.artifactId,
          star: book.claimedStar || 0,
        };
      }
    }
  }
  return null;
};

const getFishNameByArtifactId = (artifactId) => {
  const fishInfo = getFishInfo(artifactId);
  return fishInfo ? fishInfo.name : null;
};

const getFishNameById = (fishId) => {
  if (!fishId) return null;
  const fishData = FishMap[fishId];
  return fishData ? fishData.name : `鱼灵${fishId}`;
};

const getPearlSkillNameById = (skillId) => {
  if (!skillId) return null;
  const skillData = PearlMap[skillId];
  return skillData ? skillData.name : null;
};

const getSlotColors = (slotMap) => {
  if (!slotMap) return null;
  const colors = [];
  for (const slot of Object.values(slotMap)) {
    if (slot.colorId) {
      const colorData = color[slot.colorId];
      colors.push(colorData ? colorData.value : "white");
    }
  }
  return colors.length > 0 ? colors : null;
};

const getPearlDataByArtifactId = (artifactId) => {
  if (!artifactId || artifactId === -1) return null;
  for (const [pearlId, pearlData] of Object.entries(pearlMap.value)) {
    if (pearlData.artifactId === artifactId) {
      return pearlData;
    }
  }
  return null;
};

const getPearlSkillNameByArtifactId = (artifactId) => {
  const pearlData = getPearlDataByArtifactId(artifactId);
  if (!pearlData || !pearlData.skillId) return null;
  const skillData = PearlMap[pearlData.skillId];
  return skillData ? skillData.name : null;
};

const getSlotColorsByArtifactId = (artifactId) => {
  const pearlData = getPearlDataByArtifactId(artifactId);
  if (!pearlData || !pearlData.slotMap) return null;
  const colors = [];
  for (const slot of Object.values(pearlData.slotMap)) {
    if (slot.colorId) {
      const colorData = color[slot.colorId];
      colors.push(colorData ? colorData.value : "white");
    }
  }
  return colors.length > 0 ? colors : null;
};

const allHeroList = computed(() => {
  const heroes = Object.entries(roleHeroesData.value).map(([id, hero]) => {
    const heroInfo = HERO_DICT[hero.heroId] || {};
    return {
      id: Number(hero.heroId),
      name: heroInfo.name || `武将${hero.heroId}`,
      type: heroInfo.type || "未知",
      avatar: heroInfo.avatar || null,
      quality: getHeroQuality(Number(hero.heroId)),
      artifactId: hero.artifactId || null,
      attachmentUid: hero.attachmentUid || null,
      heroData: hero,
    };
  });

  const countryOrder = { 魏国: 1, 蜀国: 2, 吴国: 3, 群雄: 4 };
  const qualityOrder = { 红将: 1, 橙将: 2, 紫将: 3, 其他: 4 };

  return heroes.sort((a, b) => {
    const countryA = countryOrder[a.type] || 99;
    const countryB = countryOrder[b.type] || 99;
    if (countryA !== countryB) return countryA - countryB;

    const qualityA = qualityOrder[a.quality] || 99;
    const qualityB = qualityOrder[b.quality] || 99;
    if (qualityA !== qualityB) return qualityA - qualityB;

    return a.id - b.id;
  });
});

const filteredHeroList = computed(() => {
  let list = allHeroList.value;

  if (selectedQuality.value !== "全部") {
    list = list.filter((hero) => hero.quality === selectedQuality.value);
  }

  if (selectedCountry.value !== "全部") {
    list = list.filter((hero) => hero.type === selectedCountry.value);
  }

  if (heroSearchKeyword.value) {
    const keyword = heroSearchKeyword.value.toLowerCase();
    list = list.filter((hero) => hero.name.toLowerCase().includes(keyword));
  }

  return list;
});

const currentTeamHeroes = computed(() => {
  if (!currentTeamInfo.value) return [];
  const teamInfo = currentTeamInfo.value;
  return Object.entries(teamInfo)
    .map(([key, hero]) => {
      const heroData = roleHeroesData.value[String(hero?.heroId || hero?.id)];
      return {
        position: hero?.battleTeamSlot ?? Number(key),
        heroId: hero?.heroId || hero?.id,
        level: hero?.level || null,
        artifactId: hero?.artifactId || null,
        attachmentUid: hero?.attachmentUid || null,
        power: heroData?.power || null,
        attack: heroData?.attack || null,
        hp: heroData?.hp || null,
        speed: heroData?.speed || null,
      };
    })
    .filter((h) => h.heroId)
    .sort((a, b) => a.position - b.position);
});

const editingHeroes = computed(() => {
  if (Object.keys(editingTeamHeroes.value).length > 0) {
    return Object.entries(editingTeamHeroes.value)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([pos, hero]) => {
        const heroData = roleHeroesData.value[String(hero?.heroId)];
        return {
          position: Number(pos),
          heroId: hero?.heroId,
          level: hero?.level || null,
          artifactId: hero?.artifactId || null,
          attachmentUid: hero?.attachmentUid || null,
          power: heroData?.power || null,
          attack: heroData?.attack || null,
          hp: heroData?.hp || null,
          speed: heroData?.speed || null,
        };
      })
      .filter((h) => h.heroId);
  }
  return currentTeamHeroes.value;
});

const getFirstEmptySlot = () => {
  for (let i = 0; i < TEAM_SLOT_COUNT; i++) {
    const hero = editingHeroes.value.find((h) => h.position === i);
    if (!hero) return i;
  }
  return 0;
};

const getEmptySlotsFromTeamHeroes = (teamHeroes = []) => {
  const occupiedSlots = new Set(
    teamHeroes
      .map((hero) => Number(hero.position))
      .filter((position) => !Number.isNaN(position)),
  );

  const emptySlots = [];
  for (let i = 0; i < TEAM_SLOT_COUNT; i++) {
    if (!occupiedSlots.has(i)) {
      emptySlots.push(i);
    }
  }
  return emptySlots;
};

const findAttachmentTempRemovalCandidate = (
  teamHeroes = [],
  targetState,
  protectedHeroIds = new Set(),
) => {
  const targetHeroMap = new Map(
    (targetState?.heroes || []).map((hero) => [hero.heroId, hero]),
  );

  return [...teamHeroes]
    .filter((hero) => !protectedHeroIds.has(hero.heroId))
    .sort((a, b) => {
      const aTarget = targetHeroMap.get(a.heroId);
      const bTarget = targetHeroMap.get(b.heroId);
      const aExtra = !aTarget;
      const bExtra = !bTarget;
      if (aExtra !== bExtra) return aExtra ? -1 : 1;

      const aNeedsAttachment = !!aTarget?.attachmentUid;
      const bNeedsAttachment = !!bTarget?.attachmentUid;
      if (aNeedsAttachment !== bNeedsAttachment) {
        return aNeedsAttachment ? 1 : -1;
      }

      return (b.position ?? 0) - (a.position ?? 0);
    })[0] || null;
};

const getLineupsByTeamId = (teamId) => {
  return savedLineups.value.filter((lineup) => lineup.teamId === teamId);
};

const starTempleLineupOptions = computed(() =>
  savedLineups.value.map((lineup) => ({
    label: `槽位${lineup.teamId} · ${lineup.name}`,
    value: lineup.id,
  })),
);

const selectedStarTempleLineup = computed(() =>
  savedLineups.value.find(
    (lineup) => lineup.id === starTemple.value.selectedLineupId,
  ) || null,
);

const starTempleBossSummaries = computed(() => {
  const roleNMExt = starTemple.value.info?.roleNMExt || {};
  const fightCntMap = roleNMExt.starFightCntMap || {};
  const completeMap = roleNMExt.starBossCompleteMap || {};
  const rewardMap = roleNMExt.starRewardsClaimedMap || {};

  return STAR_TEMPLE_BOSS_IDS.map((bossId) => {
    const completedStarMap = completeMap[bossId] || completeMap[String(bossId)] || {};
    const starIndexes = Object.keys(completedStarMap)
      .filter((key) => completedStarMap[key])
      .map((key) => Number(key))
      .filter((value) => !Number.isNaN(value))
      .sort((a, b) => a - b);

    return {
      bossId,
      fightCount: Number(fightCntMap[bossId] ?? fightCntMap[String(bossId)] ?? 0),
      starIndexes,
      starCount: starIndexes.length,
      rewardClaimed: Boolean(
        rewardMap[bossId] ?? rewardMap[String(bossId)] ?? false,
      ),
    };
  });
});

const starTempleResetTimeText = computed(() => {
  const resetTime = Number(starTemple.value.info?.roleNMExt?.starResetTime || 0);
  if (!resetTime) return "";
  return new Date(resetTime * 1000).toLocaleString();
});

const formatStarDisplay = (starCount = 0) =>
  `${"★".repeat(Math.max(0, Math.min(3, starCount)))}${"☆".repeat(
    Math.max(0, 3 - Math.min(3, starCount)),
  )}`;

const toggleLineupExpand = (lineup) => {
  if (expandedLineup.value === lineup) {
    expandedLineup.value = null;
  } else {
    expandedLineup.value = lineup;
  }
};

const hasEditingChanges = computed(() => {
  if (Object.keys(editingTeamHeroes.value).length === 0) return false;
  const current = JSON.stringify(
    currentTeamHeroes.value
      .map((h) => `${h.position}:${h.heroId}`)
      .sort()
      .join(","),
  );
  const editing = JSON.stringify(
    editingHeroes.value
      .map((h) => `${h.position}:${h.heroId}`)
      .sort()
      .join(","),
  );
  return current !== editing;
});

const getHeroName = (heroId) => {
  if (!heroId) return null;
  return HERO_DICT[heroId]?.name || null;
};

const getHeroAvatar = (heroId) => {
  if (!heroId) return null;
  return HERO_DICT[heroId]?.avatar || null;
};

const formatTime = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const formatLevel = (level) => {
  if (!level) return "";
  return String(level);
};

const getAttrName = (attrId) => {
  return attrMap[attrId] || `属性${attrId}`;
};

const getEquipBonus = (partId) => {
  if (!selectedHeroEquipment.value || !selectedHeroEquipment.value[partId]) {
    return 0;
  }
  const equip = selectedHeroEquipment.value[partId];
  const bonusType =
    partId === 1
      ? "quenchAttackExt"
      : partId === 3
        ? "quenchDefenseExt"
        : "quenchHpExt";
  return equip[bonusType] || 0;
};

const getEquipSlots = (partId) => {
  if (!selectedHeroEquipment.value || !selectedHeroEquipment.value[partId]) {
    return [];
  }
  const quenches = selectedHeroEquipment.value[partId].quenches || {};
  const slotList = [];
  const slotKeys = Object.keys(quenches).sort((a, b) => Number(a) - Number(b));

  for (const key of slotKeys) {
    const slotId = Number(key);
    const slot = quenches[key];
    slotList.push({
      id: slotId,
      attrId: slot.attrId || null,
      attrNum: slot.attrNum || 0,
      isLocked: slot.isLocked || slot.locked || false,
      colorId: slot.colorId || 0,
    });
  }

  return slotList;
};

const showHeroRefineModal = async (hero) => {
  refineModalTitle.value = `${getHeroName(hero.heroId) || `武将${hero.heroId}`} - 装备洗练`;
  refineModalVisible.value = true;
  refineModalLoading.value = true;
  selectedHeroEquipment.value = null;

  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    refineModalLoading.value = false;
    return;
  }

  const tokenId = token.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected") {
    message.error("WebSocket未连接，无法获取装备信息");
    refineModalLoading.value = false;
    return;
  }

  try {
    const heroData = allHeroesData.value[String(hero.heroId)];
    if (heroData?.equipment) {
      selectedHeroEquipment.value = heroData.equipment;
    } else {
      const roleInfo = await tokenStore.sendMessageWithPromise(
        tokenId,
        "role_getroleinfo",
        {},
      );
      const role = roleInfo?.role || roleInfo;
      const heroes = role?.heroes || {};
      allHeroesData.value = heroes;

      const currentHero = heroes[String(hero.heroId)];
      selectedHeroEquipment.value = currentHero?.equipment || null;
    }

    if (!selectedHeroEquipment.value) {
      message.warning("未找到该武将的装备数据");
    }
  } catch (error) {
  } finally {
    refineModalLoading.value = false;
  }
  await delay(COMMAND_DELAY);
};

const openExchangeModal = (hero) => {
  exchangeMode.value = "exchange";
  exchangeHero.value = hero;
  exchangeTargetHeroId.value = null;
  heroSearchKeyword.value = "";
  selectedQuality.value = "全部";
  selectedCountry.value = "全部";
  exchangeModalVisible.value = true;
};

const openAddHeroModal = () => {
  if (editingHeroes.value.length >= 5) {
    message.warning("阵容已满，无法上阵更多英雄");
    return;
  }
  exchangeMode.value = "add";
  exchangeHero.value = null;
  exchangeTargetHeroId.value = null;
  heroSearchKeyword.value = "";
  selectedQuality.value = "全部";
  selectedCountry.value = "全部";
  exchangeModalVisible.value = true;
};

const selectExchangeHero = (hero) => {
  exchangeTargetHeroId.value = hero.id;
};

const confirmHeroAction = () => {
  if (!exchangeTargetHeroId.value) {
    message.warning("请选择武将");
    return;
  }

  if (Object.keys(editingTeamHeroes.value).length === 0) {
    currentTeamHeroes.value.forEach((h) => {
      editingTeamHeroes.value[h.position] = {
        heroId: h.heroId,
        level: h.level || null,
        artifactId: h.artifactId || null,
        attachmentUid: h.attachmentUid || null,
      };
    });
  }

  if (exchangeMode.value === "add") {
    const slot = getFirstEmptySlot();
    const targetHeroData =
      roleHeroesData.value[String(exchangeTargetHeroId.value)];
    const currentTeamHeroInfo = currentTeamInfo.value?.[slot];
    editingTeamHeroes.value[slot] = {
      heroId: exchangeTargetHeroId.value,
      level: currentTeamHeroInfo?.level || targetHeroData?.level || null,
      artifactId: targetHeroData?.artifactId || null,
      attachmentUid: targetHeroData?.attachmentUid || null,
    };
    message.success(
      `${getHeroName(exchangeTargetHeroId.value)} 已上阵到位置 ${slot + 1}`,
    );
  } else {
    if (!exchangeHero.value) {
      message.warning("请选择要更换的武将");
      return;
    }
    const originalArtifactId = exchangeHero.value.artifactId;
    const originalAttachmentUid = exchangeHero.value.attachmentUid;
    const targetHeroData =
      roleHeroesData.value[String(exchangeTargetHeroId.value)];
    editingTeamHeroes.value[exchangeHero.value.position] = {
      heroId: exchangeTargetHeroId.value,
      level: targetHeroData?.level || null,
      artifactId: originalArtifactId,
      attachmentUid: originalAttachmentUid,
    };
    message.success(
      `已将 ${getHeroName(exchangeHero.value.heroId)} 更换为 ${getHeroName(exchangeTargetHeroId.value)}`,
    );
  }

  exchangeModalVisible.value = false;
};

const removeHero = (hero) => {
  if (Object.keys(editingTeamHeroes.value).length === 0) {
    currentTeamHeroes.value.forEach((h) => {
      editingTeamHeroes.value[h.position] = {
        heroId: h.heroId,
        level: h.level || null,
        artifactId: h.artifactId || null,
        attachmentUid: h.attachmentUid || null,
      };
    });
  }

  delete editingTeamHeroes.value[hero.position];
  message.success(`${getHeroName(hero.heroId)} 已下阵`);
};

const onDragStart = (event, hero) => {
  draggedHeroId.value = hero.heroId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", JSON.stringify(hero));
};

const onDragEnd = () => {
  draggedHeroId.value = null;
  dragOverPosition.value = null;
};

const onDragOver = (event, hero) => {
  if (draggedHeroId.value !== hero.heroId) {
    dragOverPosition.value = hero.position;
  }
};

const onDragLeave = () => {
  dragOverPosition.value = null;
};

const onDrop = (event, targetHero) => {
  event.preventDefault();
  dragOverPosition.value = null;

  if (!draggedHeroId.value || draggedHeroId.value === targetHero.heroId) {
    return;
  }

  const draggedHero = editingHeroes.value.find(
    (h) => h.heroId === draggedHeroId.value,
  );
  if (!draggedHero) return;

  if (Object.keys(editingTeamHeroes.value).length === 0) {
    currentTeamHeroes.value.forEach((h) => {
      editingTeamHeroes.value[h.position] = {
        heroId: h.heroId,
        level: h.level || null,
        artifactId: h.artifactId || null,
        attachmentUid: h.attachmentUid || null,
      };
    });
  }

  const draggedPos = draggedHero.position;
  const targetPos = targetHero.position;

  const draggedHeroData = editingTeamHeroes.value[draggedPos];
  const targetHeroData = editingTeamHeroes.value[targetPos];

  editingTeamHeroes.value[draggedPos] = targetHeroData;
  editingTeamHeroes.value[targetPos] = draggedHeroData;

  message.success(
    `已将 ${getHeroName(draggedHero.heroId)} 与 ${getHeroName(targetHero.heroId)} 交换位置`,
  );

  draggedHeroId.value = null;
};

const loadSavedLineups = async () => {
  const accountId = getSelectedAccountId();
  if (!accountId) {
    savedLineups.value = [];
    return;
  }

  const localLineups = readSavedLineupsFromLocalStorage(accountId);
  savedLineups.value = localLineups;
  lineupsLoading.value = true;

  try {
    const backendLineups = await fetchSavedLineupsFromBackend(accountId);
    if (getSelectedAccountId() !== accountId) return;

    if (backendLineups.length === 0 && localLineups.length > 0) {
      savedLineups.value = localLineups;
      persistLineupsToLocalStorage(localLineups, accountId);
      await queueSyncSavedLineupsToBackend({
        accountId,
        lineups: localLineups,
        silent: true,
      });
      return;
    }

    savedLineups.value = backendLineups;
    persistLineupsToLocalStorage(backendLineups, accountId);
  } catch (error) {
    console.error("加载保存的阵容失败:", error);
    if (getSelectedAccountId() === accountId) {
      savedLineups.value = localLineups;
    }
  } finally {
    if (getSelectedAccountId() === accountId) {
      lineupsLoading.value = false;
    }
  }
};

const saveLineupsToStorage = () => {
  const accountId = getSelectedAccountId();
  const normalizedLineups = normalizeSavedLineupList(savedLineups.value);
  savedLineups.value = normalizedLineups;
  persistLineupsToLocalStorage(normalizedLineups, accountId);
  void queueSyncSavedLineupsToBackend({
    accountId,
    lineups: normalizedLineups,
    silent: true,
  });
};

const refreshTeamInfo = async (options = {}) => {
  const { force = false, silent = false } = options;
  const now = Date.now();
  if (!force && now - lastRefreshTime < REFRESH_DEBOUNCE) {
    return;
  }
  lastRefreshTime = now;

  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    return;
  }

  const tokenId = token.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected") {
    message.error("WebSocket未连接，无法获取数据");
    return;
  }

  loading.value = true;
  try {
    let presetTeamResult = await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_getinfo",
      {},
    );

    const teamsFromGame =
      presetTeamResult?.presetTeamInfo?.presetTeamInfo || {};
    const gameTeamIds = Object.keys(teamsFromGame)
      .filter((k) => /^\d+$/.test(k))
      .map(Number)
      .sort((a, b) => a - b);
    const availableTeamIds = gameTeamIds.length
      ? gameTeamIds
      : [1, 2, 3, 4, 5, 6];

    let targetTeamId = presetTeamResult?.presetTeamInfo?.useTeamId || 1;
    if (!availableTeamIds.includes(targetTeamId)) {
      targetTeamId = availableTeamIds[0];
    }

    const currentIndex = availableTeamIds.indexOf(targetTeamId);
    const otherTeamId =
      availableTeamIds[currentIndex === 0 ? 1 : currentIndex - 1] ||
      availableTeamIds[0];

    if (otherTeamId !== targetTeamId && availableTeamIds.length > 1) {
      await tokenStore.sendMessageWithPromise(tokenId, "presetteam_saveteam", {
        teamId: otherTeamId,
      });

      await delay(COMMAND_DELAY);

      await tokenStore.sendMessageWithPromise(tokenId, "presetteam_saveteam", {
        teamId: targetTeamId,
      });

      await delay(COMMAND_DELAY);
    }

    presetTeamResult = await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_getinfo",
      {},
    );
    await delay(COMMAND_DELAY);

    const roleInfo = await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
    );
    await delay(COMMAND_DELAY);
    const role = roleInfo?.role || roleInfo;
    roleHeroesData.value = role?.heroes || {};
    allHeroesData.value = role?.heroes || {};
    artifactBooks.value = role?.artifactBooks || {};
    pearlMap.value = role?.pearlMap || {};

    presetTeamData.value = presetTeamResult?.presetTeamInfo;

    if (presetTeamResult) {
      tokenStore.$patch((state) => {
        state.gameData = {
          ...(state.gameData ?? {}),
          presetTeam: presetTeamResult,
        };
      });
    }

    if (presetTeamData.value) {
      const updatedTeamsFromGame = presetTeamData.value.presetTeamInfo || {};
      currentTeamId.value = presetTeamData.value.useTeamId || 1;
      availableTeams.value = availableTeamIds;

      const currentTeam =
        updatedTeamsFromGame[currentTeamId.value] ||
        updatedTeamsFromGame[String(currentTeamId.value)];
      currentTeamInfo.value = currentTeam?.teamInfo || {};
      editingTeamHeroes.value = {};
    }

    if (!silent) {
      message.success("数据已刷新");
    }
  } catch (error) {
    if (!silent) {
      message.error(`获取数据失败: ${error.message}`);
    } else {
      console.warn("[LineupHelper] 自动刷新阵容数据失败:", error);
    }
  } finally {
    loading.value = false;
  }
};

const saveCurrentLineup = async () => {
  if (editingHeroes.value.length === 0) {
    message.warning("当前阵容为空，无法保存");
    return;
  }

  if (savedLineups.value.length >= MAX_SAVED_LINEUPS) {
    message.warning(
      `每个账号最多只能保存 ${MAX_SAVED_LINEUPS} 套阵容，请先删除旧阵容`,
    );
    return;
  }

  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    return;
  }

  const tokenId = token.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected") {
    message.error("WebSocket未连接，无法保存阵容");
    return;
  }

  loading.value = true;

  try {
    const roleInfo = await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
    );
    await delay(COMMAND_DELAY);

    const role = roleInfo?.role || roleInfo;
    const legionResearch = role?.legionResearch || {};
    const currentArtifactBooks = role?.artifactBooks || {};
    const currentHeroes = role?.heroes || {};
    const pearlMap = role?.pearlMap || {};

    const presetTeamResult = await tokenStore.sendMessageWithPromise(
      tokenId,
      "presetteam_getinfo",
      {},
    );
    await delay(COMMAND_DELAY);

    const presetInfo =
      presetTeamResult?.presetTeamInfo?.presetTeamInfo ||
      presetTeamResult?.presetTeamInfo ||
      {};
    const teamData =
      presetInfo[currentTeamId.value] ||
      presetInfo[String(currentTeamId.value)];
    const weaponId = teamData?.weapon?.weaponId || null;
    const teamInfo = teamData?.teamInfo || {};

    const lineupName = `阵容${currentTeamId.value} - ${new Date().toLocaleTimeString()}`;

    const fishAssignments = {};
    for (const [fishId, book] of Object.entries(currentArtifactBooks)) {
      if (book.artifactId && book.artifactId !== -1) {
        fishAssignments[book.artifactId] = Number(fishId);
      }
    }

    const heroesData = editingHeroes.value.map((hero) => {
      const heroData = currentHeroes[String(hero.heroId)];
      const artifactId = heroData?.artifactId || hero.artifactId || null;
      const teamHeroInfo = teamInfo[hero.position];
      const fishId = artifactId ? fishAssignments[artifactId] : null;
      const pearlId = teamHeroInfo?.pearlId || null;
      const pearlData = pearlMap[pearlId];
      const slotMap = pearlData?.slotMap || null;
      return {
        position: hero.position,
        heroId: hero.heroId,
        level: teamHeroInfo?.level || null,
        attachmentUid: hero.attachmentUid || null,
        fishId: fishId || null,
        pearlId: pearlId,
        skillId: pearlData?.skillId || null,
        slotMap: slotMap,
        power: heroData?.power || null,
        attack: heroData?.attack || null,
        hp: heroData?.hp || null,
        speed: heroData?.speed || null,
      };
    });

    savedLineups.value.unshift({
      id: generateLineupId(),
      name: lineupName,
      heroes: heroesData,
      teamId: currentTeamId.value,
      savedAt: Date.now(),
      applying: false,
      legionResearch: legionResearch,
      weaponId: weaponId,
    });

    saveLineupsToStorage();
    message.success(
      `阵容已保存: ${lineupName}（${savedLineups.value.length}/${MAX_SAVED_LINEUPS}）`,
    );
  } catch (error) {
    message.error(`保存阵容失败: ${error.message}`);
  } finally {
    loading.value = false;
  }
};

const LEVEL_ORDER_THRESHOLDS = [
  { level: 100, order: 1 },
  { level: 200, order: 2 },
  { level: 300, order: 3 },
  { level: 500, order: 4 },
  { level: 700, order: 5 },
  { level: 900, order: 6 },
  { level: 1100, order: 7 },
  { level: 1300, order: 8 },
  { level: 1500, order: 9 },
  { level: 1800, order: 10 },
  { level: 2100, order: 11 },
  { level: 2400, order: 12 },
  { level: 2800, order: 13 },
  { level: 3200, order: 14 },
  { level: 3600, order: 15 },
  { level: 4000, order: 16 },
  { level: 4500, order: 17 },
  { level: 5000, order: 18 },
  { level: 5500, order: 19 },
];

const UPGRADE_OPTIONS = [50, 10, 5, 1];

const getNextOrderLevel = (currentLevel) => {
  for (const threshold of LEVEL_ORDER_THRESHOLDS) {
    if (currentLevel < threshold.level) {
      return threshold.level;
    }
  }
  return null;
};

const getOrder = (level) => {
  let order = 0;
  for (const threshold of LEVEL_ORDER_THRESHOLDS) {
    if (level >= threshold.level) {
      order = threshold.order;
    } else {
      break;
    }
  }
  return order;
};

const applyHeroLevel = async (
  tokenId,
  heroId,
  targetLevel,
  currentLevel,
  currentOrder = 0,
  slot = -1,
) => {
  if (!targetLevel || targetLevel <= 0)
    return { success: true, message: "无目标等级" };

  let actualCurrentLevel = currentLevel;
  let actualCurrentOrder = currentOrder;

  if (actualCurrentLevel > targetLevel) {
    if (slot >= 0) {
      try {
        await tokenStore.sendMessageWithPromise(tokenId, "hero_gobackbattle", {
          slot,
        });
      } catch (err) {}
      await delay(COMMAND_DELAY);
    }

    try {
      const result = await tokenStore.sendMessageWithPromise(
        tokenId,
        "hero_rebirth",
        {
          heroId,
        },
      );
      if (result?.role?.heroes?.[heroId]?.level !== undefined) {
        actualCurrentLevel = result.role.heroes[heroId].level;
      } else {
        actualCurrentLevel = 1;
      }
      if (result?.role?.heroes?.[heroId]?.order !== undefined) {
        actualCurrentOrder = result.role.heroes[heroId].order;
      } else {
        actualCurrentOrder = 0;
      }
    } catch (err) {}
    await delay(COMMAND_DELAY);

    if (slot >= 0) {
      try {
        await tokenStore.sendMessageWithPromise(tokenId, "hero_gointobattle", {
          heroId,
          slot,
        });
      } catch (err) {}
      await delay(COMMAND_DELAY);
    }
  }

  const expectedOrder = getOrder(actualCurrentLevel);
  if (actualCurrentOrder < expectedOrder) {
    try {
      const result = await tokenStore.sendMessageWithPromise(
        tokenId,
        "hero_heroupgradeorder",
        {
          heroId,
        },
      );
      if (result?.role?.heroes?.[heroId]?.order !== undefined) {
        actualCurrentOrder = result.role.heroes[heroId].order;
      } else {
        actualCurrentOrder = expectedOrder;
      }
    } catch (err) {}
    await delay(COMMAND_DELAY);
  }

  if (actualCurrentLevel >= targetLevel) {
    return { success: true, message: "等级已达标" };
  }

  while (actualCurrentLevel < targetLevel) {
    const nextOrderLevel = getNextOrderLevel(actualCurrentLevel);
    const maxAllowed = nextOrderLevel
      ? nextOrderLevel - actualCurrentLevel
      : targetLevel - actualCurrentLevel;
    const remaining = targetLevel - actualCurrentLevel;
    const stepLimit = Math.min(maxAllowed, remaining);

    let upgradeNum = 1;
    for (const num of UPGRADE_OPTIONS) {
      if (num <= stepLimit) {
        upgradeNum = num;
        break;
      }
    }

    try {
      await tokenStore.sendMessageWithPromise(
        tokenId,
        "hero_heroupgradelevel",
        {
          heroId,
          upgradeNum,
        },
      );
      actualCurrentLevel += upgradeNum;
    } catch (err) {}
    await delay(COMMAND_DELAY);

    if (nextOrderLevel && actualCurrentLevel >= nextOrderLevel) {
      try {
        const result = await tokenStore.sendMessageWithPromise(
          tokenId,
          "hero_heroupgradeorder",
          {
            heroId,
          },
        );
        if (result?.role?.heroes?.[heroId]?.order !== undefined) {
          actualCurrentOrder = result.role.heroes[heroId].order;
        } else {
          actualCurrentOrder++;
        }
      } catch (err) {}
      await delay(COMMAND_DELAY);
    }
  }

  return { success: true, message: `等级已升至 ${actualCurrentLevel}` };
};

const applyLineup = async (lineup, options = {}) => {
  const { silentSuccess = false } = options;
  if (lineup?.applying || activeApplyLineupId.value) {
    const runningLineup = savedLineups.value.find(
      (item) => item.id === activeApplyLineupId.value,
    );
    const runningName = runningLineup?.name || lineup?.name || "当前阵容";
    addApplyLog("warn", `忽略重复应用请求：${runningName}`);
    message.warning(`阵容 "${runningName}" 正在应用，请稍候`);
    return false;
  }

  if (state.value.isRunning) {
    message.warning("当前有操作执行中，请稍候再试");
    return false;
  }

  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    return false;
  }

  const tokenId = token.id;
  try {
    const connection = await tokenStore.ensureWebSocketConnected(tokenId, 12000);
    if (!connection?.client) {
      message.error("WebSocket未连接，无法应用阵容");
      return false;
    }

    try {
      await tokenStore.ensureProtocolReady(tokenId, "lineup-apply-start");
    } catch (error) {
      console.warn("[无限阵容] 应用前协议预热失败，继续按当前连接执行:", error);
    }
  } catch (error) {
    const messageText = getLineupErrorMessage(error) || "WebSocket未连接，无法应用阵容";
    message.error(messageText);
    return false;
  }

  if (lineup.teamId !== currentTeamId.value) {
    message.warning(
      `此阵容仅适用于阵容槽位 ${lineup.teamId}，当前槽位为 ${currentTeamId.value}`,
    );
    return false;
  }

  lineup.applying = true;
  activeApplyLineupId.value = lineup.id || null;
  state.value.isRunning = true;
  clearApplyLogs();
  addApplyLog(
    "info",
    `开始应用阵容：${lineup.name}（槽位${currentTeamId.value}）`,
  );

  try {
    const ctx = {
      tokenId,
      teamId: currentTeamId.value,
      lineup,
      targetState: null,
      initialSnapshot: null,
      currentSnapshot: null,
    };

    const steps = [
      {
        key: "validate",
        title: "前置校验",
        refreshSnapshot: false,
        run: async () => {},
        verify: async () => verifySuccess("前置校验通过"),
      },
      {
        key: "load-snapshot",
        title: "加载当前快照",
        refreshSnapshot: false,
        retry: 2,
        run: async (stepCtx) => {
          addApplyLog("info", "读取角色与阵容快照");
          const snapshot = await loadLineupSnapshot(stepCtx.tokenId, stepCtx.teamId);
          stepCtx.initialSnapshot = snapshot;
          stepCtx.currentSnapshot = snapshot;
        },
        verify: async (stepCtx) => {
          return stepCtx.currentSnapshot?.teamHeroes
            ? verifySuccess("当前快照加载完成")
            : verifyFailure("当前快照加载失败");
        },
      },
      {
        key: "build-target",
        title: "构建目标阵容",
        refreshSnapshot: false,
        run: async (stepCtx) => {
          stepCtx.targetState = buildTargetState(stepCtx.lineup);
          addApplyLog(
            "info",
            `目标阵容已构建，共 ${stepCtx.targetState.heroes.length} 名武将`,
          );
        },
        verify: async (stepCtx) => verifyTargetState(stepCtx.targetState),
      },
      {
        key: "sync-attachments",
        title: "处理挂件归属",
        retry: 1,
        run: async (stepCtx) => {
          const { heroesMap, teamHeroes } = stepCtx.currentSnapshot;
          const attachmentToHero = { ...stepCtx.currentSnapshot.attachmentOwnerMap };
          const workingTeamHeroes = teamHeroes.map((hero) => ({ ...hero }));

          for (const targetHero of stepCtx.targetState.heroes) {
            if (!targetHero.attachmentUid) continue;

            const currentHolderId = attachmentToHero[targetHero.attachmentUid];
            if (!currentHolderId || currentHolderId === targetHero.heroId) {
              continue;
            }

            const stagedHeroIds = [currentHolderId, targetHero.heroId].filter(
              (heroId) =>
                !workingTeamHeroes.some((hero) => hero.heroId === heroId),
            );

            if (stagedHeroIds.length > 0) {
              const protectedHeroIds = new Set([currentHolderId, targetHero.heroId]);

              while (
                getEmptySlotsFromTeamHeroes(workingTeamHeroes).length < stagedHeroIds.length
              ) {
                const removalCandidate = findAttachmentTempRemovalCandidate(
                  workingTeamHeroes,
                  stepCtx.targetState,
                  protectedHeroIds,
                );

                if (!removalCandidate) {
                  addApplyLog(
                    "warn",
                    `挂件预处理失败：无法为 ${getHeroName(targetHero.heroId) || targetHero.heroId} 腾出临时空位`,
                  );
                  break;
                }

                try {
                  addApplyLog(
                    "info",
                    `挂件冲突预处理：临时下阵 ${getHeroName(removalCandidate.heroId) || removalCandidate.heroId}（位置${removalCandidate.position + 1}）`,
                  );
                  await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "hero_gobackbattle",
                    {
                      slot: removalCandidate.position,
                    },
                  );
                  const removalIndex = workingTeamHeroes.findIndex(
                    (hero) =>
                      hero.heroId === removalCandidate.heroId &&
                      hero.position === removalCandidate.position,
                  );
                  if (removalIndex !== -1) {
                    workingTeamHeroes.splice(removalIndex, 1);
                  }
                } catch (err) {
                  addApplyLog(
                    "warn",
                    `临时下阵 ${getHeroName(removalCandidate.heroId) || removalCandidate.heroId} 失败：${err.message}`,
                    err,
                  );
                  break;
                }
                await delay(COMMAND_DELAY);
              }

              let emptySlots = getEmptySlotsFromTeamHeroes(workingTeamHeroes);
              if (emptySlots.length < stagedHeroIds.length) {
                continue;
              }

              let stageFailed = false;
              for (const stagedHeroId of stagedHeroIds) {
                const stageSlot = emptySlots.shift();
                if (stageSlot === undefined) {
                  stageFailed = true;
                  break;
                }

                try {
                  addApplyLog(
                    "info",
                    `挂件冲突预处理：临时上阵 ${getHeroName(stagedHeroId) || stagedHeroId} -> 位置${stageSlot + 1}`,
                  );
                  await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "hero_gointobattle",
                    {
                      heroId: stagedHeroId,
                      slot: stageSlot,
                    },
                  );
                  workingTeamHeroes.push({
                    heroId: stagedHeroId,
                    position: stageSlot,
                  });
                } catch (err) {
                  addApplyLog(
                    "warn",
                    `临时上阵 ${getHeroName(stagedHeroId) || stagedHeroId} 失败：${err.message}`,
                    err,
                  );
                  stageFailed = true;
                }
                await delay(COMMAND_DELAY);
              }

              if (stageFailed) {
                continue;
              }
            }

            try {
              addApplyLog(
                "info",
                `执行挂件交换：${getHeroName(currentHolderId) || currentHolderId} -> ${getHeroName(targetHero.heroId) || targetHero.heroId}`,
              );
              await tokenStore.sendMessageWithPromise(tokenId, "hero_exchange", {
                heroId: currentHolderId,
                targetHeroId: targetHero.heroId,
              });
            } catch (err) {
              addApplyLog(
                "warn",
                `挂件交换失败：${err.message}`,
                err,
              );
            }
            await delay(COMMAND_DELAY);

            const holderAttachmentUid = normalizeId(
              heroesMap[currentHolderId]?.attachmentUid,
            );
            const targetAttachmentUid = normalizeId(
              heroesMap[targetHero.heroId]?.attachmentUid,
            );

            if (holderAttachmentUid) {
              attachmentToHero[holderAttachmentUid] = targetHero.heroId;
            }
            if (targetAttachmentUid) {
              attachmentToHero[targetAttachmentUid] = currentHolderId;
            }

            heroesMap[currentHolderId] = {
              ...(heroesMap[currentHolderId] || {}),
              attachmentUid: targetAttachmentUid,
            };
            heroesMap[targetHero.heroId] = {
              ...(heroesMap[targetHero.heroId] || {}),
              attachmentUid: holderAttachmentUid,
            };
          }
        },
        verify: async (stepCtx) =>
          verifyAttachmentStep(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "remove-extra-heroes",
        title: "下阵多余武将",
        retry: 2,
        ensureTeamFreshSnapshot: true,
        run: async (stepCtx) => {
          const targetHeroIds = new Set(
            stepCtx.targetState.heroes.map((hero) => hero.heroId),
          );
          for (const hero of stepCtx.currentSnapshot.teamHeroes) {
            if (targetHeroIds.has(hero.heroId)) continue;
            try {
              addApplyLog(
                "info",
                `下阵多余武将：${getHeroName(hero.heroId) || hero.heroId}（位置${hero.position + 1}）`,
              );
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_gobackbattle",
                {
                  slot: hero.position,
                },
              );
            } catch (err) {
              addApplyLog(
                "warn",
                `下阵 ${getHeroName(hero.heroId) || hero.heroId} 失败：${err.message}`,
                err,
              );
            }
            await delay(COMMAND_DELAY);
          }
        },
        verify: async (stepCtx) =>
          verifyNoExtraHeroesStep(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "add-missing-heroes",
        title: "补齐目标武将",
        retry: 2,
        ensureTeamFreshSnapshot: true,
        run: async (stepCtx) => {
          const currentHeroIds = new Set(
            stepCtx.currentSnapshot.teamHeroes.map((hero) => hero.heroId),
          );
          const occupiedSlots = new Set(
            stepCtx.currentSnapshot.teamHeroes.map((hero) => hero.position),
          );
          for (const targetHero of stepCtx.targetState.heroes) {
            if (currentHeroIds.has(targetHero.heroId)) continue;

            const availableSlot = getEmptySlotsFromTeamHeroes(
              [...occupiedSlots].map((position) => ({ position })),
            )[0];
            if (availableSlot === undefined) {
              addApplyLog(
                "warn",
                `补位失败：当前没有可用空位给 ${getHeroName(targetHero.heroId) || targetHero.heroId}`,
              );
              continue;
            }

            try {
              addApplyLog(
                "info",
                `上阵目标武将：${getHeroName(targetHero.heroId) || targetHero.heroId} -> 临时位置${availableSlot + 1}（目标位置${targetHero.position + 1}）`,
              );
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_gointobattle",
                {
                  heroId: targetHero.heroId,
                  slot: availableSlot,
                },
              );
              currentHeroIds.add(targetHero.heroId);
              occupiedSlots.add(availableSlot);
            } catch (err) {
              addApplyLog(
                "warn",
                `上阵 ${getHeroName(targetHero.heroId) || targetHero.heroId} 失败：${err.message}`,
                err,
              );
            }
            await delay(COMMAND_DELAY);
          }
        },
        verify: async (stepCtx) =>
          verifyAllTargetHeroesPresent(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "fix-positions",
        title: "校正站位",
        retry: 2,
        ensureTeamFreshSnapshot: true,
        run: async (stepCtx) => {
          const currentHeroes = stepCtx.currentSnapshot.teamHeroes;
          for (const targetHero of stepCtx.targetState.heroes) {
            const currentHero = currentHeroes.find(
              (hero) => hero.heroId === targetHero.heroId,
            );
            if (!currentHero || currentHero.position === targetHero.position) {
              continue;
            }

            try {
              addApplyLog(
                "info",
                `调整站位：${getHeroName(targetHero.heroId) || targetHero.heroId} ${currentHero.position + 1} -> ${targetHero.position + 1}`,
              );
              await tokenStore.sendMessageWithPromise(
                tokenId,
                "hero_gobackbattle",
                {
                  slot: currentHero.position,
                },
              );
              await delay(COMMAND_DELAY);
              try {
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "hero_gointobattle",
                  {
                    heroId: targetHero.heroId,
                    slot: targetHero.position,
                  },
                );
              } catch (err) {
                addApplyLog(
                  "warn",
                  `重新上阵 ${getHeroName(targetHero.heroId) || targetHero.heroId} 失败：${err.message}`,
                  err,
                );
              }
              await delay(COMMAND_DELAY);
            } catch (err) {
              addApplyLog(
                "warn",
                `调整站位前下阵 ${getHeroName(targetHero.heroId) || targetHero.heroId} 失败：${err.message}`,
                err,
              );
            }
          }
        },
        verify: async (stepCtx) =>
          verifyHeroPositions(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "sync-levels",
        title: "同步武将等级",
        retry: 1,
        run: async (stepCtx) => {
          let levelApplied = 0;
          for (const targetHero of stepCtx.targetState.heroes) {
            if (!targetHero.level || targetHero.level <= 0) continue;

            const heroData = stepCtx.currentSnapshot.heroesMap[targetHero.heroId];
            const currentLevel = heroData?.level || 1;
            const currentOrder = heroData?.order || 0;

            if (currentLevel === targetHero.level) continue;

            addApplyLog(
              "info",
              `同步等级：${getHeroName(targetHero.heroId) || targetHero.heroId} ${currentLevel} -> ${targetHero.level}`,
            );
            const result = await applyHeroLevel(
              tokenId,
              targetHero.heroId,
              targetHero.level,
              currentLevel,
              currentOrder,
              targetHero.position,
            );

            if (result.success) {
              levelApplied++;
            }
          }

          if (levelApplied > 0) {
            message.success(`已应用 ${levelApplied} 个武将等级配置`);
          }
        },
        verify: async (stepCtx) =>
          verifyHeroLevels(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "sync-artifacts",
        title: "同步鱼灵",
        retry: 1,
        run: async (stepCtx) => {
          let fishApplied = 0;
          for (const targetHero of stepCtx.targetState.heroes) {
            if (!targetHero.fishId && !targetHero.pearlId) continue;

            let artifactId = null;
            let pearlId = targetHero.pearlId || 0;

            if (targetHero.fishId) {
              artifactId = stepCtx.currentSnapshot.fishToArtifactMap[targetHero.fishId];
            }

            if (!artifactId && targetHero.pearlId) {
              const pearlData = stepCtx.currentSnapshot.pearlMap[targetHero.pearlId];
              if (pearlData?.artifactId && pearlData.artifactId !== -1) {
                artifactId = pearlData.artifactId;
              }
            }

            artifactId = normalizeId(artifactId);
            if (!artifactId) continue;

            const currentHolderId =
              stepCtx.currentSnapshot.artifactOwnerMap[artifactId];

            if (currentHolderId === targetHero.heroId) {
              continue;
            }

            if (currentHolderId) {
              try {
                addApplyLog(
                  "info",
                  `卸下鱼灵：${getHeroName(currentHolderId) || currentHolderId}`,
                );
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "artifact_unload",
                  {
                    heroId: currentHolderId,
                  },
                );
              } catch (err) {
                addApplyLog(
                  "warn",
                  `卸下鱼灵失败：${err.message}`,
                  err,
                );
              }
              await delay(COMMAND_DELAY);
            }

            try {
              addApplyLog(
                "info",
                `装备鱼灵：${getHeroName(targetHero.heroId) || targetHero.heroId} -> artifact ${artifactId}, pearl ${pearlId || 0}`,
              );
              await tokenStore.sendMessageWithPromise(tokenId, "artifact_load", {
                heroId: targetHero.heroId,
                itemId: artifactId,
                pearlId: pearlId,
              });
              fishApplied++;
            } catch (err) {
              addApplyLog(
                "warn",
                `装备鱼灵失败：${err.message}`,
                err,
              );
            }
            await delay(COMMAND_DELAY);
          }

          if (fishApplied > 0) {
            message.success(`已应用 ${fishApplied} 个鱼灵配置`);
          }
        },
        verify: async (stepCtx) =>
          verifyHeroArtifacts(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "sync-pearl-skills",
        title: "同步鱼珠技能",
        retry: 2,
        run: async (stepCtx) => {
          let skillApplied = 0;
          const latestPearlMap = JSON.parse(
            JSON.stringify(stepCtx.currentSnapshot.pearlMap || {}),
          );
          const processedPearlIds = new Set();
          const pearlIdsToHandle = stepCtx.targetState.heroes
            .filter((hero) => hero.pearlId)
            .map((hero) => hero.pearlId);

          for (const pearlId of pearlIdsToHandle) {
            if (processedPearlIds.has(pearlId)) continue;

            const targetHero = stepCtx.targetState.heroes.find(
              (hero) => hero.pearlId === pearlId,
            );
            const currentPearlData = latestPearlMap[pearlId];
            const currentSkillId = normalizePearlSkillId(
              currentPearlData?.skillId,
            );
            const targetSkillId = normalizePearlSkillId(targetHero?.skillId);

            if (!targetSkillId) {
              if (currentSkillId) {
                try {
                  addApplyLog("info", `卸下鱼珠技能：pearl ${pearlId}`);
                  await tokenStore.sendMessageWithPromise(
                    tokenId,
                    "pearl_unloadskill",
                    {
                      pearlId,
                    },
                  );
                  skillApplied++;
                  processedPearlIds.add(pearlId);
                  if (latestPearlMap[pearlId]) {
                    latestPearlMap[pearlId].skillId = null;
                  }
                } catch (err) {
                  addApplyLog("warn", `卸下鱼珠技能失败：${err.message}`, err);
                }
                await delay(COMMAND_DELAY);
              }
              processedPearlIds.add(pearlId);
              continue;
            }

            if (currentSkillId === targetSkillId) {
              processedPearlIds.add(pearlId);
              continue;
            }

            const holderPearlId = Object.keys(latestPearlMap).find((pid) => {
              if (Number(pid) === pearlId) return false;
              const data = latestPearlMap[pid];
              return normalizeId(data?.skillId) === targetSkillId;
            });

            if (holderPearlId && !processedPearlIds.has(Number(holderPearlId))) {
              try {
                addApplyLog(
                  "info",
                  `交换鱼珠技能：pearl ${pearlId} <-> ${Number(holderPearlId)}`,
                );
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "pearl_exchangeskill",
                  {
                    pearlId1: pearlId,
                    pearlId2: Number(holderPearlId),
                  },
                );
                skillApplied += 2;
                processedPearlIds.add(pearlId);
                processedPearlIds.add(Number(holderPearlId));
                const pearl1SkillId = normalizeId(
                  normalizePearlSkillId(latestPearlMap[pearlId]?.skillId),
                );
                const pearl2SkillId = normalizeId(
                  normalizePearlSkillId(
                    latestPearlMap[Number(holderPearlId)]?.skillId,
                  ),
                );
                if (latestPearlMap[pearlId]) {
                  latestPearlMap[pearlId].skillId = pearl2SkillId;
                }
                if (latestPearlMap[Number(holderPearlId)]) {
                  latestPearlMap[Number(holderPearlId)].skillId = pearl1SkillId;
                }
              } catch (err) {
                addApplyLog("warn", `交换鱼珠技能失败：${err.message}`, err);
              }
              await delay(COMMAND_DELAY);
            } else {
              try {
                addApplyLog(
                  "info",
                  `替换鱼珠技能：pearl ${pearlId} -> skill ${targetSkillId}`,
                );
                await tokenStore.sendMessageWithPromise(
                  tokenId,
                  "pearl_replaceskill",
                  {
                    pearlId,
                    skillId: targetSkillId,
                  },
                );
                skillApplied++;
                processedPearlIds.add(pearlId);
                if (latestPearlMap[pearlId]) {
                  latestPearlMap[pearlId].skillId = targetSkillId;
                }
              } catch (err) {
                addApplyLog("warn", `替换鱼珠技能失败：${err.message}`, err);
              }
              await delay(COMMAND_DELAY);
            }
          }

          if (skillApplied > 0) {
            message.success(`已切换 ${skillApplied} 个鱼珠技能`);
          }
        },
        verify: async (stepCtx) =>
          verifyPearlSkills(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "sync-legion-research",
        title: "同步俱乐部科技",
        retry: 1,
        run: async (stepCtx) => {
          if (
            !stepCtx.targetState.legionResearch ||
            Object.keys(stepCtx.targetState.legionResearch).length === 0
          ) {
            return;
          }
          const syncResult = await syncLegionResearch(
            tokenId,
            stepCtx.targetState.legionResearch,
          );
          addApplyLog("info", `科技同步结果：${syncResult.message}`);
          if (
            syncResult.success &&
            syncResult.message !== "科技配置已匹配，无需调整"
          ) {
            message.success(syncResult.message);
          }
        },
        verify: async (stepCtx) =>
          verifyLegionResearchStep(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "sync-weapon",
        title: "同步玩具",
        retry: 1,
        run: async (stepCtx) => {
          const targetWeaponId = normalizeId(stepCtx.targetState.weaponId);
          if (targetWeaponId === null) return;
          if (normalizeId(stepCtx.currentSnapshot.weaponId) === targetWeaponId) {
            return;
          }

          try {
            addApplyLog("info", `切换玩具：${targetWeaponId}`);
            await tokenStore.sendMessageWithPromise(
              tokenId,
              "lordweapon_changedefaultweapon",
              {
                weaponId: targetWeaponId,
              },
            );
            message.success(
              `玩具已切换为: ${weapon[targetWeaponId] || targetWeaponId}`,
            );
          } catch (err) {
            addApplyLog("warn", `切换玩具失败：${err.message}`, err);
          }
          await delay(COMMAND_DELAY);
        },
        verify: async (stepCtx) =>
          verifyWeaponStep(stepCtx.currentSnapshot, stepCtx.targetState),
      },
      {
        key: "final-verify",
        title: "最终校验",
        ensureTeamFreshSnapshot: true,
        run: async () => {},
        verify: async (stepCtx) =>
          verifyFinalLineupState(stepCtx.currentSnapshot, stepCtx.targetState),
      },
    ];

    await executeLineupSteps(ctx, steps);
    lastRefreshTime = 0;
    await refreshTeamInfo();
    addApplyLog("info", `阵容 "${lineup.name}" 应用完成`);
    if (!silentSuccess) {
      message.success(`阵容 "${lineup.name}" 已应用`);
    }
    return true;
  } catch (error) {
    addApplyLog("error", `应用阵容失败：${error.message}`, error);
    message.error(`应用阵容失败: ${error.message}`);
    return false;
  } finally {
    lineup.applying = false;
    activeApplyLineupId.value = null;
    state.value.isRunning = false;
    state.value.currentStepKey = "";
    state.value.currentStepTitle = "";
    state.value.currentStepIndex = 0;
    state.value.totalSteps = 0;
  }
};

const showTechModal = (lineup) => {
  selectedTechData.value = lineup.legionResearch || null;
  techModalVisible.value = true;
};

const closeLineupActionDialog = () => {
  lineupActionDialog.value = {
    visible: false,
    mode: "rename",
    lineupIndex: -1,
    inputValue: "",
    targetName: "",
  };
};

const openRenameLineupDialog = async (index) => {
  const lineup = savedLineups.value[index];
  if (!lineup) return;
  lineupActionDialog.value = {
    visible: true,
    mode: "rename",
    lineupIndex: index,
    inputValue: lineup.name || "",
    targetName: lineup.name || "",
  };
  await nextTick();
};

const confirmRenameLineup = () => {
  const { lineupIndex, inputValue } = lineupActionDialog.value;
  const lineup = savedLineups.value[lineupIndex];
  const nextName = String(inputValue || "").trim();

  if (!lineup) {
    closeLineupActionDialog();
    return;
  }
  if (!nextName) {
    message.warning("请输入阵容名称");
    return;
  }

  lineup.name = nextName;
  saveLineupsToStorage();
  closeLineupActionDialog();
  message.success("阵容名称已更新");
};

const openDeleteLineupDialog = (index) => {
  const lineup = savedLineups.value[index];
  if (!lineup) return;
  lineupActionDialog.value = {
    visible: true,
    mode: "delete",
    lineupIndex: index,
    inputValue: "",
    targetName: lineup.name || "未命名阵容",
  };
};

const confirmDeleteLineup = () => {
  const { lineupIndex } = lineupActionDialog.value;
  const lineup = savedLineups.value[lineupIndex];
  if (!lineup) {
    closeLineupActionDialog();
    return;
  }

  savedLineups.value.splice(lineupIndex, 1);
  saveLineupsToStorage();
  if (expandedLineup.value === lineup) {
    expandedLineup.value = null;
  }
  closeLineupActionDialog();
  message.success("阵容已删除");
};

const handleApplySavedLineup = async (lineup) => {
  const success = await applyLineup(lineup);
  if (success) {
    savedLineupsModalVisible.value = false;
  }
};

const exportLineups = async () => {
  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    return;
  }

  const tokenId = token.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected") {
    message.error("WebSocket未连接，无法导出");
    return;
  }

  try {
    const roleInfo = await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
    );
    const role = roleInfo?.role || roleInfo;
    const roleId = role?.roleId || role?.id;

    if (!roleId) {
      message.error("无法获取角色ID");
      return;
    }

    const exportData = {
      roleId: roleId,
      exportTime: Date.now(),
      lineups: savedLineups.value,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `阵容配置_${roleId}_${new Date().toLocaleDateString().replace(/\//g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);

    message.success(`已导出 ${savedLineups.value.length} 个阵容`);
  } catch (error) {
    message.error(`导出失败: ${error.message}`);
  }
};

const importLineups = async ({ file }) => {
  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    return;
  }

  const tokenId = token.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected") {
    message.error("WebSocket未连接，无法导入");
    return;
  }

  try {
    const roleInfo = await tokenStore.sendMessageWithPromise(
      tokenId,
      "role_getroleinfo",
      {},
    );
    const role = roleInfo?.role || roleInfo;
    const currentRoleId = role?.roleId || role?.id;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);

        if (!importData.roleId || !importData.lineups) {
          message.error("无效的阵容文件格式");
          return;
        }

        const processImport = (lineupsToImport) => {
          const existingIds = new Set(savedLineups.value.map((l) => l.id));
          const newLineups = [];
          const duplicateLineups = [];

          for (const lineup of lineupsToImport) {
            if (lineup.id && existingIds.has(lineup.id)) {
              duplicateLineups.push(lineup);
            } else {
              newLineups.push({
                ...lineup,
                id: lineup.id || generateLineupId(),
                savedAt: Date.now(),
                applying: false,
              });
            }
          }

          const availableSlots = Math.max(
            0,
            MAX_SAVED_LINEUPS - (savedLineups.value.length - duplicateLineups.length),
          );
          const acceptedNewLineups = newLineups.slice(0, availableSlots);
          const skippedForLimit = Math.max(
            0,
            newLineups.length - acceptedNewLineups.length,
          );

          if (skippedForLimit > 0) {
            message.warning(
              `每个账号最多只能保存 ${MAX_SAVED_LINEUPS} 套阵容，已跳过 ${skippedForLimit} 个超出上限的阵容`,
            );
          }

          if (duplicateLineups.length > 0) {
            dialog.warning({
              title: "发现重复阵容",
              content: `发现 ${duplicateLineups.length} 个已存在的阵容，是否覆盖？`,
              positiveText: "覆盖",
              negativeText: "跳过重复",
              onPositiveClick: () => {
                for (const dupLineup of duplicateLineups) {
                  const index = savedLineups.value.findIndex(
                    (l) => l.id === dupLineup.id,
                  );
                  if (index !== -1) {
                    savedLineups.value[index] = {
                      ...dupLineup,
                      savedAt: Date.now(),
                      applying: false,
                    };
                  }
                }
                savedLineups.value = [
                  ...savedLineups.value,
                  ...acceptedNewLineups,
                ];
                saveLineupsToStorage();
                message.success(
                  `已导入 ${acceptedNewLineups.length + duplicateLineups.length} 个阵容${skippedForLimit > 0 ? `，另有 ${skippedForLimit} 个因超出上限被跳过` : ""}`,
                );
              },
              onNegativeClick: () => {
                savedLineups.value = [
                  ...savedLineups.value,
                  ...acceptedNewLineups,
                ];
                saveLineupsToStorage();
                message.success(
                  `已导入 ${acceptedNewLineups.length} 个阵容，跳过 ${duplicateLineups.length} 个重复${skippedForLimit > 0 ? `，另有 ${skippedForLimit} 个因超出上限被跳过` : ""}`,
                );
              },
            });
          } else {
            savedLineups.value = [
              ...savedLineups.value,
              ...acceptedNewLineups,
            ];
            saveLineupsToStorage();
            message.success(
              `已导入 ${acceptedNewLineups.length} 个阵容${skippedForLimit > 0 ? `，另有 ${skippedForLimit} 个因超出上限被跳过` : ""}`,
            );
          }
        };

        if (importData.roleId !== currentRoleId) {
          dialog.warning({
            title: "角色不匹配",
            content: `该阵容文件来自其他角色，是否继续导入？`,
            positiveText: "导入",
            negativeText: "取消",
            onPositiveClick: () => {
              processImport(importData.lineups);
            },
          });
        } else {
          processImport(importData.lineups);
        }
      } catch (parseError) {
        message.error("解析文件失败，请检查文件格式");
      }
    };
    reader.readAsText(file.file);
  } catch (error) {
    message.error(`导入失败: ${error.message}`);
  }
};

const switchTeam = async (teamId, options = {}) => {
  const { silent = false } = options;
  if (teamId === currentTeamId.value) return true;

  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    return false;
  }

  const tokenId = token.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected") {
    message.error("WebSocket未连接，无法切换阵容");
    return false;
  }

  switchingTeamId.value = teamId;
  state.value.isRunning = true;

  try {
    await tokenStore.sendMessageWithPromise(tokenId, "presetteam_saveteam", {
      teamId,
    });

    await delay(500);

    currentTeamId.value = teamId;
    if (!silent) {
      message.success(`已切换到阵容 ${teamId}`);
    }

    await refreshTeamInfo();
    return true;
  } catch (error) {
    message.error(`切换阵容失败: ${error.message}`);
    return false;
  } finally {
    switchingTeamId.value = null;
    state.value.isRunning = false;
  }
};

const syncStarTempleSelectedLineup = () => {
  if (
    starTemple.value.selectedLineupId &&
    savedLineups.value.some(
      (lineup) => lineup.id === starTemple.value.selectedLineupId,
    )
  ) {
    return;
  }

  starTemple.value.selectedLineupId = savedLineups.value[0]?.id || null;
};

const refreshStarTempleInfo = async (options = {}) => {
  const { silent = false } = options;
  const token = tokenStore.selectedToken;
  if (!token) {
    if (!silent) message.warning("请先选择Token");
    return null;
  }

  const tokenId = token.id;
  const status = tokenStore.getWebSocketStatus(tokenId);
  if (status !== "connected") {
    if (!silent) message.warning("请先建立WS连接");
    return null;
  }

  starTemple.value.loading = true;
  try {
    addStarTempleLog("info", "刷新星级十殿信息");
    const result = await tokenStore.sendMessageWithPromise(
      tokenId,
      "nmext_getinfo",
      {},
      10000,
    );
    starTemple.value.info = result || null;
    if (!silent) {
      message.success("星级十殿信息已更新");
    }
    return result || null;
  } catch (error) {
    addStarTempleLog("error", `刷新星级十殿失败：${error.message}`, error);
    if (!silent) {
      message.error(`刷新星级十殿失败: ${error.message}`);
    }
    return null;
  } finally {
    starTemple.value.loading = false;
  }
};

const prepareLineupForStarTemple = async (lineup) => {
  if (!lineup) {
    throw new Error("请先选择无限阵容");
  }

  if (lineup.teamId !== currentTeamId.value) {
    addStarTempleLog("info", `切换到阵容槽位 ${lineup.teamId}`);
    const switched = await switchTeam(lineup.teamId, { silent: true });
    if (!switched) {
      throw new Error(`切换到阵容槽位 ${lineup.teamId} 失败`);
    }
  }

  await nextTick();

  addStarTempleLog("info", `应用无限阵容：${lineup.name}`);
  const applied = await applyLineup(lineup, { silentSuccess: true });
  if (!applied) {
    throw new Error(`应用阵容 "${lineup.name}" 失败`);
  }

  addStarTempleLog("info", "读取最新阵容快照用于十殿挑战");
  const snapshot = await loadLineupSnapshot(tokenStore.selectedToken.id, lineup.teamId, {
    ensureTeamFresh: true,
  });
  return snapshot;
};

const startStarTempleBattle = async () => {
  const token = tokenStore.selectedToken;
  if (!token) {
    message.warning("请先选择Token");
    return;
  }

  if (state.value.isRunning || starTemple.value.running) {
    message.warning("当前有操作执行中，请稍候");
    return;
  }

  const lineup = selectedStarTempleLineup.value;
  if (!lineup) {
    message.warning("请先选择一个无限阵容");
    return;
  }

  const bossId = Number(starTemple.value.selectedBossId || 1);
  if (!STAR_TEMPLE_BOSS_IDS.includes(bossId)) {
    message.warning("请选择 1-8 关");
    return;
  }

  starTemple.value.running = true;
  starTemple.value.lastResult = null;
  clearStarTempleLogs();
  addStarTempleLog(
    "info",
    `开始挑战星级十殿：第 ${bossId} 关，阵容 ${lineup.name}`,
  );

  try {
    const snapshot = await prepareLineupForStarTemple(lineup);
    const battleWeaponId =
      normalizeId(snapshot?.weaponId) ?? normalizeId(lineup.weaponId) ?? 0;

    addStarTempleLog(
      "info",
      `发送十殿战斗：bossId=${bossId}, lordWeaponId=${battleWeaponId}`,
    );

    const result = await tokenStore.sendMessageWithPromise(
      token.id,
      "nmext_startboss",
      {
        bossId,
        battleTeam: {},
        lordWeaponId: battleWeaponId,
      },
      15000,
    );

    const isWin = Boolean(result?.isWin ?? result?.battleData?.result?.isWin);
    const starIndexes = Array.isArray(result?.nowStarIdxList)
      ? result.nowStarIdxList
          .map((item) => Number(item))
          .filter((item) => !Number.isNaN(item))
      : [];
    const starCount = isWin ? starIndexes.length : 0;

    starTemple.value.lastResult = {
      bossId,
      isWin,
      starIndexes,
      starCount,
      raw: result,
    };

    addStarTempleLog(
      isWin ? "info" : "warn",
      `十殿挑战${isWin ? "成功" : "失败"}：第 ${bossId} 关，${isWin ? `${starCount} 星` : "0 星"}`,
      result,
    );

    await refreshStarTempleInfo({ silent: true });

    if (isWin) {
      message.success(`星级十殿第 ${bossId} 关挑战成功，获得 ${starCount} 星`);
    } else {
      message.warning(`星级十殿第 ${bossId} 关挑战失败`);
    }
  } catch (error) {
    addStarTempleLog("error", `十殿挑战失败：${error.message}`, error);
    message.error(`星级十殿挑战失败: ${error.message}`);
  } finally {
    starTemple.value.running = false;
  }
};

watch(
  () => tokenStore.selectedToken,
  (newToken, oldToken) => {
    if (!newToken) {
      savedLineups.value = [];
      return;
    }

    if (newToken.id !== oldToken?.id) {
      void loadSavedLineups();
      syncStarTempleSelectedLineup();
      starTemple.value.info = null;
      starTemple.value.lastResult = null;
      clearStarTempleLogs();
      currentTeamInfo.value = null;
      presetTeamData.value = null;
      allHeroesData.value = {};
      currentTeamId.value = 1;

      const status = tokenStore.getWebSocketStatus(newToken.id);
      if (status === "connected") {
        refreshTeamInfo({ silent: true });
        refreshStarTempleInfo({ silent: true });
      }
    }
  },
);

watch(
  () =>
    tokenStore.selectedToken
      ? tokenStore.getWebSocketStatus(tokenStore.selectedToken.id)
      : null,
  (newStatus, oldStatus) => {
    if (
      newStatus === "connected" &&
      oldStatus !== "connected" &&
    tokenStore.selectedToken
  ) {
    setTimeout(() => {
        refreshTeamInfo({ silent: true });
        refreshStarTempleInfo({ silent: true });
      }, 500);
    }
  },
);

watch(
  savedLineups,
  () => {
    syncStarTempleSelectedLineup();
  },
  { deep: true, immediate: true },
);

watch(savedLineupsModalVisible, (visible) => {
  if (!visible) {
    closeLineupActionDialog();
  }
});

onMounted(() => {
  if (document.querySelector(".game-features-page")) {
    savedLineupsModalTarget.value = ".game-features-page";
  }

  void loadSavedLineups();

  const token = tokenStore.selectedToken;
  if (token) {
    const status = tokenStore.getWebSocketStatus(token.id);
    if (status === "connected") {
      refreshTeamInfo({ silent: true });
      refreshStarTempleInfo({ silent: true });
    }
  }
});
</script>

<style scoped lang="scss">
.lineup-saver {
  min-height: 300px;
}

.lineup-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.toolbar {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
}

.star-temple-section {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.star-temple-header {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
  align-items: flex-start;

  h4 {
    margin: 0 0 4px;
  }

  p {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
}

.star-temple-header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  flex-wrap: wrap;
}

.star-temple-reset {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.star-temple-toolbar {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  flex-wrap: wrap;
}

.star-temple-lineup-select {
  min-width: 260px;
  flex: 1;
}

.star-temple-selected-boss {
  color: var(--text-primary);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.star-temple-stage-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--spacing-sm);
}

.star-stage-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-radius: var(--border-radius-medium);
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    border-color: var(--primary-color);
    transform: translateY(-1px);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  &.active {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary-color) 30%, transparent);
  }

  &.completed .stage-stars {
    color: #f7b500;
  }
}

.stage-name {
  font-weight: 700;
  color: var(--text-primary);
}

.stage-stars {
  font-size: 16px;
  letter-spacing: 1px;
  color: var(--text-tertiary);
}

.stage-meta,
.stage-reward {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.stage-reward.claimed {
  color: var(--success-color);
}

.star-temple-summary,
.star-temple-result {
  display: flex;
  gap: var(--spacing-md);
  flex-wrap: wrap;
  align-items: center;
  font-size: var(--font-size-sm);
}

.result-badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--font-size-xs);
  font-weight: 700;

  &.win {
    background: color-mix(in srgb, var(--success-color) 16%, transparent);
    color: var(--success-color);
  }

  &.loss {
    background: color-mix(in srgb, var(--error-color) 16%, transparent);
    color: var(--error-color);
  }
}

.star-temple-log-panel {
  background: var(--bg-secondary);
  border-radius: var(--border-radius-medium);
  border: 1px solid var(--border-color);
  padding: var(--spacing-sm);
}

.star-temple-log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-xs);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.star-temple-log-list {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.star-temple-log-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  padding: 6px 8px;
  border-radius: var(--border-radius-small);
  background: var(--bg-primary);
}

.star-temple-log-item.level-error {
  border-left: 3px solid #d03050;
}

.star-temple-log-item.level-warn {
  border-left: 3px solid #f0a020;
}

.star-temple-log-item.level-info {
  border-left: 3px solid #2080f0;
}

.apply-log-panel {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-sm);
  border: 1px solid var(--border-color);
}

.apply-log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--spacing-xs);
}

.apply-log-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  font-weight: 600;
}

.apply-log-progress {
  color: var(--text-secondary);
  font-weight: normal;
}

.apply-log-list {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.apply-log-item {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  padding: 6px 8px;
  border-radius: var(--border-radius-small);
  background: var(--bg-primary);
}

.apply-log-item.level-error {
  border-left: 3px solid #d03050;
}

.apply-log-item.level-warn {
  border-left: 3px solid #f0a020;
}

.apply-log-item.level-info {
  border-left: 3px solid #2080f0;
}

.log-time {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.log-level {
  min-width: 38px;
  font-weight: 700;
  white-space: nowrap;
}

.log-message {
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.current-team-section {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-md);

  h4 {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
  }

  .drag-tip {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-weight: normal;
  }
}

.heroes-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.hero-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  background: var(--bg-primary);
  border-radius: var(--border-radius-small);
  padding: var(--spacing-xs) var(--spacing-sm);
  width: 100%;
  transition: all 0.2s;
  cursor: grab;
  border: 2px solid transparent;

  &:hover {
    background: var(--primary-color-light);
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  }

  &.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  &.drag-over {
    border-color: var(--primary-color);
    background: var(--primary-color-light);
  }
}

.hero-actions {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  margin-left: auto;
  min-width: 60px;
  justify-content: center;
}

.hero-position {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--primary-color);
  color: white;
  font-size: 10px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.hero-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.hero-placeholder {
  font-size: 12px;
  color: var(--text-secondary);
}

.hero-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  cursor: pointer;
}

.hero-avatar-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
}

.hero-name-small-inline {
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-level-small-inline {
  font-size: 10px;
  color: white;
  font-weight: 600;
  white-space: nowrap;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  padding: 2px 6px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(240, 147, 251, 0.3);
}

.hero-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
  flex: 1;
}

.hero-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.hero-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.hero-level {
  font-size: var(--font-size-xs);
  color: var(--text-accent);
  font-weight: 500;
}

.hero-fish {
  font-size: var(--font-size-xs);
  color: var(--primary-color);
  background: linear-gradient(
    135deg,
    rgba(114, 46, 209, 0.15) 0%,
    rgba(114, 46, 209, 0.08) 100%
  );
  border: 1px solid rgba(114, 46, 209, 0.2);
  padding: 4px 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  align-self: flex-start;
  margin-bottom: 6px;
  font-weight: 500;
}

.hero-stats {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 3px;

  .stat-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  span {
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 500;
    white-space: nowrap;
    min-width: 90px;
    text-align: center;
  }

  .stat-power {
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
    color: white;
    font-size: 12px;
  }

  .stat-attack {
    background: linear-gradient(135deg, #ffa940 0%, #fa8c16 100%);
    color: white;
  }

  .stat-hp {
    background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
    color: white;
  }

  .stat-speed {
    background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%);
    color: white;
  }
}

.hero-fish-skill-inline {
  background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
  color: white;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
}

.hero-fish-slots-inline {
  display: inline-flex;
  gap: 3px;
  margin-left: 4px;
  padding-left: 6px;
  border-left: 1px solid rgba(114, 46, 209, 0.2);
}

.slot-dot-small {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
}

.hero-artifact {
  font-size: var(--font-size-xs);
}

.exchange-btn {
  flex-shrink: 0;
  width: 100%;
}

.remove-btn {
  flex-shrink: 0;
  width: 100%;
}

.saved-lineups-section {
  h4 {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
}

.empty-tip {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  text-align: center;
  padding: var(--spacing-lg);
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
}

.saved-lineups-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.saved-lineup-item {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-sm);
}

.lineup-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-xs);
}

.lineup-name {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.lineup-time {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.lineup-heroes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-sm);
}

.lineup-heroes-row {
  display: flex;
  gap: var(--spacing-md);
  justify-content: center;
  margin-bottom: var(--spacing-sm);
}

.lineup-hero-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 110px;
  padding: 8px 6px;
  background: var(--bg-secondary);
  border-radius: var(--border-radius-small);
}

.hero-avatar {
  width: 60px;
  height: 60px;
  border-radius: var(--border-radius-small);
  object-fit: cover;
  border: 2px solid var(--border-color);
}

.hero-avatar-placeholder {
  width: 60px;
  height: 60px;
  border-radius: var(--border-radius-small);
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-secondary);
  border: 2px solid var(--border-color);
}

.hero-info-small {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

.hero-header-small {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  margin-bottom: 4px;
}

.hero-name-small {
  font-size: 13px;
  color: var(--text-primary);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.hero-level-small {
  font-size: 12px;
  color: white;
  font-weight: 600;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  padding: 2px 6px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(240, 147, 251, 0.3);
}

.hero-fish-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 4px;
  gap: 2px;
  background: linear-gradient(
    135deg,
    rgba(114, 46, 209, 0.12) 0%,
    rgba(114, 46, 209, 0.06) 100%
  );
  border: 1px solid rgba(114, 46, 209, 0.18);
  border-radius: 6px;
  padding: 4px 8px;
  width: 100%;
}

.hero-fish-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  width: 100%;
}

.hero-stats-small {
  font-size: 10px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;

  .stat-row-small {
    display: flex;
    justify-content: center;
    gap: 4px;
  }

  span {
    padding: 3px 5px;
    border-radius: 4px;
    font-weight: 500;
    white-space: nowrap;
    min-width: 70px;
    text-align: center;
  }

  .stat-power {
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
    color: white;
  }

  .stat-attack {
    background: linear-gradient(135deg, #ffa940 0%, #fa8c16 100%);
    color: white;
  }

  .stat-hp {
    background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
    color: white;
  }

  .stat-speed {
    background: linear-gradient(135deg, #1890ff 0%, #096dd9 100%);
    color: white;
  }
}

.hero-fish-name {
  font-size: 11px;
  color: var(--primary-color);
  font-weight: 500;
}

.hero-fish-skill-name {
  font-size: 10px;
  background: linear-gradient(135deg, #52c41a 0%, #389e0d 100%);
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 4px;
  font-weight: 500;
}

.hero-fish-slots {
  display: flex;
  gap: 4px;
  justify-content: center;
  padding-top: 3px;
}

.lineup-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.quick-switch-section {
  h4 {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
}

.team-selector {
  display: flex;
  gap: var(--spacing-xs);
}

.refine-modal-content {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-md);
}

.equip-refine-section {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  padding: var(--spacing-sm);
}

.equip-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
  padding-bottom: var(--spacing-xs);
  border-bottom: 1px solid var(--border-light);
}

.equip-name {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.equip-level {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.equip-bonus {
  font-size: var(--font-size-xs);
  color: var(--primary-color);
  margin-left: auto;
}

.slots-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.slot-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-primary);
  border-radius: var(--border-radius-small);
  border-left: 3px solid var(--border-light);

  &.locked {
    border-left-color: var(--primary-color);
    background: var(--primary-color-light);
  }

  &.color-1 {
    border-left-color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  &.color-2 {
    border-left-color: #4caf50;
    background: rgba(76, 175, 80, 0.1);
  }

  &.color-3 {
    border-left-color: #2196f3;
    background: rgba(33, 150, 243, 0.1);
  }

  &.color-4 {
    border-left-color: #9c27b0;
    background: rgba(156, 39, 176, 0.1);
  }

  &.color-5 {
    border-left-color: #ff9800;
    background: rgba(255, 152, 0, 0.1);
  }

  &.color-6 {
    border-left-color: #f44336;
    background: rgba(244, 67, 54, 0.1);
  }
}

.slot-label {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  min-width: 30px;
}

.slot-attr {
  flex: 1;
  display: flex;
  justify-content: space-between;
  font-size: var(--font-size-sm);
}

.attr-name {
  color: var(--text-primary);
}

.attr-value {
  color: var(--primary-color);
  font-weight: var(--font-weight-medium);
}

.slot-empty {
  flex: 1;
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
}

.no-equipment {
  text-align: center;
  color: var(--text-secondary);
  padding: var(--spacing-lg);
}

.exchange-modal-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.current-hero-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
}

.hero-filter-section {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);

  .filter-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .filter-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-xs);
  }
}

.hero-select-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: var(--spacing-sm);
  max-height: 400px;
  overflow-y: auto;
  padding: var(--spacing-xs);
}

.hero-select-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm);
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;

  &:hover {
    background: var(--bg-secondary);
    transform: translateY(-2px);
  }

  &.selected {
    border-color: var(--primary-color);
    background: var(--primary-color-light);
  }

  &.quality-red {
    border-color: rgba(245, 34, 45, 0.3);

    &:hover {
      border-color: rgba(245, 34, 45, 0.6);
      background: rgba(245, 34, 45, 0.1);
    }

    &.selected {
      border-color: #f5222d;
      background: rgba(245, 34, 45, 0.15);
    }
  }

  &.quality-orange {
    border-color: rgba(250, 173, 20, 0.3);

    &:hover {
      border-color: rgba(250, 173, 20, 0.6);
      background: rgba(250, 173, 20, 0.1);
    }

    &.selected {
      border-color: #faad14;
      background: rgba(250, 173, 20, 0.15);
    }
  }

  &.quality-purple {
    border-color: rgba(114, 46, 209, 0.3);

    &:hover {
      border-color: rgba(114, 46, 209, 0.6);
      background: rgba(114, 46, 209, 0.1);
    }

    &.selected {
      border-color: #722ed1;
      background: rgba(114, 46, 209, 0.15);
    }
  }
}

.hero-select-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.hero-select-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  text-align: center;
}

.hero-select-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: center;
}

.hero-artifact-id {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

.saved-lineups-modal-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.lineup-page-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 2200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(2px);
}

.lineup-page-modal-card {
  width: min(900px, 100%);
  max-height: calc(100% - 16px);
  position: relative;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
  overflow: hidden;
}

.lineup-page-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-md);
  padding: 18px 20px;
  border-bottom: 1px solid var(--border-color);
  background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
}

.lineup-page-modal-title {
  h3 {
    margin: 0;
    font-size: 18px;
    color: var(--text-primary);
  }

  p {
    margin: 4px 0 0;
    font-size: 13px;
    color: var(--text-secondary);
  }
}

.lineup-page-modal-body {
  padding: 20px;
  overflow: auto;
}

.lineup-inline-dialog-mask {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.24);
  backdrop-filter: blur(4px);
}

.lineup-inline-dialog-card {
  width: min(460px, 100%);
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.18);
  border: 1px solid rgba(148, 163, 184, 0.16);
  overflow: hidden;
}

.lineup-inline-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-color);

  h4 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }
}

.lineup-inline-dialog-body {
  padding: 18px;
}

.lineup-inline-dialog-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;

  &.danger {
    color: #d03050;
  }
}

.lineup-inline-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 0 18px 18px;
}

.team-tabs {
  display: flex;
  gap: var(--spacing-xs);
  border-bottom: 1px solid var(--border-color);
  padding-bottom: var(--spacing-sm);
  justify-content: space-between;
  align-items: center;
}

.team-tabs-left {
  display: flex;
  gap: var(--spacing-xs);
}

.team-tabs-right {
  display: flex;
  gap: var(--spacing-xs);
}

.team-tab {
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  &.active {
    background: var(--primary-color);
    color: white;
  }
}

.tab-count {
  font-size: var(--font-size-xs);
  opacity: 0.8;
}

.lineups-list {
  max-height: min(50vh, 560px);
  overflow-y: auto;
}

.lineup-card {
  background: var(--bg-tertiary);
  border-radius: var(--border-radius-medium);
  margin-bottom: var(--spacing-sm);
  overflow: hidden;
}

.lineup-title-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-sm);
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: var(--bg-secondary);
  }
}

.lineup-title-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.expand-icon {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
  width: 12px;
}

.lineup-name {
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.lineup-time {
  font-size: var(--font-size-xs);
  color: var(--text-tertiary);
}

.lineup-weapon-tag {
  font-size: var(--font-size-xs);
  color: var(--primary-color);
  background: rgba(var(--primary-color-rgb, 0, 122, 255), 0.1);
  padding: 1px 6px;
  border-radius: var(--border-radius-small);
  margin-left: var(--spacing-xs);
}

.lineup-quick-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.lineup-detail {
  padding: var(--spacing-sm);
  padding-top: 0;
  border-top: 1px solid var(--border-color);
}

.lineup-heroes-detail {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-sm);
}

.lineup-hero-item {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: var(--border-radius-small);
}

.hero-pos {
  color: var(--text-tertiary);
}

.hero-name {
  color: var(--text-primary);
}

.hero-artifact {
  color: var(--primary-color);
  font-size: var(--font-size-xs);
}

.hero-fish-tag {
  color: var(--success-color);
  font-size: var(--font-size-xs);
  background: rgba(var(--success-color-rgb, 0, 128, 0), 0.1);
  padding: 1px 4px;
  border-radius: var(--border-radius-small);
  margin-left: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.hero-fish-skill {
  color: var(--primary-color);
  font-weight: normal;
}

.hero-fish-slots {
  display: inline-flex;
  gap: 2px;
  margin-left: 4px;
}

.slot-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.3);
}

.tech-modal-content {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.tech-type-section {
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.tech-type-header {
  background: var(--bg-secondary);
  padding: var(--spacing-xs) var(--spacing-sm);
  font-weight: bold;
  color: var(--primary-color);
}

.tech-items {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: var(--border-color);
}

.tech-item {
  display: flex;
  justify-content: space-between;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-primary);
  font-size: var(--font-size-sm);
}

.tech-name {
  color: var(--text-secondary);
}

.tech-level {
  color: var(--text-primary);
  font-weight: 500;
}

.no-tech-data {
  text-align: center;
  color: var(--text-tertiary);
  padding: var(--spacing-lg);
}

.lineup-actions {
  display: flex;
  gap: var(--spacing-xs);
}

.no-lineup-tip {
  color: var(--text-tertiary);
  font-size: var(--font-size-sm);
  text-align: center;
  padding: var(--spacing-lg);
}

@media (max-width: 768px) {
  .toolbar,
  .star-temple-header,
  .star-temple-toolbar,
  .star-temple-summary,
  .star-temple-result {
    flex-direction: column;
    align-items: flex-start;
  }

  .star-temple-lineup-select {
    width: 100%;
    min-width: 0;
  }

  .star-temple-stage-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .team-selector,
  .lineup-title-bar,
  .lineup-quick-actions,
  .team-tabs {
    flex-wrap: wrap;
  }

  .team-tabs {
    align-items: flex-start;
  }
}
</style>
