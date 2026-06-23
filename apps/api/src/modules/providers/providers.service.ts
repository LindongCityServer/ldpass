import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ProviderStatus } from '@ldpass/contracts';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { ProviderLoginDto, RegisterProviderDto, SubmitProviderProfileChangeDto } from './dto.js';

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretHash: SecretHashService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async register(dto: RegisterProviderDto) {
    const slug = dto.slug.trim().toLowerCase();
    const contactEmail = dto.contactEmail.trim().toLowerCase();
    const contactName = dto.contactName.trim();
    const [existingProvider, existingAccount] = await Promise.all([
      this.prisma.provider.findUnique({
        where: {
          slug,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          source: true,
          contactName: true,
          contactEmail: true,
          businessInfo: true,
          introductionUrl: true,
          createdAt: true,
        },
      }),
      this.prisma.providerAccount.findUnique({
        where: {
          email: contactEmail,
        },
        select: {
          id: true,
          providerId: true,
          email: true,
          displayName: true,
          passwordHash: true,
          status: true,
          role: true,
        },
      }),
    ]);

    if (!existingProvider && !existingAccount) {
      return this.createRegistration(dto, slug, contactEmail, contactName);
    }

    if (!existingProvider || !existingAccount || existingProvider.id !== existingAccount.providerId) {
      throw new ConflictException('提供方标识或联系邮箱已被占用。');
    }

    return this.resubmitRegistration(dto, contactEmail, contactName, existingProvider, existingAccount);
  }

  private async createRegistration(
    dto: RegisterProviderDto,
    slug: string,
    contactEmail: string,
    contactName: string,
  ) {
    const passwordHash = await this.secretHash.hashSecret(dto.password, 'provider-password');
    const { provider, account } = await this.prisma.$transaction(async (transaction) => {
      const createdProvider = await transaction.provider.create({
        data: {
          name: dto.name.trim(),
          slug,
          status: 'PendingReview',
          source: 'open_registration',
          contactName,
          contactEmail,
          businessInfo: dto.businessInfo.trim(),
        },
      });

      const createdAccount = await transaction.providerAccount.create({
        data: {
          providerId: createdProvider.id,
          email: contactEmail,
          displayName: contactName,
          passwordHash,
          status: 'PendingReview',
          role: 'owner',
        },
      });

      return {
        provider: createdProvider,
        account: createdAccount,
      };
    });

    await this.eventBus.publish({
      type: 'ProviderSubmitted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: provider.id,
      payload: {
        providerId: provider.id,
        source: 'open_registration',
      },
    });

    await this.eventBus.publish({
      type: 'ProviderAccountCreated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: account.id,
      payload: {
        providerId: provider.id,
        providerAccountId: account.id,
        email: account.email,
      },
    });

    return {
      provider: {
        id: provider.id,
        name: provider.name,
        slug: provider.slug,
        status: provider.status,
        source: provider.source,
        contactName: provider.contactName,
        contactEmail: provider.contactEmail,
        businessInfo: provider.businessInfo,
        introductionUrl: provider.introductionUrl,
        createdAt: provider.createdAt.toISOString(),
      },
      account: {
        id: account.id,
        email: account.email,
        displayName: account.displayName,
        status: account.status,
        role: account.role,
      },
      nextAction: 'wait_for_admin_review',
      resubmitted: false,
    };
  }

  private async resubmitRegistration(
    dto: RegisterProviderDto,
    contactEmail: string,
    contactName: string,
    provider: {
      id: string;
      name: string;
      slug: string;
      status: ProviderStatus;
      source: string;
      contactName: string | null;
      contactEmail: string | null;
      businessInfo: string | null;
      introductionUrl: string | null;
      createdAt: Date;
    },
    account: {
      id: string;
      providerId: string;
      email: string;
      displayName: string;
      passwordHash: string;
      status: string;
      role: string;
    },
  ) {
    if (provider.status !== 'Rejected' && provider.status !== 'PendingReview') {
      throw new ConflictException('该提供方当前不能通过入驻入口重新提交资料。');
    }

    if (!(await this.secretHash.verifySecret(dto.password, account.passwordHash, 'provider-password'))) {
      throw new UnauthorizedException('负责人密码不正确，不能重新提交该提供方申请。');
    }

    const previousStatus = provider.status;
    const updated = await this.prisma.$transaction(async (transaction) => {
      const updatedProvider = await transaction.provider.update({
        where: {
          id: provider.id,
        },
        data: {
          name: dto.name.trim(),
          status: 'PendingReview',
          contactName,
          contactEmail,
          businessInfo: dto.businessInfo.trim(),
          reviewReason: null,
        },
      });

      const updatedAccount = await transaction.providerAccount.update({
        where: {
          id: account.id,
        },
        data: {
          displayName: contactName,
          status: 'PendingReview',
        },
      });

      return {
        provider: updatedProvider,
        account: updatedAccount,
      };
    });

    await this.eventBus.publish({
      type: 'ProviderSubmitted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: provider.id,
      payload: {
        providerId: provider.id,
        source: this.toProviderSource(provider.source),
        resubmitted: true,
        previousStatus,
      },
    });

    return {
      provider: {
        id: updated.provider.id,
        name: updated.provider.name,
        slug: updated.provider.slug,
        status: updated.provider.status,
        source: updated.provider.source,
        contactName: updated.provider.contactName,
        contactEmail: updated.provider.contactEmail,
        businessInfo: updated.provider.businessInfo,
        introductionUrl: updated.provider.introductionUrl,
        createdAt: updated.provider.createdAt.toISOString(),
      },
      account: {
        id: updated.account.id,
        email: updated.account.email,
        displayName: updated.account.displayName,
        status: updated.account.status,
        role: updated.account.role,
      },
      nextAction: 'wait_for_admin_review',
      resubmitted: true,
    };
  }

  async login(dto: ProviderLoginDto) {
    const identifier = dto.identifier.trim().toLowerCase();
    const account = await this.prisma.providerAccount.findUnique({
      where: {
        email: identifier,
      },
      include: {
        provider: true,
      },
    });

    if (!account || !(await this.secretHash.verifySecret(dto.password, account.passwordHash, 'provider-password'))) {
      throw new UnauthorizedException('邮箱或密码不正确。');
    }

    if (account.status !== 'Active' || account.provider.status !== 'Active') {
      throw new ForbiddenException('发卡方账号尚未通过审核或已被停用。');
    }

    await this.eventBus.publish({
      type: 'ProviderLoggedIn',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: account.id,
      payload: {
        providerId: account.providerId,
        providerAccountId: account.id,
      },
    });

    return {
      providerAccount: this.toProviderAccountView(account),
    };
  }

  async listProfileChangeRequests(providerAccount: AuthenticatedProviderAccount) {
    const requests = await this.prisma.providerProfileChangeRequest.findMany({
      where: {
        providerId: providerAccount.providerId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
      include: {
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    return {
      provider: {
        id: providerAccount.providerId,
        name: providerAccount.providerName,
        slug: providerAccount.providerSlug,
        status: providerAccount.providerStatus,
        logoUrl: providerAccount.providerLogoUrl,
        introductionUrl: providerAccount.providerIntroductionUrl,
        contactName: providerAccount.providerContactName,
        contactEmail: providerAccount.providerContactEmail,
        businessInfo: providerAccount.providerBusinessInfo,
      },
      requests: requests.map((request) => this.toProfileChangeRequestView(request)),
    };
  }

  async submitProfileChangeRequest(
    providerAccount: AuthenticatedProviderAccount,
    dto: SubmitProviderProfileChangeDto,
  ) {
    const provider = await this.prisma.provider.findUnique({
      where: {
        id: providerAccount.providerId,
      },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        introductionUrl: true,
        contactName: true,
        contactEmail: true,
        businessInfo: true,
        status: true,
      },
    });

    if (!provider) {
      throw new BadRequestException('提供方不存在。');
    }

    if (provider.status !== 'Active') {
      throw new ForbiddenException('只有已启用提供方可以提交资料变更。');
    }

    const proposed = this.normalizeProfileChangeDto(dto);
    if (
      provider.name === proposed.name &&
      (provider.logoUrl ?? '') === (proposed.logoUrl ?? '') &&
      (provider.introductionUrl ?? '') === (proposed.introductionUrl ?? '') &&
      (provider.contactName ?? '') === proposed.contactName &&
      (provider.contactEmail ?? '') === proposed.contactEmail &&
      (provider.businessInfo ?? '') === proposed.businessInfo
    ) {
      throw new BadRequestException('提交内容与当前资料一致，不需要审核。');
    }

    const pendingRequest = await this.prisma.providerProfileChangeRequest.findFirst({
      where: {
        providerId: provider.id,
        status: 'PendingReview',
      },
      select: {
        id: true,
      },
    });

    if (pendingRequest) {
      throw new ConflictException('已有待审核的资料变更，请等待管理员处理后再提交。');
    }

    const request = await this.prisma.providerProfileChangeRequest.create({
      data: {
        providerId: provider.id,
        requestedById: providerAccount.id,
        currentName: provider.name,
        currentLogoUrl: provider.logoUrl,
        currentIntroductionUrl: provider.introductionUrl,
        currentContactName: provider.contactName,
        currentContactEmail: provider.contactEmail,
        currentBusinessInfo: provider.businessInfo,
        proposedName: proposed.name,
        proposedLogoUrl: proposed.logoUrl,
        proposedIntroductionUrl: proposed.introductionUrl,
        proposedContactName: proposed.contactName,
        proposedContactEmail: proposed.contactEmail,
        proposedBusinessInfo: proposed.businessInfo,
        reason: proposed.reason,
      },
      include: {
        requestedBy: {
          select: {
            email: true,
            displayName: true,
          },
        },
      },
    });

    await this.eventBus.publish({
      type: 'ProviderProfileChangeSubmitted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        profileChangeRequestId: request.id,
        providerId: provider.id,
        requestedBy: providerAccount.id,
        status: 'PendingReview',
      },
    });

    return {
      request: this.toProfileChangeRequestView(request),
    };
  }

  private toProviderAccountView(account: {
    id: string;
    providerId: string;
    email: string;
    displayName: string;
    status: string;
    role: string;
      provider: {
        id: string;
        name: string;
        slug: string;
        status: string;
        logoUrl: string | null;
        introductionUrl: string | null;
      };
  }) {
    return {
      id: account.id,
      providerId: account.providerId,
      providerName: account.provider.name,
      providerSlug: account.provider.slug,
      providerStatus: account.provider.status,
      providerLogoUrl: account.provider.logoUrl,
      providerIntroductionUrl: account.provider.introductionUrl,
      email: account.email,
      displayName: account.displayName,
      status: account.status,
      role: account.role,
    };
  }

  private normalizeProfileChangeDto(dto: SubmitProviderProfileChangeDto) {
    return {
      name: dto.name.trim(),
      logoUrl: this.normalizeProviderLogoUrl(dto.logoUrl),
      introductionUrl: this.normalizeProviderIntroductionUrl(dto.introductionUrl),
      contactName: dto.contactName.trim(),
      contactEmail: dto.contactEmail.trim().toLowerCase(),
      businessInfo: dto.businessInfo.trim(),
      reason: dto.reason?.trim() || null,
    };
  }

  private normalizeProviderLogoUrl(value: string | undefined): string | null {
    const trimmedValue = value?.trim() ?? '';
    if (!trimmedValue) {
      return null;
    }

    let url: URL;
    try {
      url = new URL(trimmedValue);
    } catch {
      throw new BadRequestException('头像链接格式不正确。');
    }

    if (url.protocol !== 'https:') {
      throw new BadRequestException('发卡方头像链接必须使用 HTTPS。');
    }

    if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) {
      throw new BadRequestException('发卡方头像链接只支持 png、jpg、jpeg、webp、gif 或 avif 图片。');
    }

    return url.toString();
  }

  private normalizeProviderIntroductionUrl(value: string | undefined): string | null {
    const trimmedValue = value?.trim() ?? '';
    if (!trimmedValue) {
      return null;
    }

    let url: URL;
    try {
      url = new URL(trimmedValue);
    } catch {
      throw new BadRequestException('发卡方介绍链接格式不正确。');
    }

    if (url.protocol !== 'https:') {
      throw new BadRequestException('发卡方介绍链接必须使用 HTTPS。');
    }

    return url.toString();
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
    requestedBy?: {
      email: string;
      displayName: string;
    } | null;
  }) {
    return {
      id: request.id,
      providerId: request.providerId,
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

  private toProviderSource(source: string): 'admin_created' | 'open_registration' {
    return source === 'admin_created' ? 'admin_created' : 'open_registration';
  }
}
