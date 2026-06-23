import { BadRequestException, Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ProviderApiKeyScope } from '@ldpass/contracts';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { CreateProviderApiKeyDto } from './api-key.dto.js';
import { providerApiKeyScopes } from './api-key.dto.js';
import { readOpenApiRateLimitConfig } from './open-api-rate-limit.js';

const apiKeyPrefix = 'ldpk';
const apiKeyCiphertextVersion = 'v1';

@Injectable()
export class ProviderApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listApiKeys(providerAccount: AuthenticatedProviderAccount) {
    const [apiKeys, changeRequests] = await Promise.all([
      this.prisma.providerApiKey.findMany({
        where: {
          providerId: providerAccount.providerId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 100,
      }),
      this.prisma.providerApiKeyChangeRequest.findMany({
        where: {
          providerId: providerAccount.providerId,
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
            },
          },
          requestedBy: {
            select: {
              email: true,
              displayName: true,
            },
          },
        },
      }),
    ]);

    return {
      apiKeys: apiKeys.map((apiKey) => this.toApiKeyView(apiKey)),
      changeRequests: changeRequests.map((request) => this.toApiKeyChangeRequestView(request)),
      scopes: providerApiKeyScopes,
      rateLimit: readOpenApiRateLimitConfig(),
    };
  }

  async createApiKey(dto: CreateProviderApiKeyDto, providerAccount: AuthenticatedProviderAccount) {
    const normalizedInput = this.normalizeInput(dto);
    const now = new Date();
    const request = await this.prisma.providerApiKeyChangeRequest.create({
      data: {
        providerId: providerAccount.providerId,
        requestedById: providerAccount.id,
        kind: 'CreateApiKey',
        proposedName: normalizedInput.name,
        proposedScopes: normalizedInput.scopes as Prisma.InputJsonArray,
        proposedExpiresAt: normalizedInput.expiresAt,
        reason: dto.reason?.trim() || null,
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyCreateSubmitted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        apiKeyChangeRequestId: request.id,
        requestedBy: providerAccount.id,
        scopes: normalizedInput.scopes,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyChangeSubmitted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        apiKeyChangeRequestId: request.id,
        kind: 'CreateApiKey',
        requestedBy: providerAccount.id,
        scopes: normalizedInput.scopes,
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(request),
    };
  }

  async requestRevokeApiKey(apiKeyId: string, reason: string | undefined, providerAccount: AuthenticatedProviderAccount) {
    const apiKey = await this.readOwnedApiKey(apiKeyId, providerAccount.providerId);
    if (apiKey.revokedAt) {
      throw new BadRequestException('已停用的 API 密钥不能再次提交停用申请。');
    }

    await this.ensureNoPendingLifecycleRequest(apiKey.id, 'RevokeApiKey');

    const now = new Date();
    const request = await this.prisma.providerApiKeyChangeRequest.create({
      data: {
        providerId: providerAccount.providerId,
        requestedById: providerAccount.id,
        kind: 'RevokeApiKey',
        proposedName: apiKey.name,
        proposedScopes: this.readScopes(apiKey.scopes) as Prisma.InputJsonArray,
        proposedExpiresAt: apiKey.expiresAt,
        targetApiKeyId: apiKey.id,
        reason: reason?.trim() || null,
      },
      include: this.apiKeyChangeRequestInclude(),
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyChangeSubmitted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        apiKeyChangeRequestId: request.id,
        kind: 'RevokeApiKey',
        requestedBy: providerAccount.id,
        targetApiKeyId: apiKey.id,
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(request),
    };
  }

  async requestRotateApiKey(apiKeyId: string, reason: string | undefined, providerAccount: AuthenticatedProviderAccount) {
    const apiKey = await this.readOwnedApiKey(apiKeyId, providerAccount.providerId);
    if (apiKey.revokedAt) {
      throw new BadRequestException('已停用的 API 密钥不能轮换。');
    }

    await this.ensureNoPendingLifecycleRequest(apiKey.id, 'RotateApiKey');

    const scopes = this.readScopes(apiKey.scopes);
    if (scopes.length === 0) {
      throw new BadRequestException('当前 API 密钥权限范围无效，不能轮换。');
    }

    const now = new Date();
    const request = await this.prisma.providerApiKeyChangeRequest.create({
      data: {
        providerId: providerAccount.providerId,
        requestedById: providerAccount.id,
        kind: 'RotateApiKey',
        proposedName: `${apiKey.name}（轮换）`.slice(0, 80),
        proposedScopes: scopes as Prisma.InputJsonArray,
        proposedExpiresAt: apiKey.expiresAt,
        targetApiKeyId: apiKey.id,
        reason: reason?.trim() || null,
      },
      include: this.apiKeyChangeRequestInclude(),
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyChangeSubmitted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        apiKeyChangeRequestId: request.id,
        kind: 'RotateApiKey',
        requestedBy: providerAccount.id,
        targetApiKeyId: apiKey.id,
        scopes,
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(request),
    };
  }

  async listAdminApiKeyChangeRequests() {
    const requests = await this.prisma.providerApiKeyChangeRequest.findMany({
      where: {
        status: 'PendingReview',
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    return {
      requests: requests.map((request) => this.toApiKeyChangeRequestView(request)),
    };
  }

  async approveApiKeyChangeRequest(requestId: string, admin: AuthenticatedUser) {
    const request = await this.readApiKeyChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条 API 密钥申请已经处理。');
    }

    if (request.provider.status !== 'Active') {
      throw new BadRequestException('只有已启用发卡方可以变更 API 密钥。');
    }

    if (request.kind === 'RotateApiKey') {
      return this.approveRotateApiKeyChangeRequest(request, admin);
    }

    if (request.kind === 'RevokeApiKey') {
      return this.approveRevokeApiKeyChangeRequest(request, admin);
    }

    const scopes = this.readScopes(request.proposedScopes);
    if (scopes.length === 0) {
      throw new BadRequestException('API 密钥申请中的权限范围无效。');
    }

    const secret = this.createPlainApiKey();
    const plainApiKeyCiphertext = this.encryptPlainApiKey(secret);
    const now = new Date();
    const { apiKey, updatedRequest } = await this.prisma.$transaction(async (transaction) => {
      const createdApiKey = await transaction.providerApiKey.create({
        data: {
          providerId: request.providerId,
          createdById: request.requestedById,
          name: request.proposedName,
          keyPrefix: this.readKeyPrefix(secret),
          tokenHash: this.hashApiKey(secret),
          scopes: scopes as Prisma.InputJsonArray,
          expiresAt: request.proposedExpiresAt,
        },
      });

      const approvedRequest = await transaction.providerApiKeyChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          apiKeyId: createdApiKey.id,
          plainApiKeyCiphertext,
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
        include: {
          provider: {
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
            },
          },
          requestedBy: {
            select: {
              email: true,
              displayName: true,
            },
          },
        },
      });

      return {
        apiKey: createdApiKey,
        updatedRequest: approvedRequest,
      };
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyCreateApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyChangeRequestId: request.id,
        apiKeyId: apiKey.id,
        approvedBy: admin.id,
        scopes,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyChangeApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyChangeRequestId: request.id,
        kind: 'CreateApiKey',
        apiKeyId: apiKey.id,
        approvedBy: admin.id,
        scopes,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyCreated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyId: apiKey.id,
        createdBy: request.requestedById ?? admin.id,
        scopes,
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(updatedRequest),
      apiKey: this.toApiKeyView(apiKey),
    };
  }

  async rejectApiKeyChangeRequest(requestId: string, reason: string, admin: AuthenticatedUser) {
    const request = await this.readApiKeyChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条 API 密钥申请已经处理。');
    }

    const reviewReason = reason.trim();
    const now = new Date();
    const updatedRequest = await this.prisma.providerApiKeyChangeRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'Rejected',
        reviewedById: admin.id,
        reviewedAt: now,
        reviewReason,
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyCreateRejected',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyChangeRequestId: request.id,
        rejectedBy: admin.id,
        reason: reviewReason,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyChangeRejected',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyChangeRequestId: request.id,
        kind: request.kind as 'CreateApiKey' | 'RotateApiKey' | 'RevokeApiKey',
        rejectedBy: admin.id,
        reason: reviewReason,
        ...(request.targetApiKeyId ? { targetApiKeyId: request.targetApiKeyId } : {}),
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(updatedRequest),
    };
  }

  async claimApprovedApiKeySecret(requestId: string, providerAccount: AuthenticatedProviderAccount) {
    const request = await this.prisma.providerApiKeyChangeRequest.findFirst({
      where: {
        id: requestId,
        providerId: providerAccount.providerId,
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('API 密钥申请不存在或不属于当前发卡方。');
    }

    if (request.status !== 'Approved' || !request.apiKeyId) {
      throw new BadRequestException('这条 API 密钥申请尚未通过。');
    }

    if (request.plainApiKeyViewedAt || !request.plainApiKeyCiphertext) {
      throw new BadRequestException('API 密钥已经查看过，无法再次显示。');
    }

    const plainApiKey = this.decryptPlainApiKey(request.plainApiKeyCiphertext);
    const now = new Date();
    const updatedRequest = await this.prisma.providerApiKeyChangeRequest.update({
      where: {
        id: request.id,
      },
      data: {
        plainApiKeyCiphertext: null,
        plainApiKeyViewedAt: now,
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeySecretClaimed',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        apiKeyChangeRequestId: request.id,
        apiKeyId: request.apiKeyId,
        claimedBy: providerAccount.id,
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(updatedRequest),
      plainApiKey,
    };
  }

  async revokeApiKey(apiKeyId: string, reason: string | undefined, providerAccount: AuthenticatedProviderAccount) {
    return this.requestRevokeApiKey(apiKeyId, reason, providerAccount);
  }

  async rotateApiKey(apiKeyId: string, reason: string | undefined, providerAccount: AuthenticatedProviderAccount) {
    return this.requestRotateApiKey(apiKeyId, reason, providerAccount);
  }

  hashApiKey(secret: string): string {
    const apiKeySecret = process.env.PROVIDER_API_KEY_SECRET ?? process.env.SESSION_SECRET;
    if (!apiKeySecret) {
      throw new Error('PROVIDER_API_KEY_SECRET or SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', apiKeySecret).update(`provider-api-key:${secret}`).digest('base64url');
  }

  private async approveRotateApiKeyChangeRequest(
    request: Awaited<ReturnType<ProviderApiKeysService['readApiKeyChangeRequest']>>,
    admin: AuthenticatedUser,
  ) {
    if (!request.targetApiKeyId) {
      throw new BadRequestException('API 密钥轮换申请缺少目标密钥。');
    }

    const existingApiKey = await this.readOwnedApiKey(request.targetApiKeyId, request.providerId);
    if (existingApiKey.revokedAt) {
      throw new BadRequestException('目标 API 密钥已经停用，不能轮换。');
    }

    const scopes = this.readScopes(request.proposedScopes);
    if (scopes.length === 0) {
      throw new BadRequestException('API 密钥轮换申请中的权限范围无效。');
    }

    const secret = this.createPlainApiKey();
    const plainApiKeyCiphertext = this.encryptPlainApiKey(secret);
    const now = new Date();
    const { nextApiKey, updatedRequest } = await this.prisma.$transaction(async (transaction) => {
      await transaction.providerApiKey.update({
        where: {
          id: existingApiKey.id,
        },
        data: {
          revokedAt: now,
        },
      });

      const createdApiKey = await transaction.providerApiKey.create({
        data: {
          providerId: request.providerId,
          createdById: request.requestedById,
          name: request.proposedName,
          keyPrefix: this.readKeyPrefix(secret),
          tokenHash: this.hashApiKey(secret),
          scopes: scopes as Prisma.InputJsonArray,
          expiresAt: request.proposedExpiresAt,
        },
      });

      const approvedRequest = await transaction.providerApiKeyChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          apiKeyId: createdApiKey.id,
          plainApiKeyCiphertext,
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
        include: this.apiKeyChangeRequestInclude(),
      });

      return {
        nextApiKey: createdApiKey,
        updatedRequest: approvedRequest,
      };
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyChangeApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyChangeRequestId: request.id,
        kind: 'RotateApiKey',
        targetApiKeyId: existingApiKey.id,
        apiKeyId: nextApiKey.id,
        approvedBy: admin.id,
        scopes,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyRotated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        previousApiKeyId: existingApiKey.id,
        nextApiKeyId: nextApiKey.id,
        rotatedBy: admin.id,
        scopes,
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(updatedRequest),
      apiKey: this.toApiKeyView(nextApiKey),
    };
  }

  private async approveRevokeApiKeyChangeRequest(
    request: Awaited<ReturnType<ProviderApiKeysService['readApiKeyChangeRequest']>>,
    admin: AuthenticatedUser,
  ) {
    if (!request.targetApiKeyId) {
      throw new BadRequestException('API 密钥停用申请缺少目标密钥。');
    }

    const existingApiKey = await this.readOwnedApiKey(request.targetApiKeyId, request.providerId);
    if (existingApiKey.revokedAt) {
      throw new BadRequestException('目标 API 密钥已经停用。');
    }

    const now = new Date();
    const { revokedApiKey, updatedRequest } = await this.prisma.$transaction(async (transaction) => {
      const nextApiKey = await transaction.providerApiKey.update({
        where: {
          id: existingApiKey.id,
        },
        data: {
          revokedAt: now,
        },
      });

      const approvedRequest = await transaction.providerApiKeyChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
        include: this.apiKeyChangeRequestInclude(),
      });

      return {
        revokedApiKey: nextApiKey,
        updatedRequest: approvedRequest,
      };
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyChangeApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyChangeRequestId: request.id,
        kind: 'RevokeApiKey',
        targetApiKeyId: existingApiKey.id,
        approvedBy: admin.id,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderApiKeyRevoked',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        apiKeyId: existingApiKey.id,
        revokedBy: admin.id,
      },
    });

    return {
      request: this.toApiKeyChangeRequestView(updatedRequest),
      apiKey: this.toApiKeyView(revokedApiKey),
    };
  }

  private async readApiKeyChangeRequest(requestId: string) {
    const request = await this.prisma.providerApiKeyChangeRequest.findUnique({
      where: {
        id: requestId,
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
          },
        },
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('API 密钥申请不存在。');
    }

    return request;
  }

  private async ensureNoPendingLifecycleRequest(targetApiKeyId: string, kind: 'RotateApiKey' | 'RevokeApiKey') {
    const existingRequest = await this.prisma.providerApiKeyChangeRequest.findFirst({
      where: {
        targetApiKeyId,
        kind,
        status: 'PendingReview',
      },
      select: {
        id: true,
      },
    });

    if (existingRequest) {
      throw new BadRequestException('这个 API 密钥已有同类待审核申请，请等待管理员处理。');
    }
  }

  private apiKeyChangeRequestInclude() {
    return {
      provider: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      },
      requestedBy: {
        select: {
          email: true,
          displayName: true,
        },
      },
    } satisfies Prisma.ProviderApiKeyChangeRequestInclude;
  }

  private async readOwnedApiKey(apiKeyId: string, providerId: string) {
    const apiKey = await this.prisma.providerApiKey.findFirst({
      where: {
        id: apiKeyId,
        providerId,
      },
    });

    if (!apiKey) {
      throw new NotFoundException('API 密钥不存在或不属于当前发卡方。');
    }

    return apiKey;
  }

  private normalizeInput(dto: CreateProviderApiKeyDto) {
    const name = dto.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('API 密钥名称至少需要 2 个字符。');
    }

    const scopes = Array.from(new Set(dto.scopes));
    if (scopes.length === 0) {
      throw new BadRequestException('至少需要选择一个 API 权限范围。');
    }

    return {
      name,
      scopes,
      expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 24 * 60 * 60 * 1000) : null,
    };
  }

  private createPlainApiKey(): string {
    const publicPrefix = randomBytes(4).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    return `${apiKeyPrefix}_${publicPrefix}_${secret}`;
  }

  private readKeyPrefix(secret: string): string {
    const parts = secret.split('_');
    return parts.length >= 2 ? `${parts[0]}_${parts[1]}` : secret.slice(0, 14);
  }

  private encryptPlainApiKey(plainApiKey: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.readEncryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(plainApiKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [apiKeyCiphertextVersion, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  private decryptPlainApiKey(ciphertextEnvelope: string): string {
    const [version, iv, authTag, ciphertext] = ciphertextEnvelope.split('.');
    if (version !== apiKeyCiphertextVersion || !iv || !authTag || !ciphertext) {
      throw new InternalServerErrorException('API 密钥密文格式无效。');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.readEncryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  private readEncryptionKey(): Buffer {
    const rawSecret = process.env.PROVIDER_API_KEY_SECRET ?? process.env.SESSION_SECRET ?? '';
    if (rawSecret.trim().length < 16) {
      throw new InternalServerErrorException('缺少 PROVIDER_API_KEY_SECRET 或 SESSION_SECRET，无法安全交付 API 密钥。');
    }

    return createHash('sha256').update(`ldpass:provider-api-key-delivery:${rawSecret}`).digest();
  }

  private toApiKeyView(apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: Prisma.JsonValue;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: this.readScopes(apiKey.scopes),
      status: this.readStatus(apiKey),
      expiresAt: apiKey.expiresAt?.toISOString() ?? null,
      lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
      revokedAt: apiKey.revokedAt?.toISOString() ?? null,
      createdAt: apiKey.createdAt.toISOString(),
      updatedAt: apiKey.updatedAt.toISOString(),
    };
  }

  private toApiKeyChangeRequestView(request: {
    id: string;
    providerId: string;
    status: string;
    kind: string;
    proposedName: string;
    proposedScopes: Prisma.JsonValue;
    proposedExpiresAt: Date | null;
    reason: string | null;
    targetApiKeyId: string | null;
    apiKeyId: string | null;
    plainApiKeyCiphertext: string | null;
    plainApiKeyViewedAt: Date | null;
    reviewedById: string | null;
    reviewReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    provider?: {
      id: string;
      name: string;
      slug: string;
      status: string;
    };
    requestedBy?: {
      email: string;
      displayName: string;
    } | null;
  }) {
    return {
      id: request.id,
      providerId: request.providerId,
      provider: request.provider ?? null,
      status: request.status,
      kind: request.kind,
      proposed: {
        name: request.proposedName,
        scopes: this.readScopes(request.proposedScopes),
        expiresAt: request.proposedExpiresAt?.toISOString() ?? null,
      },
      reason: request.reason,
      targetApiKeyId: request.targetApiKeyId,
      requestedBy: request.requestedBy
        ? {
            email: request.requestedBy.email,
            displayName: request.requestedBy.displayName,
          }
        : null,
      apiKeyId: request.apiKeyId,
      canClaimPlainApiKey:
        request.status === 'Approved' && Boolean(request.apiKeyId) && !request.plainApiKeyViewedAt && Boolean(request.plainApiKeyCiphertext),
      plainApiKeyViewedAt: request.plainApiKeyViewedAt?.toISOString() ?? null,
      reviewedById: request.reviewedById,
      reviewReason: request.reviewReason,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }

  private readScopes(value: Prisma.JsonValue): ProviderApiKeyScope[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is ProviderApiKeyScope =>
      typeof item === 'string' && providerApiKeyScopes.includes(item as ProviderApiKeyScope),
    );
  }

  private readStatus(apiKey: { revokedAt: Date | null; expiresAt: Date | null }): 'active' | 'expired' | 'revoked' {
    if (apiKey.revokedAt) {
      return 'revoked';
    }

    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      return 'expired';
    }

    return 'active';
  }
}
