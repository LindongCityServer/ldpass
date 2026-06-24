import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { createClaimCode, hashClaimCode } from '../wallet/claim-code.js';
import type {
  AdjustProviderPassBalanceDto,
  ChangeProviderPassStatusDto,
  CreateProviderAddPassTokenBatchDto,
  CreateProviderAddPassTokenDto,
  ProviderAddPassTokenQueryDto,
  ProviderPassesQueryDto,
  ReissueProviderAddPassTokenDto,
  RevokeProviderAddPassTokenDto,
  UpdateProviderPassTicketDto,
} from './dto.js';

const decimalScale = 1_000_000n;
const ticketCheckInStatuses = ['not_checked_in', 'checked_in', 'voided'] as const;
const ticketChangeStatuses = ['none', 'rescheduled', 'cancelled'] as const;

export interface TicketInfo {
  eventName: string | null;
  venue: string | null;
  startsAt: string | null;
  seatLabel: string | null;
  checkInStatus: (typeof ticketCheckInStatuses)[number];
  changeStatus: (typeof ticketChangeStatuses)[number];
}

@Injectable()
export class IssuingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listIssuableTemplates(providerAccount: AuthenticatedProviderAccount) {
    const templates = await this.prisma.passTemplate.findMany({
      where: {
        providerId: providerAccount.providerId,
        status: 'Active',
        activeVersionId: {
          not: null,
        },
      },
      include: {
        versions: {
          where: {
            status: 'Approved',
          },
          orderBy: {
            version: 'desc',
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    return {
      templates: templates
        .map((template) => {
          const activeVersion = template.versions.find((version) => version.id === template.activeVersionId) ?? template.versions[0] ?? null;
          if (!activeVersion) {
            return null;
          }

          return {
            id: template.id,
            displayName: readVersionDisplayName(activeVersion.fields) ?? template.displayName,
            category: template.category,
            benefitType: template.benefitType,
            activeVersionId: activeVersion.id,
            title: activeVersion.title,
            rules: activeVersion.rules,
            updatedAt: template.updatedAt.toISOString(),
          };
        })
        .filter((template): template is NonNullable<typeof template> => template !== null),
    };
  }

  async createAddPassToken(dto: CreateProviderAddPassTokenDto, providerAccount: AuthenticatedProviderAccount) {
    const now = new Date();
    const code = createClaimCode();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * (dto.expiresInDays ?? 30));
    const passExpiresAt = readPassExpiresAt(now, dto.passExpiresInDays);
    const template = await this.prisma.passTemplate.findFirst({
      where: {
        id: dto.templateId,
        providerId: providerAccount.providerId,
        status: 'Active',
        activeVersionId: {
          not: null,
        },
      },
      include: {
        provider: true,
        versions: {
          where: {
            status: 'Approved',
          },
          orderBy: {
            version: 'desc',
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('可发放的卡券模板不存在。');
    }

    const activeVersion = template.versions.find((version) => version.id === template.activeVersionId) ?? template.versions[0] ?? null;
    if (!activeVersion) {
      throw new BadRequestException('卡券模板没有已审批版本。');
    }

    const ticketInfo = this.buildTicketInfoFromIssueDto(dto, template.category);
    const requireServerVerifiedUser = this.readTemplateRequiresServerVerifiedUser(activeVersion.rules) || (dto.requireServerVerifiedUser ?? false);
    const result = await this.prisma.$transaction(async (transaction) => {
      const publicNumber = await this.createUniquePublicNumber(transaction, template.providerId);
      const pass = await transaction.pass.create({
        data: {
          providerId: template.providerId,
          templateId: template.id,
          templateVersionId: activeVersion.id,
          status: 'Issued',
          publicNumber,
          maskedNumber: `**** ${publicNumber.slice(-4)}`,
          balanceValue: dto.initialValue,
          expiresAt: passExpiresAt,
          metadata: this.buildPassMetadata({
            createdBy: 'provider_add_pass_token',
            createdByProviderAccountId: providerAccount.id,
            ticketInfo,
          }),
        },
      });

      const ledgerEntry = await transaction.ledgerEntry.create({
        data: {
          passId: pass.id,
          userId: null,
          providerId: template.providerId,
          benefitType: template.benefitType,
          reason: 'issue',
          beforeValue: '0',
          changeValue: dto.initialValue,
          afterValue: dto.initialValue,
          idempotencyKey: `provider-pass-issued:${pass.id}`,
          referenceType: 'AddPassToken',
          note: '发卡方生成领取码时发放初始权益。',
          createdByType: 'provider',
          createdById: providerAccount.id,
        },
      });

      const addToken = await transaction.addPassToken.create({
        data: {
          tokenHash: hashClaimCode(code),
          claimCodeTail: readClaimCodeTail(code),
          providerId: template.providerId,
          templateId: template.id,
          passId: pass.id,
          requireServerVerifiedUser,
          expiresAt,
        },
      });

      return {
        addToken,
        ledgerEntry,
        pass,
      };
    });

    await this.eventBus.publish({
      type: 'PassIssued',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        providerId: template.providerId,
        templateId: template.id,
        passId: result.pass.id,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        passId: result.pass.id,
        providerId: template.providerId,
        balanceType: template.benefitType,
        beforeValue: '0',
        afterValue: dto.initialValue,
        changeValue: dto.initialValue,
        reason: 'issue',
        referenceId: result.ledgerEntry.id,
      },
    });

    return {
      claimCode: code,
      claimPath: `/add?token=${encodeURIComponent(code)}`,
      expiresAt: result.addToken.expiresAt.toISOString(),
      passExpiresAt: result.pass.expiresAt?.toISOString() ?? null,
      passId: result.pass.id,
      publicNumber: result.pass.publicNumber,
      maskedNumber: result.pass.maskedNumber,
      templateId: template.id,
    };
  }

  async createAddPassTokenBatch(dto: CreateProviderAddPassTokenBatchDto, providerAccount: AuthenticatedProviderAccount) {
    const now = new Date();
    const issueBatchId = randomUUID();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * (dto.expiresInDays ?? 30));
    const passExpiresAt = readPassExpiresAt(now, dto.passExpiresInDays);
    const template = await this.prisma.passTemplate.findFirst({
      where: {
        id: dto.templateId,
        providerId: providerAccount.providerId,
        status: 'Active',
        activeVersionId: {
          not: null,
        },
      },
      include: {
        provider: true,
        versions: {
          where: {
            status: 'Approved',
          },
          orderBy: {
            version: 'desc',
          },
        },
      },
    });

    if (!template) {
      throw new NotFoundException('可发放的卡券模板不存在。');
    }

    const activeVersion = template.versions.find((version) => version.id === template.activeVersionId) ?? template.versions[0] ?? null;
    if (!activeVersion) {
      throw new BadRequestException('卡券模板没有已审批版本。');
    }

    const ticketInfo = this.buildTicketInfoFromIssueDto(dto, template.category);
    const requireServerVerifiedUser = this.readTemplateRequiresServerVerifiedUser(activeVersion.rules) || (dto.requireServerVerifiedUser ?? false);
    const generatedItems = Array.from({ length: dto.count }, () => ({
      claimCode: createClaimCode(),
    }));

    const results = await this.prisma.$transaction(async (transaction) => {
      const createdResults = [];

      for (const item of generatedItems) {
        const publicNumber = await this.createUniquePublicNumber(transaction, template.providerId);
        const pass = await transaction.pass.create({
          data: {
            providerId: template.providerId,
            templateId: template.id,
            templateVersionId: activeVersion.id,
            status: 'Issued',
            publicNumber,
            maskedNumber: `**** ${publicNumber.slice(-4)}`,
            balanceValue: dto.initialValue,
            expiresAt: passExpiresAt,
            metadata: this.buildPassMetadata({
              createdBy: 'provider_add_pass_token_batch',
              createdByProviderAccountId: providerAccount.id,
              issueBatchId,
              ticketInfo,
            }),
          },
        });

        const ledgerEntry = await transaction.ledgerEntry.create({
          data: {
            passId: pass.id,
            userId: null,
            providerId: template.providerId,
            benefitType: template.benefitType,
            reason: 'issue',
            beforeValue: '0',
            changeValue: dto.initialValue,
            afterValue: dto.initialValue,
            idempotencyKey: `provider-pass-issued:${pass.id}`,
            referenceType: 'AddPassToken',
            note: '发卡方批量生成领取码时发放初始权益。',
            createdByType: 'provider',
            createdById: providerAccount.id,
          },
        });

        const addToken = await transaction.addPassToken.create({
        data: {
          tokenHash: hashClaimCode(item.claimCode),
          claimCodeTail: readClaimCodeTail(item.claimCode),
          providerId: template.providerId,
          templateId: template.id,
          passId: pass.id,
            requireServerVerifiedUser,
            expiresAt,
          },
        });

        createdResults.push({
          addToken,
          claimCode: item.claimCode,
          ledgerEntry,
          pass,
        });
      }

      return createdResults;
    });

    for (const result of results) {
      await this.eventBus.publish({
        type: 'PassIssued',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'provider',
        actorId: providerAccount.id,
        payload: {
          providerId: template.providerId,
          templateId: template.id,
          passId: result.pass.id,
          issueBatchId,
        },
      });

      await this.eventBus.publish({
        type: 'PassBalanceChanged',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'provider',
        actorId: providerAccount.id,
        payload: {
          passId: result.pass.id,
          providerId: template.providerId,
          balanceType: template.benefitType,
          beforeValue: '0',
          afterValue: dto.initialValue,
          changeValue: dto.initialValue,
          reason: 'issue',
          referenceId: result.ledgerEntry.id,
        },
      });
    }

    return {
      issueBatchId,
      total: results.length,
      tokens: results.map((result) => ({
        claimCode: result.claimCode,
        claimPath: `/add?token=${encodeURIComponent(result.claimCode)}`,
        expiresAt: result.addToken.expiresAt.toISOString(),
        passExpiresAt: result.pass.expiresAt?.toISOString() ?? null,
        passId: result.pass.id,
        publicNumber: result.pass.publicNumber,
        maskedNumber: result.pass.maskedNumber,
        templateId: template.id,
      })),
    };
  }

  async listAddPassTokens(query: ProviderAddPassTokenQueryDto, providerAccount: AuthenticatedProviderAccount) {
    await this.expireOutdatedAddPassTokens(providerAccount.providerId);

    const take = this.readTake(query.take);
    const keyword = query.keyword?.trim();
    const where: Prisma.AddPassTokenWhereInput = {
      providerId: providerAccount.providerId,
      ...(query.status ? { status: query.status } : {}),
      ...(keyword
        ? {
            OR: [
              {
                claimCodeTail: {
                  contains: keyword,
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
                claimedByUser: {
                  is: {
                    username: {
                      contains: keyword,
                    },
                  },
                },
              },
              {
                claimedByUser: {
                  is: {
                    email: {
                      contains: keyword,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const tokens = await this.prisma.addPassToken.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take,
      include: this.addPassTokenInclude(),
    });

    const passNumberLookup = await this.readPassNumberLookup(tokens.map((token) => token.passId));

    return {
      tokens: tokens.map((token) => this.toProviderAddPassToken(token, passNumberLookup.get(token.passId ?? ''))),
    };
  }

  async revokeAddPassToken(
    tokenId: string,
    dto: RevokeProviderAddPassTokenDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedAddPassTokens(providerAccount.providerId);

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('撤销原因不能为空。');
    }

    const token = await this.prisma.addPassToken.findFirst({
      where: {
        id: tokenId,
        providerId: providerAccount.providerId,
      },
      include: this.addPassTokenInclude(),
    });

    if (!token) {
      throw new NotFoundException('领取码不存在或不属于当前发卡方。');
    }

    if (token.status !== 'Active') {
      throw new BadRequestException('只有未领取且未过期的领取码可以撤销。');
    }

    const revokedToken = await this.prisma.addPassToken.update({
      where: {
        id: token.id,
      },
      data: {
        status: 'Revoked',
      },
      include: this.addPassTokenInclude(),
    });

    await this.eventBus.publish({
      type: 'AddPassTokenRevoked',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        addPassTokenId: revokedToken.id,
        providerId: revokedToken.providerId,
        ...(revokedToken.passId ? { passId: revokedToken.passId } : {}),
        revokedByType: 'provider',
        revokedById: providerAccount.id,
        reason,
      },
    });

    const passNumberLookup = await this.readPassNumberLookup([revokedToken.passId]);

    return {
      token: this.toProviderAddPassToken(revokedToken, passNumberLookup.get(revokedToken.passId ?? '')),
    };
  }

  async reissueAddPassToken(
    tokenId: string,
    dto: ReissueProviderAddPassTokenDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedAddPassTokens(providerAccount.providerId);

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('重发原因不能为空。');
    }

    const now = new Date();
    const code = createClaimCode();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * (dto.expiresInDays ?? 30));

    const result = await this.prisma.$transaction(async (transaction) => {
      const token = await transaction.addPassToken.findFirst({
        where: {
          id: tokenId,
          providerId: providerAccount.providerId,
        },
        include: this.addPassTokenInclude(),
      });

      if (!token) {
        throw new NotFoundException('领取码不存在或不属于当前发卡方。');
      }

      if (token.status === 'Claimed' || token.claimedAt || token.claimedByUser) {
        throw new BadRequestException('已领取的领取码不能作废并重发。');
      }

      if (!token.passId) {
        throw new BadRequestException('该领取码没有关联卡券，不能重发。');
      }

      const pass = await transaction.pass.findFirst({
        where: {
          id: token.passId,
          providerId: providerAccount.providerId,
        },
        select: {
          id: true,
          providerId: true,
          templateId: true,
          status: true,
          userId: true,
          expiresAt: true,
          publicNumber: true,
          maskedNumber: true,
        },
      });

      if (!pass || pass.providerId !== token.providerId || pass.templateId !== token.templateId) {
        throw new BadRequestException('关联卡券不存在或与领取码不匹配。');
      }

      if (pass.userId || pass.status !== 'Issued') {
        throw new BadRequestException('关联卡券已被领取或状态不可重发。');
      }

      const activeSibling = await transaction.addPassToken.findFirst({
        where: {
          passId: token.passId,
          status: 'Active',
          id: {
            not: token.id,
          },
        },
        select: {
          id: true,
        },
      });

      if (activeSibling) {
        throw new BadRequestException('这张卡券已有新的可领取码，请从最新领取码记录继续处理。');
      }

      const revokedToken = await transaction.addPassToken.update({
        where: {
          id: token.id,
        },
        data: {
          status: 'Revoked',
        },
        include: this.addPassTokenInclude(),
      });

      const newToken = await transaction.addPassToken.create({
        data: {
          tokenHash: hashClaimCode(code),
          claimCodeTail: readClaimCodeTail(code),
          providerId: token.providerId,
          templateId: token.templateId,
          passId: token.passId,
          requireServerVerifiedUser: token.requireServerVerifiedUser,
          expiresAt,
        },
        include: this.addPassTokenInclude(),
      });

      return {
        newToken,
        oldTokenStatus: token.status,
        passId: token.passId,
        passExpiresAt: pass.expiresAt,
        publicNumber: pass.publicNumber,
        maskedNumber: pass.maskedNumber,
        revokedToken,
        templateId: token.templateId,
      };
    });

    if (result.oldTokenStatus !== 'Revoked') {
      await this.eventBus.publish({
        type: 'AddPassTokenRevoked',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'provider',
        actorId: providerAccount.id,
        payload: {
          addPassTokenId: result.revokedToken.id,
          providerId: result.revokedToken.providerId,
          ...(result.revokedToken.passId ? { passId: result.revokedToken.passId } : {}),
          revokedByType: 'provider',
          revokedById: providerAccount.id,
          reason,
        },
      });
    }

    await this.eventBus.publish({
      type: 'AddPassTokenReissued',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        oldAddPassTokenId: result.revokedToken.id,
        newAddPassTokenId: result.newToken.id,
        providerId: result.newToken.providerId,
        passId: result.passId,
        reissuedByType: 'provider',
        reissuedById: providerAccount.id,
        reason,
      },
    });

    return {
      claimCode: code,
      claimPath: `/add?token=${encodeURIComponent(code)}`,
      expiresAt: result.newToken.expiresAt.toISOString(),
      passExpiresAt: result.passExpiresAt?.toISOString() ?? null,
      passId: result.passId,
      publicNumber: result.publicNumber,
      maskedNumber: result.maskedNumber,
      templateId: result.templateId,
      token: this.toProviderAddPassToken(result.newToken, {
        publicNumber: result.publicNumber,
        maskedNumber: result.maskedNumber,
      }),
      revokedToken: this.toProviderAddPassToken(result.revokedToken, {
        publicNumber: result.publicNumber,
        maskedNumber: result.maskedNumber,
      }),
    };
  }

  async listProviderPasses(query: ProviderPassesQueryDto, providerAccount: AuthenticatedProviderAccount) {
    const take = this.readTake(query.take);
    const where = this.buildProviderPassWhere(query, providerAccount.providerId);

    const passes = await this.prisma.pass.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
      take,
      include: {
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
      passes: passes.map((pass) => this.toProviderPass(pass)),
    };
  }

  async listProviderTicketUpdateRequests(providerAccount: AuthenticatedProviderAccount) {
    const requests = await this.prisma.passTicketUpdateRequest.findMany({
      where: {
        providerId: providerAccount.providerId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 30,
      include: {
        pass: {
          include: {
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
      ticketUpdateRequests: requests.map((request) => this.toProviderTicketUpdateRequest(request)),
    };
  }

  async exportProviderPassesCsv(query: ProviderPassesQueryDto, providerAccount: AuthenticatedProviderAccount): Promise<string> {
    const passes = await this.prisma.pass.findMany({
      where: this.buildProviderPassWhere(query, providerAccount.providerId),
      orderBy: {
        updatedAt: 'desc',
      },
      take: this.readExportTake(query.take),
      include: {
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
      { header: '公开编号', value: (pass) => pass.publicNumber },
      { header: '显示编号', value: (pass) => pass.maskedNumber },
      { header: '卡券名称', value: (pass) => readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName },
      { header: '模板标题', value: (pass) => pass.templateVersion.title },
      { header: '分类', value: (pass) => pass.template.category },
      { header: '权益类型', value: (pass) => pass.template.benefitType },
      { header: '状态', value: (pass) => pass.status },
      { header: '当前值', value: (pass) => pass.balanceValue.toString(), numeric: true },
      { header: '冻结值', value: (pass) => pass.frozenValue.toString(), numeric: true },
      { header: '透支额度', value: (pass) => pass.overdraftLimit.toString(), numeric: true },
      { header: '票券活动', value: (pass) => readTicketInfo(pass.metadata)?.eventName },
      { header: '票券场地', value: (pass) => readTicketInfo(pass.metadata)?.venue },
      { header: '票券场次时间', value: (pass) => readTicketInfo(pass.metadata)?.startsAt },
      { header: '票券座位', value: (pass) => readTicketInfo(pass.metadata)?.seatLabel },
      { header: '检票状态', value: (pass) => readTicketInfo(pass.metadata)?.checkInStatus },
      { header: '改签取消状态', value: (pass) => readTicketInfo(pass.metadata)?.changeStatus },
      { header: '持有人用户名', value: (pass) => pass.user?.username },
      { header: '持有人邮箱', value: (pass) => pass.user?.email },
      { header: '领取时间', value: (pass) => formatCsvDate(pass.addedAt) },
      { header: '创建时间', value: (pass) => formatCsvDate(pass.createdAt) },
      { header: '更新时间', value: (pass) => formatCsvDate(pass.updatedAt) },
    ];

    return createCsv(columns, passes);
  }

  async exportProviderLedgerCsv(query: ProviderPassesQueryDto, providerAccount: AuthenticatedProviderAccount): Promise<string> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: this.buildProviderLedgerWhere(query, providerAccount.providerId),
      orderBy: {
        createdAt: 'desc',
      },
      take: this.readExportTake(query.take),
      include: {
        pass: {
          include: {
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
      { header: '公开编号', value: (entry) => entry.pass.publicNumber },
      { header: '显示编号', value: (entry) => entry.pass.maskedNumber },
      { header: '卡券名称', value: (entry) => readVersionDisplayName(entry.pass.templateVersion.fields) ?? entry.pass.template.displayName },
      { header: '模板标题', value: (entry) => entry.pass.templateVersion.title },
      { header: '权益类型', value: (entry) => entry.benefitType },
      { header: '原因', value: (entry) => entry.reason },
      { header: '变化前', value: (entry) => entry.beforeValue.toString(), numeric: true },
      { header: '变化量', value: (entry) => entry.changeValue.toString(), numeric: true },
      { header: '变化后', value: (entry) => entry.afterValue.toString(), numeric: true },
      { header: '备注', value: (entry) => entry.note },
      { header: '持有人用户名', value: (entry) => entry.user?.username ?? entry.pass.user?.username },
      { header: '持有人邮箱', value: (entry) => entry.user?.email ?? entry.pass.user?.email },
      { header: '操作者类型', value: (entry) => entry.createdByType },
      { header: '操作者ID', value: (entry) => entry.createdById },
      { header: '引用类型', value: (entry) => entry.referenceType },
      { header: '引用ID', value: (entry) => entry.referenceId },
      { header: '创建时间', value: (entry) => formatCsvDate(entry.createdAt) },
    ];

    return createCsv(columns, entries);
  }

  async adjustPassBalance(passId: string, dto: AdjustProviderPassBalanceDto, providerAccount: AuthenticatedProviderAccount) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        providerId: providerAccount.providerId,
      },
      include: {
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
      throw new NotFoundException('卡券不存在或不属于当前发卡方。');
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
    const idempotencyKey = dto.idempotencyKey?.trim() || `provider-adjustment:${adjustmentId}`;
    const now = new Date();

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        const updatedPass = await transaction.pass.update({
          where: {
            id: pass.id,
          },
          data: {
            balanceValue: afterValue,
          },
          include: {
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

        const ledgerEntry = await transaction.ledgerEntry.create({
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
            referenceType: 'ProviderBalanceAdjustment',
            referenceId: adjustmentId,
            note: dto.note?.trim() || dto.reason.trim(),
            createdByType: 'provider',
            createdById: providerAccount.id,
          },
        });

        return {
          ledgerEntry,
          pass: updatedPass,
        };
      });

      await this.eventBus.publish({
        type: 'PassBalanceChanged',
        eventId: randomUUID(),
        occurredAt: now.toISOString(),
        actorType: 'provider',
        actorId: providerAccount.id,
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
        pass: this.toProviderPass(result.pass),
      };
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('这次调整已经提交过，请刷新卡券后再确认结果。');
      }

      throw error;
    }
  }

  async freezePass(passId: string, dto: ChangeProviderPassStatusDto, providerAccount: AuthenticatedProviderAccount) {
    return this.changePassStatus(passId, 'Frozen', dto, providerAccount);
  }

  async unfreezePass(passId: string, dto: ChangeProviderPassStatusDto, providerAccount: AuthenticatedProviderAccount) {
    return this.changePassStatus(passId, 'Active', dto, providerAccount);
  }

  async archivePass(passId: string, dto: ChangeProviderPassStatusDto, providerAccount: AuthenticatedProviderAccount) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        providerId: providerAccount.providerId,
      },
      include: {
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
      throw new NotFoundException('卡券不存在或不属于当前发卡方。');
    }

    if (pass.status === 'Archived' || pass.archivedAt) {
      throw new BadRequestException('卡券已经归档。');
    }

    const reason = dto.reason.trim();
    const now = new Date();
    const result = await this.prisma.$transaction(async (transaction) => {
      const updatedPass = await transaction.pass.update({
        where: {
          id: pass.id,
        },
        data: {
          status: 'Archived',
          archivedAt: now,
        },
        include: {
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

      const revokedTokens = await transaction.addPassToken.updateMany({
        where: {
          passId: pass.id,
          status: 'Active',
        },
        data: {
          status: 'Revoked',
        },
      });

      return {
        pass: updatedPass,
        revokedTokenCount: revokedTokens.count,
      };
    });

    await this.eventBus.publish({
      type: 'PassDeleted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        passId: pass.id,
        userId: pass.userId ?? null,
        reason,
      },
    });

    return {
      pass: this.toProviderPass(result.pass),
      revokedAddPassTokens: result.revokedTokenCount,
    };
  }

  async updatePassTicket(passId: string, dto: UpdateProviderPassTicketDto, providerAccount: AuthenticatedProviderAccount) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        providerId: providerAccount.providerId,
      },
      include: {
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
      throw new NotFoundException('卡券不存在或不属于当前发卡方。');
    }

    if (pass.template.category !== 'ticket') {
      throw new BadRequestException('只有票券分类可以更新票券字段。');
    }

    const nextTicketInfo = this.buildTicketInfoFromUpdateDto(dto, readTicketInfo(pass.metadata));
    const pendingRequest = await this.prisma.passTicketUpdateRequest.findFirst({
      where: {
        passId: pass.id,
        status: 'PendingReview',
      },
      select: {
        id: true,
      },
    });

    if (pendingRequest) {
      throw new BadRequestException('这张票券已有待审核的字段变更，请等待管理员处理后再提交。');
    }

    const request = await this.prisma.passTicketUpdateRequest.create({
      data: {
        passId: pass.id,
        providerId: pass.providerId,
        requestedById: providerAccount.id,
        currentTicketInfo: readTicketInfo(pass.metadata)
          ? ticketInfoToJson(readTicketInfo(pass.metadata) as TicketInfo)
          : Prisma.JsonNull,
        proposedTicketInfo: ticketInfoToJson(nextTicketInfo),
        reason: dto.reason?.trim() || null,
      },
      include: {
        pass: {
          include: {
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
      type: 'PassTicketUpdateSubmitted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        ticketUpdateRequestId: request.id,
        passId: pass.id,
        providerId: pass.providerId,
        requestedBy: providerAccount.id,
      },
    });

    return {
      pass: this.toProviderPass(pass),
      ticketUpdateRequest: this.toProviderTicketUpdateRequest(request),
    };
  }

  private async changePassStatus(
    passId: string,
    nextStatus: 'Frozen' | 'Active',
    dto: ChangeProviderPassStatusDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        providerId: providerAccount.providerId,
      },
      include: {
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
      throw new NotFoundException('卡券不存在或不属于当前发卡方。');
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
    const now = new Date();
    const updatedPass = await this.prisma.pass.update({
      where: {
        id: pass.id,
      },
      data: {
        status: nextStatus,
      },
      include: {
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
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        passId: pass.id,
        reason,
      },
    });

    return {
      pass: this.toProviderPass(updatedPass),
    };
  }

  private readTemplateRequiresServerVerifiedUser(rules: Prisma.JsonValue): boolean {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      return false;
    }

    return (rules as { requireServerVerifiedUser?: unknown }).requireServerVerifiedUser === true;
  }

  private createPublicNumber(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }

  private async createUniquePublicNumber(transaction: Prisma.TransactionClient, providerId: string): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const publicNumber = this.createPublicNumber();
      const existingPass = await transaction.pass.findFirst({
        where: {
          providerId,
          publicNumber,
        },
        select: {
          id: true,
        },
      });

      if (!existingPass) {
        return publicNumber;
      }
    }

    throw new ConflictException('生成卡号失败，请稍后重试。');
  }

  private buildProviderPassWhere(query: ProviderPassesQueryDto, providerId: string): Prisma.PassWhereInput {
    const keyword = query.keyword?.trim();
    return {
      providerId,
      ...(keyword
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
        : {}),
    };
  }

  private buildProviderLedgerWhere(query: ProviderPassesQueryDto, providerId: string): Prisma.LedgerEntryWhereInput {
    const keyword = query.keyword?.trim();
    return {
      providerId,
      ...(keyword
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
        : {}),
    };
  }

  private async expireOutdatedAddPassTokens(providerId: string): Promise<void> {
    await this.prisma.addPassToken.updateMany({
      where: {
        providerId,
        status: 'Active',
        expiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: 'Expired',
      },
    });
  }

  private addPassTokenInclude() {
    return {
      template: {
        include: {
          provider: true,
        },
      },
      claimedByUser: {
        select: {
          id: true,
          username: true,
          email: true,
        },
      },
    } as const;
  }

  private readTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '50', 10);

    if (!Number.isFinite(parsedValue)) {
      return 50;
    }

    return Math.min(Math.max(parsedValue, 1), 100);
  }

  private readExportTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '500', 10);

    if (!Number.isFinite(parsedValue)) {
      return 500;
    }

    return Math.min(Math.max(parsedValue, 1), 500);
  }

  private async readPassNumberLookup(passIds: Array<string | null>): Promise<Map<string, PassNumberSummary>> {
    const uniquePassIds = [...new Set(passIds.filter((passId): passId is string => Boolean(passId)))];
    if (uniquePassIds.length === 0) {
      return new Map();
    }

    const passes = await this.prisma.pass.findMany({
      where: {
        id: {
          in: uniquePassIds,
        },
      },
      select: {
        id: true,
        publicNumber: true,
        maskedNumber: true,
      },
    });

    return new Map(passes.map((pass) => [pass.id, { publicNumber: pass.publicNumber, maskedNumber: pass.maskedNumber }]));
  }

  private toProviderAddPassToken(token: {
    id: string;
    claimCodeTail: string | null;
    providerId: string;
    passId: string | null;
    status: string;
    requireServerVerifiedUser: boolean;
    expiresAt: Date;
    claimedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    template: {
      id: string;
      displayName: string;
      category: string;
      benefitType: string;
      provider: {
        id: string;
        name: string;
      };
    };
    claimedByUser: {
      id: string;
      username: string;
      email: string;
    } | null;
  }, passNumber?: PassNumberSummary) {
    return {
      id: token.id,
      maskedClaimCode: token.claimCodeTail ? `**** ${token.claimCodeTail}` : null,
      claimCodeTail: token.claimCodeTail,
      providerId: token.providerId,
      providerName: token.template.provider.name,
      templateId: token.template.id,
      templateName: token.template.displayName,
      category: token.template.category,
      benefitType: token.template.benefitType,
      passId: token.passId,
      publicNumber: passNumber?.publicNumber ?? null,
      maskedNumber: passNumber?.maskedNumber ?? null,
      status: token.status,
      requireServerVerifiedUser: token.requireServerVerifiedUser,
      expiresAt: token.expiresAt.toISOString(),
      claimedAt: token.claimedAt?.toISOString() ?? null,
      claimedByUser: token.claimedByUser,
      createdAt: token.createdAt.toISOString(),
      updatedAt: token.updatedAt.toISOString(),
    };
  }

  private toProviderPass(pass: {
    id: string;
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
    metadata: Prisma.JsonValue | null;
    balanceValue: { toString(): string };
    frozenValue: { toString(): string };
    overdraftLimit: { toString(): string };
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: pass.id,
      displayName: readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName,
      title: pass.templateVersion.title,
      category: pass.template.category,
      benefitType: pass.template.benefitType,
      status: pass.status,
      publicNumber: pass.publicNumber,
      maskedNumber: pass.maskedNumber,
      ticketInfo: readTicketInfo(pass.metadata),
      balanceValue: pass.balanceValue.toString(),
      frozenValue: pass.frozenValue.toString(),
      overdraftLimit: pass.overdraftLimit.toString(),
      user: pass.user,
      createdAt: pass.createdAt.toISOString(),
      updatedAt: pass.updatedAt.toISOString(),
    };
  }

  private toProviderTicketUpdateRequest(request: {
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
    pass: {
      id: string;
      publicNumber: string | null;
      maskedNumber: string | null;
      template: {
        displayName: string;
        category: string;
        benefitType: string;
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
    };
  }) {
    return {
      id: request.id,
      passId: request.passId,
      providerId: request.providerId,
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

  private buildPassMetadata(input: {
    createdBy: string;
    createdByProviderAccountId: string;
    issueBatchId?: string;
    ticketInfo: TicketInfo | null;
  }): Prisma.InputJsonObject {
    return {
      createdBy: input.createdBy,
      createdByProviderAccountId: input.createdByProviderAccountId,
      ...(input.issueBatchId ? { issueBatchId: input.issueBatchId } : {}),
      ...(input.ticketInfo ? { ticketInfo: ticketInfoToJson(input.ticketInfo) } : {}),
    } as Prisma.InputJsonObject;
  }

  private mergePassMetadata(metadata: Prisma.JsonValue | null, ticketInfo: TicketInfo): Prisma.InputJsonObject {
    const baseMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

    return {
      ...baseMetadata,
      ticketInfo: ticketInfoToJson(ticketInfo),
    } as Prisma.InputJsonObject;
  }

  private buildTicketInfoFromIssueDto(dto: CreateProviderAddPassTokenDto, category: string): TicketInfo | null {
    if (category !== 'ticket') {
      return null;
    }

    return {
      eventName: readOptionalText(dto.ticketEventName),
      venue: readOptionalText(dto.ticketVenue),
      startsAt: readOptionalDateTime(dto.ticketStartsAt),
      seatLabel: readOptionalText(dto.ticketSeatLabel),
      checkInStatus: dto.ticketCheckInStatus ?? 'not_checked_in',
      changeStatus: dto.ticketChangeStatus ?? 'none',
    };
  }

  private buildTicketInfoFromUpdateDto(dto: UpdateProviderPassTicketDto, currentTicketInfo: TicketInfo | null): TicketInfo {
    return {
      eventName: dto.eventName === undefined ? currentTicketInfo?.eventName ?? null : readOptionalText(dto.eventName),
      venue: dto.venue === undefined ? currentTicketInfo?.venue ?? null : readOptionalText(dto.venue),
      startsAt: dto.startsAt === undefined ? currentTicketInfo?.startsAt ?? null : readOptionalDateTime(dto.startsAt),
      seatLabel: dto.seatLabel === undefined ? currentTicketInfo?.seatLabel ?? null : readOptionalText(dto.seatLabel),
      checkInStatus: dto.checkInStatus ?? currentTicketInfo?.checkInStatus ?? 'not_checked_in',
      changeStatus: dto.changeStatus ?? currentTicketInfo?.changeStatus ?? 'none',
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
  const fractionPart = String(absoluteValue % decimalScale).padStart(6, '0').replace(/0+$/, '');
  return `${sign}${wholePart.toString()}${fractionPart ? `.${fractionPart}` : ''}`;
}

function readTicketInfo(metadata: Prisma.JsonValue | null): TicketInfo | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const ticketInfo = (metadata as { ticketInfo?: unknown }).ticketInfo;
  if (!ticketInfo || typeof ticketInfo !== 'object' || Array.isArray(ticketInfo)) {
    return null;
  }

  const candidate = ticketInfo as Record<string, unknown>;

  return {
    eventName: typeof candidate.eventName === 'string' && candidate.eventName.trim() ? candidate.eventName : null,
    venue: typeof candidate.venue === 'string' && candidate.venue.trim() ? candidate.venue : null,
    startsAt: typeof candidate.startsAt === 'string' && candidate.startsAt.trim() ? candidate.startsAt : null,
    seatLabel: typeof candidate.seatLabel === 'string' && candidate.seatLabel.trim() ? candidate.seatLabel : null,
    checkInStatus: isTicketCheckInStatus(candidate.checkInStatus) ? candidate.checkInStatus : 'not_checked_in',
    changeStatus: isTicketChangeStatus(candidate.changeStatus) ? candidate.changeStatus : 'none',
  };
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

function readOptionalText(value: string | undefined): string | null {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : null;
}

function readOptionalDateTime(value: string | undefined): string | null {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    return null;
  }

  const date = new Date(trimmedValue);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('票券场次时间格式不正确。');
  }

  return date.toISOString();
}

function isTicketCheckInStatus(value: unknown): value is TicketInfo['checkInStatus'] {
  return ticketCheckInStatuses.includes(value as TicketInfo['checkInStatus']);
}

function isTicketChangeStatus(value: unknown): value is TicketInfo['changeStatus'] {
  return ticketChangeStatuses.includes(value as TicketInfo['changeStatus']);
}

type CsvValue = string | number | boolean | null | undefined;

interface PassNumberSummary {
  publicNumber: string | null;
  maskedNumber: string | null;
}

interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => CsvValue;
  numeric?: boolean;
}

function createCsv<TRow>(columns: Array<CsvColumn<TRow>>, rows: TRow[]): string {
  const headerLine = columns.map((column) => escapeCsvValue(column.header)).join(',');
  const rowLines = rows.map((row) => {
    return columns.map((column) => escapeCsvValue(column.value(row), column.numeric === true)).join(',');
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

function readClaimCodeTail(code: string): string {
  return code.slice(-4);
}

function readPassExpiresAt(now: Date, passExpiresInDays?: number): Date | null {
  return passExpiresInDays ? new Date(now.getTime() + 1000 * 60 * 60 * 24 * passExpiresInDays) : null;
}

function readVersionDisplayName(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const primary = (value as { primary?: unknown }).primary;
  return typeof primary === 'string' && primary.trim().length > 0 ? primary.trim() : null;
}
