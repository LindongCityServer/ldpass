import { ForbiddenException, Injectable, UnauthorizedException } from '../../framework.js';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import {
  type ApiRequestLike,
  type ApiResponseLike,
  readClientIp,
  readHeader,
  readUserAgent,
} from './request-context.js';
import { serializeAuthCookie, serializeExpiredAuthCookies } from './cookie.js';

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

  async createSession(
    providerAccountId: string,
    request: ApiRequestLike,
    response: ApiResponseLike,
  ): Promise<void> {
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

    this.setSessionCookie(request, response, token, expiresAt);
  }

  async clearSession(request: ApiRequestLike, response: ApiResponseLike): Promise<void> {
    const tokens = this.readSessionTokens(request);

    if (tokens.length > 0) {
      await this.prisma.providerAuthSession.updateMany({
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

  async getCurrentProviderAccount(
    request: ApiRequestLike,
  ): Promise<AuthenticatedProviderAccount | null> {
    const tokens = this.readSessionTokens(request);

    if (tokens.length === 0) {
      return null;
    }

    const tokenHashes = [...new Set(tokens.map((token) => this.hashSessionToken(token)))];
    const session = await this.prisma.providerAuthSession.findFirst({
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
        providerAccount: {
          include: {
            provider: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!session) {
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
    return this.readSessionTokens(request)[0] ?? null;
  }

  private readSessionTokens(request: ApiRequestLike): string[] {
    const cookieHeader = readHeader(request, 'cookie');
    if (!cookieHeader) {
      return [];
    }

    const cookies = cookieHeader.split(';').map((part) => part.trim());
    return cookies
      .filter((cookie) => cookie.startsWith(`${PROVIDER_SESSION_COOKIE_NAME}=`))
      .map((cookie) => decodeURIComponent(cookie.slice(PROVIDER_SESSION_COOKIE_NAME.length + 1)))
      .filter(Boolean);
  }

  private hashSessionToken(token: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', secret).update(`provider:${token}`).digest('base64url');
  }

  private setSessionCookie(
    request: ApiRequestLike,
    response: ApiResponseLike,
    token: string,
    expiresAt: Date,
  ): void {
    response.setHeader(
      'Set-Cookie',
      serializeAuthCookie(request, PROVIDER_SESSION_COOKIE_NAME, token, {
        expiresAt,
        maxAgeSeconds: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      }),
    );
  }

  private clearSessionCookie(request: ApiRequestLike, response: ApiResponseLike): void {
    response.setHeader(
      'Set-Cookie',
      serializeExpiredAuthCookies(request, PROVIDER_SESSION_COOKIE_NAME),
    );
  }
}
