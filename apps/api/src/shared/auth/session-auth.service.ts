import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
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

  async createSession(userId: string, request: ApiRequestLike, response: ApiResponseLike, deviceId?: string): Promise<void> {
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

    this.setSessionCookie(response, token, expiresAt);
  }

  async clearSession(request: ApiRequestLike, response: ApiResponseLike): Promise<void> {
    const token = this.readSessionToken(request);

    if (token) {
      await this.prisma.authSession.updateMany({
        where: {
          tokenHash: this.hashSessionToken(token),
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    this.clearSessionCookie(response);
  }

  async getCurrentUser(request: ApiRequestLike): Promise<AuthenticatedUser | null> {
    return (await this.getCurrentSession(request))?.user ?? null;
  }

  async getCurrentSession(request: ApiRequestLike): Promise<AuthenticatedSessionContext | null> {
    const token = this.readSessionToken(request);

    if (!token) {
      return null;
    }

    const session = await this.prisma.authSession.findUnique({
      where: {
        tokenHash: this.hashSessionToken(token),
      },
      include: {
        user: true,
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
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
    const cookieHeader = readHeader(request, 'cookie');
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';').map((part) => part.trim());
    const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
    if (!sessionCookie) {
      return null;
    }

    return decodeURIComponent(sessionCookie.slice(SESSION_COOKIE_NAME.length + 1));
  }

  private hashSessionToken(token: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', secret).update(token).digest('base64url');
  }

  private setSessionCookie(response: ApiResponseLike, token: string, expiresAt: Date): void {
    response.setHeader(
      'Set-Cookie',
      this.serializeCookie(SESSION_COOKIE_NAME, token, {
        expiresAt,
        maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      }),
    );
  }

  private clearSessionCookie(response: ApiResponseLike): void {
    response.setHeader(
      'Set-Cookie',
      this.serializeCookie(SESSION_COOKIE_NAME, '', {
        expiresAt: new Date(0),
        maxAgeSeconds: 0,
      }),
    );
  }

  private serializeCookie(
    name: string,
    value: string,
    options: {
      expiresAt: Date;
      maxAgeSeconds: number;
    },
  ): string {
    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Expires=${options.expiresAt.toUTCString()}`,
      `Max-Age=${options.maxAgeSeconds}`,
    ];

    const cookieDomain = process.env.AUTH_COOKIE_DOMAIN;
    if (process.env.NODE_ENV === 'production' && cookieDomain) {
      parts.push(`Domain=${cookieDomain}`);
      parts.push('Secure');
    }

    return parts.join('; ');
  }
}
