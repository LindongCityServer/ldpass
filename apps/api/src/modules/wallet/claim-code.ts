import { createHash } from 'node:crypto';

export function normalizeClaimCode(value: string): string {
  return value.trim().toUpperCase();
}

export function hashClaimCode(value: string): string {
  return createHash('sha256').update(normalizeClaimCode(value)).digest('base64url');
}
