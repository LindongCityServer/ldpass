import { randomUUID } from 'node:crypto';
import type { UserStatus } from '@ldpass/contracts';
import { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '../../framework.js';
import { SessionAuthService } from '../../shared/auth/session-auth.service.js';
import type { ApiRequestLike, ApiResponseLike } from '../../shared/auth/request-context.js';
import { readSecretValue } from '../../shared/auth/secret-config.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import {
  QQ_CONNECT_AUTHORIZE_ENDPOINT,
  QQ_CONNECT_OPENID_ENDPOINT,
  QQ_CONNECT_REQUEST_TIMEOUT_MS,
  QQ_CONNECT_SCOPE,
  QQ_CONNECT_TOKEN_ENDPOINT,
  QQ_CONNECT_USER_INFO_ENDPOINT,
  isQqConnectConfigured,
  readQqConnectConfig,
  type QqConnectConfig,
} from './qq-connect.config.js';
import {
  QQ_CONNECT_STATE_COOKIE,
  createQqConnectState,
  isSameQqConnectState,
  normalizeQqConnectRedirectPath,
  readCookieValue,
  readQqConnectState,
  serializeQqConnectStateCookie,
} from './qq-connect-state.js';

export interface QqConnectStatus {
  enabled: boolean;
}

export type QqConnectRejectionReason =
  | 'disabled'
  | 'state'
  | 'denied'
  | 'failed'
  | 'conflict'
  | 'inactive'
  | 'unavailable';

export type QqConnectAuthorizationStart = {
  authorizeUrl: string;
  stateCookie: string;
};

export type QqConnectCallbackResult =
  | { kind: 'login'; redirectPath: string }
  | { kind: 'bound' }
  | { kind: 'unbound' }
  | { kind: 'rejected'; reason: QqConnectRejectionReason };

export interface QqConnectCallbackInput {
  request: ApiRequestLike;
  response: ApiResponseLike;
  code?: string;
  state?: string;
  error?: string;
}

interface QqConnectProfile {
  nickname: string | null;
  avatarUrl: string | null;
}

@Injectable()
export class QqConnectService {
  private readonly logger = new Logger('QqConnectService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionAuth: SessionAuthService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  readStatus(): QqConnectStatus {
    return { enabled: isQqConnectConfigured() };
  }

  /**
   * 生成 QQ 互联授权跳转地址与配套的 state Cookie。
   */
  createAuthorization(
    request: ApiRequestLike,
    rawRedirectPath: string | undefined,
  ): QqConnectAuthorizationStart {
    const config = readQqConnectConfig(request);

    if (!config) {
      throw new ServiceUnavailableException('QQ 登录尚未配置，请联系管理员。');
    }

    const { state, cookieValue } = createQqConnectState(
      this.readStateSecret(),
      normalizeQqConnectRedirectPath(rawRedirectPath),
    );
    const authorizeUrl = new URL(QQ_CONNECT_AUTHORIZE_ENDPOINT);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', config.appId);
    authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', QQ_CONNECT_SCOPE);
    authorizeUrl.searchParams.set('display', 'pc');

    return {
      authorizeUrl: authorizeUrl.toString(),
      stateCookie: serializeQqConnectStateCookie(request, cookieValue),
    };
  }

  /**
   * 处理 QQ 互联回调：校验 state → 换 access_token → 取 openid → 绑定或登录。
   *
   * 预期内的失败不会抛异常，而是返回 rejected，由控制器跳回登录页并带上提示码。
   */
  async completeAuthorization(input: QqConnectCallbackInput): Promise<QqConnectCallbackResult> {
    const config = readQqConnectConfig(input.request);

    if (!config) {
      return { kind: 'rejected', reason: 'disabled' };
    }

    if (input.error) {
      return { kind: 'rejected', reason: 'denied' };
    }

    const statePayload = readQqConnectState(
      this.readStateSecret(),
      readCookieValue(input.request, QQ_CONNECT_STATE_COOKIE),
    );

    if (!statePayload || !isSameQqConnectState(statePayload.state, input.state)) {
      return { kind: 'rejected', reason: 'state' };
    }

    if (!input.code) {
      return { kind: 'rejected', reason: 'state' };
    }

    try {
      const accessToken = await this.exchangeAuthorizationCode(config, input.code);
      const identity = await this.fetchOpenId(config, accessToken);
      const profile = await this.fetchProfile(config, accessToken, identity.openId);

      return await this.resolveAccount({
        request: input.request,
        response: input.response,
        openId: identity.openId,
        unionId: identity.unionId,
        profile,
        redirectPath: normalizeQqConnectRedirectPath(statePayload.redirectPath),
      });
    } catch (error) {
      this.logger.warn(
        `QQ 登录回调处理失败：${error instanceof Error ? error.message : String(error)}`,
      );

      return { kind: 'rejected', reason: 'failed' };
    }
  }

  private async resolveAccount(input: {
    request: ApiRequestLike;
    response: ApiResponseLike;
    openId: string;
    unionId: string | null;
    profile: QqConnectProfile;
    redirectPath: string;
  }): Promise<QqConnectCallbackResult> {
    const binding = await this.prisma.qqConnectBinding.findUnique({
      where: { openId: input.openId },
    });

    if (binding) {
      const user = await this.prisma.user.findUnique({ where: { id: binding.userId } });

      if (!user || user.status === 'Deleted') {
        return { kind: 'rejected', reason: 'unavailable' };
      }

      await this.prisma.qqConnectBinding.update({
        where: { id: binding.id },
        data: {
          lastLoginAt: new Date(),
          nickname: input.profile.nickname ?? binding.nickname,
          avatarUrl: input.profile.avatarUrl ?? binding.avatarUrl,
          unionId: input.unionId ?? binding.unionId,
        },
      });
      await this.sessionAuth.createSession(user.id, input.request, input.response);
      await this.publishLoggedIn(user.id, user.status);

      return { kind: 'login', redirectPath: input.redirectPath };
    }

    const currentSession = await this.sessionAuth.getCurrentSession(input.request);

    if (!currentSession) {
      return { kind: 'unbound' };
    }

    if (currentSession.user.status !== 'Active') {
      return { kind: 'rejected', reason: 'inactive' };
    }

    try {
      await this.prisma.qqConnectBinding.create({
        data: {
          userId: currentSession.user.id,
          openId: input.openId,
          unionId: input.unionId,
          nickname: input.profile.nickname,
          avatarUrl: input.profile.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { kind: 'rejected', reason: 'conflict' };
      }

      throw error;
    }

    return { kind: 'bound' };
  }

  private async exchangeAuthorizationCode(
    config: QqConnectConfig,
    code: string,
  ): Promise<string> {
    const url = new URL(QQ_CONNECT_TOKEN_ENDPOINT);
    url.searchParams.set('grant_type', 'authorization_code');
    url.searchParams.set('client_id', config.appId);
    url.searchParams.set('client_secret', config.appKey);
    url.searchParams.set('code', code);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('fmt', 'json');

    const payload = await this.requestQqJson(url);
    const accessToken = readTrimmedString(payload.access_token);

    if (!accessToken) {
      throw new Error('QQ 未返回 access_token。');
    }

    return accessToken;
  }

  private async fetchOpenId(
    config: QqConnectConfig,
    accessToken: string,
  ): Promise<{ openId: string; unionId: string | null }> {
    const url = new URL(QQ_CONNECT_OPENID_ENDPOINT);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('fmt', 'json');

    const payload = await this.requestQqJson(url);
    const openId = readTrimmedString(payload.openid);
    const clientId = readTrimmedString(payload.client_id);

    if (!openId) {
      throw new Error('QQ 未返回 openid。');
    }

    // 防止用另一个 appid 的 access_token 混进来。
    if (clientId && clientId !== config.appId) {
      throw new Error('QQ 返回的 client_id 与当前应用不一致。');
    }

    return { openId, unionId: readTrimmedString(payload.unionid) ?? null };
  }

  /**
   * 昵称与头像只是展示快照，接口失败（例如未开通对应权限）不应阻断登录。
   */
  private async fetchProfile(
    config: QqConnectConfig,
    accessToken: string,
    openId: string,
  ): Promise<QqConnectProfile> {
    const url = new URL(QQ_CONNECT_USER_INFO_ENDPOINT);
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('oauth_consumer_key', config.appId);
    url.searchParams.set('openid', openId);
    url.searchParams.set('fmt', 'json');

    try {
      const payload = await this.requestQqJson(url);

      if (payload.ret !== 0 && payload.ret !== '0') {
        return { nickname: null, avatarUrl: null };
      }

      const nickname = readTrimmedString(payload.nickname)?.slice(0, 64) ?? null;
      const avatarUrl =
        readTrimmedString(payload.figureurl_qq_2)?.slice(0, 500) ??
        readTrimmedString(payload.figureurl_qq_1)?.slice(0, 500) ??
        null;

      return { nickname, avatarUrl };
    } catch (error) {
      this.logger.warn(
        `读取 QQ 用户资料失败（不影响登录）：${error instanceof Error ? error.message : String(error)}`,
      );

      return { nickname: null, avatarUrl: null };
    }
  }

  private async requestQqJson(url: URL): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(QQ_CONNECT_REQUEST_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
      },
    });
    const body = await response.text();
    const payload = parseQqPayload(body);

    if (!payload) {
      throw new Error(`QQ 接口返回了无法解析的响应（HTTP ${response.status}）。`);
    }

    if (payload.error !== undefined && payload.error !== null) {
      throw new Error(
        `QQ 接口返回错误：${String(payload.error)} ${String(payload.error_description ?? '')}`.trim(),
      );
    }

    return payload;
  }

  private readStateSecret(): string {
    const secret = readSecretValue('SESSION_SECRET');

    if (!secret) {
      throw new ServiceUnavailableException('缺少 SESSION_SECRET，无法签名 QQ 登录 state。');
    }

    return secret;
  }

  private async publishLoggedIn(userId: string, accountStatus: UserStatus): Promise<void> {
    await this.eventBus.publish({
      type: 'UserLoggedIn',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: userId,
      payload: {
        userId,
        accountStatus,
        restricted: accountStatus !== 'Active',
      },
    });
  }
}

/**
 * QQ 部分接口会返回 `callback( {...} );` 包装（例如授权页 /me 的默认格式），
 * 这里只截取 JSON 主体，既兼容纯 JSON 也兼容 JSONP。
 */
function parseQqPayload(body: string): Record<string, unknown> | null {
  const trimmed = body.trim();
  const startIndex = trimmed.indexOf('{');
  const endIndex = trimmed.lastIndexOf('}');

  if (startIndex < 0 || endIndex <= startIndex) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed.slice(startIndex, endIndex + 1)) as unknown;

    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
