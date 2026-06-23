import { Injectable, InternalServerErrorException } from '@nestjs/common';
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

    const decipher = createDecipheriv('aes-256-gcm', this.readKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  private readKey(): Buffer {
    const rawSecret = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY ?? process.env.PROVIDER_API_KEY_SECRET ?? process.env.SESSION_SECRET ?? '';
    if (rawSecret.trim().length < 16) {
      throw new InternalServerErrorException('缺少 WEBHOOK_SECRET_ENCRYPTION_KEY，无法安全保存 Webhook 签名密钥。');
    }

    return createHash('sha256').update(`ldpass:webhook-secret:${rawSecret}`).digest();
  }
}
