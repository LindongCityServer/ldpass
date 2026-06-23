import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { CreatePassTemplateDto, UpdatePassTemplateDto } from './dto.js';

@Injectable()
export class PassTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listProviderTemplates(providerAccount: AuthenticatedProviderAccount) {
    const templates = await this.prisma.passTemplate.findMany({
      where: {
        providerId: providerAccount.providerId,
      },
      include: {
        versions: {
          orderBy: {
            version: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return {
      templates: templates.map((template) => this.toProviderTemplateView(template)),
    };
  }

  async createProviderTemplate(dto: CreatePassTemplateDto, providerAccount: AuthenticatedProviderAccount) {
    const now = new Date();
    const input = await this.normalizeTemplateInput(dto, providerAccount.providerId);

    const result = await this.prisma.$transaction(async (transaction) => {
      const template = await transaction.passTemplate.create({
        data: {
          providerId: providerAccount.providerId,
          category: input.category,
          benefitType: input.benefitType,
          displayName: input.displayName,
          status: 'PendingReview',
        },
      });

      const version = await transaction.passTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          status: 'PendingReview',
          title: input.title,
          description: input.description,
          cardStyle: this.toJson(input.cardStyle),
          fields: this.toJson(input.fields),
          rules: this.toJson(input.rules),
          locationRules: input.locationRules ? this.toJson(input.locationRules) : Prisma.JsonNull,
          backgroundImageUrl: input.backgroundImageUrl,
          logoUrl: input.logoUrl,
          submittedById: providerAccount.id,
        },
      });

      return {
        template,
        version,
      };
    });

    await this.eventBus.publish({
      type: 'PassTemplateCreated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        templateId: result.template.id,
        category: result.template.category,
        benefitType: result.template.benefitType,
        version: result.version.version,
      },
    });

    return {
      template: this.toProviderTemplateView({
        ...result.template,
        versions: [result.version],
      }),
    };
  }

  async submitProviderTemplateVersion(
    templateId: string,
    dto: UpdatePassTemplateDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    const now = new Date();
    const input = await this.normalizeTemplateInput(dto, providerAccount.providerId);
    const template = await this.prisma.passTemplate.findFirst({
      where: {
        id: templateId,
        providerId: providerAccount.providerId,
      },
      include: {
        versions: {
          orderBy: {
            version: 'desc',
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('卡券模板不存在或不属于当前发卡方。');
    }

    if (template.category !== input.category || template.benefitType !== input.benefitType) {
      throw new BadRequestException('模板分类和权益类型不能通过版本变更修改，请创建新的卡券模板。');
    }

    const hasPendingVersion = template.versions.some((version) => version.status === 'PendingReview');
    if (hasPendingVersion) {
      throw new BadRequestException('该模板已有待审核版本，请等待管理员审核后再提交新的变更。');
    }

    const nextVersionNumber = (template.versions[0]?.version ?? 0) + 1;
    const result = await this.prisma.$transaction(async (transaction) => {
      const version = await transaction.passTemplateVersion.create({
        data: {
          templateId: template.id,
          version: nextVersionNumber,
          status: 'PendingReview',
          title: input.title,
          description: input.description,
          cardStyle: this.toJson(input.cardStyle),
          fields: this.toJson(input.fields),
          rules: this.toJson(input.rules),
          locationRules: input.locationRules ? this.toJson(input.locationRules) : Prisma.JsonNull,
          backgroundImageUrl: input.backgroundImageUrl,
          logoUrl: input.logoUrl,
          submittedById: providerAccount.id,
        },
      });

      const updatedTemplate =
        template.activeVersionId === null
          ? await transaction.passTemplate.update({
              where: {
                id: template.id,
              },
              data: {
                status: 'PendingReview',
              },
            })
          : template;

      return {
        template: updatedTemplate,
        version,
      };
    });

    await this.eventBus.publish({
      type: 'PassTemplateUpdateSubmitted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: providerAccount.providerId,
        templateId: result.template.id,
        category: result.template.category,
        benefitType: result.template.benefitType,
        version: result.version.version,
      },
    });

    return {
      template: this.toProviderTemplateView({
        ...result.template,
        versions: [result.version],
      }),
    };
  }

  async listPendingTemplates() {
    const versions = await this.prisma.passTemplateVersion.findMany({
      where: {
        status: 'PendingReview',
      },
      include: {
        template: {
          include: {
            provider: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      templates: versions.map((version) => this.toAdminTemplateReviewView(version)),
    };
  }

  async listApprovedTemplates() {
    const versions = await this.prisma.passTemplateVersion.findMany({
      where: {
        status: 'Approved',
      },
      include: {
        template: {
          include: {
            provider: true,
          },
        },
      },
      orderBy: [
        {
          reviewedAt: 'desc',
        },
        {
          updatedAt: 'desc',
        },
      ],
      take: 100,
    });

    return {
      templates: versions.map((version) => this.toAdminTemplateReviewView(version)),
    };
  }

  async approveTemplateVersion(versionId: string, admin: AuthenticatedUser) {
    const now = new Date();
    const version = await this.prisma.passTemplateVersion.findUnique({
      where: {
        id: versionId,
      },
      include: {
        template: true,
      },
    });

    if (!version) {
      throw new NotFoundException('卡券模板版本不存在。');
    }

    if (version.status !== 'PendingReview') {
      throw new BadRequestException('只能审核待审核的卡券模板。');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const approvedVersion = await transaction.passTemplateVersion.update({
        where: {
          id: version.id,
        },
        data: {
          status: 'Approved',
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
      });

      const template = await transaction.passTemplate.update({
        where: {
          id: version.templateId,
        },
        data: {
          status: 'Active',
          activeVersionId: version.id,
          displayName: readVersionDisplayName(version.fields) ?? version.template.displayName,
        },
      });

      return {
        template,
        version: approvedVersion,
      };
    });

    await this.eventBus.publish({
      type: 'PassTemplateApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: updated.template.providerId,
        templateId: updated.template.id,
        approvedBy: admin.id,
        version: updated.version.version,
      },
    });

    return {
      template: this.toProviderTemplateView({
        ...updated.template,
        versions: [updated.version],
      }),
    };
  }

  async rejectTemplateVersion(versionId: string, reason: string, admin: AuthenticatedUser) {
    const now = new Date();
    const reviewReason = reason.trim();
    const version = await this.prisma.passTemplateVersion.findUnique({
      where: {
        id: versionId,
      },
      include: {
        template: true,
      },
    });

    if (!version) {
      throw new NotFoundException('卡券模板版本不存在。');
    }

    if (version.status !== 'PendingReview') {
      throw new BadRequestException('只能审核待审核的卡券模板。');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const rejectedVersion = await transaction.passTemplateVersion.update({
        where: {
          id: version.id,
        },
        data: {
          status: 'Rejected',
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason,
        },
      });

      const template = await transaction.passTemplate.update({
        where: {
          id: version.templateId,
        },
        data: {
          status: version.template.activeVersionId ? version.template.status : 'Rejected',
        },
      });

      return {
        template,
        version: rejectedVersion,
      };
    });

    await this.eventBus.publish({
      type: 'PassTemplateRejected',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: updated.template.providerId,
        templateId: updated.template.id,
        rejectedBy: admin.id,
        reason: reviewReason,
      },
    });

    return {
      template: this.toProviderTemplateView({
        ...updated.template,
        versions: [updated.version],
      }),
    };
  }

  private toProviderTemplateView(template: {
    id: string;
    providerId: string;
    category: string;
    benefitType: string;
    displayName: string;
    status: string;
    activeVersionId: string | null;
    createdAt: Date;
    updatedAt: Date;
      versions: Array<{
        id: string;
        version: number;
        status: string;
        title: string;
        description: string | null;
        cardStyle: Prisma.JsonValue;
        fields: Prisma.JsonValue;
        rules: Prisma.JsonValue;
        locationRules: Prisma.JsonValue | null;
        backgroundImageUrl: string | null;
        logoUrl: string | null;
        reviewReason: string | null;
        createdAt: Date;
        updatedAt: Date;
    }>;
  }) {
    const latestVersion = template.versions[0] ?? null;

    return {
      id: template.id,
      providerId: template.providerId,
      category: template.category,
      benefitType: template.benefitType,
      displayName: template.displayName,
      status: template.status,
      activeVersionId: template.activeVersionId,
      latestVersion: latestVersion
        ? {
            id: latestVersion.id,
            version: latestVersion.version,
            status: latestVersion.status,
            title: latestVersion.title,
            description: latestVersion.description,
            cardStyle: latestVersion.cardStyle,
            fields: latestVersion.fields,
            rules: latestVersion.rules,
            locationRules: latestVersion.locationRules,
            backgroundImageUrl: latestVersion.backgroundImageUrl,
            logoUrl: latestVersion.logoUrl,
            reviewReason: latestVersion.reviewReason,
            createdAt: latestVersion.createdAt.toISOString(),
            updatedAt: latestVersion.updatedAt.toISOString(),
          }
        : null,
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }

  private async normalizeTemplateInput(dto: CreatePassTemplateDto | UpdatePassTemplateDto, providerId: string) {
    const displayName = dto.displayName.trim();
    const title = dto.title.trim();
    const locationRules = this.buildLocationRules(dto);
    const allowedRedemptionProviderIds = await this.resolveAllowedRedemptionProviderIds(
      dto.allowedRedemptionProviderIdentifiers,
      providerId,
    );

    return {
      category: dto.category,
      benefitType: dto.benefitType,
      displayName,
      title,
      description: dto.description?.trim() || null,
      cardStyle: {
        variantKey: dto.variantKey?.trim() || 'standard',
        cardColor: dto.cardColor?.trim() || null,
      },
      fields: {
        primary: displayName,
        secondary: title,
        hideTitle: dto.hideTitle ?? false,
      },
      rules: {
        transferable: dto.transferable ?? false,
        shareable: dto.shareable ?? true,
        allowOverdraft: dto.allowOverdraft ?? false,
        allowFrozenBalance: dto.allowFrozenBalance ?? true,
        allowTopUpIn: dto.allowTopUpIn ?? false,
        allowTopUpOut: dto.allowTopUpOut ?? false,
        allowedRedemptionProviderIds,
        requireServerVerifiedUser: dto.requireServerVerifiedUser ?? false,
        requireLocationVerification: Boolean(locationRules),
        expirationReminderDefaultDays: 7,
      },
      locationRules,
      backgroundImageUrl: dto.backgroundImageUrl?.trim() || null,
      logoUrl: dto.logoUrl?.trim() || null,
    };
  }

  private async resolveAllowedRedemptionProviderIds(
    rawValue: string | undefined,
    issuerProviderId: string,
  ): Promise<string[]> {
    const identifiers = this.parseProviderIdentifiers(rawValue);
    if (identifiers.length === 0) {
      return [];
    }

    const providers = await this.prisma.provider.findMany({
      where: {
        status: 'Active',
        OR: [
          {
            id: {
              in: identifiers,
            },
          },
          {
            slug: {
              in: identifiers.map((identifier) => identifier.toLowerCase()),
            },
          },
        ],
      },
      select: {
        id: true,
        slug: true,
      },
    });

    const matchedIdentifiers = new Set<string>();
    for (const provider of providers) {
      matchedIdentifiers.add(provider.id);
      matchedIdentifiers.add(provider.slug.toLowerCase());
    }

    const unknownIdentifiers = identifiers.filter(
      (identifier) => !matchedIdentifiers.has(identifier) && !matchedIdentifiers.has(identifier.toLowerCase()),
    );
    if (unknownIdentifiers.length > 0) {
      throw new BadRequestException(`允许核销方不存在或未启用：${unknownIdentifiers.join('、')}`);
    }

    return Array.from(new Set(providers.map((provider) => provider.id).filter((id) => id !== issuerProviderId))).sort();
  }

  private parseProviderIdentifiers(rawValue: string | undefined): string[] {
    if (!rawValue?.trim()) {
      return [];
    }

    const identifiers = rawValue
      .split(/[\s,，;；]+/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (identifiers.length > 50) {
      throw new BadRequestException('允许核销方最多填写 50 个。');
    }

    return Array.from(new Set(identifiers));
  }

  private toAdminTemplateReviewView(version: {
    id: string;
    version: number;
    status: string;
    title: string;
    description: string | null;
    cardStyle: Prisma.JsonValue;
    fields: Prisma.JsonValue;
    rules: Prisma.JsonValue;
    locationRules: Prisma.JsonValue | null;
    backgroundImageUrl: string | null;
    logoUrl: string | null;
    createdAt: Date;
    template: {
      id: string;
      category: string;
      benefitType: string;
      displayName: string;
      status: string;
      provider: {
        id: string;
        name: string;
        slug: string;
      };
    };
  }) {
    return {
      versionId: version.id,
      version: version.version,
      status: version.status,
      title: version.title,
      description: version.description,
      cardStyle: version.cardStyle,
      fields: version.fields,
      rules: version.rules,
      locationRules: version.locationRules,
      backgroundImageUrl: version.backgroundImageUrl,
      logoUrl: version.logoUrl,
      createdAt: version.createdAt.toISOString(),
      template: {
        id: version.template.id,
        displayName: version.template.displayName,
        category: version.template.category,
        benefitType: version.template.benefitType,
        status: version.template.status,
      },
      provider: {
        id: version.template.provider.id,
        name: version.template.provider.name,
        slug: version.template.provider.slug,
      },
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private buildLocationRules(dto: CreatePassTemplateDto): LocationRules | null {
    if (dto.category !== 'identity_key' || dto.requireLocationVerification !== true) {
      return null;
    }

    if (dto.locationRulesJson?.trim()) {
      return this.parseLocationRulesJson(dto.locationRulesJson);
    }

    const kind = dto.locationRuleKind ?? 'circle';
    const label = dto.locationRuleLabel?.trim() || '默认核验范围';
    const expiresAfterSeconds = dto.locationExpiresAfterSeconds ?? 60;

    if (kind === 'circle') {
      const centerX = readRequiredNumber(dto.locationCenterX, '圆形范围中心 X');
      const centerZ = readRequiredNumber(dto.locationCenterZ, '圆形范围中心 Z');
      const radius = readRequiredNumber(dto.locationRadius, '圆形范围半径');

      if (radius <= 0) {
        throw new BadRequestException('圆形范围半径必须大于 0。');
      }

      return {
        version: 1,
        rules: [
          {
            id: randomUUID(),
            kind,
            label,
            centerX,
            centerZ,
            radius,
            expiresAfterSeconds,
          },
        ],
      };
    }

    const minX = readRequiredNumber(dto.locationMinX, '矩形范围最小 X');
    const maxX = readRequiredNumber(dto.locationMaxX, '矩形范围最大 X');
    const minZ = readRequiredNumber(dto.locationMinZ, '矩形范围最小 Z');
    const maxZ = readRequiredNumber(dto.locationMaxZ, '矩形范围最大 Z');

    if (minX > maxX || minZ > maxZ) {
      throw new BadRequestException('矩形范围的最小值不能大于最大值。');
    }

    return {
      version: 1,
      rules: [
        {
          id: randomUUID(),
          kind,
          label,
          minX,
          maxX,
          minZ,
          maxZ,
          expiresAfterSeconds,
        },
      ],
    };
  }

  private parseLocationRulesJson(value: string): LocationRules {
    let parsed: unknown;

    try {
      parsed = JSON.parse(value);
    } catch {
      throw new BadRequestException('多位置规则 JSON 格式不正确。');
    }

    const rawRules = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { rules?: unknown }).rules
        : null;

    if (!Array.isArray(rawRules) || rawRules.length === 0) {
      throw new BadRequestException('多位置规则至少需要包含一个范围。');
    }

    if (rawRules.length > 10) {
      throw new BadRequestException('单个模板最多配置 10 个位置核验范围。');
    }

    return {
      version: 1,
      rules: rawRules.map((rule, index) => normalizeLocationRule(rule, index)),
    };
  }
}

interface LocationRules {
  version: 1;
  rules: Array<
    | {
        id: string;
        kind: 'circle';
        label: string;
        centerX: number;
        centerZ: number;
        radius: number;
        expiresAfterSeconds: number;
      }
    | {
        id: string;
        kind: 'rectangle';
        label: string;
        minX: number;
        maxX: number;
        minZ: number;
        maxZ: number;
        expiresAfterSeconds: number;
      }
  >;
}

function readRequiredNumber(value: string | undefined, label: string): number {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new BadRequestException(`请输入${label}。`);
  }

  return parsedValue;
}

function normalizeLocationRule(value: unknown, index: number): LocationRules['rules'][number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`第 ${index + 1} 个位置范围不是有效对象。`);
  }

  const candidate = value as Record<string, unknown>;
  const kind = candidate.kind;
  const label = readOptionalString(candidate.label) || `位置范围 ${index + 1}`;
  const expiresAfterSeconds = readOptionalNumber(candidate.expiresAfterSeconds) ?? 60;

  if (expiresAfterSeconds < 10 || expiresAfterSeconds > 300) {
    throw new BadRequestException(`第 ${index + 1} 个位置范围的位置有效秒数需要在 10 到 300 之间。`);
  }

  if (kind === 'circle') {
    const centerX = readRequiredRuleNumber(candidate.centerX, index, '中心 X');
    const centerZ = readRequiredRuleNumber(candidate.centerZ, index, '中心 Z');
    const radius = readRequiredRuleNumber(candidate.radius, index, '半径');

    if (radius <= 0) {
      throw new BadRequestException(`第 ${index + 1} 个圆形范围半径必须大于 0。`);
    }

    return {
      id: readOptionalString(candidate.id) || randomUUID(),
      kind,
      label,
      centerX,
      centerZ,
      radius,
      expiresAfterSeconds,
    };
  }

  if (kind === 'rectangle') {
    const minX = readRequiredRuleNumber(candidate.minX, index, '最小 X');
    const maxX = readRequiredRuleNumber(candidate.maxX, index, '最大 X');
    const minZ = readRequiredRuleNumber(candidate.minZ, index, '最小 Z');
    const maxZ = readRequiredRuleNumber(candidate.maxZ, index, '最大 Z');

    if (minX > maxX || minZ > maxZ) {
      throw new BadRequestException(`第 ${index + 1} 个矩形范围的最小值不能大于最大值。`);
    }

    return {
      id: readOptionalString(candidate.id) || randomUUID(),
      kind,
      label,
      minX,
      maxX,
      minZ,
      maxZ,
      expiresAfterSeconds,
    };
  }

  throw new BadRequestException(`第 ${index + 1} 个位置范围的 kind 必须是 circle 或 rectangle。`);
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
  }

  return null;
}

function readRequiredRuleNumber(value: unknown, index: number, label: string): number {
  const parsedValue = readOptionalNumber(value);

  if (parsedValue === null) {
    throw new BadRequestException(`请输入第 ${index + 1} 个位置范围的${label}。`);
  }

  return parsedValue;
}

function readVersionDisplayName(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const primary = (value as { primary?: unknown }).primary;
  return typeof primary === 'string' && primary.trim().length > 0 ? primary.trim() : null;
}
