import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '../../framework.js';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { UserRole } from '@ldpass/contracts';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { PrismaService } from '../database/prisma.service.js';
import {
  type ApiRequestLike,
  type ApiResponseLike,
  readClientIp,
  readHeader,
  readUserAgent,
} from './request-context.js';
import {
  serializeAuthCookie,
  serializeExpiredEmbeddedAuthCookie,
  serializeExpiredAuthCookies,
} from './cookie.js';

export const SESSION_COOKIE_NAME = 'ldpass_session';
const CLIENT_SESSION_COOKIE_PREFIX = 'ldpass_client_session_';
const CLIENT_SESSION_TTL_MS = 1000 * 60 * 5;
type ClientSessionDeliveryMode = 'top_level' | 'embedded';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  status: string;
  reviewInfo: string | null;
  reviewRejectedReason: string | null;
  serverAccountName: string | null;
  serverAccountVerified: boolean;
  avatarUrl: string | null;
  avatarFallbackUrl: string | null;
  expirationReminderDays: number;
}

export interface AuthenticatedSessionContext {
  user: AuthenticatedUser;
  sessionId: string;
  deviceId: string | null;
}

@Injectable()
export class SessionAuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async createSession(
    userId: string,
    request: ApiRequestLike,
    response: ApiResponseLike,
    deviceId?: string,
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await this.prisma.authSession.create({
      data: {
        userId,
        deviceId: deviceId ?? null,
        tokenHash: this.hashSessionToken(token),
        userAgent: readUserAgent(request) ?? null,
        ipAddress: readClientIp(request),
        expiresAt,
      },
    });

    this.setSessionCookie(request, response, token, expiresAt);
  }

  async createClientApplicationSession(
    userId: string,
    clientId: string,
    request: ApiRequestLike,
    response: ApiResponseLike,
    options: {
      localSessionPreserved: boolean;
      deliveryMode?: ClientSessionDeliveryMode;
    },
  ): Promise<void> {
    const deliveryMode = options.deliveryMode ?? 'top_level';
    const cookieName = this.createClientSessionCookieName(clientId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + CLIENT_SESSION_TTL_MS);
    const previousTokenHashes = this.readCookieTokens(request, cookieName).map((previousToken) =>
      this.hashClientSessionToken(cookieName, previousToken),
    );

    if (previousTokenHashes.length > 0) {
      await this.prisma.authSession.updateMany({
        where: {
          tokenHash: {
            in: [...new Set(previousTokenHashes)],
          },
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    const session = await this.prisma.authSession.create({
      data: {
        userId,
        deviceId: null,
        tokenHash: this.hashClientSessionToken(cookieName, token),
        userAgent: readUserAgent(request) ?? null,
        ipAddress: readClientIp(request),
        expiresAt,
      },
    });

    this.appendResponseCookie(
      response,
      serializeAuthCookie(request, cookieName, token, {
        expiresAt,
        maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
        ...(deliveryMode === 'embedded'
          ? {
              domainMode: 'hostOnly',
              sameSite: 'None',
              partitioned: true,
            }
          : {}),
      }),
    );

    await this.eventBus.publish({
      type: 'ExternalClientSessionIssued',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: userId,
      payload: {
        userId,
        clientId,
        sessionId: session.id,
        expiresAt: expiresAt.toISOString(),
        localSessionPreserved: options.localSessionPreserved,
        deliveryMode,
      },
    });
  }

  async clearSession(request: ApiRequestLike, response: ApiResponseLike): Promise<void> {
    const mainTokens = this.readCookieTokens(request, SESSION_COOKIE_NAME);
    const clientSessionCookies = this.readClientSessionCookies(request);
    const tokenHashes = [
      ...mainTokens.map((token) => this.hashSessionToken(token)),
      ...clientSessionCookies.flatMap(({ name, tokens }) =>
        tokens.map((token) => this.hashClientSessionToken(name, token)),
      ),
    ];

    if (tokenHashes.length > 0) {
      await this.prisma.authSession.updateMany({
        where: {
          tokenHash: {
            in: [...new Set(tokenHashes)],
          },
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    response.setHeader('Set-Cookie', [
      ...serializeExpiredAuthCookies(request, SESSION_COOKIE_NAME),
      ...clientSessionCookies.flatMap(({ name }) => [
        ...serializeExpiredAuthCookies(request, name),
        serializeExpiredEmbeddedAuthCookie(request, name),
      ]),
    ]);
  }

  async getCurrentUser(request: ApiRequestLike): Promise<AuthenticatedUser | null> {
    return (await this.getCurrentSession(request))?.user ?? null;
  }

  async getCurrentSession(request: ApiRequestLike): Promise<AuthenticatedSessionContext | null> {
    const tokens = this.readCookieTokens(request, SESSION_COOKIE_NAME);

    if (tokens.length === 0) {
      return null;
    }

    const tokenHashes = [...new Set(tokens.map((token) => this.hashSessionToken(token)))];
    const session = await this.prisma.authSession.findFirst({
      where: {
        tokenHash: {
          in: tokenHashes,
        },
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!session) {
      return null;
    }

    const user = session.user;

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
        reviewInfo: user.reviewInfo,
        reviewRejectedReason: user.reviewRejectedReason,
        serverAccountName: user.serverAccountName,
        serverAccountVerified: user.serverAccountVerified,
        avatarUrl: this.resolveUserAvatarUrl(user),
        avatarFallbackUrl: this.resolveUserAvatarFallbackUrl(user),
        expirationReminderDays: user.expirationReminderDays,
      },
      sessionId: session.id,
      deviceId: session.deviceId,
    };
  }

  async getClientApplicationUser(
    request: ApiRequestLike,
    clientId: string,
  ): Promise<AuthenticatedUser | null> {
    const cookieName = this.createClientSessionCookieName(clientId);
    const tokens = this.readCookieTokens(request, cookieName);

    if (tokens.length > 0) {
      const tokenHashes = [
        ...new Set(tokens.map((token) => this.hashClientSessionToken(cookieName, token))),
      ];
      const session = await this.prisma.authSession.findFirst({
        where: {
          tokenHash: {
            in: tokenHashes,
          },
          revokedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (session) {
        return {
          id: session.user.id,
          username: session.user.username,
          email: session.user.email,
          role: session.user.role,
          status: session.user.status,
          reviewInfo: session.user.reviewInfo,
          reviewRejectedReason: session.user.reviewRejectedReason,
          serverAccountName: session.user.serverAccountName,
          serverAccountVerified: session.user.serverAccountVerified,
          avatarUrl: this.resolveUserAvatarUrl(session.user),
          avatarFallbackUrl: this.resolveUserAvatarFallbackUrl(session.user),
          expirationReminderDays: session.user.expirationReminderDays,
        };
      }
    }

    return this.getCurrentUser(request);
  }

  async requireUser(request: ApiRequestLike): Promise<AuthenticatedUser> {
    const user = await this.getCurrentUser(request);

    if (!user) {
      throw new UnauthorizedException('请先登录。');
    }

    return user;
  }

  async requireActiveUser(request: ApiRequestLike): Promise<AuthenticatedUser> {
    const user = await this.requireUser(request);

    if (user.status !== 'Active') {
      throw new ForbiddenException('账户尚未激活，暂不能使用卡包功能。');
    }

    return user;
  }

  async requireSession(request: ApiRequestLike): Promise<AuthenticatedSessionContext> {
    const session = await this.getCurrentSession(request);

    if (!session) {
      throw new UnauthorizedException('请先登录。');
    }

    return session;
  }

  async requireActiveSession(request: ApiRequestLike): Promise<AuthenticatedSessionContext> {
    const session = await this.requireSession(request);

    if (session.user.status !== 'Active') {
      throw new ForbiddenException('账户尚未激活，暂不能使用账户安全设置。');
    }

    return session;
  }

  async requireAdmin(request: ApiRequestLike): Promise<AuthenticatedUser> {
    const user = await this.requireActiveUser(request);

    if (user.role !== 'admin' && user.role !== 'super_admin') {
      throw new ForbiddenException('需要管理员权限。');
    }

    return user;
  }

  private readCookieTokens(request: ApiRequestLike, name: string): string[] {
    const cookieHeader = readHeader(request, 'cookie');
    if (!cookieHeader) {
      return [];
    }

    const cookies = cookieHeader.split(';').map((part) => part.trim());
    return cookies
      .filter((cookie) => cookie.startsWith(`${name}=`))
      .map((cookie) => decodeURIComponent(cookie.slice(name.length + 1)))
      .filter(Boolean);
  }

  private readClientSessionCookies(
    request: ApiRequestLike,
  ): Array<{ name: string; tokens: string[] }> {
    const cookieHeader = readHeader(request, 'cookie');
    if (!cookieHeader) {
      return [];
    }

    const names = [
      ...new Set(
        cookieHeader
          .split(';')
          .map((part) => part.trim().split('=', 1)[0] ?? '')
          .filter((name) => name.startsWith(CLIENT_SESSION_COOKIE_PREFIX)),
      ),
    ];

    return names.map((name) => ({
      name,
      tokens: this.readCookieTokens(request, name),
    }));
  }

  private hashSessionToken(token: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', secret).update(token).digest('base64url');
  }

  private hashClientSessionToken(cookieName: string, token: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', secret)
      .update(`client-session:${cookieName}:${token}`)
      .digest('base64url');
  }

  private createClientSessionCookieName(clientId: string): string {
    const suffix = createHash('sha256').update(clientId).digest('hex').slice(0, 20);
    return `${CLIENT_SESSION_COOKIE_PREFIX}${suffix}`;
  }

  private resolveUserAvatarUrl(user: {
    avatarUrl?: string | null;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
  }): string | null {
    return (
      user.avatarUrl ??
      this.buildMinecraftAvatarUrl(
        user.serverAccountName,
        user.serverAccountVerified,
        'minotar-helm',
      )
    );
  }

  private resolveUserAvatarFallbackUrl(user: {
    avatarUrl?: string | null;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
  }): string | null {
    return this.buildMinecraftAvatarUrl(
      user.serverAccountName,
      user.serverAccountVerified,
      'minotar-avatar',
    );
  }

  private buildMinecraftAvatarUrl(
    serverAccountName: string | null | undefined,
    verified: boolean,
    provider: 'minotar-helm' | 'minotar-avatar',
  ): string | null {
    const normalizedName = serverAccountName?.trim();
    if (!verified || !normalizedName) {
      return null;
    }

    const encodedName = encodeURIComponent(normalizedName);
    return provider === 'minotar-helm'
      ? `https://minotar.net/helm/${encodedName}`
      : `https://minotar.net/avatar/${encodedName}/64.png`;
  }

  private setSessionCookie(
    request: ApiRequestLike,
    response: ApiResponseLike,
    token: string,
    expiresAt: Date,
  ): void {
    this.appendResponseCookie(
      response,
      serializeAuthCookie(request, SESSION_COOKIE_NAME, token, {
        expiresAt,
        maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      }),
    );
  }

  private appendResponseCookie(response: ApiResponseLike, cookie: string): void {
    const existingHeader = response.getHeader?.('Set-Cookie');
    const existingCookies = Array.isArray(existingHeader)
      ? existingHeader.map(String)
      : typeof existingHeader === 'string'
        ? [existingHeader]
        : [];
    response.setHeader('Set-Cookie', [...existingCookies, cookie]);
  }
}
