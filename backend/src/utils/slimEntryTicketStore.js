import { randomUUID } from 'crypto';

const DEFAULT_TTL_MS = 60 * 1000;
const REDEEM_GRACE_TTL_MS = 15 * 1000;
const REDEEM_GRACE_MAX_USES = 8;
const tickets = new Map();

function cleanupExpiredTickets(now = Date.now()) {
  for (const [ticket, payload] of tickets.entries()) {
    if (!payload || payload.expiresAt <= now) {
      tickets.delete(ticket);
    }
  }
}

export function createSlimEntryTicket({ userId, ttlMs = DEFAULT_TTL_MS } = {}) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error('无效的用户ID');
  }

  const now = Date.now();
  cleanupExpiredTickets(now);

  const ticket = randomUUID();
  tickets.set(ticket, {
    userId: normalizedUserId,
    expiresAt: now + Math.max(5000, Number(ttlMs) || DEFAULT_TTL_MS),
    redeemedAt: null,
    clientSignature: '',
    useCount: 0,
  });

  return {
    ticket,
    expiresInMs: Math.max(5000, Number(ttlMs) || DEFAULT_TTL_MS),
  };
}

export function consumeSlimEntryTicket(ticket, { userId, clientSignature = '' } = {}) {
  const token = String(ticket || '').trim();
  if (!token) {
    return { valid: false, reason: 'missing-ticket' };
  }

  const now = Date.now();
  cleanupExpiredTickets(now);

  const payload = tickets.get(token);
  if (!payload) {
    return { valid: false, reason: 'invalid-or-expired-ticket' };
  }

  const normalizedUserId = Number(userId);
  if (Number.isInteger(normalizedUserId) && normalizedUserId > 0 && payload.userId !== normalizedUserId) {
    return { valid: false, reason: 'ticket-user-mismatch' };
  }

  const normalizedSignature = String(clientSignature || '').trim();

  if (payload.redeemedAt !== null) {
    if (payload.expiresAt <= now) {
      tickets.delete(token);
      return { valid: false, reason: 'invalid-or-expired-ticket' };
    }

    if (payload.clientSignature && normalizedSignature && payload.clientSignature !== normalizedSignature) {
      return { valid: false, reason: 'ticket-client-mismatch' };
    }

    if (payload.useCount >= REDEEM_GRACE_MAX_USES) {
      tickets.delete(token);
      return { valid: false, reason: 'ticket-grace-exhausted' };
    }

    payload.useCount += 1;
    tickets.set(token, payload);

    return {
      valid: true,
      userId: payload.userId,
      expiresAt: payload.expiresAt,
    };
  }

  payload.redeemedAt = now;
  payload.clientSignature = normalizedSignature;
  payload.useCount = 1;
  payload.expiresAt = Math.min(payload.expiresAt, now + REDEEM_GRACE_TTL_MS);
  tickets.set(token, payload);

  return {
    valid: true,
    userId: payload.userId,
    expiresAt: payload.expiresAt,
  };
}
