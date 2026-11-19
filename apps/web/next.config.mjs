import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, '../..');
const useNextStandaloneOutput = process.env.LDPASS_USE_NEXT_STANDALONE === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(useNextStandaloneOutput ? { output: 'standalone' } : {}),
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
  async headers() {
    return [
      {
        // 绑定链接把一次性 token 放在 query 里，禁止通过 Referer 泄漏给字体等第三方资源。
        source: '/account/link/qq',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // 登录页的 next 参数可能带着绑定 token；登录页同样禁止向外发送 Referer，并避免页面缓存。
        source: '/login',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/api/account/qq-link/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/account/qq-links/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        source: '/api/internal/qq-link/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
  webpack: (config) => {
    // 工作区内 TS 包通过 tsconfig paths 直接引用源码，源码里的 NodeNext 风格 `./x.js` 需要映射回 `.ts`。
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  serverExternalPackages: [
    '@ldpass/api',
    '@ldpass/database',
    '@prisma/adapter-libsql',
    '@prisma/client',
  ],
};

export default nextConfig;
