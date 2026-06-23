import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  AdjustPassBalanceDto,
  AdminPassesQueryDto,
  ChangePassFreezeStatusDto,
  ReviewPassTicketUpdateDto,
  ReversePassTopUpDto,
} from './admin-passes.dto.js';

const decimalScale = 1_000_000n;
const ticketCheckInStatuses = ['not_checked_in', 'checked_in', 'voided'] as const;
const ticketChangeStatuses = ['none', 'rescheduled', 'cancelled'] as const;

interface TicketInfo {
  eventName: string | null;
  venue: string | null;
  startsAt: string | null;
  seatLabel: string | null;
  checkInStatus: (typeof ticketCheckInStatuses)[number];
  changeStatus: (typeof ticketChangeStatuses)[number];
}

@Injectable()
export class AdminPassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretHash: SecretHashService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listPasses(query: AdminPassesQueryDto) {
    const take = this.readTake(query.take);
    const where = this.buildAdminPassWhere(query);

    const passes = await this.prisma.pass.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
      take,
      include: {
        provider: true,
        template: true,
        templateVersion: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    return {
      passes: passes.map((pass) => this.toAdminPass(pass)),
    };
  }

  async exportPassesCsv(query: AdminPassesQueryDto): Promise<string> {
    const passes = await this.prisma.pass.findMany({
      where: this.buildAdminPassWhere(query),
      orderBy: {
        updatedAt: 'desc',
      },
      take: this.readExportTake(query.take),
      include: {
        provider: true,
        template: true,
        templateVersion: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    const columns: Array<CsvColumn<(typeof passes)[number]>> = [
      { header: '卡券ID', value: (pass) => pass.id },
      { header: '提供方ID', value: (pass) => pass.providerId },
      { header: '提供方名称', value: (pass) => pass.provider.name },
      { header: '公开编号', value: (pass) => pass.publicNumber },
      { header: '显示编号', value: (pass) => pass.maskedNumber },
      {
        header: '卡券名称',
        value: (pass) =>
          readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName,
      },
      { header: '模板标题', value: (pass) => pass.templateVersion.title },
      { header: '分类', value: (pass) => pass.template.category },
      { header: '权益类型', value: (pass) => pass.template.benefitType },
      { header: '状态', value: (pass) => pass.status },
      { header: '当前值', value: (pass) => pass.balanceValue.toString(), numeric: true },
      { header: '冻结值', value: (pass) => pass.frozenValue.toString(), numeric: true },
      { header: '透支额度', value: (pass) => pass.overdraftLimit.toString(), numeric: true },
      { header: '持有人ID', value: (pass) => pass.user?.id },
      { header: '持有人用户名', value: (pass) => pass.user?.username },
      { header: '持有人邮箱', value: (pass) => pass.user?.email },
      { header: '领取时间', value: (pass) => formatCsvDate(pass.addedAt) },
      { header: '归档时间', value: (pass) => formatCsvDate(pass.archivedAt) },
      { header: '创建时间', value: (pass) => formatCsvDate(pass.createdAt) },
      { header: '更新时间', value: (pass) => formatCsvDate(pass.updatedAt) },
    ];

    return createCsv(columns, passes);
  }

  async exportLedgerCsv(query: AdminPassesQueryDto): Promise<string> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: this.buildAdminLedgerWhere(query),
      orderBy: {
        createdAt: 'desc',
      },
      take: this.readExportTake(query.take),
      include: {
        provider: true,
        pass: {
          include: {
            template: true,
            templateVersion: true,
            provider: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    const columns: Array<CsvColumn<(typeof entries)[number]>> = [
      { header: '流水ID', value: (entry) => entry.id },
      { header: '卡券ID', value: (entry) => entry.passId },
      { header: '提供方ID', value: (entry) => entry.providerId },
      { header: '提供方名称', value: (entry) => entry.provider.name },
      { header: '公开编号', value: (entry) => entry.pass.publicNumber },
      { header: '显示编号', value: (entry) => entry.pass.maskedNumber },
      {
        header: '卡券名称',
        value: (entry) =>
          readVersionDisplayName(entry.pass.templateVersion.fields) ??
          entry.pass.template.displayName,
      },
      { header: '模板标题', value: (entry) => entry.pass.templateVersion.title },
      { header: '权益类型', value: (entry) => entry.benefitType },
      { header: '原因', value: (entry) => entry.reason },
      { header: '变化前', value: (entry) => entry.beforeValue.toString(), numeric: true },
      { header: '变化量', value: (entry) => entry.changeValue.toString(), numeric: true },
      { header: '变化后', value: (entry) => entry.afterValue.toString(), numeric: true },
      { header: '备注', value: (entry) => entry.note },
      { header: '持有人ID', value: (entry) => entry.user?.id ?? entry.pass.user?.id },
      {
        header: '持有人用户名',
        value: (entry) => entry.user?.username ?? entry.pass.user?.username,
      },
      { header: '持有人邮箱', value: (entry) => entry.user?.email ?? entry.pass.user?.email },
      { header: '操作者类型', value: (entry) => entry.createdByType },
      { header: '操作者ID', value: (entry) => entry.createdById },
      { header: '引用类型', value: (entry) => entry.referenceType },
      { header: '引用ID', value: (entry) => entry.referenceId },
      { header: '创建时间', value: (entry) => formatCsvDate(entry.createdAt) },
    ];

    return createCsv(columns, entries);
  }

  async listPendingTicketUpdateRequests() {
    const requests = await this.prisma.passTicketUpdateRequest.findMany({
      where: {
        status: 'PendingReview',
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
      include: {
        provider: true,
        pass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    return {
      ticketUpdateRequests: requests.map((request) => this.toAdminTicketUpdateRequest(request)),
    };
  }

  async approveTicketUpdateRequest(requestId: string, dto: ReviewPassTicketUpdateDto, admin: AuthenticatedUser) {
    const request = await this.prisma.passTicketUpdateRequest.findUnique({
      where: {
        id: requestId,
      },
      include: {
        pass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('票券字段变更申请不存在。');
    }

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('只有待审核的票券字段变更申请可以通过。');
    }

    const proposedTicketInfo = readTicketInfoFromJson(request.proposedTicketInfo);
    if (!proposedTicketInfo) {
      throw new BadRequestException('票券字段变更申请内容异常，不能通过。');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.passTicketUpdateRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          reviewedById: admin.id,
          reviewReason: dto.reason?.trim() || null,
          reviewedAt: now,
        },
        include: {
          provider: true,
          pass: {
            include: {
              provider: true,
              template: true,
              templateVersion: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      const updatedPass = await tx.pass.update({
        where: {
          id: request.passId,
        },
        data: {
          metadata: mergePassMetadata(request.pass.metadata, proposedTicketInfo),
        },
        include: {
          provider: true,
          template: true,
          templateVersion: true,
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
      });

      return {
        pass: updatedPass,
        request: updatedRequest,
      };
    });

    await this.eventBus.publish({
      type: 'PassTicketUpdateApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        ticketUpdateRequestId: request.id,
        passId: request.passId,
        providerId: request.providerId,
        approvedBy: admin.id,
      },
    });

    await this.eventBus.publish({
      type: 'PassTicketStatusUpdated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        passId: request.passId,
        providerId: request.providerId,
        checkInStatus: proposedTicketInfo.checkInStatus,
        changeStatus: proposedTicketInfo.changeStatus,
        ...(proposedTicketInfo.eventName ? { eventName: proposedTicketInfo.eventName } : {}),
        ...(proposedTicketInfo.startsAt ? { startsAt: proposedTicketInfo.startsAt } : {}),
        ...(proposedTicketInfo.seatLabel ? { seatLabel: proposedTicketInfo.seatLabel } : {}),
      },
    });

    return {
      pass: this.toAdminPass(result.pass),
      ticketUpdateRequest: this.toAdminTicketUpdateRequest(result.request),
    };
  }

  async rejectTicketUpdateRequest(requestId: string, dto: ReviewPassTicketUpdateDto, admin: AuthenticatedUser) {
    const reason = dto.reason?.trim();
    if (!reason) {
      throw new BadRequestException('拒绝票券字段变更申请时需要填写原因。');
    }

    const request = await this.prisma.passTicketUpdateRequest.findUnique({
      where: {
        id: requestId,
      },
      include: {
        provider: true,
        pass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('票券字段变更申请不存在。');
    }

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('只有待审核的票券字段变更申请可以拒绝。');
    }

    const updatedRequest = await this.prisma.passTicketUpdateRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'Rejected',
        reviewedById: admin.id,
        reviewReason: reason,
        reviewedAt: new Date(),
      },
      include: {
        provider: true,
        pass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    await this.eventBus.publish({
      type: 'PassTicketUpdateRejected',
      eventId: randomUUID(),
      occurredAt: updatedRequest.reviewedAt?.toISOString() ?? new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        ticketUpdateRequestId: request.id,
        passId: request.passId,
        providerId: request.providerId,
        rejectedBy: admin.id,
        reason,
      },
    });

    return {
      ticketUpdateRequest: this.toAdminTicketUpdateRequest(updatedRequest),
    };
  }

  async adjustBalance(passId: string, dto: AdjustPassBalanceDto, admin: AuthenticatedUser) {
    const pass = await this.prisma.pass.findUnique({
      where: {
        id: passId,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在。');
    }

    if (pass.status === 'Archived') {
      throw new BadRequestException('已归档卡券不能调整权益。');
    }

    const changeValue = normalizeDecimal(dto.changeValue);
    if (changeValue === '0') {
      throw new BadRequestException('调整值不能为 0。');
    }

    const beforeValue = pass.balanceValue.toString();
    const afterValue = addDecimalStrings(beforeValue, changeValue);
    const adjustmentId = randomUUID();
    const idempotencyKey = dto.idempotencyKey?.trim() || `admin-adjustment:${adjustmentId}`;
    const now = new Date();

    await this.verifyAdminPin(admin, dto.secondFactor, adjustmentId, now, 'admin_adjustment');

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updatedPass = await tx.pass.update({
          where: {
            id: pass.id,
          },
          data: {
            balanceValue: afterValue,
          },
          include: {
            provider: true,
            template: true,
            templateVersion: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        });

        const ledgerEntry = await tx.ledgerEntry.create({
          data: {
            passId: pass.id,
            userId: pass.userId,
            providerId: pass.providerId,
            benefitType: pass.template.benefitType,
            reason: 'adjustment',
            beforeValue,
            changeValue,
            afterValue,
            idempotencyKey,
            referenceType: 'AdminBalanceAdjustment',
            referenceId: adjustmentId,
            note: dto.note?.trim() || dto.reason.trim(),
            createdByType: 'admin',
            createdById: admin.id,
          },
        });

        return {
          ledgerEntry,
          pass: updatedPass,
        };
      });

      await this.eventBus.publish({
        type: 'AdminBalanceAdjustmentRequested',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          adjustmentId,
          passId: pass.id,
          requestedBy: admin.id,
          balanceType: pass.template.benefitType,
          beforeValue,
          afterValue,
          reason: dto.reason.trim(),
        },
      });

      await this.eventBus.publish({
        type: 'AdminBalanceAdjustmentApproved',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          adjustmentId,
          approvedBy: admin.id,
          ledgerEntryId: result.ledgerEntry.id,
        },
      });

      await this.eventBus.publish({
        type: 'PassBalanceChanged',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          passId: pass.id,
          providerId: pass.providerId,
          balanceType: pass.template.benefitType,
          beforeValue,
          afterValue,
          changeValue,
          reason: 'adjustment',
          referenceId: result.ledgerEntry.id,
        },
      });

      return {
        ledgerEntry: {
          id: result.ledgerEntry.id,
          beforeValue: result.ledgerEntry.beforeValue.toString(),
          changeValue: result.ledgerEntry.changeValue.toString(),
          afterValue: result.ledgerEntry.afterValue.toString(),
          reason: result.ledgerEntry.reason,
          note: result.ledgerEntry.note,
          createdAt: result.ledgerEntry.createdAt.toISOString(),
        },
        pass: this.toAdminPass(result.pass),
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('这次调整已经提交过，请刷新卡券后再确认结果。');
      }

      throw error;
    }
  }

  async freezePass(passId: string, dto: ChangePassFreezeStatusDto, admin: AuthenticatedUser) {
    return this.changeFreezeStatus(passId, 'Frozen', dto, admin);
  }

  async unfreezePass(passId: string, dto: ChangePassFreezeStatusDto, admin: AuthenticatedUser) {
    return this.changeFreezeStatus(passId, 'Active', dto, admin);
  }

  async reverseTopUp(topUpId: string, dto: ReversePassTopUpDto, admin: AuthenticatedUser) {
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('冲正原因不能为空。');
    }

    const existingReversalEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        reason: 'refund',
        referenceType: 'PassTopUpReversal',
        referenceId: topUpId,
      },
      include: {
        pass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (existingReversalEntries.length >= 2) {
      await this.prisma.passTopUpRequest.updateMany({
        where: {
          id: topUpId,
          status: {
            not: 'Reversed',
          },
        },
        data: {
          status: 'Reversed',
          reversedAt: new Date(),
        },
      });

      return {
        topUp: {
          id: topUpId,
          reversed: true,
          alreadyReversed: true,
        },
        ledgerEntries: existingReversalEntries.map((entry) =>
          this.toTopUpReversalLedgerEntry(entry),
        ),
        passes: existingReversalEntries.map((entry) => this.toAdminPass(entry.pass)),
      };
    }

    if (existingReversalEntries.length === 1) {
      throw new ConflictException('这笔额度补充已有不完整冲正记录，请先人工检查流水。');
    }

    const originalEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        reason: 'top_up',
        referenceId: topUpId,
        referenceType: {
          in: ['pass_top_up', 'WalletActionLink'],
        },
      },
      include: {
        pass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (originalEntries.length !== 2) {
      throw new NotFoundException('没有找到完整的额度补充流水，请确认补充 ID 是否正确。');
    }

    const sourceEntry = originalEntries.find(
      (entry) => parseFixedDecimal(entry.changeValue.toString()) < 0n,
    );
    const targetEntry = originalEntries.find(
      (entry) => parseFixedDecimal(entry.changeValue.toString()) > 0n,
    );

    if (!sourceEntry || !targetEntry) {
      throw new BadRequestException('这笔额度补充流水方向异常，不能自动冲正。');
    }

    if (sourceEntry.benefitType !== targetEntry.benefitType) {
      throw new BadRequestException('来源卡和目标卡权益类型不一致，不能自动冲正。');
    }

    const topUpUserId = targetEntry.userId ?? sourceEntry.userId;
    if (!topUpUserId) {
      throw new BadRequestException('这笔额度补充缺少用户归属，不能自动冲正。');
    }

    const reversedValue = targetEntry.changeValue.toString();
    if (
      normalizeDecimal(negateDecimalString(sourceEntry.changeValue.toString())) !==
      normalizeDecimal(reversedValue)
    ) {
      throw new BadRequestException('来源卡和目标卡的补充金额不一致，不能自动冲正。');
    }

    const now = new Date();
    const challengeId = randomUUID();
    await this.verifyAdminPin(admin, dto.secondFactor, challengeId, now, 'admin_adjustment');

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const duplicateReversal = await tx.ledgerEntry.findFirst({
          where: {
            reason: 'refund',
            referenceType: 'PassTopUpReversal',
            referenceId: topUpId,
          },
        });

        if (duplicateReversal) {
          throw new ConflictException('这笔额度补充已经冲正，请刷新后查看最新流水。');
        }

        const [currentSourcePass, currentTargetPass] = await Promise.all([
          tx.pass.findUnique({
            where: {
              id: sourceEntry.passId,
            },
            include: {
              provider: true,
              template: true,
              templateVersion: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                },
              },
            },
          }),
          tx.pass.findUnique({
            where: {
              id: targetEntry.passId,
            },
            include: {
              provider: true,
              template: true,
              templateVersion: true,
              user: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                },
              },
            },
          }),
        ]);

        if (!currentSourcePass || !currentTargetPass) {
          throw new NotFoundException('额度补充涉及的卡券不存在，不能冲正。');
        }

        const sourceBeforeValue = currentSourcePass.balanceValue.toString();
        const sourceChangeValue = reversedValue;
        const sourceAfterValue = addDecimalStrings(sourceBeforeValue, sourceChangeValue);
        const targetBeforeValue = currentTargetPass.balanceValue.toString();
        const targetChangeValue = negateDecimalString(reversedValue);
        const targetAfterValue = addDecimalStrings(targetBeforeValue, targetChangeValue);

        const [updatedSourcePass, updatedTargetPass, sourceRefundEntry, targetRefundEntry] =
          await Promise.all([
            tx.pass.update({
              where: {
                id: currentSourcePass.id,
              },
              data: {
                balanceValue: sourceAfterValue,
              },
              include: {
                provider: true,
                template: true,
                templateVersion: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    email: true,
                  },
                },
              },
            }),
            tx.pass.update({
              where: {
                id: currentTargetPass.id,
              },
              data: {
                balanceValue: targetAfterValue,
              },
              include: {
                provider: true,
                template: true,
                templateVersion: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    email: true,
                  },
                },
              },
            }),
            tx.ledgerEntry.create({
              data: {
                passId: currentSourcePass.id,
                userId: currentSourcePass.userId,
                providerId: currentSourcePass.providerId,
                benefitType: sourceEntry.benefitType,
                reason: 'refund',
                beforeValue: sourceBeforeValue,
                changeValue: sourceChangeValue,
                afterValue: sourceAfterValue,
                idempotencyKey: `top-up-reversal:${topUpId}:source`,
                referenceType: 'PassTopUpReversal',
                referenceId: topUpId,
                note: `管理员冲正额度补充：${reason}`,
                createdByType: 'admin',
                createdById: admin.id,
                createdAt: now,
              },
            }),
            tx.ledgerEntry.create({
              data: {
                passId: currentTargetPass.id,
                userId: currentTargetPass.userId,
                providerId: currentTargetPass.providerId,
                benefitType: targetEntry.benefitType,
                reason: 'refund',
                beforeValue: targetBeforeValue,
                changeValue: targetChangeValue,
                afterValue: targetAfterValue,
                idempotencyKey: `top-up-reversal:${topUpId}:target`,
                referenceType: 'PassTopUpReversal',
                referenceId: topUpId,
                note: `管理员冲正额度补充：${reason}`,
                createdByType: 'admin',
                createdById: admin.id,
                createdAt: now,
              },
            }),
            tx.passTopUpRequest.updateMany({
              where: {
                id: topUpId,
                status: 'Succeeded',
              },
              data: {
                status: 'Reversed',
                reversedAt: now,
              },
            }),
          ]);

        return {
          sourceBeforeValue,
          sourceAfterValue,
          sourceChangeValue,
          targetBeforeValue,
          targetAfterValue,
          targetChangeValue,
          sourcePass: updatedSourcePass,
          targetPass: updatedTargetPass,
          sourceRefundEntry,
          targetRefundEntry,
        };
      });

      await this.eventBus.publish({
        type: 'PassTopUpReversed',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          topUpId,
          userId: topUpUserId,
          sourcePassId: sourceEntry.passId,
          targetPassId: targetEntry.passId,
          providerId: targetEntry.providerId,
          sourceProviderId: sourceEntry.providerId,
          benefitType: targetEntry.benefitType,
          reversedValue,
          sourceLedgerEntryId: sourceEntry.id,
          targetLedgerEntryId: targetEntry.id,
          sourceRefundLedgerEntryId: result.sourceRefundEntry.id,
          targetRefundLedgerEntryId: result.targetRefundEntry.id,
          reversedBy: admin.id,
          reason,
        },
      });

      await this.eventBus.publish({
        type: 'PassBalanceChanged',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          passId: sourceEntry.passId,
          providerId: sourceEntry.providerId,
          balanceType: sourceEntry.benefitType,
          beforeValue: result.sourceBeforeValue,
          afterValue: result.sourceAfterValue,
          changeValue: result.sourceChangeValue,
          reason: 'refund',
          referenceId: result.sourceRefundEntry.id,
        },
      });

      await this.eventBus.publish({
        type: 'PassBalanceChanged',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          passId: targetEntry.passId,
          providerId: targetEntry.providerId,
          balanceType: targetEntry.benefitType,
          beforeValue: result.targetBeforeValue,
          afterValue: result.targetAfterValue,
          changeValue: result.targetChangeValue,
          reason: 'refund',
          referenceId: result.targetRefundEntry.id,
        },
      });

      return {
        topUp: {
          id: topUpId,
          reversed: true,
          alreadyReversed: false,
          reversedValue,
        },
        sourcePass: this.toAdminPass(result.sourcePass),
        targetPass: this.toAdminPass(result.targetPass),
        ledgerEntries: [
          this.toTopUpReversalLedgerEntry(result.sourceRefundEntry),
          this.toTopUpReversalLedgerEntry(result.targetRefundEntry),
        ],
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('这笔额度补充已经冲正，请刷新后查看最新流水。');
      }

      throw error;
    }
  }

  private async changeFreezeStatus(
    passId: string,
    nextStatus: 'Frozen' | 'Active',
    dto: ChangePassFreezeStatusDto,
    admin: AuthenticatedUser,
  ) {
    const pass = await this.prisma.pass.findUnique({
      where: {
        id: passId,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在。');
    }

    if (pass.status === 'Archived') {
      throw new BadRequestException('已归档卡券不能冻结或解冻。');
    }

    if (nextStatus === 'Frozen' && pass.status === 'Frozen') {
      throw new BadRequestException('卡券已经处于冻结状态。');
    }

    if (nextStatus === 'Active' && pass.status !== 'Frozen') {
      throw new BadRequestException('只有已冻结卡券可以解冻。');
    }

    const reason = dto.reason.trim();
    const challengeId = randomUUID();
    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, challengeId, now, 'sensitive_action');

    const updatedPass = await this.prisma.pass.update({
      where: {
        id: pass.id,
      },
      data: {
        status: nextStatus,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    await this.eventBus.publish({
      type: nextStatus === 'Frozen' ? 'PassFrozen' : 'PassUnfrozen',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        passId: pass.id,
        reason,
      },
    });

    return {
      pass: this.toAdminPass(updatedPass),
    };
  }

  private async verifyAdminPin(
    admin: AuthenticatedUser,
    pin: string,
    challengeId: string,
    verifiedAt: Date,
    purpose: 'admin_adjustment' | 'sensitive_action',
  ): Promise<void> {
    const adminUser = await this.prisma.user.findUnique({
      where: {
        id: admin.id,
      },
      select: {
        pinHash: true,
      },
    });

    if (!adminUser?.pinHash) {
      throw new UnauthorizedException('管理员账号尚未设置 PIN，不能执行权益调整。');
    }

    if (!(await this.secretHash.verifySecret(pin, adminUser.pinHash, 'pin'))) {
      throw new UnauthorizedException('管理员 PIN 不正确，不能执行权益调整。');
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
        purpose,
      },
    });
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

  private buildAdminPassWhere(query: AdminPassesQueryDto): Prisma.PassWhereInput {
    const keyword = query.keyword?.trim();
    return keyword
      ? {
          OR: [
            {
              publicNumber: {
                contains: keyword,
              },
            },
            {
              maskedNumber: {
                contains: keyword,
              },
            },
            {
              provider: {
                name: {
                  contains: keyword,
                },
              },
            },
            {
              template: {
                displayName: {
                  contains: keyword,
                },
              },
            },
            {
              templateVersion: {
                title: {
                  contains: keyword,
                },
              },
            },
            {
              user: {
                is: {
                  username: {
                    contains: keyword,
                  },
                },
              },
            },
            {
              user: {
                is: {
                  email: {
                    contains: keyword,
                  },
                },
              },
            },
          ],
        }
      : {};
  }

  private buildAdminLedgerWhere(query: AdminPassesQueryDto): Prisma.LedgerEntryWhereInput {
    const keyword = query.keyword?.trim();
    return keyword
      ? {
          OR: [
            {
              note: {
                contains: keyword,
              },
            },
            {
              referenceType: {
                contains: keyword,
              },
            },
            {
              referenceId: {
                contains: keyword,
              },
            },
            {
              provider: {
                name: {
                  contains: keyword,
                },
              },
            },
            {
              pass: {
                publicNumber: {
                  contains: keyword,
                },
              },
            },
            {
              pass: {
                maskedNumber: {
                  contains: keyword,
                },
              },
            },
            {
              pass: {
                template: {
                  displayName: {
                    contains: keyword,
                  },
                },
              },
            },
            {
              pass: {
                templateVersion: {
                  title: {
                    contains: keyword,
                  },
                },
              },
            },
            {
              user: {
                is: {
                  username: {
                    contains: keyword,
                  },
                },
              },
            },
            {
              user: {
                is: {
                  email: {
                    contains: keyword,
                  },
                },
              },
            },
          ],
        }
      : {};
  }

  private toAdminTicketUpdateRequest(request: {
    id: string;
    passId: string;
    providerId: string;
    requestedById: string | null;
    status: string;
    currentTicketInfo: Prisma.JsonValue | null;
    proposedTicketInfo: Prisma.JsonValue;
    reason: string | null;
    reviewedById: string | null;
    reviewReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    provider?: {
      id: string;
      name: string;
    };
    pass: {
      id: string;
      provider: {
        id: string;
        name: string;
      };
      template: {
        displayName: string;
        benefitType: string;
        category: string;
      };
      templateVersion: {
        title: string;
        fields: Prisma.JsonValue;
      };
      publicNumber: string | null;
      maskedNumber: string | null;
      user: {
        id: string;
        username: string;
        email: string;
      } | null;
    };
  }) {
    return {
      id: request.id,
      passId: request.passId,
      providerId: request.providerId,
      providerName: request.provider?.name ?? request.pass.provider.name,
      requestedById: request.requestedById,
      status: request.status,
      currentTicketInfo: readTicketInfoFromJson(request.currentTicketInfo),
      proposedTicketInfo: readTicketInfoFromJson(request.proposedTicketInfo),
      reason: request.reason,
      reviewedById: request.reviewedById,
      reviewReason: request.reviewReason,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      pass: {
        id: request.pass.id,
        displayName: readVersionDisplayName(request.pass.templateVersion.fields) ?? request.pass.template.displayName,
        title: request.pass.templateVersion.title,
        category: request.pass.template.category,
        benefitType: request.pass.template.benefitType,
        publicNumber: request.pass.publicNumber,
        maskedNumber: request.pass.maskedNumber,
        user: request.pass.user,
      },
    };
  }

  private toAdminPass(pass: {
    id: string;
    provider: {
      id: string;
      name: string;
    };
    template: {
      displayName: string;
      benefitType: string;
      category: string;
    };
    templateVersion: {
      title: string;
      fields: Prisma.JsonValue;
    };
    user: {
      id: string;
      username: string;
      email: string;
    } | null;
    status: string;
    publicNumber: string | null;
    maskedNumber: string | null;
    balanceValue: { toString(): string };
    frozenValue: { toString(): string };
    overdraftLimit: { toString(): string };
    updatedAt: Date;
  }) {
    return {
      id: pass.id,
      providerId: pass.provider.id,
      providerName: pass.provider.name,
      displayName: readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName,
      title: pass.templateVersion.title,
      category: pass.template.category,
      benefitType: pass.template.benefitType,
      status: pass.status,
      publicNumber: pass.publicNumber,
      maskedNumber: pass.maskedNumber,
      balanceValue: pass.balanceValue.toString(),
      frozenValue: pass.frozenValue.toString(),
      overdraftLimit: pass.overdraftLimit.toString(),
      user: pass.user,
      updatedAt: pass.updatedAt.toISOString(),
    };
  }

  private toTopUpReversalLedgerEntry(entry: {
    id: string;
    passId: string;
    providerId: string;
    benefitType: string;
    reason: string;
    beforeValue: { toString(): string };
    changeValue: { toString(): string };
    afterValue: { toString(): string };
    referenceType: string | null;
    referenceId: string | null;
    note: string | null;
    createdByType: string;
    createdById: string | null;
    createdAt: Date;
  }) {
    return {
      id: entry.id,
      passId: entry.passId,
      providerId: entry.providerId,
      benefitType: entry.benefitType,
      reason: entry.reason,
      beforeValue: entry.beforeValue.toString(),
      changeValue: entry.changeValue.toString(),
      afterValue: entry.afterValue.toString(),
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      note: entry.note,
      createdByType: entry.createdByType,
      createdById: entry.createdById,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}

function addDecimalStrings(firstValue: string, secondValue: string): string {
  const result = parseFixedDecimal(firstValue) + parseFixedDecimal(secondValue);
  return formatFixedDecimal(result);
}

function negateDecimalString(value: string): string {
  return formatFixedDecimal(-parseFixedDecimal(value));
}

function normalizeDecimal(value: string): string {
  return formatFixedDecimal(parseFixedDecimal(value));
}

function parseFixedDecimal(value: string): bigint {
  const trimmedValue = value.trim();
  const sign = trimmedValue.startsWith('-') ? -1n : 1n;
  const unsignedValue = trimmedValue.replace(/^[+-]/, '');
  const [wholePart = '0', fractionPart = ''] = unsignedValue.split('.');
  const paddedFraction = fractionPart.padEnd(6, '0').slice(0, 6);
  return sign * (BigInt(wholePart) * decimalScale + BigInt(paddedFraction || '0'));
}

function formatFixedDecimal(value: bigint): string {
  if (value === 0n) {
    return '0';
  }

  const sign = value < 0n ? '-' : '';
  const absoluteValue = value < 0n ? -value : value;
  const wholePart = absoluteValue / decimalScale;
  const fractionPart = String(absoluteValue % decimalScale)
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${sign}${wholePart.toString()}${fractionPart ? `.${fractionPart}` : ''}`;
}

function mergePassMetadata(metadata: Prisma.JsonValue | null, ticketInfo: TicketInfo): Prisma.InputJsonObject {
  const baseMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

  return {
    ...baseMetadata,
    ticketInfo: ticketInfoToJson(ticketInfo),
  } as Prisma.InputJsonObject;
}

function readTicketInfoFromJson(value: Prisma.JsonValue | null): TicketInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  return {
    eventName: typeof candidate.eventName === 'string' && candidate.eventName.trim() ? candidate.eventName : null,
    venue: typeof candidate.venue === 'string' && candidate.venue.trim() ? candidate.venue : null,
    startsAt: typeof candidate.startsAt === 'string' && candidate.startsAt.trim() ? candidate.startsAt : null,
    seatLabel: typeof candidate.seatLabel === 'string' && candidate.seatLabel.trim() ? candidate.seatLabel : null,
    checkInStatus: isTicketCheckInStatus(candidate.checkInStatus) ? candidate.checkInStatus : 'not_checked_in',
    changeStatus: isTicketChangeStatus(candidate.changeStatus) ? candidate.changeStatus : 'none',
  };
}

function ticketInfoToJson(ticketInfo: TicketInfo): Prisma.InputJsonObject {
  return {
    eventName: ticketInfo.eventName,
    venue: ticketInfo.venue,
    startsAt: ticketInfo.startsAt,
    seatLabel: ticketInfo.seatLabel,
    checkInStatus: ticketInfo.checkInStatus,
    changeStatus: ticketInfo.changeStatus,
  };
}

function isTicketCheckInStatus(value: unknown): value is TicketInfo['checkInStatus'] {
  return ticketCheckInStatuses.includes(value as TicketInfo['checkInStatus']);
}

function isTicketChangeStatus(value: unknown): value is TicketInfo['changeStatus'] {
  return ticketChangeStatuses.includes(value as TicketInfo['changeStatus']);
}

type CsvValue = string | number | boolean | null | undefined;

interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => CsvValue;
  numeric?: boolean;
}

function createCsv<TRow>(columns: Array<CsvColumn<TRow>>, rows: TRow[]): string {
  const headerLine = columns.map((column) => escapeCsvValue(column.header)).join(',');
  const rowLines = rows.map((row) => {
    return columns
      .map((column) => escapeCsvValue(column.value(row), column.numeric === true))
      .join(',');
  });

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

function readVersionDisplayName(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const primary = (value as { primary?: unknown }).primary;
  return typeof primary === 'string' && primary.trim().length > 0 ? primary.trim() : null;
}
