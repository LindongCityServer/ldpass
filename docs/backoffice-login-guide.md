# 后台登录入口说明

本文档说明临东通当前阶段管理员与发卡方如何进入各自后台，以及哪些入口还只是预留能力。

## 1. 入口总览

| 角色                | 当前入口             | 当前状态                       |
| ------------------- | -------------------- | ------------------------------ |
| 超级管理员 / 管理员 | `/admin/login`       | 已接入真实登录与权限校验       |
| 发卡方 / 提供方     | `/provider/login`    | 已接入负责人邮箱登录与独立会话 |
| 发卡方入驻申请      | `/provider/register` | 已接入入驻申请，需要管理员审核 |
| 普通用户            | `/login`             | 已接入真实登录                 |

生产环境部署后，把上面的路径拼到 Web 站点域名后即可访问。例如：

- 管理员登录：`https://你的三级域名/admin/login`
- 发卡方登录：`https://你的三级域名/provider/login`
- 发卡方入驻申请：`https://你的三级域名/provider/register`

本地开发环境通常是：

- 管理员登录：`http://127.0.0.1:3200/admin/login`
- 发卡方登录：`http://127.0.0.1:3200/provider/login`
- 发卡方入驻申请：`http://127.0.0.1:3200/provider/register`

## 2. 管理员后台登录

管理员后台除 `/admin/login` 外，已统一使用“顶部标题栏 + 侧边导航 + 主内容区”的后台壳。窄屏设备会把侧边导航折叠为横向滚动导航，避免后台入口散落在各个页面内部。

### 2.1 初始化超级管理员

首次部署后，需要先创建超级管理员账号。管理员密码不要长期写在 `.env` 中，建议执行 seed 时用 PowerShell 临时注入环境变量：

```powershell
npx --yes pnpm@10.14.0 db:push

$env:SEED_ADMIN_USERNAME="admin"
$env:SEED_ADMIN_EMAIL="admin@example.com"
$env:SEED_ADMIN_PASSWORD="请替换为至少 12 位的管理员密码"
$env:SEED_ADMIN_PIN="请替换为 4 到 12 位数字 PIN"
npx --yes pnpm@10.14.0 seed:super-admin
Remove-Item Env:\SEED_ADMIN_PASSWORD
Remove-Item Env:\SEED_ADMIN_PIN
```

`seed:super-admin` 会创建或更新一个 `super_admin` 角色账号，并把账户状态设为 `Active`。数据库只保存 `scrypt` 哈希，不保存明文密码或 PIN；脚本也会拒绝空密码、过短密码、占位符密码和不符合格式的 PIN。首次创建超级管理员时必须提供 `SEED_ADMIN_PIN`，已有 PIN 的管理员后续重跑 seed 可以不传 PIN。

### 2.2 登录方式

管理员访问 `/admin/login` 后，使用用户名或邮箱、密码和管理员 PIN 登录。后端会先校验账号角色，再校验 PIN，通过后才会创建后台会话。

后端实际调用：

```text
POST /api/auth/admin/login
```

登录成功后，系统会写入 `ldpass_session` HttpOnly Cookie。管理员后台页面会通过这个会话访问 API。

### 2.3 权限要求

管理员后台接口要求当前登录用户满足以下条件：

- 账户状态为 `Active`。
- 角色为 `admin` 或 `super_admin`。

如果普通用户访问管理员后台 API，会返回“需要管理员权限”。如果没有登录，会返回“请先登录”。

普通用户侧的卡包、转赠、核销、争议、通知、PIN、设备管理、服务器账号换绑和偏好设置接口也要求账户状态为 `Active`。待审核、被拒绝、等待服务器验证或被封禁的账户可以登录到 `/account` 查看当前状态，但只能读取基本会话状态、退出登录或注销账户，不能继续访问卡包业务和账户安全设置接口；外部项目调用 `client-session` 时同样只会把 `Active` 用户识别为已认证。

### 2.4 当前已实现的管理员页面

| 页面                            | 用途                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/admin`                        | 查看后台概览、待办数量、关键数字和最近审计                                                                                                  |
| `/admin/users`                  | 审核普通用户注册申请、搜索和导出用户目录、封禁/解封/删除用户、管理员介入重置用户密码                                                        |
| `/admin/providers`              | 手动创建发卡方和 owner 账号、审核发卡方入驻申请、审核资料变更、审核 API 密钥和 Webhook 创建申请、搜索和导出提供方目录、停用/恢复/归档发卡方 |
| `/admin/pass-templates`         | 审核发卡方提交的卡券模板                                                                                                                    |
| `/admin/card-template-variants` | 维护平台提供的卡面模板变体                                                                                                                  |
| `/admin/add-pass-token`         | 生成添加卡券领取码                                                                                                                          |
| `/admin/passes`                 | 搜索卡券、调整余额/权益、审核票券字段变更、导出全站卡券与流水 CSV                                                                           |
| `/admin/disputes`               | 查看争议记录并推进状态                                                                                                                      |
| `/admin/audit`                  | 查看领域事件审计记录，并按筛选条件导出审计 CSV                                                                                              |
| `/admin/platform`               | 配置全站公告和维护状态                                                                                                                      |
| `/admin/theme`                  | 配置主题色自动切换计划                                                                                                                      |
| `/admin/storage`                | 查看服务器存储空间状态与活动告警                                                                                                            |
| `/admin/legal`                  | 维护服务条款和隐私政策；提供方协议第一阶段不在后台入口展示                                                                                  |

`/admin` 是管理员后台首页，会读取 `GET /api/admin/dashboard/summary`，汇总用户审核、提供方审核、提供方资料变更、API 密钥审核、Webhook 配置审核、模板审核、票券字段变更、开放争议、存储告警、卡券状态、有效领取码、有效操作链接和最近审计记录。它只展示已有业务表的聚合结果，不产生新的业务写入。

`/admin/passes` 支持按当前关键词导出两个 CSV：

- 卡券 CSV：`GET /api/admin/passes/export.csv`
- 流水 CSV：`GET /api/admin/passes/ledger/export.csv`

在 `/admin/passes` 提交余额/权益调整、冻结或解冻卡券时，需要再次输入管理员 PIN。后端会校验 PIN 后才写入流水、更新卡券权益或改变卡券状态；PIN 错误不会产生调整或状态变更记录。冻结卡券后，发卡方不能再对该卡券发起消耗请求。

`/admin/users` 的用户目录支持按用户名、邮箱或服务器 ID 搜索用户，也可以按当前关键词导出用户目录 CSV。导出内容包含用户状态、注册 IP / IP 属地、服务器 ID、服务器账号验证状态和 PIN 设置状态，不包含密码哈希、PIN 哈希或会话 token。用户 PIN 由用户自助设置或修改，管理员后台只保留重置登录密码能力。管理员还可以封禁、解封或删除普通用户；这些敏感操作需要填写原因和管理员 PIN，成功后会撤销目标用户现有会话和设备，删除账户时释放用户名、邮箱和服务器 ID，并将审计记录匿名化为同一删除主体。相关操作会写入 `PinVerificationSucceeded`、`CredentialChanged`、`UserSuspended`、`UserUnsuspended` 或 `UserDeletedByAdmin` 审计事件。

`/admin/providers` 支持按名称、标识、联系人、联系邮箱或业务说明搜索提供方，也可以按当前关键词导出提供方目录 CSV。导出内容包含提供方状态、来源、联系人、审核/处置原因、账号数量、有效 API 密钥数和启用 Webhook 端点数，不包含负责人密码哈希、API 密钥明文、Webhook 签名密钥等敏感材料。

`/admin/providers` 可以手动创建提供方和负责人 owner 账号。创建后提供方与负责人账号直接启用，负责人可用邮箱和初始密码登录 `/provider/login`；数据库只保存负责人密码的 `scrypt` 哈希，创建操作会写入 `ProviderCreatedByAdmin` 和 `ProviderAccountCreated` 审计事件。

Active 发卡方可在 `/provider/dashboard` 提交提供方名称、头像图床 HTTPS 图片链接、介绍链接、联系人、联系邮箱和业务说明的资料变更申请。头像可以留空；如填写，必须是 HTTPS 且路径后缀为 `png`、`jpg`、`jpeg`、`webp`、`gif` 或 `avif`。介绍链接可以留空；如填写，必须是 HTTPS URL。管理员在 `/admin/providers` 的“资料变更待审”区域对比当前值和提交值；通过后才会写入 Provider 正式资料，拒绝时保存审核意见。提交、通过和拒绝会分别写入 `ProviderProfileChangeSubmitted`、`ProviderProfileChangeApproved`、`ProviderProfileChangeRejected` 审计事件。

发卡方在 `/provider/api-keys` 新增、轮换或停用 API 密钥时，都会先提交 API 密钥变更申请。管理员在 `/admin/providers` 的“API 密钥待审”区域查看申请类型、密钥名称、权限范围、有效期和申请说明；通过创建申请后才会创建真实 API 密钥，通过轮换申请后旧密钥停用且生成新密钥，通过停用申请后旧密钥才失效。创建和轮换产生的新明文密钥只允许发卡方一次性查看。提交、通过、拒绝、查看密钥和实际创建/轮换/停用会分别写入 `ProviderApiKeyChangeSubmitted`、`ProviderApiKeyChangeApproved`、`ProviderApiKeyChangeRejected`、`ProviderApiKeySecretClaimed`、`ProviderApiKeyCreated`、`ProviderApiKeyRotated`、`ProviderApiKeyRevoked` 审计事件；为了兼容创建申请审计，创建申请还会继续写入 `ProviderApiKeyCreateSubmitted` / `ProviderApiKeyCreateApproved` / `ProviderApiKeyCreateRejected`。

发卡方在 `/provider/webhooks` 新增回调端点时，会先提交 Webhook 配置申请。管理员在 `/admin/providers` 的“Webhook 配置待审”区域查看端点名称、回调地址、订阅事件和申请说明；通过后才会创建真实端点，发卡方随后只能一次性查看签名密钥。提交、通过、拒绝、查看密钥和实际创建端点会分别写入 `ProviderWebhookEndpointCreateSubmitted`、`ProviderWebhookEndpointCreateApproved`、`ProviderWebhookEndpointCreateRejected`、`ProviderWebhookSecretClaimed`、`ProviderWebhookEndpointCreated` 审计事件。

管理员也可以在 `/admin/providers` 对已启用提供方执行停用、对已停用提供方执行恢复，或把不再运营的提供方归档。停用、恢复和归档都需要填写原因并输入管理员 PIN；停用会撤销负责人现有后台会话，恢复会重新启用未归档的负责人账号，归档会把提供方和负责人账号置为 `Archived`，撤销负责人会话，停用未撤销的 API 密钥，并关闭仍启用的 Webhook 端点。相关操作会写入 `PinVerificationSucceeded`、`ProviderSuspended`、`ProviderUnsuspended` 或 `ProviderArchived` 审计事件。

`/admin/legal` 只维护服务条款和隐私政策。提供方协议第一阶段不在产品入口、公开页面和管理员维护入口展示；管理员保存后会写入 `LegalDocumentUpdated` 审计事件。公开页只按纯文本渲染正文，不会把管理员填写内容当作 HTML 执行。

`/admin/platform` 可以维护全站公告和维护状态。未登录用户也会读取 `/api/platform/status`，启用公告或维护提醒后，Web 根布局会在页面顶部展示平台状态横幅；管理员保存后会写入 `PlatformStatusUpdated` 审计事件。

`/admin/audit` 支持按事件类型、操作者 ID、对象 ID 筛选审计记录，也可以按当前筛选条件导出审计 CSV。导出内容包含事件类型、操作者、对象、Trace ID、摘要、保留策略和创建时间；导出接口仍要求管理员登录。

导出接口要求管理员登录，会复用页面上的关键词或筛选条件，CSV 会带 UTF-8 BOM，便于 Windows 上的表格软件打开。

## 3. 发卡方后台登录

发卡方后台除 `/provider/login` 和 `/provider/register` 外，已统一使用“顶部标题栏 + 侧边导航 + 主内容区”的后台壳。发卡方负责人登录后可以通过统一导航进入工作台、模板、发放、卡券、争议、API 密钥和 Webhook 页面。

### 3.1 入驻与负责人账号

发卡方通过 `/provider/register` 提交入驻申请时，需要填写：

- 提供方名称和标识。
- 联系人和联系邮箱。
- 业务说明。
- 负责人密码。

系统会同时创建 `Provider` 和负责人 `ProviderAccount`。联系邮箱就是发卡方负责人登录邮箱。

如果入驻申请被拒绝，负责人可以回到 `/provider/register`，使用原提供方标识、原联系邮箱和负责人密码重新提交修正后的资料。重新提交只会校验原密码，不会在该入口重置负责人密码；提交成功后 `Provider` 和负责人账号会重新进入 `PendingReview`。

### 3.2 审核与登录状态

管理员通过 `/admin/providers` 审核入驻申请：

- 审核通过：`Provider` 变为 `Active`，负责人账号变为 `Active`，可以登录。
- 审核拒绝：`Provider` 变为 `Rejected`，负责人账号会被停用，不能登录；负责人可在公开入驻页重新提交资料等待管理员再次审核。

发卡方登录入口为：

```text
/provider/login
```

后端实际调用：

```text
POST /api/providers/auth/login
GET /api/providers/auth/session
POST /api/providers/auth/logout
```

登录成功后，系统会写入 `ldpass_provider_session` HttpOnly Cookie。这个 Cookie 与普通用户/管理员的 `ldpass_session` 分离，避免不同后台身份互相污染。

### 3.3 当前已实现的发卡方页面

| 页面                  | 用途                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/provider/login`     | 发卡方负责人登录                                                                                                                |
| `/provider/register`  | 发卡方入驻申请                                                                                                                  |
| `/provider/dashboard` | 查看当前发卡方和负责人账号状态，提交需要管理员审核的资料变更申请                                                                |
| `/provider/templates` | 创建卡券模板并提交管理员审核                                                                                                    |
| `/provider/issue`     | 基于已审核模板生成单个或批量领取码/添加链接                                                                                     |
| `/provider/passes`    | 查看自己发出的卡券、调整金额/积分/次数、生成和撤销使用/额度补充操作链接、导出 CSV                                               |
| `/provider/disputes`  | 查看自己卡券相关的用户争议                                                                                                      |
| `/provider/api-keys`  | 提交 API 密钥申请、审批通过后一次性查看明文密钥、轮换/停用密钥；外部系统按 scope 调用发放、领取码管理、操作链接、卡券和核销接口 |
| `/provider/webhooks`  | 提交 Webhook 回调端点申请、审批通过后一次性查看签名密钥、查看投递记录和重试失败投递                                             |

### 3.4 模板创建与审核

发卡方登录后可以在 `/provider/templates` 创建卡券模板。当前模板创建会写入：

- `PassTemplate`
- 第一个 `PassTemplateVersion`
- `PassTemplateCreated` 领域事件

发卡方创建模板时，模板变体下拉框会优先读取管理员在 `/admin/card-template-variants` 启用的变体。当前变体接口为：

```text
GET /api/card-template-variants
GET /api/admin/card-template-variants
POST /api/admin/card-template-variants
POST /api/admin/card-template-variants/:variantId
POST /api/admin/card-template-variants/:variantId/delete
```

管理员创建、更新、删除变体时会分别发布 `CardTemplateVariantCreated`、`CardTemplateVariantUpdated`、`CardTemplateVariantDeleted`，并进入 `/admin/audit` 审计。

新模板默认进入 `PendingReview`。管理员在 `/admin/pass-templates` 审核：

- 通过后模板版本变为 `Approved`，模板变为 `Active`，并设置 `activeVersionId`。
- 拒绝后模板版本变为 `Rejected`，首个版本被拒绝时模板变为 `Rejected`。

已有模板需要修改卡面、规则、背景图、Logo 或展示字段时，发卡方在 `/provider/templates` 点击“提交新版”。系统会创建新的 `PassTemplateVersion` 并发布 `PassTemplateUpdateSubmitted`，管理员审核通过前不会替换当前 `activeVersionId`，所以当前可发放版本和已发放卡券不会被待审核内容影响。管理员通过后，新发放卡券会绑定新的模板版本；已发放卡券仍保留原来的 `templateVersionId`。

如果模板分类是证件/钥匙，发卡方可以在 `/provider/templates` 启用玩家位置范围核验。当前支持：

- 通过多位置编辑器添加、删除最多 10 个核验范围。
- 圆形范围：中心 `X/Z` 与半径。
- 矩形范围：`X/Z` 的最小值与最大值。
- 位置核验有效秒数，默认 60 秒。

这些位置规则会写入 `PassTemplateVersion.locationRules`，并跟随模板版本一起进入管理员审核。管理员在 `/admin/pass-templates` 可以看到审核用的 `位置规则` JSON 摘要，审核通过后用户钱包详情会展示“位置核验”入口。用户点击后，后端会通过 BDSLM 玩家位置接口读取当前服务器 ID 对应的玩家位置，并发布 `ServerLocationVerified` 领域事件。

### 3.5 发卡方生成领取码

模板审核通过后，发卡方可以在 `/provider/issue` 选择已激活模板并生成单个领取码，或一次批量生成最多 50 个领取码。当前流程会写入：

- `Pass`
- 初始 `LedgerEntry`
- `AddPassToken`
- `PassIssued` 领域事件
- `PassBalanceChanged` 领域事件

生成时需要区分两个有效期：领取码有效期控制 `/add?token=...` 链接可以被领取多久；卡券有效期会写入 `Pass.expiresAt`，用于用户详情展示和积分/次数临期提醒，不填写则长期有效。

生成后页面会展示领取码、`/add?token=...` 添加链接、对应卡号和单个领取码二维码；二维码在浏览器本地生成，不依赖外部二维码服务。批量发放会返回批次 ID，并可以复制全部卡号、掩码卡号、领取码与添加链接。用户登录后打开链接、扫描二维码或在 `/add` 输入领取码即可领取卡券。完整领取码不会被明文保存，后续列表只展示尾号；如果完整码丢失，管理员或发卡方可对未领取且仍关联待领取卡券的记录执行“作废并重发”，旧码会失效，新完整码只在重发结果中展示一次。

外部系统可以使用 `/provider/api-keys` 审批通过后领取的 API 密钥生成领取码。密钥只显示一次，数据库只保存哈希；请求时使用：

```text
Authorization: Bearer <API 密钥>
```

读取接口只需要 Bearer 密钥和对应 scope。写接口还必须携带：

```text
X-LDPass-Timestamp: <Unix 秒/毫秒时间戳或 ISO 时间>
X-LDPass-Idempotency-Key: <同一次业务请求稳定不变的幂等键>
X-LDPass-Signature: v1=<HMAC-SHA256 Base64URL 签名>
```

签名使用明文 API 密钥作为 HMAC key，签名内容按行拼接：

```text
LDPass-OpenAPI-V1
<HTTP 方法大写>
<完整请求路径，包含 /api 前缀和 query string>
<X-LDPass-Timestamp>
<X-LDPass-Idempotency-Key>
<原始请求体 SHA-256 hex>
```

服务器允许 5 分钟时间偏差。写接口首次成功后会保存幂等响应；同一密钥、同一幂等键再次请求会返回第一次响应，不会重复发卡或重复调整权益。开放 API 还会按 API 密钥和权限范围限流，默认每 60 秒 120 次，可通过 `.env` 中的 `OPEN_API_RATE_LIMIT_WINDOW_SECONDS` 和 `OPEN_API_RATE_LIMIT_MAX_REQUESTS` 调整。

发卡方后台使用的 API 密钥申请接口：

```text
GET /api/providers/api-keys
POST /api/providers/api-keys
POST /api/providers/api-keys/change-requests/:requestId/claim-secret
```

管理员后台使用的审核接口：

```text
GET /api/admin/providers/api-key-change-requests
POST /api/admin/providers/api-key-change-requests/:requestId/approve
POST /api/admin/providers/api-key-change-requests/:requestId/reject
```

当前已开放的接口：

```text
POST /api/open/provider/issuing/add-pass-tokens
POST /api/open/provider/issuing/add-pass-token-batches
GET /api/open/provider/issuing/add-pass-tokens
POST /api/open/provider/issuing/add-pass-tokens/:tokenId/revoke
POST /api/open/provider/issuing/add-pass-tokens/:tokenId/reissue
GET /api/open/provider/issuing/passes
POST /api/open/provider/issuing/passes/:passId/adjust
POST /api/open/provider/issuing/passes/:passId/freeze
POST /api/open/provider/issuing/passes/:passId/unfreeze
POST /api/open/provider/issuing/passes/:passId/archive
POST /api/open/provider/issuing/passes/:passId/ticket
POST /api/open/provider/action-links
GET /api/open/provider/action-links
POST /api/open/provider/action-links/:actionLinkId/revoke
POST /api/open/provider/action-links/revoke-batch
POST /api/open/provider/redemptions
POST /api/open/provider/redemptions/:requestId/cancel
POST /api/open/provider/redemptions/:requestId/reverse
GET /api/open/provider/redemptions
```

单个领取码接口需要 `add_pass_token:create` 权限，批量领取码接口需要 `add_pass_token:batch_create` 权限，领取码查询接口需要 `add_pass_token:read` 权限，领取码撤销接口需要 `add_pass_token:revoke` 权限，领取码作废并重发接口需要 `add_pass_token:reissue` 权限。操作链接生成接口需要 `action_links:create` 权限，操作链接查询接口需要 `action_links:read` 权限，操作链接单条撤销和批量撤销接口需要 `action_links:revoke` 权限。卡券查询接口需要 `passes:read` 权限，卡券冻结、解冻和取消/归档接口需要 `passes:status_update` 权限，票券字段变更申请接口需要 `passes:ticket_update` 权限，权益调整接口需要 `ledger:adjust` 权限，核销发起接口需要 `redemptions:create` 权限，核销取消接口需要 `redemptions:cancel` 权限，已完成核销冲正接口需要 `redemptions:reverse` 权限，核销记录查询接口需要 `redemptions:read` 权限。开放 API 的发放、领取码撤销/重发、操作链接生成/撤销、状态更新、票券字段变更申请、权益调整、核销发起、核销取消、核销冲正和核销记录查询复用发卡方后台同一套业务逻辑，仍会写入 `PassIssued`、`AddPassTokenRevoked`、`AddPassTokenReissued`、`WalletActionLinkCreated`、`WalletActionLinkRevoked`、`PassFrozen`、`PassUnfrozen`、`PassDeleted`、`PassTicketUpdateSubmitted`、`PassTicketUpdateApproved`、`PassTicketUpdateRejected`、`PassTicketStatusUpdated`、`PassBalanceChanged`、`PassUseRequested`、`PassUseCancelled`、`PassUseReversed` 和流水记录。API 密钥创建、轮换、停用申请会写入通用 `ProviderApiKeyChangeSubmitted`、`ProviderApiKeyChangeApproved` / `ProviderApiKeyChangeRejected`，实际创建、轮换、停用和明文领取分别写入 `ProviderApiKeyCreated`、`ProviderApiKeyRotated`、`ProviderApiKeyRevoked`、`ProviderApiKeySecretClaimed`。

发卡方还可以在 `/provider/webhooks` 提交 Webhook 端点申请，用于接收上述业务事件。管理员通过后端点才会生效，发卡方可一次性查看签名密钥。当前可订阅领取码撤销/重发、操作链接创建/消费/过期/撤销、额度补充发起/成功/失败/过期/取消/冲正、转赠发起/接收/拒绝/取消等事件。端点提交、通过、拒绝、实际创建、密钥领取、修改、轮换签名密钥和删除会分别写入 `ProviderWebhookEndpointCreateSubmitted`、`ProviderWebhookEndpointCreateApproved`、`ProviderWebhookEndpointCreateRejected`、`ProviderWebhookEndpointCreated`、`ProviderWebhookSecretClaimed`、`ProviderWebhookEndpointUpdated`、`ProviderWebhookSecretRotated`、`ProviderWebhookEndpointDeleted` 审计事件。页面也可以查看端点最近投递记录；失败、等待或已放弃的投递可手动重新排队，操作会写入 `ProviderWebhookDeliveryRetryRequested` 审计事件。

如果选择的模板分类是票券，`/provider/issue` 会额外展示票券字段：

- 活动名称。
- 场地。
- 场次时间。
- 座位。
- 初始检票状态。
- 初始改签/取消状态。

### 3.6 Webhook 回调

发卡方登录后可以在 `/provider/webhooks` 提交回调端点创建申请。管理员通过后才会创建实际端点。当前支持的事件包括：

- `PassIssued`
- `PassAddedToWallet`
- `PassBalanceChanged`
- `PassTicketStatusUpdated`
- `PassTicketUpdateSubmitted`
- `PassTicketUpdateApproved`
- `PassTicketUpdateRejected`
- `PassUseRequested`
- `PassUseSucceeded`
- `PassUseReversed`
- `PassUseFailed`
- `PassUseCancelled`
- `PassFrozen`
- `PassUnfrozen`
- `PassDeleted`
- `DisputeStatusChanged`

管理员通过端点申请后，发卡方页面会显示“查看签名密钥”按钮。签名密钥只展示一次，请立即复制；查看后申请记录不再保存可解密密钥。实际端点仍保存加密后的密钥用于投递签名，轮换后旧密钥立即失效。

发卡方后台使用的配置申请接口：

```text
GET /api/providers/webhooks
POST /api/providers/webhooks
POST /api/providers/webhooks/change-requests/:requestId/claim-secret
```

管理员后台使用的审核接口：

```text
GET /api/admin/providers/webhook-change-requests
POST /api/admin/providers/webhook-change-requests/:requestId/approve
POST /api/admin/providers/webhook-change-requests/:requestId/reject
```

Webhook 投递不会阻塞用户领取、核销或权益调整等主流程。后端会从 `OutboxEvent` 异步创建投递任务，默认每 30 秒扫描一次，单次 HTTP 超时默认 8 秒，最多尝试 5 次；这些值可以通过 `.env` 中的 `WEBHOOK_DISPATCH_INTERVAL_SECONDS`、`WEBHOOK_DELIVERY_TIMEOUT_SECONDS`、`WEBHOOK_MAX_ATTEMPTS` 调整。若 `WEBHOOK_DISPATCH_ENABLED=false`，Next.js API application context 不会投递 Webhook。

每次投递使用 `POST` JSON，请求头包含：

```text
X-LDPass-Webhook-Id: <投递记录 ID>
X-LDPass-Webhook-Event: <事件类型>
X-LDPass-Timestamp: <ISO 时间戳>
X-LDPass-Signature: v1=<Base64URL HMAC-SHA256>
```

签名内容为：

```text
<X-LDPass-Timestamp>
<原始 JSON 请求体>
```

外部系统应使用签名密钥计算 HMAC-SHA256，并与 `X-LDPass-Signature` 中 `v1=` 后面的值做常量时间比较。建议同时检查时间戳是否在可接受时间窗口内，避免重放请求。

请求体格式：

```json
{
  "deliveryId": "投递记录 ID",
  "eventId": "OutboxEvent ID",
  "eventType": "PassUseSucceeded",
  "createdAt": "2026-06-21T00:00:00.000Z",
  "payload": {
    "eventId": "领域事件 ID",
    "occurredAt": "2026-06-21T00:00:00.000Z",
    "actorType": "provider",
    "actorId": "发卡方账号 ID",
    "traceId": null,
    "payload": {}
  }
}
```

外部系统返回 2xx 即视为成功；非 2xx、超时或网络错误会进入指数退避重试。端点列表会显示最近成功、最近失败和最后错误。

发卡方后台使用的投递记录接口：

```text
GET /api/providers/webhooks/:endpointId/deliveries?take=20
POST /api/providers/webhooks/deliveries/:deliveryId/retry
```

手动重试只会把投递重新排队，实际 HTTP 投递仍由 Webhook 调度器异步执行。如果端点已停用，需要先启用端点再重试。

### 3.7 卡券查看与权益调整

发卡方可以在 `/provider/passes` 查看自己名下的卡券，支持按卡号、尾号、卡券名称、持有人用户名或邮箱搜索。现场核销使用独立的 `/provider/redemptions` 页面，只按已领取卡片的完整卡号读取和发起核销；领取码和添加链接只用于用户添加卡券，不再作为核销定位凭据。模板规则里的允许核销方名单为空时，仅原发卡方自身可核销。核销链接格式见 `docs/provider-redemption-link-format.md`。

搜索区域提供两个 CSV 导出入口：

- 导出卡券 CSV：导出当前搜索条件下的卡券清单、状态、余额、冻结值、透支额度和持有人信息。
- 导出流水 CSV：导出当前搜索条件下的权益流水、变化前后数值、备注、操作者和引用信息。

发卡方只能调整自己名下卡券的金额/积分/次数。提交调整时会写入：

- `Pass.balanceValue`
- `LedgerEntry`
- `PassBalanceChanged` 领域事件

调整值允许正数或负数，因此界面可以展示负数余额/透支状态。

如果模板规则启用了“允许转赠”，用户可以在钱包详情中向另一个已激活用户发起转赠。接收方必须在自己的钱包首页确认后，卡券归属才会切换。当前转赠会写入 `PassTransfer`，并发布：

- `PassTransferRequested`
- `PassTransferAccepted`
- `PassTransferRejected`
- `PassTransferCancelled`

管理员可在 `/admin/audit` 查看这些转赠审计事件。

票券分类的卡券可以在 `/provider/passes` 提交活动名称、场地、场次时间、座位、检票状态与改签/取消状态的变更申请。提交后不会立即改写卡券可见信息，而是创建 `PassTicketUpdateRequest` 并发布 `PassTicketUpdateSubmitted`；管理员在 `/admin/passes` 审核通过后才会写入 `Pass.metadata.ticketInfo`，并发布 `PassTicketUpdateApproved` 与 `PassTicketStatusUpdated`。如果管理员拒绝，会保留提交内容和拒绝原因，并发布 `PassTicketUpdateRejected`。

### 3.8 发起消耗请求

发卡方可以在 `/provider/passes` 选择已被用户领取的卡券并发起消耗请求；用户也可以在钱包首页 `/` 的卡券详情中主动输入消耗值并发起使用。第一阶段支持：

- 消耗值：金额、积分或次数统一使用数值输入。
- 验证方式：服务器账号验证或 PIN。
- 有效期：发卡方发起时默认 120 秒，可在 30 到 3600 秒之间调整；用户主动发起时固定使用默认 120 秒。
- 最大尝试：发卡方发起时默认 3 次，可在 1 到 10 次之间调整；用户主动发起时使用默认 3 次；PIN 错误会记录失败次数，次数耗尽后核销请求变为失败且不会扣减权益。

用户打开钱包首页 `/`，选择对应卡券后，会在详情面板看到待确认消耗。确认成功后系统会写入：

- `RedemptionRequest`
- `LedgerEntry`
- `PassUseRequested` / `PassUseSucceeded` 或 `PassUseFailed` 领域事件
- `PassBalanceChanged` 领域事件

如果已完成消耗需要撤销，发卡方可以在 `/provider/passes` 的最近核销请求中点击“冲正”，或通过开放 API `POST /api/open/provider/redemptions/:requestId/reverse` 提交冲正原因。系统不会删除原消耗流水，而是追加一条 `refund` 流水，将权益加回卡券，并把对应 `RedemptionRequest` 标记为 `Reversed`，同时发布 `PassUseReversed` 与 `PassBalanceChanged`。

管理员可以在 `/admin/passes` 的“额度补充冲正”区域输入补充 ID、原因和管理员 PIN，对已完成的卡内额度补充或补充操作链接进行反向冲正。系统不会删除原 `top_up` 流水，而是追加两条 `refund` 流水，将来源卡额度加回、目标卡额度扣回，同时发布 `PassTopUpReversed` 与两条 `PassBalanceChanged`。补充 ID 对应 `PassTopUpRequest.id`，普通卡内补充和补充操作链接成功后都会返回对应的 `topUp.id`。

### 3.9 争议记录

用户可以在钱包首页 `/` 的卡券详情中提交争议。当前争议会关联：

- 当前用户。
- 当前卡券。
- 争议对象类型和对象 ID；当前支持卡券整体、流水和额度补充请求，额度补充请求使用 `subjectType=pass_top_up`。
- 用户填写的争议原因。

发卡方可以在 `/provider/disputes` 查看自己卡券相关的争议记录。管理员可以在 `/admin/disputes` 查看全部争议并推进状态，支持 `处理中`、`需要补充`、`已认可`、`已驳回`、`已反转`、`已关闭`。对于核销请求或额度补充争议，管理员可在争议页输入冲正原因和管理员 PIN，先执行对应冲正，再把争议标记为 `已反转`。每次状态变化都会发布 `DisputeStatusChanged` 领域事件，并进入 `/admin/audit` 审计日志。

### 3.10 仍需后续细化的能力

当前发卡方已经有独立登录、模板提交、单个/批量领取码生成、权益调整、CSV 导出、发起消耗请求、已完成消耗冲正和 Webhook 回调；管理员后台已支持用户目录、提供方目录、卡券与流水 CSV 导出，并支持按补充 ID 冲正已完成额度补充。仍需后续继续细化：

- 更细的发卡方角色权限，例如操作员、财务、只读审计员。
- 批量发放的异步任务模型和失败重试；当前第一阶段按单次几十张的同步批次处理。
- 更完整的运营报表，例如按提供方、模板、卡券分类、核销量和争议状态聚合的统计视图。

## 4. 常见问题

### 4.1 管理员登录后访问后台仍提示无权限

请检查该账号的 `role` 是否为 `admin` 或 `super_admin`，并检查 `status` 是否为 `Active`。

### 4.2 发卡方审核通过后仍不能登录后台

请检查 `Provider` 和 `ProviderAccount` 是否都是 `Active`。如果入驻申请是在旧版本创建的，可能只有 `Provider` 记录而没有负责人 `ProviderAccount`，需要重新提交入驻申请或后续由管理员手动补建负责人账号。

### 4.3 改了后端登录或权限代码后是否需要重启

需要。后端业务模块现在由 Next.js API Route 内嵌加载；生产构建或非热更新模式下，改了后端登录、权限或业务代码后，需要重新构建并重启 Web 进程。
