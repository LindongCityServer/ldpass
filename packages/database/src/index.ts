import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { config as loadEnv } from 'dotenv';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, '..');
const repoRoot = resolve(packageRoot, '../..');

loadEnv({ path: resolve(repoRoot, '.env') });

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production') {
  loadEnv({ path: resolve(repoRoot, '.env.example') });
}

function normalizeSqliteUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith('file:')) {
    return databaseUrl;
  }

  const rawPath = databaseUrl.slice('file:'.length);

  if (rawPath === ':memory:') {
    return databaseUrl;
  }

  const sqlitePath =
    isAbsolute(rawPath) || /^[a-zA-Z]:[\\/]/.test(rawPath)
      ? rawPath
      : resolve(repoRoot, rawPath);

  mkdirSync(dirname(sqlitePath), { recursive: true });
  return `file:${sqlitePath.replaceAll('\\', '/')}`;
}

export function createPrismaClientOptions(): ConstructorParameters<typeof PrismaClient>[0] {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured.');
  }

  return {
    adapter: new PrismaLibSql({
      url: normalizeSqliteUrl(databaseUrl),
    }),
  };
}

const globalForPrisma = globalThis as unknown as {
  ldpassPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.ldpassPrisma ?? new PrismaClient(createPrismaClientOptions());

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.ldpassPrisma = prisma;
}

export { Prisma, PrismaClient };
