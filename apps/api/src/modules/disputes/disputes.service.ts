import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { CreateWalletDisputeDto, DisputesQueryDto, UpdateDisputeStatusDto } from './dto.js';

const allowedSubjectTypes = new Set([
  'pass',
  'ledger_entry',
  'redemption_request',
  'admin_adjustment',
  'pass_top_up',
]);

@Injectable()
export class DisputesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async createWalletDispute(dto: CreateWalletDisputeDto, user: AuthenticatedUser) {
    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('请输入争议原因。');
    }

    const pass = await this.prisma.pass.findFirst({
      where: {
        id: dto.passId,
        userId: user.id,
        archivedAt: null,
      },
      include: this.disputePassInclude(),
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在、已归档或不属于当前用户。');
    }

    const subjectType = dto.subjectType?.trim() || (dto.ledgerEntryId ? 'ledger_entry' : 'pass');
    if (!allowedSubjectTypes.has(subjectType)) {
      throw new BadRequestException('不支持的争议对象类型。');
    }

    let subjectId = dto.subjectId?.trim() || dto.ledgerEntryId || (subjectType === 'pass' ? pass.id : '');
    if (!subjectId) {
      throw new BadRequestException('争议对象不能为空。');
    }

    let ledgerEntryId = dto.ledgerEntryId ?? null;

    if (dto.ledgerEntryId || subjectType === 'ledger_entry') {
      const targetLedgerEntryId = dto.ledgerEntryId ?? subjectId;
      const ledgerEntry = await this.prisma.ledgerEntry.findFirst({
        where: {
          id: targetLedgerEntryId,
          passId: pass.id,
        },
        select: {
          id: true,
        },
      });

      if (!ledgerEntry) {
        throw new BadRequestException('关联流水不存在或不属于这张卡券。');
      }

      ledgerEntryId = ledgerEntry.id;
      if (subjectType === 'ledger_entry') {
        subjectId = ledgerEntry.id;
      }
    }

    if (subjectType === 'pass_top_up') {
      const topUpRequest = await this.prisma.passTopUpRequest.findFirst({
        where: {
          id: subjectId,
          userId: user.id,
          OR: [{ sourcePassId: pass.id }, { targetPassId: pass.id }],
        },
        select: {
          id: true,
        },
      });

      if (!topUpRequest) {
        throw new BadRequestException('额度补充请求不存在或不属于当前卡券。');
      }
    }

    if (subjectType === 'redemption_request') {
      const redemptionRequest = await this.prisma.redemptionRequest.findFirst({
        where: {
          id: subjectId,
          passId: pass.id,
          userId: user.id,
        },
        select: {
          id: true,
        },
      });

      if (!redemptionRequest) {
        throw new BadRequestException('核销请求不存在或不属于当前卡券。');
      }
    }

    if (subjectType === 'admin_adjustment') {
      const adjustmentEntry = await this.prisma.ledgerEntry.findFirst({
        where: {
          passId: pass.id,
          referenceType: 'AdminBalanceAdjustment',
          referenceId: subjectId,
        },
        select: {
          id: true,
        },
      });

      if (!adjustmentEntry) {
        throw new BadRequestException('管理员调整记录不存在或不属于当前卡券。');
      }
    }

    const dispute = await this.prisma.dispute.create({
      data: {
        userId: user.id,
        passId: pass.id,
        ledgerEntryId,
        subjectType,
        subjectId,
        reason,
      },
      include: this.disputeInclude(),
    });

    await this.eventBus.publish({
      type: 'DisputeStatusChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        disputeId: dispute.id,
        toStatus: dispute.status,
        reason,
      },
    });

    return {
      dispute: this.toDispute(dispute),
    };
  }

  async listWalletDisputes(query: DisputesQueryDto, user: AuthenticatedUser) {
    const disputes = await this.prisma.dispute.findMany({
      where: {
        userId: user.id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.passId ? { passId: query.passId } : {}),
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: this.readTake(query.take),
      include: this.disputeInclude(),
    });

    return {
      disputes: disputes.map((dispute) => this.toDispute(dispute)),
    };
  }

  async listProviderDisputes(query: DisputesQueryDto, providerAccount: AuthenticatedProviderAccount) {
    const disputes = await this.prisma.dispute.findMany({
      where: {
        ...this.buildKeywordWhere(query.keyword),
        ...(query.status ? { status: query.status } : {}),
        ...(query.passId ? { passId: query.passId } : {}),
        pass: {
          is: {
            providerId: providerAccount.providerId,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: this.readTake(query.take),
      include: this.disputeInclude(),
    });

    return {
      disputes: disputes.map((dispute) => this.toDispute(dispute)),
    };
  }

  async listAdminDisputes(query: DisputesQueryDto) {
    const disputes = await this.prisma.dispute.findMany({
      where: {
        ...this.buildKeywordWhere(query.keyword),
        ...(query.status ? { status: query.status } : {}),
        ...(query.passId ? { passId: query.passId } : {}),
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: this.readTake(query.take),
      include: this.disputeInclude(),
    });

    return {
      disputes: disputes.map((dispute) => this.toDispute(dispute)),
    };
  }

  async updateDisputeStatus(disputeId: string, dto: UpdateDisputeStatusDto, admin: AuthenticatedUser) {
    const dispute = await this.prisma.dispute.findUnique({
      where: {
        id: disputeId,
      },
      include: this.disputeInclude(),
    });

    if (!dispute) {
      throw new NotFoundException('争议记录不存在。');
    }

    if (dispute.status === dto.status) {
      throw new BadRequestException('争议已经处于该状态。');
    }

    const resolutionNote = dto.resolutionNote?.trim();
    if (this.requiresResolutionNote(dto.status) && !resolutionNote) {
      throw new BadRequestException('请填写处理备注，说明本次争议处理结论。');
    }

    if (dto.status === 'Reversed' && !dto.reversalConfirmed) {
      throw new BadRequestException('只有完成实际冲正后才能把争议标记为已反转。');
    }

    const nextDispute = await this.prisma.dispute.update({
      where: {
        id: dispute.id,
      },
      data: {
        status: dto.status,
        resolutionNote: resolutionNote || dispute.resolutionNote,
      },
      include: this.disputeInclude(),
    });

    await this.eventBus.publish({
      type: 'DisputeStatusChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        disputeId: dispute.id,
        fromStatus: dispute.status,
        toStatus: nextDispute.status,
        ...(resolutionNote ? { reason: resolutionNote } : {}),
      },
    });

    return {
      dispute: this.toDispute(nextDispute),
    };
  }

  private buildKeywordWhere(keyword: string | undefined): Prisma.DisputeWhereInput {
    const trimmedKeyword = keyword?.trim();

    if (!trimmedKeyword) {
      return {};
    }

    return {
      OR: [
        {
          reason: {
            contains: trimmedKeyword,
          },
        },
        {
          resolutionNote: {
            contains: trimmedKeyword,
          },
        },
        {
          subjectId: {
            contains: trimmedKeyword,
          },
        },
        {
          pass: {
            is: {
              publicNumber: {
                contains: trimmedKeyword,
              },
            },
          },
        },
        {
          pass: {
            is: {
              maskedNumber: {
                contains: trimmedKeyword,
              },
            },
          },
        },
        {
          pass: {
            is: {
              provider: {
                is: {
                  name: {
                    contains: trimmedKeyword,
                  },
                },
              },
            },
          },
        },
        {
          user: {
            is: {
              username: {
                contains: trimmedKeyword,
              },
            },
          },
        },
        {
          user: {
            is: {
              email: {
                contains: trimmedKeyword,
              },
            },
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

  private requiresResolutionNote(status: UpdateDisputeStatusDto['status']): boolean {
    return ['NeedMoreInfo', 'Approved', 'Rejected', 'Reversed', 'Closed'].includes(status);
  }

  private disputePassInclude() {
    return {
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
    } satisfies Prisma.PassInclude;
  }

  private disputeInclude() {
    return {
      user: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
      pass: {
        include: this.disputePassInclude(),
      },
    } satisfies Prisma.DisputeInclude;
  }

  private toDispute(dispute: DisputeWithRelations) {
    return {
      id: dispute.id,
      status: dispute.status,
      subjectType: dispute.subjectType,
      subjectId: dispute.subjectId,
      reason: dispute.reason,
      resolutionNote: dispute.resolutionNote,
      ledgerEntryId: dispute.ledgerEntryId,
      createdAt: dispute.createdAt.toISOString(),
      updatedAt: dispute.updatedAt.toISOString(),
      user: dispute.user
        ? {
            id: dispute.user.id,
            username: dispute.user.username,
            email: dispute.user.email,
          }
        : null,
      pass: dispute.pass
        ? {
            id: dispute.pass.id,
            providerId: dispute.pass.providerId,
            providerName: dispute.pass.provider.name,
            displayName: dispute.pass.template.displayName,
            title: dispute.pass.templateVersion.title,
            category: dispute.pass.template.category,
            benefitType: dispute.pass.template.benefitType,
            status: dispute.pass.status,
            publicNumber: dispute.pass.publicNumber,
            maskedNumber: dispute.pass.maskedNumber,
            balanceValue: dispute.pass.balanceValue.toString(),
          }
        : null,
    };
  }
}

type DisputeWithRelations = Prisma.DisputeGetPayload<{
  include: ReturnType<DisputesService['disputeInclude']>;
}>;
