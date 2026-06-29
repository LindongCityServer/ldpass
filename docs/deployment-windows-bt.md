# Windows Server + 宝塔面板部署草案

本文档用于记录临东通第一阶段的部署方式。当前目标是 Windows Server、宝塔面板、Nginx 反向代理、Windows 原生进程、SQLite 本地数据库文件。

## 1. 服务器组件

- Node.js：建议使用当前 Active LTS 或 Maintenance LTS。
- npm：随 Node.js 安装即可。
- pnpm：不要求全局安装；第一阶段通过 `npx --yes pnpm@10.14.0 ...` 临时运行仓库固定版本。
- SQLite：默认使用仓库根目录 `data\ldpass.sqlite`，不需要单独安装数据库服务。
- Nginx：使用宝塔面板自带或面板管理的 Nginx 反代。
- 进程守护：只需要守护 Next.js Web 进程。宝塔进程守护、NSSM、系统服务或平台自带 Next.js 托管均可，PM2 不是硬性要求。

## 2. 目录建议

```text
D:\wwwroot\ldpass\
  current\          # 当前发布版本
  releases\         # 历史发布包
  logs\             # 应用日志
  backups\          # 数据库备份或导出文件
```

发布时尽量采用新目录构建完成后切换 `current` 的方式，减少半更新状态。

## 3. 环境变量

从 `.env.example` 复制一份生产环境配置，重点检查：

- `DATABASE_URL`：SQLite 文件地址，默认 `file:./data/ldpass.sqlite`。
- `AUTH_COOKIE_DOMAIN`：同二级域名共享登录态时使用，例如 `.example.com`。
- `SESSION_SECRET`：长随机字符串。
- `PROVIDER_API_KEY_SECRET`：发卡方开放 API 密钥哈希使用的长随机字符串。
- `WEBHOOK_SECRET_ENCRYPTION_KEY`：加密保存发卡方 Webhook 签名密钥的长随机字符串。未单独设置时会回退使用 `PROVIDER_API_KEY_SECRET` 或 `SESSION_SECRET`，但生产环境建议单独设置。
- `WEBHOOK_DISPATCH_ENABLED`：是否启用 Webhook 异步投递，默认启用；设置为 `false` 可临时停止外部回调。
- `WEBHOOK_DISPATCH_INTERVAL_SECONDS`：Webhook 扫描间隔，默认 30 秒。
- `WEBHOOK_DELIVERY_TIMEOUT_SECONDS`：单次 Webhook HTTP 投递超时，默认 8 秒。
- `WEBHOOK_MAX_ATTEMPTS`：单条 Webhook 投递最多尝试次数，默认 5 次。
- `ACTION_LINK_EXPIRY_SWEEP_ENABLED`：是否启用操作链接过期清理，默认启用；设置为 `false` 可临时关闭后台清理。
- `ACTION_LINK_EXPIRY_SWEEP_INTERVAL_SECONDS`：操作链接过期清理扫描间隔，默认 60 秒。
- `ACTION_LINK_EXPIRY_SWEEP_BATCH_SIZE`：单次最多清理的过期操作链接数量，默认 100。
- `PASSWORD_PEPPER`：密码哈希额外 pepper，必须和数据库分开备份。
- `PIN_PEPPER`：PIN 哈希额外 pepper，必须和数据库分开备份。
- `BDSLM_BASE_URL`：当前 BDSLM 服务地址。
- `BDSLM_POLL_INTERVAL_MS`：聊天轮询间隔，第一阶段默认 1000。
- `BDSLM_REQUEST_TIMEOUT_MS`：单次 BDSLM HTTP 请求超时时间，默认 5000。
- `STORAGE_ALERT_MIN_FREE_BYTES` / `STORAGE_ALERT_MIN_FREE_RATIO`：低存储提醒阈值。

生产环境的密钥不要提交到 Git。初始超级管理员密码建议只在执行 seed 命令时临时设置，不要长期保存在 `.env` 中。

## 4. 数据库前置检查

`db:generate` 只生成 Prisma Client，不需要连接数据库；`build` 也可以在数据库未启动时完成。因此看到 build 成功不代表数据库已经可用。

当前默认使用 SQLite，不需要启动 PostgreSQL/MySQL 这类数据库服务。执行数据库同步前必须确认：

1. 仓库根目录已经有 `.env`，不能只依赖 `.env.example`。
2. `DATABASE_URL` 使用 SQLite `file:` 地址，默认可以保留 `file:./data/ldpass.sqlite`。
3. 应用目录有写入权限，能创建 `data` 目录和 `ldpass.sqlite` 文件。
4. 备份策略已经覆盖 `data\ldpass.sqlite`，以及可能出现的 `ldpass.sqlite-wal`、`ldpass.sqlite-shm` 文件。

可以先创建数据目录：

```powershell
New-Item -ItemType Directory -Force .\data
```

`.env` 中数据库配置示例：

```env
DATABASE_URL="file:./data/ldpass.sqlite"
SESSION_SECRET="请替换为至少 32 字符的随机字符串"
PROVIDER_API_KEY_SECRET="请替换为另一段至少 32 字符的随机字符串"
OPEN_API_RATE_LIMIT_WINDOW_SECONDS=60
OPEN_API_RATE_LIMIT_MAX_REQUESTS=120
WEBHOOK_SECRET_ENCRYPTION_KEY="请替换为另一段至少 32 字符的随机字符串"
WEBHOOK_DISPATCH_ENABLED=true
WEBHOOK_DISPATCH_INTERVAL_SECONDS=30
WEBHOOK_DELIVERY_TIMEOUT_SECONDS=8
WEBHOOK_MAX_ATTEMPTS=5
ACTION_LINK_EXPIRY_SWEEP_ENABLED=true
ACTION_LINK_EXPIRY_SWEEP_INTERVAL_SECONDS=60
ACTION_LINK_EXPIRY_SWEEP_BATCH_SIZE=100
```

## 5. 构建流程

```powershell
npx --yes pnpm@10.14.0 install --frozen-lockfile
npx --yes pnpm@10.14.0 db:generate
npx --yes pnpm@10.14.0 build
npx --yes pnpm@10.14.0 db:push

$env:SEED_ADMIN_USERNAME="admin"
$env:SEED_ADMIN_EMAIL="admin@example.com"
$env:SEED_ADMIN_PASSWORD="请替换为至少 12 位的管理员密码"
$env:SEED_ADMIN_PIN="请替换为 4 到 12 位数字 PIN"
npx --yes pnpm@10.14.0 seed:super-admin
Remove-Item Env:\SEED_ADMIN_PASSWORD
Remove-Item Env:\SEED_ADMIN_PIN
```

当前仓库还没有提交正式 Prisma migrations 目录，所以第一阶段本地和单机部署先使用 `db:push` 把 schema 同步到数据库。后续生成并提交初始 migration 后，生产部署再切换为 `db:deploy`。

首次部署没有锁文件时，先在开发机生成并提交 `pnpm-lock.yaml`；服务器上使用 `--frozen-lockfile`。

仓库根 `pnpm-workspace.yaml` 已显式允许 Prisma、esbuild 和 sharp 的构建脚本。如果 pnpm 版本升级后仍提示 build scripts 审批，需要检查 `onlyBuiltDependencies` 是否被保留。

如果服务器后续选择全局安装 pnpm 或启用 Corepack，也必须保持版本和仓库 `packageManager` 一致，不要混用多个包管理器生成锁文件。

## 6. 进程

建议只保留一个常驻进程：

- Web：`pnpm --filter @ldpass/web start`

如果服务器只提供 npm，可以在宝塔进程守护里使用：

```powershell
npx --yes pnpm@10.14.0 --filter @ldpass/web start
```

`/api/*` 现在由 Next Route Handler 承接，内部会启动后端 application context。Webhook 调度器和操作链接过期清理器随这个 context 以单例方式运行；生产环境可以把 `/api/health` 作为启动后的预热和健康检查入口。后续如果加入更重的 BDSLM 长轮询、异步导出 CSV、批量提醒或多实例部署，可以新增 worker 进程承接这些后台任务，不要把长轮询任务塞进请求路径。

## 7. Nginx 反向代理

推荐域名形态：

- Web：`https://pass.example.com`
- API：`https://pass.example.com/api`

Nginx 反代规则只需要把整站转发到 Next.js Web 本地端口，`/api/` 不再需要单独转发到 3201 之类的 API 端口。需要保留：

- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`
- `X-Real-IP`

如果未来重新拆出独立 API 域名，需要额外检查 Cookie Domain、CORS、SameSite 和 HTTPS 设置；当前全 Next.js 架构默认同源。

## 8. 数据库

- 当前 MVP 同步 schema 使用 `pnpm db:push`。
- 正式 migration 文件建立后，生产迁移改用 `pnpm db:deploy`。
- 备份至少包含 SQLite 数据库文件、`.env` 密钥、上传资源目录。
- SQLite 备份时需要一起保留 `data\ldpass.sqlite`、`data\ldpass.sqlite-wal`、`data\ldpass.sqlite-shm`。
- 审计日志永久保留，重型上下文后续通过压缩、摘要或本机归档降低空间压力。
- 第一阶段不做站外审计归档，但要启用剩余磁盘空间检测和管理员提醒。

## 9. PWA 与兼容

- 最低目标为 Android WebView 114 与 Safari 17。
- PWA 离线能力只缓存卡券基础信息和静态资源；私有卡券数据由登录后的前端调用 `/api/wallet/offline-snapshot` 后写入浏览器本地快照。
- Service Worker 不缓存 `/api/*` 请求，避免把带 cookie 的私有接口响应放进共享缓存。
- 离线状态不能领取卡券、核销、调整额度、执行敏感操作。
- 前端避免依赖过新的浏览器 API；新增 API 前需要检查兼容性。

离线钱包的验证方式：

1. 使用普通用户登录并打开首页，确认顶部出现离线卡券同步时间。
2. 停止 Next.js Web 进程或临时断网。
3. 刷新首页，应仍能看到最近同步过的基础卡券信息。
4. 此时详情流水、核销确认、排序、删除等写操作应显示离线提示，不允许显示成功。

## 10. 回滚

回滚顺序建议：

1. 停止 Web 进程。
2. 切回上一版发布目录。
3. 重启 Web。
4. 检查 `/api/health`。
5. 如果数据库迁移不可逆，不要直接回滚代码，需要先准备数据修复脚本。

## 11. 常见故障排查

### 11.1 `db:push` 报 SQLite 文件错误

默认 SQLite 不需要连接独立数据库服务。如果 `db:push` 报 schema engine、permission denied、unable to open database file 等错误，优先检查：

- `.env` 是否存在，且 `DATABASE_URL` 是否不是示例值。
- `DATABASE_URL` 是否仍为 `file:./data/ldpass.sqlite` 或一个有效 SQLite 文件地址。
- 仓库根目录是否存在 `data` 目录。
- 当前 Windows 用户或宝塔进程守护用户是否有应用目录写入权限。
- 数据库文件是否被杀毒软件、备份软件或另一个进程长时间锁定。

本机检查命令：

```powershell
New-Item -ItemType Directory -Force .\data
Test-Path .\data
```

### 11.2 注册页服务器验证按钮像没反应

服务器验证注册同时依赖 Next.js 应用、SQLite 文件和 BDSLM 聊天接口。排查顺序：

1. 打开 `/api/health`，确认 Next.js API Route 能返回 200。
2. 检查 `data\ldpass.sqlite` 是否存在，确认 Web 进程有读写权限。
3. 检查 Web 进程使用的 `.env` 中 `DATABASE_URL` 是否正确。
4. 检查 `BDSLM_BASE_URL` 是否能访问。
5. 如果 BDSLM 偶发慢响应，可以调大 `BDSLM_REQUEST_TIMEOUT_MS`，但不要设置得过长，否则用户会感觉按钮卡住。

当前前端请求超时为 15 秒；后端单次 BDSLM 请求默认 5 秒。超时后页面应显示明确错误，不应长期停在“创建中”。

### 11.3 页面能打开，但搜索、主题、分类等按钮都没反应

如果页面 HTML 能返回 200，但浏览器控制台或请求面板里出现 `/_next/static/chunks/app-pages-internals.js`、`./543.js` 等 Next.js chunk 404，通常是开发服务运行时又执行了 `next build` 或 `pnpm build`，导致 `.next` 目录里的开发产物和生产产物混在一起。

本地开发时按以下顺序恢复：

```powershell
Stop-Process -Id <当前 3200 端口对应的 PID>
Remove-Item -Recurse -Force .\apps\web\.next
npx --yes pnpm@10.14.0 --filter @ldpass/web dev
```

查找 3200 端口 PID：

```powershell
Get-NetTCPConnection -LocalPort 3200 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess
```

开发服务恢复后，`/_next/static/chunks/app-pages-internals.js` 不应再返回 404。生产环境不要使用 `next dev`，应在停止旧 Web 进程后执行 `pnpm build`，再启动 `next start`。
