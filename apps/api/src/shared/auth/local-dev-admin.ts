import { NotFoundException } from '../../framework.js';
import { readHeader, type ApiRequestLike } from './request-context.js';

const LOCAL_DEV_ADMIN_LOGIN_ENV = 'LDPASS_LOCAL_DEV_ADMIN_LOGIN';

/**
 * 本地开发用的管理员免密登录开关。
 *
 * 只有在非 production 运行时才会启用，且实际请求必须来自本机回环地址；
 * 生产构建或显式设置 LDPASS_LOCAL_DEV_ADMIN_LOGIN=0 都会关闭该入口。
 */
export function isLocalDevAdminLoginEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  const configuredValue = process.env[LOCAL_DEV_ADMIN_LOGIN_ENV]?.trim().toLowerCase();
  return configuredValue !== '0' && configuredValue !== 'false' && configuredValue !== 'off';
}

export function resolveRequestHostname(request: ApiRequestLike): string | null {
  const forwardedHost = readHeader(request, 'x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || readHeader(request, 'host');

  if (!host) {
    return null;
  }

  try {
    return new URL(`http://${host}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}

export function isLoopbackHostname(hostname: string | null): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '0.0.0.0' ||
    hostname === '::1'
  );
}

export function assertLocalDevAdminLoginAllowed(request: ApiRequestLike): void {
  if (!isLocalDevAdminLoginEnabled() || !isLoopbackHostname(resolveRequestHostname(request))) {
    throw new NotFoundException('本地管理员登录仅在开发环境的本机地址可用。');
  }

  const origin = readHeader(request, 'origin');

  if (origin && !isLoopbackHostname(readOriginHostname(origin))) {
    throw new NotFoundException('本地管理员登录请求来源无效。');
  }
}

function readOriginHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return null;
  }
}
