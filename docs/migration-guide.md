# ldpass 升级与迁移指南

本文档面向已经上线、需要升级部署包或轮换密钥的场景。首次部署请看 `README.md`。

## 1. 升级前准备

1. 停止服务，避免 SQLite 在复制过程中仍有写入。
2. 备份 `data/ldpass.sqlite` 和当前 `.env` 到部署目录之外。
3. 记录当前 `.env` 中 `PASSWORD_PEPPER`、`PIN_PEPPER`、`PROVIDER_API_KEY_SECRET`、`WEBHOOK_SECRET_ENCRYPTION_KEY` 的原值，迁移过程需要用到。

### 不要随意修改 `DATABASE_URL`

项目历史上允许 `.env` 里出现多行 `DATABASE_URL`。注意两个入口的解析方式不同：

- `start.mjs` / `deploy-start.mjs`：保留文件中**第一个** `DATABASE_URL`；
- `seed:super-admin`（dotenv）：同一文件内**后值覆盖前值**。

因此升级时请保持 `DATABASE_URL` 原样不动，并建议删除重复定义，只保留一行：

```env
DATABASE_URL="file:./data/ldpass.sqlite"
```

改错这一行会让服务连接到新的空数据库，看起来像"数据丢失"，但原库文件通常仍在。

## 2. 替换部署包

1. 解压新部署包到临时目录。
2. 保留旧目录中的 `.env` 和 `data/`，用新包中的代码文件覆盖其余内容。
3. 执行 `deploy-start.cmd`（Windows）或 `node deploy-start.mjs`。

启动脚本会先校验密钥配置，再执行 `prisma db push` 同步数据库结构。

## 3. 密钥迁移（重点）

### 3.1 首次从示例占位符迁移到随机密钥

如果 `.env` 中仍是 `replace-with-...`，生产环境会**拒绝启动**。按是否存在历史数据分两种情况。

#### 情况 A：数据库中没有真实用户

直接替换以下 5 个变量，每个单独生成：

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

```env
SESSION_SECRET="新随机值"
PROVIDER_API_KEY_SECRET="新随机值"
WEBHOOK_SECRET_ENCRYPTION_KEY="新随机值"
PASSWORD_PEPPER="新随机值"
PIN_PEPPER="新随机值"
```

#### 情况 B：数据库已有用户、发卡方账号或 PIN

不能直接覆盖旧 pepper。正确顺序：

1. 先把旧 pepper 写入 LEGACY 变量：

```env
# 旧实现中 PIN 也优先使用 PASSWORD_PEPPER，因此两行都填旧的 PASSWORD_PEPPER 值
PASSWORD_PEPPER_LEGACY="旧的 PASSWORD_PEPPER"
PIN_PEPPER_LEGACY="旧的 PASSWORD_PEPPER"
```

2. 再把 `PASSWORD_PEPPER`、`PIN_PEPPER` 换成新的随机值。
3. 重启服务。用户下次成功登录或校验 PIN 时，系统会用新 pepper 重算哈希并自动写回数据库。
4. 观察一段时间，确认普通用户、管理员、发卡方账号都已正常登录且 PIN 操作可用。
5. 删除 `PASSWORD_PEPPER_LEGACY` 与 `PIN_PEPPER_LEGACY`。

说明：

- 未登录过的用户不会自动迁移，其旧哈希仍依赖 LEGACY，删除前请确认覆盖范围。
- 如果某个用户忘记了密码，无法自动迁移，只能由管理员重置密码或 PIN。

### 3.2 更换 `SESSION_SECRET`

可以直接更换，代价是所有已登录会话立即失效，用户需要重新登录。业务数据不受影响。

### 3.3 更换 `PROVIDER_API_KEY_SECRET`

该变量同时承担两个职责：

1. 计算 API Key 的 HMAC 指纹（`tokenHash`）；
2. 派生待领取明文 API Key 的加密密钥。

更换后：

- 旧密文可以通过 `PROVIDER_API_KEY_SECRET_LEGACY` 回退解密；
- 但 `tokenHash` 无法重算，**已发出的 API Key 会立即失效**，必须让发卡方重新申请并领取新 Key。

迁移配置：

```env
PROVIDER_API_KEY_SECRET="新随机值"
PROVIDER_API_KEY_SECRET_LEGACY="旧值"
```

确认所有发卡方都换发新 Key 后，删除 LEGACY。

### 3.4 更换 `WEBHOOK_SECRET_ENCRYPTION_KEY`

已有 Webhook 端点的签名密钥是加密存储的。更换主密钥时填入旧值即可继续解密：

```env
WEBHOOK_SECRET_ENCRYPTION_KEY="新随机值"
WEBHOOK_SECRET_ENCRYPTION_KEY_LEGACY="旧值"
```

确认所有端点都已重新轮换签名密钥后，删除 LEGACY。

## 4. 新增配置项

以下配置不填也能启动，会使用默认值：

```env
# 登录失败限流：账号 5 次 / IP 20 次，锁定 15 分钟
AUTH_LOGIN_MAX_ATTEMPTS=5
AUTH_LOGIN_WINDOW_SECONDS=900
AUTH_LOGIN_LOCK_SECONDS=900
AUTH_LOGIN_IP_MAX_ATTEMPTS=20
AUTH_LOGIN_IP_WINDOW_SECONDS=900
AUTH_LOGIN_IP_LOCK_SECONDS=900

# PIN 失败限流
AUTH_PIN_MAX_ATTEMPTS=5
AUTH_PIN_WINDOW_SECONDS=900
AUTH_PIN_LOCK_SECONDS=900

# 反向代理部署保持 true；直接暴露公网时设为 false
TRUST_PROXY_HEADERS=true

# 本地开发免密管理员登录，默认关闭
LDPASS_LOCAL_DEV_ADMIN_LOGIN=0
```

限流为进程内存实现，仅对单实例有效；重启后计数清零。多实例部署需要改用外部存储。

## 5. 验证清单

升级后逐项确认：

1. 启动日志没有密钥配置错误。
2. 管理员账号密码 + PIN 登录成功。
3. 普通用户密码登录成功，充值/兑换 PIN 校验正常。
4. 发卡方账号登录成功。
5. 已配置的 Webhook 能正常投递并验签。
6. 开放 API Key 调用返回正常（如本次更换过 `PROVIDER_API_KEY_SECRET`，需使用新签发的 Key）。
7. 审计日志中的登录 IP 正常（反向代理场景确认 `TRUST_PROXY_HEADERS=true`）。

## 6. 回滚

如果升级后需要回滚：

1. 停止服务。
2. 恢复备份的 SQLite 与 `.env`。
3. 切回旧部署包。

注意：如果已经有用户在新 pepper 下完成重哈希，直接恢复旧 `.env` 会让这些账号无法验证。正确做法是：

- 继续使用新包；或
- 回滚时把**新 pepper** 填入旧部署包的 `PASSWORD_PEPPER` / `PIN_PEPPER`，并把旧 pepper 作为 LEGACY（旧包不支持 LEGACY，因此更推荐保留新包）。

不要在迁移完成且已有用户重哈希后，简单地把 pepper 改回旧值。
