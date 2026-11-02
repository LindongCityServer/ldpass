import { NotFoundException } from '../../framework.js';
import { readHeader, type ApiRequestLike } from './request-context.js';

const LOCAL_DEV_ADMIN_LOGIN_ENV = 'LDPASS_LOCAL_DEV_ADMIN_LOGIN';

/**
 * 本地开发用的管理员免密登录开关。
 *
 * 默认关闭，必须显式设置 LDPASS_LOCAL_DEV_ADMIN_LOGIN=1 才会启用；
 * 生产运行或非本机回环请求都会被拒绝。
 */
export function isLocalDevAdminLoginEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  const configuredValue = process.env[LOCAL_DEV_ADMIN_LOGIN_ENV]?.trim().toLowerCase();
  return configuredValue === '1' || configuredValue === 'true' || configuredValue === 'on';
}

export function resolveRequestHostname(request: ApiRequestLike): string | null {
  // 只信任 Host 头，避免客户端伪造 X-Forwarded-Host 绕过回环判断。
  const host = readHeader(request, 'host');

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
