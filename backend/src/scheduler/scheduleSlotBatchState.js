function isScheduleSlot(value) {
  return Number.isInteger(Number(value?.id)) && Number(value.id) > 0;
}

export function getScheduleSlots(item) {
  const slots = Array.isArray(item?.scheduleSlots)
    ? item.scheduleSlots
    : [item?.scheduleSlot];
  const seen = new Set();

  return slots.filter((slot) => {
    const id = Number(slot?.id);
    if (!isScheduleSlot(slot) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function appendScheduleSlot(item, slot) {
  if (!item || !isScheduleSlot(slot)) return getScheduleSlots(item);
  const slots = getScheduleSlots(item);
  if (!slots.some((entry) => Number(entry.id) === Number(slot.id))) {
    slots.push(slot);
  }
  item.scheduleSlots = slots;
  delete item.scheduleSlot;
  return slots;
}
