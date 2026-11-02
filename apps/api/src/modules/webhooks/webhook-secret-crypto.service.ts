import { Injectable, InternalServerErrorException } from '../../framework.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const secretPrefix = 'ldwh_';
const ciphertextVersion = 'v1';

@Injectable()
export class WebhookSecretCryptoService {
  createSigningSecret(): string {
    return `${secretPrefix}${randomBytes(32).toString('base64url')}`;
  }

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.readKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [ciphertextVersion, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(ciphertextEnvelope: string): string {
    const [version, iv, authTag, ciphertext] = ciphertextEnvelope.split('.');
    if (version !== ciphertextVersion || !iv || !authTag || !ciphertext) {
      throw new InternalServerErrorException('Webhook 密钥格式无效。');
    }

    let lastError: unknown = null;

    for (const key of this.readKeys()) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, 'base64url')),
          decipher.final(),
        ]);
        return plaintext.toString('utf8');
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new InternalServerErrorException('Webhook 密钥解密失败。');
  }

  private readKeys(): Buffer[] {
    const primarySecret =
      process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ??
      process.env.PROVIDER_API_KEY_SECRET ??
      process.env.SESSION_SECRET ??
      '';
    const legacySecret = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY_LEGACY ?? '';

    return this.buildKeys([primarySecret, legacySecret]);
  }

  private buildKeys(rawSecrets: string[]): Buffer[] {
    const seen = new Set<string>();
    const keys: Buffer[] = [];

    for (const rawSecret of rawSecrets) {
      const value = rawSecret.trim();
      if (value.length < 16) {
        continue;
      }

      const key = createHash('sha256').update(`ldpass:webhook-secret:${value}`).digest();
      const fingerprint = key.toString('base64');
      if (seen.has(fingerprint)) {
        continue;
      }

      seen.add(fingerprint);
      keys.push(key);
    }

    return keys;
  }

  private readKey(): Buffer {
    const keys = this.readKeys();

    if (keys.length === 0) {
      throw new InternalServerErrorException('缺少 WEBHOOK_SECRET_ENCRYPTION_KEY，无法安全保存 Webhook 签名密钥。');
    }

    return keys[0] as Buffer;
  }
}
