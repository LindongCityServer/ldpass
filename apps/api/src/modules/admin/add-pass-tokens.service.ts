import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { hashClaimCode } from '../wallet/claim-code.js';
import type {
  CreateAddPassTokenDto,
  ListAddPassTokensQueryDto,
  ReissueAddPassTokenDto,
  RevokeAddPassTokenDto,
} from './add-pass-token.dto.js';

interface PassNumberSummary {
  publicNumber: string | null;
  maskedNumber: string | null;
}

@Injectable()
export class AddPassTokensService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async createToken(dto: CreateAddPassTokenDto, admin: AuthenticatedUser) {
    const now = new Date();
    const code = this.createClaimCode();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * (dto.expiresInDays ?? 30));
    const passExpiresAt = readPassExpiresAt(now, dto.passExpiresInDays);
    const providerName = dto.providerName.trim();
    const providerSlug = dto.providerSlug.trim().toLowerCase();
    const displayName = dto.displayName.trim();
    const title = dto.title.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      const provider = await tx.provider.upsert({
        where: {
          slug: providerSlug,
        },
        create: {
          name: providerName,
          slug: providerSlug,
          status: 'Active',
          source: 'admin_created',
        },
        update: {
          name: providerName,
          status: 'Active',
        },
      });

      const template = await tx.passTemplate.create({
        data: {
          providerId: provider.id,
          category: dto.category,
          benefitType: dto.benefitType,
          displayName,
          status: 'Active',
        },
      });

      const templateVersion = await tx.passTemplateVersion.create({
        data: {
          templateId: template.id,
          version: 1,
          status: 'Approved',
          title,
          description: null,
          cardStyle: {
            tone: dto.category,
            variant: 'admin_minimal',
          },
          fields: {
            primary: displayName,
            secondary: title,
          },
          rules: {
            transferable: false,
            shareable: true,
            allowOverdraft: false,
            allowFrozenBalance: true,
            expirationReminderDefaultDays: 7,
          },
          reviewedById: admin.id,
          reviewedAt: now,
        },
      });

      await tx.passTemplate.update({
        where: {
          id: template.id,
        },
        data: {
          activeVersionId: templateVersion.id,
        },
      });

      const publicNumber = this.createPublicNumber();
      const pass = await tx.pass.create({
        data: {
          providerId: provider.id,
          templateId: template.id,
          templateVersionId: templateVersion.id,
          status: 'Issued',
          publicNumber,
          maskedNumber: `**** ${publicNumber.slice(-4)}`,
          balanceValue: dto.initialValue,
          expiresAt: passExpiresAt,
          metadata: {
            createdBy: 'admin_add_pass_token',
          },
        },
      });

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          passId: pass.id,
          userId: null,
          providerId: provider.id,
          benefitType: dto.benefitType,
          reason: 'issue',
          beforeValue: '0',
          changeValue: dto.initialValue,
          afterValue: dto.initialValue,
          idempotencyKey: `pass-issued:${pass.id}`,
          referenceType: 'AddPassToken',
          note: '管理员生成领取码时发放初始权益。',
          createdByType: 'admin',
          createdById: admin.id,
        },
      });

      const addToken = await tx.addPassToken.create({
        data: {
          tokenHash: hashClaimCode(code),
          claimCodeTail: readClaimCodeTail(code),
          providerId: provider.id,
          templateId: template.id,
          passId: pass.id,
          requireServerVerifiedUser: dto.requireServerVerifiedUser ?? false,
          expiresAt,
        },
      });

      return {
        addToken,
        ledgerEntry,
        pass,
        provider,
        template,
      };
    });

    await this.eventBus.publish({
      type: 'PassTemplateCreated',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: result.provider.id,
        templateId: result.template.id,
        category: dto.category,
        benefitType: dto.benefitType,
        version: 1,
      },
    });

    await this.eventBus.publish({
      type: 'PassTemplateApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: result.provider.id,
        templateId: result.template.id,
        approvedBy: admin.id,
        version: 1,
      },
    });

    await this.eventBus.publish({
      type: 'PassIssued',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        providerId: result.provider.id,
        templateId: result.template.id,
        passId: result.pass.id,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        passId: result.pass.id,
        providerId: result.provider.id,
        balanceType: dto.benefitType,
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
      templateId: result.template.id,
    };
  }

  async listTokens(query: ListAddPassTokensQueryDto) {
    await this.expireOutdatedTokens();

    const take = readTake(query.take, 50);
    const keyword = query.keyword?.trim();
    const where = {
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
                template: {
                  provider: {
                    name: {
                      contains: keyword,
                    },
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
      include: this.tokenInclude(),
    });

    const passNumberLookup = await this.readPassNumberLookup(tokens.map((token) => token.passId));

    return {
      tokens: tokens.map((token) => this.toAddPassTokenView(token, passNumberLookup.get(token.passId ?? ''))),
    };
  }

  async revokeToken(tokenId: string, dto: RevokeAddPassTokenDto, admin: AuthenticatedUser) {
    await this.expireOutdatedTokens();

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('撤销原因不能为空。');
    }

    const token = await this.prisma.addPassToken.findUnique({
      where: {
        id: tokenId,
      },
      include: this.tokenInclude(),
    });

    if (!token) {
      throw new NotFoundException('领取码不存在。');
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
      include: this.tokenInclude(),
    });

    await this.eventBus.publish({
      type: 'AddPassTokenRevoked',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        addPassTokenId: revokedToken.id,
        providerId: revokedToken.providerId,
        ...(revokedToken.passId ? { passId: revokedToken.passId } : {}),
        revokedByType: 'admin',
        revokedById: admin.id,
        reason,
      },
    });

    const passNumberLookup = await this.readPassNumberLookup([revokedToken.passId]);

    return {
      token: this.toAddPassTokenView(revokedToken, passNumberLookup.get(revokedToken.passId ?? '')),
    };
  }

  async reissueToken(tokenId: string, dto: ReissueAddPassTokenDto, admin: AuthenticatedUser) {
    await this.expireOutdatedTokens();

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('重发原因不能为空。');
    }

    const now = new Date();
    const code = this.createClaimCode();
    const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * (dto.expiresInDays ?? 30));

    const result = await this.prisma.$transaction(async (tx) => {
      const token = await tx.addPassToken.findUnique({
        where: {
          id: tokenId,
        },
        include: this.tokenInclude(),
      });

      if (!token) {
        throw new NotFoundException('领取码不存在。');
      }

      if (token.status === 'Claimed' || token.claimedAt || token.claimedByUser) {
        throw new BadRequestException('已领取的领取码不能作废并重发。');
      }

      if (!token.passId) {
        throw new BadRequestException('该领取码没有关联卡券，不能重发。');
      }

      const pass = await tx.pass.findUnique({
        where: {
          id: token.passId,
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

      const activeSibling = await tx.addPassToken.findFirst({
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

      const revokedToken = await tx.addPassToken.update({
        where: {
          id: token.id,
        },
        data: {
          status: 'Revoked',
        },
        include: this.tokenInclude(),
      });

      const newToken = await tx.addPassToken.create({
        data: {
          tokenHash: hashClaimCode(code),
          claimCodeTail: readClaimCodeTail(code),
          providerId: token.providerId,
          templateId: token.templateId,
          passId: token.passId,
          requireServerVerifiedUser: token.requireServerVerifiedUser,
          expiresAt,
        },
        include: this.tokenInclude(),
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
        actorType: 'admin',
        actorId: admin.id,
        payload: {
          addPassTokenId: result.revokedToken.id,
          providerId: result.revokedToken.providerId,
          ...(result.revokedToken.passId ? { passId: result.revokedToken.passId } : {}),
          revokedByType: 'admin',
          revokedById: admin.id,
          reason,
        },
      });
    }

    await this.eventBus.publish({
      type: 'AddPassTokenReissued',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        oldAddPassTokenId: result.revokedToken.id,
        newAddPassTokenId: result.newToken.id,
        providerId: result.newToken.providerId,
        passId: result.passId,
        reissuedByType: 'admin',
        reissuedById: admin.id,
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
      token: this.toAddPassTokenView(result.newToken, {
        publicNumber: result.publicNumber,
        maskedNumber: result.maskedNumber,
      }),
      revokedToken: this.toAddPassTokenView(result.revokedToken, {
        publicNumber: result.publicNumber,
        maskedNumber: result.maskedNumber,
      }),
    };
  }

  private async expireOutdatedTokens(): Promise<void> {
    await this.prisma.addPassToken.updateMany({
      where: {
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

  private tokenInclude() {
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

  private toAddPassTokenView(token: {
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

  private createClaimCode(): string {
    return `LD-${randomBytes(9).toString('base64url').toUpperCase()}`;
  }

  private createPublicNumber(): string {
    return randomBytes(8).toString('hex').toUpperCase();
  }
}

function readClaimCodeTail(code: string): string {
  return code.slice(-4);
}

function readTake(value: string | undefined, fallback: number): number {
  const parsedValue = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(Math.max(parsedValue, 1), 100);
}

function readPassExpiresAt(now: Date, passExpiresInDays?: number): Date | null {
  return passExpiresInDays ? new Date(now.getTime() + 1000 * 60 * 60 * 24 * passExpiresInDays) : null;
}
