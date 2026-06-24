import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import type { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import {
  readBdslmChatContent,
  readBdslmChatMessageId,
  readBdslmChatSender,
} from '../../shared/bdslm/chat-message.js';
import { BdslmClientService } from '../bdslm/bdslm-client.service.js';
import type { AuthenticatedProviderAccount } from '../../shared/auth/provider-auth.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  AdminReverseRedemptionRequestDto,
  CancelRedemptionRequestDto,
  CreateRedemptionByCardNumberDto,
  CreateRedemptionRequestDto,
  CreateWalletRedemptionRequestDto,
  RedemptionQueryDto,
  ReverseRedemptionRequestDto,
} from './dto.js';

const decimalScale = 1_000_000n;
const defaultMaxVerificationAttempts = 3;
const maximumVerificationAttempts = 10;
const SERVER_CONFIRMATION_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class RedemptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretHash: SecretHashService,
    private readonly bdslmClient: BdslmClientService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async createProviderRedemptionRequest(dto: CreateRedemptionRequestDto, providerAccount: AuthenticatedProviderAccount) {
    await this.expireOutdatedRequests();

    const idempotencyKey = dto.idempotencyKey?.trim() || `provider-redemption:${randomUUID()}`;
    const existingRequest = await this.prisma.redemptionRequest.findUnique({
      where: {
        idempotencyKey,
      },
      include: this.redemptionInclude(),
    });

    if (existingRequest) {
      if (existingRequest.providerId !== providerAccount.providerId) {
        throw new ConflictException('这次核销请求的幂等键已经被其他提供方使用。');
      }

      return {
        redemptionRequest: this.toRedemptionRequest(existingRequest),
      };
    }

    const pass = await this.prisma.pass.findFirst({
      where: {
        id: dto.passId,
        providerId: providerAccount.providerId,
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
            serverAccountVerified: true,
          },
        },
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在或不属于当前发卡方。');
    }

    if (!pass.userId || !pass.user) {
      throw new BadRequestException('卡券尚未被用户领取，不能发起消耗请求。');
    }

    if (pass.status === 'Archived' || pass.status === 'Frozen' || pass.status === 'Expired') {
      throw new BadRequestException('当前卡券状态不能发起消耗请求。');
    }

    return this.createProviderRedemptionRequestForPass(pass, dto, providerAccount, idempotencyKey);
  }

  async previewProviderRedemptionPassByCardNumber(cardNumber: string, providerAccount: AuthenticatedProviderAccount) {
    const pass = await this.readProviderRedeemablePassByCardNumber(cardNumber, providerAccount);

    return {
      pass: this.toWalletPass(pass),
      holder: pass.user
        ? {
            id: pass.user.id,
            username: pass.user.username,
            email: pass.user.email,
            serverAccountVerified: pass.user.serverAccountVerified,
          }
        : null,
      issuerProvider: {
        id: pass.provider.id,
        name: pass.provider.name,
        slug: pass.provider.slug,
      },
      redeemingProvider: {
        id: providerAccount.providerId,
        name: providerAccount.providerName,
        slug: providerAccount.providerSlug,
      },
    };
  }

  async createProviderRedemptionRequestByCardNumber(
    dto: CreateRedemptionByCardNumberDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedRequests();

    const idempotencyKey = dto.idempotencyKey?.trim() || `provider-redemption:${randomUUID()}`;
    const existingRequest = await this.prisma.redemptionRequest.findUnique({
      where: {
        idempotencyKey,
      },
      include: this.redemptionInclude(),
    });

    if (existingRequest) {
      if (existingRequest.providerId !== providerAccount.providerId) {
        throw new ConflictException('这次核销请求的幂等键已经被其他提供方使用。');
      }

      return {
        redemptionRequest: this.toRedemptionRequest(existingRequest),
      };
    }

    const pass = await this.readProviderRedeemablePassByCardNumber(dto.cardNumber, providerAccount);
    return this.createProviderRedemptionRequestForPass(pass, dto, providerAccount, idempotencyKey);
  }

  private async createProviderRedemptionRequestForPass(
    pass: ProviderRedemptionPass,
    dto: CreateRedemptionRequestDto | CreateRedemptionByCardNumberDto,
    providerAccount: AuthenticatedProviderAccount,
    idempotencyKey: string,
  ) {
    this.assertPassCanReceiveProviderRedemption(pass);

    const requestedValue = normalizePositiveDecimal(dto.requestedValue);
    const expiresAt = new Date(Date.now() + 1000 * (dto.expiresInSeconds ?? 120));
    const maxVerificationAttempts = normalizeMaxVerificationAttempts(dto.maxVerificationAttempts);
    const now = new Date();

    const redemptionRequest = await this.prisma.redemptionRequest.create({
      data: {
        passId: pass.id,
        userId: pass.userId,
        providerId: providerAccount.providerId,
        status: 'WaitingVerification',
        verificationMethod: dto.verificationMethod,
        requestedValue,
        idempotencyKey,
        expiresAt,
        maxVerificationAttempts,
      },
      include: this.redemptionInclude(),
    });

    await this.eventBus.publish({
      type: 'PassUseRequested',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        passId: pass.id,
        providerId: providerAccount.providerId,
        requestId: redemptionRequest.id,
        amount: requestedValue,
        verificationMethod: dto.verificationMethod,
        expiresAt: expiresAt.toISOString(),
        maxVerificationAttempts,
      },
    });

    return {
      redemptionRequest: this.toRedemptionRequest(redemptionRequest),
    };
  }

  private async readProviderRedeemablePassByCardNumber(
    lookupValue: string,
    providerAccount: AuthenticatedProviderAccount,
  ): Promise<ProviderRedemptionPass> {
    const publicNumber = readProviderCardNumberLookup(lookupValue);
    if (!publicNumber) {
      throw new BadRequestException('请填写卡号。');
    }

    const passByPublicNumber = await this.findProviderRedeemablePassByPublicNumber(publicNumber, providerAccount);

    if (passByPublicNumber) {
      this.assertPassCanReceiveProviderRedemption(passByPublicNumber);
      return passByPublicNumber;
    }

    throw new NotFoundException('卡号不存在，或当前发卡方未被允许核销这张卡。');
  }

  private async findProviderRedeemablePassByPublicNumber(
    publicNumber: string,
    providerAccount: AuthenticatedProviderAccount,
  ): Promise<ProviderRedemptionPass | null> {
    const passes = await this.prisma.pass.findMany({
      where: {
        publicNumber,
      },
      include: this.providerRedemptionPassInclude(),
      take: 20,
    });

    const authorizedPasses = passes.filter((pass) => this.canProviderRedeemPass(pass, providerAccount));
    if (authorizedPasses.length === 0) {
      return null;
    }

    if (authorizedPasses.length > 1) {
      throw new ConflictException('该卡号对应多张当前发卡方可核销的卡券，请先在发卡方后台确认完整卡券。');
    }

    return authorizedPasses[0]!;
  }

  private providerRedemptionPassInclude() {
    return {
      provider: true,
      template: true,
      templateVersion: true,
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          serverAccountVerified: true,
        },
      },
    } satisfies Prisma.PassInclude;
  }

  private canProviderRedeemPass(pass: ProviderRedemptionPass, providerAccount: AuthenticatedProviderAccount): boolean {
    if (pass.providerId === providerAccount.providerId) {
      return true;
    }

    return readAllowedRedemptionProviderIds(pass.templateVersion.rules).includes(providerAccount.providerId);
  }

  private assertPassCanReceiveProviderRedemption(pass: ProviderRedemptionPass): void {
    if (!pass.userId || !pass.user) {
      throw new BadRequestException('卡券尚未被用户领取，不能发起消耗请求。');
    }

    if (pass.status === 'Archived' || pass.status === 'Frozen' || pass.status === 'Expired') {
      throw new BadRequestException('当前卡券状态不能发起消耗请求。');
    }
  }

  async listProviderRedemptionRequests(query: RedemptionQueryDto, providerAccount: AuthenticatedProviderAccount) {
    await this.expireOutdatedRequests();

    const requests = await this.prisma.redemptionRequest.findMany({
      where: this.buildProviderRedemptionWhere(query, providerAccount.providerId),
      orderBy: {
        createdAt: 'desc',
      },
      take: this.readTake(query.take),
      include: this.redemptionInclude(),
    });

    return {
      redemptionRequests: requests.map((request) => this.toRedemptionRequest(request)),
    };
  }

  async listWalletRedemptionRequests(query: RedemptionQueryDto, user: AuthenticatedUser) {
    await this.expireOutdatedRequests();

    const requests = await this.prisma.redemptionRequest.findMany({
      where: {
        userId: user.id,
        status: 'WaitingVerification',
        expiresAt: {
          gt: new Date(),
        },
        ...(query.passId ? { passId: query.passId } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: this.readTake(query.take),
      include: this.redemptionInclude(),
    });

    return {
      redemptionRequests: requests.map((request) => this.toRedemptionRequest(request)),
    };
  }

  async createWalletRedemptionRequest(dto: CreateWalletRedemptionRequestDto, user: AuthenticatedUser) {
    await this.expireOutdatedRequests();

    const idempotencyKey = dto.idempotencyKey?.trim() || `wallet-redemption:${randomUUID()}`;
    const existingRequest = await this.prisma.redemptionRequest.findUnique({
      where: {
        idempotencyKey,
      },
      include: this.redemptionInclude(),
    });

    if (existingRequest) {
      if (existingRequest.userId !== user.id) {
        throw new ConflictException('这次消耗请求的幂等键已经被其他用户使用。');
      }

      return {
        redemptionRequest: this.toRedemptionRequest(existingRequest),
      };
    }

    const pass = await this.prisma.pass.findFirst({
      where: {
        id: dto.passId,
        userId: user.id,
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
            serverAccountVerified: true,
          },
        },
      },
    });

    if (!pass) {
      throw new NotFoundException('卡券不存在或不属于当前用户。');
    }

    if (pass.status !== 'Added' && pass.status !== 'Active') {
      throw new BadRequestException('当前卡券状态不能发起消耗请求。');
    }

    const pendingRequest = await this.prisma.redemptionRequest.findFirst({
      where: {
        passId: pass.id,
        userId: user.id,
        status: 'WaitingVerification',
        expiresAt: {
          gt: new Date(),
        },
      },
      include: this.redemptionInclude(),
    });

    if (pendingRequest) {
      throw new BadRequestException('该卡券已有待确认消耗请求，请先处理或等待过期。');
    }

    const requestedValue = normalizePositiveDecimal(dto.requestedValue);
    const expiresAt = new Date(Date.now() + 1000 * 120);
    const maxVerificationAttempts = defaultMaxVerificationAttempts;
    const now = new Date();

    const redemptionRequest = await this.prisma.redemptionRequest.create({
      data: {
        passId: pass.id,
        userId: user.id,
        providerId: pass.providerId,
        status: 'WaitingVerification',
        verificationMethod: dto.verificationMethod,
        requestedValue,
        idempotencyKey,
        expiresAt,
        maxVerificationAttempts,
      },
      include: this.redemptionInclude(),
    });

    await this.eventBus.publish({
      type: 'PassUseRequested',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        passId: pass.id,
        providerId: pass.providerId,
        requestId: redemptionRequest.id,
        amount: requestedValue,
        verificationMethod: dto.verificationMethod,
        expiresAt: expiresAt.toISOString(),
        maxVerificationAttempts,
      },
    });

    return {
      redemptionRequest: this.toRedemptionRequest(redemptionRequest),
    };
  }

  async cancelProviderRedemptionRequest(
    requestId: string,
    dto: CancelRedemptionRequestDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedRequests();

    const redemptionRequest = await this.prisma.redemptionRequest.findFirst({
      where: {
        id: requestId,
        providerId: providerAccount.providerId,
      },
      include: this.redemptionInclude(),
    });

    if (!redemptionRequest) {
      throw new NotFoundException('核销请求不存在或不属于当前发卡方。');
    }

    if (redemptionRequest.status === 'Cancelled') {
      return {
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
      };
    }

    if (redemptionRequest.status !== 'WaitingVerification') {
      throw new BadRequestException('只有等待确认的核销请求可以取消。');
    }

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('取消原因不能为空。');
    }

    const now = new Date();
    const cancelledRequest = await this.prisma.redemptionRequest.update({
      where: {
        id: redemptionRequest.id,
      },
      data: {
        status: 'Cancelled',
        failureCode: 'PROVIDER_CANCELLED',
        failureMessage: reason,
      },
      include: this.redemptionInclude(),
    });

    await this.eventBus.publish({
      type: 'PassUseCancelled',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'provider',
      actorId: providerAccount.id,
      payload: {
        passId: redemptionRequest.passId,
        providerId: redemptionRequest.providerId,
        requestId: redemptionRequest.id,
        reason,
      },
    });

    return {
      redemptionRequest: this.toRedemptionRequest(cancelledRequest),
    };
  }

  async reverseProviderRedemptionRequest(
    requestId: string,
    dto: ReverseRedemptionRequestDto,
    providerAccount: AuthenticatedProviderAccount,
  ) {
    await this.expireOutdatedRequests();

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('冲正原因不能为空。');
    }

    const redemptionRequest = await this.prisma.redemptionRequest.findFirst({
      where: {
        id: requestId,
        providerId: providerAccount.providerId,
      },
      include: this.redemptionInclude(),
    });

    if (!redemptionRequest) {
      throw new NotFoundException('核销请求不存在或不属于当前发卡方。');
    }

    return this.reverseCompletedRedemptionRequest(redemptionRequest, reason, {
      actorType: 'provider',
      actorId: providerAccount.id,
      notePrefix: '发卡方冲正已完成消耗',
    });
  }

  async reverseAdminRedemptionRequest(
    requestId: string,
    dto: AdminReverseRedemptionRequestDto,
    admin: AuthenticatedUser,
  ) {
    await this.expireOutdatedRequests();

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('冲正原因不能为空。');
    }

    const redemptionRequest = await this.prisma.redemptionRequest.findUnique({
      where: {
        id: requestId,
      },
      include: this.redemptionInclude(),
    });

    if (!redemptionRequest) {
      throw new NotFoundException('核销请求不存在。');
    }

    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), new Date(), 'admin_adjustment');

    return this.reverseCompletedRedemptionRequest(redemptionRequest, reason, {
      actorType: 'admin',
      actorId: admin.id,
      notePrefix: '管理员冲正已完成消耗',
    });
  }

  private async reverseCompletedRedemptionRequest(
    redemptionRequest: RedemptionRequestWithRelations,
    reason: string,
    actor: {
      actorType: 'provider' | 'admin';
      actorId: string;
      notePrefix: string;
    },
  ) {
    const existingReversal = await this.prisma.ledgerEntry.findUnique({
      where: {
        idempotencyKey: `redemption-reversal:${redemptionRequest.id}`,
      },
    });

    if (redemptionRequest.status === 'Reversed') {
      return {
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
        pass: this.toWalletPass(redemptionRequest.pass),
        ledgerEntry: existingReversal ? this.toLedgerEntry(existingReversal) : null,
      };
    }

    if (redemptionRequest.status !== 'Succeeded') {
      throw new BadRequestException('只有已完成的消耗请求可以冲正。');
    }

    if (existingReversal) {
      const reversedRequest = await this.prisma.redemptionRequest.update({
        where: {
          id: redemptionRequest.id,
        },
        data: {
          status: 'Reversed',
          failureCode: 'REVERSED',
          failureMessage: reason,
        },
        include: this.redemptionInclude(),
      });

      return {
        redemptionRequest: this.toRedemptionRequest(reversedRequest),
        pass: this.toWalletPass(reversedRequest.pass),
        ledgerEntry: this.toLedgerEntry(existingReversal),
      };
    }

    const refundedValue = normalizePositiveDecimal(redemptionRequest.requestedValue?.toString() ?? '0');
    const beforeValue = redemptionRequest.pass.balanceValue.toString();
    const afterValue = addDecimalStrings(beforeValue, refundedValue);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedPass = await tx.pass.update({
        where: {
          id: redemptionRequest.passId,
        },
        data: {
          balanceValue: afterValue,
          status:
            redemptionRequest.pass.status === 'UsedUp' && compareDecimalStrings(afterValue, '0') > 0
              ? 'Active'
              : redemptionRequest.pass.status,
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
              serverAccountVerified: true,
            },
          },
        },
      });

      const ledgerEntry = await tx.ledgerEntry.create({
        data: {
          passId: redemptionRequest.passId,
          userId: redemptionRequest.userId,
          providerId: redemptionRequest.providerId,
          benefitType: redemptionRequest.pass.template.benefitType,
          reason: 'refund',
          beforeValue,
          changeValue: refundedValue,
          afterValue,
          idempotencyKey: `redemption-reversal:${redemptionRequest.id}`,
          referenceType: 'RedemptionRequestReversal',
          referenceId: redemptionRequest.id,
          note: `${actor.notePrefix}：${reason}`,
          createdByType: actor.actorType,
          createdById: actor.actorId,
        },
      });

      const updatedRequest = await tx.redemptionRequest.update({
        where: {
          id: redemptionRequest.id,
        },
        data: {
          status: 'Reversed',
          failureCode: 'REVERSED',
          failureMessage: reason,
        },
        include: this.redemptionInclude(),
      });

      return {
        ledgerEntry,
        pass: updatedPass,
        redemptionRequest: updatedRequest,
      };
    });

    await this.eventBus.publish({
      type: 'PassUseReversed',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: actor.actorType,
      actorId: actor.actorId,
      payload: {
        passId: redemptionRequest.passId,
        providerId: redemptionRequest.providerId,
        requestId: redemptionRequest.id,
        recordId: result.ledgerEntry.id,
        refundedValue,
        remainingValue: result.pass.balanceValue.toString(),
        reason,
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: actor.actorType,
      actorId: actor.actorId,
      payload: {
        passId: redemptionRequest.passId,
        providerId: redemptionRequest.providerId,
        balanceType: redemptionRequest.pass.template.benefitType,
        beforeValue,
        afterValue,
        changeValue: refundedValue,
        reason: 'refund',
        referenceId: result.ledgerEntry.id,
      },
    });

    return {
      redemptionRequest: this.toRedemptionRequest(result.redemptionRequest),
      pass: this.toWalletPass(result.pass),
      ledgerEntry: this.toLedgerEntry(result.ledgerEntry),
    };
  }

  async startServerAccountConfirmation(requestId: string, user: AuthenticatedUser) {
    const redemptionRequest = await this.readRedemptionRequestForConfirmation(requestId, user, 'server_account');
    if (redemptionRequest.status !== 'WaitingVerification') {
      throw new BadRequestException('核销请求已经处理或失效。');
    }

    if (redemptionRequest.expiresAt <= new Date()) {
      throw new BadRequestException('核销请求已过期，请重新发起。');
    }

    if (!user.serverAccountVerified || !user.serverAccountName) {
      throw new UnauthorizedException('需要先在账户页完成服务器账号验证。');
    }

    const challenge = await this.createRedemptionServerChallenge(user.id, user.serverAccountName, redemptionRequest.id, 'manual_refresh');

    return {
      status: 'challenge_issued',
      redemptionRequest: this.toRedemptionRequest(redemptionRequest),
      challenge,
    };
  }

  async confirmWithServerAccount(requestId: string, challengeId: string, user: AuthenticatedUser) {
    const redemptionRequest = await this.readRedemptionRequestForConfirmation(requestId, user, 'server_account');

    if (!user.serverAccountVerified || !user.serverAccountName) {
      throw new UnauthorizedException('需要先在账户页完成服务器账号验证。');
    }

    if (redemptionRequest.status !== 'WaitingVerification') {
      return {
        status: redemptionRequest.status === 'Succeeded' ? 'verified' : 'expired',
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
        ...(redemptionRequest.status === 'Succeeded' ? { pass: this.toWalletPass(redemptionRequest.pass), ledgerEntry: null } : {}),
      };
    }

    const challenge = await this.prisma.serverVerificationChallenge.findFirst({
      where: {
        id: challengeId,
        userId: user.id,
        purpose: 'pass_use',
        referenceType: 'redemption_request',
        referenceId: redemptionRequest.id,
      },
    });

    if (!challenge) {
      throw new BadRequestException('服务器账号确认验证码不存在，请重新获取。');
    }

    if (challenge.serverId !== user.serverAccountName) {
      throw new BadRequestException('服务器账号确认验证码与当前绑定账号不匹配，请重新获取。');
    }

    if (challenge.status !== 'active') {
      return {
        status: challenge.status === 'verified' ? 'verified' : 'waiting',
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
      };
    }

    if (challenge.expiresAt <= new Date()) {
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
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
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
      if (await this.secretHash.verifySecret(readBdslmChatContent(message), challenge.codeHash, 'server-verification-code')) {
        await this.prisma.serverVerificationChallenge.update({
          where: {
            id: challenge.id,
          },
          data: {
            status: 'verified',
            lastCheckedChatId: nextLastCheckedChatId,
          },
        });

        const result = await this.completeRedemptionRequest(requestId, user, 'server_account');
        return {
          status: 'verified',
          ...result,
        };
      }
    }

    if (matchingMessages.length > 0) {
      const rotatedChallenge = await this.rotateRedemptionServerChallenge(challenge, nextLastCheckedChatId, 'chat_mismatch');
      return {
        status: 'rotated',
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
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
      redemptionRequest: this.toRedemptionRequest(redemptionRequest),
    };
  }

  async confirmWithPin(requestId: string, pin: string, user: AuthenticatedUser) {
    const redemptionRequest = await this.readRedemptionRequestForConfirmation(requestId, user, 'pin');
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
      if (redemptionRequest.status === 'WaitingVerification' && redemptionRequest.expiresAt > new Date()) {
        const failureMessage = await this.recordVerificationFailure(redemptionRequest, user, 'INVALID_PIN', 'PIN 不正确。');
        throw new UnauthorizedException(failureMessage);
      }

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
        challengeId: requestId,
        purpose: 'pass_use',
      },
    });

    return this.completeRedemptionRequest(requestId, user, 'pin');
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
      throw new UnauthorizedException('管理员账号尚未设置 PIN，不能执行冲正。');
    }

    if (!(await this.secretHash.verifySecret(pin, adminUser.pinHash, 'pin'))) {
      throw new UnauthorizedException('管理员 PIN 不正确，不能执行冲正。');
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

  private async completeRedemptionRequest(
    requestId: string,
    user: AuthenticatedUser,
    verificationMethod: 'server_account' | 'pin',
  ) {
    const redemptionRequest = await this.readRedemptionRequestForConfirmation(requestId, user, verificationMethod);

    if (redemptionRequest.status === 'Succeeded') {
      return {
        redemptionRequest: this.toRedemptionRequest(redemptionRequest),
        pass: this.toWalletPass(redemptionRequest.pass),
        ledgerEntry: null,
      };
    }

    if (redemptionRequest.status !== 'WaitingVerification') {
      throw new BadRequestException('核销请求已经处理或失效。');
    }

    if (redemptionRequest.expiresAt <= new Date()) {
      const expiredRequest = await this.prisma.redemptionRequest.update({
        where: {
          id: redemptionRequest.id,
        },
        data: {
          status: 'Expired',
        },
        include: this.redemptionInclude(),
      });

      throw new BadRequestException(`核销请求已过期：${expiredRequest.id}`);
    }

    const requestedValue = normalizePositiveDecimal(redemptionRequest.requestedValue?.toString() ?? '0');
    const beforeValue = redemptionRequest.pass.balanceValue.toString();
    const afterValue = subtractDecimalStrings(beforeValue, requestedValue);

    if (!canConsumeValue(redemptionRequest.pass.balanceValue.toString(), redemptionRequest.pass.frozenValue.toString(), redemptionRequest.pass.overdraftLimit.toString(), requestedValue)) {
      const failedRequest = await this.prisma.redemptionRequest.update({
        where: {
          id: redemptionRequest.id,
        },
        data: {
          status: 'Failed',
          failureCode: 'INSUFFICIENT_BALANCE',
          failureMessage: '余额或权益不足，无法完成本次消耗。',
        },
        include: this.redemptionInclude(),
      });

      await this.eventBus.publish({
        type: 'PassUseFailed',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorType: 'user',
        actorId: user.id,
        payload: {
          passId: redemptionRequest.passId,
          providerId: redemptionRequest.providerId,
          requestId: redemptionRequest.id,
          errorCode: 'INSUFFICIENT_BALANCE',
          errorMessage: '余额或权益不足，无法完成本次消耗。',
          retryable: false,
        },
      });

      throw new BadRequestException(failedRequest.failureMessage ?? '余额或权益不足，无法完成本次消耗。');
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
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              serverAccountVerified: true,
            },
          },
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
          idempotencyKey: `redemption-use:${redemptionRequest.id}`,
          referenceType: 'RedemptionRequest',
          referenceId: redemptionRequest.id,
          note: `用户确认消耗权益，验证方式：${formatVerificationMethod(verificationMethod)}`,
          createdByType: 'user',
          createdById: user.id,
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
        include: this.redemptionInclude(),
      });

      return {
        ledgerEntry,
        pass: updatedPass,
        redemptionRequest: updatedRequest,
      };
    });

    await this.eventBus.publish({
      type: 'PassUseSucceeded',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        passId: redemptionRequest.passId,
        providerId: redemptionRequest.providerId,
        requestId: redemptionRequest.id,
        recordId: result.ledgerEntry.id,
        consumedValue: requestedValue,
        remainingValue: result.pass.balanceValue.toString(),
      },
    });

    await this.eventBus.publish({
      type: 'PassBalanceChanged',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        passId: redemptionRequest.passId,
        providerId: redemptionRequest.providerId,
        balanceType: redemptionRequest.pass.template.benefitType,
        beforeValue,
        afterValue,
        changeValue: `-${requestedValue}`,
        reason: 'use',
        referenceId: result.ledgerEntry.id,
      },
    });

    return {
      redemptionRequest: this.toRedemptionRequest(result.redemptionRequest),
      pass: this.toWalletPass(result.pass),
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

  private async expireOutdatedRequests(): Promise<void> {
    await this.prisma.redemptionRequest.updateMany({
      where: {
        status: 'WaitingVerification',
        expiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: 'Expired',
        failureCode: 'EXPIRED',
        failureMessage: '核销请求已过期。',
      },
    });
  }

  private async createRedemptionServerChallenge(
    userId: string,
    serverId: string,
    redemptionRequestId: string,
    rotateReason: 'manual_refresh' | 'expired' | 'rate_limit_retry',
  ) {
    const activeChallenges = await this.prisma.serverVerificationChallenge.findMany({
      where: {
        userId,
        purpose: 'pass_use',
        referenceType: 'redemption_request',
        referenceId: redemptionRequestId,
        status: 'active',
      },
      select: {
        id: true,
      },
    });
    const lastCheckedChatId = await this.readLatestChatId();
    const code = this.createReadableCode();
    const expiresAt = new Date(Date.now() + SERVER_CONFIRMATION_TTL_MS);

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
          purpose: 'pass_use',
          codeHash: await this.secretHash.hashSecret(code, 'server-verification-code'),
          lastCheckedChatId,
          expiresAt,
          referenceType: 'redemption_request',
          referenceId: redemptionRequestId,
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
          purpose: 'pass_use',
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
        purpose: 'pass_use',
      },
    });

    return this.toServerChallengeView(challenge, code);
  }

  private async rotateRedemptionServerChallenge(
    challenge: {
      id: string;
      userId: string;
      serverId: string;
      expiresAt: Date;
      referenceType: string | null;
      referenceId: string | null;
    },
    lastCheckedChatId: number,
    reason: 'chat_mismatch' | 'manual_refresh' | 'expired' | 'rate_limit_retry',
  ) {
    const code = this.createReadableCode();
    const expiresAt = new Date(Date.now() + SERVER_CONFIRMATION_TTL_MS);

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
          purpose: 'pass_use',
          codeHash: await this.secretHash.hashSecret(code, 'server-verification-code'),
          lastCheckedChatId,
          expiresAt,
          referenceType: challenge.referenceType,
          referenceId: challenge.referenceId,
          rotatedFromId: challenge.id,
        },
      });
    });

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
        purpose: 'pass_use',
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
        purpose: 'pass_use',
      },
    });

    return this.toServerChallengeView(nextChallenge, code);
  }

  private toServerChallengeView(challenge: {
    id: string;
    serverId: string;
    expiresAt: Date;
  }, code: string) {
    return {
      id: challenge.id,
      serverId: challenge.serverId,
      code,
      expiresAt: challenge.expiresAt.toISOString(),
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

  private async readRedemptionRequestForConfirmation(
    requestId: string,
    user: AuthenticatedUser,
    verificationMethod: 'server_account' | 'pin',
  ): Promise<RedemptionRequestWithRelations> {
    await this.expireOutdatedRequests();

    const redemptionRequest = await this.prisma.redemptionRequest.findFirst({
      where: {
        id: requestId,
        userId: user.id,
      },
      include: this.redemptionInclude(),
    });

    if (!redemptionRequest) {
      throw new NotFoundException('核销请求不存在或不属于当前用户。');
    }

    if (redemptionRequest.verificationMethod !== verificationMethod) {
      throw new BadRequestException('核销请求要求使用另一种验证方式。');
    }

    return redemptionRequest;
  }

  private async recordVerificationFailure(
    redemptionRequest: RedemptionRequestWithRelations,
    user: AuthenticatedUser,
    errorCode: string,
    baseMessage: string,
  ): Promise<string> {
    const failureCount = redemptionRequest.verificationFailureCount + 1;
    const maxAttempts = normalizeMaxVerificationAttempts(redemptionRequest.maxVerificationAttempts);
    const remainingAttempts = Math.max(maxAttempts - failureCount, 0);
    const retryable = remainingAttempts > 0;
    const failureMessage = retryable
      ? `${baseMessage}还可以重试 ${remainingAttempts} 次。`
      : `${baseMessage}已达到最大尝试次数。`;

    await this.prisma.redemptionRequest.update({
      where: {
        id: redemptionRequest.id,
      },
      data: {
        status: retryable ? 'WaitingVerification' : 'Failed',
        verificationFailureCount: failureCount,
        failureCode: errorCode,
        failureMessage,
      },
    });

    await this.eventBus.publish({
      type: 'PassUseFailed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        passId: redemptionRequest.passId,
        providerId: redemptionRequest.providerId,
        requestId: redemptionRequest.id,
        errorCode,
        errorMessage: failureMessage,
        retryable,
        attemptCount: failureCount,
        maxAttempts,
        remainingAttempts,
      },
    });

    return failureMessage;
  }

  private buildProviderRedemptionWhere(query: RedemptionQueryDto, providerId: string): Prisma.RedemptionRequestWhereInput {
    const keyword = query.keyword?.trim();
    return {
      providerId,
      ...(query.passId ? { passId: query.passId } : {}),
      ...(keyword
        ? {
            OR: [
              {
                id: {
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
                  user: {
                    is: {
                      username: {
                        contains: keyword,
                      },
                    },
                  },
                },
              },
              {
                pass: {
                  user: {
                    is: {
                      email: {
                        contains: keyword,
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private readTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '20', 10);

    if (!Number.isFinite(parsedValue)) {
      return 20;
    }

    return Math.min(Math.max(parsedValue, 1), 100);
  }

  private redemptionInclude() {
    return {
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
              serverAccountVerified: true,
            },
          },
        },
      },
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          serverAccountVerified: true,
        },
      },
    } satisfies Prisma.RedemptionRequestInclude;
  }

  private toRedemptionRequest(request: RedemptionRequestWithRelations) {
    return {
      id: request.id,
      passId: request.passId,
      providerId: request.providerId,
      providerName: request.provider.name,
      status: request.status,
      verificationMethod: request.verificationMethod,
      requestedValue: request.requestedValue?.toString() ?? '0',
      expiresAt: request.expiresAt.toISOString(),
      verificationFailureCount: request.verificationFailureCount,
      maxVerificationAttempts: request.maxVerificationAttempts,
      failureCode: request.failureCode,
      failureMessage: request.failureMessage,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      pass: this.toWalletPass(request.pass),
      user: request.user
        ? {
            id: request.user.id,
            username: request.user.username,
            email: request.user.email,
            serverAccountVerified: request.user.serverAccountVerified,
          }
        : null,
    };
  }

  private toLedgerEntry(entry: RedemptionLedgerEntry) {
    return {
      id: entry.id,
      beforeValue: entry.beforeValue.toString(),
      changeValue: entry.changeValue.toString(),
      afterValue: entry.afterValue.toString(),
      reason: entry.reason,
      note: entry.note,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private toWalletPass(pass: RedemptionPassWithRelations) {
    return {
      id: pass.id,
      providerName: pass.provider.name,
      displayName: pass.template.displayName,
      title: pass.templateVersion.title,
      hideTitle: readVersionHideTitle(pass.templateVersion.fields),
      allowTopUpIn: readAllowTopUpIn(pass.templateVersion.rules),
      allowTopUpOut: readAllowTopUpOut(pass.templateVersion.rules),
      category: pass.template.category,
      benefitType: pass.template.benefitType,
      status: pass.status,
      backgroundImageUrl: pass.templateVersion.backgroundImageUrl,
      publicNumber: pass.publicNumber,
      maskedNumber: pass.maskedNumber,
      balanceValue: pass.balanceValue.toString(),
      frozenValue: pass.frozenValue.toString(),
      overdraftLimit: pass.overdraftLimit.toString(),
      expiresAt: pass.expiresAt?.toISOString() ?? null,
      addedAt: pass.addedAt?.toISOString() ?? null,
      sortOrder: pass.sortOrder,
      updatedAt: pass.updatedAt.toISOString(),
    };
  }
}

function readVersionHideTitle(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { hideTitle?: unknown }).hideTitle === true;
}

function readAllowTopUpIn(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { allowTopUpIn?: unknown }).allowTopUpIn === true;
}

function readAllowTopUpOut(value: Prisma.JsonValue): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return (value as { allowTopUpOut?: unknown }).allowTopUpOut === true;
}

type RedemptionRequestWithRelations = Prisma.RedemptionRequestGetPayload<{
  include: ReturnType<RedemptionService['redemptionInclude']>;
}>;

type ProviderRedemptionPass = Prisma.PassGetPayload<{
  include: ReturnType<RedemptionService['providerRedemptionPassInclude']>;
}>;

type RedemptionPassWithRelations = RedemptionRequestWithRelations['pass'];
type RedemptionLedgerEntry = Prisma.LedgerEntryGetPayload<Record<string, never>>;

function readAllowedRedemptionProviderIds(value: Prisma.JsonValue): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const candidate = (value as { allowedRedemptionProviderIds?: unknown }).allowedRedemptionProviderIds;
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function normalizeCardNumber(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase();
}

function readProviderCardNumberLookup(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  try {
    const url = new URL(trimmedValue, 'https://ldpass.local');
    const cardNumber = url.searchParams.get('cardNumber');

    if (cardNumber) {
      return normalizeCardNumber(cardNumber);
    }
  } catch {
    // 解析失败时按原始输入继续尝试卡号。
  }

  return normalizeCardNumber(trimmedValue);
}

function canConsumeValue(balanceValue: string, frozenValue: string, overdraftLimit: string, requestedValue: string): boolean {
  const availableValue = parseFixedDecimal(balanceValue) - parseFixedDecimal(frozenValue) + parseFixedDecimal(overdraftLimit);
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

function compareDecimalStrings(firstValue: string, secondValue: string): number {
  const first = parseFixedDecimal(firstValue);
  const second = parseFixedDecimal(secondValue);
  return first === second ? 0 : first > second ? 1 : -1;
}

function normalizePositiveDecimal(value: string): string {
  const parsedValue = parseFixedDecimal(value);
  if (parsedValue <= 0n) {
    throw new BadRequestException('消耗值必须大于 0。');
  }

  return formatFixedDecimal(parsedValue);
}

function normalizeMaxVerificationAttempts(value: number | undefined): number {
  if (!Number.isInteger(value)) {
    return defaultMaxVerificationAttempts;
  }

  const integerValue = value ?? defaultMaxVerificationAttempts;
  return Math.min(Math.max(integerValue, 1), maximumVerificationAttempts);
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

function formatVerificationMethod(verificationMethod: 'server_account' | 'pin'): string {
  return verificationMethod === 'server_account' ? '服务器账号' : 'PIN';
}
