import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import {
  type ApiRequestLike,
  type ApiResponseLike,
  readClientIp,
  readHeader,
  readUserAgent,
} from './request-context.js';

export const PROVIDER_SESSION_COOKIE_NAME = 'ldpass_provider_session';

export interface AuthenticatedProviderAccount {
  id: string;
  providerId: string;
  providerName: string;
  providerSlug: string;
  providerStatus: string;
  providerLogoUrl: string | null;
  providerIntroductionUrl: string | null;
  providerContactName: string | null;
  providerContactEmail: string | null;
  providerBusinessInfo: string | null;
  email: string;
  displayName: string;
  status: string;
  role: string;
}

@Injectable()
export class ProviderAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(providerAccountId: string, request: ApiRequestLike, response: ApiResponseLike): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

    await this.prisma.providerAuthSession.create({
      data: {
        providerAccountId,
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
      await this.prisma.providerAuthSession.updateMany({
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

  async getCurrentProviderAccount(request: ApiRequestLike): Promise<AuthenticatedProviderAccount | null> {
    const token = this.readSessionToken(request);

    if (!token) {
      return null;
    }

    const session = await this.prisma.providerAuthSession.findUnique({
      where: {
        tokenHash: this.hashSessionToken(token),
      },
      include: {
        providerAccount: {
          include: {
            provider: true,
          },
        },
      },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      return null;
    }

    const account = session.providerAccount;

    return {
      id: account.id,
      providerId: account.providerId,
      providerName: account.provider.name,
      providerSlug: account.provider.slug,
      providerStatus: account.provider.status,
      providerLogoUrl: account.provider.logoUrl,
      providerIntroductionUrl: account.provider.introductionUrl,
      providerContactName: account.provider.contactName,
      providerContactEmail: account.provider.contactEmail,
      providerBusinessInfo: account.provider.businessInfo,
      email: account.email,
      displayName: account.displayName,
      status: account.status,
      role: account.role,
    };
  }

  async requireProviderAccount(request: ApiRequestLike): Promise<AuthenticatedProviderAccount> {
    const account = await this.getCurrentProviderAccount(request);

    if (!account) {
      throw new UnauthorizedException('请先登录发卡方后台。');
    }

    return account;
  }

  async requireActiveProvider(request: ApiRequestLike): Promise<AuthenticatedProviderAccount> {
    const account = await this.requireProviderAccount(request);

    if (account.status !== 'Active' || account.providerStatus !== 'Active') {
      throw new ForbiddenException('发卡方账号尚未启用。');
    }

    return account;
  }

  private readSessionToken(request: ApiRequestLike): string | null {
    const cookieHeader = readHeader(request, 'cookie');
    if (!cookieHeader) {
      return null;
    }

    const cookies = cookieHeader.split(';').map((part) => part.trim());
    const sessionCookie = cookies.find((cookie) => cookie.startsWith(`${PROVIDER_SESSION_COOKIE_NAME}=`));
    if (!sessionCookie) {
      return null;
    }

    return decodeURIComponent(sessionCookie.slice(PROVIDER_SESSION_COOKIE_NAME.length + 1));
  }

  private hashSessionToken(token: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', secret).update(`provider:${token}`).digest('base64url');
  }

  private setSessionCookie(response: ApiResponseLike, token: string, expiresAt: Date): void {
    response.setHeader(
      'Set-Cookie',
      this.serializeCookie(PROVIDER_SESSION_COOKIE_NAME, token, {
        expiresAt,
        maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      }),
    );
  }

  private clearSessionCookie(response: ApiResponseLike): void {
    response.setHeader(
      'Set-Cookie',
      this.serializeCookie(PROVIDER_SESSION_COOKIE_NAME, '', {
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
