import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BenefitType } from '@ldpass/contracts';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';

type ExpiringBenefitType = Extract<BenefitType, 'points' | 'times'>;

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listUserNotifications(user: AuthenticatedUser) {
    await this.syncPassExpirationReminders(user);

    const notifications = await this.prisma.userNotification.findMany({
      where: {
        userId: user.id,
      },
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take: 50,
      include: {
        pass: {
          include: {
            provider: true,
            template: true,
          },
        },
      },
    });

    return {
      notifications: notifications.map((notification) => this.toNotificationView(notification)),
    };
  }

  async markNotificationRead(user: AuthenticatedUser, notificationId: string) {
    const notification = await this.prisma.userNotification.findFirst({
      where: {
        id: notificationId,
        userId: user.id,
      },
      include: {
        pass: {
          include: {
            provider: true,
            template: true,
          },
        },
      },
    });

    if (!notification) {
      throw new NotFoundException('提醒不存在或不属于当前账户。');
    }

    if (notification.readAt) {
      return {
        notification: this.toNotificationView(notification),
      };
    }

    const updatedNotification = await this.prisma.userNotification.update({
      where: {
        id: notification.id,
      },
      data: {
        readAt: new Date(),
      },
      include: {
        pass: {
          include: {
            provider: true,
            template: true,
          },
        },
      },
    });

    await this.eventBus.publish({
      type: 'UserNotificationRead',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        notificationId: updatedNotification.id,
      },
    });

    return {
      notification: this.toNotificationView(updatedNotification),
    };
  }

  async syncPassExpirationReminders(user: AuthenticatedUser): Promise<{ createdCount: number }> {
    const currentUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
      select: {
        id: true,
        expirationReminderDays: true,
      },
    });

    if (!currentUser) {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + currentUser.expirationReminderDays * 24 * 60 * 60 * 1000);
    const passes = await this.prisma.pass.findMany({
      where: {
        userId: user.id,
        archivedAt: null,
        status: {
          in: ['Added', 'Active'],
        },
        expiresAt: {
          gt: now,
          lte: horizon,
        },
        template: {
          benefitType: {
            in: ['points', 'times'],
          },
        },
      },
      include: {
        provider: true,
        template: true,
      },
      orderBy: {
        expiresAt: 'asc',
      },
    });

    let createdCount = 0;
    for (const pass of passes) {
      if (!pass.expiresAt) {
        continue;
      }

      const benefitType = pass.template.benefitType as ExpiringBenefitType;
      const dedupeKey = `pass-expiration:${pass.id}:${pass.expiresAt.toISOString()}`;
      const existingNotification = await this.prisma.userNotification.findUnique({
        where: {
          dedupeKey,
        },
        select: {
          id: true,
        },
      });

      if (existingNotification) {
        continue;
      }

      const notification = await this.prisma.userNotification.create({
        data: {
          userId: user.id,
          passId: pass.id,
          kind: 'pass_expiration',
          title: '权益即将过期',
          body: `${pass.template.displayName} 将于 ${formatDate(pass.expiresAt)} 过期。`,
          dedupeKey,
          metadata: this.toJson({
            passId: pass.id,
            providerName: pass.provider.name,
            displayName: pass.template.displayName,
            benefitType,
            maskedNumber: pass.maskedNumber,
            expiresAt: pass.expiresAt.toISOString(),
            reminderDays: currentUser.expirationReminderDays,
          }),
        },
      });

      await this.eventBus.publish({
        type: 'PassExpirationReminderCreated',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorType: 'system',
        actorId: 'system',
        payload: {
          userId: user.id,
          notificationId: notification.id,
          passId: pass.id,
          benefitType,
          expiresAt: pass.expiresAt.toISOString(),
          reminderDays: currentUser.expirationReminderDays,
        },
      });

      createdCount += 1;
    }

    return {
      createdCount,
    };
  }

  private toNotificationView(notification: {
    id: string;
    kind: 'pass_expiration';
    title: string;
    body: string;
    metadata: Prisma.JsonValue | null;
    readAt: Date | null;
    createdAt: Date;
    pass: {
      id: string;
      maskedNumber: string | null;
      expiresAt: Date | null;
      provider: {
        name: string;
      };
      template: {
        displayName: string;
        benefitType: BenefitType;
      };
    } | null;
  }) {
    return {
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      passId: notification.pass?.id ?? null,
      providerName: notification.pass?.provider.name ?? null,
      displayName: notification.pass?.template.displayName ?? null,
      benefitType: notification.pass?.template.benefitType ?? null,
      maskedNumber: notification.pass?.maskedNumber ?? null,
      expiresAt: notification.pass?.expiresAt?.toISOString() ?? null,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
      metadata: notification.metadata,
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
