import crypto from 'crypto';
import config from '../config/index.js';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;

function getEncryptionKey() {
  const key = config.encryption.key;
  return crypto.createHash('sha256').update(key).digest();
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
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
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
