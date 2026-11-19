import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Crockford Base32：去掉了 I、L、O、U，避免人工转述绑定码时产生歧义。
 */
const codeAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const codeLength = 8;
const tokenPattern = /^[A-Za-z0-9_-]{20,64}$/;

export interface GeneratedQqLinkCode {
  /** 展示给用户的 4-4 分组形式，例如 K7M2-9QXF。 */
  displayCode: string;
  /** 去掉分隔符后的规范形式，只用于计算哈希。 */
  normalizedCode: string;
}

export function createQqLinkCode(): GeneratedQqLinkCode {
  const bytes = randomBytes(codeLength);
  let normalizedCode = '';

  for (let index = 0; index < codeLength; index += 1) {
    const byte = bytes[index] ?? 0;
    normalizedCode += codeAlphabet[byte & 31] ?? '0';
  }

  return {
    displayCode: `${normalizedCode.slice(0, 4)}-${normalizedCode.slice(4)}`,
    normalizedCode,
  };
}

/**
 * 用户可能带上连字符、空格或全角字符，也可能把 I/L 看成 1、把 O 看成 0。
 * 这里统一成 Crockford 规范形式后再查哈希，既宽容输入又不改变安全边界。
 */
export function normalizeQqLinkCode(value: string): string | null {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

  if (normalized.length !== codeLength) {
    return null;
  }

  for (const character of normalized) {
    if (!codeAlphabet.includes(character)) {
      return null;
    }
  }

  return normalized;
}

/** 128 位随机数，base64url 后 22 个字符。 */
export function createQqLinkToken(): string {
  return randomBytes(16).toString('base64url');
}

export function normalizeQqLinkToken(value: string): string | null {
  const normalized = value.trim();
  return tokenPattern.test(normalized) ? normalized : null;
}

const confirmCodePattern = /^\d{6}$/;

/**
 * 群确认码不落库：由 tokenHash + claimedByUserId + claimedAt 经 HMAC 派生 6 位数字。
 * 同一个群 token 被同一账号重复认领时返回同一个码，刷新网页不会让已展示的码失效；
 * 未认领、已使用或已过期的 token 无法派生出可用的确认码。
 */
export function createQqLinkConfirmCode(seed: string): string {
  const digest = createHmac('sha256', readHashKey())
    .update(`qq-link-confirm-code:${seed}`)
    .digest();
  const value = digest.readUInt32BE(0) % 1000000;

  return value.toString().padStart(6, '0');
}

/** 用户可能在数字之间带空格，统一去掉空白后再校验，避免格式差异影响体验。 */
export function normalizeQqLinkConfirmCode(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, '');

  return confirmCodePattern.test(normalized) ? normalized : null;
}

function readHashKey(): string {
  const secret = process.env.QQ_LINK_HASH_SECRET?.trim() || process.env.SESSION_SECRET?.trim();

  if (!secret) {
    throw new Error('SESSION_SECRET or QQ_LINK_HASH_SECRET is not configured.');
  }

  return secret;
}

/**
 * 绑定码/网页 token 都只保存 HMAC 哈希。哈希是确定性的，便于按索引查询；
 * 查询命中后服务层仍会用 timingSafeEqual 再比较一次，避免把比较逻辑分散到调用方。
 */
export function hashQqLinkCode(normalizedCode: string): string {
  return createHmac('sha256', readHashKey()).update(`qq-link-code:${normalizedCode}`).digest('hex');
}

export function hashQqLinkToken(token: string): string {
  return createHmac('sha256', readHashKey()).update(`qq-link-token:${token}`).digest('hex');
}

/** 审计里只保存 openid 的不可逆指纹，避免把完整 openid 写进审计摘要。 */
export function hashQqOpenId(openId: string): string {
  return createHmac('sha256', readHashKey()).update(`qq-openid:${openId}`).digest('hex');
}

/** 绑定码格式错误时用于审计关联的短指纹，不可反推出原始绑定码。 */
export function fingerprintQqLinkCode(rawCode: string): string {
  return createHmac('sha256', readHashKey())
    .update(`qq-link-code-input:${rawCode.trim()}`)
    .digest('hex')
    .slice(0, 12);
}

export function maskQqOpenId(openId: string): string {
  if (openId.length <= 8) {
    return `${openId.slice(0, 2)}…${openId.slice(-2)}`;
  }

  return `${openId.slice(0, 4)}…${openId.slice(-4)}`;
}

export function safeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeQqOpenId(value: string): string | null {
  const normalized = value.trim();

  if (normalized.length < 1 || normalized.length > 128) {
    return null;
  }

  return /^[A-Za-z0-9_.:-]+$/.test(normalized) ? normalized : null;
}
