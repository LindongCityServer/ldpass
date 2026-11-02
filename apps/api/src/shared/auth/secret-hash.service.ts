import { Injectable } from '../../framework.js';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readPrimaryPepper, readSecretValue } from './secret-config.js';

const scryptAsync = promisify(scrypt);

export interface SecretVerificationResult {
  valid: boolean;
  /**
   * 非空表示本次校验命中了旧 pepper，调用方应把该哈希回写到数据库，
   * 以完成从旧 pepper 到新 pepper 的平滑迁移。
   */
  upgradedHash: string | null;
}

@Injectable()
export class SecretHashService {
  async hashSecret(secret: string, purpose: string): Promise<string> {
    const salt = randomBytes(16).toString('base64url');
    const hash = await this.derive(secret, salt, purpose, readPrimaryPepper(this.resolvePepperKey(purpose)));
    return `scrypt$${salt}$${hash}`;
  }

  async verifySecret(secret: string, storedHash: string, purpose: string): Promise<boolean> {
    const result = await this.verifySecretWithMigration(secret, storedHash, purpose);
    return result.valid;
  }

  /**
   * 校验凭据；命中旧 pepper 时通过回调把新哈希写回存储。
   *
   * 写回失败不会影响本次校验结果，用户下次操作时仍会再次尝试迁移。
   */
  async verifySecretAndUpgrade(
    secret: string,
    storedHash: string,
    purpose: string,
    persistUpgradedHash?: (upgradedHash: string) => Promise<unknown> | unknown,
  ): Promise<boolean> {
    const result = await this.verifySecretWithMigration(secret, storedHash, purpose);

    if (result.valid && result.upgradedHash && persistUpgradedHash) {
      try {
        await persistUpgradedHash(result.upgradedHash);
      } catch {
        // 迁移写回失败时保留旧哈希，等待下一次成功校验再重试。
      }
    }

    return result.valid;
  }

  async verifySecretWithMigration(
    secret: string,
    storedHash: string,
    purpose: string,
  ): Promise<SecretVerificationResult> {
    const parsed = this.parseStoredHash(storedHash);

    if (!parsed) {
      return { valid: false, upgradedHash: null };
    }

    if (await this.matches(secret, parsed, purpose, readPrimaryPepper(this.resolvePepperKey(purpose)))) {
      return { valid: true, upgradedHash: null };
    }

    for (const legacyPepper of this.readLegacyPeppers(purpose)) {
      if (await this.matches(secret, parsed, purpose, legacyPepper)) {
        return {
          valid: true,
          upgradedHash: await this.hashSecret(secret, purpose),
        };
      }
    }

    return { valid: false, upgradedHash: null };
  }

  private resolvePepperKey(purpose: string): 'PASSWORD_PEPPER' | 'PIN_PEPPER' {
    return purpose === 'pin' ? 'PIN_PEPPER' : 'PASSWORD_PEPPER';
  }

  /**
   * 旧实现里所有用途共用 PASSWORD_PEPPER ?? PIN_PEPPER ?? SESSION_SECRET，
   * 因此两个 legacy 变量都参与尝试，避免旧 PIN 哈希因配置顺序而无法验证。
   */
  private readLegacyPeppers(purpose: string): string[] {
    const primary = readPrimaryPepper(this.resolvePepperKey(purpose));
    const candidates =
      purpose === 'pin'
        ? [readSecretValue('PIN_PEPPER_LEGACY'), readSecretValue('PASSWORD_PEPPER_LEGACY')]
        : [readSecretValue('PASSWORD_PEPPER_LEGACY'), readSecretValue('PIN_PEPPER_LEGACY')];

    return [...new Set(candidates.filter((value): value is string => Boolean(value) && value !== primary))];
  }

  private parseStoredHash(storedHash: string): { salt: string; hash: string } | null {
    const [scheme, salt, hash] = storedHash.split('$');

    if (scheme !== 'scrypt' || !salt || !hash) {
      return null;
    }

    return { salt, hash };
  }

  private async matches(
    secret: string,
    parsed: { salt: string; hash: string },
    purpose: string,
    pepper: string,
  ): Promise<boolean> {
    const expected = await this.derive(secret, parsed.salt, purpose, pepper);
    const expectedBuffer = Buffer.from(expected, 'base64url');
    const actualBuffer = Buffer.from(parsed.hash, 'base64url');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private async derive(secret: string, salt: string, purpose: string, pepper: string): Promise<string> {
    const derived = (await scryptAsync(`${purpose}:${pepper}:${secret}`, salt, 64)) as Buffer;
    return derived.toString('base64url');
  }
}
