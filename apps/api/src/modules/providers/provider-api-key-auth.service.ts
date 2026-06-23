import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ProviderApiKeyScope } from '@ldpass/contracts';
import type { Prisma } from '@ldpass/database';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import type { ApiRequestLike } from '../../shared/auth/request-context.js';
import { readHeader } from '../../shared/auth/request-context.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { providerApiKeyScopes } from './api-key.dto.js';
import { readOpenApiRateLimitConfig } from './open-api-rate-limit.js';

export interface AuthenticatedProviderApiKey extends AuthenticatedProviderAccount {
  apiKeyId: string;
  apiKeyName: string;
  scopes: ProviderApiKeyScope[];
}

interface AuthenticatedProviderApiKeyWithSecret {
  actor: AuthenticatedProviderApiKey;
  secret: string;
}

const signatureToleranceMs = 5 * 60 * 1000;

@Injectable()
export class ProviderApiKeyAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async requireScope(request: ApiRequestLike, scope: ProviderApiKeyScope): Promise<AuthenticatedProviderApiKey> {
    return (await this.authenticate(request, scope)).actor;
  }

  async executeSignedWrite<TResponse>(
    request: ApiRequestLike,
    scope: ProviderApiKeyScope,
    handler: (actor: AuthenticatedProviderApiKey, idempotencyKey: string) => Promise<TResponse>,
  ): Promise<TResponse> {
    const authentication = await this.authenticate(request, scope);
    const signedRequest = this.verifySignedRequest(request, authentication.secret);
    const existingRecord = await this.tryCreateIdempotencyRecord(authentication.actor, signedRequest);

    if (existingRecord) {
      if (existingRecord.requestHash !== signedRequest.requestHash) {
        throw new ConflictException('同一个幂等键不能用于不同请求。');
      }

      if (existingRecord.status === 'completed' && existingRecord.response !== null) {
        return existingRecord.response as TResponse;
      }

      throw new ConflictException('相同幂等键的请求正在处理中，请稍后查询结果。');
    }

    try {
      const response = await handler(authentication.actor, signedRequest.idempotencyKey);
      await this.prisma.openApiIdempotencyRecord.update({
        where: {
          providerId_apiKeyId_idempotencyKey: {
            providerId: authentication.actor.providerId,
            apiKeyId: authentication.actor.apiKeyId,
            idempotencyKey: signedRequest.idempotencyKey,
          },
        },
        data: {
          status: 'completed',
          response: this.toJson(response),
        },
      });

      return response;
    } catch (error) {
      await this.prisma.openApiIdempotencyRecord
        .delete({
          where: {
            providerId_apiKeyId_idempotencyKey: {
              providerId: authentication.actor.providerId,
              apiKeyId: authentication.actor.apiKeyId,
              idempotencyKey: signedRequest.idempotencyKey,
            },
          },
        })
        .catch(() => undefined);

      throw error;
    }
  }

  private async authenticate(request: ApiRequestLike, scope: ProviderApiKeyScope): Promise<AuthenticatedProviderApiKeyWithSecret> {
    const secret = this.readApiKey(request);
    if (!secret) {
      throw new UnauthorizedException('缺少发卡方 API 密钥。');
    }

    const apiKey = await this.prisma.providerApiKey.findUnique({
      where: {
        tokenHash: this.hashApiKey(secret),
      },
      include: {
        provider: true,
      },
    });

    if (!apiKey || apiKey.revokedAt || (apiKey.expiresAt && apiKey.expiresAt <= new Date())) {
      throw new UnauthorizedException('发卡方 API 密钥无效或已过期。');
    }

    if (apiKey.provider.status !== 'Active') {
      throw new ForbiddenException('发卡方尚未启用。');
    }

    const scopes = this.readScopes(apiKey.scopes);
    if (!scopes.includes(scope)) {
      throw new ForbiddenException('API 密钥没有执行该操作的权限。');
    }

    await this.enforceRateLimit({
      apiKeyId: apiKey.id,
      providerId: apiKey.providerId,
      scope,
    });

    await this.prisma.providerApiKey.update({
      where: {
        id: apiKey.id,
      },
      data: {
        lastUsedAt: new Date(),
      },
    });

    return {
      secret,
      actor: {
        id: apiKey.id,
        apiKeyId: apiKey.id,
        apiKeyName: apiKey.name,
        providerId: apiKey.providerId,
        providerName: apiKey.provider.name,
        providerSlug: apiKey.provider.slug,
        providerStatus: apiKey.provider.status,
        providerLogoUrl: apiKey.provider.logoUrl,
        providerIntroductionUrl: apiKey.provider.introductionUrl,
        providerContactName: apiKey.provider.contactName,
        providerContactEmail: apiKey.provider.contactEmail,
        providerBusinessInfo: apiKey.provider.businessInfo,
        email: `${apiKey.keyPrefix}@api-key.local`,
        displayName: apiKey.name,
        status: 'Active',
        role: 'api_key',
        scopes,
      },
    };
  }

  private verifySignedRequest(request: ApiRequestLike, secret: string): {
    idempotencyKey: string;
    requestHash: string;
    route: string;
  } {
    const timestamp = readHeader(request, 'x-ldpass-timestamp')?.trim();
    const idempotencyKey = readHeader(request, 'x-ldpass-idempotency-key')?.trim();
    const signature = readHeader(request, 'x-ldpass-signature')?.trim();

    if (!timestamp) {
      throw new BadRequestException('缺少 X-LDPass-Timestamp 请求头。');
    }

    if (!idempotencyKey) {
      throw new BadRequestException('缺少 X-LDPass-Idempotency-Key 请求头。');
    }

    if (!signature) {
      throw new BadRequestException('缺少 X-LDPass-Signature 请求头。');
    }

    if (idempotencyKey.length > 120) {
      throw new BadRequestException('幂等键长度不能超过 120 个字符。');
    }

    const timestampMs = this.parseTimestamp(timestamp);
    if (Math.abs(Date.now() - timestampMs) > signatureToleranceMs) {
      throw new BadRequestException('请求时间戳已过期或超出允许偏差。');
    }

    const method = (request.method ?? 'GET').toUpperCase();
    const route = request.originalUrl ?? request.url ?? '';
    const rawBody = this.readRawBody(request);
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const canonicalPayload = ['LDPass-OpenAPI-V1', method, route, timestamp, idempotencyKey, bodyHash].join('\n');
    const expectedSignature = createHmac('sha256', secret).update(canonicalPayload).digest('base64url');
    const normalizedSignature = signature.startsWith('v1=') ? signature.slice(3) : signature;

    if (!this.safeEqual(normalizedSignature, expectedSignature)) {
      throw new UnauthorizedException('开放 API 签名校验失败。');
    }

    return {
      idempotencyKey,
      requestHash: createHash('sha256').update([method, route, bodyHash].join('\n')).digest('hex'),
      route,
    };
  }

  private async tryCreateIdempotencyRecord(
    actor: AuthenticatedProviderApiKey,
    signedRequest: {
      idempotencyKey: string;
      requestHash: string;
      route: string;
    },
  ) {
    try {
      await this.prisma.openApiIdempotencyRecord.create({
        data: {
          providerId: actor.providerId,
          apiKeyId: actor.apiKeyId,
          idempotencyKey: signedRequest.idempotencyKey,
          requestHash: signedRequest.requestHash,
          route: signedRequest.route,
        },
      });

      return null;
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      return this.prisma.openApiIdempotencyRecord.findUnique({
        where: {
          providerId_apiKeyId_idempotencyKey: {
            providerId: actor.providerId,
            apiKeyId: actor.apiKeyId,
            idempotencyKey: signedRequest.idempotencyKey,
          },
        },
      });
    }
  }

  private async enforceRateLimit(input: {
    apiKeyId: string;
    providerId: string;
    scope: ProviderApiKeyScope;
  }): Promise<void> {
    const config = readOpenApiRateLimitConfig();
    const windowMs = config.windowSeconds * 1000;
    const now = new Date();
    const currentWindowStartedAt = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

    try {
      const bucket = await this.prisma.openApiRateLimitBucket.findUnique({
        where: {
          apiKeyId_scope: {
            apiKeyId: input.apiKeyId,
            scope: input.scope,
          },
        },
      });

      if (!bucket) {
        await this.prisma.openApiRateLimitBucket.create({
          data: {
            providerId: input.providerId,
            apiKeyId: input.apiKeyId,
            scope: input.scope,
            windowStartedAt: currentWindowStartedAt,
            count: 1,
          },
        });
        return;
      }

      if (bucket.windowStartedAt.getTime() !== currentWindowStartedAt.getTime()) {
        await this.prisma.openApiRateLimitBucket.update({
          where: {
            apiKeyId_scope: {
              apiKeyId: input.apiKeyId,
              scope: input.scope,
            },
          },
          data: {
            windowStartedAt: currentWindowStartedAt,
            count: 1,
          },
        });
        return;
      }

      if (bucket.count >= config.maxRequests) {
        throw new HttpException('开放 API 请求过于频繁，请稍后重试。', HttpStatus.TOO_MANY_REQUESTS);
      }

      await this.prisma.openApiRateLimitBucket.update({
        where: {
          apiKeyId_scope: {
            apiKeyId: input.apiKeyId,
            scope: input.scope,
          },
        },
        data: {
          count: {
            increment: 1,
          },
        },
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        await this.enforceRateLimit(input);
        return;
      }

      throw error;
    }
  }

  private readApiKey(request: ApiRequestLike): string | null {
    const authorization = readHeader(request, 'authorization');
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      return authorization.slice('bearer '.length).trim() || null;
    }

    return readHeader(request, 'x-ldpass-provider-key')?.trim() || null;
  }

  private hashApiKey(secret: string): string {
    const apiKeySecret = process.env.PROVIDER_API_KEY_SECRET ?? process.env.SESSION_SECRET;
    if (!apiKeySecret) {
      throw new Error('PROVIDER_API_KEY_SECRET or SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', apiKeySecret).update(`provider-api-key:${secret}`).digest('base64url');
  }

  private parseTimestamp(value: string): number {
    if (/^\d+$/.test(value)) {
      const timestamp = Number.parseInt(value, 10);
      return value.length <= 10 ? timestamp * 1000 : timestamp;
    }

    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new BadRequestException('X-LDPass-Timestamp 必须是 Unix 时间戳或 ISO 时间。');
    }

    return timestamp;
  }

  private readRawBody(request: ApiRequestLike): Buffer {
    if (Buffer.isBuffer(request.rawBody)) {
      return request.rawBody;
    }

    if (typeof request.rawBody === 'string') {
      return Buffer.from(request.rawBody, 'utf8');
    }

    return Buffer.alloc(0);
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'P2002');
  }

  private readScopes(value: unknown): ProviderApiKeyScope[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is ProviderApiKeyScope =>
      typeof item === 'string' && providerApiKeyScopes.includes(item as ProviderApiKeyScope),
    );
  }
}
