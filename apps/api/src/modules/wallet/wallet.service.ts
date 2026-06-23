import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import type {
  BenefitType,
  BdslmPlayerMarker,
  LocationRangeRule,
  PassTopUpStatus,
  VerificationMethod,
} from '@ldpass/contracts';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { BdslmClientService } from '../bdslm/bdslm-client.service.js';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import {
  readBdslmChatContent,
  readBdslmChatMessageId,
  readBdslmChatSender,
} from '../../shared/bdslm/chat-message.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { hashClaimCode } from './claim-code.js';
import type {
  ConfirmTopUpWithServerDto,
  ResolvePassTransferDto,
  StartTopUpServerChallengeDto,
  TopUpWalletPassDto,
  TransferWalletPassDto,
} from './dto.js';

const walletTopUpServerConfirmationTtlMs = 10 * 60 * 1000;
const walletDirectTopUpReferencePrefix = 'wallet-direct-top-up:';

interface WalletTopUpInput {
  sourcePassId: string;
  value: string;
  note?: string;
}

interface WalletTopUpRequestSnapshot {
  id: string;
  userId: string;
  sourcePassId: string;
  targetPassId: string;
  sourceProviderId: string;
  providerId: string;
  benefitType: BenefitType;
  value: string;
  verificationMethod: VerificationMethod;
  status: PassTopUpStatus;
  expiresAt?: Date | null;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bdslmClient: BdslmClientService,
    private readonly secretHash: SecretHashService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listPasses(user: AuthenticatedUser) {
    const passes = await this.listWalletPassRecords(user.id);

    return {
      passes: passes.map((pass) => this.toWalletPassSummary(pass)),
    };
  }

  async getOfflineSnapshot(user: AuthenticatedUser) {
    const passes = await this.listWalletPassRecords(user.id);

    return {
      generatedAt: new Date().toISOString(),
      user: {
        id: user.id,
        username: user.username,
      },
      passes: passes.map((pass) => this.toWalletPassSummary(pass)),
    };
  }

  async getPassDetail(user: AuthenticatedUser, passId: string) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        userId: user.id,
        archivedAt: null,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在、已归档或不属于当前用户。');
    }

    return {
      pass: {
        id: pass.id,
        providerName: pass.provider.name,
        providerIntroductionUrl: pass.provider.introductionUrl,
        displayName:
          readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName,
        title: pass.templateVersion.title,
        hideTitle: readVersionHideTitle(pass.templateVersion.fields),
        allowTopUpIn: readAllowTopUpIn(pass.templateVersion.rules),
        allowTopUpOut: readAllowTopUpOut(pass.templateVersion.rules),
        description: pass.templateVersion.description,
        category: pass.template.category,
        benefitType: pass.template.benefitType,
        status: pass.status,
        publicNumber: pass.publicNumber,
        maskedNumber: pass.maskedNumber,
        balanceValue: pass.balanceValue.toString(),
        frozenValue: pass.frozenValue.toString(),
        overdraftLimit: pass.overdraftLimit.toString(),
        expiresAt: pass.expiresAt?.toISOString() ?? null,
        addedAt: pass.addedAt?.toISOString() ?? null,
        sortOrder: pass.sortOrder,
        updatedAt: pass.updatedAt.toISOString(),
        cardStyle: pass.templateVersion.cardStyle,
        fields: pass.templateVersion.fields,
        rules: pass.templateVersion.rules,
        backgroundImageUrl: pass.templateVersion.backgroundImageUrl,
        logoUrl: pass.templateVersion.logoUrl,
        ticketInfo: pass.template.category === 'ticket' ? readTicketInfo(pass.metadata) : null,
        locationVerification:
          pass.template.category === 'identity_key'
            ? {
                required: readLocationRules(pass.templateVersion.locationRules) !== null,
                rules: readLocationRules(pass.templateVersion.locationRules),
              }
            : null,
      },
    };
  }

  async listPassLedger(user: AuthenticatedUser, passId: string, query: { take?: string }) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        userId: user.id,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在、已归档或不属于当前用户。');
    }

    const ledgerEntries = await this.prisma.ledgerEntry.findMany({
      where: {
        passId: pass.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: readTake(query.take, 30, 100),
    });

    return {
      ledgerEntries: ledgerEntries.map((entry) => this.toWalletLedgerEntry(entry)),
    };
  }

  async listTopUpRequests(user: AuthenticatedUser, query: { passId?: string; take?: string }) {
    if (query.passId) {
      const pass = await this.prisma.pass.findFirst({
        where: {
          id: query.passId,
          userId: user.id,
          archivedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!pass) {
        throw new NotFoundException('卡券不存在、已归档或不属于当前用户。');
      }
    }

    const topUpRequests = await this.prisma.passTopUpRequest.findMany({
      where: {
        userId: user.id,
        ...(query.passId
          ? {
              OR: [{ sourcePassId: query.passId }, { targetPassId: query.passId }],
            }
          : {}),
      },
      include: {
        sourcePass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
          },
        },
        targetPass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: readTake(query.take, 10, 50),
    });

    return {
      topUpRequests: topUpRequests.map((request) => this.toTopUpHistoryItem(request)),
    };
  }

  async previewAddPassToken(claimCode: string) {
    const addToken = await this.prisma.addPassToken.findUnique({
      where: {
        tokenHash: hashClaimCode(claimCode),
      },
    });

    if (!addToken) {
      throw new NotFoundException('领取码不存在。');
    }

    if (addToken.status !== 'Active') {
      throw new BadRequestException('领取码已经被使用、过期或撤销。');
    }

    if (addToken.expiresAt <= new Date()) {
      throw new BadRequestException('领取码已过期。');
    }

    if (!addToken.passId) {
      throw new BadRequestException('领取码没有关联可领取的卡券。');
    }

    const pass = await this.prisma.pass.findUnique({
      where: {
        id: addToken.passId,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
      },
    });

    if (!pass || pass.archivedAt) {
      throw new NotFoundException('卡券不存在或已归档。');
    }

    if (pass.userId) {
      throw new BadRequestException('该卡券已经被领取。');
    }

    return {
      token: {
        status: addToken.status,
        expiresAt: addToken.expiresAt.toISOString(),
        requireServerVerifiedUser: addToken.requireServerVerifiedUser,
      },
      pass: {
        providerName: pass.provider.name,
        displayName:
          readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName,
        title: pass.templateVersion.title,
        hideTitle: readVersionHideTitle(pass.templateVersion.fields),
        allowTopUpIn: readAllowTopUpIn(pass.templateVersion.rules),
        allowTopUpOut: readAllowTopUpOut(pass.templateVersion.rules),
        description: pass.templateVersion.description,
        category: pass.template.category,
        benefitType: pass.template.benefitType,
        balanceValue: pass.balanceValue.toString(),
        expiresAt: pass.expiresAt?.toISOString() ?? null,
        logoUrl: pass.templateVersion.logoUrl,
        backgroundImageUrl: pass.templateVersion.backgroundImageUrl,
        requiresLocationVerification:
          pass.template.category === 'identity_key' &&
          readLocationRules(pass.templateVersion.locationRules) !== null,
      },
    };
  }

  async claimAddPassToken(user: AuthenticatedUser, claimCode: string) {
    const addToken = await this.prisma.addPassToken.findUnique({
      where: {
        tokenHash: hashClaimCode(claimCode),
      },
    });

    if (!addToken) {
      throw new NotFoundException('领取码不存在。');
    }

    if (addToken.status !== 'Active') {
      throw new BadRequestException('领取码已经被使用、过期或撤销。');
    }

    if (addToken.expiresAt <= new Date()) {
      await this.prisma.addPassToken.update({
        where: {
          id: addToken.id,
        },
        data: {
          status: 'Expired',
        },
      });
      throw new BadRequestException('领取码已过期。');
    }

    if (addToken.requireServerVerifiedUser && !user.serverAccountVerified) {
      throw new BadRequestException('该卡券要求先完成服务器账号验证。');
    }

    if (!addToken.passId) {
      throw new BadRequestException('领取码没有关联可领取的卡券。');
    }

    const pass = await this.prisma.pass.findUnique({
      where: {
        id: addToken.passId,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在。');
    }

    if (pass.userId && pass.userId !== user.id) {
      throw new BadRequestException('该卡券已经被其他用户领取。');
    }

    const claimedPass = await this.prisma.$transaction(async (tx) => {
      const currentMaxSortOrder = await tx.pass.aggregate({
        where: {
          userId: user.id,
          archivedAt: null,
        },
        _max: {
          sortOrder: true,
        },
      });

      await tx.addPassToken.update({
        where: {
          id: addToken.id,
        },
        data: {
          status: 'Claimed',
          claimedByUserId: user.id,
          claimedAt: new Date(),
        },
      });

      return tx.pass.update({
        where: {
          id: pass.id,
        },
        data: {
          userId: user.id,
          status: 'Active',
          addedAt: new Date(),
          sortOrder: (currentMaxSortOrder._max.sortOrder ?? -1) + 1,
        },
        include: {
          provider: true,
          template: true,
          templateVersion: true,
        },
      });
    });

    await this.eventBus.publish({
      type: 'PassAddedToWallet',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        passId: claimedPass.id,
        source: 'manual',
      },
    });

    return {
      pass: {
        id: claimedPass.id,
        providerName: claimedPass.provider.name,
        displayName:
          readVersionDisplayName(claimedPass.templateVersion.fields) ??
          claimedPass.template.displayName,
        title: claimedPass.templateVersion.title,
        hideTitle: readVersionHideTitle(claimedPass.templateVersion.fields),
        allowTopUpIn: readAllowTopUpIn(claimedPass.templateVersion.rules),
        allowTopUpOut: readAllowTopUpOut(claimedPass.templateVersion.rules),
        category: claimedPass.template.category,
        benefitType: claimedPass.template.benefitType,
        status: claimedPass.status,
        maskedNumber: claimedPass.maskedNumber,
        backgroundImageUrl: claimedPass.templateVersion.backgroundImageUrl,
        balanceValue: claimedPass.balanceValue.toString(),
        sortOrder: claimedPass.sortOrder,
      },
    };
  }

  async reorderPasses(
    user: AuthenticatedUser,
    passIds: string[],
  ): Promise<{ ok: true; passes: Array<{ id: string; sortOrder: number }> }> {
    const uniquePassIds = Array.from(new Set(passIds));

    if (uniquePassIds.length !== passIds.length) {
      throw new BadRequestException('排序列表中存在重复卡券。');
    }

    const ownedPasses = await this.prisma.pass.findMany({
      where: {
        id: {
          in: uniquePassIds,
        },
        userId: user.id,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (ownedPasses.length !== uniquePassIds.length) {
      throw new BadRequestException('排序列表包含不存在、已归档或不属于当前用户的卡券。');
    }

    const reordered = await this.prisma.$transaction(
      uniquePassIds.map((passId, index) =>
        this.prisma.pass.update({
          where: {
            id: passId,
          },
          data: {
            sortOrder: index,
          },
          select: {
            id: true,
            sortOrder: true,
          },
        }),
      ),
    );

    await this.eventBus.publish({
      type: 'PassOrderUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        passIds: uniquePassIds,
      },
    });

    return {
      ok: true,
      passes: reordered,
    };
  }

  async archivePass(
    user: AuthenticatedUser,
    passId: string,
  ): Promise<{ ok: true; pass: { id: string; status: string; archivedAt: string } }> {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        userId: user.id,
        archivedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在、已归档或不属于当前用户。');
    }

    const archivedPass = await this.prisma.pass.update({
      where: {
        id: pass.id,
      },
      data: {
        status: 'Archived',
        archivedAt: new Date(),
      },
      select: {
        id: true,
        status: true,
        archivedAt: true,
      },
    });

    await this.eventBus.publish({
      type: 'PassDeleted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        passId: archivedPass.id,
      },
    });

    return {
      ok: true,
      pass: {
        id: archivedPass.id,
        status: archivedPass.status,
        archivedAt: archivedPass.archivedAt?.toISOString() ?? new Date().toISOString(),
      },
    };
  }

  async topUpPass(user: AuthenticatedUser, targetPassId: string, dto: TopUpWalletPassDto) {
    const now = new Date();
    const input = this.normalizeTopUpInput(dto);
    const topUpRequest = await this.createTopUpRequest(
      user,
      targetPassId,
      input,
      'pin',
      'Created',
      now,
    );

    try {
      await this.verifyTopUpPin(user, dto.secondFactor, topUpRequest.id, now);
      return this.performTopUpPass(user, targetPassId, input, topUpRequest.id, now);
    } catch (error) {
      await this.failTopUpRequest(topUpRequest, error);
      throw error;
    }
  }

  async startTopUpServerChallenge(
    user: AuthenticatedUser,
    targetPassId: string,
    dto: StartTopUpServerChallengeDto,
  ) {
    const input = this.normalizeTopUpInput(dto);

    if (!user.serverAccountVerified || !user.serverAccountName) {
      throw new UnauthorizedException('需要先在账户页完成服务器账号验证。');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + walletTopUpServerConfirmationTtlMs);
    const topUpRequest = await this.createTopUpRequest(
      user,
      targetPassId,
      input,
      'server_account',
      'WaitingVerification',
      now,
      expiresAt,
    );

    try {
      const referenceId = this.createTopUpChallengeReferenceId(topUpRequest.id);
      const challenge = await this.createTopUpServerChallenge(
        user.id,
        user.serverAccountName,
        referenceId,
        'manual_refresh',
        expiresAt,
      );

      return {
        status: 'challenge_issued',
        challenge,
        topUpRequest: this.toTopUpRequestView(topUpRequest),
        topUpPreview: {
          targetPassId,
          sourcePassId: input.sourcePassId,
          value: input.value,
          note: input.note,
        },
      };
    } catch (error) {
      await this.failTopUpRequest(topUpRequest, error);
      throw error;
    }
  }

  async confirmTopUpWithServer(
    user: AuthenticatedUser,
    targetPassId: string,
    dto: ConfirmTopUpWithServerDto,
  ) {
    const input = this.normalizeTopUpInput(dto);

    if (!user.serverAccountVerified || !user.serverAccountName) {
      throw new UnauthorizedException('需要先在账户页完成服务器账号验证。');
    }

    const challenge = await this.prisma.serverVerificationChallenge.findFirst({
      where: {
        id: dto.challengeId,
        userId: user.id,
        purpose: 'pass_top_up',
        referenceType: 'wallet_direct_top_up',
      },
    });

    if (!challenge) {
      throw new BadRequestException('服务器账号确认验证码不存在，请重新获取。');
    }

    const topUpId = this.readTopUpIdFromChallengeReferenceId(challenge.referenceId);
    if (!topUpId) {
      throw new BadRequestException('服务器账号确认验证码版本过旧，请重新获取。');
    }

    const topUpRequest = await this.prisma.passTopUpRequest.findFirst({
      where: {
        id: topUpId,
        userId: user.id,
      },
    });

    if (!topUpRequest) {
      throw new BadRequestException('额度补充请求不存在，请重新发起。');
    }

    this.assertTopUpRequestMatchesInput(topUpRequest, targetPassId, input);

    if (challenge.serverId !== user.serverAccountName) {
      throw new BadRequestException('服务器账号确认验证码与当前绑定账号不匹配，请重新获取。');
    }

    if (topUpRequest.status === 'Succeeded') {
      const completedTopUp = await this.readCompletedTopUpResult(topUpRequest.id);
      return completedTopUp
        ? {
            status: 'verified',
            ...completedTopUp,
          }
        : {
            status: 'verified',
          };
    }

    if (topUpRequest.status === 'Cancelled') {
      return {
        status: 'cancelled',
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (topUpRequest.status === 'Expired') {
      return {
        status: 'expired',
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (topUpRequest.status === 'Failed') {
      return {
        status: 'failed',
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (challenge.status === 'verified') {
      const completedTopUp = await this.readCompletedTopUpResult(topUpRequest.id);
      return completedTopUp
        ? {
            status: 'verified',
            ...completedTopUp,
          }
        : {
            status: 'verified',
          };
    }

    if (challenge.status !== 'active') {
      return {
        status: challenge.status === 'expired' ? 'expired' : 'waiting',
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (challenge.expiresAt <= new Date()) {
      await this.expireTopUpRequest(topUpRequest, new Date());
      await this.prisma.serverVerificationChallenge.update({
        where: {
          id: challenge.id,
        },
        data: {
          status: 'expired',
        },
      });

      return {
        status: 'expired',
        topUpRequest: this.toTopUpRequestViewFromRecord({
          ...topUpRequest,
          status: 'Expired',
        }),
      };
    }

    const messages = await this.fetchChatMessagesOrThrow(challenge.lastCheckedChatId + 1);
    const nextLastCheckedChatId = messages.reduce(
      (latest, message) => Math.max(latest, readBdslmChatMessageId(message)),
      challenge.lastCheckedChatId,
    );
    const matchingMessages = messages.filter(
      (message) => readBdslmChatSender(message) === challenge.serverId,
    );

    for (const message of matchingMessages) {
      if (
        await this.secretHash.verifySecret(
          readBdslmChatContent(message),
          challenge.codeHash,
          'server-verification-code',
        )
      ) {
        const verifiedAt = new Date();
        let result;
        try {
          result = await this.performTopUpPass(user, targetPassId, input, topUpRequest.id, verifiedAt);
        } catch (error) {
          await this.failTopUpRequest(this.toTopUpRequestSnapshotFromRecord(topUpRequest), error);
          throw error;
        }

        await this.prisma.serverVerificationChallenge.update({
          where: {
            id: challenge.id,
          },
          data: {
            status: 'verified',
            lastCheckedChatId: nextLastCheckedChatId,
          },
        });

        return {
          status: 'verified',
          ...result,
        };
      }
    }

    if (matchingMessages.length > 0) {
      const rotatedChallenge = await this.rotateTopUpServerChallenge(
        challenge,
        nextLastCheckedChatId,
        'chat_mismatch',
      );
      return {
        status: 'rotated',
        challenge: rotatedChallenge,
        topUpRequest: {
          ...this.toTopUpRequestViewFromRecord(topUpRequest),
          expiresAt: rotatedChallenge.expiresAt,
        },
      };
    }

    await this.prisma.serverVerificationChallenge.update({
      where: {
        id: challenge.id,
      },
      data: {
        lastCheckedChatId: nextLastCheckedChatId,
      },
    });

    return {
      status: 'waiting',
      topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
    };
  }

  async cancelTopUpRequest(user: AuthenticatedUser, topUpId: string, reason?: string) {
    const topUpRequest = await this.prisma.passTopUpRequest.findFirst({
      where: {
        id: topUpId,
        userId: user.id,
      },
    });

    if (!topUpRequest) {
      throw new NotFoundException('额度补充请求不存在。');
    }

    if (topUpRequest.status === 'Succeeded' || topUpRequest.status === 'Reversed') {
      throw new BadRequestException('已完成的额度补充不能取消，如需处理请提交争议或联系管理员冲正。');
    }

    if (topUpRequest.status === 'Cancelled') {
      return {
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (topUpRequest.status === 'Failed' || topUpRequest.status === 'Expired') {
      throw new BadRequestException('失败或过期的额度补充请求不能取消。');
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.passTopUpRequest.update({
        where: {
          id: topUpRequest.id,
        },
        data: {
          status: 'Cancelled',
          cancelledAt: now,
          failureCode: null,
          failureMessage: null,
        },
      });

      await tx.serverVerificationChallenge.updateMany({
        where: {
          userId: user.id,
          purpose: 'pass_top_up',
          referenceType: 'wallet_direct_top_up',
          referenceId: this.createTopUpChallengeReferenceId(topUpRequest.id),
          status: 'active',
        },
        data: {
          status: 'cancelled',
        },
      });

      return updatedRequest;
    });

    await this.eventBus.publish({
      type: 'PassTopUpCancelled',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        topUpId: topUpRequest.id,
        userId: user.id,
        sourcePassId: topUpRequest.sourcePassId,
        targetPassId: topUpRequest.targetPassId,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    });

    return {
      topUpRequest: this.toTopUpRequestViewFromRecord(updated),
    };
  }

  private async createTopUpRequest(
    user: AuthenticatedUser,
    targetPassId: string,
    input: WalletTopUpInput,
    verificationMethod: VerificationMethod,
    status: Extract<PassTopUpStatus, 'Created' | 'WaitingVerification'>,
    now: Date,
    expiresAt?: Date,
  ): Promise<WalletTopUpRequestSnapshot> {
    const pair = await this.readTopUpPassPair(user, targetPassId, input);
    const topUpRequest = await this.prisma.passTopUpRequest.create({
      data: {
        userId: user.id,
        sourcePassId: pair.sourcePass.id,
        targetPassId: pair.targetPass.id,
        sourceProviderId: pair.sourcePass.providerId,
        providerId: pair.targetPass.providerId,
        status,
        verificationMethod,
        requestedValue: input.value,
        note: input.note ?? null,
        expiresAt: expiresAt ?? null,
        createdAt: now,
      },
    });

    const snapshot: WalletTopUpRequestSnapshot = {
      id: topUpRequest.id,
      userId: user.id,
      sourcePassId: pair.sourcePass.id,
      targetPassId: pair.targetPass.id,
      sourceProviderId: pair.sourcePass.providerId,
      providerId: pair.targetPass.providerId,
      benefitType: pair.targetPass.template.benefitType,
      value: topUpRequest.requestedValue.toString(),
      verificationMethod: topUpRequest.verificationMethod,
      status: topUpRequest.status,
      expiresAt: topUpRequest.expiresAt,
    };

    await this.eventBus.publish({
      type: 'PassTopUpRequested',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        topUpId: snapshot.id,
        userId: user.id,
        sourcePassId: snapshot.sourcePassId,
        targetPassId: snapshot.targetPassId,
        providerId: snapshot.providerId,
        sourceProviderId: snapshot.sourceProviderId,
        benefitType: snapshot.benefitType,
        value: snapshot.value,
        verificationMethod,
        status,
        ...(snapshot.expiresAt ? { expiresAt: snapshot.expiresAt.toISOString() } : {}),
      },
    });

    return snapshot;
  }

  private async readTopUpPassPair(
    user: AuthenticatedUser,
    targetPassId: string,
    input: WalletTopUpInput,
  ) {
    if (input.sourcePassId === targetPassId) {
      throw new BadRequestException('来源卡和目标卡不能相同。');
    }

    const [targetPass, sourcePass] = await Promise.all([
      this.prisma.pass.findFirst({
        where: {
          id: targetPassId,
          userId: user.id,
          archivedAt: null,
        },
        include: {
          template: true,
          templateVersion: true,
        },
      }),
      this.prisma.pass.findFirst({
        where: {
          id: input.sourcePassId,
          userId: user.id,
          archivedAt: null,
        },
        include: {
          template: true,
          templateVersion: true,
        },
      }),
    ]);

    if (!targetPass) {
      throw new NotFoundException('目标卡券不存在、已归档或不属于当前用户。');
    }

    if (!sourcePass) {
      throw new NotFoundException('来源卡券不存在、已归档或不属于当前用户。');
    }

    this.assertTopUpPassPair(targetPass, sourcePass, input.value);

    return {
      targetPass,
      sourcePass,
    };
  }

  private assertTopUpRequestMatchesInput(
    request: {
      sourcePassId: string;
      targetPassId: string;
      requestedValue: { toString(): string };
      note: string | null;
    },
    targetPassId: string,
    input: WalletTopUpInput,
  ): void {
    if (
      request.targetPassId !== targetPassId ||
      request.sourcePassId !== input.sourcePassId ||
      parseFixedDecimal(request.requestedValue.toString()) !== parseFixedDecimal(input.value) ||
      (request.note ?? '') !== (input.note ?? '')
    ) {
      throw new BadRequestException('额度补充请求内容已变化，请重新获取服务器验证码。');
    }
  }

  private async failTopUpRequest(
    request: WalletTopUpRequestSnapshot,
    error: unknown,
  ): Promise<void> {
    const failure = this.toTopUpFailure(error);
    const updated = await this.prisma.passTopUpRequest.updateMany({
      where: {
        id: request.id,
        status: {
          in: ['Created', 'WaitingVerification'],
        },
      },
      data: {
        status: 'Failed',
        failureCode: failure.errorCode,
        failureMessage: failure.errorMessage,
      },
    });

    if (updated.count === 0) {
      return;
    }

    await this.eventBus.publish({
      type: 'PassTopUpFailed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: request.userId,
      payload: {
        topUpId: request.id,
        userId: request.userId,
        sourcePassId: request.sourcePassId,
        targetPassId: request.targetPassId,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        retryable: failure.retryable,
      },
    });
  }

  private async expireTopUpRequest(
    request: {
      id: string;
      userId: string;
      sourcePassId: string;
      targetPassId: string;
    },
    expiredAt: Date,
  ): Promise<void> {
    const updated = await this.prisma.passTopUpRequest.updateMany({
      where: {
        id: request.id,
        status: 'WaitingVerification',
      },
      data: {
        status: 'Expired',
        expiresAt: expiredAt,
      },
    });

    if (updated.count === 0) {
      return;
    }

    await this.eventBus.publish({
      type: 'PassTopUpExpired',
      eventId: randomUUID(),
      occurredAt: expiredAt.toISOString(),
      actorType: 'system',
      actorId: 'system',
      payload: {
        topUpId: request.id,
        userId: request.userId,
        sourcePassId: request.sourcePassId,
        targetPassId: request.targetPassId,
        expiredAt: expiredAt.toISOString(),
      },
    });
  }

  private toTopUpFailure(error: unknown): {
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  } {
    const errorMessage = error instanceof Error ? error.message : '额度补充失败。';

    if (error instanceof UnauthorizedException) {
      return {
        errorCode: 'verification_failed',
        errorMessage,
        retryable: true,
      };
    }

    if (error instanceof ServiceUnavailableException) {
      return {
        errorCode: 'server_chat_unavailable',
        errorMessage,
        retryable: true,
      };
    }

    if (error instanceof NotFoundException) {
      return {
        errorCode: 'pass_not_found',
        errorMessage,
        retryable: false,
      };
    }

    if (error instanceof BadRequestException) {
      return {
        errorCode: 'validation_failed',
        errorMessage,
        retryable: false,
      };
    }

    if (error instanceof HttpException) {
      return {
        errorCode: `http_${error.getStatus()}`,
        errorMessage,
        retryable: error.getStatus() >= 500,
      };
    }

    return {
      errorCode: 'processing_failed',
      errorMessage,
      retryable: true,
    };
  }

  private async performTopUpPass(
    user: AuthenticatedUser,
    targetPassId: string,
    input: WalletTopUpInput,
    topUpId: string,
    now: Date,
  ) {
    const existingTopUp = await this.readCompletedTopUpResult(topUpId);
    if (existingTopUp) {
      return existingTopUp;
    }

    const value = normalizePositiveDecimal(input.value, '补充额度必须大于 0。');
    const sourcePassId = input.sourcePassId;

    if (sourcePassId === targetPassId) {
      throw new BadRequestException('来源卡和目标卡不能相同。');
    }

    const note = input.note?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      const [targetPass, sourcePass] = await Promise.all([
        tx.pass.findFirst({
          where: {
            id: targetPassId,
            userId: user.id,
            archivedAt: null,
          },
          include: {
            provider: true,
            template: true,
            templateVersion: true,
          },
        }),
        tx.pass.findFirst({
          where: {
            id: sourcePassId,
            userId: user.id,
            archivedAt: null,
          },
          include: {
            provider: true,
            template: true,
            templateVersion: true,
          },
        }),
      ]);

      if (!targetPass) {
        throw new NotFoundException('目标卡券不存在、已归档或不属于当前用户。');
      }

      if (!sourcePass) {
        throw new NotFoundException('来源卡券不存在、已归档或不属于当前用户。');
      }

      if (targetPass.status !== 'Active' || sourcePass.status !== 'Active') {
        throw new BadRequestException('只有正常可用的卡券可以进行额度补充。');
      }

      if (targetPass.template.benefitType !== sourcePass.template.benefitType) {
        throw new BadRequestException('来源卡和目标卡的权益类型必须一致。');
      }

      if (!readAllowTopUpIn(targetPass.templateVersion.rules)) {
        throw new BadRequestException('目标卡的发行方未开放额度补充。');
      }

      if (!readAllowTopUpOut(sourcePass.templateVersion.rules)) {
        throw new BadRequestException('来源卡的发行方未开放作为补充来源。');
      }

      if (
        !canConsumeValue(
          sourcePass.balanceValue.toString(),
          sourcePass.frozenValue.toString(),
          sourcePass.overdraftLimit.toString(),
          value,
        )
      ) {
        throw new BadRequestException('来源卡可用额度不足。');
      }

      const sourceBeforeValue = sourcePass.balanceValue.toString();
      const sourceAfterValue = subtractDecimalStrings(sourceBeforeValue, value);
      const targetBeforeValue = targetPass.balanceValue.toString();
      const targetAfterValue = addDecimalStrings(targetBeforeValue, value);

      const [updatedSourcePass, updatedTargetPass, sourceLedgerEntry, targetLedgerEntry] =
        await Promise.all([
          tx.pass.update({
            where: {
              id: sourcePass.id,
            },
            data: {
              balanceValue: sourceAfterValue,
            },
            include: {
              provider: true,
              template: true,
              templateVersion: true,
            },
          }),
          tx.pass.update({
            where: {
              id: targetPass.id,
            },
            data: {
              balanceValue: targetAfterValue,
            },
            include: {
              provider: true,
              template: true,
              templateVersion: true,
            },
          }),
          tx.ledgerEntry.create({
            data: {
              passId: sourcePass.id,
              userId: user.id,
              providerId: sourcePass.providerId,
              benefitType: sourcePass.template.benefitType,
              reason: 'top_up',
              beforeValue: sourceBeforeValue,
              changeValue: `-${value}`,
              afterValue: sourceAfterValue,
              idempotencyKey: `wallet-top-up:${topUpId}:source`,
              referenceType: 'pass_top_up',
              referenceId: topUpId,
              note: note
                ? `${note}；用于补充 ${targetPass.template.displayName}`
                : `用于补充 ${targetPass.template.displayName}`,
              createdByType: 'user',
              createdById: user.id,
              createdAt: now,
            },
          }),
          tx.ledgerEntry.create({
            data: {
              passId: targetPass.id,
              userId: user.id,
              providerId: targetPass.providerId,
              benefitType: targetPass.template.benefitType,
              reason: 'top_up',
              beforeValue: targetBeforeValue,
              changeValue: value,
              afterValue: targetAfterValue,
              idempotencyKey: `wallet-top-up:${topUpId}:target`,
              referenceType: 'pass_top_up',
              referenceId: topUpId,
              note: note
                ? `${note}；来自 ${sourcePass.template.displayName}`
                : `来自 ${sourcePass.template.displayName}`,
              createdByType: 'user',
              createdById: user.id,
              createdAt: now,
            },
          }),
        ]);

      await tx.passTopUpRequest.updateMany({
        where: {
          id: topUpId,
          status: {
            in: ['Created', 'WaitingVerification'],
          },
        },
        data: {
          status: 'Succeeded',
          sourceLedgerEntryId: sourceLedgerEntry.id,
          targetLedgerEntryId: targetLedgerEntry.id,
          failureCode: null,
          failureMessage: null,
          completedAt: now,
        },
      });

      return {
        topUpId,
        sourceBeforeValue,
        sourceAfterValue,
        targetBeforeValue,
        targetAfterValue,
        sourcePass: updatedSourcePass,
        targetPass: updatedTargetPass,
        sourceLedgerEntry,
        targetLedgerEntry,
      };
    });

    await this.eventBus.publish({
      type: 'PassTopUpSucceeded',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        topUpId: result.topUpId,
        userId: user.id,
        sourcePassId: result.sourcePass.id,
        targetPassId: result.targetPass.id,
        providerId: result.targetPass.providerId,
        sourceProviderId: result.sourcePass.providerId,
        benefitType: result.targetPass.template.benefitType,
        value,
        sourceLedgerEntryId: result.sourceLedgerEntry.id,
        targetLedgerEntryId: result.targetLedgerEntry.id,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        passId: result.sourcePass.id,
        providerId: result.sourcePass.providerId,
        balanceType: result.sourcePass.template.benefitType,
        beforeValue: result.sourceBeforeValue,
        afterValue: result.sourceAfterValue,
        changeValue: `-${value}`,
        reason: 'top_up',
        referenceId: result.topUpId,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        passId: result.targetPass.id,
        providerId: result.targetPass.providerId,
        balanceType: result.targetPass.template.benefitType,
        beforeValue: result.targetBeforeValue,
        afterValue: result.targetAfterValue,
        changeValue: value,
        reason: 'top_up',
        referenceId: result.topUpId,
      },
    });

    return {
      topUp: {
        id: result.topUpId,
        status: 'Succeeded',
        value,
        sourceLedgerEntryId: result.sourceLedgerEntry.id,
        targetLedgerEntryId: result.targetLedgerEntry.id,
      },
      sourcePass: this.toWalletPassSummary(result.sourcePass),
      targetPass: this.toWalletPassSummary(result.targetPass),
      ledgerEntry: {
        id: result.targetLedgerEntry.id,
        benefitType: result.targetLedgerEntry.benefitType,
        reason: result.targetLedgerEntry.reason,
        beforeValue: result.targetLedgerEntry.beforeValue.toString(),
        changeValue: result.targetLedgerEntry.changeValue.toString(),
        afterValue: result.targetLedgerEntry.afterValue.toString(),
        referenceType: result.targetLedgerEntry.referenceType,
        referenceId: result.targetLedgerEntry.referenceId,
        note: result.targetLedgerEntry.note,
        createdByType: result.targetLedgerEntry.createdByType,
        createdAt: result.targetLedgerEntry.createdAt.toISOString(),
      },
    };
  }

  async createPassTransfer(user: AuthenticatedUser, passId: string, dto: TransferWalletPassDto) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        userId: user.id,
        archivedAt: null,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在、已归档或不属于当前用户。');
    }

    if (pass.status !== 'Active') {
      throw new BadRequestException('只有正常可用的卡券可以转赠。');
    }

    if (!readTransferableRule(pass.templateVersion.rules)) {
      throw new BadRequestException('该卡券发行方未开放转赠。');
    }

    const recipientIdentifier = dto.recipient.trim();
    const recipient = await this.prisma.user.findFirst({
      where: {
        OR: [
          {
            username: recipientIdentifier,
          },
          {
            email: recipientIdentifier.toLowerCase(),
          },
        ],
      },
    });

    if (!recipient || recipient.status !== 'Active') {
      throw new NotFoundException('接收方用户不存在或尚未激活。');
    }

    if (recipient.id === user.id) {
      throw new BadRequestException('不能把卡券转赠给自己。');
    }

    await this.expirePassTransfersForPass(pass.id);

    const pendingTransfer = await this.prisma.passTransfer.findFirst({
      where: {
        passId: pass.id,
        status: 'Pending',
      },
      select: {
        id: true,
      },
    });

    if (pendingTransfer) {
      throw new BadRequestException('该卡券已有待确认的转赠请求。');
    }

    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const transfer = await this.prisma.passTransfer.create({
      data: {
        passId: pass.id,
        fromUserId: user.id,
        toUserId: recipient.id,
        note: dto.note?.trim() || null,
        expiresAt,
      },
      include: this.passTransferInclude,
    });

    await this.eventBus.publish({
      type: 'PassTransferRequested',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        transferId: transfer.id,
        passId: transfer.passId,
        fromUserId: transfer.fromUserId,
        toUserId: transfer.toUserId,
        expiresAt: transfer.expiresAt.toISOString(),
      },
    });

    return {
      transfer: this.toPassTransferView(transfer),
    };
  }

  async listPassTransfers(user: AuthenticatedUser) {
    await this.expireUserPassTransfers(user.id);

    const [sentTransfers, receivedTransfers] = await Promise.all([
      this.prisma.passTransfer.findMany({
        where: {
          fromUserId: user.id,
        },
        include: this.passTransferInclude,
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
      }),
      this.prisma.passTransfer.findMany({
        where: {
          toUserId: user.id,
        },
        include: this.passTransferInclude,
        orderBy: {
          createdAt: 'desc',
        },
        take: 20,
      }),
    ]);

    return {
      sentTransfers: sentTransfers.map((transfer) => this.toPassTransferView(transfer)),
      receivedTransfers: receivedTransfers.map((transfer) => this.toPassTransferView(transfer)),
    };
  }

  async acceptPassTransfer(user: AuthenticatedUser, transferId: string) {
    const transfer = await this.findReceivedPendingTransfer(user.id, transferId);
    const now = new Date();

    if (transfer.expiresAt <= now) {
      await this.markPassTransferExpired(transfer.id);
      throw new BadRequestException('转赠请求已过期。');
    }

    if (transfer.pass.userId !== transfer.fromUserId || transfer.pass.archivedAt) {
      throw new BadRequestException('卡券当前状态已变化，不能接收该转赠。');
    }

    const acceptedTransfer = await this.prisma.$transaction(async (tx) => {
      const currentMaxSortOrder = await tx.pass.aggregate({
        where: {
          userId: user.id,
          archivedAt: null,
        },
        _max: {
          sortOrder: true,
        },
      });

      await tx.pass.update({
        where: {
          id: transfer.passId,
        },
        data: {
          userId: user.id,
          addedAt: now,
          sortOrder: (currentMaxSortOrder._max.sortOrder ?? -1) + 1,
        },
      });

      return tx.passTransfer.update({
        where: {
          id: transfer.id,
        },
        data: {
          status: 'Accepted',
          respondedAt: now,
        },
        include: this.passTransferInclude,
      });
    });

    await this.eventBus.publish({
      type: 'PassTransferAccepted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        transferId: acceptedTransfer.id,
        passId: acceptedTransfer.passId,
        fromUserId: acceptedTransfer.fromUserId,
        toUserId: acceptedTransfer.toUserId,
      },
    });

    return {
      transfer: this.toPassTransferView(acceptedTransfer),
    };
  }

  async rejectPassTransfer(
    user: AuthenticatedUser,
    transferId: string,
    reason?: ResolvePassTransferDto['reason'],
  ) {
    const transfer = await this.findReceivedPendingTransfer(user.id, transferId);
    const rejectedTransfer = await this.resolvePassTransfer(transfer.id, 'Rejected', reason);

    await this.eventBus.publish({
      type: 'PassTransferRejected',
      eventId: randomUUID(),
      occurredAt: rejectedTransfer.respondedAt?.toISOString() ?? new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        transferId: rejectedTransfer.id,
        passId: rejectedTransfer.passId,
        fromUserId: rejectedTransfer.fromUserId,
        toUserId: rejectedTransfer.toUserId,
        ...(rejectedTransfer.responseReason ? { reason: rejectedTransfer.responseReason } : {}),
      },
    });

    return {
      transfer: this.toPassTransferView(rejectedTransfer),
    };
  }

  async cancelPassTransfer(
    user: AuthenticatedUser,
    transferId: string,
    reason?: ResolvePassTransferDto['reason'],
  ) {
    const transfer = await this.prisma.passTransfer.findFirst({
      where: {
        id: transferId,
        fromUserId: user.id,
        status: 'Pending',
      },
      include: this.passTransferInclude,
    });

    if (!transfer) {
      throw new NotFoundException('待取消的转赠请求不存在。');
    }

    const cancelledTransfer = await this.resolvePassTransfer(transfer.id, 'Cancelled', reason);

    await this.eventBus.publish({
      type: 'PassTransferCancelled',
      eventId: randomUUID(),
      occurredAt: cancelledTransfer.respondedAt?.toISOString() ?? new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        transferId: cancelledTransfer.id,
        passId: cancelledTransfer.passId,
        fromUserId: cancelledTransfer.fromUserId,
        toUserId: cancelledTransfer.toUserId,
        ...(cancelledTransfer.responseReason ? { reason: cancelledTransfer.responseReason } : {}),
      },
    });

    return {
      transfer: this.toPassTransferView(cancelledTransfer),
    };
  }

  async verifyPassLocation(user: AuthenticatedUser, passId: string) {
    const pass = await this.prisma.pass.findFirst({
      where: {
        id: passId,
        userId: user.id,
        archivedAt: null,
      },
      include: {
        provider: true,
        template: true,
        templateVersion: true,
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在、已归档或不属于当前用户。');
    }

    if (pass.template.category !== 'identity_key') {
      throw new BadRequestException('只有证件/钥匙类卡券支持位置核验。');
    }

    if (!user.serverAccountVerified || !user.serverAccountName) {
      throw new BadRequestException('请先完成服务器账号验证。');
    }

    const locationRules = readLocationRules(pass.templateVersion.locationRules);
    if (!locationRules?.rules.length) {
      throw new BadRequestException('该卡券没有配置位置核验范围。');
    }

    let markers: Awaited<ReturnType<BdslmClientService['fetchPlayerMarkers']>>;
    try {
      markers = await this.bdslmClient.fetchPlayerMarkers();
    } catch {
      throw new ServiceUnavailableException('服务器位置接口暂不可用。');
    }

    const marker = markers.find((candidate) => candidate.text.trim() === user.serverAccountName);
    if (!marker) {
      throw new BadRequestException('玩家不在线或位置未知。');
    }

    const matchedRule = locationRules.rules.find((rule) =>
      isMarkerInLocationRule(marker.x, marker.z, rule),
    );
    if (!matchedRule) {
      throw new BadRequestException('玩家当前位置不在核验范围内。');
    }

    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt.getTime() + matchedRule.expiresAfterSeconds * 1000);

    await this.eventBus.publish({
      type: 'ServerLocationVerified',
      eventId: randomUUID(),
      occurredAt: verifiedAt.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        serverId: user.serverAccountName,
        playerName: marker.text,
        ruleId: matchedRule.id,
        x: marker.x,
        z: marker.z,
        verifiedAt: verifiedAt.toISOString(),
      },
    });

    return {
      ok: true,
      verifiedAt: verifiedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      player: {
        name: marker.text,
        x: marker.x,
        z: marker.z,
      },
      rule: {
        id: matchedRule.id,
        label: matchedRule.label,
        kind: matchedRule.kind,
        expiresAfterSeconds: matchedRule.expiresAfterSeconds,
      },
    };
  }

  private async listWalletPassRecords(userId: string) {
    return this.prisma.pass.findMany({
      where: {
        userId,
        archivedAt: null,
        status: {
          in: ['Added', 'Active', 'Frozen', 'Expired', 'UsedUp'],
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { addedAt: 'desc' }, { updatedAt: 'desc' }],
      include: {
        provider: true,
        template: true,
        templateVersion: true,
      },
    });
  }

  private async verifyTopUpPin(
    user: AuthenticatedUser,
    pin: string,
    topUpId: string,
    verifiedAt: Date,
  ): Promise<void> {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
      select: {
        pinHash: true,
      },
    });

    if (!existingUser?.pinHash) {
      throw new BadRequestException('请先在账户页设置 PIN。');
    }

    if (!(await this.secretHash.verifySecret(pin, existingUser.pinHash, 'pin'))) {
      throw new UnauthorizedException('PIN 不正确。');
    }

    await this.eventBus.publish({
      type: 'PinVerificationSucceeded',
      eventId: randomUUID(),
      occurredAt: verifiedAt.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        challengeId: topUpId,
        purpose: 'pass_top_up',
      },
    });
  }

  private normalizeTopUpInput(input: WalletTopUpInput): WalletTopUpInput {
    const normalizedInput: WalletTopUpInput = {
      sourcePassId: input.sourcePassId,
      value: normalizePositiveDecimal(input.value, '补充额度必须大于 0。'),
    };

    const note = input.note?.trim();
    if (note) {
      normalizedInput.note = note;
    }

    return normalizedInput;
  }

  private assertTopUpPassPair(
    targetPass: {
      status: string;
      template: {
        benefitType: string;
      };
      templateVersion: {
        rules: Prisma.JsonValue;
      };
    },
    sourcePass: {
      status: string;
      balanceValue: { toString(): string };
      frozenValue: { toString(): string };
      overdraftLimit: { toString(): string };
      template: {
        benefitType: string;
      };
      templateVersion: {
        rules: Prisma.JsonValue;
      };
    },
    value: string,
  ): void {
    if (targetPass.status !== 'Active' || sourcePass.status !== 'Active') {
      throw new BadRequestException('只有正常可用的卡券可以进行额度补充。');
    }

    if (targetPass.template.benefitType !== sourcePass.template.benefitType) {
      throw new BadRequestException('来源卡和目标卡的权益类型必须一致。');
    }

    if (!readAllowTopUpIn(targetPass.templateVersion.rules)) {
      throw new BadRequestException('目标卡的发行方未开放额度补充。');
    }

    if (!readAllowTopUpOut(sourcePass.templateVersion.rules)) {
      throw new BadRequestException('来源卡的发行方未开放作为补充来源。');
    }

    if (
      !canConsumeValue(
        sourcePass.balanceValue.toString(),
        sourcePass.frozenValue.toString(),
        sourcePass.overdraftLimit.toString(),
        value,
      )
    ) {
      throw new BadRequestException('来源卡可用额度不足。');
    }
  }

  private createTopUpChallengeReferenceId(topUpId: string): string {
    return `${walletDirectTopUpReferencePrefix}${topUpId}`;
  }

  private readTopUpIdFromChallengeReferenceId(referenceId: string | null): string | null {
    if (!referenceId?.startsWith(walletDirectTopUpReferencePrefix)) {
      return null;
    }

    return referenceId.slice(walletDirectTopUpReferencePrefix.length) || null;
  }

  private async createTopUpServerChallenge(
    userId: string,
    serverId: string,
    referenceId: string,
    rotateReason: 'manual_refresh' | 'expired' | 'rate_limit_retry',
    expiresAt: Date,
  ) {
    const activeChallenges = await this.prisma.serverVerificationChallenge.findMany({
      where: {
        userId,
        purpose: 'pass_top_up',
        referenceType: 'wallet_direct_top_up',
        referenceId,
        status: 'active',
      },
      select: {
        id: true,
      },
    });
    const lastCheckedChatId = await this.readLatestChatId();
    const code = this.createReadableCode();
    const challenge = await this.prisma.$transaction(async (tx) => {
      if (activeChallenges.length > 0) {
        await tx.serverVerificationChallenge.updateMany({
          where: {
            id: {
              in: activeChallenges.map((item) => item.id),
            },
          },
          data: {
            status: 'rotated',
            lastCheckedChatId,
          },
        });
      }

      return tx.serverVerificationChallenge.create({
        data: {
          userId,
          serverId,
          purpose: 'pass_top_up',
          codeHash: await this.secretHash.hashSecret(code, 'server-verification-code'),
          lastCheckedChatId,
          expiresAt,
          referenceType: 'wallet_direct_top_up',
          referenceId,
          rotatedFromId: activeChallenges[0]?.id ?? null,
        },
      });
    });

    for (const activeChallenge of activeChallenges) {
      await this.eventBus.publish({
        type: 'ServerVerificationCodeRotated',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorType: 'system',
        actorId: 'system',
        payload: {
          userId,
          serverId,
          verificationId: challenge.id,
          previousVerificationId: activeChallenge.id,
          reason: rotateReason,
          purpose: 'pass_top_up',
        },
      });
    }

    await this.eventBus.publish({
      type: 'ServerVerificationCodeIssued',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: userId,
      payload: {
        userId,
        serverId,
        verificationId: challenge.id,
        expiresAt: expiresAt.toISOString(),
        purpose: 'pass_top_up',
      },
    });

    return this.toServerChallengeView(challenge, code);
  }

  private async rotateTopUpServerChallenge(
    challenge: {
      id: string;
      userId: string;
      serverId: string;
      referenceId: string | null;
    },
    lastCheckedChatId: number,
    reason: 'chat_mismatch' | 'manual_refresh' | 'expired' | 'rate_limit_retry',
  ) {
    const code = this.createReadableCode();
    const expiresAt = new Date(Date.now() + walletTopUpServerConfirmationTtlMs);

    const nextChallenge = await this.prisma.$transaction(async (tx) => {
      await tx.serverVerificationChallenge.update({
        where: {
          id: challenge.id,
        },
        data: {
          status: 'rotated',
          lastCheckedChatId,
        },
      });

      return tx.serverVerificationChallenge.create({
        data: {
          userId: challenge.userId,
          serverId: challenge.serverId,
          purpose: 'pass_top_up',
          codeHash: await this.secretHash.hashSecret(code, 'server-verification-code'),
          lastCheckedChatId,
          expiresAt,
          referenceType: 'wallet_direct_top_up',
          referenceId: challenge.referenceId,
          rotatedFromId: challenge.id,
        },
      });
    });

    const topUpId = this.readTopUpIdFromChallengeReferenceId(challenge.referenceId);
    if (topUpId) {
      await this.prisma.passTopUpRequest.updateMany({
        where: {
          id: topUpId,
          status: 'WaitingVerification',
        },
        data: {
          expiresAt,
        },
      });
    }

    await this.eventBus.publish({
      type: 'ServerVerificationCodeRotated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: 'system',
      payload: {
        userId: challenge.userId,
        serverId: challenge.serverId,
        verificationId: nextChallenge.id,
        previousVerificationId: challenge.id,
        reason,
        purpose: 'pass_top_up',
      },
    });

    await this.eventBus.publish({
      type: 'ServerVerificationCodeIssued',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: 'system',
      payload: {
        userId: challenge.userId,
        serverId: challenge.serverId,
        verificationId: nextChallenge.id,
        expiresAt: expiresAt.toISOString(),
        purpose: 'pass_top_up',
      },
    });

    return this.toServerChallengeView(nextChallenge, code);
  }

  private toServerChallengeView(
    challenge: {
      id: string;
      serverId: string;
      expiresAt: Date;
    },
    code: string,
  ) {
    return {
      id: challenge.id,
      serverId: challenge.serverId,
      code,
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  private toTopUpRequestView(request: WalletTopUpRequestSnapshot) {
    return {
      id: request.id,
      status: request.status,
      sourcePassId: request.sourcePassId,
      targetPassId: request.targetPassId,
      value: request.value,
      verificationMethod: request.verificationMethod,
      expiresAt: request.expiresAt?.toISOString() ?? null,
    };
  }

  private toTopUpRequestViewFromRecord(request: {
    id: string;
    status: PassTopUpStatus;
    sourcePassId: string;
    targetPassId: string;
    requestedValue: { toString(): string };
    verificationMethod: VerificationMethod;
    expiresAt: Date | null;
  }) {
    return {
      id: request.id,
      status: request.status,
      sourcePassId: request.sourcePassId,
      targetPassId: request.targetPassId,
      value: request.requestedValue.toString(),
      verificationMethod: request.verificationMethod,
      expiresAt: request.expiresAt?.toISOString() ?? null,
    };
  }

  private toTopUpHistoryItem(
    request: Prisma.PassTopUpRequestGetPayload<{
      include: {
        sourcePass: {
          include: {
            provider: true;
            template: true;
            templateVersion: true;
          };
        };
        targetPass: {
          include: {
            provider: true;
            template: true;
            templateVersion: true;
          };
        };
      };
    }>,
  ) {
    return {
      id: request.id,
      status: request.status,
      value: request.requestedValue.toString(),
      verificationMethod: request.verificationMethod,
      note: request.note,
      actionLinkId: request.actionLinkId,
      sourceLedgerEntryId: request.sourceLedgerEntryId,
      targetLedgerEntryId: request.targetLedgerEntryId,
      failureCode: request.failureCode,
      failureMessage: request.failureMessage,
      expiresAt: request.expiresAt?.toISOString() ?? null,
      completedAt: request.completedAt?.toISOString() ?? null,
      cancelledAt: request.cancelledAt?.toISOString() ?? null,
      reversedAt: request.reversedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      sourcePass: this.toWalletPassSummary(request.sourcePass),
      targetPass: this.toWalletPassSummary(request.targetPass),
    };
  }

  private toTopUpRequestSnapshotFromRecord(request: {
    id: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    sourceProviderId: string;
    providerId: string;
    requestedValue: { toString(): string };
    verificationMethod: VerificationMethod;
    status: PassTopUpStatus;
    expiresAt: Date | null;
  }): WalletTopUpRequestSnapshot {
    return {
      id: request.id,
      userId: request.userId,
      sourcePassId: request.sourcePassId,
      targetPassId: request.targetPassId,
      sourceProviderId: request.sourceProviderId,
      providerId: request.providerId,
      benefitType: 'amount',
      value: request.requestedValue.toString(),
      verificationMethod: request.verificationMethod,
      status: request.status,
      expiresAt: request.expiresAt,
    };
  }

  private createReadableCode(): string {
    return `LDPASS-${randomInt(100000, 1000000)}`;
  }

  private async readLatestChatId(): Promise<number> {
    const messages = await this.fetchChatMessagesOrThrow();
    return messages.reduce(
      (latest, message) => Math.max(latest, readBdslmChatMessageId(message)),
      -1,
    );
  }

  private async fetchChatMessagesOrThrow(start?: number) {
    try {
      return await this.bdslmClient.fetchChatMessages(start);
    } catch {
      throw new ServiceUnavailableException('暂时无法连接服务器聊天接口，请稍后再试。');
    }
  }

  private async readCompletedTopUpResult(topUpId: string) {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        reason: 'top_up',
        referenceType: 'pass_top_up',
        referenceId: topUpId,
      },
      include: {
        pass: {
          include: {
            provider: true,
            template: true,
            templateVersion: true,
          },
        },
      },
    });

    const sourceEntry = entries.find(
      (entry) => parseFixedDecimal(entry.changeValue.toString()) < 0n,
    );
    const targetEntry = entries.find(
      (entry) => parseFixedDecimal(entry.changeValue.toString()) > 0n,
    );

    if (!sourceEntry || !targetEntry) {
      return null;
    }

    return {
      topUp: {
        id: topUpId,
        value: targetEntry.changeValue.toString(),
        sourceLedgerEntryId: sourceEntry.id,
        targetLedgerEntryId: targetEntry.id,
      },
      sourcePass: this.toWalletPassSummary(sourceEntry.pass),
      targetPass: this.toWalletPassSummary(targetEntry.pass),
      ledgerEntry: {
        id: targetEntry.id,
        benefitType: targetEntry.benefitType,
        reason: targetEntry.reason,
        beforeValue: targetEntry.beforeValue.toString(),
        changeValue: targetEntry.changeValue.toString(),
        afterValue: targetEntry.afterValue.toString(),
        referenceType: targetEntry.referenceType,
        referenceId: targetEntry.referenceId,
        note: targetEntry.note,
        createdByType: targetEntry.createdByType,
        createdAt: targetEntry.createdAt.toISOString(),
      },
    };
  }

  private readonly passTransferInclude = {
    pass: {
      include: {
        provider: true,
        template: true,
        templateVersion: true,
      },
    },
    fromUser: {
      select: {
        id: true,
        username: true,
        email: true,
      },
    },
    toUser: {
      select: {
        id: true,
        username: true,
        email: true,
      },
    },
  } as const;

  private async expirePassTransfersForPass(passId: string): Promise<void> {
    await this.prisma.passTransfer.updateMany({
      where: {
        passId,
        status: 'Pending',
        expiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: 'Expired',
      },
    });
  }

  private async expireUserPassTransfers(userId: string): Promise<void> {
    await this.prisma.passTransfer.updateMany({
      where: {
        status: 'Pending',
        expiresAt: {
          lte: new Date(),
        },
        OR: [
          {
            fromUserId: userId,
          },
          {
            toUserId: userId,
          },
        ],
      },
      data: {
        status: 'Expired',
      },
    });
  }

  private async markPassTransferExpired(transferId: string): Promise<void> {
    await this.prisma.passTransfer.update({
      where: {
        id: transferId,
      },
      data: {
        status: 'Expired',
      },
    });
  }

  private async findReceivedPendingTransfer(userId: string, transferId: string) {
    const transfer = await this.prisma.passTransfer.findFirst({
      where: {
        id: transferId,
        toUserId: userId,
        status: 'Pending',
      },
      include: this.passTransferInclude,
    });

    if (!transfer) {
      throw new NotFoundException('待处理的转赠请求不存在。');
    }

    return transfer;
  }

  private async resolvePassTransfer(
    transferId: string,
    status: 'Rejected' | 'Cancelled',
    reason?: string,
  ) {
    return this.prisma.passTransfer.update({
      where: {
        id: transferId,
      },
      data: {
        status,
        responseReason: reason?.trim() || null,
        respondedAt: new Date(),
      },
      include: this.passTransferInclude,
    });
  }

  private toPassTransferView(transfer: Awaited<ReturnType<WalletService['resolvePassTransfer']>>) {
    return {
      id: transfer.id,
      status: transfer.status,
      note: transfer.note,
      responseReason: transfer.responseReason,
      expiresAt: transfer.expiresAt.toISOString(),
      respondedAt: transfer.respondedAt?.toISOString() ?? null,
      createdAt: transfer.createdAt.toISOString(),
      updatedAt: transfer.updatedAt.toISOString(),
      fromUser: {
        id: transfer.fromUser.id,
        username: transfer.fromUser.username,
        email: transfer.fromUser.email,
      },
      toUser: {
        id: transfer.toUser.id,
        username: transfer.toUser.username,
        email: transfer.toUser.email,
      },
      pass: {
        id: transfer.pass.id,
        providerName: transfer.pass.provider.name,
        displayName:
          readVersionDisplayName(transfer.pass.templateVersion.fields) ??
          transfer.pass.template.displayName,
        title: transfer.pass.templateVersion.title,
        hideTitle: readVersionHideTitle(transfer.pass.templateVersion.fields),
        allowTopUpIn: readAllowTopUpIn(transfer.pass.templateVersion.rules),
        allowTopUpOut: readAllowTopUpOut(transfer.pass.templateVersion.rules),
        category: transfer.pass.template.category,
        benefitType: transfer.pass.template.benefitType,
        status: transfer.pass.status,
        maskedNumber: transfer.pass.maskedNumber,
        backgroundImageUrl: transfer.pass.templateVersion.backgroundImageUrl,
        balanceValue: transfer.pass.balanceValue.toString(),
      },
    };
  }

  private toWalletPassSummary(
    pass: Awaited<ReturnType<WalletService['listWalletPassRecords']>>[number],
  ) {
    return {
      id: pass.id,
      providerName: pass.provider.name,
      displayName: readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName,
      title: pass.templateVersion.title,
      hideTitle: readVersionHideTitle(pass.templateVersion.fields),
      allowTopUpIn: readAllowTopUpIn(pass.templateVersion.rules),
      allowTopUpOut: readAllowTopUpOut(pass.templateVersion.rules),
      category: pass.template.category,
      benefitType: pass.template.benefitType,
      status: pass.status,
      maskedNumber: pass.maskedNumber,
      backgroundImageUrl: pass.templateVersion.backgroundImageUrl,
      balanceValue: pass.balanceValue.toString(),
      frozenValue: pass.frozenValue.toString(),
      overdraftLimit: pass.overdraftLimit.toString(),
      expiresAt: pass.expiresAt?.toISOString() ?? null,
      sortOrder: pass.sortOrder,
      updatedAt: pass.updatedAt.toISOString(),
    };
  }

  private toWalletLedgerEntry(entry: {
    id: string;
    benefitType: string;
    reason: string;
    beforeValue: { toString(): string };
    changeValue: { toString(): string };
    afterValue: { toString(): string };
    referenceType: string | null;
    referenceId: string | null;
    note: string | null;
    createdByType: string;
    createdAt: Date;
  }) {
    return {
      id: entry.id,
      benefitType: entry.benefitType,
      reason: entry.reason,
      beforeValue: entry.beforeValue.toString(),
      changeValue: entry.changeValue.toString(),
      afterValue: entry.afterValue.toString(),
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      note: entry.note,
      createdByType: entry.createdByType,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}

function readTake(value: string | undefined, fallback: number, max: number): number {
  const parsedValue = Number.parseInt(value ?? String(fallback), 10);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(Math.max(parsedValue, 1), max);
}

export interface TicketInfo {
  eventName: string | null;
  venue: string | null;
  startsAt: string | null;
  seatLabel: string | null;
  checkInStatus: 'not_checked_in' | 'checked_in' | 'voided';
  changeStatus: 'none' | 'rescheduled' | 'cancelled';
}

function readTicketInfo(metadata: unknown): TicketInfo | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const ticketInfo = (metadata as { ticketInfo?: unknown }).ticketInfo;
  if (!ticketInfo || typeof ticketInfo !== 'object' || Array.isArray(ticketInfo)) {
    return null;
  }

  const candidate = ticketInfo as Record<string, unknown>;

  return {
    eventName:
      typeof candidate.eventName === 'string' && candidate.eventName.trim()
        ? candidate.eventName
        : null,
    venue: typeof candidate.venue === 'string' && candidate.venue.trim() ? candidate.venue : null,
    startsAt:
      typeof candidate.startsAt === 'string' && candidate.startsAt.trim()
        ? candidate.startsAt
        : null,
    seatLabel:
      typeof candidate.seatLabel === 'string' && candidate.seatLabel.trim()
        ? candidate.seatLabel
        : null,
    checkInStatus: readCheckInStatus(candidate.checkInStatus),
    changeStatus: readChangeStatus(candidate.changeStatus),
  };
}

function readCheckInStatus(value: unknown): TicketInfo['checkInStatus'] {
  return value === 'checked_in' || value === 'voided' ? value : 'not_checked_in';
}

function readChangeStatus(value: unknown): TicketInfo['changeStatus'] {
  return value === 'rescheduled' || value === 'cancelled' ? value : 'none';
}

function readTransferableRule(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { transferable?: unknown }).transferable === true;
}

function readAllowTopUpIn(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { allowTopUpIn?: unknown }).allowTopUpIn === true;
}

function readAllowTopUpOut(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { allowTopUpOut?: unknown }).allowTopUpOut === true;
}

export interface LocationRules {
  version: 1;
  rules: LocationRangeRule[];
}

function readLocationRules(value: unknown): LocationRules | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !Array.isArray(candidate.rules)) {
    return null;
  }

  const rules = candidate.rules
    .map(readLocationRule)
    .filter((rule): rule is LocationRangeRule => rule !== null);

  return rules.length
    ? {
        version: 1,
        rules,
      }
    : null;
}

function readLocationRule(value: unknown): LocationRangeRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : null;
  const label =
    typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label : null;
  const expiresAfterSeconds = readFiniteNumber(candidate.expiresAfterSeconds);

  if (
    !id ||
    !label ||
    !expiresAfterSeconds ||
    expiresAfterSeconds < 10 ||
    expiresAfterSeconds > 300
  ) {
    return null;
  }

  if (candidate.kind === 'circle') {
    const centerX = readFiniteNumber(candidate.centerX);
    const centerZ = readFiniteNumber(candidate.centerZ);
    const radius = readFiniteNumber(candidate.radius);

    if (centerX === null || centerZ === null || radius === null || radius <= 0) {
      return null;
    }

    return {
      id,
      kind: 'circle',
      label,
      centerX,
      centerZ,
      radius,
      expiresAfterSeconds,
    };
  }

  if (candidate.kind === 'rectangle') {
    const minX = readFiniteNumber(candidate.minX);
    const maxX = readFiniteNumber(candidate.maxX);
    const minZ = readFiniteNumber(candidate.minZ);
    const maxZ = readFiniteNumber(candidate.maxZ);

    if (
      minX === null ||
      maxX === null ||
      minZ === null ||
      maxZ === null ||
      minX > maxX ||
      minZ > maxZ
    ) {
      return null;
    }

    return {
      id,
      kind: 'rectangle',
      label,
      minX,
      maxX,
      minZ,
      maxZ,
      expiresAfterSeconds,
    };
  }

  return null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const decimalScale = 1_000_000n;

function canConsumeValue(
  balanceValue: string,
  frozenValue: string,
  overdraftLimit: string,
  requestedValue: string,
): boolean {
  const availableValue =
    parseFixedDecimal(balanceValue) -
    parseFixedDecimal(frozenValue) +
    parseFixedDecimal(overdraftLimit);
  return availableValue >= parseFixedDecimal(requestedValue);
}

function subtractDecimalStrings(firstValue: string, secondValue: string): string {
  const result = parseFixedDecimal(firstValue) - parseFixedDecimal(secondValue);
  return formatFixedDecimal(result);
}

function addDecimalStrings(firstValue: string, secondValue: string): string {
  const result = parseFixedDecimal(firstValue) + parseFixedDecimal(secondValue);
  return formatFixedDecimal(result);
}

function normalizePositiveDecimal(value: string, message: string): string {
  const parsedValue = parseFixedDecimal(value);
  if (parsedValue <= 0n) {
    throw new BadRequestException(message);
  }

  return formatFixedDecimal(parsedValue);
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

function isMarkerInLocationRule(
  x: BdslmPlayerMarker['x'],
  z: BdslmPlayerMarker['z'],
  rule: LocationRangeRule,
): boolean {
  if (rule.kind === 'circle') {
    if (
      typeof rule.centerX !== 'number' ||
      typeof rule.centerZ !== 'number' ||
      typeof rule.radius !== 'number' ||
      rule.radius <= 0
    ) {
      return false;
    }

    return Math.hypot(x - rule.centerX, z - rule.centerZ) <= rule.radius;
  }

  if (
    typeof rule.minX !== 'number' ||
    typeof rule.maxX !== 'number' ||
    typeof rule.minZ !== 'number' ||
    typeof rule.maxZ !== 'number'
  ) {
    return false;
  }

  return x >= rule.minX && x <= rule.maxX && z >= rule.minZ && z <= rule.maxZ;
}

function readVersionDisplayName(value: Prisma.JsonValue): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const primary = (value as { primary?: unknown }).primary;
  return typeof primary === 'string' && primary.trim().length > 0 ? primary.trim() : null;
}

function readVersionHideTitle(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { hideTitle?: unknown }).hideTitle === true;
}
