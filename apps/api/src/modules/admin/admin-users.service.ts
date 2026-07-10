import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '../../framework.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@ldpass/database';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import { SecretHashService } from '../../shared/auth/secret-hash.service.js';
import {
  anonymizeUserAuditLogs,
  createDeletedUserIdentity,
} from '../../shared/auth/user-anonymization.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { AdminUserSensitiveActionDto, AdminUsersQueryDto, ResetUserPasswordDto } from './dto.js';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretHash: SecretHashService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async listUsers(query: AdminUsersQueryDto) {
    const users = await this.prisma.user.findMany({
      where: this.buildUserWhere(query),
      orderBy: {
        updatedAt: 'desc',
      },
      take: this.readTake(query.take),
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        reviewInfo: true,
        reviewRejectedReason: true,
        registrationIp: true,
        registrationIpRegion: true,
        serverAccountName: true,
        serverAccountVerified: true,
        avatarUrl: true,
        pinHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      users: users.map((user) => this.toAdminUser(user)),
    };
  }

  async listPendingUsers() {
    const users = await this.prisma.user.findMany({
      where: {
        status: {
          in: ['PendingReview', 'WaitingServerVerification', 'Rejected'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        reviewInfo: true,
        reviewRejectedReason: true,
        registrationIp: true,
        registrationIpRegion: true,
        serverAccountName: true,
        serverAccountVerified: true,
        avatarUrl: true,
        pinHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      users: users.map((user) => this.toAdminUser(user)),
    };
  }

  async listPendingAvatarChangeRequests() {
    const requests = await this.prisma.userAvatarChangeRequest.findMany({
      where: {
        status: 'PendingReview',
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            status: true,
            avatarUrl: true,
            serverAccountName: true,
            serverAccountVerified: true,
          },
        },
      },
    });

    return {
      requests: requests.map((request) => this.toAvatarChangeRequestView(request)),
    };
  }

  async exportUsersCsv(query: AdminUsersQueryDto): Promise<string> {
    const users = await this.prisma.user.findMany({
      where: this.buildUserWhere(query),
      orderBy: {
        updatedAt: 'desc',
      },
      take: this.readExportTake(query.take),
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        status: true,
        reviewInfo: true,
        reviewRejectedReason: true,
        registrationIp: true,
        registrationIpRegion: true,
        serverAccountName: true,
        serverAccountVerified: true,
        avatarUrl: true,
        pinHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const columns: Array<CsvColumn<(typeof users)[number]>> = [
      { header: '用户ID', value: (user) => user.id },
      { header: '用户名', value: (user) => user.username },
      { header: '邮箱', value: (user) => user.email },
      { header: '角色', value: (user) => user.role },
      { header: '状态', value: (user) => user.status },
      { header: '审核信息', value: (user) => user.reviewInfo },
      { header: '审核反馈', value: (user) => user.reviewRejectedReason },
      { header: '注册IP', value: (user) => user.registrationIp },
      { header: 'IP属地', value: (user) => formatIpRegionForCsv(user.registrationIpRegion) },
      { header: '服务器ID', value: (user) => user.serverAccountName },
      { header: '服务器账号已验证', value: (user) => (user.serverAccountVerified ? '是' : '否') },
      { header: '当前头像', value: (user) => user.avatarUrl },
      { header: 'PIN已设置', value: (user) => (user.pinHash ? '是' : '否') },
      { header: '创建时间', value: (user) => formatCsvDate(user.createdAt) },
      { header: '更新时间', value: (user) => formatCsvDate(user.updatedAt) },
    ];

    return createCsv(columns, users);
  }

  async approveUser(userId: string, admin: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在。');
    }

    if (user.status === 'Active') {
      throw new BadRequestException('用户已经是可用状态。');
    }

    if (user.status === 'Suspended') {
      throw new BadRequestException('已封禁用户需要先解除封禁。');
    }

    if (user.status === 'Deleted') {
      throw new BadRequestException('已删除用户不能重新审核通过。');
    }

    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        status: 'Active',
        reviewRejectedReason: null,
      },
    });

    await this.eventBus.publish({
      type: 'UserRegistrationApproved',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        approvedBy: admin.id,
      },
    });

    await this.eventBus.publish({
      type: 'UserRegistered',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        loginIdentifierType: 'username',
        registrationPath: user.serverAccountVerified ? 'server_account_verified' : 'admin_approved',
      },
    });

    return {
      user: this.toPublicUser(updated),
    };
  }

  async rejectUser(userId: string, reason: string, admin: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在。');
    }

    if (user.status === 'Active') {
      throw new BadRequestException('可用账户不能直接拒绝注册。');
    }

    if (user.status === 'Suspended' || user.status === 'Deleted') {
      throw new BadRequestException('已封禁或已删除账户不能作为注册申请拒绝。');
    }

    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        status: 'Rejected',
        reviewRejectedReason: reason.trim(),
      },
    });

    await this.eventBus.publish({
      type: 'UserRegistrationRejected',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        rejectedBy: admin.id,
        reason: reason.trim(),
      },
    });

    return {
      user: this.toPublicUser(updated),
    };
  }

  async approveAvatarChangeRequest(requestId: string, admin: AuthenticatedUser) {
    const request = await this.readAvatarChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条头像申请已经处理。');
    }

    if (request.user.status === 'Deleted') {
      throw new BadRequestException('已删除用户不能继续变更头像。');
    }

    if (!request.proposedAvatarUrl) {
      throw new BadRequestException('头像申请缺少待审核链接。');
    }

    const now = new Date();
    const updatedRequest = await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: {
          id: request.userId,
        },
        data: {
          avatarUrl: request.proposedAvatarUrl,
        },
      });

      return transaction.userAvatarChangeRequest.update({
        where: {
          id: request.id,
        },
        data: {
          status: 'Approved',
          reviewedById: admin.id,
          reviewedAt: now,
          reviewReason: null,
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true,
              status: true,
              avatarUrl: true,
              serverAccountName: true,
              serverAccountVerified: true,
            },
          },
        },
      });
    });

    await this.eventBus.publish({
      type: 'UserAvatarChangeApproved',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        avatarChangeRequestId: request.id,
        userId: request.userId,
        currentAvatarUrl: request.currentAvatarUrl,
        proposedAvatarUrl: request.proposedAvatarUrl,
        approvedBy: admin.id,
      },
    });

    return {
      request: this.toAvatarChangeRequestView(updatedRequest),
    };
  }

  async rejectAvatarChangeRequest(requestId: string, reason: string, admin: AuthenticatedUser) {
    const request = await this.readAvatarChangeRequest(requestId);

    if (request.status !== 'PendingReview') {
      throw new BadRequestException('这条头像申请已经处理。');
    }

    const reviewReason = reason.trim();
    const now = new Date();
    const updatedRequest = await this.prisma.userAvatarChangeRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: 'Rejected',
        reviewedById: admin.id,
        reviewedAt: now,
        reviewReason,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            status: true,
            avatarUrl: true,
            serverAccountName: true,
            serverAccountVerified: true,
          },
        },
      },
    });

    await this.eventBus.publish({
      type: 'UserAvatarChangeRejected',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        avatarChangeRequestId: request.id,
        userId: request.userId,
        proposedAvatarUrl: request.proposedAvatarUrl ?? '',
        rejectedBy: admin.id,
        reason: reviewReason,
      },
    });

    return {
      request: this.toAvatarChangeRequestView(updatedRequest),
    };
  }

  async revertUserAvatar(userId: string, reason: string, admin: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在。');
    }

    if (user.status === 'Deleted') {
      throw new BadRequestException('已删除用户不能打回头像。');
    }

    if (!user.avatarUrl) {
      throw new BadRequestException('该用户当前没有自定义头像。');
    }

    const reviewReason = reason.trim();
    const now = new Date();
    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        avatarUrl: null,
      },
    });

    await this.eventBus.publish({
      type: 'UserAvatarReverted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        previousAvatarUrl: user.avatarUrl,
        revertedToAvatarUrl: null,
        revertedBy: admin.id,
        reason: reviewReason,
        source: 'admin_rejection',
      },
    });

    return {
      user: this.toAdminUser(updated),
    };
  }

  async resetUserPassword(userId: string, dto: ResetUserPasswordDto, admin: AuthenticatedUser) {
    const user = await this.readGovernableUser(userId, admin);

    if (user.status === 'Deleted') {
      throw new BadRequestException('已删除用户不能重置密码。');
    }

    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), now);
    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash: await this.secretHash.hashSecret(dto.password, 'password'),
      },
    });

    await this.eventBus.publish({
      type: 'CredentialChanged',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        credentialType: 'password',
        changedBy: 'admin',
      },
    });

    return {
      user: this.toPublicUser(updated),
    };
  }

  async suspendUser(userId: string, dto: AdminUserSensitiveActionDto, admin: AuthenticatedUser) {
    const user = await this.readGovernableUser(userId, admin);

    if (user.status === 'Suspended') {
      throw new BadRequestException('用户已经被封禁。');
    }

    if (user.status === 'Deleted') {
      throw new BadRequestException('已删除用户不能封禁。');
    }

    const reason = dto.reason.trim();
    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), now);

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          status: 'Suspended',
          reviewRejectedReason: reason,
        },
      });

      await tx.authSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await tx.device.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      return nextUser;
    });

    await this.eventBus.publish({
      type: 'UserSuspended',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        suspendedBy: admin.id,
        reason,
      },
    });

    return {
      user: this.toPublicUser(updated),
    };
  }

  async unsuspendUser(userId: string, dto: AdminUserSensitiveActionDto, admin: AuthenticatedUser) {
    const user = await this.readGovernableUser(userId, admin);

    if (user.status !== 'Suspended') {
      throw new BadRequestException('只有已封禁用户可以解除封禁。');
    }

    const reason = dto.reason.trim();
    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), now);

    const updated = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        status: 'Active',
        reviewRejectedReason: null,
      },
    });

    await this.eventBus.publish({
      type: 'UserUnsuspended',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        unsuspendedBy: admin.id,
        reason,
      },
    });

    return {
      user: this.toPublicUser(updated),
    };
  }

  async deleteUser(userId: string, dto: AdminUserSensitiveActionDto, admin: AuthenticatedUser) {
    const user = await this.readGovernableUser(userId, admin);

    if (user.status === 'Deleted') {
      throw new BadRequestException('用户已经处于删除状态。');
    }

    const reason = dto.reason.trim();
    const now = new Date();
    await this.verifyAdminPin(admin, dto.secondFactor, randomUUID(), now);
    const deletedIdentity = createDeletedUserIdentity(userId);

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextUser = await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          username: deletedIdentity.username,
          email: deletedIdentity.email,
          passwordHash: deletedIdentity.passwordHash,
          pinHash: null,
          status: 'Deleted',
          reviewInfo: null,
          reviewRejectedReason: reason,
          registrationIp: null,
          registrationIpRegion: Prisma.JsonNull,
          serverAccountName: null,
          serverAccountVerified: false,
          avatarUrl: null,
        },
      });

      await tx.serverVerificationChallenge.updateMany({
        where: {
          userId,
          status: 'active',
        },
        data: {
          status: 'cancelled',
        },
      });

      await tx.authSession.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await tx.device.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
        },
      });

      await anonymizeUserAuditLogs(tx, user, deletedIdentity);

      return nextUser;
    });

    await this.eventBus.publish({
      type: 'UserDeletedByAdmin',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        deletedBy: admin.id,
        reason,
        deletionMode: 'anonymize_and_release',
      },
    });

    await this.eventBus.publish({
      type: 'UserAccountDeleted',
      eventId: randomUUID(),
      occurredAt: now.toISOString(),
      actorType: 'admin',
      actorId: admin.id,
      payload: {
        userId,
        reason: 'admin_removed',
      },
    });

    await anonymizeUserAuditLogs(this.prisma, user, deletedIdentity);

    return {
      user: this.toPublicUser(updated),
    };
  }

  private buildUserWhere(query: AdminUsersQueryDto): Prisma.UserWhereInput {
    const keyword = query.keyword?.trim();
    if (!keyword) {
      return {};
    }

    return {
      OR: [
        {
          username: {
            contains: keyword,
          },
        },
        {
          email: {
            contains: keyword,
          },
        },
        {
          serverAccountName: {
            contains: keyword,
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

  private readExportTake(value: string | undefined): number {
    const parsedValue = Number.parseInt(value ?? '1000', 10);

    if (!Number.isFinite(parsedValue)) {
      return 1000;
    }

    return Math.min(Math.max(parsedValue, 1), 1000);
  }

  private async readGovernableUser(userId: string, admin: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在。');
    }

    if (user.id === admin.id) {
      throw new BadRequestException('不能在用户目录中处置当前登录的管理员账号。');
    }

    if (user.role !== 'user') {
      throw new BadRequestException('管理员账号不能通过用户目录封禁、解封或删除。');
    }

    return user;
  }

  private async readAvatarChangeRequest(requestId: string) {
    const request = await this.prisma.userAvatarChangeRequest.findUnique({
      where: {
        id: requestId,
      },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            status: true,
            avatarUrl: true,
            serverAccountName: true,
            serverAccountVerified: true,
          },
        },
      },
    });

    if (!request) {
      throw new NotFoundException('头像申请不存在。');
    }

    return request;
  }

  private async verifyAdminPin(admin: AuthenticatedUser, pin: string, challengeId: string, verifiedAt: Date): Promise<void> {
    const adminUser = await this.prisma.user.findUnique({
      where: {
        id: admin.id,
      },
      select: {
        pinHash: true,
      },
    });

    if (!adminUser?.pinHash) {
      throw new BadRequestException('管理员账户尚未设置 PIN，不能执行敏感操作。');
    }

    if (!(await this.secretHash.verifySecret(pin, adminUser.pinHash, 'pin'))) {
      throw new UnauthorizedException('管理员 PIN 不正确。');
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
        purpose: 'sensitive_action',
      },
    });
  }

  private toAdminUser(user: {
    id: string;
    username: string;
    email: string;
    role: string;
    status: string;
    reviewInfo: string | null;
    reviewRejectedReason: string | null;
    registrationIp: string | null;
    registrationIpRegion: unknown;
    serverAccountName: string | null;
    serverAccountVerified: boolean;
    avatarUrl: string | null;
    pinHash: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      reviewInfo: user.reviewInfo,
      reviewRejectedReason: user.reviewRejectedReason,
      registrationIp: user.registrationIp,
      registrationIpRegion: user.registrationIpRegion,
      serverAccountName: user.serverAccountName,
      serverAccountVerified: user.serverAccountVerified,
      avatarUrl: this.resolveUserAvatarUrl(user),
      avatarFallbackUrl: this.resolveUserAvatarFallbackUrl(user),
      customAvatarUrl: user.avatarUrl,
      hasPin: Boolean(user.pinHash),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private toAvatarChangeRequestView(request: {
    id: string;
    userId: string;
    status: string;
    currentAvatarUrl: string | null;
    proposedAvatarUrl: string | null;
    reason: string | null;
    reviewedById: string | null;
    reviewReason: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    user: {
      id: string;
      username: string;
      email: string;
      status: string;
      avatarUrl: string | null;
      serverAccountName: string | null;
      serverAccountVerified: boolean;
    };
  }) {
    return {
      id: request.id,
      userId: request.userId,
      status: request.status,
      currentAvatarUrl: request.currentAvatarUrl,
      proposedAvatarUrl: request.proposedAvatarUrl,
      reason: request.reason,
      reviewedById: request.reviewedById,
      reviewReason: request.reviewReason,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      user: {
        id: request.user.id,
        username: request.user.username,
        email: request.user.email,
        status: request.user.status,
        avatarUrl: this.resolveUserAvatarUrl(request.user),
        avatarFallbackUrl: this.resolveUserAvatarFallbackUrl(request.user),
        customAvatarUrl: request.user.avatarUrl,
      },
    };
  }

  private toPublicUser(user: {
    id: string;
    username: string;
    email: string;
    role: string;
    status: string;
    serverAccountVerified: boolean;
  }) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.status,
      serverAccountVerified: user.serverAccountVerified,
    };
  }

  private resolveUserAvatarUrl(user: {
    avatarUrl?: string | null;
    serverAccountName?: string | null;
    serverAccountVerified: boolean;
  }): string | null {
    return (
      user.avatarUrl ??
      this.buildMinecraftAvatarUrl(user.serverAccountName, user.serverAccountVerified, 'minotar-helm')
    );
  }

  private resolveUserAvatarFallbackUrl(user: {
    serverAccountName?: string | null;
    serverAccountVerified: boolean;
  }): string | null {
    return this.buildMinecraftAvatarUrl(user.serverAccountName, user.serverAccountVerified, 'minotar-avatar');
  }

  private buildMinecraftAvatarUrl(
    serverAccountName: string | null | undefined,
    verified: boolean,
    provider: 'minotar-helm' | 'minotar-avatar',
  ): string | null {
    const normalizedName = serverAccountName?.trim();
    if (!verified || !normalizedName) {
      return null;
    }

    const encodedName = encodeURIComponent(normalizedName);
    return provider === 'minotar-helm'
      ? `https://minotar.net/helm/${encodedName}`
      : `https://minotar.net/avatar/${encodedName}/64.png`;
  }
}

type CsvValue = string | number | boolean | null | undefined;

interface CsvColumn<TRow> {
  header: string;
  value: (row: TRow) => CsvValue;
  numeric?: boolean;
}

function createCsv<TRow>(columns: Array<CsvColumn<TRow>>, rows: TRow[]): string {
  const headerLine = columns.map((column) => escapeCsvValue(column.header)).join(',');
  const rowLines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(column.value(row), column.numeric === true)).join(','),
  );

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

function formatIpRegionForCsv(region: unknown): string {
  if (!region || typeof region !== 'object' || Array.isArray(region)) {
    return '';
  }

  const candidate = region as Record<string, unknown>;
  const parts = [candidate.country, candidate.provinceOrState, candidate.city]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter((part) => part.length > 0);

  return parts.join(' / ');
}
