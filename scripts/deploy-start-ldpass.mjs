#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = scriptDir;
const envPath = resolveEnvPath(process.env.LDPASS_ENV_FILE || '.env');
const requiredNodeMajor = 24;

process.chdir(packageRoot);
assertNodeRuntime();
assertFile(resolve(packageRoot, 'start.mjs'), '缺少 start.mjs，请确认部署包完整。');
assertFile(envPath, `缺少生产环境变量文件：${envPath}。请先复制 .env.example 为 .env 并填写密钥。`);

loadEnvFile(envPath);
normalizeDatabaseUrl();

process.env.NODE_ENV = 'production';
process.env.PORT = '3200';
process.env.HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
process.env.PROJECT_ROOT_PATH = process.env.PROJECT_ROOT_PATH || packageRoot;
process.env.PROJECT_DATA_PATH = process.env.PROJECT_DATA_PATH || resolve(packageRoot, 'data');

mkdirSync(process.env.PROJECT_DATA_PATH, { recursive: true });
mkdirSync(resolve(packageRoot, 'logs'), { recursive: true });

prepareSqliteDatabaseFile();
warnForPlaceholderSecrets();
syncDatabaseSchema();

console.log('[ldpass] 部署准备完成。');
console.log(`[ldpass] package root: ${packageRoot}`);
console.log(`[ldpass] env file: ${envPath}`);
console.log(`[ldpass] data path: ${process.env.PROJECT_DATA_PATH}`);
console.log('[ldpass] starting on 0.0.0.0:3200');

await import(pathToFileURL(resolve(packageRoot, 'start.mjs')).href);

function resolveEnvPath(value) {
  return isAbsolute(value) ? value : resolve(packageRoot, value);
}

function assertNodeRuntime() {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '', 10);
  if (major === requiredNodeMajor || process.env.LDPASS_ALLOW_UNSUPPORTED_NODE === 'true') {
    return;
  }

  console.error(
    `[ldpass] Node 版本不匹配：当前 ${process.version}，部署包要求 Node v${requiredNodeMajor}.x。`,
  );
  console.error('[ldpass] 如仅本地临时调试，可设置 LDPASS_ALLOW_UNSUPPORTED_NODE=true。');
  process.exit(1);
}

function assertFile(path, message) {
  if (!existsSync(path)) {
    console.error(`[ldpass] ${message}`);
    process.exit(1);
  }
}

function loadEnvFile(path) {
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquoteEnvValue(line.slice(separatorIndex + 1).trim());
  }
}

function unquoteEnvValue(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith('file:')) {
    return;
  }

  const rawPath = databaseUrl.slice('file:'.length);
  if (rawPath === ':memory:') {
    return;
  }

  const sqlitePath =
    isAbsolute(rawPath) || /^[a-zA-Z]:[\\/]/.test(rawPath)
      ? rawPath
      : resolve(packageRoot, rawPath);

  process.env.DATABASE_URL = `file:${sqlitePath.replaceAll('\\', '/')}`;
}

function prepareSqliteDatabaseFile() {
  const sqlitePath = getSqliteDatabasePath();
  if (!sqlitePath) {
    return;
  }

  mkdirSync(dirname(sqlitePath), { recursive: true });

  if (!existsSync(sqlitePath)) {
    return;
  }

  const stats = statSync(sqlitePath);
  if (stats.isFile() && stats.size === 0) {
    rmSync(sqlitePath, { force: true });
    console.warn('[ldpass] 已删除 0 字节 SQLite 文件，Prisma 将重新创建数据库。');
  }
}

function getSqliteDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.startsWith('file:')) {
    return null;
  }

  const rawPath = databaseUrl.slice('file:'.length);
  if (rawPath === ':memory:') {
    return null;
  }

  return rawPath;
}

function warnForPlaceholderSecrets() {
  const placeholderKeys = [
    'SESSION_SECRET',
    'PROVIDER_API_KEY_SECRET',
    'WEBHOOK_SECRET_ENCRYPTION_KEY',
    'PASSWORD_PEPPER',
    'PIN_PEPPER',
  ];

  for (const key of placeholderKeys) {
    const value = process.env[key] || '';
    if (value.includes('replace-with') || value.includes('替换')) {
      console.warn(`[ldpass] 警告：${key} 仍像是示例值，生产环境请替换为随机密钥。`);
    }
  }
}

function syncDatabaseSchema() {
  if (process.env.LDPASS_SKIP_DB_PUSH === 'true') {
    console.log('[ldpass] 已跳过数据库结构同步。');
    return;
  }

  const databasePackageDir = resolve(packageRoot, 'packages/database');
  const schemaPath = resolve(databasePackageDir, 'prisma/schema.prisma');
  const prismaCliPath = resolve(packageRoot, 'node_modules/prisma/build/index.js');

  assertFile(schemaPath, `缺少 Prisma schema：${schemaPath}。请确认部署包完整。`);
  assertFile(prismaCliPath, `缺少 Prisma CLI：${prismaCliPath}。请重新生成部署包。`);

  console.log('[ldpass] 正在同步数据库结构。');
  const result = spawnSync(
    process.execPath,
    [prismaCliPath, 'db', 'push', '--schema', schemaPath],
    {
      cwd: databasePackageDir,
      env: {
        ...process.env,
        RUST_LOG: process.env.LDPASS_PRISMA_RUST_LOG || 'debug',
        PRISMA_SCHEMA_ENGINE_LOG_LEVEL: process.env.PRISMA_SCHEMA_ENGINE_LOG_LEVEL || 'info',
      },
      stdio: 'inherit',
    },
  );

  if (result.status === 0) {
    console.log('[ldpass] 数据库结构同步完成。');
    return;
  }

  console.error('[ldpass] 数据库结构同步失败，已停止启动。');
  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(result.status ?? 1);
}
