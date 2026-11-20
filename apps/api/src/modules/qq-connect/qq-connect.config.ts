import { readHeader } from '../../shared/auth/request-context.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { readSecretValue } from '../../shared/auth/secret-config.js';

export const QQ_CONNECT_AUTHORIZE_ENDPOINT = 'https://graph.qq.com/oauth2.0/authorize';
export const QQ_CONNECT_TOKEN_ENDPOINT = 'https://graph.qq.com/oauth2.0/token';
export const QQ_CONNECT_OPENID_ENDPOINT = 'https://graph.qq.com/oauth2.0/me';
export const QQ_CONNECT_USER_INFO_ENDPOINT = 'https://graph.qq.com/user/get_user_info';
export const QQ_CONNECT_CALLBACK_PATH = '/api/auth/qq/callback';
export const QQ_CONNECT_SCOPE = 'get_user_info';
export const QQ_CONNECT_REQUEST_TIMEOUT_MS = 8000;

export interface QqConnectConfig {
  appId: string;
  appKey: string;
  redirectUri: string;
}

/**
 * 读取 QQ 互联（网站应用 OAuth2.0）配置。
 *
 * redirect_uri 必须与 QQ 互联后台登记的回调地址「协议 + 域名 + path」完全一致，
 * 所以优先使用显式的 QQ_CONNECT_REDIRECT_URI；只有未配置时才按站点公开地址推导，
 * 推导结果仅适合本地调试，正式环境必须显式配置。
 */
export function readQqConnectConfig(request: ApiRequestLike): QqConnectConfig | null {
  if (!isQqConnectEnabled()) {
    return null;
  }

  const appId = readSecretValue('QQ_CONNECT_APP_ID');
  const appKey = readSecretValue('QQ_CONNECT_APP_KEY');
  const redirectUri = resolveQqConnectRedirectUri(request);

  if (!appId || !appKey || !redirectUri) {
    return null;
  }

  return { appId, appKey, redirectUri };
}

export function isQqConnectEnabled(): boolean {
  return process.env.QQ_CONNECT_ENABLED?.trim().toLowerCase() !== 'false';
}

/**
 * 是否具备发起 QQ 登录的最小配置（开关 + appid + appkey）。
 * 用于前端决定要不要显示「QQ 登录」入口。
 */
export function isQqConnectConfigured(): boolean {
  return (
    isQqConnectEnabled() &&
    Boolean(readSecretValue('QQ_CONNECT_APP_ID')) &&
    Boolean(readSecretValue('QQ_CONNECT_APP_KEY'))
  );
}

export function resolveQqConnectRedirectUri(request: ApiRequestLike): string | null {
  const configured = readSecretValue('QQ_CONNECT_REDIRECT_URI');

  if (configured) {
    return configured;
  }

  const origin = readConfiguredPublicOrigin() ?? readRequestOrigin(request);

  return origin ? `${origin}${QQ_CONNECT_CALLBACK_PATH}` : null;
}

function readConfiguredPublicOrigin(): string | null {
  const value = readSecretValue('LDPASS_PUBLIC_ORIGIN') ?? readSecretValue('WEB_ORIGIN');

  return value ? value.replace(/\/+$/g, '') : null;
}

function readRequestOrigin(request: ApiRequestLike): string | null {
  const forwardedProto = readHeader(request, 'x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = readHeader(request, 'x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost ?? readHeader(request, 'host')?.trim();
  const protocol = (forwardedProto ?? 'http').toLowerCase();

  if (!host || (protocol !== 'http' && protocol !== 'https')) {
    return null;
  }

  if (!/^[a-z0-9.:\-[\]]+$/i.test(host)) {
    return null;
  }

  return `${protocol}://${host}`;
}
