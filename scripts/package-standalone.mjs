#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireFromRepo = createRequire(resolve(repoRoot, 'package.json'));
const webDir = resolve(repoRoot, 'apps/web');
const apiDir = resolve(repoRoot, 'apps/api');
const databaseDir = resolve(repoRoot, 'packages/database');
const webNextDir = resolve(webDir, '.next');
const packageDir = resolve(repoRoot, 'dist/ldpass-node24');
const archivePath = resolve(repoRoot, 'dist/ldpass-node24.tar');
const gzipArchivePath = resolve(repoRoot, 'dist/ldpass-node24.tar.gz');

const packageResolvePaths = [repoRoot, webDir, apiDir, databaseDir];
const runtimePackages = [
  'next',
  'react',
  'react-dom',
  'class-transformer',
  'class-validator',
  'reflect-metadata',
  '@prisma/client',
  '@prisma/adapter-libsql',
  'prisma',
  'dotenv',
  'qrcode',
];

assertDirectory(webNextDir, '缺少 Next 构建产物，请先执行 pnpm build。');
assertFile(resolve(webNextDir, 'required-server-files.json'), '缺少 required-server-files.json。');
assertDirectory(resolve(webDir, 'public'), '缺少 Web public 目录。');

preparePackageDirectory();
mkdirSync(packageDir, { recursive: true });

logStep('复制 Next 构建产物');
copyNextBuild();
copyDirectory(resolve(webDir, 'public'), resolve(packageDir, 'apps/web/public'));
copyFile(resolve(webDir, 'package.json'), resolve(packageDir, 'apps/web/package.json'));
copyFile(
  resolve(databaseDir, 'package.json'),
  resolve(packageDir, 'packages/database/package.json'),
);
copyFile(
  resolve(databaseDir, 'prisma.config.ts'),
  resolve(packageDir, 'packages/database/prisma.config.ts'),
);
copyDirectory(resolve(databaseDir, 'prisma'), resolve(packageDir, 'packages/database/prisma'));
copyFile(resolve(repoRoot, 'scripts/start-ldpass.mjs'), resolve(packageDir, 'start.mjs'));
copyFile(
  resolve(repoRoot, 'scripts/deploy-start-ldpass.mjs'),
  resolve(packageDir, 'deploy-start.mjs'),
);
copyFile(
  resolve(repoRoot, 'scripts/deploy-start-ldpass.cmd'),
  resolve(packageDir, 'deploy-start.cmd'),
);
copyFile(resolve(repoRoot, '.env.example'), resolve(packageDir, '.env.example'));
copyFile(
  resolve(repoRoot, 'docs/deployment-node24-standalone.md'),
  resolve(packageDir, 'README.md'),
);
logStep('复制 trace 依赖');
copyTracedFiles();
logStep('复制运行时 npm 包');
copyRuntimePackages();
logStep('物化 pnpm 包入口');
materializePnpmPackages();
logStep('复制 workspace 包入口');
copyWorkspacePackage('apps/api', '@ldpass/api');
copyWorkspacePackage('packages/contracts', '@ldpass/contracts');
copyWorkspacePackage('packages/database', '@ldpass/database');
copyWorkspacePackage('packages/event-bus', '@ldpass/event-bus');
copyWorkspacePackage('packages/ui', '@ldpass/ui');
logStep('写入启动入口和清单');
writeStandaloneServer();
writePackageMetadata();
logStep('创建归档包');
createArchive();

console.log(`[ldpass] standalone package: ${packageDir}`);
if (existsSync(archivePath)) {
  console.log(`[ldpass] archive: ${archivePath}`);
}
if (existsSync(gzipArchivePath)) {
  console.log(`[ldpass] gzip archive: ${gzipArchivePath}`);
}

function copyNextBuild() {
  copyDirectory(webNextDir, resolve(packageDir, 'apps/web/.next'), (source) => {
    const relativePath = toPosixPath(relative(webNextDir, source));
    return !relativePath.startsWith('cache') && !relativePath.startsWith('standalone');
  });
}

function copyTracedFiles() {
  const copiedSources = new Set();

  for (const traceFile of findFiles(webNextDir, (file) => file.endsWith('.nft.json'))) {
    const traceData = JSON.parse(readFileSync(traceFile, 'utf8'));
    const traceFileDir = dirname(traceFile);

    for (const relativeFile of traceData.files ?? []) {
      const logicalSource = resolve(traceFileDir, relativeFile);
      if (!existsSync(logicalSource)) {
        continue;
      }

      const realSource = resolveRealPath(logicalSource);
      if (copiedSources.has(realSource)) {
        continue;
      }

      const targetRelative = relative(repoRoot, realSource);
      if (targetRelative.startsWith('..')) {
        continue;
      }

      if (statSync(realSource).isDirectory()) {
        continue;
      }

      copyTracedPath(realSource, resolve(packageDir, targetRelative));
      copiedSources.add(realSource);
    }
  }
}

function copyWorkspacePackage(sourceRelativePath, packageName) {
  const sourceRoot = resolve(repoRoot, sourceRelativePath);
  const destinationRoot = resolve(packageDir, 'node_modules', ...packageName.split('/'));

  copyFile(resolve(sourceRoot, 'package.json'), resolve(destinationRoot, 'package.json'));
  copyDirectory(resolve(sourceRoot, 'dist'), resolve(destinationRoot, 'dist'));
}

function copyRuntimePackages() {
  const copiedPackages = new Set();
  for (const packageName of runtimePackages) {
    copyRuntimePackage(packageName, packageResolvePaths, copiedPackages);
  }
}

function copyRuntimePackage(packageName, resolvePaths, copiedPackages, options = {}) {
  const sourceRoot = resolvePackageRoot(packageName, resolvePaths);
  if (!sourceRoot) {
    if (!options.optional) {
      console.warn(`[ldpass] 未找到运行时包：${packageName}`);
    }
    return;
  }

  const packageData = readPackageData(sourceRoot);
  const resolvedPackageName = packageData.name || packageName;
  const copyKey = `${resolvedPackageName}:${sourceRoot}`;
  if (copiedPackages.has(copyKey)) {
    return;
  }
  copiedPackages.add(copyKey);

  const destinationRoot = resolve(packageDir, 'node_modules', ...resolvedPackageName.split('/'));
  copyPackageToDestination(sourceRoot, resolvedPackageName, destinationRoot);
  copyKnownNestedRuntimeDependencies(sourceRoot, resolvedPackageName, destinationRoot);

  const dependencyNames = [
    ...Object.keys(packageData.dependencies ?? {}),
    ...Object.keys(packageData.optionalDependencies ?? {}).filter(shouldCopyOptionalDependency),
  ];

  for (const dependencyName of dependencyNames) {
    copyRuntimePackage(dependencyName, [sourceRoot, ...packageResolvePaths], copiedPackages, {
      optional: Boolean(packageData.optionalDependencies?.[dependencyName]),
    });
  }
}

function copyPackageToDestination(sourceRoot, packageName, destinationRoot) {
  copyDirectory(sourceRoot, destinationRoot, createRuntimePackageFilter(sourceRoot, packageName));
}

function copyKnownNestedRuntimeDependencies(sourceRoot, packageName, destinationRoot) {
  if (packageName !== 'proper-lockfile') {
    return;
  }

  const dependencyName = 'signal-exit';
  const dependencyRoot = resolvePackageRoot(dependencyName, [sourceRoot, ...packageResolvePaths]);
  if (!dependencyRoot) {
    console.warn(`[ldpass] 未找到 ${packageName} 的嵌套依赖：${dependencyName}`);
    return;
  }

  copyPackageToDestination(
    dependencyRoot,
    dependencyName,
    resolve(destinationRoot, 'node_modules', ...dependencyName.split('/')),
  );
}

function writeStandaloneServer() {
  const serverPath = resolve(packageDir, 'apps/web/server.js');
  const content = `import { readFileSync } from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = module.createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname);

process.env.NODE_ENV = 'production';
process.chdir(__dirname);

const currentPort = Number.parseInt(process.env.PORT || '', 10) || 3200;
const hostname = process.env.HOSTNAME || '0.0.0.0';
let keepAliveTimeout = Number.parseInt(process.env.KEEP_ALIVE_TIMEOUT || '', 10);
if (!Number.isFinite(keepAliveTimeout) || keepAliveTimeout < 0) {
  keepAliveTimeout = undefined;
}

const requiredServerFiles = JSON.parse(
  readFileSync(path.join(dir, '.next/required-server-files.json'), 'utf8'),
);
const nextConfig = {
  ...requiredServerFiles.config,
  distDir: './.next',
};

process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig);

require('next');
const { startServer } = require('next/dist/server/lib/start-server');

startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
`;

  writeFileSync(serverPath, content, 'utf8');
}

function writePackageMetadata() {
  writeFileSync(
    resolve(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'ldpass-node24-standalone',
        private: true,
        type: 'module',
        scripts: {
          'deploy:windows': 'deploy-start.cmd',
          deploy: 'node deploy-start.mjs',
          start: 'node start.mjs',
        },
        engines: {
          node: '>=24 <25',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  writeFileSync(
    resolve(packageDir, 'DEPLOYMENT-MANIFEST.json'),
    `${JSON.stringify(
      {
        name: 'ldpass',
        packageKind: 'next-traced-standalone',
        nodeMajor: 24,
        builtAt: new Date().toISOString(),
        deployEntry: 'deploy-start.mjs',
        windowsDeployEntry: 'deploy-start.cmd',
        runtimeEntry: 'start.mjs',
        server: 'apps/web/server.js',
        databaseSchema: 'packages/database/prisma/schema.prisma',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function copyDirectory(source, destination, filter = () => true) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    force: true,
    dereference: true,
    filter,
  });
}

function createRuntimePackageFilter(sourceRoot, packageName) {
  return (source) => {
    const relativePath = toPosixPath(relative(sourceRoot, source));
    if (!relativePath) {
      return true;
    }

    if (
      packageName === 'next' &&
      (relativePath.endsWith('.map') ||
        relativePath.endsWith('.d.ts') ||
        relativePath.endsWith('.ts'))
    ) {
      return false;
    }

    return true;
  };
}

function removePath(path, options = {}) {
  rmSync(path, {
    recursive: options.recursive ?? false,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

function preparePackageDirectory() {
  try {
    removePath(packageDir, { recursive: true });
  } catch (error) {
    if (!existsSync(packageDir)) {
      return;
    }

    const archivedPath = `${packageDir}.delete-${Date.now()}`;
    renameSync(packageDir, archivedPath);
    console.warn(`[ldpass] 旧打包目录删除失败，已改名为 ${archivedPath}，可稍后手动清理。`);
    console.warn(error instanceof Error ? error.message : String(error));
  }
}

function copyFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    force: true,
    dereference: true,
  });
}

function copyTracedPath(source, destination) {
  const realSource = resolveRealPath(source);
  const stats = statSync(realSource);

  if (stats.isDirectory()) {
    copyDirectory(realSource, destination);
    return;
  }

  copyFile(realSource, destination);
}

function assertDirectory(path, message) {
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error(message);
  }
}

function assertFile(path, message) {
  if (!existsSync(path) || !lstatSync(path).isFile()) {
    throw new Error(message);
  }
}

function findFiles(root, predicate) {
  const results = [];
  const entries = readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'cache' || entry.name === 'standalone') {
        continue;
      }
      results.push(...findFiles(path, predicate));
      continue;
    }

    if (entry.isFile() && predicate(path)) {
      results.push(path);
    }
  }

  return results;
}

function materializePnpmPackages() {
  const pnpmRoot = resolve(packageDir, 'node_modules/.pnpm');
  if (!existsSync(pnpmRoot)) {
    return;
  }

  for (const packageSource of findPnpmPackageSources(pnpmRoot)) {
    const destination = resolve(
      packageDir,
      'node_modules',
      ...packageSource.packageName.split('/'),
    );
    if (!existsSync(destination)) {
      copyDirectory(packageSource.source, destination);
    }

    const destinationPackageJson = resolve(destination, 'package.json');
    if (!existsSync(destinationPackageJson)) {
      const sourcePackageJson = resolvePackageJson(packageSource.packageName);
      if (sourcePackageJson) {
        copyFile(sourcePackageJson, destinationPackageJson);
      }
    }
  }
}

function findPnpmPackageSources(pnpmRoot) {
  const results = [];

  for (const virtualStoreEntry of readdirSync(pnpmRoot, { withFileTypes: true })) {
    if (!virtualStoreEntry.isDirectory()) {
      continue;
    }

    const nestedNodeModules = resolve(pnpmRoot, virtualStoreEntry.name, 'node_modules');
    if (!existsSync(nestedNodeModules)) {
      continue;
    }

    for (const entry of readdirSync(nestedNodeModules, { withFileTypes: true })) {
      const entryPath = resolve(nestedNodeModules, entry.name);
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name.startsWith('@')) {
        for (const scopedEntry of readdirSync(entryPath, { withFileTypes: true })) {
          if (scopedEntry.isDirectory()) {
            results.push({
              packageName: `${entry.name}/${scopedEntry.name}`,
              source: resolve(entryPath, scopedEntry.name),
            });
          }
        }
        continue;
      }

      results.push({
        packageName: entry.name,
        source: entryPath,
      });
    }
  }

  return results;
}

function resolvePackageRoot(packageName, resolvePaths) {
  const packageJson = resolvePackageJson(packageName, resolvePaths);
  if (packageJson) {
    return dirname(packageJson);
  }

  try {
    return findPackageRootFromEntry(
      requireFromRepo.resolve(packageName, {
        paths: resolvePaths,
      }),
      packageName,
    );
  } catch {
    return findPackageRootFromNodeModules(packageName, resolvePaths);
  }
}

function resolvePackageJson(packageName, resolvePaths = packageResolvePaths) {
  try {
    return requireFromRepo.resolve(`${packageName}/package.json`, {
      paths: resolvePaths,
    });
  } catch {
    return null;
  }
}

function findPackageRootFromEntry(entryPath, packageName) {
  let current = dirname(entryPath);
  while (true) {
    const packageJson = resolve(current, 'package.json');
    if (existsSync(packageJson) && readPackageData(current).name === packageName) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findPackageRootFromNodeModules(packageName, resolvePaths) {
  for (const resolvePath of resolvePaths) {
    let current = resolve(resolvePath);
    while (true) {
      const candidate = resolve(current, 'node_modules', ...packageName.split('/'));
      const packageJson = resolve(candidate, 'package.json');
      if (existsSync(packageJson) && readPackageData(candidate).name === packageName) {
        return resolveRealPath(candidate);
      }

      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return null;
}

function readPackageData(packageRoot) {
  return JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
}

function shouldCopyOptionalDependency(packageName) {
  if (packageName.includes('win32')) {
    return process.platform === 'win32';
  }
  if (packageName.includes('linux')) {
    return process.platform === 'linux';
  }
  if (packageName.includes('darwin')) {
    return process.platform === 'darwin';
  }

  return true;
}

function resolveRealPath(source) {
  return realpathSync.native(source);
}

function toPosixPath(value) {
  return value.replaceAll('\\', '/');
}

function createArchive() {
  if (process.env.LDPASS_SKIP_ARCHIVE === 'true') {
    console.log('[ldpass] 已跳过归档创建。');
    return;
  }

  removePath(archivePath);
  removePath(gzipArchivePath);

  const shouldCreateGzip = process.env.LDPASS_CREATE_TGZ === 'true';
  const targetArchive = shouldCreateGzip ? gzipArchivePath : archivePath;
  const args = [shouldCreateGzip ? '-czf' : '-cf', targetArchive, '-C', packageDir, '.'];
  const archiveTimeoutMs =
    Number.parseInt(process.env.LDPASS_ARCHIVE_TIMEOUT_MS || '', 10) || 600000;

  const result = spawnSync('tar', args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    timeout: archiveTimeoutMs,
  });

  if (result.status === 0) {
    return;
  }

  removePath(targetArchive);
  console.warn('[ldpass] 归档创建失败；独立部署目录已生成，可手动压缩上传。');
  if (result.error) {
    console.warn(result.error.message);
  }
}

function logStep(message) {
  console.log(`[ldpass] ${message}`);
}
