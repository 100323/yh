import crypto from 'crypto';
import config from '../config/index.js';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;
const DEVELOPMENT_DEFAULT_ENCRYPTION_KEY = 'development-only-encryption-key-change-me';
const warnedDecryptFallbacks = new Set();

function getEncryptionKey() {
  return buildEncryptionKey(config.encryption.key);
}

function buildEncryptionKey(secret) {
  return crypto.createHash('sha256').update(String(secret || '')).digest();
}

function decryptWithKey(encryptedData, ivHex, key) {
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function isHexString(value) {
  return typeof value === 'string' && value.length > 0 && value.length % 2 === 0 && /^[0-9a-f]+$/i.test(value);
}

function isLikelyPlaintextSecret(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return false;
  }
  if (raw.startsWith('{') || raw.startsWith('[')) {
    return true;
  }
  if (/"roleToken"|"sessId"|"connId"|"isRestore"/.test(raw)) {
    return true;
  }
  if (!isHexString(raw) && /[g-zG-Z+/=_-]/.test(raw) && raw.length >= 24) {
    return true;
  }
  return false;
}

function getFallbackEncryptionKeys() {
  const current = String(config.encryption.key || '');
  const envFallbacks = String(process.env.ENCRYPTION_KEY_FALLBACKS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  const candidates = [];
  envFallbacks.forEach((secret) => {
    if (secret && secret !== current) {
      candidates.push(secret);
    }
  });

  if (current !== DEVELOPMENT_DEFAULT_ENCRYPTION_KEY) {
    candidates.push(DEVELOPMENT_DEFAULT_ENCRYPTION_KEY);
  }

  return [...new Set(candidates)];
}

function warnDecryptFallback(kind, reason, extra = {}) {
  const cacheKey = `${kind}:${reason}:${extra?.ivHex || ''}:${String(extra?.preview || '').slice(0, 24)}`;
  if (warnedDecryptFallbacks.has(cacheKey)) {
    return;
  }
  warnedDecryptFallbacks.add(cacheKey);
  console.warn('⚠️ 检测到兼容性解密回退', {
    kind,
    reason,
    ...extra,
  });
}

export function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(config.encryption.ivLength);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    encrypted,
    iv: iv.toString('hex')
  };
}

export function decrypt(encryptedData, ivHex) {
  const rawEncrypted = String(encryptedData ?? '');
  const rawIv = String(ivHex ?? '');
  const currentKey = getEncryptionKey();

  if (!rawEncrypted) {
    return '';
  }

  try {
    return decryptWithKey(rawEncrypted, rawIv, currentKey);
  } catch (primaryError) {
    for (const fallbackSecret of getFallbackEncryptionKeys()) {
      try {
        const decrypted = decryptWithKey(rawEncrypted, rawIv, buildEncryptionKey(fallbackSecret));
        warnDecryptFallback('legacy-key', '使用旧加密密钥成功解密历史数据', {
          ivHex: rawIv,
          preview: rawEncrypted.slice(0, 24),
        });
        return decrypted;
      } catch {
        // continue
      }
    }

    if (isLikelyPlaintextSecret(rawEncrypted)) {
      warnDecryptFallback('plaintext', '检测到明文存储的历史数据，已按明文兼容读取', {
        ivHex: rawIv,
        preview: rawEncrypted.slice(0, 24),
      });
      return rawEncrypted;
    }

    const reason = primaryError?.message || 'unknown decrypt error';
    throw new Error(`账号密钥解密失败，请重新保存账号Token或检查 ENCRYPTION_KEY 配置（${reason}）`);
  }
}

export function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha256')
    .toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const result = hashPassword(password, salt);
  return result.hash === hash;
}

export function generateToken(length = 32) {
  return crypto.randomBytes(length).toString('hex');
}

export default {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  generateToken
};
