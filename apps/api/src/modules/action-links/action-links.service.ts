import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { BenefitType, PassTopUpStatus, VerificationMethod } from '@ldpass/contracts';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import {
  readBdslmChatContent,
  readBdslmChatMessageId,
  readBdslmChatSender,
} from '../../shared/bdslm/chat-message.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { BdslmClientService } from '../bdslm/bdslm-client.service.js';
import type {
  BatchRevokeWalletActionLinksDto,
  ConfirmWalletActionLinkWithPinDto,
  ConfirmWalletActionLinkWithServerDto,
  CreateWalletActionLinkDto,
  RevokeWalletActionLinkDto,
  StartWalletActionLinkServerRedemptionDto,
  WalletActionLinkQueryDto,
} from './dto.js';

const decimalScale = 1_000_000n;
const defaultActionLinkExpiresInSeconds = 15 * 60;
const serverConfirmationTtlMs = 10 * 60 * 1000;
const walletActionTopUpReferencePrefix = 'wallet-action-top-up:';

const actionLinkPayload = {
  include: {
    provider: true,
    targetPass: {
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
    consumedByUser: {
      select: {
        id: true,
        username: true,
        email: true,
      },
    },
  },
} satisfies Prisma.WalletActionLinkDefaultArgs;

type WalletActionLinkRecord = Prisma.WalletActionLinkGetPayload<typeof actionLinkPayload>;

interface ActionLinkTopUpRequestSnapshot {
  id: string;
  userId: string;
  sourcePassId: string;
  targetPassId: string;
  actionLinkId: string;
  sourceProviderId: string;
  providerId: string;
  benefitType: BenefitType;
  value: string;
  verificationMethod: VerificationMethod;
  status: PassTopUpStatus;
  expiresAt?: Date | null;
}

@Injectable()
export class ActionLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretHash: SecretHashService,
    private readonly bdslmClient: BdslmClientService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async createProviderActionLink(
    dto: CreateWalletActionLinkDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    const value = normalizePositiveDecimal(dto.requestedValue, '链接数值必须大于 0。');

    const targetPass = await this.prisma.pass.findFirst({
      where: {
        id: dto.targetPassId,
        providerId: providerAccount.providerId,
        archivedAt: null,
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

    if (!targetPass) {
      throw new NotFoundException('目标卡券不存在或不属于当前发卡方。');
    }

    if (!targetPass.userId || !targetPass.user) {
      throw new BadRequestException('目标卡券尚未被用户领取，不能生成操作链接。');
    }

    if (dto.kind === 'use') {
      if (targetPass.status !== 'Added' && targetPass.status !== 'Active') {
        throw new BadRequestException('当前卡券状态不能生成消耗链接。');
      }

      if (
        !canConsumeValue(
          targetPass.balanceValue.toString(),
          targetPass.frozenValue.toString(),
          targetPass.overdraftLimit.toString(),
          value,
        )
      ) {
        throw new BadRequestException('当前卡券可用额度不足，不能生成该消耗链接。');
      }
    }

    if (dto.kind === 'top_up') {
      if (targetPass.status !== 'Active') {
        throw new BadRequestException('只有正常可用的卡券可以作为额度补充目标。');
      }

      if (!readAllowTopUpIn(targetPass.templateVersion.rules)) {
        throw new BadRequestException('目标卡的发行方未开放额度补充。');
      }
    }

    const token = createActionToken();
    const expiresAt = new Date(
      Date.now() + 1000 * (dto.expiresInSeconds ?? defaultActionLinkExpiresInSeconds),
    );
    const actionLink = await this.prisma.walletActionLink.create({
      data: {
        tokenHash: hashActionToken(token),
        kind: dto.kind,
        providerId: providerAccount.providerId,
        targetPassId: targetPass.id,
        requestedValue: value,
        verificationMethod: dto.verificationMethod,
        note: dto.note?.trim() || null,
        expiresAt,
        createdByType: 'provider',
        createdById: providerAccount.id,
      },
      include: this.actionLinkInclude(),
    });

    await this.eventBus.publish({
      type: 'WalletActionLinkCreated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        actionLinkId: actionLink.id,
        providerId: actionLink.providerId,
        targetPassId: actionLink.targetPassId,
        kind: actionLink.kind,
        value,
        verificationMethod: actionLink.verificationMethod,
        expiresAt: actionLink.expiresAt.toISOString(),
      },
    });

    return {
      actionLink: this.toProviderActionLink(actionLink, token),
    };
  }

  async listProviderActionLinks(
    query: WalletActionLinkQueryDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedActionLinks(providerAccount.providerId);

    const actionLinks = await this.prisma.walletActionLink.findMany({
      where: {
        providerId: providerAccount.providerId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.targetPassId ? { targetPassId: query.targetPassId } : {}),
      },
      include: this.actionLinkInclude(),
      orderBy: {
        createdAt: 'desc',
      },
      take: readTake(query.take),
    });

    return {
      actionLinks: actionLinks.map((actionLink) => this.toProviderActionLinkSummary(actionLink)),
    };
  }

  async revokeProviderActionLink(
    actionLinkId: string,
    dto: RevokeWalletActionLinkDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedActionLinks(providerAccount.providerId);

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('撤销原因不能为空。');
    }

    const actionLink = await this.prisma.walletActionLink.findFirst({
      where: {
        id: actionLinkId,
        providerId: providerAccount.providerId,
      },
      include: this.actionLinkInclude(),
    });

    if (!actionLink) {
      throw new NotFoundException('操作链接不存在或不属于当前发卡方。');
    }

    if (actionLink.status === 'Revoked') {
      return {
        actionLink: this.toProviderActionLinkSummary(actionLink),
      };
    }

    if (actionLink.status !== 'Active') {
      throw new BadRequestException('只有尚未使用且未过期的操作链接可以撤销。');
    }

    const revokedLink = await this.prisma.walletActionLink.update({
      where: {
        id: actionLink.id,
      },
      data: {
        status: 'Revoked',
        revokedAt: new Date(),
        revokedByType: 'provider',
        revokedById: providerAccount.id,
        revokeReason: reason,
      },
      include: this.actionLinkInclude(),
    });

    await this.publishActionLinkRevoked(revokedLink, providerAccount.id, reason, new Date());
    await this.cancelOpenTopUpRequestsForActionLink(
      revokedLink,
      reason,
      'provider',
      providerAccount.id,
      new Date(),
    );

    return {
      actionLink: this.toProviderActionLinkSummary(revokedLink),
    };
  }

  async batchRevokeProviderActionLinks(
    dto: BatchRevokeWalletActionLinksDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedActionLinks(providerAccount.providerId);

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('撤销原因不能为空。');
    }

    const actionLinkIds = [...new Set(dto.actionLinkIds)];
    if (!actionLinkIds.length) {
      throw new BadRequestException('请选择要撤销的操作链接。');
    }

    const actionLinks = await this.prisma.walletActionLink.findMany({
      where: {
        id: {
          in: actionLinkIds,
        },
        providerId: providerAccount.providerId,
      },
      include: this.actionLinkInclude(),
    });

    const actionLinkMap = new Map(actionLinks.map((actionLink) => [actionLink.id, actionLink]));
    const activeActionLinks = actionLinks.filter((actionLink) => actionLink.status === 'Active');
    const skippedActionLinks = actionLinkIds
      .map((actionLinkId) => actionLinkMap.get(actionLinkId))
      .filter((actionLink): actionLink is WalletActionLinkRecord => Boolean(actionLink))
      .filter((actionLink) => actionLink.status !== 'Active');

    if (!activeActionLinks.length) {
      return {
        revokedActionLinks: [],
        skippedActionLinks: skippedActionLinks.map((actionLink) =>
          this.toProviderActionLinkSummary(actionLink),
        ),
        notFoundActionLinkIds: actionLinkIds.filter(
          (actionLinkId) => !actionLinkMap.has(actionLinkId),
        ),
      };
    }

    const now = new Date();
    await this.prisma.walletActionLink.updateMany({
      where: {
        id: {
          in: activeActionLinks.map((actionLink) => actionLink.id),
        },
        providerId: providerAccount.providerId,
        status: 'Active',
      },
      data: {
        status: 'Revoked',
        revokedAt: now,
        revokedByType: 'provider',
        revokedById: providerAccount.id,
        revokeReason: reason,
      },
    });

    const revokedActionLinks = await this.prisma.walletActionLink.findMany({
      where: {
        id: {
          in: activeActionLinks.map((actionLink) => actionLink.id),
        },
        providerId: providerAccount.providerId,
      },
      include: this.actionLinkInclude(),
      orderBy: {
        createdAt: 'desc',
      },
    });

    for (const actionLink of revokedActionLinks) {
      await this.publishActionLinkRevoked(actionLink, providerAccount.id, reason, now);
      await this.cancelOpenTopUpRequestsForActionLink(
        actionLink,
        reason,
        'provider',
        providerAccount.id,
        now,
      );
    }

    return {
      revokedActionLinks: revokedActionLinks.map((actionLink) =>
        this.toProviderActionLinkSummary(actionLink),
      ),
      skippedActionLinks: skippedActionLinks.map((actionLink) =>
        this.toProviderActionLinkSummary(actionLink),
      ),
      notFoundActionLinkIds: actionLinkIds.filter(
        (actionLinkId) => !actionLinkMap.has(actionLinkId),
      ),
    };
  }

  async previewWalletActionLink(token: string, user: AuthenticatedUser) {
    const actionLink = await this.readActiveActionLinkForUser(token, user);
    const sourcePasses =
      actionLink.kind === 'top_up'
        ? await this.prisma.pass.findMany({
            where: {
              userId: user.id,
              archivedAt: null,
              status: 'Active',
              id: {
                not: actionLink.targetPassId,
              },
            },
            include: {
              provider: true,
              template: true,
              templateVersion: true,
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 50,
          })
        : [];

    return {
      actionLink: this.toWalletActionLink(actionLink),
      targetPass: this.toWalletPass(actionLink.targetPass),
      sourcePasses: sourcePasses
        .filter(
          (pass) =>
            pass.template.benefitType === actionLink.targetPass.template.benefitType &&
            readAllowTopUpOut(pass.templateVersion.rules),
        )
        .map((pass) => this.toWalletPass(pass)),
    };
  }

  async confirmWalletActionLinkWithPin(
    dto: ConfirmWalletActionLinkWithPinDto,
    user: AuthenticatedUser,
  ) {
    const actionLink = await this.readActiveActionLinkForUser(dto.token, user);

    if (actionLink.verificationMethod !== 'pin') {
      throw new BadRequestException('该链接需要使用服务器账号确认。');
    }

    if (actionLink.kind === 'use') {
      await this.verifyUserPin(user, dto.pin, actionLink.id, 'pass_use');
      return this.confirmUseActionLink(actionLink, user);
    }

    if (!dto.sourcePassId) {
      throw new BadRequestException('额度补充链接需要选择来源卡。');
    }

    const now = new Date();
    const topUpRequest = await this.createActionLinkTopUpRequest(
      actionLink,
      user,
      dto.sourcePassId,
      'pin',
      'Created',
      now,
      actionLink.expiresAt,
    );

    try {
      await this.verifyUserPin(user, dto.pin, topUpRequest.id, 'pass_top_up');
      return this.confirmTopUpActionLink(actionLink, user, dto.sourcePassId, topUpRequest);
    } catch (error) {
      await this.failActionLinkTopUpRequest(topUpRequest, error);
      throw error;
    }
  }

  async startServerConfirmationForActionLink(
    dto: StartWalletActionLinkServerRedemptionDto,
    user: AuthenticatedUser,
  ) {
    const actionLink = await this.readActiveActionLinkForUser(dto.token, user);

    if (actionLink.verificationMethod !== 'server_account') {
      throw new BadRequestException('该链接不需要服务器账号确认。');
    }

    this.ensureUserCanUseServerConfirmation(user);

    if (actionLink.kind === 'use') {
      const redemptionRequest = await this.createOrReadRedemptionRequestForActionLink(
        actionLink,
        user,
      );

      return {
        mode: 'redemption',
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
      };
    }

    if (!dto.sourcePassId) {
      throw new BadRequestException('额度补充链接需要选择来源卡。');
    }

    const now = new Date();
    const expiresAt = new Date(
      Math.min(actionLink.expiresAt.getTime(), now.getTime() + serverConfirmationTtlMs),
    );
    const topUpRequest = await this.createActionLinkTopUpRequest(
      actionLink,
      user,
      dto.sourcePassId,
      'server_account',
      'WaitingVerification',
      now,
      expiresAt,
    );
    const challenge = await this.createTopUpServerChallenge(
      user.id,
      user.serverAccountName ?? '',
      topUpRequest.id,
      'manual_refresh',
      expiresAt,
    );

    return {
      mode: 'top_up',
      actionLink: this.toWalletActionLink(actionLink),
      targetPass: this.toWalletPass(actionLink.targetPass),
      sourcePassId: dto.sourcePassId,
      topUpRequest: this.toTopUpRequestView(topUpRequest),
      challenge,
    };
  }

  async completeServerRedemptionForActionLink(
    token: string,
    redemptionRequestId: string,
    user: AuthenticatedUser,
  ) {
    const actionLink = await this.readActionLinkForUser(token, user);

    if (actionLink.kind !== 'use') {
      throw new BadRequestException('额度补充链接第一版仅支持 PIN 确认。');
    }

    const redemptionRequest = await this.prisma.redemptionRequest.findFirst({
      where: {
        id: redemptionRequestId,
        userId: user.id,
        passId: actionLink.targetPassId,
        idempotencyKey: this.useRedemptionIdempotencyKey(actionLink.id),
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

    if (!redemptionRequest) {
      throw new NotFoundException('没有找到该链接对应的服务器确认请求。');
    }

    if (redemptionRequest.status !== 'Succeeded') {
      throw new BadRequestException('服务器确认尚未完成。');
    }

    const consumedLink = await this.consumeActionLink(
      actionLink,
      user,
      'redemption_request',
      redemptionRequest.id,
    );

    return {
      status: 'consumed',
      actionLink: this.toWalletActionLink(consumedLink),
      targetPass: this.toWalletPass(redemptionRequest.pass),
      redemptionRequest: this.toRedemptionRequest(redemptionRequest),
    };
  }

  async confirmTopUpActionLinkWithServer(
    dto: ConfirmWalletActionLinkWithServerDto,
    user: AuthenticatedUser,
  ) {
    const actionLink = await this.readActiveActionLinkForUser(dto.token, user);

    if (actionLink.kind !== 'top_up') {
      throw new BadRequestException('只有额度补充链接可以使用这个确认入口。');
    }

    if (actionLink.verificationMethod !== 'server_account') {
      throw new BadRequestException('该链接不需要服务器账号确认。');
    }

    this.ensureUserCanUseServerConfirmation(user);

    const challenge = await this.prisma.serverVerificationChallenge.findFirst({
      where: {
        id: dto.challengeId,
        userId: user.id,
        purpose: 'pass_top_up',
        referenceType: 'wallet_action_top_up',
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
        actionLinkId: actionLink.id,
      },
    });

    if (!topUpRequest) {
      throw new BadRequestException('额度补充请求不存在，请重新获取验证码。');
    }

    this.assertTopUpRequestMatchesInput(topUpRequest, actionLink, dto.sourcePassId);

    if (challenge.serverId !== user.serverAccountName) {
      throw new BadRequestException('服务器账号确认验证码与当前绑定账号不匹配，请重新获取。');
    }

    if (topUpRequest.status === 'Succeeded') {
      return {
        status: 'verified',
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (topUpRequest.status === 'Cancelled') {
      return {
        status: 'cancelled',
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (topUpRequest.status === 'Expired') {
      return {
        status: 'expired',
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (topUpRequest.status === 'Failed') {
      return {
        status: 'failed',
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (challenge.status !== 'active') {
      return {
        status: challenge.status === 'verified' ? 'verified' : 'waiting',
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
        topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
      };
    }

    if (challenge.expiresAt <= new Date()) {
      await this.expireActionLinkTopUpRequest(topUpRequest, new Date());
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
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
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
        await this.prisma.serverVerificationChallenge.update({
          where: {
            id: challenge.id,
          },
          data: {
            status: 'verified',
            lastCheckedChatId: nextLastCheckedChatId,
          },
        });

        let result;
        try {
          result = await this.confirmTopUpActionLink(
            actionLink,
            user,
            dto.sourcePassId,
            this.toActionTopUpRequestSnapshotFromRecord(topUpRequest),
          );
        } catch (error) {
          await this.failActionLinkTopUpRequest(
            this.toActionTopUpRequestSnapshotFromRecord(topUpRequest),
            error,
          );
          throw error;
        }
        return {
          ...result,
          status: 'verified',
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
        actionLink: this.toWalletActionLink(actionLink),
        targetPass: this.toWalletPass(actionLink.targetPass),
        topUpRequest: {
          ...this.toTopUpRequestViewFromRecord(topUpRequest),
          expiresAt: rotatedChallenge.expiresAt,
        },
        challenge: rotatedChallenge,
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
      actionLink: this.toWalletActionLink(actionLink),
      targetPass: this.toWalletPass(actionLink.targetPass),
      topUpRequest: this.toTopUpRequestViewFromRecord(topUpRequest),
    };
  }

  async cancelTopUpActionLinkRequest(
    user: AuthenticatedUser,
    topUpId: string,
    reason?: string,
  ) {
    const topUpRequest = await this.prisma.passTopUpRequest.findFirst({
      where: {
        id: topUpId,
        userId: user.id,
        actionLinkId: {
          not: null,
        },
      },
    });

    if (!topUpRequest) {
      throw new NotFoundException('额度补充链接请求不存在。');
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
      throw new BadRequestException('失败或过期的额度补充链接请求不能取消。');
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
          referenceType: 'wallet_action_top_up',
          referenceId: this.topUpChallengeReferenceId(topUpRequest.id),
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
        ...(topUpRequest.actionLinkId ? { actionLinkId: topUpRequest.actionLinkId } : {}),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      },
    });

    return {
      topUpRequest: this.toTopUpRequestViewFromRecord(updated),
    };
  }

  private async confirmUseActionLink(actionLink: WalletActionLinkRecord, user: AuthenticatedUser) {
    const redemptionRequest = await this.createOrReadRedemptionRequestForActionLink(
      actionLink,
      user,
    );

    if (redemptionRequest.status === 'Succeeded') {
      const consumedLink = await this.consumeActionLink(
        actionLink,
        user,
        'redemption_request',
        redemptionRequest.id,
      );
      return {
        status: 'succeeded',
        actionLink: this.toWalletActionLink(consumedLink),
        targetPass: this.toWalletPass(redemptionRequest.pass),
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
        ledgerEntry: null,
      };
    }

    if (redemptionRequest.status !== 'WaitingVerification') {
      throw new BadRequestException('该链接对应的消耗请求已经处理或失效。');
    }

    if (redemptionRequest.expiresAt <= new Date()) {
      await this.prisma.redemptionRequest.update({
        where: {
          id: redemptionRequest.id,
        },
        data: {
          status: 'Expired',
          failureCode: 'EXPIRED',
          failureMessage: '核销请求已过期。',
        },
      });
      throw new BadRequestException('该链接对应的消耗请求已过期。');
    }

    const requestedValue = normalizePositiveDecimal(
      redemptionRequest.requestedValue?.toString() ?? '0',
    );
    const beforeValue = redemptionRequest.pass.balanceValue.toString();
    const afterValue = subtractDecimalStrings(beforeValue, requestedValue);

    if (
      !canConsumeValue(
        redemptionRequest.pass.balanceValue.toString(),
        redemptionRequest.pass.frozenValue.toString(),
        redemptionRequest.pass.overdraftLimit.toString(),
        requestedValue,
      )
    ) {
      await this.prisma.redemptionRequest.update({
        where: {
          id: redemptionRequest.id,
        },
        data: {
          status: 'Failed',
          failureCode: 'INSUFFICIENT_BALANCE',
          failureMessage: '余额或权益不足，无法完成本次消耗。',
        },
      });
      throw new BadRequestException('余额或权益不足，无法完成本次消耗。');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const updatedPass = await tx.pass.update({
        where: {
          id: redemptionRequest.passId,
        },
        data: {
          balanceValue: afterValue,
          status: compareDecimalStrings(afterValue, '0') <= 0 ? 'UsedUp' : 'Active',
        },
        include: {
          provider: true,
          template: true,
          templateVersion: true,
        },
      });

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          passId: redemptionRequest.passId,
          userId: user.id,
          providerId: redemptionRequest.providerId,
          benefitType: redemptionRequest.pass.template.benefitType,
          reason: 'use',
          beforeValue,
          changeValue: `-${requestedValue}`,
          afterValue,
          idempotencyKey: `action-link-use-ledger:${actionLink.id}`,
          referenceType: 'WalletActionLink',
          referenceId: actionLink.id,
          note: actionLink.note ? `通过链接确认消耗：${actionLink.note}` : '通过链接确认消耗权益。',
          createdByType: 'user',
          createdById: user.id,
          createdAt: now,
        },
      });

      const updatedRequest = await tx.redemptionRequest.update({
        where: {
          id: redemptionRequest.id,
        },
        data: {
          status: 'Succeeded',
          failureCode: null,
          failureMessage: null,
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

      const consumedLink = await tx.walletActionLink.update({
        where: {
          id: actionLink.id,
        },
        data: {
          status: 'Consumed',
          consumedByUserId: user.id,
          consumedAt: now,
        },
        include: this.actionLinkInclude(),
      });

      return {
        consumedLink,
        ledgerEntry,
        pass: updatedPass,
        redemptionRequest: updatedRequest,
      };
    });

    await this.publishUseSucceededEvents({
      actionLink: result.consumedLink,
      redemptionRequestId: result.redemptionRequest.id,
      ledgerEntryId: result.ledgerEntry.id,
      userId: user.id,
      beforeValue,
      afterValue,
      requestedValue,
      benefitType: result.pass.template.benefitType,
    });

    return {
      status: 'succeeded',
      actionLink: this.toWalletActionLink(result.consumedLink),
      targetPass: this.toWalletPass(result.pass),
      redemptionRequest: this.toRedemptionRequest(result.redemptionRequest),
      ledgerEntry: {
        id: result.ledgerEntry.id,
        beforeValue: result.ledgerEntry.beforeValue.toString(),
        changeValue: result.ledgerEntry.changeValue.toString(),
        afterValue: result.ledgerEntry.afterValue.toString(),
        reason: result.ledgerEntry.reason,
        note: result.ledgerEntry.note,
        createdAt: result.ledgerEntry.createdAt.toISOString(),
      },
    };
  }

  private async confirmTopUpActionLink(
    actionLink: WalletActionLinkRecord,
    user: AuthenticatedUser,
    sourcePassId: string,
    topUpRequest: ActionLinkTopUpRequestSnapshot,
  ) {
    const value = normalizePositiveDecimal(
      actionLink.requestedValue.toString(),
      '补充额度必须大于 0。',
    );

    if (sourcePassId === actionLink.targetPassId) {
      throw new BadRequestException('来源卡和目标卡不能相同。');
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const [targetPass, sourcePass] = await Promise.all([
        tx.pass.findFirst({
          where: {
            id: actionLink.targetPassId,
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

      const [
        updatedSourcePass,
        updatedTargetPass,
        sourceLedgerEntry,
        targetLedgerEntry,
        consumedLink,
      ] = await Promise.all([
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
            idempotencyKey: `action-link-top-up:${topUpRequest.id}:source`,
            referenceType: 'pass_top_up',
            referenceId: topUpRequest.id,
            note: actionLink.note
              ? `${actionLink.note}；用于链接额度补充`
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
            idempotencyKey: `action-link-top-up:${topUpRequest.id}:target`,
            referenceType: 'pass_top_up',
            referenceId: topUpRequest.id,
            note: actionLink.note
              ? `${actionLink.note}；来自链接额度补充`
              : `来自 ${sourcePass.template.displayName}`,
            createdByType: 'user',
            createdById: user.id,
            createdAt: now,
          },
        }),
        tx.walletActionLink.update({
          where: {
            id: actionLink.id,
          },
          data: {
            status: 'Consumed',
            consumedByUserId: user.id,
            consumedAt: now,
          },
          include: this.actionLinkInclude(),
        }),
      ]);

      await tx.passTopUpRequest.updateMany({
        where: {
          id: topUpRequest.id,
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
        consumedLink,
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

    await this.publishTopUpSucceededEvents({
      actionLink: result.consumedLink,
      topUpId: topUpRequest.id,
      userId: user.id,
      value,
      sourcePassId: result.sourcePass.id,
      targetPassId: result.targetPass.id,
      sourceProviderId: result.sourcePass.providerId,
      targetProviderId: result.targetPass.providerId,
      benefitType: result.targetPass.template.benefitType,
      sourceBeforeValue: result.sourceBeforeValue,
      sourceAfterValue: result.sourceAfterValue,
      targetBeforeValue: result.targetBeforeValue,
      targetAfterValue: result.targetAfterValue,
      sourceLedgerEntryId: result.sourceLedgerEntry.id,
      targetLedgerEntryId: result.targetLedgerEntry.id,
    });

    return {
      status: 'succeeded',
      actionLink: this.toWalletActionLink(result.consumedLink),
      sourcePass: this.toWalletPass(result.sourcePass),
      targetPass: this.toWalletPass(result.targetPass),
      topUp: {
        id: topUpRequest.id,
        status: 'Succeeded',
        value,
        sourceLedgerEntryId: result.sourceLedgerEntry.id,
        targetLedgerEntryId: result.targetLedgerEntry.id,
      },
      ledgerEntry: {
        id: result.targetLedgerEntry.id,
        benefitType: result.targetLedgerEntry.benefitType,
        reason: result.targetLedgerEntry.reason,
        beforeValue: result.targetLedgerEntry.beforeValue.toString(),
        changeValue: result.targetLedgerEntry.changeValue.toString(),
        afterValue: result.targetLedgerEntry.afterValue.toString(),
        note: result.targetLedgerEntry.note,
        createdAt: result.targetLedgerEntry.createdAt.toISOString(),
      },
    };
  }

  private async createActionLinkTopUpRequest(
    actionLink: WalletActionLinkRecord,
    user: AuthenticatedUser,
    sourcePassId: string,
    verificationMethod: VerificationMethod,
    status: Extract<PassTopUpStatus, 'Created' | 'WaitingVerification'>,
    now: Date,
    expiresAt: Date,
  ): Promise<ActionLinkTopUpRequestSnapshot> {
    const sourcePass = await this.readTopUpSourcePass(actionLink, user, sourcePassId);
    const value = normalizePositiveDecimal(
      actionLink.requestedValue.toString(),
      '补充额度必须大于 0。',
    );
    const request = await this.prisma.passTopUpRequest.create({
      data: {
        userId: user.id,
        sourcePassId: sourcePass.id,
        targetPassId: actionLink.targetPassId,
        actionLinkId: actionLink.id,
        sourceProviderId: sourcePass.providerId,
        providerId: actionLink.providerId,
        status,
        verificationMethod,
        requestedValue: value,
        note: actionLink.note,
        expiresAt,
        createdAt: now,
      },
    });

    const snapshot: ActionLinkTopUpRequestSnapshot = {
      id: request.id,
      userId: user.id,
      sourcePassId: sourcePass.id,
      targetPassId: actionLink.targetPassId,
      actionLinkId: actionLink.id,
      sourceProviderId: sourcePass.providerId,
      providerId: actionLink.providerId,
      benefitType: actionLink.targetPass.template.benefitType,
      value: request.requestedValue.toString(),
      verificationMethod: request.verificationMethod,
      status: request.status,
      expiresAt: request.expiresAt,
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
        actionLinkId: actionLink.id,
        providerId: snapshot.providerId,
        sourceProviderId: snapshot.sourceProviderId,
        benefitType: snapshot.benefitType,
        value: snapshot.value,
        verificationMethod,
        status,
        expiresAt: expiresAt.toISOString(),
      },
    });

    return snapshot;
  }

  private async readTopUpSourcePass(
    actionLink: WalletActionLinkRecord,
    user: AuthenticatedUser,
    sourcePassId: string,
  ) {
    if (sourcePassId === actionLink.targetPassId) {
      throw new BadRequestException('来源卡和目标卡不能相同。');
    }

    const sourcePass = await this.prisma.pass.findFirst({
      where: {
        id: sourcePassId,
        userId: user.id,
        archivedAt: null,
      },
      include: {
        template: true,
        templateVersion: true,
      },
    });

    if (!sourcePass) {
      throw new NotFoundException('来源卡券不存在、已归档或不属于当前用户。');
    }

    if (actionLink.targetPass.status !== 'Active' || sourcePass.status !== 'Active') {
      throw new BadRequestException('只有正常可用的卡券可以进行额度补充。');
    }

    if (actionLink.targetPass.template.benefitType !== sourcePass.template.benefitType) {
      throw new BadRequestException('来源卡和目标卡的权益类型必须一致。');
    }

    if (!readAllowTopUpIn(actionLink.targetPass.templateVersion.rules)) {
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
        actionLink.requestedValue.toString(),
      )
    ) {
      throw new BadRequestException('来源卡可用额度不足。');
    }

    return sourcePass;
  }

  private assertTopUpRequestMatchesInput(
    request: {
      sourcePassId: string;
      targetPassId: string;
      actionLinkId: string | null;
      requestedValue: { toString(): string };
    },
    actionLink: WalletActionLinkRecord,
    sourcePassId: string,
  ): void {
    if (
      request.actionLinkId !== actionLink.id ||
      request.targetPassId !== actionLink.targetPassId ||
      request.sourcePassId !== sourcePassId ||
      compareDecimalStrings(
        request.requestedValue.toString(),
        actionLink.requestedValue.toString(),
      ) !== 0
    ) {
      throw new BadRequestException('额度补充请求内容已变化，请重新获取服务器验证码。');
    }
  }

  private async failActionLinkTopUpRequest(
    request: ActionLinkTopUpRequestSnapshot,
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
        actionLinkId: request.actionLinkId,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        retryable: failure.retryable,
      },
    });
  }

  private async expireActionLinkTopUpRequest(
    request: {
      id: string;
      userId: string;
      sourcePassId: string;
      targetPassId: string;
      actionLinkId: string | null;
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
        ...(request.actionLinkId ? { actionLinkId: request.actionLinkId } : {}),
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

  private ensureUserCanUseServerConfirmation(user: AuthenticatedUser): void {
    if (!user.serverAccountVerified || !user.serverAccountName) {
      throw new UnauthorizedException('需要先在账户页完成服务器账号验证。');
    }
  }

  private async createTopUpServerChallenge(
    userId: string,
    serverId: string,
    topUpId: string,
    rotateReason: 'manual_refresh' | 'expired' | 'rate_limit_retry',
    expiresAt: Date,
  ) {
    const referenceId = this.topUpChallengeReferenceId(topUpId);
    const activeChallenges = await this.prisma.serverVerificationChallenge.findMany({
      where: {
        userId,
        purpose: 'pass_top_up',
        referenceType: 'wallet_action_top_up',
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
          referenceType: 'wallet_action_top_up',
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
        actorType: 'user',
        actorId: userId,
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
    const expiresAt = new Date(Date.now() + serverConfirmationTtlMs);
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
          referenceType: 'wallet_action_top_up',
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

  private toTopUpRequestView(request: ActionLinkTopUpRequestSnapshot) {
    return {
      id: request.id,
      status: request.status,
      sourcePassId: request.sourcePassId,
      targetPassId: request.targetPassId,
      actionLinkId: request.actionLinkId,
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
    actionLinkId: string | null;
    requestedValue: { toString(): string };
    verificationMethod: VerificationMethod;
    expiresAt: Date | null;
  }) {
    return {
      id: request.id,
      status: request.status,
      sourcePassId: request.sourcePassId,
      targetPassId: request.targetPassId,
      actionLinkId: request.actionLinkId,
      value: request.requestedValue.toString(),
      verificationMethod: request.verificationMethod,
      expiresAt: request.expiresAt?.toISOString() ?? null,
    };
  }

  private toActionTopUpRequestSnapshotFromRecord(request: {
    id: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId: string | null;
    sourceProviderId: string;
    providerId: string;
    requestedValue: { toString(): string };
    verificationMethod: VerificationMethod;
    status: PassTopUpStatus;
    expiresAt: Date | null;
  }): ActionLinkTopUpRequestSnapshot {
    return {
      id: request.id,
      userId: request.userId,
      sourcePassId: request.sourcePassId,
      targetPassId: request.targetPassId,
      actionLinkId: request.actionLinkId ?? '',
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

  private topUpChallengeReferenceId(topUpId: string): string {
    return `${walletActionTopUpReferencePrefix}${topUpId}`;
  }

  private readTopUpIdFromChallengeReferenceId(referenceId: string | null): string | null {
    if (!referenceId?.startsWith(walletActionTopUpReferencePrefix)) {
      return null;
    }

    return referenceId.slice(walletActionTopUpReferencePrefix.length) || null;
  }

  private async createOrReadRedemptionRequestForActionLink(
    actionLink: WalletActionLinkRecord,
    user: AuthenticatedUser,
  ) {
    const idempotencyKey = this.useRedemptionIdempotencyKey(actionLink.id);
    const existingRequest = await this.prisma.redemptionRequest.findUnique({
      where: {
        idempotencyKey,
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

    if (existingRequest) {
      if (
        existingRequest.userId !== user.id ||
        existingRequest.passId !== actionLink.targetPassId
      ) {
        throw new ConflictException('该链接对应的消耗请求已被其他上下文占用。');
      }

      return existingRequest;
    }

    if (actionLink.targetPass.status !== 'Added' && actionLink.targetPass.status !== 'Active') {
      throw new BadRequestException('当前卡券状态不能发起链接消耗。');
    }

    const expiresAt = new Date(Math.min(actionLink.expiresAt.getTime(), Date.now() + 1000 * 120));
    const redemptionRequest = await this.prisma.redemptionRequest.create({
      data: {
        passId: actionLink.targetPassId,
        userId: user.id,
        providerId: actionLink.providerId,
        status: 'WaitingVerification',
        verificationMethod: actionLink.verificationMethod,
        requestedValue: actionLink.requestedValue,
        idempotencyKey,
        expiresAt,
        maxVerificationAttempts: 3,
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

    await this.eventBus.publish({
      type: 'PassUseRequested',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        passId: actionLink.targetPassId,
        providerId: actionLink.providerId,
        requestId: redemptionRequest.id,
        amount: actionLink.requestedValue.toString(),
        verificationMethod: actionLink.verificationMethod,
        expiresAt: expiresAt.toISOString(),
        maxVerificationAttempts: 3,
      },
    });

    return redemptionRequest;
  }

  private async readActiveActionLinkForUser(token: string, user: AuthenticatedUser) {
    const actionLink = await this.readActionLinkForUser(token, user);

    if (actionLink.status === 'Consumed') {
      throw new BadRequestException('该操作链接已经被使用。');
    }

    if (actionLink.status === 'Revoked') {
      throw new BadRequestException('该操作链接已经被撤销。');
    }

    if (actionLink.status === 'Expired' || actionLink.expiresAt <= new Date()) {
      const expiredLink = await this.markActionLinkExpired(actionLink);
      throw new BadRequestException(`该操作链接已过期：${expiredLink.id}`);
    }

    return actionLink;
  }

  private async readActionLinkForUser(token: string, user: AuthenticatedUser) {
    const actionLink = await this.prisma.walletActionLink.findUnique({
      where: {
        tokenHash: hashActionToken(token),
      },
      include: this.actionLinkInclude(),
    });

    if (!actionLink) {
      throw new NotFoundException('操作链接不存在。');
    }

    if (actionLink.targetPass.userId !== user.id) {
      throw new ForbiddenException('该操作链接不属于当前登录用户。');
    }

    return actionLink;
  }

  private async verifyUserPin(
    user: AuthenticatedUser,
    pin: string,
    actionLinkId: string,
    purpose: 'pass_use' | 'pass_top_up',
  ) {
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
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        challengeId: actionLinkId,
        purpose,
      },
    });
  }

  private async consumeActionLink(
    actionLink: WalletActionLinkRecord,
    user: AuthenticatedUser,
    referenceType: 'redemption_request' | 'pass_top_up',
    referenceId: string,
  ) {
    if (actionLink.status === 'Consumed') {
      return actionLink;
    }

    const consumedLink = await this.prisma.walletActionLink.update({
      where: {
        id: actionLink.id,
      },
      data: {
        status: 'Consumed',
        consumedByUserId: user.id,
        consumedAt: new Date(),
      },
      include: this.actionLinkInclude(),
    });

    await this.publishActionLinkConsumed(consumedLink, user.id, referenceType, referenceId);
    return consumedLink;
  }

  private async markActionLinkExpired(actionLink: WalletActionLinkRecord) {
    if (actionLink.status === 'Expired') {
      return actionLink;
    }

    const expiredLink = await this.prisma.walletActionLink.update({
      where: {
        id: actionLink.id,
      },
      data: {
        status: 'Expired',
      },
      include: this.actionLinkInclude(),
    });

    await this.eventBus.publish({
      type: 'WalletActionLinkExpired',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: 'system',
      payload: {
        actionLinkId: expiredLink.id,
        providerId: expiredLink.providerId,
        targetPassId: expiredLink.targetPassId,
        kind: expiredLink.kind,
      },
    });

    await this.expireOpenTopUpRequestsForActionLink(expiredLink, new Date());

    return expiredLink;
  }

  private async cancelOpenTopUpRequestsForActionLink(
    actionLink: WalletActionLinkRecord,
    reason: string,
    actorType: 'provider' | 'system',
    actorId: string,
    occurredAt: Date,
  ): Promise<void> {
    const requests = await this.prisma.passTopUpRequest.findMany({
      where: {
        actionLinkId: actionLink.id,
        status: {
          in: ['Created', 'WaitingVerification'],
        },
      },
    });

    if (!requests.length) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.passTopUpRequest.updateMany({
        where: {
          id: {
            in: requests.map((request) => request.id),
          },
        },
        data: {
          status: 'Cancelled',
          cancelledAt: occurredAt,
        },
      }),
      this.prisma.serverVerificationChallenge.updateMany({
        where: {
          purpose: 'pass_top_up',
          referenceType: 'wallet_action_top_up',
          referenceId: {
            in: requests.map((request) => this.topUpChallengeReferenceId(request.id)),
          },
          status: 'active',
        },
        data: {
          status: 'cancelled',
        },
      }),
    ]);

    for (const request of requests) {
      await this.eventBus.publish({
        type: 'PassTopUpCancelled',
        eventId: randomUUID(),
        occurredAt: occurredAt.toISOString(),
        actorType,
        actorId,
        payload: {
          topUpId: request.id,
          userId: request.userId,
          sourcePassId: request.sourcePassId,
          targetPassId: request.targetPassId,
          ...(request.actionLinkId ? { actionLinkId: request.actionLinkId } : {}),
          reason,
        },
      });
    }
  }

  private async expireOpenTopUpRequestsForActionLink(
    actionLink: WalletActionLinkRecord,
    expiredAt: Date,
  ): Promise<void> {
    const requests = await this.prisma.passTopUpRequest.findMany({
      where: {
        actionLinkId: actionLink.id,
        status: {
          in: ['Created', 'WaitingVerification'],
        },
      },
    });

    if (!requests.length) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.passTopUpRequest.updateMany({
        where: {
          id: {
            in: requests.map((request) => request.id),
          },
        },
        data: {
          status: 'Expired',
          expiresAt: expiredAt,
        },
      }),
      this.prisma.serverVerificationChallenge.updateMany({
        where: {
          purpose: 'pass_top_up',
          referenceType: 'wallet_action_top_up',
          referenceId: {
            in: requests.map((request) => this.topUpChallengeReferenceId(request.id)),
          },
          status: 'active',
        },
        data: {
          status: 'expired',
        },
      }),
    ]);

    for (const request of requests) {
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
          ...(request.actionLinkId ? { actionLinkId: request.actionLinkId } : {}),
          expiredAt: expiredAt.toISOString(),
        },
      });
    }
  }

  async expireOutdatedActionLinks(
    providerId?: string,
    take = 100,
  ): Promise<{ expiredCount: number }> {
    const expiredLinks = await this.prisma.walletActionLink.findMany({
      where: {
        status: 'Active',
        expiresAt: {
          lte: new Date(),
        },
        ...(providerId ? { providerId } : {}),
      },
      include: this.actionLinkInclude(),
      take,
    });

    for (const actionLink of expiredLinks) {
      await this.markActionLinkExpired(actionLink);
    }

    return {
      expiredCount: expiredLinks.length,
    };
  }

  private async publishUseSucceededEvents(input: {
    actionLink: WalletActionLinkRecord;
    redemptionRequestId: string;
    ledgerEntryId: string;
    userId: string;
    beforeValue: string;
    afterValue: string;
    requestedValue: string;
    benefitType: 'amount' | 'points' | 'times';
  }) {
    await this.eventBus.publish({
      type: 'PassUseSucceeded',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: input.userId,
      payload: {
        passId: input.actionLink.targetPassId,
        providerId: input.actionLink.providerId,
        requestId: input.redemptionRequestId,
        recordId: input.ledgerEntryId,
        consumedValue: input.requestedValue,
        remainingValue: input.afterValue,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: input.userId,
      payload: {
        passId: input.actionLink.targetPassId,
        providerId: input.actionLink.providerId,
        balanceType: input.benefitType,
        beforeValue: input.beforeValue,
        afterValue: input.afterValue,
        changeValue: `-${input.requestedValue}`,
        reason: 'use',
        referenceId: input.ledgerEntryId,
      },
    });

    await this.publishActionLinkConsumed(
      input.actionLink,
      input.userId,
      'redemption_request',
      input.redemptionRequestId,
    );
  }

  private async publishTopUpSucceededEvents(input: {
    actionLink: WalletActionLinkRecord;
    topUpId: string;
    userId: string;
    value: string;
    sourcePassId: string;
    targetPassId: string;
    sourceProviderId: string;
    targetProviderId: string;
    benefitType: 'amount' | 'points' | 'times';
    sourceBeforeValue: string;
    sourceAfterValue: string;
    targetBeforeValue: string;
    targetAfterValue: string;
    sourceLedgerEntryId: string;
    targetLedgerEntryId: string;
  }) {
    await this.eventBus.publish({
      type: 'PassTopUpSucceeded',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: input.userId,
      payload: {
        topUpId: input.topUpId,
        userId: input.userId,
        sourcePassId: input.sourcePassId,
        targetPassId: input.targetPassId,
        providerId: input.targetProviderId,
        sourceProviderId: input.sourceProviderId,
        benefitType: input.benefitType,
        value: input.value,
        sourceLedgerEntryId: input.sourceLedgerEntryId,
        targetLedgerEntryId: input.targetLedgerEntryId,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: input.userId,
      payload: {
        passId: input.sourcePassId,
        providerId: input.sourceProviderId,
        balanceType: input.benefitType,
        beforeValue: input.sourceBeforeValue,
        afterValue: input.sourceAfterValue,
        changeValue: `-${input.value}`,
        reason: 'top_up',
        referenceId: input.topUpId,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: input.userId,
      payload: {
        passId: input.targetPassId,
        providerId: input.targetProviderId,
        balanceType: input.benefitType,
        beforeValue: input.targetBeforeValue,
        afterValue: input.targetAfterValue,
        changeValue: input.value,
        reason: 'top_up',
        referenceId: input.topUpId,
      },
    });

    await this.publishActionLinkConsumed(
      input.actionLink,
      input.userId,
      'pass_top_up',
      input.topUpId,
    );
  }

  private async publishActionLinkConsumed(
    actionLink: WalletActionLinkRecord,
    userId: string,
    referenceType: 'redemption_request' | 'pass_top_up',
    referenceId: string,
  ) {
    await this.eventBus.publish({
      type: 'WalletActionLinkConsumed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: userId,
      payload: {
        actionLinkId: actionLink.id,
        providerId: actionLink.providerId,
        targetPassId: actionLink.targetPassId,
        userId,
        kind: actionLink.kind,
        value: actionLink.requestedValue.toString(),
        referenceType,
        referenceId,
      },
    });
  }

  private async publishActionLinkRevoked(
    actionLink: WalletActionLinkRecord,
    providerAccountId: string,
    reason: string,
    revokedAt: Date,
  ) {
    await this.eventBus.publish({
      type: 'WalletActionLinkRevoked',
      eventId: randomUUID(),
      occurredAt: revokedAt.toISOString(),
      actorType: 'provider',
      actorId: providerAccountId,
      payload: {
        actionLinkId: actionLink.id,
        providerId: actionLink.providerId,
        targetPassId: actionLink.targetPassId,
        kind: actionLink.kind,
        reason,
      },
    });
  }

  private useRedemptionIdempotencyKey(actionLinkId: string): string {
    return `action-link-use:${actionLinkId}`;
  }

  private actionLinkInclude() {
    return actionLinkPayload.include;
  }

  private toProviderActionLink(actionLink: WalletActionLinkRecord, token: string) {
    return {
      ...this.toProviderActionLinkSummary(actionLink),
      token,
      actionPath: `/action?token=${encodeURIComponent(token)}`,
    };
  }

  private toProviderActionLinkSummary(actionLink: WalletActionLinkRecord) {
    return {
      ...this.toWalletActionLink(actionLink),
      revokedAt: actionLink.revokedAt?.toISOString() ?? null,
      revokeReason: actionLink.revokeReason,
      targetPass: {
        id: actionLink.targetPass.id,
        displayName:
          readVersionDisplayName(actionLink.targetPass.templateVersion.fields) ??
          actionLink.targetPass.template.displayName,
        title: actionLink.targetPass.templateVersion.title,
        category: actionLink.targetPass.template.category,
        benefitType: actionLink.targetPass.template.benefitType,
        status: actionLink.targetPass.status,
        publicNumber: actionLink.targetPass.publicNumber,
        maskedNumber: actionLink.targetPass.maskedNumber,
        balanceValue: actionLink.targetPass.balanceValue.toString(),
        user: actionLink.targetPass.user,
      },
      consumedByUser: actionLink.consumedByUser,
    };
  }

  private toWalletActionLink(actionLink: WalletActionLinkRecord) {
    return {
      id: actionLink.id,
      kind: actionLink.kind,
      status: actionLink.status,
      providerId: actionLink.providerId,
      providerName: actionLink.provider.name,
      targetPassId: actionLink.targetPassId,
      requestedValue: actionLink.requestedValue.toString(),
      verificationMethod: actionLink.verificationMethod,
      note: actionLink.note,
      expiresAt: actionLink.expiresAt.toISOString(),
      consumedAt: actionLink.consumedAt?.toISOString() ?? null,
      revokedAt: actionLink.revokedAt?.toISOString() ?? null,
      revokeReason: actionLink.revokeReason,
      createdAt: actionLink.createdAt.toISOString(),
    };
  }

  private toWalletPass(pass: {
    id: string;
    provider: { name: string };
    template: { displayName: string; category: string; benefitType: 'amount' | 'points' | 'times' };
    templateVersion: {
      title: string;
      fields: unknown;
      backgroundImageUrl: string | null;
      logoUrl: string | null;
    };
    status: string;
    publicNumber: string | null;
    maskedNumber: string | null;
    balanceValue: Prisma.Decimal;
    frozenValue: Prisma.Decimal;
    overdraftLimit: Prisma.Decimal;
    expiresAt: Date | null;
  }) {
    return {
      id: pass.id,
      providerName: pass.provider.name,
      displayName: readVersionDisplayName(pass.templateVersion.fields) ?? pass.template.displayName,
      title: pass.templateVersion.title,
      hideTitle: readVersionHideTitle(pass.templateVersion.fields),
      category: pass.template.category,
      benefitType: pass.template.benefitType,
      status: pass.status,
      publicNumber: pass.publicNumber,
      maskedNumber: pass.maskedNumber,
      balanceValue: pass.balanceValue.toString(),
      frozenValue: pass.frozenValue.toString(),
      overdraftLimit: pass.overdraftLimit.toString(),
      expiresAt: pass.expiresAt?.toISOString() ?? null,
      backgroundImageUrl: pass.templateVersion.backgroundImageUrl,
      logoUrl: pass.templateVersion.logoUrl,
    };
  }

  private toRedemptionRequest(redemptionRequest: {
    id: string;
    status: string;
    verificationMethod: string;
    requestedValue: Prisma.Decimal | null;
    expiresAt: Date;
    verificationFailureCount: number;
    maxVerificationAttempts: number;
    failureCode: string | null;
    failureMessage: string | null;
    createdAt: Date;
    passId: string;
    providerId: string;
    userId: string | null;
  }) {
    return {
      id: redemptionRequest.id,
      passId: redemptionRequest.passId,
      providerId: redemptionRequest.providerId,
      userId: redemptionRequest.userId,
      status: redemptionRequest.status,
      verificationMethod: redemptionRequest.verificationMethod,
      requestedValue: redemptionRequest.requestedValue?.toString() ?? '0',
      expiresAt: redemptionRequest.expiresAt.toISOString(),
      verificationFailureCount: redemptionRequest.verificationFailureCount,
      maxVerificationAttempts: redemptionRequest.maxVerificationAttempts,
      failureCode: redemptionRequest.failureCode,
      failureMessage: redemptionRequest.failureMessage,
      createdAt: redemptionRequest.createdAt.toISOString(),
    };
  }
}

function createActionToken(): string {
  return `ACT-${randomBytes(24).toString('base64url')}`;
}

function hashActionToken(value: string): string {
  return createHash('sha256').update(value.trim()).digest('base64url');
}

function readVersionDisplayName(value: unknown): string | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const displayName = (value as { displayName?: unknown }).displayName;
  return typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null;
}

function readVersionHideTitle(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as { hideTitle?: unknown }).hideTitle === true;
}

function readAllowTopUpIn(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as { allowTopUpIn?: unknown }).allowTopUpIn === true;
}

function readAllowTopUpOut(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (value as { allowTopUpOut?: unknown }).allowTopUpOut === true;
}

function normalizePositiveDecimal(value: string, message = '数值必须大于 0。'): string {
  const normalizedValue = value.trim();
  if (
    !/^\d+(\.\d{1,6})?$/.test(normalizedValue) ||
    compareDecimalStrings(normalizedValue, '0') <= 0
  ) {
    throw new BadRequestException(message);
  }

  return normalizedValue;
}

function readTake(value?: string): number {
  if (!value) {
    return 20;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue)) {
    return 20;
  }

  return Math.min(Math.max(parsedValue, 1), 100);
}

function canConsumeValue(
  balanceValue: string,
  frozenValue: string,
  overdraftLimit: string,
  requestedValue: string,
): boolean {
  const availableValue = subtractDecimalStrings(balanceValue, frozenValue);
  const minimumValue = `-${normalizeDecimalString(overdraftLimit)}`;
  const afterValue = subtractDecimalStrings(availableValue, requestedValue);
  return compareDecimalStrings(afterValue, minimumValue) >= 0;
}

function addDecimalStrings(left: string, right: string): string {
  return fromScaledDecimal(toScaledDecimal(left) + toScaledDecimal(right));
}

function subtractDecimalStrings(left: string, right: string): string {
  return fromScaledDecimal(toScaledDecimal(left) - toScaledDecimal(right));
}

function compareDecimalStrings(left: string, right: string): number {
  const leftScaled = toScaledDecimal(left);
  const rightScaled = toScaledDecimal(right);
  return leftScaled === rightScaled ? 0 : leftScaled > rightScaled ? 1 : -1;
}

function normalizeDecimalString(value: string): string {
  return fromScaledDecimal(toScaledDecimal(value));
}

function toScaledDecimal(value: string): bigint {
  const normalizedValue = value.trim();
  const sign = normalizedValue.startsWith('-') ? -1n : 1n;
  const unsignedValue = normalizedValue.replace(/^[+-]/, '');
  const [integerPart = '0', fractionPart = ''] = unsignedValue.split('.');
  const paddedFraction = `${fractionPart}000000`.slice(0, 6);
  return sign * (BigInt(integerPart || '0') * decimalScale + BigInt(paddedFraction || '0'));
}

function fromScaledDecimal(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absoluteValue = value < 0n ? -value : value;
  const integerPart = absoluteValue / decimalScale;
  const fractionPart = (absoluteValue % decimalScale)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return `${sign}${integerPart.toString()}${fractionPart ? `.${fractionPart}` : ''}`;
}
