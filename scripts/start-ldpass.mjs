#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = scriptDir;

process.chdir(packageRoot);
loadEnvFile(resolve(packageRoot, '.env'));

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.PORT = process.env.PORT || '3200';
process.env.HOSTNAME = process.env.HOSTNAME || '0.0.0.0';
process.env.PROJECT_ROOT_PATH = process.env.PROJECT_ROOT_PATH || packageRoot;
process.env.PROJECT_DATA_PATH = process.env.PROJECT_DATA_PATH || resolve(packageRoot, 'data');

assertProductionSecrets();

const serverPath = [
  resolve(packageRoot, 'apps/web/server.js'),
  resolve(packageRoot, 'apps/web/.next/standalone/apps/web/server.js'),
  resolve(packageRoot, '../apps/web/.next/standalone/apps/web/server.js'),
].find((candidate) => existsSync(candidate));

if (!serverPath) {
  console.error('[ldpass] 找不到 Next standalone server.js，请先执行 pnpm package:standalone。');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.warn('[ldpass] 未设置 DATABASE_URL，涉及数据库的接口会启动失败。');
}

console.log(`[ldpass] starting Next standalone at ${process.env.HOSTNAME}:${process.env.PORT}`);
await import(pathToFileURL(serverPath).href);

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
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

function assertProductionSecrets() {
  if ((process.env.NODE_ENV || 'production') !== 'production') {
    return;
  }

  const requiredKeys = [
    'SESSION_SECRET',
    'PROVIDER_API_KEY_SECRET',
    'WEBHOOK_SECRET_ENCRYPTION_KEY',
    'PASSWORD_PEPPER',
    'PIN_PEPPER',
  ];
  const problems = [];

  for (const key of requiredKeys) {
    const value = (process.env[key] || '').trim();

    if (!value) {
      problems.push(`${key} 未配置`);
      continue;
    }

    if (value.length < 16) {
      problems.push(`${key} 长度不足 16 个字符`);
      continue;
    }

    if (/replace-with|请替换|示例|changeme/i.test(value)) {
      problems.push(`${key} 仍是示例占位符`);
    }
  }

  if (problems.length === 0) {
    return;
  }

  console.error('[ldpass] 生产环境密钥配置不安全，已拒绝启动：');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error('[ldpass] 请为每个密钥生成独立的随机值，例如：');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
  console.error('[ldpass] 替换 pepper 前请先阅读 PASSWORD_PEPPER_LEGACY / PIN_PEPPER_LEGACY 的迁移说明。');
  process.exit(1);
}
