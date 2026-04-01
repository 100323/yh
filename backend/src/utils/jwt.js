import crypto from 'crypto';
import config from '../config/index.js';

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString();
}

function hmacSha256(data, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export function sign(payload, secret = config.jwt.secret, expiresIn = config.jwt.expiresIn) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const exp = expiresIn ? parseExpiresIn(expiresIn) : null;

  const finalPayload = {
    ...payload,
    iat: now,
    ...(exp && { exp })
  };

  const headerEncoded = base64UrlEncode(JSON.stringify(header));
  const payloadEncoded = base64UrlEncode(JSON.stringify(finalPayload));
  
  const signature = hmacSha256(`${headerEncoded}.${payloadEncoded}`, secret);

  return `${headerEncoded}.${payloadEncoded}.${signature}`;
}

export function verify(token, secret = config.jwt.secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [headerEncoded, payloadEncoded, signature] = parts;
    
    const expectedSignature = hmacSha256(`${headerEncoded}.${payloadEncoded}`, secret);
    
    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid signature' };
    }

    const payload = JSON.parse(base64UrlDecode(payloadEncoded));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return { valid: false, error: 'Token expired' };
    }

    return { valid: true, payload };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

function parseExpiresIn(expiresIn) {
  const now = Math.floor(Date.now() / 1000);
  
  if (typeof expiresIn === 'number') {
    return now + expiresIn;
  }

  const match = expiresIn.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error('Invalid expiresIn format');
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return now + value;
    case 'm': return now + value * 60;
    case 'h': return now + value * 3600;
    case 'd': return now + value * 86400;
    default: throw new Error('Invalid time unit');
  }
}

export default {
  sign,
  verify
};
