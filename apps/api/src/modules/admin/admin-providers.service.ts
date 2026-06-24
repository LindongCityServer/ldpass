import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  AdminProvidersQueryDto,
  CreateProviderByAdminDto,
  ProviderSensitiveActionDto,
} from './admin-providers.dto.js';

@Injectable()
export class AdminProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretHash: SecretHashService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listProviders(query: AdminProvidersQueryDto) {
    const providers = await this.prisma.provider.findMany({
      where: this.buildProviderWhere(query),
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: this.readTake(query.take),
    });

    return {
      providers: providers.map((provider) => this.toProviderView(provider)),
    };
  }

  async exportProvidersCsv(query: AdminProvidersQueryDto): Promise<string> {
    const providers = await this.prisma.provider.findMany({
      where: this.buildProviderWhere(query),
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: this.readExportTake(query.take),
      include: {
        accounts: {
          select: {
            email: true,
            displayName: true,
            status: true,
            role: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        apiKeys: {
          select: {
            id: true,
            revokedAt: true,
          },
        },
        webhookEndpoints: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            enabled: true,
          },
        },
      },
    });

    const columns: Array<CsvColumn<(typeof providers)[number]>> = [
      { header: '提供方ID', value: (provider) => provider.id },
      { header: '提供方名称', value: (provider) => provider.name },
      { header: '提供方标识', value: (provider) => provider.slug },
      { header: '状态', value: (provider) => provider.status },
      { header: '来源', value: (provider) => provider.source },
      { header: '联系人', value: (provider) => provider.contactName },
      { header: '联系邮箱', value: (provider) => provider.contactEmail },
      { header: '业务说明', value: (provider) => provider.businessInfo },
      { header: '审核/处置原因', value: (provider) => provider.reviewReason },
      { header: '账号数量', value: (provider) => provider.accounts.length, numeric: true },
      {
        header: '负责人/账号邮箱',
        value: (provider) =>
          provider.accounts
            .map((account) => `${account.displayName}<${account.email}>(${account.role}/${account.status})`)
            .join('; '),
      },
      {
        header: '有效API密钥数',
        value: (provider) => provider.apiKeys.filter((apiKey) => !apiKey.revokedAt).length,
        numeric: true,
      },
      {
        header: '启用Webhook端点数',
        value: (provider) => provider.webhookEndpoints.filter((endpoint) => endpoint.enabled).length,
        numeric: true,
      },
      { header: '创建时间', value: (provider) => formatCsvDate(provider.createdAt) },
      { header: '更新时间', value: (provider) => formatCsvDate(provider.updatedAt) },
    ];

    return createCsv(columns, providers);
  }

  async listPendingProviders() {
    const providers = await this.prisma.provider.findMany({
      where: {
        status: {
          in: ['PendingReview', 'Rejected'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      providers: providers.map((provider) => this.toProviderView(provider)),
    };
  }

  async listProfileChangeRequests() {
    const requests = await this.prisma.providerProfileChangeRequest.findMany({
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
      requests: requests.map((request) => this.toProfileChangeRequestView(request)),
    };
  }

  async createProvider(dto: CreateProviderByAdminDto, admin: AuthenticatedUser) {
    const slug = dto.slug.trim().toLowerCase();
    const contactEmail = dto.contactEmail.trim().toLowerCase();
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();
    const existingProvider = await this.prisma.provider.findUnique({
      where: {
        slug,
      },
      select: {
        id: true,
      },
    });

    if (existingProvider) {
      throw new ConflictException('提供方标识已被占用。');
    }

    const passwordHash = await this.secretHash.hashSecret(dto.ownerPassword, 'provider-password');
    const now = new Date();
    const { provider, account } = await this.prisma
      .$transaction(async (transaction) => {
        const createdProvider = await transaction.provider.create({
          data: {
            name: dto.name.trim(),
            slug,
            status: 'Active',
            source: 'admin_created',
            contactName: dto.contactName.trim(),
            contactEmail,
            businessInfo: dto.businessInfo?.trim() || null,
            reviewReason: null,
          },
        });

        const createdAccount = await transaction.providerAccount.create({
          data: {
            providerId: createdProvider.id,
            email: ownerEmail,
            displayName: dto.ownerDisplayName.trim(),
            passwordHash,
            status: 'Active',
            role: 'owner',
          },
        });

        return {
          provider: createdProvider,
          account: createdAccount,
        };
      })
      .catch((error: unknown) => {
        if (isProviderAccountEmailUniqueError(error)) {
          throw new ConflictException('当前数据库仍保留旧的发卡方邮箱唯一约束，请同步数据库结构后重试。');
        }

        throw error;
      });

    await this.eventBus.publish({
      type: 'ProviderCreatedByAdmin',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: provider.id,
        createdBy: admin.id,
      },
    });

    await this.eventBus.publish({
      type: 'ProviderAccountCreated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: provider.id,
        providerAccountId: account.id,
        email: account.email,
      },
    });

    return {
      provider: this.toProviderView(provider),
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        status: account.status,
        role: account.role,
      },
    };
  }

  async approveProvider(providerId: string, admin: AuthenticatedUser) {
    const provider = await this.prisma.provider.findUnique({
      where: {
        id: providerId,
      },
    });

    if (!provider) {
      throw new NotFoundException('提供方不存在。');
    }

    if (provider.status === 'Active') {
      throw new BadRequestException('提供方已经启用。');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const updatedProvider = await transaction.provider.update({
        where: {
          id: provider.id,
        },
        data: {
          status: 'Active',
          reviewReason: null,
        },
      });

      await transaction.providerAccount.updateMany({
        where: {
          providerId: provider.id,
          status: {
            not: 'Archived',
          },
        },
        data: {
          status: 'Active',
        },
      });

      return updatedProvider;
    });

    await this.eventBus.publish({
      type: 'ProviderApproved',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: provider.id,
        approvedBy: admin.id,
      },
    });

    return {
      provider: this.toProviderView(updated),
    };
  }

  async rejectProvider(providerId: string, reason: string, admin: AuthenticatedUser) {
    const provider = await this.prisma.provider.findUnique({
      where: {
        id: providerId,
      },
    });

    if (!provider) {
      throw new NotFoundException('提供方不存在。');
    }

    if (provider.status === 'Active') {
      throw new BadRequestException('已启用提供方不能直接拒绝入驻。');
    }

    const reviewReason = reason.trim();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const updatedProvider = await transaction.provider.update({
        where: {
          id: provider.id,
        },
        data: {
          status: 'Rejected',
          reviewReason,
        },
      });

      await transaction.providerAccount.updateMany({
        where: {
          providerId: provider.id,
          status: {
            not: 'Archived',
          },
        },
        data: {
          status: 'Suspended',
        },
      });

      return updatedProvider;
    });

    await this.eventBus.publish({
      type: 'ProviderRejected',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: provider.id,
        rejectedBy: admin.id,
        reason: reviewReason,
      },
    });

    return {
      provider: this.toProviderView(updated),
    };
  }

  async approveProfileChangeRequest(requestId: string, admin: AuthenticatedUser) {
    const request = await this.readProfileChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条资料变更申请已经处理。');
    }

    if (request.provider.status === 'Archived') {
      throw new BadRequestException('已归档提供方不能继续变更资料。');
    }

    const now = new Date();
    const updatedRequest = await this.prisma.$transaction(async (transaction) => {
      await transaction.provider.update({
        where: {
          id: request.providerId,
        },
        data: {
          name: request.proposedName,
          logoUrl: request.proposedLogoUrl,
          introductionUrl: request.proposedIntroductionUrl,
          contactName: request.proposedContactName,
          contactEmail: request.proposedContactEmail,
          businessInfo: request.proposedBusinessInfo,
          reviewReason: null,
        },
      });

      return transaction.providerProfileChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
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
    });

    await this.eventBus.publish({
      type: 'ProviderProfileChangeApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        profileChangeRequestId: request.id,
        providerId: request.providerId,
        approvedBy: admin.id,
      },
    });

    return {
      request: this.toProfileChangeRequestView(updatedRequest),
    };
  }

  async rejectProfileChangeRequest(requestId: string, reason: string, admin: AuthenticatedUser) {
    const request = await this.readProfileChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条资料变更申请已经处理。');
    }

    const reviewReason = reason.trim();
    const now = new Date();
    const updatedRequest = await this.prisma.providerProfileChangeRequest.update({
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
      type: 'ProviderProfileChangeRejected',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        profileChangeRequestId: request.id,
        providerId: request.providerId,
        rejectedBy: admin.id,
        reason: reviewReason,
      },
    });

    return {
      request: this.toProfileChangeRequestView(updatedRequest),
    };
  }

  async suspendProvider(providerId: string, dto: ProviderSensitiveActionDto, admin: AuthenticatedUser) {
    const provider = await this.readProvider(providerId);

    if (provider.status !== 'Active') {
      throw new BadRequestException('只有已启用提供方可以停用。');
    }

    const reason = dto.reason.trim();
    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), now);

    const updated = await this.prisma.$transaction(async (transaction) => {
      const updatedProvider = await transaction.provider.update({
        where: {
          id: provider.id,
        },
        data: {
          status: 'Suspended',
          reviewReason: reason,
        },
      });

      await transaction.providerAccount.updateMany({
        where: {
          providerId: provider.id,
          status: {
            not: 'Archived',
          },
        },
        data: {
          status: 'Suspended',
        },
      });

      await transaction.providerAuthSession.updateMany({
        where: {
          providerAccount: {
            providerId: provider.id,
          },
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      return updatedProvider;
    });

    await this.eventBus.publish({
      type: 'ProviderSuspended',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: provider.id,
        suspendedBy: admin.id,
        reason,
      },
    });

    return {
      provider: this.toProviderView(updated),
    };
  }

  async unsuspendProvider(providerId: string, dto: ProviderSensitiveActionDto, admin: AuthenticatedUser) {
    const provider = await this.readProvider(providerId);

    if (provider.status !== 'Suspended') {
      throw new BadRequestException('只有已停用提供方可以恢复。');
    }

    const reason = dto.reason.trim();
    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), now);

    const updated = await this.prisma.$transaction(async (transaction) => {
      const updatedProvider = await transaction.provider.update({
        where: {
          id: provider.id,
        },
        data: {
          status: 'Active',
          reviewReason: null,
        },
      });

      await transaction.providerAccount.updateMany({
        where: {
          providerId: provider.id,
          status: 'Suspended',
        },
        data: {
          status: 'Active',
        },
      });

      return updatedProvider;
    });

    await this.eventBus.publish({
      type: 'ProviderUnsuspended',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: provider.id,
        unsuspendedBy: admin.id,
        reason,
      },
    });

    return {
      provider: this.toProviderView(updated),
    };
  }

  async archiveProvider(providerId: string, dto: ProviderSensitiveActionDto, admin: AuthenticatedUser) {
    const provider = await this.readProvider(providerId);

    if (provider.status === 'Archived') {
      throw new BadRequestException('提供方已经归档。');
    }

    const reason = dto.reason.trim();
    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), now);

    const result = await this.prisma.$transaction(async (transaction) => {
      const updatedProvider = await transaction.provider.update({
        where: {
          id: provider.id,
        },
        data: {
          status: 'Archived',
          reviewReason: reason,
        },
      });

      const accounts = await transaction.providerAccount.updateMany({
        where: {
          providerId: provider.id,
          status: {
            not: 'Archived',
          },
        },
        data: {
          status: 'Archived',
        },
      });

      await transaction.providerAuthSession.updateMany({
        where: {
          providerAccount: {
            providerId: provider.id,
          },
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      const apiKeys = await transaction.providerApiKey.updateMany({
        where: {
          providerId: provider.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      const webhookEndpoints = await transaction.providerWebhookEndpoint.updateMany({
        where: {
          providerId: provider.id,
          enabled: true,
          deletedAt: null,
        },
        data: {
          enabled: false,
          lastError: '提供方已由管理员归档，Webhook 端点已停用。',
        },
      });

      return {
        provider: updatedProvider,
        archivedAccountCount: accounts.count,
        revokedApiKeyCount: apiKeys.count,
        disabledWebhookEndpointCount: webhookEndpoints.count,
      };
    });

    await this.eventBus.publish({
      type: 'ProviderArchived',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: provider.id,
        archivedBy: admin.id,
        reason,
        archivedAccountCount: result.archivedAccountCount,
        revokedApiKeyCount: result.revokedApiKeyCount,
        disabledWebhookEndpointCount: result.disabledWebhookEndpointCount,
      },
    });

    return {
      provider: this.toProviderView(result.provider),
    };
  }

  private async readProvider(providerId: string) {
    const provider = await this.prisma.provider.findUnique({
      where: {
        id: providerId,
      },
    });

    if (!provider) {
      throw new NotFoundException('提供方不存在。');
    }

    return provider;
  }

  private async readProfileChangeRequest(requestId: string) {
    const request = await this.prisma.providerProfileChangeRequest.findUnique({
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
      throw new NotFoundException('资料变更申请不存在。');
    }

    return request;
  }

  private buildProviderWhere(query: AdminProvidersQueryDto): Prisma.ProviderWhereInput {
    const keyword = query.keyword?.trim();
    if (!keyword) {
      return {};
    }

    return {
      OR: [
        {
          name: {
            contains: keyword,
          },
        },
        {
          slug: {
            contains: keyword,
          },
        },
        {
          contactName: {
            contains: keyword,
          },
        },
        {
          contactEmail: {
            contains: keyword,
          },
        },
        {
          businessInfo: {
            contains: keyword,
          },
        },
      ],
    };
  }

  private readTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '50', 10);

    if (!Number.isFinite(parsedValue)) {
      return 50;
    }

    return Math.min(Math.max(parsedValue, 1), 100);
  }

  private readExportTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '1000', 10);

    if (!Number.isFinite(parsedValue)) {
      return 1000;
    }

    return Math.min(Math.max(parsedValue, 1), 1000);
  }

  private async verifyAdminPin(admin: AuthenticatedUser, pin: string, challengeId: string, verifiedAt: Date): Promise<void> {
    const adminUser = await this.prisma.user.findUnique({
      where: {
        id: admin.id,
      },
      select: {
        pinHash: true,
      },
    });

    if (!adminUser?.pinHash) {
      throw new BadRequestException('管理员账户尚未设置 PIN，不能执行敏感操作。');
    }

    if (!(await this.secretHash.verifySecret(pin, adminUser.pinHash, 'pin'))) {
      throw new UnauthorizedException('管理员 PIN 不正确。');
    }

    await this.eventBus.publish({
      type: 'PinVerificationSucceeded',
      eventId: randomUUID(),
      occurredAt: verifiedAt.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId: admin.id,
        challengeId,
        purpose: 'sensitive_action',
      },
    });
  }

  private toProviderView(provider: {
    id: string;
    name: string;
    slug: string;
    status: string;
    source: string;
    logoUrl: string | null;
    introductionUrl: string | null;
    contactName: string | null;
    contactEmail: string | null;
    businessInfo: string | null;
    reviewReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: provider.id,
      name: provider.name,
      slug: provider.slug,
      status: provider.status,
      source: provider.source,
      logoUrl: provider.logoUrl,
      introductionUrl: provider.introductionUrl,
      contactName: provider.contactName,
      contactEmail: provider.contactEmail,
      businessInfo: provider.businessInfo,
      reviewReason: provider.reviewReason,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    };
  }

  private toProfileChangeRequestView(request: {
    id: string;
    providerId: string;
    status: string;
    currentName: string;
    currentLogoUrl: string | null;
    currentIntroductionUrl: string | null;
    currentContactName: string | null;
    currentContactEmail: string | null;
    currentBusinessInfo: string | null;
    proposedName: string;
    proposedLogoUrl: string | null;
    proposedIntroductionUrl: string | null;
    proposedContactName: string;
    proposedContactEmail: string;
    proposedBusinessInfo: string | null;
    reason: string | null;
    reviewedById: string | null;
    reviewReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    provider: {
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
      provider: request.provider,
      status: request.status,
      current: {
        name: request.currentName,
        logoUrl: request.currentLogoUrl,
        introductionUrl: request.currentIntroductionUrl,
        contactName: request.currentContactName,
        contactEmail: request.currentContactEmail,
        businessInfo: request.currentBusinessInfo,
      },
      proposed: {
        name: request.proposedName,
        logoUrl: request.proposedLogoUrl,
        introductionUrl: request.proposedIntroductionUrl,
        contactName: request.proposedContactName,
        contactEmail: request.proposedContactEmail,
        businessInfo: request.proposedBusinessInfo,
      },
      reason: request.reason,
      requestedBy: request.requestedBy
        ? {
            email: request.requestedBy.email,
            displayName: request.requestedBy.displayName,
          }
        : null,
      reviewedById: request.reviewedById,
      reviewReason: request.reviewReason,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    };
  }
}

type CsvValue = string | number | boolean | null | undefined;

interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => CsvValue;
  numeric?: boolean;
}

function createCsv<TRow>(columns: Array<CsvColumn<TRow>>, rows: TRow[]): string {
  const headerLine = columns.map((column) => escapeCsvValue(column.header)).join(',');
  const rowLines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(column.value(row), column.numeric === true)).join(','),
  );

  return `\uFEFF${[headerLine, ...rowLines].join('\r\n')}\r\n`;
}

function escapeCsvValue(value: CsvValue, numeric = false): string {
  const rawValue = value === null || value === undefined ? '' : String(value);
  const safeValue = !numeric && startsWithSpreadsheetFormula(rawValue) ? `\t${rawValue}` : rawValue;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

function startsWithSpreadsheetFormula(value: string): boolean {
  const trimmedValue = value.trimStart();
  return /^[=+@]/.test(trimmedValue) || /^-(?!\d+(\.\d+)?$)/.test(trimmedValue);
}

function formatCsvDate(value: Date | null | undefined): string {
  return value ? value.toISOString() : '';
}

function isProviderAccountEmailUniqueError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  const target = (error as { meta?: { target?: unknown } } | null)?.meta?.target;

  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2002' &&
    ((Array.isArray(target) && target.includes('email')) || target === 'ProviderAccount_email_key')
  );
}
