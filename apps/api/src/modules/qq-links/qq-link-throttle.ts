/**
 * QQ 绑定相关限流。
 *
 * 与现有登录/PIN 限流保持一致，使用进程内固定窗口计数：进程重启后计数清零。
 * 内部接口由机器人单机调用，不能按机器人 IP 限流，否则会误伤所有 QQ 用户；
 * 因此消费失败按 openid 计数，网页生成绑定码则按用户和客户端 IP 计数。
 */
interface ThrottleOptions {
  maxAttempts: number;
  windowMs: number;
  lockMs: number;
}

interface ThrottleRecord {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
}

const records = new Map<string, ThrottleRecord>();
const maxTrackedKeys = 10000;
const tenMinutesMs = 10 * 60 * 1000;

const codeIssuePerUser: ThrottleOptions = {
  maxAttempts: 5,
  windowMs: tenMinutesMs,
  lockMs: tenMinutesMs,
};
const codeIssuePerIp: ThrottleOptions = {
  maxAttempts: 20,
  windowMs: tenMinutesMs,
  lockMs: tenMinutesMs,
};
const consumeFailurePerOpenId: ThrottleOptions = {
  maxAttempts: 10,
  windowMs: tenMinutesMs,
  lockMs: tenMinutesMs,
};
const tokenIssuePerOpenId: ThrottleOptions = {
  maxAttempts: 15,
  windowMs: tenMinutesMs,
  lockMs: tenMinutesMs,
};
const groupConfirmFailurePerIdentity: ThrottleOptions = {
  maxAttempts: 10,
  windowMs: tenMinutesMs,
  lockMs: tenMinutesMs,
};
const tokenConfirmFailurePerUser: ThrottleOptions = {
  maxAttempts: 10,
  windowMs: tenMinutesMs,
  lockMs: tenMinutesMs,
};

export function isQqLinkCodeIssueAllowed(userId: string, ip: string): boolean {
  return (
    isAllowed(`qq-link:code-issue:user:${userId}`, codeIssuePerUser) &&
    isAllowed(`qq-link:code-issue:ip:${ip}`, codeIssuePerIp)
  );
}

export function recordQqLinkCodeIssue(userId: string, ip: string): void {
  recordAttempt(`qq-link:code-issue:user:${userId}`, codeIssuePerUser);
  recordAttempt(`qq-link:code-issue:ip:${ip}`, codeIssuePerIp);
}

export function isQqLinkConsumeAllowed(openId: string): boolean {
  return isAllowed(`qq-link:consume:${openId}`, consumeFailurePerOpenId);
}

export function recordQqLinkConsumeFailure(openId: string): void {
  recordAttempt(`qq-link:consume:${openId}`, consumeFailurePerOpenId);
}

export function isQqLinkTokenIssueAllowed(identityKey: string): boolean {
  return isAllowed(`qq-link:token-issue:${identityKey}`, tokenIssuePerOpenId);
}

export function recordQqLinkTokenIssue(identityKey: string): void {
  recordAttempt(`qq-link:token-issue:${identityKey}`, tokenIssuePerOpenId);
}

export function isQqLinkGroupConfirmAllowed(identityKey: string): boolean {
  return isAllowed(`qq-link:group-confirm:${identityKey}`, groupConfirmFailurePerIdentity);
}

export function recordQqLinkGroupConfirmFailure(identityKey: string): void {
  recordAttempt(`qq-link:group-confirm:${identityKey}`, groupConfirmFailurePerIdentity);
}

export function isQqLinkTokenConfirmAllowed(userId: string): boolean {
  return isAllowed(`qq-link:token-confirm:${userId}`, tokenConfirmFailurePerUser);
}

export function recordQqLinkTokenConfirmFailure(userId: string): void {
  recordAttempt(`qq-link:token-confirm:${userId}`, tokenConfirmFailurePerUser);
}

/** 仅测试使用：清空进程内限流状态。 */
export function resetQqLinkThrottle(): void {
  records.clear();
}

function isAllowed(key: string, options: ThrottleOptions): boolean {
  const record = records.get(key);
  if (!record) {
    return true;
  }

  const now = Date.now();
  if (record.blockedUntil > now) {
    return false;
  }

  if (now - record.windowStartedAt > options.windowMs) {
    records.delete(key);
  }

  return true;
}

function recordAttempt(key: string, options: ThrottleOptions): void {
  const now = Date.now();
  const record = records.get(key);

  if (!record || record.blockedUntil > now || now - record.windowStartedAt > options.windowMs) {
    records.set(key, { count: 1, windowStartedAt: now, blockedUntil: 0 });
    pruneRecords();
    return;
  }

  record.count += 1;

  if (record.count >= options.maxAttempts) {
    record.count = 0;
    record.windowStartedAt = now;
    record.blockedUntil = now + options.lockMs;
  }
}

function pruneRecords(): void {
  if (records.size <= maxTrackedKeys) {
    return;
  }

  const now = Date.now();
  for (const [key, record] of records) {
    if (record.blockedUntil <= now && now - record.windowStartedAt > tenMinutesMs) {
      records.delete(key);
    }
  }
}
