import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { shouldUseSecureCookie } from '../../shared/auth/cookie.js';
import { readHeader } from '../../shared/auth/request-context.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';

const STATE_TTL_MS = 1000 * 60 * 10;
const STATE_COOKIE_PATH = '/api/auth/qq';

export const QQ_CONNECT_STATE_COOKIE = 'ldpass_qq_state';

export interface QqConnectStatePayload {
  state: string;
  redirectPath: string;
  expiresAt: number;
}

/**
 * 生成一次性的 state 与对应的签名 Cookie。
 *
 * state 的完整载荷（含回跳路径与过期时间）都放在这个 HttpOnly Cookie 里，
 * 并用 SESSION_SECRET 做 HMAC 签名；回调时既校验签名也校验 state 是否一致，
 * 避免 CSRF 和「回调地址被塞入任意跳转」两种情况。
 */
export function createQqConnectState(
  secret: string,
  redirectPath: string,
): { state: string; cookieValue: string } {
  const payload: QqConnectStatePayload = {
    state: randomBytes(18).toString('base64url'),
    redirectPath,
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

  return {
    state: payload.state,
    cookieValue: `${encoded}.${signStatePayload(secret, encoded)}`,
  };
}

export function readQqConnectState(
  secret: string,
  cookieValue: string | undefined,
): QqConnectStatePayload | null {
  if (!cookieValue) {
    return null;
  }

  const separatorIndex = cookieValue.lastIndexOf('.');

  if (separatorIndex <= 0) {
    return null;
  }

  const encoded = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);

  if (!isSameSignature(signStatePayload(secret, encoded), signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const candidate = parsed as Partial<QqConnectStatePayload>;

    if (
      typeof candidate.state !== 'string' ||
      typeof candidate.redirectPath !== 'string' ||
      typeof candidate.expiresAt !== 'number'
    ) {
      return null;
    }

    if (candidate.expiresAt <= Date.now()) {
      return null;
    }

    return {
      state: candidate.state,
      redirectPath: candidate.redirectPath,
      expiresAt: candidate.expiresAt,
    };
  } catch {
    return null;
  }
}

export function isSameQqConnectState(expected: string, received: string | undefined): boolean {
  if (!received) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function serializeQqConnectStateCookie(request: ApiRequestLike, value: string): string {
  return [
    `${QQ_CONNECT_STATE_COOKIE}=${encodeURIComponent(value)}`,
    `Path=${STATE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(STATE_TTL_MS / 1000)}`,
    ...(shouldUseSecureCookie(request) ? ['Secure'] : []),
  ].join('; ');
}

export function serializeExpiredQqConnectStateCookie(): string {
  return [
    `${QQ_CONNECT_STATE_COOKIE}=`,
    `Path=${STATE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; ');
}

export function readCookieValue(request: ApiRequestLike, name: string): string | undefined {
  const cookieHeader = readHeader(request, 'cookie');

  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();

    if (!trimmed.startsWith(`${name}=`)) {
      continue;
    }

    const rawValue = trimmed.slice(name.length + 1);

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
}

/**
 * 只允许站内相对路径回跳，避免用 state 携带开放式重定向。
 */
export function normalizeQqConnectRedirectPath(rawValue: string | undefined): string {
  const fallback = '/account';
  const value = rawValue?.trim();

  if (!value || value.length > 200) {
    return fallback;
  }

  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }

  if (value.startsWith('/api/')) {
    return fallback;
  }

  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return fallback;
  }

  return value;
}

function signStatePayload(secret: string, encoded: string): string {
  return createHmac('sha256', secret).update(`qq-connect-state:${encoded}`).digest('base64url');
}

function isSameSignature(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
