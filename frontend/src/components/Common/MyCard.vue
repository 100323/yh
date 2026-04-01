<template>
  <div class="status-card">
    <div class="card-header">
      <div class="status-icon">
        <slot name="icon"></slot>
      </div>
      <div class="status-title">
        <slot name="title"></slot>
      </div>
      <div class="status-badge" :class="statusClass">
        <div class="status-dot" />
        <slot name="badge"></slot>
      </div>
      <slot name="extra"></slot>
    </div>
    <div class="card-content">
      <slot name="default"></slot>
    </div>
    <div class="card-action" :class="statusClass">
      <slot name="action"></slot>
    </div>
  </div>
</template>
<script setup lang="ts">
declare type StatusKey = "active" | "weekly" | "energy" | "completed";

const $props = defineProps<{
  statusClass: StatusKey | Record<StatusKey, boolean>;
}>();
</script>

<style lang="scss">
.status-card {
  background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  transition: all 0.3s ease;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(0, 0, 0, 0.05);

  &:hover {
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    transform: translateY(-2px);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .active {
    --bg-color: rgba(34, 197, 94, 0.15);
    --font-color: #16a34a;
    --pr-color: #16a34a;
    --f-color: #16a34a;
    background: var(--bg-color);
    color: var(--font-color);
  }

  .weekly {
    --bg-color: rgba(59, 130, 246, 0.15);
    --font-color: #2563eb;
    --pr-color: #2563eb;
    --f-color: #2563eb;
    background: var(--bg-color);
    color: var(--font-color);
  }

  .energy {
    --bg-color: rgba(245, 158, 11, 0.15);
    --font-color: #d97706;
    --pr-color: #d97706;
    --f-color: #d97706;
    background: var(--bg-color);
    color: var(--font-color);
  }

  .completed {
    --bg-color: rgba(34, 197, 94, 0.15);
    --font-color: #16a34a;
    --pr-color: #16a34a;
    --f-color: #16a34a;
    --bg-tertiary: #16a34a;
    --text-tertiary: rgba(255, 255, 255, 1);
    background: var(--bg-color);
    color: var(--font-color);
  }
}

.card-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;

  .status-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    > img {
      width: 36px;
      height: 36px;
      object-fit: contain;
    }
  }

  .status-title {
    flex: 1;
    min-width: 0;

    h3 {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
      margin: 0 0 4px 0;
      line-height: 1.4;
    }

    p {
      font-size: 13px;
      color: #6b7280;
      margin: 0;
      line-height: 1.5;
    }
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    background: var(--bg-color);
    color: var(--font-color);
    white-space: nowrap;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
}

.card-content {
  flex: 1;
  font-size: 14px;
  color: #4b5563;
  line-height: 1.6;
  margin-bottom: 20px;

  h3 {
    font-size: 15px;
    font-weight: 600;
    color: #1f2937;
    margin: 0 0 8px 0;
  }

  p {
    margin: 0;
  }

  .description {
    line-height: 1.6;
    color: #9ca3af;
    font-size: 12px;
  }

  .monthly-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #f3f4f6;

    &:last-child {
      border-bottom: none;
    }

    .row-title {
      color: #6b7280;
      font-size: 14px;
    }

    .row-value {
      color: #1f2937;
      font-weight: 500;
      font-size: 14px;
    }
  }

  .total-points {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 12px;
    background: #f9fafb;
    border-radius: 8px;
    margin-bottom: 16px;

    .label {
      color: #6b7280;
      font-size: 14px;
    }

    .value {
      color: #1f2937;
      font-weight: 600;
      font-size: 18px;
    }
  }

  .action-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
  }

  .status-indicator {
    font-size: 12px;
    margin-left: 8px;

    &.closed {
      color: #d97706;
    }
  }

  .container {
    .list {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;

      .item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        background: #f9fafb;
        border-radius: 8px;

        img {
          width: 32px;
          height: 32px;
          object-fit: contain;
        }

        .box-info {
          .box-type {
            font-size: 13px;
            font-weight: 500;
            color: #374151;
          }

          .box-count {
            font-size: 12px;
            color: #6b7280;
          }
        }
      }
    }

    .selects {
      display: flex;
      gap: 12px;
    }
  }
}

.card-action {
  display: flex;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;

  > button {
    cursor: pointer;
    flex: 1;
    width: 100%;
    font-size: 14px;
    font-weight: 500;
    padding: 10px 16px;
    border-radius: 8px;
    color: #1f2937;
    background-color: #f3f4f6;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;

    &:hover:not(:disabled) {
      background-color: #e5e7eb;
      transform: translateY(-1px);
    }

    &:disabled {
      background: #d1d5db;
      color: #9ca3af;
      cursor: not-allowed;
      opacity: 0.6;
    }
  }
}

@media (max-width: 768px) {
  .status-card {
    padding: 18px;
    min-height: auto;
  }

  .card-header {
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;
    padding-bottom: 12px;

    .status-title {
      min-width: 120px;
    }

    .status-badge {
      margin-left: auto;
    }
  }

  .card-content {
    margin-bottom: 16px;
  }

  .card-action {
    padding-top: 12px;
    gap: 10px;

    > button {
      padding: 8px 12px;
      font-size: 13px;
    }
  }
}

@media (max-width: 480px) {
  .status-card {
    padding: 14px;
    border-radius: 12px;
  }

  .card-header {
    gap: 8px;
    margin-bottom: 12px;
    padding-bottom: 10px;

    .status-icon {
      width: 32px;
      height: 32px;

      > img {
        width: 28px;
        height: 28px;
      }
    }

    .status-title {
      min-width: 100px;

      h3 {
        font-size: 14px;
      }

      p {
        font-size: 12px;
      }
    }

    .status-badge {
      padding: 4px 8px;
      font-size: 11px;
    }
  }

  .card-content {
    font-size: 13px;
    margin-bottom: 12px;

    h3 {
      font-size: 14px;
    }

    .monthly-row {
      padding: 8px 0;

      .row-title, .row-value {
        font-size: 13px;
      }
    }

    .total-points {
      padding: 10px;
      margin-bottom: 12px;

      .label {
        font-size: 13px;
      }

      .value {
        font-size: 16px;
      }
    }

    .container {
      .list {
        gap: 10px;
        margin-bottom: 12px;

        .item {
          padding: 8px;

          img {
            width: 28px;
            height: 28px;
          }

          .box-info {
            .box-type {
              font-size: 12px;
            }

            .box-count {
              font-size: 11px;
            }
          }
        }
      }

      .selects {
        gap: 8px;
      }
    }
  }

  .card-action {
    padding-top: 10px;
    gap: 8px;
    flex-wrap: wrap;

    > button {
      padding: 8px 10px;
      font-size: 12px;
      min-width: calc(50% - 4px);
    }
  }
}
</style>
