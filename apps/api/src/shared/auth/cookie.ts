import type { ApiRequestLike } from './request-context.js';
import { readHeader } from './request-context.js';

export interface AuthCookieOptions {
  expiresAt: Date;
  maxAgeSeconds: number;
  domainMode?: 'configured' | 'hostOnly';
  sameSite?: 'Lax' | 'None';
  partitioned?: boolean;
}

export function serializeAuthCookie(
  request: ApiRequestLike,
  name: string,
  value: string,
  options: AuthCookieOptions,
): string {
  const sameSite = options.sameSite ?? 'Lax';
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSite}`,
    `Expires=${options.expiresAt.toUTCString()}`,
    `Max-Age=${options.maxAgeSeconds}`,
  ];

  const cookieDomain =
    options.domainMode === 'hostOnly'
      ? null
      : normalizeCookieDomain(process.env.AUTH_COOKIE_DOMAIN);
  if (cookieDomain) {
    parts.push(`Domain=${cookieDomain}`);
  }

  if (shouldUseSecureCookie(request) || sameSite === 'None' || options.partitioned) {
    parts.push('Secure');
  }

  if (options.partitioned) {
    parts.push('Partitioned');
  }

  return parts.join('; ');
}

export function serializeExpiredAuthCookies(request: ApiRequestLike, name: string): string[] {
  const options: AuthCookieOptions = {
    expiresAt: new Date(0),
    maxAgeSeconds: 0,
  };
  const cookies = [serializeAuthCookie(request, name, '', options)];

  if (normalizeCookieDomain(process.env.AUTH_COOKIE_DOMAIN)) {
    cookies.push(
      serializeAuthCookie(request, name, '', {
        ...options,
        domainMode: 'hostOnly',
      }),
    );
  }

  return cookies;
}

export function serializeExpiredEmbeddedAuthCookie(
  request: ApiRequestLike,
  name: string,
): string {
  return serializeAuthCookie(request, name, '', {
    expiresAt: new Date(0),
    maxAgeSeconds: 0,
    domainMode: 'hostOnly',
    sameSite: 'None',
    partitioned: true,
  });
}

function normalizeCookieDomain(value: string | undefined): string | null {
  const rawValue = value?.trim();
  if (!rawValue) {
    return null;
  }

  const host = readCookieDomainHost(rawValue);
  const normalizedHost = host.toLowerCase().replace(/^\./, '');
  if (!normalizedHost || normalizedHost === 'localhost') {
    return null;
  }

  if (!/^[a-z0-9.-]+$/.test(normalizedHost)) {
    return null;
  }

  return normalizedHost;
}

function readCookieDomainHost(value: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    try {
      return new URL(value).hostname;
    } catch {
      return value;
    }
  }

  return value.split('/')[0]?.split(':')[0] ?? value;
}

function shouldUseSecureCookie(request: ApiRequestLike): boolean {
  const configuredValue = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (configuredValue === 'true') {
    return true;
  }
  if (configuredValue === 'false') {
    return false;
  }

  const forwardedProto = readHeader(request, 'x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedProto === 'https') {
    return true;
  }

  return process.env.NODE_ENV === 'production';
}
