import { Prisma } from '@ldpass/database';

export interface DeletedUserIdentity {
  auditSubjectId: string;
  username: string;
  email: string;
  passwordHash: string;
}

interface UserAuditSubject {
  id: string;
  username: string;
  email: string;
  serverAccountName: string | null;
}

interface UserAuditLogClient {
  auditLog: {
    findMany(args: Prisma.AuditLogFindManyArgs): Promise<
      Array<{
        id: string;
        actorType: string;
        actorId: string | null;
        subjectType: string | null;
        subjectId: string | null;
        summary: Prisma.JsonValue;
        context: Prisma.JsonValue | null;
      }>
    >;
    update(args: Prisma.AuditLogUpdateArgs): Promise<unknown>;
  };
}

export function createDeletedUserIdentity(userId: string): DeletedUserIdentity {
  const compactId = userId.replace(/[^a-zA-Z0-9]/g, '');
  const shortId = compactId.slice(0, 24);

  return {
    auditSubjectId: `deleted-user:${compactId.slice(0, 16)}`,
    username: `deleted_${shortId}`,
    email: `deleted+${compactId}@deleted.ldpass.local`,
    passwordHash: `deleted$${userId}`,
  };
}

export async function anonymizeUserAuditLogs(
  client: UserAuditLogClient,
  user: UserAuditSubject,
  deletedIdentity: DeletedUserIdentity,
): Promise<void> {
  const logs = await client.auditLog.findMany({
    where: {
      OR: [
        {
          actorType: 'user',
          actorId: user.id,
        },
        {
          subjectType: 'user',
          subjectId: user.id,
        },
      ],
    },
    select: {
      id: true,
      actorType: true,
      actorId: true,
      subjectType: true,
      subjectId: true,
      summary: true,
      context: true,
    },
  });

  const replacements = [
    [user.id, deletedIdentity.auditSubjectId],
    [user.username, '已删除用户'],
    [user.email, '已删除邮箱'],
    [user.serverAccountName ?? '', '已解绑服务器账号'],
  ] as const;

  await Promise.all(
    logs.map((log) =>
      client.auditLog.update({
        where: {
          id: log.id,
        },
        data: {
          actorId:
            log.actorType === 'user' && log.actorId === user.id
              ? deletedIdentity.auditSubjectId
              : log.actorId,
          subjectId:
            log.subjectType === 'user' && log.subjectId === user.id
              ? deletedIdentity.auditSubjectId
              : log.subjectId,
          summary: anonymizeJsonValue(log.summary, replacements) as Prisma.InputJsonValue,
          context:
            log.context === null
              ? Prisma.JsonNull
              : (anonymizeJsonValue(log.context, replacements) as Prisma.InputJsonValue),
        },
      }),
    ),
  );
}

function anonymizeJsonValue(
  value: Prisma.JsonValue | undefined,
  replacements: ReadonlyArray<readonly [string, string]>,
): Prisma.JsonValue {
  if (value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return replacements.reduce((currentValue, [from, to]) => {
      if (!from) {
        return currentValue;
      }

      return currentValue.split(from).join(to);
    }, value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => anonymizeJsonValue(item, replacements));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, anonymizeJsonValue(item, replacements)]),
    );
  }

  return value;
}
