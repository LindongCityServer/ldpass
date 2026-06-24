import { createHash, randomInt } from 'node:crypto';

const CLAIM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function createClaimCode(tailLength = 12): string {
  return `LD-${Array.from({ length: tailLength }, () => CLAIM_CODE_ALPHABET[randomInt(CLAIM_CODE_ALPHABET.length)]).join('')}`;
}

// 新生成的领取码只使用大写字母和数字；领取入口仍兼容早期测试生成的旧格式。
export function normalizeClaimCode(value: string): string {
  return value.trim().toUpperCase();
}

export function hashClaimCode(value: string): string {
  return createHash('sha256').update(normalizeClaimCode(value)).digest('base64url');
}
