import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PlatformNoticeTone } from '@ldpass/contracts';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { UpdatePlatformStatusDto } from './dto.js';

const platformStatusKey = 'global';

const fallbackStatus = {
  key: platformStatusKey,
  announcementEnabled: false,
  announcementTitle: null as string | null,
  announcementBody: null as string | null,
  announcementTone: 'info' as PlatformNoticeTone,
  maintenanceEnabled: false,
  maintenanceTitle: null as string | null,
  maintenanceBody: null as string | null,
  updatedById: null as string | null,
  createdAt: null as Date | null,
  updatedAt: null as Date | null,
};

@Injectable()
export class PlatformStatusService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async getPublicStatus() {
    const status = await this.readStatus();

    return this.toResponse(status);
  }

  async updateStatus(dto: UpdatePlatformStatusDto, admin: AuthenticatedUser) {
    const normalizedStatus = this.normalizeStatus(dto);
    const status = await this.prisma.platformStatus.upsert({
      where: {
        key: platformStatusKey,
      },
      update: {
        ...normalizedStatus,
        updatedById: admin.id,
      },
      create: {
        key: platformStatusKey,
        ...normalizedStatus,
        updatedById: admin.id,
      },
    });

    await this.eventBus.publish({
      type: 'PlatformStatusUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        updatedBy: admin.id,
        announcementEnabled: status.announcementEnabled,
        announcementTone: status.announcementTone,
        maintenanceEnabled: status.maintenanceEnabled,
      },
    });

    return this.toResponse(status);
  }

  private async readStatus() {
    return (
      (await this.prisma.platformStatus.findUnique({
        where: {
          key: platformStatusKey,
        },
      })) ?? fallbackStatus
    );
  }

  private normalizeStatus(dto: UpdatePlatformStatusDto) {
    const announcementTitle = this.normalizeText(dto.announcementTitle);
    const announcementBody = this.normalizeText(dto.announcementBody);
    const maintenanceTitle = this.normalizeText(dto.maintenanceTitle);
    const maintenanceBody = this.normalizeText(dto.maintenanceBody);

    if (dto.announcementEnabled && !announcementTitle && !announcementBody) {
      throw new BadRequestException('启用全站公告时需要填写标题或正文。');
    }

    if (dto.maintenanceEnabled && !maintenanceTitle && !maintenanceBody) {
      throw new BadRequestException('启用维护状态时需要填写标题或说明。');
    }

    return {
      announcementEnabled: dto.announcementEnabled,
      announcementTitle,
      announcementBody,
      announcementTone: dto.announcementTone,
      maintenanceEnabled: dto.maintenanceEnabled,
      maintenanceTitle,
      maintenanceBody,
    };
  }

  private normalizeText(value: string | undefined): string | null {
    const normalizedValue = value?.trim();
    return normalizedValue ? normalizedValue : null;
  }

  private toResponse(status: typeof fallbackStatus) {
    const updatedAt = status.updatedAt?.toISOString() ?? null;

    return {
      status: {
        announcement: status.announcementEnabled
          ? {
              title: status.announcementTitle,
              body: status.announcementBody,
              tone: status.announcementTone,
              updatedAt,
            }
          : null,
        maintenance: {
          enabled: status.maintenanceEnabled,
          title: status.maintenanceTitle,
          body: status.maintenanceBody,
          updatedAt,
        },
        updatedAt,
      },
      editable: {
        announcementEnabled: status.announcementEnabled,
        announcementTitle: status.announcementTitle ?? '',
        announcementBody: status.announcementBody ?? '',
        announcementTone: status.announcementTone,
        maintenanceEnabled: status.maintenanceEnabled,
        maintenanceTitle: status.maintenanceTitle ?? '',
        maintenanceBody: status.maintenanceBody ?? '',
      },
    };
  }
}
