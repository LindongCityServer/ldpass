import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { CardTemplateVariantsQueryDto, CreateCardTemplateVariantDto, UpdateCardTemplateVariantDto } from './dto.js';

@Injectable()
export class CardTemplateVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listEnabledVariants(query: CardTemplateVariantsQueryDto) {
    const variants = await this.prisma.cardTemplateVariant.findMany({
      where: {
        enabled: true,
        ...(query.category ? { category: query.category } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });

    return {
      variants: variants.map((variant) => this.toVariantView(variant)),
    };
  }

  async listAdminVariants(query: CardTemplateVariantsQueryDto) {
    const variants = await this.prisma.cardTemplateVariant.findMany({
      ...(query.category
        ? {
            where: {
              category: query.category,
            },
          }
        : {}),
      orderBy: [{ category: 'asc' }, { enabled: 'desc' }, { name: 'asc' }],
    });

    return {
      variants: variants.map((variant) => this.toVariantView(variant)),
    };
  }

  async createVariant(dto: CreateCardTemplateVariantDto, admin: AuthenticatedUser) {
    const key = dto.key.trim();
    const name = dto.name.trim();

    const existing = await this.prisma.cardTemplateVariant.findUnique({
      where: {
        key,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new BadRequestException('该模板变体标识已经存在。');
    }

    const variant = await this.prisma.cardTemplateVariant.create({
      data: {
        key,
        name,
        category: dto.category,
        enabled: dto.enabled ?? true,
        config: this.toJson(dto.config ?? {}),
        createdById: admin.id,
      },
    });

    await this.eventBus.publish({
      type: 'CardTemplateVariantCreated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        variantId: variant.id,
        key: variant.key,
        category: variant.category,
        createdBy: admin.id,
      },
    });

    return {
      variant: this.toVariantView(variant),
    };
  }

  async updateVariant(variantId: string, dto: UpdateCardTemplateVariantDto, admin: AuthenticatedUser) {
    const existing = await this.prisma.cardTemplateVariant.findUnique({
      where: {
        id: variantId,
      },
    });

    if (!existing) {
      throw new NotFoundException('卡面模板变体不存在。');
    }

    const variant = await this.prisma.cardTemplateVariant.update({
      where: {
        id: existing.id,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.config !== undefined ? { config: this.toJson(dto.config) } : {}),
      },
    });

    await this.eventBus.publish({
      type: 'CardTemplateVariantUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        variantId: variant.id,
        key: variant.key,
        category: variant.category,
        enabled: variant.enabled,
        updatedBy: admin.id,
      },
    });

    return {
      variant: this.toVariantView(variant),
    };
  }

  async deleteVariant(variantId: string, admin: AuthenticatedUser) {
    const existing = await this.prisma.cardTemplateVariant.findUnique({
      where: {
        id: variantId,
      },
    });

    if (!existing) {
      throw new NotFoundException('卡面模板变体不存在。');
    }

    await this.prisma.cardTemplateVariant.delete({
      where: {
        id: existing.id,
      },
    });

    await this.eventBus.publish({
      type: 'CardTemplateVariantDeleted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        variantId: existing.id,
        key: existing.key,
        deletedBy: admin.id,
      },
    });

    return {
      ok: true,
      variant: this.toVariantView(existing),
    };
  }

  private toVariantView(variant: {
    id: string;
    key: string;
    name: string;
    category: string;
    enabled: boolean;
    config: Prisma.JsonValue;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: variant.id,
      key: variant.key,
      name: variant.name,
      category: variant.category,
      enabled: variant.enabled,
      config: variant.config,
      createdById: variant.createdById,
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
