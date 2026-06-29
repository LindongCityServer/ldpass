import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    '/api/*': [
      '../api/dist/**/*',
      '../api/node_modules/**/*',
      '../api/package.json',
      '../../packages/contracts/dist/**/*',
      '../../packages/contracts/package.json',
      '../../packages/database/dist/**/*',
      '../../packages/database/node_modules/**/*',
      '../../packages/database/package.json',
      '../../packages/event-bus/dist/**/*',
      '../../packages/event-bus/package.json',
    ],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: [
    '@ldpass/api',
    '@ldpass/database',
    '@prisma/adapter-libsql',
    '@prisma/client',
  ],
};

export default nextConfig;
