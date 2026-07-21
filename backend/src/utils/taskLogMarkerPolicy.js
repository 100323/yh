export function shouldRecordTaskExecutionMarker(status) {
  return String(status || '').trim().toLowerCase() !== 'missed';
}
