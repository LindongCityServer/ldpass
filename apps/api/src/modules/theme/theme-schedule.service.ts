import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ThemeAccentTone } from '@ldpass/contracts';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { ThemeScheduleEntryDto } from './dto.js';

const fallbackSchedule = [
  {
    effectiveAt: '1970-01-01T00:00:00.000Z',
    tone: 'teal' as ThemeAccentTone,
    enabled: true,
    note: '平台默认兜底主题色',
  },
];

@Injectable()
export class ThemeScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async getPublicSchedule() {
    const entries = await this.readScheduleEntries({ enabledOnly: true });

    return {
      entries,
    };
  }

  async getAdminSchedule() {
    const entries = await this.readScheduleEntries({ enabledOnly: false });

    return {
      entries,
    };
  }

  async updateSchedule(entries: ThemeScheduleEntryDto[], admin: AuthenticatedUser) {
    const normalizedEntries = this.normalizeEntries(entries);

    await this.prisma.$transaction(async (tx) => {
      await tx.platformThemeScheduleEntry.deleteMany();
      await tx.platformThemeScheduleEntry.createMany({
        data: normalizedEntries.map((entry) => ({
          effectiveAt: entry.effectiveAt,
          tone: entry.tone,
          enabled: entry.enabled,
          note: entry.note ?? null,
          updatedById: admin.id,
        })),
      });
    });

    await this.eventBus.publish({
      type: 'PlatformThemeScheduleUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        updatedBy: admin.id,
        entries: normalizedEntries.map((entry) => this.toEventEntry(entry)),
      },
    });

    return {
      entries: normalizedEntries,
    };
  }

  private async readScheduleEntries(options: { enabledOnly: boolean }) {
    const entries = await this.prisma.platformThemeScheduleEntry.findMany({
      where: options.enabledOnly ? { enabled: true } : {},
      orderBy: {
        effectiveAt: 'asc',
      },
      select: {
        effectiveAt: true,
        tone: true,
        enabled: true,
        note: true,
      },
    });

    return entries.length > 0
      ? entries.map((entry) => ({
          effectiveAt: entry.effectiveAt.toISOString(),
          tone: entry.tone,
          enabled: entry.enabled,
          note: entry.note,
        }))
      : fallbackSchedule;
  }

  private normalizeEntries(entries: ThemeScheduleEntryDto[]) {
    const seenEffectiveTimes = new Set<string>();

    const normalizedEntries = entries
      .map((entry) => ({
        effectiveAt: new Date(entry.effectiveAt),
        tone: entry.tone,
        enabled: entry.enabled,
        note: entry.note?.trim() || null,
      }))
      .sort((left, right) => left.effectiveAt.getTime() - right.effectiveAt.getTime());

    for (const entry of normalizedEntries) {
      if (Number.isNaN(entry.effectiveAt.getTime())) {
        throw new BadRequestException('主题计划中存在无效生效时间。');
      }

      const effectiveAtKey = entry.effectiveAt.toISOString();
      if (seenEffectiveTimes.has(effectiveAtKey)) {
        throw new BadRequestException('主题计划中存在重复生效时间。');
      }
      seenEffectiveTimes.add(effectiveAtKey);
    }

    if (!normalizedEntries.some((entry) => entry.enabled)) {
      throw new BadRequestException('至少需要保留一个启用的主题计划。');
    }

    return normalizedEntries.map((entry) => ({
      effectiveAt: entry.effectiveAt.toISOString(),
      tone: entry.tone,
      enabled: entry.enabled,
      note: entry.note,
    }));
  }

  private toEventEntry(entry: {
    effectiveAt: string;
    tone: ThemeAccentTone;
    enabled: boolean;
    note: string | null;
  }) {
    return {
      effectiveAt: entry.effectiveAt,
      tone: entry.tone,
      enabled: entry.enabled,
      ...(entry.note ? { note: entry.note } : {}),
    };
  }
}
