import { config as loadEnv } from 'dotenv';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '../..');

loadEnv({ path: resolve(repoRoot, '.env') });

if (!process.env.DATABASE_URL && process.env.NODE_ENV !== 'production') {
  loadEnv({ path: resolve(repoRoot, '.env.example') });
}

function normalizeSqliteDatasourceUrl(databaseUrl: string): string {
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

  return `file:${sqlitePath.replaceAll('\\', '/')}`;
}

if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = normalizeSqliteDatasourceUrl(process.env.DATABASE_URL);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
