import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ProviderWebhookChangeRequestKind } from '@ldpass/contracts';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import {
  type CreateProviderWebhookEndpointDto,
  type ProviderWebhookChangeReasonDto,
  providerWebhookEventTypes,
  type ProviderWebhookEventType,
  type UpdateProviderWebhookEndpointDto,
} from './dto.js';
import { WebhookSecretCryptoService } from './webhook-secret-crypto.service.js';

@Injectable()
export class ProviderWebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookSecretCrypto: WebhookSecretCryptoService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listProviderWebhookEndpoints(providerAccount: AuthenticatedProviderAccount) {
    const [endpoints, changeRequests] = await Promise.all([
      this.prisma.providerWebhookEndpoint.findMany({
        where: {
          providerId: providerAccount.providerId,
          deletedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.providerWebhookChangeRequest.findMany({
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
      endpoints: endpoints.map((endpoint) => this.toEndpoint(endpoint)),
      changeRequests: changeRequests.map((request) => this.toWebhookChangeRequestView(request)),
      eventTypes: providerWebhookEventTypes,
    };
  }

  async createProviderWebhookEndpoint(dto: CreateProviderWebhookEndpointDto, providerAccount: AuthenticatedProviderAccount) {
    const normalizedInput = this.normalizeInput(dto);
    const existingPendingRequest = await this.prisma.providerWebhookChangeRequest.findFirst({
      where: {
        providerId: providerAccount.providerId,
        proposedUrl: normalizedInput.url,
        status: 'PendingReview',
        kind: 'CreateEndpoint',
      },
    });

    if (existingPendingRequest) {
      throw new ConflictException('这个回调地址已经有待审核申请。');
    }

    const now = new Date();
    const request = await this.prisma.providerWebhookChangeRequest.create({
      data: {
        providerId: providerAccount.providerId,
        requestedById: providerAccount.id,
        kind: 'CreateEndpoint',
        proposedName: normalizedInput.name,
        proposedUrl: normalizedInput.url,
        proposedEventTypes: this.toJsonEventTypes(normalizedInput.eventTypes),
        proposedEnabled: normalizedInput.enabled,
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
      type: 'ProviderWebhookEndpointCreateSubmitted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        webhookChangeRequestId: request.id,
        requestedBy: providerAccount.id,
        eventTypes: normalizedInput.eventTypes,
      },
    });

    await this.publishWebhookChangeSubmitted({
      providerId: providerAccount.providerId,
      requestId: request.id,
      kind: 'CreateEndpoint',
      requestedBy: providerAccount.id,
      eventTypes: normalizedInput.eventTypes,
      enabled: normalizedInput.enabled,
      occurredAt: now,
    });

    return {
      request: this.toWebhookChangeRequestView(request),
    };
  }

  async listAdminWebhookChangeRequests() {
    const requests = await this.prisma.providerWebhookChangeRequest.findMany({
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
      requests: requests.map((request) => this.toWebhookChangeRequestView(request)),
    };
  }

  async approveProviderWebhookChangeRequest(requestId: string, admin: AuthenticatedUser) {
    const request = await this.readWebhookChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条 Webhook 配置申请已经处理。');
    }

    if (request.provider.status !== 'Active') {
      throw new BadRequestException('只有已启用发卡方可以变更 Webhook 配置。');
    }

    if (request.kind === 'UpdateEndpoint') {
      return this.approveUpdateWebhookEndpointRequest(request, admin);
    }

    if (request.kind === 'RotateSecret') {
      return this.approveRotateWebhookSecretRequest(request, admin);
    }

    if (request.kind === 'DeleteEndpoint') {
      return this.approveDeleteWebhookEndpointRequest(request, admin);
    }

    const eventTypes = this.readEventTypes(request.proposedEventTypes);
    if (eventTypes.length === 0) {
      throw new BadRequestException('Webhook 配置申请中的事件类型无效。');
    }

    const signingSecret = this.webhookSecretCrypto.createSigningSecret();
    const signingSecretCiphertext = this.webhookSecretCrypto.encrypt(signingSecret);
    const now = new Date();
    const { endpoint, updatedRequest } = await this.prisma.$transaction(async (transaction) => {
      const createdEndpoint = await transaction.providerWebhookEndpoint.create({
        data: {
          providerId: request.providerId,
          createdById: request.requestedById,
          name: request.proposedName,
          url: request.proposedUrl,
          eventTypes: this.toJsonEventTypes(eventTypes),
          enabled: request.proposedEnabled,
          signingSecretCiphertext,
        },
      });

      const approvedRequest = await transaction.providerWebhookChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          endpointId: createdEndpoint.id,
          signingSecretCiphertext,
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
        endpoint: createdEndpoint,
        updatedRequest: approvedRequest,
      };
    });

    await this.eventBus.publish({
      type: 'ProviderWebhookEndpointCreateApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        webhookChangeRequestId: request.id,
        endpointId: endpoint.id,
        approvedBy: admin.id,
        eventTypes,
      },
    });

    await this.publishWebhookChangeApproved({
      providerId: request.providerId,
      requestId: request.id,
      kind: 'CreateEndpoint',
      approvedBy: admin.id,
      endpointId: endpoint.id,
      eventTypes,
      enabled: endpoint.enabled,
      occurredAt: now,
    });

    await this.eventBus.publish({
      type: 'ProviderWebhookEndpointCreated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        endpointId: endpoint.id,
        createdBy: request.requestedById ?? admin.id,
        eventTypes,
      },
    });

    return {
      request: this.toWebhookChangeRequestView(updatedRequest),
      endpoint: this.toEndpoint(endpoint),
    };
  }

  async rejectProviderWebhookChangeRequest(requestId: string, reason: string, admin: AuthenticatedUser) {
    const request = await this.readWebhookChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条 Webhook 配置申请已经处理。');
    }

    const reviewReason = reason.trim();
    const now = new Date();
    const updatedRequest = await this.prisma.providerWebhookChangeRequest.update({
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

    if (request.kind === 'CreateEndpoint') {
      await this.eventBus.publish({
        type: 'ProviderWebhookEndpointCreateRejected',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          providerId: request.providerId,
          webhookChangeRequestId: request.id,
          rejectedBy: admin.id,
          reason: reviewReason,
        },
      });
    }

    await this.publishWebhookChangeRejected({
      providerId: request.providerId,
      requestId: request.id,
      kind: request.kind as ProviderWebhookChangeRequestKind,
      rejectedBy: admin.id,
      reason: reviewReason,
      occurredAt: now,
      ...(request.endpointId ? { endpointId: request.endpointId } : {}),
    });

    return {
      request: this.toWebhookChangeRequestView(updatedRequest),
    };
  }

  async claimApprovedWebhookSecret(requestId: string, providerAccount: AuthenticatedProviderAccount) {
    const request = await this.prisma.providerWebhookChangeRequest.findFirst({
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
      throw new NotFoundException('Webhook 配置申请不存在或不属于当前发卡方。');
    }

    if (request.status !== 'Approved' || !request.endpointId) {
      throw new BadRequestException('这条 Webhook 配置申请尚未通过。');
    }

    if (request.signingSecretViewedAt || !request.signingSecretCiphertext) {
      throw new BadRequestException('Webhook 签名密钥已经查看过，无法再次显示。');
    }

    const signingSecret = this.webhookSecretCrypto.decrypt(request.signingSecretCiphertext);
    const now = new Date();
    const updatedRequest = await this.prisma.providerWebhookChangeRequest.update({
      where: {
        id: request.id,
      },
      data: {
        signingSecretCiphertext: null,
        signingSecretViewedAt: now,
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
      type: 'ProviderWebhookSecretClaimed',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        webhookChangeRequestId: request.id,
        endpointId: request.endpointId,
        claimedBy: providerAccount.id,
      },
    });

    return {
      request: this.toWebhookChangeRequestView(updatedRequest),
      signingSecret,
    };
  }

  async updateProviderWebhookEndpoint(
    endpointId: string,
    dto: UpdateProviderWebhookEndpointDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.requireEndpoint(endpointId, providerAccount.providerId);
    await this.ensureNoPendingEndpointChangeRequest(endpointId);
    const normalizedInput = this.normalizeInput(dto);
    const now = new Date();
    const request = await this.prisma.providerWebhookChangeRequest.create({
      data: {
        providerId: providerAccount.providerId,
        requestedById: providerAccount.id,
        kind: 'UpdateEndpoint',
        proposedName: normalizedInput.name,
        proposedUrl: normalizedInput.url,
        proposedEventTypes: this.toJsonEventTypes(normalizedInput.eventTypes),
        proposedEnabled: normalizedInput.enabled,
        endpointId,
        reason: dto.reason?.trim() || null,
      },
      include: this.webhookChangeRequestInclude(),
    });

    await this.publishWebhookChangeSubmitted({
      providerId: providerAccount.providerId,
      requestId: request.id,
      kind: 'UpdateEndpoint',
      requestedBy: providerAccount.id,
      endpointId,
      eventTypes: normalizedInput.eventTypes,
      enabled: normalizedInput.enabled,
      occurredAt: now,
    });

    return {
      request: this.toWebhookChangeRequestView(request),
    };
  }

  async rotateProviderWebhookSecret(
    endpointId: string,
    dto: ProviderWebhookChangeReasonDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    const endpoint = await this.requireEndpoint(endpointId, providerAccount.providerId);
    await this.ensureNoPendingEndpointChangeRequest(endpointId);
    const eventTypes = this.readEventTypes(endpoint.eventTypes);
    const now = new Date();
    const request = await this.prisma.providerWebhookChangeRequest.create({
      data: {
        providerId: providerAccount.providerId,
        requestedById: providerAccount.id,
        kind: 'RotateSecret',
        proposedName: endpoint.name,
        proposedUrl: endpoint.url,
        proposedEventTypes: this.toJsonEventTypes(eventTypes),
        proposedEnabled: endpoint.enabled,
        endpointId,
        reason: dto.reason?.trim() || null,
      },
      include: this.webhookChangeRequestInclude(),
    });

    await this.publishWebhookChangeSubmitted({
      providerId: providerAccount.providerId,
      requestId: request.id,
      kind: 'RotateSecret',
      requestedBy: providerAccount.id,
      endpointId,
      eventTypes,
      enabled: endpoint.enabled,
      occurredAt: now,
    });

    return {
      request: this.toWebhookChangeRequestView(request),
    };
  }

  async deleteProviderWebhookEndpoint(
    endpointId: string,
    dto: ProviderWebhookChangeReasonDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    const endpoint = await this.requireEndpoint(endpointId, providerAccount.providerId);
    await this.ensureNoPendingEndpointChangeRequest(endpointId);
    const eventTypes = this.readEventTypes(endpoint.eventTypes);
    const now = new Date();
    const request = await this.prisma.providerWebhookChangeRequest.create({
      data: {
        providerId: providerAccount.providerId,
        requestedById: providerAccount.id,
        kind: 'DeleteEndpoint',
        proposedName: endpoint.name,
        proposedUrl: endpoint.url,
        proposedEventTypes: this.toJsonEventTypes(eventTypes),
        proposedEnabled: false,
        endpointId,
        reason: dto.reason?.trim() || null,
      },
      include: this.webhookChangeRequestInclude(),
    });

    await this.publishWebhookChangeSubmitted({
      providerId: providerAccount.providerId,
      requestId: request.id,
      kind: 'DeleteEndpoint',
      requestedBy: providerAccount.id,
      endpointId,
      eventTypes,
      enabled: false,
      occurredAt: now,
    });

    return {
      request: this.toWebhookChangeRequestView(request),
    };
  }

  private async approveUpdateWebhookEndpointRequest(
    request: Awaited<ReturnType<ProviderWebhooksService['readWebhookChangeRequest']>>,
    admin: AuthenticatedUser,
  ) {
    if (!request.endpointId) {
      throw new BadRequestException('Webhook 修改申请缺少目标端点。');
    }

    await this.requireEndpoint(request.endpointId, request.providerId);
    const eventTypes = this.readEventTypes(request.proposedEventTypes);
    if (eventTypes.length === 0) {
      throw new BadRequestException('Webhook 修改申请中的事件类型无效。');
    }

    const now = new Date();
    const { endpoint, updatedRequest } = await this.prisma.$transaction(async (transaction) => {
      const updatedEndpoint = await transaction.providerWebhookEndpoint.update({
        where: {
          id: request.endpointId!,
        },
        data: {
          name: request.proposedName,
          url: request.proposedUrl,
          eventTypes: this.toJsonEventTypes(eventTypes),
          enabled: request.proposedEnabled,
        },
      });

      const approvedRequest = await transaction.providerWebhookChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
        include: this.webhookChangeRequestInclude(),
      });

      return {
        endpoint: updatedEndpoint,
        updatedRequest: approvedRequest,
      };
    });

    await this.publishWebhookChangeApproved({
      providerId: request.providerId,
      requestId: request.id,
      kind: 'UpdateEndpoint',
      approvedBy: admin.id,
      endpointId: endpoint.id,
      eventTypes,
      enabled: endpoint.enabled,
      occurredAt: now,
    });

    await this.eventBus.publish({
      type: 'ProviderWebhookEndpointUpdated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        endpointId: endpoint.id,
        updatedBy: admin.id,
        enabled: endpoint.enabled,
        eventTypes,
      },
    });

    return {
      request: this.toWebhookChangeRequestView(updatedRequest),
      endpoint: this.toEndpoint(endpoint),
    };
  }

  private async approveRotateWebhookSecretRequest(
    request: Awaited<ReturnType<ProviderWebhooksService['readWebhookChangeRequest']>>,
    admin: AuthenticatedUser,
  ) {
    if (!request.endpointId) {
      throw new BadRequestException('Webhook 密钥轮换申请缺少目标端点。');
    }

    const endpoint = await this.requireEndpoint(request.endpointId, request.providerId);
    const eventTypes = this.readEventTypes(endpoint.eventTypes);
    const signingSecret = this.webhookSecretCrypto.createSigningSecret();
    const signingSecretCiphertext = this.webhookSecretCrypto.encrypt(signingSecret);
    const now = new Date();
    const { updatedEndpoint, updatedRequest } = await this.prisma.$transaction(async (transaction) => {
      const nextEndpoint = await transaction.providerWebhookEndpoint.update({
        where: {
          id: endpoint.id,
        },
        data: {
          signingSecretCiphertext,
        },
      });

      const approvedRequest = await transaction.providerWebhookChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          signingSecretCiphertext,
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
        include: this.webhookChangeRequestInclude(),
      });

      return {
        updatedEndpoint: nextEndpoint,
        updatedRequest: approvedRequest,
      };
    });

    await this.publishWebhookChangeApproved({
      providerId: request.providerId,
      requestId: request.id,
      kind: 'RotateSecret',
      approvedBy: admin.id,
      endpointId: endpoint.id,
      eventTypes,
      enabled: endpoint.enabled,
      occurredAt: now,
    });

    await this.eventBus.publish({
      type: 'ProviderWebhookSecretRotated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        endpointId: endpoint.id,
        rotatedBy: admin.id,
      },
    });

    return {
      request: this.toWebhookChangeRequestView(updatedRequest),
      endpoint: this.toEndpoint(updatedEndpoint),
    };
  }

  private async approveDeleteWebhookEndpointRequest(
    request: Awaited<ReturnType<ProviderWebhooksService['readWebhookChangeRequest']>>,
    admin: AuthenticatedUser,
  ) {
    if (!request.endpointId) {
      throw new BadRequestException('Webhook 删除申请缺少目标端点。');
    }

    const endpoint = await this.requireEndpoint(request.endpointId, request.providerId);
    const eventTypes = this.readEventTypes(endpoint.eventTypes);
    const now = new Date();
    const { updatedEndpoint, updatedRequest } = await this.prisma.$transaction(async (transaction) => {
      const nextEndpoint = await transaction.providerWebhookEndpoint.update({
        where: {
          id: endpoint.id,
        },
        data: {
          enabled: false,
          deletedAt: now,
          lastError: 'Webhook 端点已由管理员审批删除。',
        },
      });

      const approvedRequest = await transaction.providerWebhookChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
        include: this.webhookChangeRequestInclude(),
      });

      return {
        updatedEndpoint: nextEndpoint,
        updatedRequest: approvedRequest,
      };
    });

    await this.publishWebhookChangeApproved({
      providerId: request.providerId,
      requestId: request.id,
      kind: 'DeleteEndpoint',
      approvedBy: admin.id,
      endpointId: endpoint.id,
      eventTypes,
      enabled: false,
      occurredAt: now,
    });

    await this.eventBus.publish({
      type: 'ProviderWebhookEndpointDeleted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: request.providerId,
        endpointId: endpoint.id,
        deletedBy: admin.id,
      },
    });

    return {
      request: this.toWebhookChangeRequestView(updatedRequest),
      endpoint: this.toEndpoint(updatedEndpoint),
    };
  }

  async listProviderWebhookDeliveries(endpointId: string, takeValue: string | undefined, providerAccount: AuthenticatedProviderAccount) {
    await this.requireEndpoint(endpointId, providerAccount.providerId);
    const deliveries = await this.prisma.providerWebhookDelivery.findMany({
      where: {
        endpointId,
      },
      include: {
        outboxEvent: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: this.readTake(takeValue),
    });

    return {
      deliveries: deliveries.map((delivery) => this.toDelivery(delivery)),
    };
  }

  async retryProviderWebhookDelivery(deliveryId: string, providerAccount: AuthenticatedProviderAccount) {
    const delivery = await this.prisma.providerWebhookDelivery.findFirst({
      where: {
        id: deliveryId,
        endpoint: {
          providerId: providerAccount.providerId,
        },
      },
      include: {
        endpoint: true,
        outboxEvent: true,
      },
    });

    if (!delivery) {
      throw new NotFoundException('Webhook 投递记录不存在或不属于当前发卡方。');
    }

    if (delivery.status === 'Delivered') {
      throw new BadRequestException('已成功投递的记录不需要重试。');
    }

    if (!delivery.endpoint.enabled) {
      throw new BadRequestException('请先启用 Webhook 端点，再重试投递。');
    }

    if (delivery.endpoint.deletedAt) {
      throw new BadRequestException('Webhook 端点已删除，不能重试投递。');
    }

    const now = new Date();
    const nextDelivery = await this.prisma.providerWebhookDelivery.update({
      where: {
        id: delivery.id,
      },
      data: {
        status: 'Pending',
        attemptCount: 0,
        nextAttemptAt: now,
        deliveredAt: null,
      },
      include: {
        outboxEvent: true,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderWebhookDeliveryRetryRequested',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        endpointId: delivery.endpointId,
        deliveryId: delivery.id,
        requestedBy: providerAccount.id,
      },
    });

    return {
      delivery: this.toDelivery(nextDelivery),
    };
  }

  private async requireEndpoint(endpointId: string, providerId: string) {
    const endpoint = await this.prisma.providerWebhookEndpoint.findFirst({
      where: {
        id: endpointId,
        providerId,
        deletedAt: null,
      },
    });

    if (!endpoint) {
      throw new NotFoundException('Webhook 端点不存在或不属于当前发卡方。');
    }

    return endpoint;
  }

  private async ensureNoPendingEndpointChangeRequest(endpointId: string) {
    const existingRequest = await this.prisma.providerWebhookChangeRequest.findFirst({
      where: {
        endpointId,
        status: 'PendingReview',
      },
      select: {
        id: true,
      },
    });

    if (existingRequest) {
      throw new ConflictException('这个 Webhook 端点已有待审核配置申请，请等待管理员处理。');
    }
  }

  private async readWebhookChangeRequest(requestId: string) {
    const request = await this.prisma.providerWebhookChangeRequest.findUnique({
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
      throw new NotFoundException('Webhook 配置申请不存在。');
    }

    return request;
  }

  private webhookChangeRequestInclude() {
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
    } satisfies Prisma.ProviderWebhookChangeRequestInclude;
  }

  private async publishWebhookChangeSubmitted(input: {
    providerId: string;
    requestId: string;
    kind: ProviderWebhookChangeRequestKind;
    requestedBy: string;
    endpointId?: string;
    eventTypes?: string[];
    enabled?: boolean;
    occurredAt: Date;
  }) {
    await this.eventBus.publish({
      type: 'ProviderWebhookChangeSubmitted',
      eventId: randomUUID(),
      occurredAt: input.occurredAt.toISOString(),
      actorType: 'provider',
      actorId: input.requestedBy,
      payload: {
        providerId: input.providerId,
        webhookChangeRequestId: input.requestId,
        kind: input.kind,
        requestedBy: input.requestedBy,
        status: 'PendingReview',
        ...(input.endpointId ? { endpointId: input.endpointId } : {}),
        ...(input.eventTypes ? { eventTypes: input.eventTypes } : {}),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
  }

  private async publishWebhookChangeApproved(input: {
    providerId: string;
    requestId: string;
    kind: ProviderWebhookChangeRequestKind;
    approvedBy: string;
    endpointId?: string;
    eventTypes?: string[];
    enabled?: boolean;
    occurredAt: Date;
  }) {
    await this.eventBus.publish({
      type: 'ProviderWebhookChangeApproved',
      eventId: randomUUID(),
      occurredAt: input.occurredAt.toISOString(),
      actorType: 'admin',
      actorId: input.approvedBy,
      payload: {
        providerId: input.providerId,
        webhookChangeRequestId: input.requestId,
        kind: input.kind,
        approvedBy: input.approvedBy,
        ...(input.endpointId ? { endpointId: input.endpointId } : {}),
        ...(input.eventTypes ? { eventTypes: input.eventTypes } : {}),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      },
    });
  }

  private async publishWebhookChangeRejected(input: {
    providerId: string;
    requestId: string;
    kind: ProviderWebhookChangeRequestKind;
    rejectedBy: string;
    reason: string;
    endpointId?: string;
    occurredAt: Date;
  }) {
    await this.eventBus.publish({
      type: 'ProviderWebhookChangeRejected',
      eventId: randomUUID(),
      occurredAt: input.occurredAt.toISOString(),
      actorType: 'admin',
      actorId: input.rejectedBy,
      payload: {
        providerId: input.providerId,
        webhookChangeRequestId: input.requestId,
        kind: input.kind,
        rejectedBy: input.rejectedBy,
        reason: input.reason,
        ...(input.endpointId ? { endpointId: input.endpointId } : {}),
      },
    });
  }

  private normalizeUrl(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Webhook 地址格式无效。');
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('Webhook 地址必须使用 http 或 https。');
    }

    return url.toString();
  }

  private normalizeInput(dto: CreateProviderWebhookEndpointDto) {
    const name = dto.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('Webhook 名称至少需要 2 个字符。');
    }

    const eventTypes = Array.from(new Set(dto.eventTypes));
    if (eventTypes.length === 0) {
      throw new BadRequestException('至少需要选择一个要回调的事件。');
    }

    return {
      name,
      url: this.normalizeUrl(dto.url),
      eventTypes,
      enabled: dto.enabled ?? true,
    };
  }

  private toJsonEventTypes(eventTypes: ProviderWebhookEventType[]): Prisma.InputJsonValue {
    return eventTypes;
  }

  private readEventTypes(value: Prisma.JsonValue): ProviderWebhookEventType[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is ProviderWebhookEventType =>
      typeof item === 'string' && providerWebhookEventTypes.includes(item as ProviderWebhookEventType),
    );
  }

  private toEndpoint(endpoint: {
    id: string;
    name: string;
    url: string;
    eventTypes: Prisma.JsonValue;
    enabled: boolean;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
    lastError: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      eventTypes: this.readEventTypes(endpoint.eventTypes),
      enabled: endpoint.enabled,
      lastSuccessAt: endpoint.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: endpoint.lastFailureAt?.toISOString() ?? null,
      lastError: endpoint.lastError,
      createdAt: endpoint.createdAt.toISOString(),
      updatedAt: endpoint.updatedAt.toISOString(),
    };
  }

  private toWebhookChangeRequestView(request: {
    id: string;
    providerId: string;
    status: string;
    kind: string;
    proposedName: string;
    proposedUrl: string;
    proposedEventTypes: Prisma.JsonValue;
    proposedEnabled: boolean;
    reason: string | null;
    endpointId: string | null;
    signingSecretCiphertext: string | null;
    signingSecretViewedAt: Date | null;
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
        url: request.proposedUrl,
        eventTypes: this.readEventTypes(request.proposedEventTypes),
        enabled: request.proposedEnabled,
      },
      reason: request.reason,
      requestedBy: request.requestedBy
        ? {
            email: request.requestedBy.email,
            displayName: request.requestedBy.displayName,
          }
        : null,
      endpointId: request.endpointId,
      canClaimSigningSecret:
        request.status === 'Approved' && Boolean(request.endpointId) && !request.signingSecretViewedAt && Boolean(request.signingSecretCiphertext),
      signingSecretViewedAt: request.signingSecretViewedAt?.toISOString() ?? null,
      reviewedById: request.reviewedById,
      reviewReason: request.reviewReason,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }

  private toDelivery(delivery: {
    id: string;
    endpointId: string;
    outboxEventId: string;
    status: string;
    attemptCount: number;
    nextAttemptAt: Date;
    lastAttemptAt: Date | null;
    responseStatus: number | null;
    error: string | null;
    deliveredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    outboxEvent: {
      id: string;
      type: string;
      payload: Prisma.JsonValue;
      createdAt: Date;
    };
  }) {
    return {
      id: delivery.id,
      endpointId: delivery.endpointId,
      outboxEventId: delivery.outboxEventId,
      eventType: delivery.outboxEvent.type,
      eventCreatedAt: delivery.outboxEvent.createdAt.toISOString(),
      payload: delivery.outboxEvent.payload,
      status: delivery.status,
      attemptCount: delivery.attemptCount,
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
      responseStatus: delivery.responseStatus,
      error: delivery.error,
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
    };
  }

  private readTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '20', 10);
    if (!Number.isFinite(parsedValue)) {
      return 20;
    }

    return Math.min(Math.max(parsedValue, 1), 100);
  }
}
