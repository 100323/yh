import { parseCronField } from '../utils/cronSchedule.js';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getShanghaiDateParts(date) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function shiftCalendarDate(parts, daysBack) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - daysBack));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function parseCronExpression(cronExpression) {
  const parts = String(cronExpression || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const daysOfMonth = parseCronField(dayOfMonthField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const daysOfWeek = parseCronField(dayOfWeekField, 0, 7)
    .map((value) => (value === 7 ? 0 : value));

  if (!minutes.length || !hours.length || !daysOfMonth.length || !months.length || !daysOfWeek.length) {
    return null;
  }

  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

export function findLatestDueScheduleSlot(cronExpressions, options = {}) {
  const now = options.now instanceof Date ? new Date(options.now) : new Date(options.now || Date.now());
  if (Number.isNaN(now.getTime())) return null;

  const graceMs = Math.max(0, Number(options.graceMs) || 0);
  const lookbackDays = Math.min(31, Math.max(0, Math.trunc(Number(options.lookbackDays) || 0)));
  const maxLookbackMs = Number(options.maxLookbackMs);
  const readyAt = now.getTime() - graceMs;
  const oldestAt = Number.isFinite(maxLookbackMs) && maxLookbackMs >= 0
    ? now.getTime() - maxLookbackMs
    : Number.NEGATIVE_INFINITY;
  const today = getShanghaiDateParts(now);
  const expressions = Array.from(new Set(
    (Array.isArray(cronExpressions) ? cronExpressions : [cronExpressions])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  ));
  let latest = null;

  for (let daysBack = 0; daysBack <= lookbackDays; daysBack += 1) {
    const shanghai = shiftCalendarDate(today, daysBack);
    for (const cronExpression of expressions) {
      const parsed = parseCronExpression(cronExpression);
      if (
        !parsed
        || !parsed.months.includes(shanghai.month)
        || !parsed.daysOfMonth.includes(shanghai.day)
        || !parsed.daysOfWeek.includes(shanghai.dayOfWeek)
      ) {
        continue;
      }

      for (const hour of parsed.hours) {
        for (const minute of parsed.minutes) {
          const scheduledTime = Date.UTC(
            shanghai.year,
            shanghai.month - 1,
            shanghai.day,
            hour - 8,
            minute,
            0,
            0,
          );
          if (
            scheduledTime < oldestAt
            || scheduledTime > readyAt
            || (latest && scheduledTime <= latest.scheduledTime)
          ) {
            continue;
          }

          latest = {
            scheduledTime,
            localScheduledAt: `${shanghai.year}-${pad2(shanghai.month)}-${pad2(shanghai.day)} ${pad2(hour)}:${pad2(minute)}:00`,
            scheduledAt: new Date(scheduledTime).toISOString(),
            cronExpression,
          };
        }
      }
    }
  }

  if (!latest) return null;
  const { scheduledTime, ...slot } = latest;
  return slot;
}
