import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '../../framework.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { YctQqLinkFailureReason, YctQqLinkScope } from '@ldpass/contracts';
import type { EventBus } from '@ldpass/event-bus';
import { EVENT_BUS } from '@ldpass/event-bus';
import type { Prisma } from '@ldpass/database';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { AuthenticatedUser } from '../../shared/auth/session-auth.service.js';
import {
  readClientIp,
  readHeader,
  type ApiRequestLike,
} from '../../shared/auth/request-context.js';
import {
  createQqLinkCode,
  createQqLinkConfirmCode,
  createQqLinkToken,
  fingerprintQqLinkCode,
  hashQqLinkCode,
  hashQqLinkToken,
  hashQqOpenId,
  maskQqOpenId,
  normalizeQqLinkCode,
  normalizeQqLinkConfirmCode,
  normalizeQqLinkToken,
  normalizeQqOpenId,
  safeEqualText,
} from './qq-link-crypto.js';
import { throwQqLinkError } from './qq-link-errors.js';
import {
  isQqLinkCodeIssueAllowed,
  isQqLinkConsumeAllowed,
  isQqLinkGroupConfirmAllowed,
  isQqLinkTokenConfirmAllowed,
  isQqLinkTokenIssueAllowed,
  recordQqLinkCodeIssue,
  recordQqLinkConsumeFailure,
  recordQqLinkGroupConfirmFailure,
  recordQqLinkTokenConfirmFailure,
  recordQqLinkTokenIssue,
} from './qq-link-throttle.js';
import type {
  ClaimGroupQqLinkTokenDto,
  ConfirmGroupQqLinkTokenDto,
  ConfirmQqLinkTokenDto,
  ConsumeQqLinkCodeDto,
  IssueQqLinkTokenDto,
  ResolveQqLinkQueryDto,
  UnlinkQqLinkDto,
} from './dto.js';

const codeTtlMs = 10 * 60 * 1000;
const tokenTtlMs = 5 * 60 * 1000;
const qqBotActorId = 'qq_bot';

export interface QqLinkListItem {
  id: string;
  scope: YctQqLinkScope;
  groupOpenId: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface QqLinkCodeResult {
  code: string;
  expiresAt: string;
}

export interface QqBotLinkView {
  id: string;
  ldpassUserId: string;
  username: string;
  scope: YctQqLinkScope;
  groupOpenId: string | null;
}

export interface QqLinkConsumeResult {
  ok: true;
  link: {
    id: string;
    ldpassUserId: string;
    username: string;
    scope: YctQqLinkScope;
    createdAt: string;
  };
}

export interface QqLinkResolveResult {
  ok: true;
  link: QqBotLinkView | null;
}

export interface QqLinkTokenIssueResult {
  ok: true;
  url: string;
  expiresAt: string;
}

export interface QqLinkTokenInspectResult {
  ok: true;
  token: {
    scope: YctQqLinkScope;
    expiresAt: string;
    requiresGroupConfirmation: boolean;
  };
}

export interface QqLinkGroupClaimResult {
  ok: true;
  scope: 'group';
  /** 6 位数字，仅展示给已登录的网页；不会写入数据库或日志。 */
  confirmCode: string;
  expiresAt: string;
}

export interface QqLinkGroupConfirmResult {
  ok: true;
  link: {
    id: string;
    ldpassUserId: string;
    username: string;
    scope: 'group';
    groupOpenId: string;
    createdAt: string;
  };
}

export interface QqLinkTokenConfirmResult {
  ok: true;
  link: {
    id: string;
    scope: YctQqLinkScope;
    createdAt: string;
  };
}

type ConsumeOutcome =
  | {
      kind: 'success';
      link: {
        id: string;
        ldpassUserId: string;
        username: string;
        createdAt: Date;
        scope: YctQqLinkScope;
      };
      created: boolean;
    }
  | {
      kind: 'failure';
      reason: YctQqLinkFailureReason;
    };

type GroupConfirmOutcome =
  | {
      kind: 'success';
      link: {
        id: string;
        ldpassUserId: string;
        username: string;
        groupOpenId: string;
        createdAt: Date;
      };
      created: boolean;
    }
  | {
      kind: 'failure';
      reason: YctQqLinkFailureReason;
    };

@Injectable()
export class QqLinksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_BUS) private readonly eventBus: EventBus,
  ) {}

  async issueCode(user: AuthenticatedUser, request: ApiRequestLike): Promise<QqLinkCodeResult> {
    const ip = readClientIp(request);

    if (!isQqLinkCodeIssueAllowed(user.id, ip)) {
      throwQqLinkError('rate_limited', '生成绑定码过于频繁，请稍后再试。');
    }

    const generated = createQqLinkCode();
    const expiresAt = new Date(Date.now() + codeTtlMs);
    const codeHash = hashQqLinkCode(generated.normalizedCode);
    const code = await this.createActiveCode(user.id, codeHash, expiresAt);

    recordQqLinkCodeIssue(user.id, ip);

    await this.eventBus.publish({
      type: 'QqLinkCodeIssued',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        userId: user.id,
        codeId: code.id,
        scope: 'c2c',
        expiresAt: expiresAt.toISOString(),
      },
    });

    return {
      code: generated.displayCode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listLinks(user: AuthenticatedUser): Promise<{ links: QqLinkListItem[] }> {
    const links = await this.prisma.yctQqLink.findMany({
      where: {
        ldpassUserId: user.id,
        status: 'active',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      links: links.map((link) => ({
        id: link.id,
        scope: link.qqScope,
        groupOpenId: link.groupOpenId ? maskQqOpenId(link.groupOpenId) : null,
        createdAt: link.createdAt.toISOString(),
        lastSeenAt: link.lastSeenAt?.toISOString() ?? null,
      })),
    };
  }

  async revokeLink(user: AuthenticatedUser, linkId: string): Promise<{ ok: true }> {
    const link = await this.prisma.yctQqLink.findFirst({
      where: {
        id: linkId,
        ldpassUserId: user.id,
        status: 'active',
      },
      select: {
        id: true,
        qqScope: true,
        groupOpenId: true,
      },
    });

    if (!link) {
      throw new NotFoundException('QQ 绑定不存在或不属于当前账户。');
    }

    const result = await this.prisma.yctQqLink.updateMany({
      where: {
        id: link.id,
        ldpassUserId: user.id,
        status: 'active',
      },
      data: {
        status: 'revoked',
        activeKey: null,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('QQ 绑定不存在或不属于当前账户。');
    }

    await this.eventBus.publish({
      type: 'QqLinkRevoked',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        qqLinkId: link.id,
        userId: user.id,
        scope: link.qqScope,
        revokedBy: 'user',
        ...(link.groupOpenId ? { groupOpenIdMasked: maskQqOpenId(link.groupOpenId) } : {}),
      },
    });

    return { ok: true };
  }

  async consumeCode(dto: ConsumeQqLinkCodeDto): Promise<QqLinkConsumeResult> {
    const scope = dto.scope;
    const openId = normalizeQqOpenId(dto.openId);

    if (scope !== 'c2c') {
      await this.publishCodeConsumeFailure('group_not_supported', scope, openId ?? 'invalid', {
        codeFingerprint: this.readCodeFingerprint(dto.code),
      });
      throwQqLinkError(
        'group_not_supported',
        '群聊绑定请使用群内 /绑定 获取网页链接，不支持直接消费网页绑定码。',
      );
    }

    if (!openId) {
      await this.publishCodeConsumeFailure('invalid_request', scope, 'invalid', {
        codeFingerprint: this.readCodeFingerprint(dto.code),
      });
      throwQqLinkError('invalid_request', 'openId 参数不正确。');
    }

    if (dto.groupOpenId?.trim()) {
      await this.publishCodeConsumeFailure('invalid_request', scope, openId);
      throwQqLinkError('invalid_request', 'c2c 绑定不能携带 groupOpenId。');
    }

    if (!isQqLinkConsumeAllowed(openId)) {
      throwQqLinkError('rate_limited', '绑定码尝试次数过多，请稍后再试。');
    }

    const normalizedCode = normalizeQqLinkCode(dto.code);
    if (!normalizedCode) {
      recordQqLinkConsumeFailure(openId);
      await this.publishCodeConsumeFailure('code_invalid', scope, openId, {
        codeFingerprint: this.readCodeFingerprint(dto.code),
      });
      throwQqLinkError('code_invalid', '绑定码无效，请在临东通网页重新生成。');
    }

    const codeHash = hashQqLinkCode(normalizedCode);
    const codeRecord = await this.prisma.yctQqLinkCode.findUnique({
      where: {
        codeHash,
      },
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    if (!codeRecord || !safeEqualText(codeRecord.codeHash, codeHash)) {
      recordQqLinkConsumeFailure(openId);
      await this.publishCodeConsumeFailure('code_invalid', scope, openId);
      throwQqLinkError('code_invalid', '绑定码无效，请在临东通网页重新生成。');
    }

    if (codeRecord.status === 'used') {
      await this.publishCodeConsumeFailure('code_used', scope, openId, {
        codeId: codeRecord.id,
      });
      throwQqLinkError('code_used', '绑定码已被使用，请在临东通网页重新生成。');
    }

    if (codeRecord.status === 'expired') {
      await this.publishCodeConsumeFailure('code_expired', scope, openId, {
        codeId: codeRecord.id,
      });
      throwQqLinkError('code_expired', '绑定码已过期，请在临东通网页重新生成。');
    }

    if (codeRecord.status !== 'active') {
      await this.publishCodeConsumeFailure('code_invalid', scope, openId, {
        codeId: codeRecord.id,
      });
      throwQqLinkError('code_invalid', '绑定码已失效，请在临东通网页重新生成。');
    }

    const now = new Date();
    if (codeRecord.expiresAt <= now) {
      await this.prisma.yctQqLinkCode.updateMany({
        where: {
          id: codeRecord.id,
          status: 'active',
        },
        data: {
          status: 'expired',
          activeUserId: null,
        },
      });
      await this.publishCodeConsumeFailure('code_expired', scope, openId, {
        codeId: codeRecord.id,
      });
      throwQqLinkError('code_expired', '绑定码已过期，请在临东通网页重新生成。');
    }

    let outcome: ConsumeOutcome;

    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.yctQqLink.findUnique({
          where: {
            activeKey: createQqLinkActiveKey('c2c', openId, null),
          },
        });

        // 同一个 openid 在任意 scope/群里都不能绑定到另一个临东通账号。
        const conflicting = await tx.yctQqLink.findFirst({
          where: {
            qqOpenId: openId,
            status: 'active',
            ldpassUserId: {
              not: codeRecord.ldpassUserId,
            },
          },
          select: {
            id: true,
          },
        });

        if (conflicting) {
          return { kind: 'failure', reason: 'openid_already_linked' };
        }

        if (existing) {
          if (existing.ldpassUserId !== codeRecord.ldpassUserId) {
            return { kind: 'failure', reason: 'openid_already_linked' };
          }

          if (existing.qqScope !== 'c2c' || existing.groupOpenId !== null) {
            return { kind: 'failure', reason: 'link_conflict' };
          }

          const consumed = await this.consumeCodeRecord(tx, codeRecord.id);
          if (!consumed) {
            const latest = await tx.yctQqLinkCode.findUnique({
              where: {
                id: codeRecord.id,
              },
            });
            return {
              kind: 'failure',
              reason: latest?.status === 'used' ? 'code_used' : 'code_expired',
            };
          }

          const updated = await tx.yctQqLink.update({
            where: {
              id: existing.id,
            },
            data: {
              lastSeenAt: now,
            },
          });

          return {
            kind: 'success',
            link: {
              id: updated.id,
              ldpassUserId: updated.ldpassUserId,
              username: codeRecord.user.username,
              createdAt: updated.createdAt,
              scope: 'c2c',
            },
            created: false,
          };
        }

        const consumed = await this.consumeCodeRecord(tx, codeRecord.id);
        if (!consumed) {
          const latest = await tx.yctQqLinkCode.findUnique({
            where: {
              id: codeRecord.id,
            },
          });
          return {
            kind: 'failure',
            reason: latest?.status === 'used' ? 'code_used' : 'code_expired',
          };
        }

        const link = await tx.yctQqLink.create({
          data: {
            id: createQqLinkId(),
            ldpassUserId: codeRecord.ldpassUserId,
            qqOpenId: openId,
            qqScope: 'c2c',
            groupOpenId: null,
            status: 'active',
            activeKey: createQqLinkActiveKey('c2c', openId, null),
            lastSeenAt: now,
          },
        });

        return {
          kind: 'success',
          link: {
            id: link.id,
            ldpassUserId: link.ldpassUserId,
            username: codeRecord.user.username,
            createdAt: link.createdAt,
            scope: 'c2c',
          },
          created: true,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      outcome = await this.resolveConcurrentConsume(codeRecord.id, openId, codeRecord.ldpassUserId);
    }

    if (outcome.kind === 'failure') {
      recordQqLinkConsumeFailure(openId);
      await this.publishCodeConsumeFailure(outcome.reason, scope, openId, {
        codeId: codeRecord.id,
      });
      throwQqLinkError(outcome.reason, this.readFailureMessage(outcome.reason));
    }

    await this.eventBus.publish({
      type: 'QqLinkCodeConsumeSucceeded',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: qqBotActorId,
      payload: {
        qqLinkId: outcome.link.id,
        codeId: codeRecord.id,
        userId: outcome.link.ldpassUserId,
        scope: 'c2c',
        openIdHash: hashQqOpenId(openId),
        openIdMasked: maskQqOpenId(openId),
        created: outcome.created,
      },
    });

    return {
      ok: true,
      link: {
        id: outcome.link.id,
        ldpassUserId: outcome.link.ldpassUserId,
        username: outcome.link.username,
        scope: 'c2c',
        createdAt: outcome.link.createdAt.toISOString(),
      },
    };
  }

  async resolveLink(query: ResolveQqLinkQueryDto): Promise<QqLinkResolveResult> {
    const scope = query.scope ?? 'c2c';
    const identityResult = readQqLinkIdentity(scope, query.openId, query.groupOpenId);

    if (!identityResult.ok) {
      throwQqLinkError('invalid_request', identityResult.message);
    }

    const identity = identityResult.identity;
    const link = await this.prisma.yctQqLink.findUnique({
      where: {
        activeKey: createQqLinkActiveKey(identity.scope, identity.openId, identity.groupOpenId),
      },
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    if (!link || link.status !== 'active' || link.qqScope !== identity.scope) {
      return {
        ok: true,
        link: null,
      };
    }

    await this.prisma.yctQqLink.update({
      where: {
        id: link.id,
      },
      data: {
        lastSeenAt: new Date(),
      },
    });

    return {
      ok: true,
      link: {
        id: link.id,
        ldpassUserId: link.ldpassUserId,
        username: link.user.username,
        scope: link.qqScope,
        groupOpenId: link.groupOpenId,
      },
    };
  }

  async unlinkByBot(dto: UnlinkQqLinkDto): Promise<{ ok: true }> {
    const scope = dto.scope;
    const identityResult = readQqLinkIdentity(scope, dto.openId, dto.groupOpenId);

    if (!identityResult.ok) {
      await this.publishUnlinkFailure(
        'invalid_request',
        scope,
        normalizeQqOpenId(dto.openId) ?? 'invalid',
        dto.groupOpenId?.trim() || undefined,
      );
      throwQqLinkError('invalid_request', identityResult.message);
    }

    const identity = identityResult.identity;
    const link = await this.prisma.yctQqLink.findUnique({
      where: {
        activeKey: createQqLinkActiveKey(identity.scope, identity.openId, identity.groupOpenId),
      },
    });

    if (!link || link.status !== 'active' || link.qqScope !== identity.scope) {
      await this.publishUnlinkFailure(
        'not_linked',
        identity.scope,
        identity.openId,
        identity.groupOpenId ?? undefined,
      );
      return { ok: true };
    }

    const revoked = await this.prisma.yctQqLink.updateMany({
      where: {
        id: link.id,
        status: 'active',
      },
      data: {
        status: 'revoked',
        activeKey: null,
      },
    });

    if (revoked.count === 0) {
      await this.publishUnlinkFailure(
        'not_linked',
        identity.scope,
        identity.openId,
        identity.groupOpenId ?? undefined,
      );
      return { ok: true };
    }

    await this.eventBus.publish({
      type: 'QqLinkRevoked',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: qqBotActorId,
      payload: {
        qqLinkId: link.id,
        userId: link.ldpassUserId,
        scope: identity.scope,
        revokedBy: 'qq_bot',
        ...(link.groupOpenId ? { groupOpenIdMasked: maskQqOpenId(link.groupOpenId) } : {}),
      },
    });

    return { ok: true };
  }

  async issueToken(
    dto: IssueQqLinkTokenDto,
    request: ApiRequestLike,
  ): Promise<QqLinkTokenIssueResult> {
    const identityResult = readQqLinkIdentity(dto.scope, dto.openId, dto.groupOpenId);

    if (!identityResult.ok) {
      throwQqLinkError('invalid_request', identityResult.message);
    }

    const identity = identityResult.identity;
    const throttleKey = createQqLinkTokenThrottleKey(identity);

    if (!isQqLinkTokenIssueAllowed(throttleKey)) {
      throwQqLinkError('rate_limited', '生成绑定链接过于频繁，请稍后再试。');
    }

    const origin = this.readPublicOrigin(request);
    const token = createQqLinkToken();
    const tokenHash = hashQqLinkToken(token);
    const expiresAt = new Date(Date.now() + tokenTtlMs);
    const record = await this.prisma.yctQqLinkToken.create({
      data: {
        tokenHash,
        qqOpenId: identity.openId,
        qqScope: identity.scope,
        groupOpenId: identity.groupOpenId,
        status: 'active',
        expiresAt,
      },
    });

    recordQqLinkTokenIssue(throttleKey);

    const url = `${origin}/account/link/qq?token=${encodeURIComponent(token)}`;

    await this.eventBus.publish({
      type: 'QqLinkTokenIssued',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: qqBotActorId,
      payload: {
        tokenId: record.id,
        scope: identity.scope,
        expiresAt: expiresAt.toISOString(),
        openIdHash: hashQqOpenId(identity.openId),
        openIdMasked: maskQqOpenId(identity.openId),
        ...(identity.groupOpenId
          ? {
              groupOpenIdHash: hashQqOpenId(identity.groupOpenId),
              groupOpenIdMasked: maskQqOpenId(identity.groupOpenId),
            }
          : {}),
      },
    });

    return {
      ok: true,
      url,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async inspectToken(token: string): Promise<QqLinkTokenInspectResult> {
    const normalizedToken = normalizeQqLinkToken(token);
    if (!normalizedToken) {
      throwQqLinkError('token_invalid', '绑定链接无效，请让机器人在私聊中重新发起。');
    }

    const tokenHash = hashQqLinkToken(normalizedToken);
    const record = await this.prisma.yctQqLinkToken.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!record || !safeEqualText(record.tokenHash, tokenHash)) {
      throwQqLinkError('token_invalid', '绑定链接无效，请让机器人重新发起绑定。');
    }

    if (record.status === 'used') {
      throwQqLinkError('token_used', '绑定链接已被使用，请让机器人重新发起。');
    }

    if (record.status === 'expired') {
      throwQqLinkError('token_expired', '绑定链接已过期，请让机器人重新发起绑定。');
    }

    if (record.status !== 'active') {
      throwQqLinkError('token_invalid', '绑定链接已失效，请让机器人重新发起。');
    }

    if (record.expiresAt <= new Date()) {
      await this.prisma.yctQqLinkToken.updateMany({
        where: {
          id: record.id,
          status: 'active',
        },
        data: {
          status: 'expired',
        },
      });
      throwQqLinkError('token_expired', '绑定链接已过期，请让机器人重新发起绑定。');
    }

    return {
      ok: true,
      token: {
        scope: record.qqScope,
        expiresAt: record.expiresAt.toISOString(),
        requiresGroupConfirmation: record.qqScope === 'group',
      },
    };
  }

  async confirmToken(
    user: AuthenticatedUser,
    dto: ConfirmQqLinkTokenDto,
  ): Promise<QqLinkTokenConfirmResult> {
    if (!isQqLinkTokenConfirmAllowed(user.id)) {
      throwQqLinkError('rate_limited', '操作过于频繁，请稍后再试。');
    }

    const normalizedToken = normalizeQqLinkToken(dto.token);
    if (!normalizedToken) {
      recordQqLinkTokenConfirmFailure(user.id);
      await this.publishTokenConsumeFailure('token_invalid', 'c2c', user.id);
      throwQqLinkError('token_invalid', '绑定链接无效，请让机器人重新发起绑定。');
    }

    const tokenHash = hashQqLinkToken(normalizedToken);
    const record = await this.prisma.yctQqLinkToken.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!record || !safeEqualText(record.tokenHash, tokenHash)) {
      recordQqLinkTokenConfirmFailure(user.id);
      await this.publishTokenConsumeFailure('token_invalid', 'c2c', user.id);
      throwQqLinkError('token_invalid', '绑定链接无效，请让机器人重新发起绑定。');
    }

    if (record.status === 'used') {
      await this.publishTokenConsumeFailure('token_used', record.qqScope, user.id, record.id);
      throwQqLinkError('token_used', '绑定链接已被使用，请让机器人重新发起。');
    }

    if (record.status === 'expired') {
      await this.publishTokenConsumeFailure('token_expired', record.qqScope, user.id, record.id);
      throwQqLinkError('token_expired', '绑定链接已过期，请让机器人重新发起绑定。');
    }

    if (record.status !== 'active') {
      await this.publishTokenConsumeFailure('token_invalid', record.qqScope, user.id, record.id);
      throwQqLinkError('token_invalid', '绑定链接已失效，请让机器人重新发起。');
    }

    const now = new Date();
    if (record.expiresAt <= now) {
      await this.prisma.yctQqLinkToken.updateMany({
        where: {
          id: record.id,
          status: 'active',
        },
        data: {
          status: 'expired',
        },
      });
      await this.publishTokenConsumeFailure('token_expired', record.qqScope, user.id, record.id);
      throwQqLinkError('token_expired', '绑定链接已过期，请让机器人重新发起绑定。');
    }

    if (record.qqScope === 'group') {
      await this.publishTokenConsumeFailure(
        'group_confirm_required',
        record.qqScope,
        user.id,
        record.id,
      );
      throwQqLinkError(
        'group_confirm_required',
        '群聊绑定需要在群内 @机器人 发送 /确认 确认码，网页不会直接完成绑定。',
      );
    }

    if (record.qqScope !== 'c2c') {
      await this.publishTokenConsumeFailure('invalid_request', record.qqScope, user.id, record.id);
      throwQqLinkError('invalid_request', '绑定链接的绑定范围不正确。');
    }

    let outcome: ConsumeOutcome;

    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.yctQqLink.findUnique({
          where: {
            activeKey: createQqLinkActiveKey('c2c', record.qqOpenId, null),
          },
        });

        // 同一个 openid 在任意 scope/群里都不能绑定到另一个临东通账号。
        const conflicting = await tx.yctQqLink.findFirst({
          where: {
            qqOpenId: record.qqOpenId,
            status: 'active',
            ldpassUserId: {
              not: user.id,
            },
          },
          select: {
            id: true,
          },
        });

        if (conflicting) {
          return { kind: 'failure', reason: 'openid_already_linked' };
        }

        if (existing) {
          if (existing.ldpassUserId !== user.id) {
            return { kind: 'failure', reason: 'openid_already_linked' };
          }

          if (existing.qqScope !== 'c2c' || existing.groupOpenId !== null) {
            return { kind: 'failure', reason: 'link_conflict' };
          }

          const consumed = await this.consumeTokenRecord(tx, record.id, user.id);
          if (!consumed) {
            const latest = await tx.yctQqLinkToken.findUnique({
              where: {
                id: record.id,
              },
            });
            return {
              kind: 'failure',
              reason: latest?.status === 'used' ? 'token_used' : 'token_expired',
            };
          }

          const updated = await tx.yctQqLink.update({
            where: {
              id: existing.id,
            },
            data: {
              lastSeenAt: now,
            },
          });

          return {
            kind: 'success',
            link: {
              id: updated.id,
              ldpassUserId: updated.ldpassUserId,
              username: user.username,
              createdAt: updated.createdAt,
              scope: 'c2c',
            },
            created: false,
          };
        }

        const consumed = await this.consumeTokenRecord(tx, record.id, user.id);
        if (!consumed) {
          const latest = await tx.yctQqLinkToken.findUnique({
            where: {
              id: record.id,
            },
          });
          return {
            kind: 'failure',
            reason: latest?.status === 'used' ? 'token_used' : 'token_expired',
          };
        }

        const link = await tx.yctQqLink.create({
          data: {
            id: createQqLinkId(),
            ldpassUserId: user.id,
            qqOpenId: record.qqOpenId,
            qqScope: 'c2c',
            groupOpenId: null,
            status: 'active',
            activeKey: createQqLinkActiveKey('c2c', record.qqOpenId, null),
            lastSeenAt: now,
          },
        });

        return {
          kind: 'success',
          link: {
            id: link.id,
            ldpassUserId: link.ldpassUserId,
            username: user.username,
            createdAt: link.createdAt,
            scope: 'c2c',
          },
          created: true,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      outcome = await this.resolveConcurrentTokenConsume(record.id, record.qqOpenId, user);
    }

    if (outcome.kind === 'failure') {
      recordQqLinkTokenConfirmFailure(user.id);
      await this.publishTokenConsumeFailure(
        outcome.reason,
        record.qqScope,
        user.id,
        record.id,
        record.qqOpenId,
      );
      throwQqLinkError(outcome.reason, this.readFailureMessage(outcome.reason));
    }

    await this.eventBus.publish({
      type: 'QqLinkTokenConsumeSucceeded',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        qqLinkId: outcome.link.id,
        tokenId: record.id,
        userId: user.id,
        scope: 'c2c',
        openIdHash: hashQqOpenId(record.qqOpenId),
        openIdMasked: maskQqOpenId(record.qqOpenId),
        created: outcome.created,
      },
    });

    return {
      ok: true,
      link: {
        id: outcome.link.id,
        scope: 'c2c',
        createdAt: outcome.link.createdAt.toISOString(),
      },
    };
  }

  /**
   * 群 token 的网页“认领”：只记录目标临东通账号并返回确认码，不消费 token、不创建绑定。
   * 同一个账号重复认领会得到同一个确认码（由 tokenHash + userId + claimedAt 派生）。
   */
  async claimGroupToken(
    user: AuthenticatedUser,
    dto: ClaimGroupQqLinkTokenDto,
  ): Promise<QqLinkGroupClaimResult> {
    const failClaim = async (
      reason: YctQqLinkFailureReason,
      record?: {
        id: string;
        qqOpenId: string;
        qqScope: YctQqLinkScope;
        groupOpenId: string | null;
      },
      message?: string,
    ): Promise<never> => {
      await this.publishTokenClaimFailure(reason, user.id, record);
      throwQqLinkError(reason, message ?? this.readFailureMessage(reason));
    };

    const normalizedToken = normalizeQqLinkToken(dto.token);
    if (!normalizedToken) {
      return failClaim('token_invalid');
    }

    const tokenHash = hashQqLinkToken(normalizedToken);
    const record = await this.prisma.yctQqLinkToken.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!record || !safeEqualText(record.tokenHash, tokenHash)) {
      return failClaim('token_invalid');
    }

    if (record.status === 'used') {
      return failClaim('token_used', record);
    }

    if (record.status === 'expired') {
      return failClaim('token_expired', record);
    }

    if (record.status !== 'active') {
      return failClaim('token_invalid', record);
    }

    if (record.qqScope !== 'group' || !record.groupOpenId) {
      return failClaim(
        'group_mismatch',
        record,
        '这个链接不是群聊绑定链接，请让机器人在群里重新发起 /绑定。',
      );
    }

    const now = new Date();
    if (record.expiresAt <= now) {
      await this.prisma.yctQqLinkToken.updateMany({
        where: {
          id: record.id,
          status: 'active',
        },
        data: {
          status: 'expired',
        },
      });
      return failClaim('token_expired', record);
    }

    if (record.claimedByUserId && record.claimedByUserId !== user.id) {
      return failClaim(
        'token_claimed',
        record,
        '这个群绑定链接已经被其他临东通账号打开，请让机器人在群里重新发起 /绑定。',
      );
    }

    if (record.claimedByUserId === user.id && record.claimedAt) {
      return this.buildGroupClaimResult(record, user.id, record.claimedAt);
    }

    const claimed = await this.prisma.yctQqLinkToken.updateMany({
      where: {
        id: record.id,
        status: 'active',
        expiresAt: {
          gt: now,
        },
        claimedByUserId: null,
      },
      data: {
        claimedByUserId: user.id,
        claimedAt: now,
      },
    });

    if (claimed.count !== 1) {
      const latest = await this.prisma.yctQqLinkToken.findUnique({
        where: {
          id: record.id,
        },
      });

      if (!latest) {
        return failClaim('token_invalid');
      }

      if (latest.status === 'used') {
        return failClaim('token_used', latest);
      }

      if (latest.status === 'expired' || latest.expiresAt <= now) {
        return failClaim('token_expired', latest);
      }

      if (latest.claimedByUserId === user.id && latest.claimedAt) {
        return this.buildGroupClaimResult(latest, user.id, latest.claimedAt);
      }

      if (latest.claimedByUserId && latest.claimedByUserId !== user.id) {
        return failClaim('token_claimed', latest);
      }

      return failClaim('link_conflict', latest);
    }

    const groupOpenId = record.groupOpenId;

    await this.eventBus.publish({
      type: 'QqLinkTokenClaimed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: user.id,
      payload: {
        tokenId: record.id,
        userId: user.id,
        scope: 'group',
        openIdHash: hashQqOpenId(record.qqOpenId),
        openIdMasked: maskQqOpenId(record.qqOpenId),
        groupOpenIdHash: hashQqOpenId(groupOpenId),
        groupOpenIdMasked: maskQqOpenId(groupOpenId),
      },
    });

    return this.buildGroupClaimResult(record, user.id, now);
  }

  /**
   * 群内 /确认：token、openId、groupOpenId、确认码四者必须同时匹配，
   * 且 token 必须已被网页认领。原子消费 token 后创建 scope=group 的绑定。
   */
  async confirmGroupToken(dto: ConfirmGroupQqLinkTokenDto): Promise<QqLinkGroupConfirmResult> {
    const identityResult = readQqLinkIdentity('group', dto.openId, dto.groupOpenId);

    if (!identityResult.ok) {
      await this.publishGroupConfirmFailure('invalid_request');
      throwQqLinkError('invalid_request', identityResult.message);
    }

    const identity = identityResult.identity;

    if (identity.scope !== 'group' || !identity.groupOpenId) {
      await this.publishGroupConfirmFailure('invalid_request', identity);
      throwQqLinkError('invalid_request', '群聊绑定必须提供有效的 groupOpenId。');
    }

    const throttleKey = createQqLinkTokenThrottleKey(identity);

    if (!isQqLinkGroupConfirmAllowed(throttleKey)) {
      await this.publishGroupConfirmFailure('rate_limited', identity);
      throwQqLinkError('rate_limited', '确认尝试次数过多，请稍后再试。');
    }

    const failConfirm = async (
      reason: YctQqLinkFailureReason,
      tokenId?: string,
      message?: string,
    ): Promise<never> => {
      recordQqLinkGroupConfirmFailure(throttleKey);
      await this.publishGroupConfirmFailure(reason, identity, tokenId);
      throwQqLinkError(reason, message ?? this.readFailureMessage(reason));
    };

    const normalizedToken = normalizeQqLinkToken(dto.token);
    if (!normalizedToken) {
      return failConfirm('token_invalid');
    }

    const tokenHash = hashQqLinkToken(normalizedToken);
    const record = await this.prisma.yctQqLinkToken.findUnique({
      where: {
        tokenHash,
      },
    });

    if (!record || !safeEqualText(record.tokenHash, tokenHash)) {
      return failConfirm('token_invalid');
    }

    if (record.status === 'used') {
      return failConfirm('token_used', record.id);
    }

    if (record.status === 'expired') {
      return failConfirm('token_expired', record.id);
    }

    if (record.status !== 'active') {
      return failConfirm('token_invalid', record.id);
    }

    const now = new Date();
    if (record.expiresAt <= now) {
      await this.prisma.yctQqLinkToken.updateMany({
        where: {
          id: record.id,
          status: 'active',
        },
        data: {
          status: 'expired',
        },
      });
      return failConfirm('token_expired', record.id);
    }

    if (record.qqScope !== 'group') {
      return failConfirm('group_mismatch', record.id, '这是单聊绑定链接，不能用于群聊确认。');
    }

    if (!safeEqualText(record.qqOpenId, identity.openId)) {
      return failConfirm('openid_mismatch', record.id);
    }

    const groupOpenId = record.groupOpenId;

    if (!groupOpenId || !safeEqualText(groupOpenId, identity.groupOpenId)) {
      return failConfirm('group_mismatch', record.id);
    }

    const claimedByUserId = record.claimedByUserId;
    const claimedAt = record.claimedAt;

    if (!claimedByUserId || !claimedAt) {
      return failConfirm(
        'token_not_claimed',
        record.id,
        '请先在网页登录临东通并打开绑定链接，再回群发送 /确认 确认码。',
      );
    }

    const normalizedCode = normalizeQqLinkConfirmCode(dto.code);
    const expectedCode = createGroupConfirmCode(record.tokenHash, claimedByUserId, claimedAt);

    if (!normalizedCode || !safeEqualText(expectedCode, normalizedCode)) {
      return failConfirm('confirm_code_invalid', record.id);
    }

    const claimedUser = await this.prisma.user.findUnique({
      where: {
        id: claimedByUserId,
      },
      select: {
        username: true,
        status: true,
      },
    });

    if (!claimedUser) {
      return failConfirm('token_invalid', record.id);
    }

    if (claimedUser.status !== 'Active') {
      return failConfirm(
        'account_inactive',
        record.id,
        '打开绑定链接的临东通账号当前不可用，请更换账号后重新发起绑定。',
      );
    }

    let outcome: GroupConfirmOutcome;

    try {
      outcome = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.yctQqLink.findUnique({
          where: {
            activeKey: createQqLinkActiveKey('group', record.qqOpenId, groupOpenId),
          },
        });

        if (existing && existing.ldpassUserId !== claimedByUserId) {
          // 失败分支会正常提交事务，因此必须在消费 token 之前返回，
          // 否则会出现“没有创建绑定但 token 已被烧掉”的情况。
          return { kind: 'failure' as const, reason: 'openid_already_linked' as const };
        }

        // 同一个 openid 不能在任意 scope/群里绑定多个临东通账号；
        // 同一个账号在多个群、或同时拥有单聊和群身份是允许的。
        if (!existing) {
          const conflicting = await tx.yctQqLink.findFirst({
            where: {
              qqOpenId: record.qqOpenId,
              status: 'active',
              ldpassUserId: {
                not: claimedByUserId,
              },
            },
            select: {
              id: true,
            },
          });

          if (conflicting) {
            return { kind: 'failure' as const, reason: 'openid_already_linked' as const };
          }
        }

        const consumed = await tx.yctQqLinkToken.updateMany({
          where: {
            id: record.id,
            status: 'active',
            expiresAt: {
              gt: now,
            },
            claimedByUserId,
            claimedAt,
          },
          data: {
            status: 'used',
            usedAt: now,
            consumedByUserId: claimedByUserId,
          },
        });

        if (consumed.count !== 1) {
          const latest = await tx.yctQqLinkToken.findUnique({
            where: {
              id: record.id,
            },
          });

          return {
            kind: 'failure' as const,
            reason:
              latest?.status === 'used'
                ? ('token_used' as const)
                : latest?.status === 'expired'
                  ? ('token_expired' as const)
                  : ('link_conflict' as const),
          };
        }

        if (existing) {
          const updated = await tx.yctQqLink.update({
            where: {
              id: existing.id,
            },
            data: {
              lastSeenAt: now,
            },
          });

          return {
            kind: 'success' as const,
            link: {
              id: updated.id,
              ldpassUserId: updated.ldpassUserId,
              username: claimedUser.username,
              groupOpenId,
              createdAt: updated.createdAt,
            },
            created: false,
          };
        }

        const link = await tx.yctQqLink.create({
          data: {
            id: createQqLinkId(),
            ldpassUserId: claimedByUserId,
            qqOpenId: record.qqOpenId,
            qqScope: 'group',
            groupOpenId,
            status: 'active',
            activeKey: createQqLinkActiveKey('group', record.qqOpenId, groupOpenId),
            lastSeenAt: now,
          },
        });

        return {
          kind: 'success' as const,
          link: {
            id: link.id,
            ldpassUserId: link.ldpassUserId,
            username: claimedUser.username,
            groupOpenId,
            createdAt: link.createdAt,
          },
          created: true,
        };
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const latest = await this.prisma.yctQqLinkToken.findUnique({
        where: {
          id: record.id,
        },
      });

      if (latest?.status === 'used') {
        outcome = { kind: 'failure', reason: 'token_used' };
      } else {
        const existing = await this.prisma.yctQqLink.findUnique({
          where: {
            activeKey: createQqLinkActiveKey('group', record.qqOpenId, groupOpenId),
          },
          select: {
            ldpassUserId: true,
          },
        });

        outcome = {
          kind: 'failure',
          reason:
            existing && existing.ldpassUserId !== claimedByUserId
              ? 'openid_already_linked'
              : 'link_conflict',
        };
      }
    }

    if (outcome.kind === 'failure') {
      return failConfirm(outcome.reason, record.id);
    }

    await this.eventBus.publish({
      type: 'QqLinkGroupConfirmSucceeded',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: qqBotActorId,
      payload: {
        qqLinkId: outcome.link.id,
        tokenId: record.id,
        userId: claimedByUserId,
        scope: 'group',
        openIdHash: hashQqOpenId(record.qqOpenId),
        openIdMasked: maskQqOpenId(record.qqOpenId),
        groupOpenIdHash: hashQqOpenId(groupOpenId),
        groupOpenIdMasked: maskQqOpenId(groupOpenId),
        created: outcome.created,
      },
    });

    return {
      ok: true,
      link: {
        id: outcome.link.id,
        ldpassUserId: outcome.link.ldpassUserId,
        username: outcome.link.username,
        scope: 'group',
        groupOpenId,
        createdAt: outcome.link.createdAt.toISOString(),
      },
    };
  }

  private buildGroupClaimResult(
    record: { tokenHash: string; expiresAt: Date },
    userId: string,
    claimedAt: Date,
  ): QqLinkGroupClaimResult {
    return {
      ok: true,
      scope: 'group',
      confirmCode: createGroupConfirmCode(record.tokenHash, userId, claimedAt),
      expiresAt: record.expiresAt.toISOString(),
    };
  }

  private async createActiveCode(userId: string, codeHash: string, expiresAt: Date) {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.yctQqLinkCode.updateMany({
            where: {
              ldpassUserId: userId,
              status: 'active',
            },
            data: {
              status: 'revoked',
              activeUserId: null,
            },
          });

          return tx.yctQqLinkCode.create({
            data: {
              ldpassUserId: userId,
              codeHash,
              status: 'active',
              activeUserId: userId,
              expiresAt,
            },
          });
        });
      } catch (error) {
        lastError = error;
        if (!isUniqueConstraintError(error) || attempt === 1) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to create QQ link code.');
  }

  private async consumeCodeRecord(tx: Prisma.TransactionClient, codeId: string): Promise<boolean> {
    const result = await tx.yctQqLinkCode.updateMany({
      where: {
        id: codeId,
        status: 'active',
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        status: 'used',
        usedAt: new Date(),
        activeUserId: null,
      },
    });

    return result.count === 1;
  }

  private async consumeTokenRecord(
    tx: Prisma.TransactionClient,
    tokenId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await tx.yctQqLinkToken.updateMany({
      where: {
        id: tokenId,
        status: 'active',
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        status: 'used',
        usedAt: new Date(),
        consumedByUserId: userId,
      },
    });

    return result.count === 1;
  }

  private async resolveConcurrentConsume(
    codeId: string,
    openId: string,
    expectedUserId: string,
  ): Promise<ConsumeOutcome> {
    const existing = await this.prisma.yctQqLink.findUnique({
      where: {
        activeKey: createQqLinkActiveKey('c2c', openId, null),
      },
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    if (!existing) {
      return { kind: 'failure', reason: 'link_conflict' };
    }

    if (existing.ldpassUserId !== expectedUserId) {
      return { kind: 'failure', reason: 'openid_already_linked' };
    }

    const conflicting = await this.prisma.yctQqLink.findFirst({
      where: {
        qqOpenId: openId,
        status: 'active',
        ldpassUserId: {
          not: expectedUserId,
        },
      },
      select: {
        id: true,
      },
    });

    if (conflicting) {
      return { kind: 'failure', reason: 'openid_already_linked' };
    }

    if (existing.qqScope !== 'c2c' || existing.groupOpenId !== null) {
      return { kind: 'failure', reason: 'link_conflict' };
    }

    const code = await this.prisma.yctQqLinkCode.findUnique({
      where: {
        id: codeId,
      },
    });

    if (code?.status !== 'used') {
      return { kind: 'failure', reason: 'link_conflict' };
    }

    return {
      kind: 'success',
      link: {
        id: existing.id,
        ldpassUserId: existing.ldpassUserId,
        username: existing.user.username,
        createdAt: existing.createdAt,
        scope: 'c2c',
      },
      created: false,
    };
  }

  private async resolveConcurrentTokenConsume(
    tokenId: string,
    openId: string,
    user: AuthenticatedUser,
  ): Promise<ConsumeOutcome> {
    const existing = await this.prisma.yctQqLink.findUnique({
      where: {
        activeKey: createQqLinkActiveKey('c2c', openId, null),
      },
    });

    if (!existing) {
      return { kind: 'failure', reason: 'link_conflict' };
    }

    if (existing.ldpassUserId !== user.id) {
      return { kind: 'failure', reason: 'openid_already_linked' };
    }

    const conflicting = await this.prisma.yctQqLink.findFirst({
      where: {
        qqOpenId: openId,
        status: 'active',
        ldpassUserId: {
          not: user.id,
        },
      },
      select: {
        id: true,
      },
    });

    if (conflicting) {
      return { kind: 'failure', reason: 'openid_already_linked' };
    }

    if (existing.qqScope !== 'c2c' || existing.groupOpenId !== null) {
      return { kind: 'failure', reason: 'link_conflict' };
    }

    const token = await this.prisma.yctQqLinkToken.findUnique({
      where: {
        id: tokenId,
      },
    });

    if (token?.status !== 'used') {
      return { kind: 'failure', reason: 'link_conflict' };
    }

    return {
      kind: 'success',
      link: {
        id: existing.id,
        ldpassUserId: existing.ldpassUserId,
        username: user.username,
        createdAt: existing.createdAt,
        scope: 'c2c',
      },
      created: false,
    };
  }

  private readPublicOrigin(request: ApiRequestLike): string {
    const configuredOrigin =
      process.env.LDPASS_PUBLIC_ORIGIN?.trim() || process.env.WEB_ORIGIN?.trim();

    if (configuredOrigin) {
      return configuredOrigin.replace(/\/+$/g, '');
    }

    const forwardedProto = readHeader(request, 'x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = (forwardedProto || 'http').toLowerCase();
    const forwardedHost = readHeader(request, 'x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || readHeader(request, 'host')?.trim() || '';

    if ((protocol === 'http' || protocol === 'https') && isSafeHost(host)) {
      return `${protocol}://${host}`;
    }

    throw new ServiceUnavailableException(
      '未配置 LDPASS_PUBLIC_ORIGIN 或 WEB_ORIGIN，无法生成 QQ 绑定链接。',
    );
  }

  private readCodeFingerprint(rawCode: string): string | undefined {
    return rawCode.trim() ? fingerprintQqLinkCode(rawCode) : undefined;
  }

  private readFailureMessage(reason: YctQqLinkFailureReason): string {
    const messages: Record<YctQqLinkFailureReason, string> = {
      code_invalid: '绑定码无效，请在临东通网页重新生成。',
      code_expired: '绑定码已过期，请在临东通网页重新生成。',
      code_used: '绑定码已被使用，请在临东通网页重新生成。',
      openid_already_linked: '这个 QQ 身份已经绑定到其他临东通账号。',
      link_conflict: '这个 QQ 身份存在其他绑定，请先在临东通网页解绑后再试。',
      group_not_supported: '该绑定流程不支持群聊，请使用群内 /绑定 获取网页链接。',
      group_mismatch: 'QQ 群身份与绑定链接不一致，请在发起绑定的群里重新确认。',
      openid_mismatch: '当前 QQ 成员不是发起绑定的成员，不能完成确认。',
      confirm_code_invalid: '确认码不正确，请回到网页查看最新确认码。',
      group_confirm_required: '群聊绑定需要在群内 @机器人 发送 /确认 确认码。',
      token_not_claimed: '请先在网页登录临东通并打开绑定链接，再回群发送确认码。',
      token_claimed: '这个绑定链接已被其他临东通账号打开，请重新发起绑定。',
      account_inactive: '绑定目标账号当前不可用。',
      invalid_request: '请求参数不正确。',
      rate_limited: '尝试次数过多，请稍后再试。',
      token_invalid: '绑定链接无效，请让机器人重新发起绑定。',
      token_expired: '绑定链接已过期，请让机器人重新发起绑定。',
      token_used: '绑定链接已被使用，请让机器人重新发起。',
      not_linked: '没有找到可解绑的 QQ 绑定。',
    };

    return messages[reason];
  }

  private async publishCodeConsumeFailure(
    reason: YctQqLinkFailureReason,
    scope: YctQqLinkScope,
    openId: string,
    details: {
      codeId?: string | undefined;
      codeFingerprint?: string | undefined;
    } = {},
  ): Promise<void> {
    await this.eventBus.publish({
      type: 'QqLinkCodeConsumeFailed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: qqBotActorId,
      payload: {
        reason,
        scope,
        openIdHash: hashQqOpenId(openId),
        openIdMasked: maskQqOpenId(openId),
        ...(details.codeId ? { codeId: details.codeId } : {}),
        ...(details.codeFingerprint ? { codeFingerprint: details.codeFingerprint } : {}),
      },
    });
  }

  private async publishTokenConsumeFailure(
    reason: YctQqLinkFailureReason,
    scope: YctQqLinkScope,
    userId: string,
    tokenId?: string,
    openId?: string,
  ): Promise<void> {
    await this.eventBus.publish({
      type: 'QqLinkTokenConsumeFailed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: userId,
      payload: {
        reason,
        scope,
        userId,
        ...(tokenId ? { tokenId } : {}),
        ...(openId ? { openIdHash: hashQqOpenId(openId), openIdMasked: maskQqOpenId(openId) } : {}),
      },
    });
  }

  private async publishTokenClaimFailure(
    reason: YctQqLinkFailureReason,
    userId: string,
    record?: {
      id: string;
      qqOpenId: string;
      qqScope: YctQqLinkScope;
      groupOpenId: string | null;
    },
  ): Promise<void> {
    await this.eventBus.publish({
      type: 'QqLinkTokenClaimFailed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'user',
      actorId: userId,
      payload: {
        reason,
        scope: record?.qqScope ?? 'group',
        userId,
        ...(record
          ? {
              tokenId: record.id,
              openIdHash: hashQqOpenId(record.qqOpenId),
              openIdMasked: maskQqOpenId(record.qqOpenId),
              ...(record.groupOpenId
                ? {
                    groupOpenIdHash: hashQqOpenId(record.groupOpenId),
                    groupOpenIdMasked: maskQqOpenId(record.groupOpenId),
                  }
                : {}),
            }
          : {}),
      },
    });
  }

  private async publishGroupConfirmFailure(
    reason: YctQqLinkFailureReason,
    identity?: { openId: string; groupOpenId: string | null },
    tokenId?: string,
  ): Promise<void> {
    await this.eventBus.publish({
      type: 'QqLinkGroupConfirmFailed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: qqBotActorId,
      payload: {
        reason,
        scope: 'group',
        ...(tokenId ? { tokenId } : {}),
        ...(identity
          ? {
              openIdHash: hashQqOpenId(identity.openId),
              openIdMasked: maskQqOpenId(identity.openId),
              ...(identity.groupOpenId
                ? {
                    groupOpenIdHash: hashQqOpenId(identity.groupOpenId),
                    groupOpenIdMasked: maskQqOpenId(identity.groupOpenId),
                  }
                : {}),
            }
          : {}),
      },
    });
  }

  private async publishUnlinkFailure(
    reason: YctQqLinkFailureReason,
    scope: YctQqLinkScope,
    openId: string,
    groupOpenId?: string,
  ): Promise<void> {
    await this.eventBus.publish({
      type: 'QqLinkUnlinkFailed',
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      actorType: 'system',
      actorId: qqBotActorId,
      payload: {
        reason,
        scope,
        openIdHash: hashQqOpenId(openId),
        openIdMasked: maskQqOpenId(openId),
        ...(groupOpenId
          ? {
              groupOpenIdHash: hashQqOpenId(groupOpenId),
              groupOpenIdMasked: maskQqOpenId(groupOpenId),
            }
          : {}),
      },
    });
  }
}

function createQqLinkId(): string {
  return `qq_link_${randomBytes(12).toString('hex')}`;
}

interface QqLinkIdentity {
  openId: string;
  scope: 'c2c' | 'group';
  groupOpenId: string | null;
}

type QqLinkIdentityResult = { ok: true; identity: QqLinkIdentity } | { ok: false; message: string };

/**
 * openid/groupOpenId 都来自请求参数，必须在这里统一规范化并校验 scope 组合；
 * 后续创建绑定只使用 token 里已验证过的值，不直接信任请求参数。
 */
function readQqLinkIdentity(
  scope: YctQqLinkScope,
  rawOpenId: string,
  rawGroupOpenId?: string | null,
): QqLinkIdentityResult {
  const openId = normalizeQqOpenId(rawOpenId);

  if (!openId) {
    return { ok: false, message: 'openId 参数不正确。' };
  }

  const rawGroup = rawGroupOpenId?.trim() ?? '';

  if (scope === 'group') {
    const groupOpenId = normalizeQqOpenId(rawGroup);

    if (!groupOpenId) {
      return { ok: false, message: '群聊绑定必须提供有效的 groupOpenId。' };
    }

    return {
      ok: true,
      identity: { openId, scope: 'group', groupOpenId },
    };
  }

  if (rawGroup) {
    return { ok: false, message: '单聊绑定不能携带 groupOpenId。' };
  }

  return {
    ok: true,
    identity: { openId, scope: 'c2c', groupOpenId: null },
  };
}

function createQqLinkTokenThrottleKey(identity: QqLinkIdentity): string {
  return `${identity.scope}:${identity.groupOpenId ?? ''}:${identity.openId}`;
}

/** 由服务端派生的 6 位确认码；不存储明文，重复认领时保持不变。 */
function createGroupConfirmCode(tokenHash: string, userId: string, claimedAt: Date): string {
  return createQqLinkConfirmCode(`${tokenHash}:${userId}:${claimedAt.getTime()}`);
}

function createQqLinkActiveKey(
  scope: YctQqLinkScope,
  openId: string,
  groupOpenId: string | null,
): string {
  return scope === 'group' ? `group:${groupOpenId ?? ''}:${openId}` : `c2c:${openId}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002',
  );
}

function isSafeHost(host: string): boolean {
  return host.length > 0 && host.length <= 255 && /^[A-Za-z0-9.\-:[\]]+$/.test(host);
}
