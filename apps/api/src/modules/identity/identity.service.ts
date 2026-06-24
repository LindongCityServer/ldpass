import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { DeviceSystem, IpRegion } from '@ldpass/contracts';
import { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import { BdslmClientService } from '../bdslm/bdslm-client.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import {
  readClientIp,
  readHeader,
  type ApiRequestLike,
} from '../../shared/auth/request-context.js';
import { IpRegionService } from '../../shared/auth/ip-region.service.js';
import {
  readBdslmChatContent,
  readBdslmChatMessageId,
  readBdslmChatSender,
} from '../../shared/bdslm/chat-message.js';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import {
  anonymizeUserAuditLogs,
  createDeletedUserIdentity,
} from '../../shared/auth/user-anonymization.js';
import type {
  AdminLoginDto,
  LoginDto,
  RegisterReviewDto,
  RegisterServerStartDto,
  ResubmitReviewDto,
  StartServerAccountRebindDto,
  UpdateAccountPreferencesDto,
} from './dto.js';

const SERVER_VERIFICATION_TTL_MS = 10 * 60 * 1000;
const DEVICE_LOGIN_APPROVAL_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_DEVICES_PER_SYSTEM = 2;
type ServerVerificationPurpose =
  | 'registration'
  | 'login_device'
  | 'server_account_rebind'
  | 'pass_use'
  | 'pass_top_up';

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
  reviewInfo: string | null;
  reviewRejectedReason: string | null;
  serverAccountName: string | null;
  serverAccountVerified: boolean;
  avatarUrl: string | null;
  avatarFallbackUrl: string | null;
  expirationReminderDays: number;
}

interface ServerVerificationStartResult {
  user: PublicUser;
  nextAction?: 'send_code_in_server_chat';
  challenge: {
    id: string;
    serverId: string;
    code: string;
    expiresAt: string;
  };
}

export interface LoginRedirectValidationResult {
  clientApplication: {
    clientId: string;
    name: string;
  };
  redirectUri: string;
  state: string | null;
}

export interface ClientApplicationAccessResult {
  clientApplication: {
    clientId: string;
    name: string;
  };
  allowedOrigin: string | null;
}

export interface ClientSessionValidationResult {
  authenticated: boolean;
  clientApplication: {
    clientId: string;
    name: string;
  };
  user: PublicUser | null;
}

export interface ServerAccountRebindCheckResult {
  status: 'waiting' | 'verified' | 'rotated' | 'expired';
  user: PublicUser;
  challenge?: {
    id: string;
    code: string;
    expiresAt: string;
    serverId: string;
  };
}

export interface LoginDeviceResult {
  id: string;
  system: DeviceSystem;
  label: string | null;
  trustedUntil: Date | null;
  isNew: boolean;
}

interface LoginDeviceState {
  system: DeviceSystem;
  label: string;
  fingerprintHash: string;
  trustedUntil: Date;
  existingDevice: {
    id: string;
    revokedAt: Date | null;
  } | null;
  activeDeviceCount: number;
  activeSessionDeviceCount: number;
}

export interface LoginSuccessResult {
  user: PublicUser;
  loginIdentifierType: 'username' | 'email';
  device: LoginDeviceResult | null;
  nextAction: 'authenticated';
}

export interface LoginRestrictedResult {
  user: PublicUser;
  loginIdentifierType: 'username' | 'email';
  device: LoginDeviceResult | null;
  nextAction: 'account_status';
}

export interface LoginDeviceApprovalResult {
  id: string;
  deviceSystem: DeviceSystem;
  deviceLabel: string | null;
  expiresAt: string;
}

export interface LoginDeviceVerificationRequiredResult {
  user: PublicUser;
  loginIdentifierType: 'username' | 'email';
  device: null;
  nextAction: 'verify_new_device';
  challenge?: {
    id: string;
    serverId: string;
    code: string;
    expiresAt: string;
  };
  approval?: LoginDeviceApprovalResult;
}

export type LoginResult =
  | LoginSuccessResult
  | LoginRestrictedResult
  | LoginDeviceVerificationRequiredResult;

@Injectable()
export class IdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretHash: SecretHashService,
    private readonly bdslmClient: BdslmClientService,
    private readonly ipRegionService: IpRegionService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async registerForAdminReview(
    dto: RegisterReviewDto,
    request: ApiRequestLike,
  ): Promise<{ user: PublicUser }> {
    const username = dto.username.trim();
    const email = dto.email.trim().toLowerCase();
    const reviewInfo = dto.reviewInfo.trim();

    await this.ensureUniqueIdentity(username, email);

    const registrationIp = readClientIp(request);
    const registrationIpRegion = await this.ipRegionService.resolve(registrationIp);
    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        passwordHash: await this.secretHash.hashSecret(dto.password, 'password'),
        status: 'PendingReview',
        reviewInfo,
        registrationIp,
        registrationIpRegion: this.toRegistrationIpRegionJson(registrationIpRegion),
      },
    });

    await this.eventBus.publish({
      type: 'UserRegistrationSubmitted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        username: user.username,
        email: user.email,
        reviewInfo,
        registrationIp,
        ipRegion: registrationIpRegion,
        reviewMode: 'admin_review',
      },
    });

    return {
      user: this.toPublicUser(user),
    };
  }

  async startServerRegistration(
    dto: RegisterServerStartDto,
    request: ApiRequestLike,
  ): Promise<ServerVerificationStartResult> {
    const username = dto.username.trim();
    const email = dto.email.trim().toLowerCase();
    const serverId = dto.serverId.trim();

    await this.ensureUniqueIdentity(username, email);
    await this.ensureServerAccountAvailable(serverId);

    const lastCheckedChatId = await this.readLatestChatId();
    const code = this.createReadableCode();
    const expiresAt = new Date(Date.now() + SERVER_VERIFICATION_TTL_MS);
    const registrationIp = readClientIp(request);
    const registrationIpRegion = await this.ipRegionService.resolve(registrationIp);
    const user = await this.prisma.user.create({
      data: {
        username,
        email,
        passwordHash: await this.secretHash.hashSecret(dto.password, 'password'),
        status: 'WaitingServerVerification',
        reviewInfo: `服务器账号验证：${serverId}`,
        registrationIp,
        registrationIpRegion: this.toRegistrationIpRegionJson(registrationIpRegion),
        serverAccountName: serverId,
        serverChallenges: {
          create: {
            serverId,
            purpose: 'registration',
            codeHash: await this.secretHash.hashSecret(code, 'server-verification-code'),
            lastCheckedChatId,
            expiresAt,
          },
        },
      },
      include: {
        serverChallenges: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    const challenge = user.serverChallenges[0];
    if (!challenge) {
      throw new Error('Server verification challenge was not created.');
    }

    await this.eventBus.publish({
      type: 'UserRegistrationSubmitted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        username: user.username,
        email: user.email,
        reviewInfo: user.reviewInfo ?? '',
        registrationIp,
        ipRegion: registrationIpRegion,
        reviewMode: 'server_account_verification',
      },
    });

    await this.eventBus.publish({
      type: 'ServerVerificationCodeIssued',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: 'system',
      payload: {
        userId: user.id,
        serverId,
        verificationId: challenge.id,
        expiresAt: expiresAt.toISOString(),
        purpose: 'registration',
      },
    });

    return {
      user: this.toPublicUser(user),
      nextAction: 'send_code_in_server_chat',
      challenge: {
        id: challenge.id,
        serverId,
        code,
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async login(dto: LoginDto, request?: ApiRequestLike): Promise<LoginResult> {
    const identifier = dto.identifier.trim();
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findUnique({
      where: isEmail ? { email: identifier.toLowerCase() } : { username: identifier },
    });

    if (
      !user ||
      !(await this.secretHash.verifySecret(dto.password, user.passwordHash, 'password'))
    ) {
      throw new UnauthorizedException('用户名、邮箱或密码不正确。');
    }

    if (user.status === 'Deleted') {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    if (user.status !== 'Active') {
      const device = await this.bindLoginDevice(user.id, dto, request);

      await this.eventBus.publish({
        type: 'UserLoggedIn',
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        actorType: 'user',
        actorId: user.id,
        payload: {
          userId: user.id,
          ...(device ? { deviceId: device.id } : {}),
          accountStatus: user.status,
          restricted: true,
        },
      });

      return {
        user: this.toPublicUser(user),
        loginIdentifierType: isEmail ? 'email' : 'username',
        device,
        nextAction: 'account_status',
      };
    }

    const deviceState = await this.readLoginDeviceState(user.id, dto, request);
    if (this.requiresNewDeviceVerification(deviceState)) {
      const approval =
        deviceState.activeSessionDeviceCount > 0
          ? await this.createDeviceLoginApproval(user.id, deviceState, request)
          : undefined;
      const challenge =
        user.serverAccountVerified && user.serverAccountName
          ? await this.createServerVerificationChallenge(
              user.id,
              user.serverAccountName,
              'login_device',
            )
          : undefined;

      if (!approval && !challenge) {
        throw new UnauthorizedException(
          '新设备登录需要服务器账号验证或已登录设备确认。当前账户暂无可用验证方式，请联系管理员处理。',
        );
      }

      return {
        user: this.toPublicUser(user),
        loginIdentifierType: isEmail ? 'email' : 'username',
        device: null,
        nextAction: 'verify_new_device',
        ...(challenge ? { challenge } : {}),
        ...(approval ? { approval } : {}),
      };
    }

    const device = await this.bindLoginDevice(user.id, dto, request);

    await this.eventBus.publish({
      type: 'UserLoggedIn',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        ...(device ? { deviceId: device.id } : {}),
      },
    });

    return {
      user: this.toPublicUser(user),
      loginIdentifierType: isEmail ? 'email' : 'username',
      device,
      nextAction: 'authenticated',
    };
  }

  async validateLoginRedirect(query: {
    client_id?: string;
    redirect_uri?: string;
    state?: string;
  }): Promise<LoginRedirectValidationResult> {
    const clientId = query.client_id?.trim();
    const redirectUri = query.redirect_uri?.trim();

    if (!clientId || !redirectUri) {
      throw new BadRequestException('缺少 client_id 或 redirect_uri。');
    }

    const application = await this.prisma.clientApplication.findUnique({
      where: {
        clientId,
      },
    });

    if (!application || !application.enabled) {
      throw new BadRequestException('客户端应用不存在或已停用。');
    }

    const normalizedRedirectUri = this.normalizeRedirectUri(redirectUri);
    const allowedRedirects = this.readStringArray(application.allowedRedirects);

    if (!allowedRedirects.includes(normalizedRedirectUri)) {
      throw new BadRequestException('redirect_uri 不在客户端应用允许列表中。');
    }

    return {
      clientApplication: {
        clientId: application.clientId,
        name: application.name,
      },
      redirectUri: normalizedRedirectUri,
      state: query.state ?? null,
    };
  }

  async validateClientApplicationAccess(
    query: {
      client_id?: string;
    },
    request: ApiRequestLike,
  ): Promise<ClientApplicationAccessResult> {
    const clientId = query.client_id?.trim();
    if (!clientId) {
      throw new BadRequestException('缺少 client_id。');
    }

    const application = await this.prisma.clientApplication.findUnique({
      where: {
        clientId,
      },
    });

    if (!application || !application.enabled) {
      throw new BadRequestException('客户端应用不存在或已停用。');
    }

    const origin = this.readRequestOrigin(request);
    if (origin) {
      const allowedOrigins = this.readStringArray(application.allowedOrigins);
      if (!allowedOrigins.includes(origin)) {
        throw new BadRequestException('请求来源不在客户端应用允许列表中。');
      }
    }

    return {
      clientApplication: {
        clientId: application.clientId,
        name: application.name,
      },
      allowedOrigin: origin,
    };
  }

  createClientSessionValidationResult(
    access: ClientApplicationAccessResult,
    user: AuthenticatedUser | null,
  ): ClientSessionValidationResult {
    const activeUser = user?.status === 'Active' ? user : null;

    return {
      authenticated: Boolean(activeUser),
      clientApplication: access.clientApplication,
      user: activeUser
        ? {
            id: activeUser.id,
            username: activeUser.username,
            email: activeUser.email,
            role: activeUser.role,
            status: activeUser.status,
            reviewInfo: activeUser.reviewInfo,
            reviewRejectedReason: activeUser.reviewRejectedReason,
            serverAccountName: activeUser.serverAccountName,
            serverAccountVerified: activeUser.serverAccountVerified,
            avatarUrl: this.buildMinecraftAvatarUrl(activeUser.serverAccountName, activeUser.serverAccountVerified, 'mc-heads'),
            avatarFallbackUrl: this.buildMinecraftAvatarUrl(activeUser.serverAccountName, activeUser.serverAccountVerified, 'minotar'),
            expirationReminderDays: activeUser.expirationReminderDays,
          }
        : null,
    };
  }

  async resubmitReviewInfo(
    user: AuthenticatedUser,
    dto: ResubmitReviewDto,
    request: ApiRequestLike,
  ): Promise<{ user: PublicUser }> {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    if (existingUser.role !== 'user') {
      throw new BadRequestException('管理员账户不能提交普通用户注册审核信息。');
    }

    if (existingUser.status !== 'Rejected' && existingUser.status !== 'PendingReview') {
      throw new BadRequestException('当前账户状态不能重新提交审核信息。');
    }

    const reviewInfo = dto.reviewInfo.trim();
    const registrationIp = readClientIp(request);
    const registrationIpRegion = await this.ipRegionService.resolve(registrationIp);
    const updatedUser = await this.prisma.user.update({
      where: {
        id: existingUser.id,
      },
      data: {
        status: 'PendingReview',
        reviewInfo,
        reviewRejectedReason: null,
        registrationIp,
        registrationIpRegion: this.toRegistrationIpRegionJson(registrationIpRegion),
      },
    });

    await this.eventBus.publish({
      type: 'UserRegistrationSubmitted',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: updatedUser.id,
      payload: {
        userId: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        reviewInfo,
        registrationIp,
        ipRegion: registrationIpRegion,
        reviewMode: 'admin_review',
        resubmitted: true,
        previousStatus: existingUser.status,
      },
    });

    return {
      user: this.toPublicUser(updatedUser),
    };
  }

  async adminLogin(
    dto: AdminLoginDto,
    request?: ApiRequestLike,
  ): Promise<{ user: PublicUser; device: LoginDeviceResult | null }> {
    const identifier = dto.identifier.trim();
    const isEmail = identifier.includes('@');
    const user = await this.prisma.user.findUnique({
      where: isEmail ? { email: identifier.toLowerCase() } : { username: identifier },
    });

    if (
      !user ||
      !(await this.secretHash.verifySecret(dto.password, user.passwordHash, 'password'))
    ) {
      throw new UnauthorizedException('用户名、邮箱或密码不正确。');
    }

    if (user.status !== 'Active') {
      throw new UnauthorizedException('账户尚未激活，请等待审核或完成服务器验证。');
    }

    if (user.role !== 'admin' && user.role !== 'super_admin') {
      throw new UnauthorizedException('该账户没有管理员权限。');
    }

    if (!user.pinHash) {
      throw new UnauthorizedException(
        '管理员账号尚未设置 PIN，请先通过 seed:super-admin 配置 SEED_ADMIN_PIN。',
      );
    }

    const pinVerificationId = randomUUID();
    if (!(await this.secretHash.verifySecret(dto.secondFactor, user.pinHash, 'pin'))) {
      throw new UnauthorizedException('管理员 PIN 不正确。');
    }

    const device = await this.bindLoginDevice(user.id, dto, request);

    await this.eventBus.publish({
      type: 'PinVerificationSucceeded',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: user.id,
      payload: {
        userId: user.id,
        challengeId: pinVerificationId,
        purpose: 'login',
      },
    });

    await this.eventBus.publish({
      type: 'UserLoggedIn',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: user.id,
      payload: {
        userId: user.id,
        ...(device ? { deviceId: device.id } : {}),
      },
    });

    return {
      user: this.toPublicUser(user),
      device,
    };
  }

  async deleteOwnAccount(user: AuthenticatedUser, password: string): Promise<{ ok: true }> {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    if (existingUser.role !== 'user') {
      throw new BadRequestException('管理员账户不能通过普通账户注销入口删除。');
    }

    if (existingUser.status === 'Deleted') {
      throw new BadRequestException('账户已经处于删除状态。');
    }

    if (!(await this.secretHash.verifySecret(password, existingUser.passwordHash, 'password'))) {
      throw new UnauthorizedException('密码不正确，无法注销账户。');
    }

    const now = new Date();

    const deletedIdentity = createDeletedUserIdentity(user.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          username: deletedIdentity.username,
          email: deletedIdentity.email,
          passwordHash: deletedIdentity.passwordHash,
          pinHash: null,
          status: 'Deleted',
          reviewInfo: null,
          reviewRejectedReason: 'self_requested',
          registrationIp: null,
          registrationIpRegion: Prisma.JsonNull,
          serverAccountName: null,
          serverAccountVerified: false,
        },
      });

      await tx.serverVerificationChallenge.updateMany({
        where: {
          userId: user.id,
          status: 'active',
        },
        data: {
          status: 'cancelled',
        },
      });

      await tx.authSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await tx.device.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await anonymizeUserAuditLogs(tx, existingUser, deletedIdentity);
    });

    await this.eventBus.publish({
      type: 'UserAccountDeleted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        reason: 'self_requested',
      },
    });

    await anonymizeUserAuditLogs(this.prisma, existingUser, deletedIdentity);

    return {
      ok: true,
    };
  }

  async setPin(user: AuthenticatedUser, password: string, pin: string): Promise<{ ok: true }> {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    if (!(await this.secretHash.verifySecret(password, existingUser.passwordHash, 'password'))) {
      throw new UnauthorizedException('当前密码不正确，无法设置 PIN。');
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        pinHash: await this.secretHash.hashSecret(pin, 'pin'),
      },
    });

    await this.eventBus.publish({
      type: 'CredentialChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        credentialType: 'pin',
        changedBy: 'self',
      },
    });

    return {
      ok: true,
    };
  }

  async changePassword(
    user: AuthenticatedUser,
    currentPassword: string,
    nextPassword: string,
  ): Promise<{ ok: true }> {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    if (!(await this.secretHash.verifySecret(currentPassword, existingUser.passwordHash, 'password'))) {
      throw new UnauthorizedException('当前密码不正确，无法修改密码。');
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        passwordHash: await this.secretHash.hashSecret(nextPassword, 'password'),
      },
    });

    await this.eventBus.publish({
      type: 'CredentialChanged',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        credentialType: 'password',
        changedBy: 'self',
      },
    });

    return {
      ok: true,
    };
  }

  async startServerAccountRebind(
    user: AuthenticatedUser,
    dto: StartServerAccountRebindDto,
  ): Promise<ServerVerificationStartResult> {
    const serverId = dto.serverId.trim();

    if (user.serverAccountName === serverId && user.serverAccountVerified) {
      throw new BadRequestException('这个服务器账号已经绑定到当前账户。');
    }

    await this.ensureServerAccountAvailable(serverId, user.id);

    const challenge = await this.createServerVerificationChallenge(
      user.id,
      serverId,
      'server_account_rebind',
    );
    const latestUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });

    if (!latestUser) {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    return {
      user: this.toPublicUser(latestUser),
      nextAction: 'send_code_in_server_chat',
      challenge,
    };
  }

  async checkServerAccountRebind(
    user: AuthenticatedUser,
    challengeId: string,
    currentSessionId: string,
    currentDeviceId: string | null,
  ): Promise<ServerAccountRebindCheckResult> {
    const challenge = await this.prisma.serverVerificationChallenge.findUnique({
      where: {
        id: challengeId,
      },
      include: {
        user: true,
      },
    });

    if (!challenge) {
      throw new BadRequestException('服务器账号换绑请求不存在。');
    }

    if (challenge.userId !== user.id) {
      throw new UnauthorizedException('服务器账号换绑请求不属于当前账户。');
    }

    if (challenge.purpose !== 'server_account_rebind') {
      throw new BadRequestException('服务器验证请求类型不匹配。');
    }

    if (challenge.status !== 'active') {
      return {
        status: challenge.status === 'verified' ? 'verified' : 'waiting',
        user: this.toPublicUser(challenge.user),
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
        user: this.toPublicUser(challenge.user),
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
        await this.ensureServerAccountAvailable(challenge.serverId, user.id);

        const now = new Date();
        const previousServerId = challenge.user.serverAccountName ?? '';
        const devicesToRevoke = await this.prisma.device.findMany({
          where: {
            userId: user.id,
            revokedAt: null,
            ...(currentDeviceId ? { id: { not: currentDeviceId } } : {}),
          },
          select: {
            id: true,
          },
        });
        const revokedDeviceIds = devicesToRevoke.map((device) => device.id);

        const updatedUser = await this.prisma.$transaction(async (tx) => {
          await tx.serverVerificationChallenge.update({
            where: {
              id: challenge.id,
            },
            data: {
              status: 'verified',
              lastCheckedChatId: nextLastCheckedChatId,
            },
          });

          if (revokedDeviceIds.length > 0) {
            await tx.device.updateMany({
              where: {
                id: {
                  in: revokedDeviceIds,
                },
              },
              data: {
                revokedAt: now,
              },
            });
          }

          await tx.authSession.updateMany({
            where: {
              userId: user.id,
              id: {
                not: currentSessionId,
              },
              revokedAt: null,
            },
            data: {
              revokedAt: now,
            },
          });

          return tx.user.update({
            where: {
              id: user.id,
            },
            data: {
              serverAccountName: challenge.serverId,
              serverAccountVerified: true,
            },
          });
        });

        await this.eventBus.publish({
          type: 'ServerAccountVerified',
          eventId: randomUUID(),
          occurredAt: now.toISOString(),
          actorType: 'user',
          actorId: user.id,
          payload: {
            userId: user.id,
            serverId: challenge.serverId,
            verificationId: challenge.id,
          },
        });

        await this.eventBus.publish({
          type: 'ServerAccountRebound',
          eventId: randomUUID(),
          occurredAt: now.toISOString(),
          actorType: 'user',
          actorId: user.id,
          payload: {
            userId: user.id,
            previousServerId,
            nextServerId: challenge.serverId,
            revokedDeviceIds,
          },
        });

        return {
          status: 'verified',
          user: this.toPublicUser(updatedUser),
        };
      }
    }

    if (matchingMessages.length > 0) {
      const rotated = await this.rotateServerVerificationCode(
        challenge,
        nextLastCheckedChatId,
        'chat_mismatch',
      );
      return {
        status: 'rotated',
        user: this.toPublicUser(challenge.user),
        challenge: rotated,
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
      user: this.toPublicUser(challenge.user),
    };
  }

  async updateAccountPreferences(
    user: AuthenticatedUser,
    dto: UpdateAccountPreferencesDto,
  ): Promise<{ user: PublicUser }> {
    const existingUser = await this.prisma.user.findUnique({
      where: {
        id: user.id,
      },
    });

    if (!existingUser) {
      throw new UnauthorizedException('账户不存在或已经被删除。');
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        expirationReminderDays: dto.expirationReminderDays,
      },
    });

    await this.eventBus.publish({
      type: 'UserPreferencesUpdated',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        expirationReminderDays: updatedUser.expirationReminderDays,
        previousExpirationReminderDays: existingUser.expirationReminderDays,
      },
    });

    return {
      user: this.toPublicUser(updatedUser),
    };
  }

  async listDevices(user: AuthenticatedUser) {
    const devices = await this.prisma.device.findMany({
      where: {
        userId: user.id,
      },
      orderBy: [{ revokedAt: 'asc' }, { updatedAt: 'desc' }],
      include: {
        sessions: {
          where: {
            revokedAt: null,
            expiresAt: {
              gt: new Date(),
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            ipAddress: true,
            createdAt: true,
          },
        },
      },
    });
    const ipRegions = await this.ipRegionService.resolveMany(
      devices.map((device) => device.sessions[0]?.ipAddress),
    );

    return {
      devices: devices.map((device) => {
        const latestSession = device.sessions[0] ?? null;
        const latestIpAddress = latestSession?.ipAddress ?? null;

        return {
          id: device.id,
          system: device.system,
          label: device.label,
          trustedUntil: device.trustedUntil?.toISOString() ?? null,
          revokedAt: device.revokedAt?.toISOString() ?? null,
          activeSessionCount: device.sessions.length,
          lastLoginIp: latestIpAddress,
          lastLoginIpRegion: latestIpAddress ? ipRegions.get(latestIpAddress) ?? null : null,
          lastLoginAt: latestSession?.createdAt.toISOString() ?? null,
          createdAt: device.createdAt.toISOString(),
          updatedAt: device.updatedAt.toISOString(),
        };
      }),
    };
  }

  async revokeDevice(user: AuthenticatedUser, deviceId: string): Promise<{ ok: true }> {
    const device = await this.prisma.device.findFirst({
      where: {
        id: deviceId,
        userId: user.id,
      },
    });

    if (!device) {
      throw new NotFoundException('设备不存在或不属于当前账户。');
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.device.update({
        where: {
          id: device.id,
        },
        data: {
          revokedAt: now,
        },
      }),
      this.prisma.authSession.updateMany({
        where: {
          userId: user.id,
          deviceId: device.id,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      }),
    ]);

    return {
      ok: true,
    };
  }

  async listDeviceLoginApprovals(user: AuthenticatedUser): Promise<{
    approvals: Array<
      LoginDeviceApprovalResult & {
        ipAddress: string | null;
        ipRegion: IpRegion | null;
        createdAt: string;
      }
    >;
  }> {
    await this.expirePendingDeviceLoginApprovals(user.id);

    const approvals = await this.prisma.deviceLoginApproval.findMany({
      where: {
        userId: user.id,
        status: 'pending',
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    const ipRegions = await this.ipRegionService.resolveMany(approvals.map((approval) => approval.ipAddress));

    return {
      approvals: approvals.map((approval) => ({
        ...this.toLoginDeviceApproval(approval),
        ipAddress: approval.ipAddress,
        ipRegion: approval.ipAddress ? ipRegions.get(approval.ipAddress) ?? null : null,
        createdAt: approval.createdAt.toISOString(),
      })),
    };
  }

  async approveDeviceLoginApproval(
    user: AuthenticatedUser,
    approvalId: string,
  ): Promise<{ approval: LoginDeviceApprovalResult }> {
    const approval = await this.readPendingDeviceLoginApproval(user.id, approvalId);
    const now = new Date();
    const updatedApproval = await this.prisma.deviceLoginApproval.update({
      where: {
        id: approval.id,
      },
      data: {
        status: 'approved',
        respondedAt: now,
      },
    });

    await this.eventBus.publish({
      type: 'DeviceLoginApprovalApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        approvalId: updatedApproval.id,
        userId: updatedApproval.userId,
        approvedBy: user.id,
      },
    });

    return {
      approval: this.toLoginDeviceApproval(updatedApproval),
    };
  }

  async rejectDeviceLoginApproval(
    user: AuthenticatedUser,
    approvalId: string,
  ): Promise<{ approval: LoginDeviceApprovalResult }> {
    const approval = await this.readPendingDeviceLoginApproval(user.id, approvalId);
    const now = new Date();
    const updatedApproval = await this.prisma.deviceLoginApproval.update({
      where: {
        id: approval.id,
      },
      data: {
        status: 'rejected',
        respondedAt: now,
      },
    });

    await this.eventBus.publish({
      type: 'DeviceLoginApprovalRejected',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        approvalId: updatedApproval.id,
        userId: updatedApproval.userId,
        rejectedBy: user.id,
      },
    });

    return {
      approval: this.toLoginDeviceApproval(updatedApproval),
    };
  }

  async checkServerRegistration(challengeId: string): Promise<{
    status: 'waiting' | 'verified' | 'rotated' | 'expired';
    user: PublicUser;
    sessionReady?: boolean;
    challenge?: {
      id: string;
      code: string;
      expiresAt: string;
      serverId: string;
    };
  }> {
    const challenge = await this.prisma.serverVerificationChallenge.findUnique({
      where: {
        id: challengeId,
      },
      include: {
        user: true,
      },
    });

    if (!challenge) {
      throw new BadRequestException('服务器验证请求不存在。');
    }

    if (challenge.purpose !== 'registration') {
      throw new BadRequestException('服务器验证请求类型不匹配。');
    }

    if (challenge.status !== 'active') {
      return {
        status: challenge.status === 'verified' ? 'verified' : 'waiting',
        user: this.toPublicUser(challenge.user),
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
        user: this.toPublicUser(challenge.user),
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
        await this.ensureServerAccountAvailable(challenge.serverId, challenge.userId);

        const user = await this.prisma.user.update({
          where: {
            id: challenge.userId,
          },
          data: {
            status: 'Active',
            serverAccountVerified: true,
            serverAccountName: challenge.serverId,
            serverChallenges: {
              update: {
                where: {
                  id: challenge.id,
                },
                data: {
                  status: 'verified',
                  lastCheckedChatId: nextLastCheckedChatId,
                },
              },
            },
          },
        });

        await this.eventBus.publish({
          type: 'ServerAccountVerified',
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          actorType: 'user',
          actorId: user.id,
          payload: {
            userId: user.id,
            serverId: challenge.serverId,
            verificationId: challenge.id,
          },
        });

        await this.eventBus.publish({
          type: 'UserRegistered',
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          actorType: 'user',
          actorId: user.id,
          payload: {
            userId: user.id,
            loginIdentifierType: 'username',
            registrationPath: 'server_account_verified',
          },
        });

        return {
          status: 'verified',
          user: this.toPublicUser(user),
          sessionReady: true,
        };
      }
    }

    if (matchingMessages.length > 0) {
      const rotated = await this.rotateServerVerificationCode(
        challenge,
        nextLastCheckedChatId,
        'chat_mismatch',
      );
      return {
        status: 'rotated',
        user: this.toPublicUser(challenge.user),
        challenge: rotated,
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
      user: this.toPublicUser(challenge.user),
    };
  }

  async checkDeviceLoginVerification(
    challengeId: string,
    dto: LoginDto,
    request?: ApiRequestLike,
  ): Promise<LoginResult> {
    const identifier = dto.identifier.trim();
    const isEmail = identifier.includes('@');
    const challenge = await this.prisma.serverVerificationChallenge.findUnique({
      where: {
        id: challengeId,
      },
      include: {
        user: true,
      },
    });

    if (!challenge) {
      throw new BadRequestException('新设备验证请求不存在。');
    }

    if (challenge.purpose !== 'login_device') {
      throw new BadRequestException('服务器验证请求类型不匹配。');
    }

    const user = challenge.user;
    const identifierMatches = isEmail
      ? user.email === identifier.toLowerCase()
      : user.username === identifier;
    if (
      !identifierMatches ||
      !(await this.secretHash.verifySecret(dto.password, user.passwordHash, 'password'))
    ) {
      throw new UnauthorizedException('用户名、邮箱或密码不正确。');
    }

    if (user.status !== 'Active') {
      throw new UnauthorizedException('账户尚未激活，请等待审核或完成服务器验证。');
    }

    if (challenge.status !== 'active') {
      if (challenge.status === 'verified') {
        throw new UnauthorizedException('这次新设备验证已经完成，请重新登录。');
      }

      return {
        user: this.toPublicUser(user),
        loginIdentifierType: isEmail ? 'email' : 'username',
        device: null,
        nextAction: 'verify_new_device',
        challenge: {
          id: challenge.id,
          serverId: challenge.serverId,
          code: '',
          expiresAt: challenge.expiresAt.toISOString(),
        },
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

      throw new UnauthorizedException('新设备验证码已过期，请重新登录并获取新验证码。');
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

        const deviceState = await this.readLoginDeviceState(user.id, dto, request);
        const device = await this.bindLoginDevice(user.id, dto, request);
        await this.completePendingDeviceLoginApprovals(user.id, deviceState.fingerprintHash);

        if (device) {
          await this.eventBus.publish({
            type: 'DeviceLoginVerified',
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            actorType: 'user',
            actorId: user.id,
            payload: {
              userId: user.id,
              deviceId: device.id,
              serverId: challenge.serverId,
              verificationId: challenge.id,
            },
          });
        }

        await this.eventBus.publish({
          type: 'UserLoggedIn',
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          actorType: 'user',
          actorId: user.id,
          payload: {
            userId: user.id,
            ...(device ? { deviceId: device.id } : {}),
          },
        });

        return {
          user: this.toPublicUser(user),
          loginIdentifierType: isEmail ? 'email' : 'username',
          device,
          nextAction: 'authenticated',
        };
      }
    }

    if (matchingMessages.length > 0) {
      const rotated = await this.rotateServerVerificationCode(
        challenge,
        nextLastCheckedChatId,
        'chat_mismatch',
      );
      return {
        user: this.toPublicUser(user),
        loginIdentifierType: isEmail ? 'email' : 'username',
        device: null,
        nextAction: 'verify_new_device',
        challenge: rotated,
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
      user: this.toPublicUser(user),
      loginIdentifierType: isEmail ? 'email' : 'username',
      device: null,
      nextAction: 'verify_new_device',
      challenge: {
        id: challenge.id,
        serverId: challenge.serverId,
        code: '',
        expiresAt: challenge.expiresAt.toISOString(),
      },
    };
  }

  async checkDeviceLoginApproval(
    approvalId: string,
    dto: LoginDto,
    request?: ApiRequestLike,
  ): Promise<LoginResult> {
    const identifier = dto.identifier.trim();
    const isEmail = identifier.includes('@');
    const approval = await this.prisma.deviceLoginApproval.findUnique({
      where: {
        id: approvalId,
      },
      include: {
        user: true,
      },
    });

    if (!approval) {
      throw new BadRequestException('新设备确认请求不存在。');
    }

    const user = approval.user;
    const identifierMatches = isEmail
      ? user.email === identifier.toLowerCase()
      : user.username === identifier;
    if (
      !identifierMatches ||
      !(await this.secretHash.verifySecret(dto.password, user.passwordHash, 'password'))
    ) {
      throw new UnauthorizedException('用户名、邮箱或密码不正确。');
    }

    if (user.status !== 'Active') {
      throw new UnauthorizedException('账户尚未激活，请等待审核或完成服务器验证。');
    }

    const deviceState = await this.readLoginDeviceState(user.id, dto, request);
    if (deviceState.fingerprintHash !== approval.fingerprintHash) {
      throw new UnauthorizedException('这次确认请求不属于当前设备，请重新登录发起新的确认。');
    }

    const now = new Date();
    if (approval.status === 'pending') {
      if (approval.expiresAt <= now) {
        await this.prisma.deviceLoginApproval.update({
          where: {
            id: approval.id,
          },
          data: {
            status: 'expired',
            respondedAt: now,
          },
        });
        throw new UnauthorizedException('新设备确认请求已过期，请重新登录。');
      }

      return {
        user: this.toPublicUser(user),
        loginIdentifierType: isEmail ? 'email' : 'username',
        device: null,
        nextAction: 'verify_new_device',
        approval: this.toLoginDeviceApproval(approval),
      };
    }

    if (approval.status === 'rejected') {
      throw new UnauthorizedException('新设备登录已被拒绝。');
    }

    if (approval.status === 'expired') {
      throw new UnauthorizedException('新设备确认请求已过期，请重新登录。');
    }

    if (approval.status === 'completed') {
      throw new UnauthorizedException('这次新设备确认已经完成，请重新登录。');
    }

    if (approval.expiresAt <= now) {
      await this.prisma.deviceLoginApproval.update({
        where: {
          id: approval.id,
        },
        data: {
          status: 'expired',
          respondedAt: now,
        },
      });
      throw new UnauthorizedException('新设备确认请求已过期，请重新登录。');
    }

    const device = await this.bindLoginDevice(user.id, dto, request);
    await this.prisma.deviceLoginApproval.update({
      where: {
        id: approval.id,
      },
      data: {
        status: 'completed',
        respondedAt: now,
      },
    });

    await this.eventBus.publish({
      type: 'UserLoggedIn',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        ...(device ? { deviceId: device.id } : {}),
      },
    });

    return {
      user: this.toPublicUser(user),
      loginIdentifierType: isEmail ? 'email' : 'username',
      device,
      nextAction: 'authenticated',
    };
  }

  private async ensureUniqueIdentity(username: string, email: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ username }, { email }],
      },
      select: {
        username: true,
        email: true,
      },
    });

    if (!existing) {
      return;
    }

    if (existing.username === username) {
      throw new ConflictException('用户名已被占用。');
    }

    throw new ConflictException('邮箱已被占用。');
  }

  private async ensureServerAccountAvailable(
    serverId: string,
    allowedUserId?: string,
  ): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: {
        serverAccountName: serverId,
        serverAccountVerified: true,
        ...(allowedUserId ? { id: { not: allowedUserId } } : {}),
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      throw new ConflictException('这个服务器 ID 已经绑定到其他账户。');
    }
  }

  private async readLoginDeviceState(
    userId: string,
    dto: LoginDto,
    request: ApiRequestLike | undefined,
  ): Promise<LoginDeviceState> {
    const system = dto.deviceSystem ?? this.detectDeviceSystem(request);
    const label = (dto.deviceLabel?.trim() || this.defaultDeviceLabel(system, request)).slice(
      0,
      80,
    );
    const clientDeviceId = dto.clientDeviceId?.trim() || this.createFallbackClientDeviceId(request);
    const fingerprintHash = this.hashDeviceFingerprint(userId, clientDeviceId);
    const trustedUntil = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

    const existingDevice = await this.prisma.device.findUnique({
      where: {
        userId_fingerprintHash: {
          userId,
          fingerprintHash,
        },
      },
    });

    const activeDeviceCount = await this.prisma.device.count({
      where: {
        userId,
        system,
        revokedAt: null,
      },
    });

    const activeSessionDeviceCount = await this.prisma.authSession.count({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
        device: {
          is: {
            revokedAt: null,
          },
        },
      },
    });

    return {
      system,
      label,
      fingerprintHash,
      trustedUntil,
      existingDevice,
      activeDeviceCount,
      activeSessionDeviceCount,
    };
  }

  private requiresNewDeviceVerification(deviceState: LoginDeviceState): boolean {
    if (deviceState.existingDevice && !deviceState.existingDevice.revokedAt) {
      return false;
    }

    if (deviceState.activeDeviceCount === 0) {
      return false;
    }

    if (deviceState.activeDeviceCount >= MAX_ACTIVE_DEVICES_PER_SYSTEM) {
      throw new UnauthorizedException('该系统下已绑定 2 台设备，请先在账户页撤销旧设备后再登录。');
    }

    return true;
  }

  private async createDeviceLoginApproval(
    userId: string,
    deviceState: LoginDeviceState,
    request: ApiRequestLike | undefined,
  ): Promise<LoginDeviceApprovalResult> {
    await this.expirePendingDeviceLoginApprovals(userId);

    const existingApproval = await this.prisma.deviceLoginApproval.findFirst({
      where: {
        userId,
        fingerprintHash: deviceState.fingerprintHash,
        status: 'pending',
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (existingApproval) {
      return this.toLoginDeviceApproval(existingApproval);
    }

    const expiresAt = new Date(Date.now() + DEVICE_LOGIN_APPROVAL_TTL_MS);
    const approval = await this.prisma.deviceLoginApproval.create({
      data: {
        userId,
        fingerprintHash: deviceState.fingerprintHash,
        deviceSystem: deviceState.system,
        deviceLabel: deviceState.label,
        ipAddress: request ? readClientIp(request) : null,
        expiresAt,
      },
    });

    await this.eventBus.publish({
      type: 'DeviceLoginApprovalRequested',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: 'system',
      payload: {
        approvalId: approval.id,
        userId,
        deviceSystem: approval.deviceSystem,
        ...(approval.deviceLabel ? { deviceLabel: approval.deviceLabel } : {}),
        expiresAt: approval.expiresAt.toISOString(),
      },
    });

    return this.toLoginDeviceApproval(approval);
  }

  private async readPendingDeviceLoginApproval(userId: string, approvalId: string) {
    const approval = await this.prisma.deviceLoginApproval.findFirst({
      where: {
        id: approvalId,
        userId,
      },
    });

    if (!approval) {
      throw new NotFoundException('新设备确认请求不存在或不属于当前账户。');
    }

    if (approval.status !== 'pending') {
      throw new BadRequestException('这次新设备确认请求已经处理过。');
    }

    if (approval.expiresAt <= new Date()) {
      await this.prisma.deviceLoginApproval.update({
        where: {
          id: approval.id,
        },
        data: {
          status: 'expired',
          respondedAt: new Date(),
        },
      });
      throw new BadRequestException('新设备确认请求已过期，请让新设备重新登录。');
    }

    return approval;
  }

  private async expirePendingDeviceLoginApprovals(userId?: string): Promise<void> {
    await this.prisma.deviceLoginApproval.updateMany({
      where: {
        ...(userId ? { userId } : {}),
        status: 'pending',
        expiresAt: {
          lte: new Date(),
        },
      },
      data: {
        status: 'expired',
        respondedAt: new Date(),
      },
    });
  }

  private async completePendingDeviceLoginApprovals(
    userId: string,
    fingerprintHash: string,
  ): Promise<void> {
    await this.prisma.deviceLoginApproval.updateMany({
      where: {
        userId,
        fingerprintHash,
        status: 'pending',
      },
      data: {
        status: 'completed',
        respondedAt: new Date(),
      },
    });
  }

  private toLoginDeviceApproval(approval: {
    id: string;
    deviceSystem: DeviceSystem;
    deviceLabel: string | null;
    expiresAt: Date;
  }): LoginDeviceApprovalResult {
    return {
      id: approval.id,
      deviceSystem: approval.deviceSystem,
      deviceLabel: approval.deviceLabel,
      expiresAt: approval.expiresAt.toISOString(),
    };
  }

  private async createServerVerificationChallenge(
    userId: string,
    serverId: string,
    purpose: ServerVerificationPurpose,
  ): Promise<{
    id: string;
    code: string;
    expiresAt: string;
    serverId: string;
  }> {
    const lastCheckedChatId = await this.readLatestChatId();
    const code = this.createReadableCode();
    const expiresAt = new Date(Date.now() + SERVER_VERIFICATION_TTL_MS);
    const challenge = await this.prisma.serverVerificationChallenge.create({
      data: {
        userId,
        serverId,
        purpose,
        codeHash: await this.secretHash.hashSecret(code, 'server-verification-code'),
        lastCheckedChatId,
        expiresAt,
      },
    });

    await this.eventBus.publish({
      type: 'ServerVerificationCodeIssued',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: purpose === 'login_device' ? 'system' : 'user',
      actorId: purpose === 'login_device' ? 'system' : userId,
      payload: {
        userId,
        serverId,
        verificationId: challenge.id,
        expiresAt: expiresAt.toISOString(),
        purpose,
      },
    });

    return {
      id: challenge.id,
      code,
      expiresAt: expiresAt.toISOString(),
      serverId,
    };
  }

  private async bindLoginDevice(
    userId: string,
    dto: LoginDto,
    request: ApiRequestLike | undefined,
  ): Promise<LoginDeviceResult | null> {
    const { system, label, fingerprintHash, trustedUntil, existingDevice, activeDeviceCount } =
      await this.readLoginDeviceState(userId, dto, request);

    if (existingDevice && !existingDevice.revokedAt) {
      const updatedDevice = await this.prisma.device.update({
        where: {
          id: existingDevice.id,
        },
        data: {
          system,
          label,
          trustedUntil,
        },
      });

      return {
        id: updatedDevice.id,
        system: updatedDevice.system,
        label: updatedDevice.label,
        trustedUntil: updatedDevice.trustedUntil,
        isNew: false,
      };
    }

    if (activeDeviceCount >= MAX_ACTIVE_DEVICES_PER_SYSTEM) {
      throw new UnauthorizedException('该系统下已绑定 2 台设备，请先在账户页撤销旧设备后再登录。');
    }

    const device = existingDevice
      ? await this.prisma.device.update({
          where: {
            id: existingDevice.id,
          },
          data: {
            system,
            label,
            trustedUntil,
            revokedAt: null,
          },
        })
      : await this.prisma.device.create({
          data: {
            userId,
            system,
            label,
            fingerprintHash,
            trustedUntil,
          },
        });

    await this.eventBus.publish({
      type: 'DeviceBound',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: userId,
      payload: {
        userId,
        deviceId: device.id,
        deviceSystem: device.system,
        ...(device.label ? { deviceLabel: device.label } : {}),
        ...(device.trustedUntil ? { trustedUntil: device.trustedUntil.toISOString() } : {}),
      },
    });

    return {
      id: device.id,
      system: device.system,
      label: device.label,
      trustedUntil: device.trustedUntil,
      isNew: true,
    };
  }

  private hashDeviceFingerprint(userId: string, clientDeviceId: string): string {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
      throw new Error('SESSION_SECRET is not configured.');
    }

    return createHmac('sha256', secret)
      .update(`device:${userId}:${clientDeviceId}`)
      .digest('base64url');
  }

  private normalizeRedirectUri(value: string): string {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('redirect_uri 必须是完整 URL。');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new BadRequestException('redirect_uri 只支持 http 或 https。');
    }

    return url.toString();
  }

  private readRequestOrigin(request: ApiRequestLike): string | null {
    const origin = readHeader(request, 'origin');
    if (!origin) {
      return null;
    }

    try {
      return new URL(origin).origin;
    } catch {
      throw new BadRequestException('请求来源不是有效 Origin。');
    }
  }

  private readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string');
  }

  private toRegistrationIpRegionJson(region: IpRegion): Prisma.InputJsonObject {
    return {
      source: region.source,
      ...(region.country ? { country: region.country } : {}),
      ...(region.provinceOrState ? { provinceOrState: region.provinceOrState } : {}),
      ...(region.city ? { city: region.city } : {}),
      ...(region.address ? { address: region.address } : {}),
    };
  }

  private createFallbackClientDeviceId(request: ApiRequestLike | undefined): string {
    const userAgent = request
      ? (request.headers?.['user-agent'] ?? request.headers?.['User-Agent'] ?? '')
      : '';
    const ip = request ? readClientIp(request) : 'unknown';
    return `fallback:${String(userAgent)}:${ip}`;
  }

  private detectDeviceSystem(request: ApiRequestLike | undefined): DeviceSystem {
    const userAgent = request
      ? String(
          request.headers?.['user-agent'] ?? request.headers?.['User-Agent'] ?? '',
        ).toLowerCase()
      : '';

    if (userAgent.includes('android')) {
      return 'android';
    }

    if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ios')) {
      return 'ios';
    }

    if (userAgent.includes('windows')) {
      return 'windows';
    }

    if (userAgent.includes('mac os') || userAgent.includes('macintosh')) {
      return 'macos';
    }

    if (userAgent.includes('linux')) {
      return 'linux';
    }

    return 'other';
  }

  private defaultDeviceLabel(system: DeviceSystem, request: ApiRequestLike | undefined): string {
    const userAgent = request
      ? String(request.headers?.['user-agent'] ?? request.headers?.['User-Agent'] ?? '')
      : '';
    const labels: Record<DeviceSystem, string> = {
      android: 'Android 设备',
      ios: 'iOS 设备',
      windows: 'Windows 设备',
      macos: 'macOS 设备',
      linux: 'Linux 设备',
      other: '未知设备',
    };

    return userAgent ? `${labels[system]} · ${userAgent.slice(0, 36)}` : labels[system];
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

  private async rotateServerVerificationCode(
    challenge: {
      id: string;
      userId: string;
      serverId: string;
      purpose: ServerVerificationPurpose;
      expiresAt: Date;
    },
    lastCheckedChatId: number,
    reason: 'chat_mismatch' | 'manual_refresh' | 'expired' | 'rate_limit_retry',
  ): Promise<{
    id: string;
    code: string;
    expiresAt: string;
    serverId: string;
  }> {
    const code = this.createReadableCode();
    const expiresAt = new Date(Date.now() + SERVER_VERIFICATION_TTL_MS);

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
          purpose: challenge.purpose,
          codeHash: await this.secretHash.hashSecret(code, 'server-verification-code'),
          lastCheckedChatId,
          expiresAt,
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
        purpose: nextChallenge.purpose,
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
        purpose: nextChallenge.purpose,
      },
    });

    return {
      id: nextChallenge.id,
      code,
      expiresAt: expiresAt.toISOString(),
      serverId: challenge.serverId,
    };
  }

  private toPublicUser(user: {
    id: string;
    username: string;
    email: string;
    role: string;
    status: string;
    reviewInfo?: string | null;
    reviewRejectedReason?: string | null;
    serverAccountName?: string | null;
    serverAccountVerified: boolean;
    expirationReminderDays: number;
  }): PublicUser {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      reviewInfo: user.reviewInfo ?? null,
      reviewRejectedReason: user.reviewRejectedReason ?? null,
      serverAccountName: user.serverAccountName ?? null,
      serverAccountVerified: user.serverAccountVerified,
      avatarUrl: this.buildMinecraftAvatarUrl(user.serverAccountName, user.serverAccountVerified, 'mc-heads'),
      avatarFallbackUrl: this.buildMinecraftAvatarUrl(user.serverAccountName, user.serverAccountVerified, 'minotar'),
      expirationReminderDays: user.expirationReminderDays,
    };
  }

  private buildMinecraftAvatarUrl(
    serverAccountName: string | null | undefined,
    verified: boolean,
    provider: 'mc-heads' | 'minotar',
  ): string | null {
    const normalizedName = serverAccountName?.trim();
    if (!verified || !normalizedName) {
      return null;
    }

    const encodedName = encodeURIComponent(normalizedName);
    return provider === 'mc-heads'
      ? `https://mc-heads.net/avatar/${encodedName}/64.png`
      : `https://minotar.net/avatar/${encodedName}/64.png`;
  }
}
