import { HttpException, HttpStatus } from '../../framework.js';
import { readClientIp, type ApiRequestLike } from './request-context.js';

interface ThrottleOptions {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
}

interface FailureRecord {
  count: number;
  windowStartedAt: number;
  lockedUntil: number;
}

export interface LoginThrottleKeys {
  accountKey: string | null;
  ipKey: string;
}

const records = new Map<string, FailureRecord>();
const maxTrackedKeys = 5000;
const loginLockedMessage = '登录尝试过于频繁，请稍后再试。';
const pinLockedMessage = 'PIN 校验失败次数过多，请稍后再试。';

export function createLoginThrottleKeys(
  identifier: string,
  request?: ApiRequestLike,
): LoginThrottleKeys {
  const normalizedIdentifier = identifier.trim().toLowerCase();

  return {
    accountKey: normalizedIdentifier ? `login:account:${normalizedIdentifier}` : null,
    ipKey: `login:ip:${request ? readClientIp(request) : 'unknown'}`,
  };
}

export function assertLoginThrottleAllowed(keys: LoginThrottleKeys): void {
  const accountOptions = readThrottleOptions('AUTH_LOGIN', 5);
  const ipOptions = readThrottleOptions('AUTH_LOGIN_IP', 20);

  if (keys.accountKey) {
    assertAllowed(keys.accountKey, accountOptions, loginLockedMessage);
  }

  assertAllowed(keys.ipKey, ipOptions, loginLockedMessage);
}

export function recordLoginThrottleFailure(keys: LoginThrottleKeys): void {
  if (keys.accountKey) {
    recordFailure(keys.accountKey, readThrottleOptions('AUTH_LOGIN', 5));
  }

  recordFailure(keys.ipKey, readThrottleOptions('AUTH_LOGIN_IP', 20));
}

export function resetLoginThrottle(keys: LoginThrottleKeys): void {
  if (keys.accountKey) {
    records.delete(keys.accountKey);
  }
}

export function assertPinThrottleAllowed(userId: string): void {
  assertAllowed(`pin:${userId}`, readThrottleOptions('AUTH_PIN', 5), pinLockedMessage);
}

export function recordPinThrottleFailure(userId: string): void {
  recordFailure(`pin:${userId}`, readThrottleOptions('AUTH_PIN', 5));
}

export function resetPinThrottle(userId: string): void {
  records.delete(`pin:${userId}`);
}

function assertAllowed(key: string, options: ThrottleOptions, message: string): void {
  const record = records.get(key);
  if (!record) {
    return;
  }

  const now = Date.now();
  if (record.lockedUntil > now) {
    throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }

  if (now - record.windowStartedAt > options.windowMs) {
    records.delete(key);
  }
}

function recordFailure(key: string, options: ThrottleOptions): void {
  const now = Date.now();
  const record = records.get(key);

  if (!record || now - record.windowStartedAt > options.windowMs) {
    records.set(key, { count: 1, windowStartedAt: now, lockedUntil: 0 });
    pruneRecords();
    return;
  }

  record.count += 1;

  if (record.count >= options.maxAttempts) {
    record.count = 0;
    record.windowStartedAt = now;
    record.lockedUntil = now + options.lockMs;
  }
}

function pruneRecords(): void {
  if (records.size <= maxTrackedKeys) {
    return;
  }

  const now = Date.now();
  for (const [key, record] of records) {
    if (record.lockedUntil <= now && now - record.windowStartedAt > 60 * 60 * 1000) {
      records.delete(key);
    }
  }
}

function readThrottleOptions(prefix: string, defaultMaxAttempts: number): ThrottleOptions {
  return {
    maxAttempts: readPositiveInteger(`${prefix}_MAX_ATTEMPTS`, defaultMaxAttempts),
    windowMs: readPositiveInteger(`${prefix}_WINDOW_SECONDS`, 900) * 1000,
    lockMs: readPositiveInteger(`${prefix}_LOCK_SECONDS`, 900) * 1000,
  };
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
