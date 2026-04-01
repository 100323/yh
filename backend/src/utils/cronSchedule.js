export function parseCronField(field, min, max) {
  const values = new Set();
  const normalizedField = String(field || '').trim();

  if (!normalizedField) return [];

  if (normalizedField.includes(',')) {
    normalizedField.split(',').forEach((part) => {
      parseCronField(part.trim(), min, max).forEach((value) => values.add(value));
    });
    return Array.from(values).sort((a, b) => a - b);
  }

  if (normalizedField === '*' || normalizedField === '?') {
    for (let i = min; i <= max; i += 1) values.add(i);
    return Array.from(values);
  }

  if (normalizedField.includes('/')) {
    const [range, stepText] = normalizedField.split('/');
    const step = Number(stepText);
    if (!Number.isInteger(step) || step <= 0) return [];

    let start = min;
    let end = max;
    if (range && range !== '*') {
      if (range.includes('-')) {
        const [rangeStart, rangeEnd] = range.split('-').map(Number);
        start = rangeStart;
        end = rangeEnd;
      } else {
        start = Number(range);
        end = max;
      }
    }

    for (let i = start; i <= end; i += step) {
      if (i >= min && i <= max) values.add(i);
    }
    return Array.from(values).sort((a, b) => a - b);
  }

  if (normalizedField.includes('-')) {
    const [start, end] = normalizedField.split('-').map(Number);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
    for (let i = start; i <= end; i += 1) {
      if (i >= min && i <= max) values.add(i);
    }
    return Array.from(values).sort((a, b) => a - b);
  }

  const value = Number(normalizedField);
  if (Number.isInteger(value) && value >= min && value <= max) {
    values.add(value);
  }
  return Array.from(values).sort((a, b) => a - b);
}

export function calculateNextRunAt(cronExpression, now = new Date()) {
  if (!cronExpression) return null;

  const parts = String(cronExpression).trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const daysOfMonth = parseCronField(dayOfMonthField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const daysOfWeek = parseCronField(dayOfWeekField, 0, 7).map((value) => (value === 7 ? 0 : value));

  if (!minutes.length || !hours.length || !daysOfMonth.length || !months.length || !daysOfWeek.length) {
    return null;
  }

  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxCheck = new Date(now);
  maxCheck.setFullYear(maxCheck.getFullYear() + 1);

  while (candidate <= maxCheck) {
    const minute = candidate.getMinutes();
    const hour = candidate.getHours();
    const dayOfMonth = candidate.getDate();
    const month = candidate.getMonth() + 1;
    const dayOfWeek = candidate.getDay();

    const matches =
      minutes.includes(minute) &&
      hours.includes(hour) &&
      daysOfMonth.includes(dayOfMonth) &&
      months.includes(month) &&
      daysOfWeek.includes(dayOfWeek);

    if (matches) {
      return candidate.toISOString();
    }

    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

export function getNextRunAt(cronExpression, storedNextRunAt) {
  if (storedNextRunAt) return storedNextRunAt;
  if (!cronExpression) return null;
  return calculateNextRunAt(cronExpression);
}

export function getDateKeyInTimezone(date = new Date(), timeZone = 'Asia/Shanghai') {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

export function isNextRunPendingToday(nextRunAt, timeZone = 'Asia/Shanghai', now = new Date()) {
  if (!nextRunAt) return false;

  const nextRunDate = new Date(nextRunAt);
  if (Number.isNaN(nextRunDate.getTime())) {
    return false;
  }

  return getDateKeyInTimezone(nextRunDate, timeZone) === getDateKeyInTimezone(now, timeZone);
}

export function resolveBatchCronExpression(task) {
  if (task?.run_type === 'daily' && task?.run_time) {
    const [hours, minutes] = String(task.run_time).split(':');
    if (hours !== undefined && minutes !== undefined) {
      return `${minutes} ${hours} * * *`;
    }
  }

  if (task?.run_type === 'cron' && task?.cron_expression) {
    return task.cron_expression;
  }

  return null;
}
