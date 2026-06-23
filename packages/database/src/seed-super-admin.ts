import { randomBytes, scrypt } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { config as loadEnv } from 'dotenv';

const scryptAsync = promisify(scrypt);
const packageSrcRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageSrcRoot, '../../..');

loadEnv({ path: resolve(repoRoot, '.env') });

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production') {
  loadEnv({ path: resolve(repoRoot, '.env.example') });
}

const { prisma } = await import('./index.js');

async function hashSecret(secret: string, purpose: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const pepper = process.env.PASSWORD_PEPPER ?? process.env.PIN_PEPPER ?? process.env.SESSION_SECRET ?? '';
  const derived = (await scryptAsync(`${purpose}:${pepper}:${secret}`, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD;
  const pin = process.env.SEED_ADMIN_PIN;

  if (!password || password.length < 12 || /replace-with|请替换/i.test(password)) {
    throw new Error('SEED_ADMIN_PASSWORD must be configured as a real password with at least 12 characters.');
  }

  const existingUser = await prisma.user.findUnique({
    where: {
      username,
    },
    select: {
      pinHash: true,
    },
  });

  if (pin && !/^\d{4,12}$/.test(pin)) {
    throw new Error('SEED_ADMIN_PIN must be 4 to 12 digits.');
  }

  if (!pin && !existingUser?.pinHash) {
    throw new Error('SEED_ADMIN_PIN must be configured for the initial super admin. Use 4 to 12 digits.');
  }

  const passwordHash = await hashSecret(password, 'password');
  const pinHash = pin ? await hashSecret(pin, 'pin') : undefined;
  const pinData = pinHash ? { pinHash } : {};

  const user = await prisma.user.upsert({
    where: {
      username,
    },
    create: {
      username,
      email: email.toLowerCase(),
      passwordHash,
      ...pinData,
      role: 'super_admin',
      status: 'Active',
      reviewInfo: 'Seeded super admin',
      registrationIp: 'seed',
    },
    update: {
      email: email.toLowerCase(),
      passwordHash,
      ...pinData,
      role: 'super_admin',
      status: 'Active',
      reviewRejectedReason: null,
    },
  });

  console.log(`Super admin ready: ${user.username} <${user.email}>`);
}

await main();
await prisma.$disconnect();
