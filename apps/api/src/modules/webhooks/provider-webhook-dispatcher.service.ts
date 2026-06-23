import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Prisma } from '@ldpass/database';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { providerWebhookEventTypes, type ProviderWebhookEventType } from './dto.js';
import { WebhookSecretCryptoService } from './webhook-secret-crypto.service.js';

const maxFanoutBatchSize = 100;
const maxDeliveryBatchSize = 20;

@Injectable()
export class ProviderWebhookDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderWebhookDispatcherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly webhookSecretCrypto: WebhookSecretCryptoService,
  ) {}

  onModuleInit(): void {
    if (process.env.WEBHOOK_DISPATCH_ENABLED === 'false') {
      return;
    }

    const intervalSeconds = readPositiveInt(process.env.WEBHOOK_DISPATCH_INTERVAL_SECONDS, 30);
    this.timer = setInterval(() => {
      void this.processOnce();
    }, intervalSeconds * 1000);
    void this.processOnce();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processOnce(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      await this.fanoutOutboxEvents();
      await this.deliverDueEvents();
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : 'Webhook 调度失败。');
    } finally {
      this.isProcessing = false;
    }
  }

  private async fanoutOutboxEvents(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({
      where: {
        publishedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: maxFanoutBatchSize,
    });

    for (const event of events) {
      if (!providerWebhookEventTypes.includes(event.type as ProviderWebhookEventType)) {
        await this.markOutboxEventPublished(event.id);
        continue;
      }

      const providerId = await this.resolveProviderId(event);
      if (providerId) {
        const endpoints = await this.prisma.providerWebhookEndpoint.findMany({
          where: {
            providerId,
            enabled: true,
            deletedAt: null,
            provider: {
              status: 'Active',
            },
          },
        });

        for (const endpoint of endpoints) {
          if (!this.readEventTypes(endpoint.eventTypes).includes(event.type as ProviderWebhookEventType)) {
            continue;
          }

          await this.prisma.providerWebhookDelivery
            .create({
              data: {
                endpointId: endpoint.id,
                outboxEventId: event.id,
              },
            })
            .catch(() => undefined);
        }
      }

      await this.markOutboxEventPublished(event.id);
    }
  }

  private async deliverDueEvents(): Promise<void> {
    const maxAttempts = readPositiveInt(process.env.WEBHOOK_MAX_ATTEMPTS, 5);
    const deliveries = await this.prisma.providerWebhookDelivery.findMany({
      where: {
        status: {
          in: ['Pending', 'Failed'],
        },
        attemptCount: {
          lt: maxAttempts,
        },
        nextAttemptAt: {
          lte: new Date(),
        },
        endpoint: {
          enabled: true,
          deletedAt: null,
          provider: {
            status: 'Active',
          },
        },
      },
      include: {
        endpoint: true,
        outboxEvent: true,
      },
      orderBy: {
        nextAttemptAt: 'asc',
      },
      take: maxDeliveryBatchSize,
    });

    for (const delivery of deliveries) {
      await this.deliverOne(delivery, maxAttempts);
    }
  }

  private async deliverOne(
    delivery: Prisma.ProviderWebhookDeliveryGetPayload<{
      include: {
        endpoint: true;
        outboxEvent: true;
      };
    }>,
    maxAttempts: number,
  ): Promise<void> {
    const now = new Date();
    const attemptCount = delivery.attemptCount + 1;
    const body = JSON.stringify({
      deliveryId: delivery.id,
      eventId: delivery.outboxEvent.id,
      eventType: delivery.outboxEvent.type,
      createdAt: delivery.outboxEvent.createdAt.toISOString(),
      payload: delivery.outboxEvent.payload,
    });
    const timestamp = now.toISOString();
    const signingSecret = this.webhookSecretCrypto.decrypt(delivery.endpoint.signingSecretCiphertext);
    const signature = createHmac('sha256', signingSecret).update(`${timestamp}\n${body}`).digest('base64url');

    try {
      const response = await fetchWithTimeout(delivery.endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'LDPass-Webhook/1.0',
          'x-ldpass-webhook-id': delivery.id,
          'x-ldpass-webhook-event': delivery.outboxEvent.type,
          'x-ldpass-timestamp': timestamp,
          'x-ldpass-signature': `v1=${signature}`,
        },
        body,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await this.prisma.$transaction([
        this.prisma.providerWebhookDelivery.update({
          where: {
            id: delivery.id,
          },
          data: {
            status: 'Delivered',
            attemptCount,
            lastAttemptAt: now,
            responseStatus: response.status,
            error: null,
            deliveredAt: new Date(),
          },
        }),
        this.prisma.providerWebhookEndpoint.update({
          where: {
            id: delivery.endpointId,
          },
          data: {
            lastSuccessAt: new Date(),
            lastError: null,
          },
        }),
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Webhook 投递失败。';
      const isExhausted = attemptCount >= maxAttempts;
      await this.prisma.$transaction([
        this.prisma.providerWebhookDelivery.update({
          where: {
            id: delivery.id,
          },
          data: {
            status: isExhausted ? 'Abandoned' : 'Failed',
            attemptCount,
            lastAttemptAt: now,
            nextAttemptAt: new Date(now.getTime() + readBackoffMs(attemptCount)),
            error: errorMessage.slice(0, 1000),
          },
        }),
        this.prisma.providerWebhookEndpoint.update({
          where: {
            id: delivery.endpointId,
          },
          data: {
            lastFailureAt: new Date(),
            lastError: errorMessage.slice(0, 1000),
          },
        }),
      ]);
    }
  }

  private readEventTypes(value: Prisma.JsonValue): ProviderWebhookEventType[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is ProviderWebhookEventType =>
      typeof item === 'string' && providerWebhookEventTypes.includes(item as ProviderWebhookEventType),
    );
  }

  private async resolveProviderId(event: { payload: Prisma.JsonValue }): Promise<string | null> {
    const payload = readDomainEventPayload(event.payload);
    if (!payload) {
      return null;
    }

    const providerId = readStringField(payload, 'providerId');
    if (providerId) {
      return providerId;
    }

    const passId = readStringField(payload, 'passId');
    if (passId) {
      const pass = await this.prisma.pass.findUnique({
        where: {
          id: passId,
        },
        select: {
          providerId: true,
        },
      });
      if (pass?.providerId) {
        return pass.providerId;
      }
    }

    const requestId = readStringField(payload, 'requestId');
    if (requestId) {
      const request = await this.prisma.redemptionRequest.findUnique({
        where: {
          id: requestId,
        },
        select: {
          providerId: true,
        },
      });
      if (request?.providerId) {
        return request.providerId;
      }
    }

    const disputeId = readStringField(payload, 'disputeId');
    if (disputeId) {
      const dispute = await this.prisma.dispute.findUnique({
        where: {
          id: disputeId,
        },
        select: {
          pass: {
            select: {
              providerId: true,
            },
          },
        },
      });
      if (dispute?.pass?.providerId) {
        return dispute.pass.providerId;
      }
    }

    const transferId = readStringField(payload, 'transferId');
    if (transferId) {
      const transfer = await this.prisma.passTransfer.findUnique({
        where: {
          id: transferId,
        },
        select: {
          pass: {
            select: {
              providerId: true,
            },
          },
        },
      });
      if (transfer?.pass?.providerId) {
        return transfer.pass.providerId;
      }
    }

    return null;
  }

  private async markOutboxEventPublished(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: {
        id: eventId,
      },
      data: {
        publishedAt: new Date(),
      },
    });
  }
}

function readDomainEventPayload(value: Prisma.JsonValue): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const payload = (value as { payload?: unknown }).payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  return payload as Record<string, unknown>;
}

function readStringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  const parsedValue = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function readBackoffMs(attemptCount: number): number {
  return Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const timeoutSeconds = readPositiveInt(process.env.WEBHOOK_DELIVERY_TIMEOUT_SECONDS, 8);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
