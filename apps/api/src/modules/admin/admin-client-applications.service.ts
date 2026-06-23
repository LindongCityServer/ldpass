import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { CreateClientApplicationDto, UpdateClientApplicationDto } from './dto.js';

@Injectable()
export class AdminClientApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listClientApplications() {
    const applications = await this.prisma.clientApplication.findMany({
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

    const existing = await this.prisma.clientApplication.findUnique({
      where: {
        clientId,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('client_id 已存在。');
    }

    const application = await this.prisma.clientApplication.create({
      data: {
        clientId,
        name,
        allowedRedirects: this.toJson(allowedRedirects),
        allowedOrigins: this.toJson(allowedOrigins),
        enabled: dto.enabled ?? true,
      },
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
      },
    });

    return {
      application: this.toClientApplicationView(application),
    };
  }

  async updateClientApplication(applicationId: string, dto: UpdateClientApplicationDto, admin: AuthenticatedUser) {
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

    if (allowedRedirects.length === 0) {
      throw new BadRequestException('至少需要配置一个允许回跳地址。');
    }

    const application = await this.prisma.clientApplication.update({
      where: {
        id: applicationId,
      },
      data: {
        name,
        allowedRedirects: this.toJson(allowedRedirects),
        allowedOrigins: this.toJson(allowedOrigins),
        enabled: dto.enabled,
      },
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
      },
    });

    return {
      application: this.toClientApplicationView(application),
    };
  }

  private normalizeRedirects(values: string[]): string[] {
    return this.unique(values.map((value) => this.normalizeAbsoluteUrl(value, '回跳地址')));
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
    allowedRedirects: unknown;
    allowedOrigins: unknown;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: application.id,
      clientId: application.clientId,
      name: application.name,
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
