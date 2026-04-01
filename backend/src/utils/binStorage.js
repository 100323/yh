export function normalizeBase64Text(input) {
  return String(input || '')
    .replace(/^data:.*?;base64,/, '')
    .replace(/\s+/g, '')
    .trim();
}

export function isLikelyBase64(input) {
  const text = normalizeBase64Text(input);
  return !!text && /^[A-Za-z0-9+/=]+$/.test(text);
}

export function base64ToBuffer(input) {
  const text = normalizeBase64Text(input);
  if (!text) {
    throw new Error('BIN数据为空');
  }
  return Buffer.from(text, 'base64');
}

export function bufferToBase64(input) {
  if (input == null) {
    return '';
  }
  if (Buffer.isBuffer(input)) {
    return input.toString('base64');
  }
  return Buffer.from(input).toString('base64');
}
