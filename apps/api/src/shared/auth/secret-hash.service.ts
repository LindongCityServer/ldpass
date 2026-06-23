import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

@Injectable()
export class SecretHashService {
  async hashSecret(secret: string, purpose: string): Promise<string> {
    const salt = randomBytes(16).toString('base64url');
    const hash = await this.derive(secret, salt, purpose);
    return `scrypt$${salt}$${hash}`;
  }

  async verifySecret(secret: string, storedHash: string, purpose: string): Promise<boolean> {
    const [scheme, salt, hash] = storedHash.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) {
      return false;
    }

    const expected = await this.derive(secret, salt, purpose);
    const expectedBuffer = Buffer.from(expected, 'base64url');
    const actualBuffer = Buffer.from(hash, 'base64url');

    if (expectedBuffer.length !== actualBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private async derive(secret: string, salt: string, purpose: string): Promise<string> {
    const pepper = process.env.PASSWORD_PEPPER ?? process.env.PIN_PEPPER ?? process.env.SESSION_SECRET ?? '';
    const derived = (await scryptAsync(`${purpose}:${pepper}:${secret}`, salt, 64)) as Buffer;
    return derived.toString('base64url');
  }
}
