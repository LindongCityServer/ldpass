import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '../../framework.js';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  CreateClientApplicationDto,
  CreateProviderClientApplicationDto,
  UpdateClientApplicationDto,
  UpdateProviderClientApplicationDto,
} from './dto.js';

@Injectable()
export class AdminClientApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listClientApplications() {
    const applications = await this.prisma.clientApplication.findMany({
      include: this.applicationInclude(),
      orderBy: {
        updatedAt: 'desc',
      },
      take: 100,
    });

    return {
      applications: applications.map((application) => this.toClientApplicationView(application)),
    };
  }

  async createClientApplication(dto: CreateClientApplicationDto, admin: AuthenticatedUser) {
    const clientId = dto.clientId.trim();
    const name = dto.name.trim();
    const allowedRedirects = this.normalizeRedirects(dto.allowedRedirects);
    const allowedOrigins = this.normalizeOrigins(dto.allowedOrigins);

    if (allowedRedirects.length === 0) {
      throw new BadRequestException('至少需要配置一个允许回跳地址。');
    }

    await this.ensureClientIdAvailable(clientId);
    const provider = await this.readProvider(dto.providerId);

    const application = await this.prisma.clientApplication.create({
      data: {
        clientId,
        name,
        providerId: provider?.id ?? null,
        allowedRedirects: this.toJson(allowedRedirects),
        allowedOrigins: this.toJson(allowedOrigins),
        enabled: dto.enabled ?? true,
      },
      include: this.applicationInclude(),
    });

    await this.eventBus.publish({
      type: 'ClientApplicationCreated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        clientApplicationId: application.id,
        clientId: application.clientId,
        name: application.name,
        createdBy: admin.id,
        createdByType: 'admin',
        ...(application.providerId ? { providerId: application.providerId } : {}),
      },
    });

    if (application.providerId) {
      await this.publishProviderBindingChanged(application, null, 'admin', admin.id);
    }

    return {
      application: this.toClientApplicationView(application),
    };
  }

  async updateClientApplication(
    applicationId: string,
    dto: UpdateClientApplicationDto,
    admin: AuthenticatedUser,
  ) {
    const existing = await this.prisma.clientApplication.findUnique({
      where: {
        id: applicationId,
      },
    });

    if (!existing) {
      throw new NotFoundException('客户端应用不存在。');
    }

    const name = dto.name.trim();
    const allowedRedirects = this.normalizeRedirects(dto.allowedRedirects);
    const allowedOrigins = this.normalizeOrigins(dto.allowedOrigins);
    const provider =
      dto.providerId === undefined ? undefined : await this.readProvider(dto.providerId);

    if (allowedRedirects.length === 0) {
      throw new BadRequestException('至少需要配置一个允许回跳地址。');
    }

    const application = await this.prisma.clientApplication.update({
      where: {
        id: applicationId,
      },
      data: {
        name,
        providerId: provider === undefined ? existing.providerId : (provider?.id ?? null),
        allowedRedirects: this.toJson(allowedRedirects),
        allowedOrigins: this.toJson(allowedOrigins),
        enabled: dto.enabled,
      },
      include: this.applicationInclude(),
    });

    await this.eventBus.publish({
      type: 'ClientApplicationUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        clientApplicationId: application.id,
        clientId: application.clientId,
        name: application.name,
        enabled: application.enabled,
        updatedBy: admin.id,
        updatedByType: 'admin',
        ...(application.providerId ? { providerId: application.providerId } : {}),
      },
    });

    if (existing.providerId !== application.providerId) {
      await this.publishProviderBindingChanged(application, existing.providerId, 'admin', admin.id);
    }

    return {
      application: this.toClientApplicationView(application),
    };
  }

  async deleteClientApplication(applicationId: string, admin: AuthenticatedUser) {
    const application = await this.readClientApplication(applicationId);
    await this.prisma.clientApplication.delete({ where: { id: application.id } });
    await this.publishClientApplicationDeleted(application, 'admin', admin.id);
    return { ok: true };
  }

  async listProviderClientApplications(providerAccount: AuthenticatedProviderAccount) {
    this.requireProviderOwner(providerAccount);
    const applications = await this.prisma.clientApplication.findMany({
      where: {
        providerId: providerAccount.providerId,
        createdByProviderAccountId: { not: null },
      },
      include: this.applicationInclude(),
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return {
      applications: applications.map((application) => this.toClientApplicationView(application)),
    };
  }

  async createProviderClientApplication(
    dto: CreateProviderClientApplicationDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    this.requireProviderOwner(providerAccount);
    const clientId = dto.clientId.trim();
    const name = dto.name.trim();
    const allowedRedirects = this.normalizeRedirects(dto.allowedRedirects);
    const allowedOrigins = this.normalizeOrigins(dto.allowedOrigins);
    this.ensureRedirectsConfigured(allowedRedirects);
    await this.ensureClientIdAvailable(clientId);

    const application = await this.prisma.clientApplication.create({
      data: {
        clientId,
        name,
        providerId: providerAccount.providerId,
        createdByProviderAccountId: providerAccount.id,
        allowedRedirects: this.toJson(allowedRedirects),
        allowedOrigins: this.toJson(allowedOrigins),
        enabled: false,
      },
      include: this.applicationInclude(),
    });

    await this.eventBus.publish({
      type: 'ClientApplicationCreated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        clientApplicationId: application.id,
        clientId: application.clientId,
        name: application.name,
        createdBy: providerAccount.id,
        createdByType: 'provider',
        providerId: providerAccount.providerId,
      },
    });
    await this.publishProviderBindingChanged(application, null, 'provider', providerAccount.id);

    return { application: this.toClientApplicationView(application) };
  }

  async updateProviderClientApplication(
    applicationId: string,
    dto: UpdateProviderClientApplicationDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    this.requireProviderOwner(providerAccount);
    const existing = await this.readOwnedProviderClientApplication(
      applicationId,
      providerAccount.providerId,
    );
    const allowedRedirects = this.normalizeRedirects(dto.allowedRedirects);
    const allowedOrigins = this.normalizeOrigins(dto.allowedOrigins);
    this.ensureRedirectsConfigured(allowedRedirects);

    const application = await this.prisma.clientApplication.update({
      where: { id: existing.id },
      data: {
        name: dto.name.trim(),
        allowedRedirects: this.toJson(allowedRedirects),
        allowedOrigins: this.toJson(allowedOrigins),
      },
      include: this.applicationInclude(),
    });

    await this.eventBus.publish({
      type: 'ClientApplicationUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        clientApplicationId: application.id,
        clientId: application.clientId,
        name: application.name,
        enabled: application.enabled,
        updatedBy: providerAccount.id,
        updatedByType: 'provider',
        providerId: providerAccount.providerId,
      },
    });

    return { application: this.toClientApplicationView(application) };
  }

  async deleteProviderClientApplication(
    applicationId: string,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    this.requireProviderOwner(providerAccount);
    const application = await this.readOwnedProviderClientApplication(
      applicationId,
      providerAccount.providerId,
    );
    await this.prisma.clientApplication.delete({ where: { id: application.id } });
    await this.publishClientApplicationDeleted(application, 'provider', providerAccount.id);
    return { ok: true };
  }

  private normalizeRedirects(values: string[]): string[] {
    return this.unique(values.map((value) => this.normalizeAbsoluteUrl(value, '回跳地址')));
  }

  private ensureRedirectsConfigured(allowedRedirects: string[]): void {
    if (allowedRedirects.length === 0) {
      throw new BadRequestException('至少需要配置一个允许回跳地址。');
    }
  }

  private async ensureClientIdAvailable(clientId: string): Promise<void> {
    const existing = await this.prisma.clientApplication.findUnique({
      where: { clientId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('client_id 已存在。');
    }
  }

  private async readProvider(providerId: string | null | undefined) {
    if (!providerId) {
      return null;
    }

    const provider = await this.prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!provider) {
      throw new BadRequestException('绑定的发卡方不存在。');
    }
    return provider;
  }

  private async readClientApplication(applicationId: string) {
    const application = await this.prisma.clientApplication.findUnique({
      where: { id: applicationId },
      include: this.applicationInclude(),
    });
    if (!application) {
      throw new NotFoundException('客户端应用不存在。');
    }
    return application;
  }

  private async readOwnedProviderClientApplication(applicationId: string, providerId: string) {
    const application = await this.prisma.clientApplication.findFirst({
      where: {
        id: applicationId,
        providerId,
        createdByProviderAccountId: { not: null },
      },
      include: this.applicationInclude(),
    });
    if (!application) {
      throw new NotFoundException('回调申请不存在或不属于当前发卡方。');
    }
    return application;
  }

  private requireProviderOwner(providerAccount: AuthenticatedProviderAccount): void {
    if (providerAccount.role !== 'owner') {
      throw new ForbiddenException('只有发卡方负责人可以管理回调申请。');
    }
  }

  private async publishProviderBindingChanged(
    application: { id: string; clientId: string; providerId: string | null },
    previousProviderId: string | null,
    changedByType: 'admin' | 'provider',
    changedBy: string,
  ): Promise<void> {
    await this.eventBus.publish({
      type: 'ClientApplicationProviderBindingChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: changedByType,
      actorId: changedBy,
      payload: {
        clientApplicationId: application.id,
        clientId: application.clientId,
        ...(previousProviderId ? { previousProviderId } : {}),
        ...(application.providerId ? { providerId: application.providerId } : {}),
        changedByType,
        changedBy,
      },
    });
  }

  private async publishClientApplicationDeleted(
    application: { id: string; clientId: string; providerId: string | null },
    deletedByType: 'admin' | 'provider',
    deletedBy: string,
  ): Promise<void> {
    await this.eventBus.publish({
      type: 'ClientApplicationDeleted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: deletedByType,
      actorId: deletedBy,
      payload: {
        clientApplicationId: application.id,
        clientId: application.clientId,
        ...(application.providerId ? { providerId: application.providerId } : {}),
        deletedByType,
        deletedBy,
      },
    });
  }

  private applicationInclude() {
    return {
      provider: {
        select: { id: true, name: true, slug: true, status: true },
      },
      createdByProviderAccount: {
        select: { id: true, displayName: true, email: true },
      },
    } satisfies Prisma.ClientApplicationInclude;
  }

  private normalizeOrigins(values: string[]): string[] {
    return this.unique(values.map((value) => this.normalizeOrigin(value)));
  }

  private normalizeAbsoluteUrl(value: string, label: string): string {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
      throw new BadRequestException(`${label}不能为空。`);
    }

    let url: URL;
    try {
      url = new URL(trimmedValue);
    } catch {
      throw new BadRequestException(`${label}必须是完整 URL。`);
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException(`${label}只支持 http 或 https。`);
    }

    return url.toString();
  }

  private normalizeOrigin(value: string): string {
    return new URL(this.normalizeAbsoluteUrl(value, '允许来源')).origin;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values));
  }

  private toJson(value: string[]): Prisma.InputJsonValue {
    return value as Prisma.InputJsonArray;
  }

  private toClientApplicationView(application: {
    id: string;
    clientId: string;
    name: string;
    providerId: string | null;
    createdByProviderAccountId: string | null;
    allowedRedirects: unknown;
    allowedOrigins: unknown;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
    provider?: { id: string; name: string; slug: string; status: string } | null;
    createdByProviderAccount?: {
      id: string;
      displayName: string;
      email: string;
    } | null;
  }) {
    return {
      id: application.id,
      clientId: application.clientId,
      name: application.name,
      providerId: application.providerId,
      provider: application.provider ?? null,
      requestedBy: application.createdByProviderAccount ?? null,
      allowedRedirects: this.readStringArray(application.allowedRedirects),
      allowedOrigins: this.readStringArray(application.allowedOrigins),
      enabled: application.enabled,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }
}
