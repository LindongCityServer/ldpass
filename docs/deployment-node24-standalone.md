# Node v24 独立包部署说明

本文档适用于 `pnpm package:standalone` 生成的 `dist/ldpass-node24` 独立包。服务器只需要已安装的 Node.js v24，不需要安装 pnpm 或 NestJS。Windows 服务器部署时直接调用包内 `deploy-start.cmd`，它会固定使用 `C:\node-v24\node.exe` 启动 `deploy-start.mjs`，准备运行目录并监听 `0.0.0.0:3200`。

## 构建打包

在开发机或 CI 的仓库根目录执行：

```powershell
pnpm install
pnpm package:standalone
```

产物位置：

- `dist/ldpass-node24/`：可直接上传的独立目录。
- `dist/ldpass-node24.tar`：Linux/macOS 默认生成未压缩归档。Windows 默认跳过 tar 归档，避免压缩 `node_modules` 时间过长或卡住。

Windows 上推荐直接上传 `dist/ldpass-node24/` 目录。如果确实需要归档，可以显式开启：

```powershell
$env:LDPASS_CREATE_TAR="true"
pnpm package:standalone
```

如果确实需要 gzip 压缩包，可以执行：

```powershell
$env:LDPASS_CREATE_TGZ="true"
pnpm package:standalone
```

本地反复调试启动脚本时，可以跳过归档以节省时间：

```powershell
$env:LDPASS_SKIP_ARCHIVE="true"
node scripts/package-standalone.mjs
```

## 服务器目录

推荐目录：

```text
/www/ldpass/
  current/        # 解压后的独立包
  data/           # SQLite 数据库文件，可软链到 current/data
  logs/
  backups/
```

上传后解压：

```bash
mkdir -p /www/ldpass/current
tar -xf ldpass-node24.tar -C /www/ldpass/current
cd /www/ldpass/current
cp .env.example .env
mkdir -p data logs
```

## 环境变量

编辑 `/www/ldpass/current/.env`，至少检查：

```env
DATABASE_URL="file:./data/ldpass.sqlite"
SESSION_SECRET="替换为至少 32 位随机字符串"
PROVIDER_API_KEY_SECRET="替换为另一段随机字符串"
WEBHOOK_SECRET_ENCRYPTION_KEY="替换为另一段随机字符串"
PASSWORD_PEPPER="替换为密码 pepper"
PIN_PEPPER="替换为 PIN pepper"
BDSLM_BASE_URL="https://example.com"
AUTH_COOKIE_DOMAIN="ldpass.shangxiaoguan.top"
AUTH_COOKIE_SECURE=true
PORT=3200
HOSTNAME=0.0.0.0
```

`file:./data/ldpass.sqlite` 会解析到独立包根目录下的 `data/ldpass.sqlite`。如果要把数据放到共享目录，可以把 `data` 做成软链，或改成绝对路径。

启动脚本会把相对的 SQLite `DATABASE_URL` 规范化为绝对路径，避免 Next.js standalone 进入 `apps/web` 工作目录后误读到另一个空数据库。

`AUTH_COOKIE_DOMAIN` 只填写域名，不要填写 `https://`、路径或端口；例如填写 `ldpass.shangxiaoguan.top`。如果不填写，会使用浏览器当前访问域名作为 host-only cookie。生产 HTTPS 部署建议保持 `AUTH_COOKIE_SECURE=true`；只有本地 HTTP 调试时才设置为 `false`。

## 数据迁移和升级

部署包自带 Prisma CLI。每次执行 `deploy-start.cmd` 时，启动脚本都会先运行 `prisma db push`，把当前 SQLite 数据库结构同步到新包内的 Prisma schema。因此迁移重点是：让新包读到原来的 SQLite 数据文件。

### 第一次从旧部署迁到独立包

先停止旧服务，避免复制过程中 SQLite 还在写入。然后在旧部署目录的 `.env` 中找到 `DATABASE_URL`：

```env
DATABASE_URL="file:./data/ldpass.sqlite"
```

如果是相对路径，它相对于旧部署进程的工作目录。把旧库文件复制到新包的数据目录：

```powershell
mkdir D:\wwwroot\ldpass\current\data
copy D:\old-ldpass\data\ldpass.sqlite D:\wwwroot\ldpass\current\data\
copy D:\old-ldpass\data\ldpass.sqlite-wal D:\wwwroot\ldpass\current\data\ 2>$null
copy D:\old-ldpass\data\ldpass.sqlite-shm D:\wwwroot\ldpass\current\data\ 2>$null
```

必须把 `ldpass.sqlite`、`ldpass.sqlite-wal`、`ldpass.sqlite-shm` 作为一组迁移；后两个文件不存在时可以忽略，但不能在它们存在时只复制主库文件。迁移完成后保持：

```env
DATABASE_URL="file:./data/ldpass.sqlite"
```

第一次启动新包时，`deploy-start.cmd` 会在这份旧数据上补齐新表，例如 `WalletActionLink`、`OutboxEvent`、`PlatformStatus`、`PlatformThemeScheduleEntry`。

### 后续发布新包

推荐把数据库放在固定共享目录，避免每次换包都搬数据：

```text
D:\wwwroot\ldpass\
  current\        # 当前独立包
  data\           # 固定 SQLite 数据目录
  backups\
```

此时 `.env` 建议写绝对路径：

```env
DATABASE_URL="file:D:/wwwroot/ldpass/data/ldpass.sqlite"
```

发布新包时：

1. 停止当前服务。
2. 备份 `D:\wwwroot\ldpass\data\ldpass.sqlite*` 到 `backups`。
3. 解压新包到新的 `current` 目录。
4. 复制旧 `current\.env` 到新 `current\.env`。
5. 执行 `.\deploy-start.cmd`。

如果暂时仍把数据库放在 `current\data` 里，那么每次替换 `current` 前，都要先把旧 `current\data\ldpass.sqlite*` 复制到新 `current\data\`，再启动新包。

## 部署并启动

确认服务器 Node 版本：

```powershell
C:\node-v24\node.exe -v
```

确认输出为 `v24.x.x`。如果服务器默认 `node` 还是 `v18.6.0`，不要直接执行 `node deploy-start.mjs`。

Windows 服务器直接调用包内启动脚本：

```powershell
cd D:\wwwroot\ldpass\current
.\deploy-start.cmd
```

`deploy-start.cmd` 默认调用 `C:\node-v24\node.exe`。如果 Node v24 安装在其他目录，可以先设置：

```powershell
$env:LDPASS_NODE24="D:\runtime\node-v24\node.exe"
.\deploy-start.cmd
```

如果云服务器后台需要拆分“启动程序 / 参数 / 工作目录”，可以这样填：

- 启动程序：`C:\node-v24\node.exe`
- 工作目录：`D:\wwwroot\ldpass\current`
- 启动参数：`D:\wwwroot\ldpass\current\deploy-start.mjs`
- 监听端口：`3200`

`deploy-start.mjs` 会做这些事：

- 检查当前 Node 是否为 v24。
- 读取 `.env`，并强制 `NODE_ENV=production`、`PORT=3200`。
- 创建 `data/` 和 `logs/`。
- 设置 `PROJECT_ROOT_PATH` 与 `PROJECT_DATA_PATH`。
- 执行 `prisma db push`，把 SQLite 数据库结构同步到当前 schema。
- 前台启动 Next.js 生产服务，适合交给云服务器后台、宝塔进程守护或 systemd 托管。

数据库结构同步不会携带 `--accept-data-loss`。如果 schema 变更会导致删列或删表，启动脚本会失败并保留原数据库，需要先备份并在维护环境中手动处理。已经手动同步过数据库时，可以设置 `LDPASS_SKIP_DB_PUSH=true` 跳过这一步。

健康检查：

```powershell
curl http://127.0.0.1:3200/api/health
```

Linux 服务器则需要确保 `node -v` 已经是 `v24.x.x`，或在进程管理器里填写 Node v24 的绝对路径，然后执行：

```bash
cd /www/ldpass/current
node deploy-start.mjs
```

## systemd 示例

```ini
[Unit]
Description=Ldpass Next standalone
After=network.target

[Service]
Type=simple
WorkingDirectory=/www/ldpass/current
ExecStart=/usr/local/bin/node /www/ldpass/current/deploy-start.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

保存为 `/etc/systemd/system/ldpass.service` 后：

```bash
systemctl daemon-reload
systemctl enable --now ldpass
journalctl -u ldpass -f
```

## Nginx 反代

整站反代到 Next.js，不要再单独配置 Nest API 端口：

```nginx
location / {
    proxy_pass http://127.0.0.1:3200;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`/api/*` 现在由 Next Route Handler 承接。
