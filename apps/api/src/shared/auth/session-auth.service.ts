import { ForbiddenException, Injectable, UnauthorizedException } from '../../framework.js';
import { createHmac, randomBytes } from 'node:crypto';
import type { UserRole } from '@ldpass/contracts';
import { PrismaService } from '../database/prisma.service.js';
import {
  type ApiRequestLike,
  type ApiResponseLike,
  readClientIp,
  readHeader,
  readUserAgent,
} from './request-context.js';
import { serializeAuthCookie, serializeExpiredAuthCookies } from './cookie.js';

export const SESSION_COOKIE_NAME = 'ldpass_session';

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
  constructor(private readonly prisma: PrismaService) {}

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

  async clearSession(request: ApiRequestLike, response: ApiResponseLike): Promise<void> {
    const tokens = this.readSessionTokens(request);

    if (tokens.length > 0) {
      await this.prisma.authSession.updateMany({
        where: {
          tokenHash: {
            in: [...new Set(tokens.map((token) => this.hashSessionToken(token)))],
          },
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    this.clearSessionCookie(request, response);
  }

  async getCurrentUser(request: ApiRequestLike): Promise<AuthenticatedUser | null> {
    return (await this.getCurrentSession(request))?.user ?? null;
  }

  async getCurrentSession(request: ApiRequestLike): Promise<AuthenticatedSessionContext | null> {
    const tokens = this.readSessionTokens(request);

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

  private readSessionToken(request: ApiRequestLike): string | null {
    return this.readSessionTokens(request)[0] ?? null;
  }

  private readSessionTokens(request: ApiRequestLike): string[] {
    const cookieHeader = readHeader(request, 'cookie');
    if (!cookieHeader) {
      return [];
    }

    const cookies = cookieHeader.split(';').map((part) => part.trim());
    return cookies
      .filter((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
      .map((cookie) => decodeURIComponent(cookie.slice(SESSION_COOKIE_NAME.length + 1)))
      .filter(Boolean);
  }

  private hashSessionToken(token: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', secret).update(token).digest('base64url');
  }

  private resolveUserAvatarUrl(user: {
    avatarUrl?: string | null;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
  }): string | null {
    return (
      user.avatarUrl ??
      this.buildMinecraftAvatarUrl(user.serverAccountName, user.serverAccountVerified, 'minotar-helm')
    );
  }

  private resolveUserAvatarFallbackUrl(user: {
    avatarUrl?: string | null;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
  }): string | null {
    return this.buildMinecraftAvatarUrl(user.serverAccountName, user.serverAccountVerified, 'minotar-avatar');
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
    response.setHeader(
      'Set-Cookie',
      serializeAuthCookie(request, SESSION_COOKIE_NAME, token, {
        expiresAt,
        maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      }),
    );
  }

  private clearSessionCookie(request: ApiRequestLike, response: ApiResponseLike): void {
    response.setHeader('Set-Cookie', serializeExpiredAuthCookies(request, SESSION_COOKIE_NAME));
  }
}
