# 临东通实现目标清单

本文档用于约束后续开发目标：每个阶段都必须形成可操作、可验证的功能闭环，避免只完成页面骨架但无法测试业务流程。

## 1. 总目标

把临东通从当前的原型骨架推进到一个可本地测试、可部署、可逐步扩展的卡包管理系统。

最终应至少覆盖三类角色：

- 普通用户：注册、登录、添加卡券、查看卡券、使用卡券、查看记录。
- 卡券提供方：创建或申请提供方账号、配置卡券模板、发放卡券、调整额度或权益、查看核销记录。
- 超级管理员：审核用户、审核提供方、审核卡券模板、管理主题计划、查看审计与系统状态。

## 2. 交付原则

- 每个按钮都必须有明确反馈。暂未接入后端时，页面必须说明当前停在什么状态，不能静默无响应。
- 每个核心流程都要有真实数据流。后续业务功能不能长期依赖前端假数据。
- 后端业务模块保持事件驱动。核心 Service 完成数据库操作后发布领域事件，不直接调用其他业务 Service。
- 先做最小闭环，再扩展体验。优先保证注册、登录、发卡、领卡、查看卡券这些路径可以端到端跑通。
- 所有敏感操作需要留下审计记录。短期可以先做单人审批，但事件和数据结构要为后续扩展留空间。

## 3. 当前状态

| 模块            | 当前状态                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 产品需求        | `docs/requirements.md` 已较完整                                                                                                                                                                                                                                                                                                           |
| 部署说明        | `docs/deployment-windows-bt.md` 已有初稿                                                                                                                                                                                                                                                                                                  |
| Web 页面        | 首页、登录、注册、添加卡券、搜索、编辑、管理员登录、发卡方登录已有页面                                                                                                                                                                                                                                                                    |
| 前端主题        | 浅色/深色/跟随系统、主题色、灰色主题图片灰调已实现                                                                                                                                                                                                                                                                                        |
| 注册页面        | 已接入真实注册申请 API，服务器验证可创建验证码并检查聊天验证状态；API/BDSLM 慢响应会给出超时提示                                                                                                                                                                                                                                          |
| 登录页面        | 已接入真实登录 API，会话通过 HttpOnly cookie 保持；支持 `client_id`、`redirect_uri`、`state` 自定义登录回跳和 `next` 站内继续操作回跳；管理员登录已强制校验 PIN 后再创建会话；后续身份模型应收敛为统一用户账户 + 发卡方成员身份/当前工作区，避免普通用户和发卡方双 session 抢占设备角色                                                                                                                                                              |
| 账户页面        | 已改为标题栏 + 账户摘要 + 设置入口布局；退出登录、输入密码软注销账户、设置 PIN、服务器账号换绑、积分/次数过期提醒天数、新设备登录确认和设备管理通过弹窗完成                                                                                                                                                                               |
| 设备绑定        | 已提供设备列表、撤销设备、同系统最多 2 台设备限制，并为已有设备账户的新设备登录接入服务器账号验证与已登录设备确认                                                                                                                                                                                                                         |
| 管理员后台首页  | 已提供 `/admin` 概览页，汇总待办、关键数字和最近审计，帮助管理员优先处理审核、争议和告警                                                                                                                                                                                                                                                   |
| 管理员用户审核  | 已提供用户目录、待审核列表、通过、拒绝、封禁、解封、软删除、管理员介入重置用户 PIN、用户目录 CSV 导出的后台页面与 API                                                                                                                                                                                                                       |
| 客户端应用      | 已提供管理员登记 `client_id`、回跳白名单、允许来源，登录页会校验回跳地址后返回外部项目，外部项目可按允许来源校验当前登录态                                                                                                                                                                                                                |
| 添加卡券闭环    | 已提供管理员和发卡方生成领取码、添加链接、本地二维码、添加前预览、用户领取卡券、领取成功后直达卡券详情、未登录领取时引导登录后回到添加动作、首页读取真实钱包卡券，并在生成领取码时写入初始发放流水；`/add` 在普通用户登录态下只接受领取码/添加链接，发卡方专用登录态或显式 `mode=redeem` 下切换为按卡号、领取码或添加链接定位卡片的核销模式；同一浏览器双 session 时默认按普通用户添加处理，过期领取码在核销模式下仍可作为定位索引                                                                                                                                        |
| 钱包编辑        | 已提供卡券排序和从钱包归档的真实 API，首页编辑模式已接入；首页卡片按卡面图优先规则展示，有卡面图时只显示卡面图和左下角卡号末四个字符，无图且未隐藏标题时显示标题/余额兜底，隐藏标题时只留卡号末四个字符                                                                                                                                                                                                                                                                                  |
| 卡券详情        | 已提供当前用户卡券详情 API；首页详情默认展示摘要和模块入口，余额摘要只展示权益值，发卡方进入独立模块并可展示审核通过的介绍链接；卡片详情、充值、来源卡选择、发起核销、待确认核销、交易记录、争议记录、提交争议和转赠进入弹窗闭环，交易记录通过独立接口按需读取并合并额度补充请求记录                                                                                  |
| 审计日志        | 已通过事件监听器把领域事件写入 `AuditLog` 和 `OutboxEvent`，管理员可查看最近审计记录，并按当前筛选条件导出审计 CSV                                                                                                                                                                                                                         |
| 管理员权益调整  | 已提供管理员搜索真实卡券、通过 PIN 二次验证后提交增减值、写入流水、更新余额和审计事件的最小闭环；管理员也可审核票券字段变更，通过后才更新卡券可见票券信息                                                                                                                                                                               |
| 管理员 CSV 导出 | 已提供管理员按当前搜索条件导出用户目录、提供方目录、全站卡券清单和权益流水 CSV 的最小闭环                                                                                                                                                                                                                                                   |
| 提供方入驻      | 已提供公开入驻申请、管理员手动创建提供方与 owner 账号、负责人账号创建、管理员审核通过/拒绝、停用/恢复/归档、提供方目录搜索与导出、发卡方登录会话、Active 发卡方名称、头像、介绍链接、联系人、邮箱和业务说明变更申请、管理员资料变更审核和审计事件的最小闭环                                                                                                                       |
| 卡券模板        | 已提供发卡方创建模板、提交已有模板新版本、管理员审核通过/拒绝、模板激活和审计事件的最小闭环                                                                                                                                                                                                                                               |
| 发卡方发放      | 已提供发卡方基于已审核模板生成单个或批量领取码/添加链接、写入初始流水和审计事件的最小闭环；生成、批量复制、重发和领取码列表会展示对应卡号，支持实体卡制卡时建立领取码、添加链接与稳定卡号的对应关系                                                                                                                                                                                                                                                 |
| 开放提供方 API  | 已提供发卡方 API 密钥创建审批、审批通过后一次性查看明文密钥、密钥轮换/停用，以及 API 密钥发放领取码、查询/撤销/重发领取码、生成/查询/撤销操作链接、查询卡券、提交票券字段变更审核、调整权益、写接口签名、幂等响应复用和按密钥/scope 限流的最小闭环                                                                                        |
| 发卡方 Webhook  | 已提供发卡方提交回调端点申请、管理员审核通过后创建端点、发卡方一次性查看签名密钥、按事件选择投递、异步重试和配置审计事件的最小闭环；已支持领取码撤销/重发、操作链接创建/消费/过期/撤销、额度补充冲正、转赠状态变化、票券变更审核状态等事件订阅                                                                                       |
| 发卡方权益调整  | 已提供发卡方查看自己名下卡券、搜索卡券、调整金额/积分/次数、导出卡券与流水 CSV、写入流水和审计事件的最小闭环                                                                                                                                                                                                                              |
| 操作链接管理    | 已提供发卡方生成确认使用/额度补充链接、按类型和状态筛选、查看当前或全部卡券链接、单条撤销和批量撤销 Active 链接，API 进程会定时标记过期链接，完整链接只在生成结果中展示一次                                                                                                                                                               |
| 卡券转赠        | 已提供发行方规则控制、用户发起转赠、接收方确认/拒绝、发起方取消和审计事件的最小闭环                                                                                                                                                                                                                                                       |
| 争议记录        | 已提供用户从卡券详情提交争议、发卡方查看关联争议、管理员推进争议状态并写入审计事件的最小闭环；核销和额度补充争议可直接冲正并标记已反转，普通卡券/流水/管理员调整争议必须填写处理备注后推进状态                                                                                                                                              |
| 卡面模板变体    | 已提供管理员增删改查卡面模板变体、发卡方创建模板时读取启用变体、变体管理审计事件的最小闭环                                                                                                                                                                                                                                                |
| 用户提醒        | 已提供积分/次数卡券临近过期提醒扫描、站内提醒列表、标记已读和审计事件的最小闭环                                                                                                                                                                                                                                                           |
| 平台状态        | 已提供公开读取和管理员动态保存全站公告、维护状态，未登录用户也会看到平台横幅                                                                                                                                                                                                                                                              |
| 主题计划        | 已提供公开读取和管理员动态保存主题色自动切换计划，未登录用户也会读取最新计划                                                                                                                                                                                                                                                              |
| 存储空间检测    | 已提供管理员读取与手动检测磁盘剩余空间、活动告警和审计事件的最小闭环                                                                                                                                                                                                                                                                      |
| 协议文档        | 已提供公开读取和管理员维护协议文档的最小闭环；第一阶段产品侧和公开接口只保留服务条款和隐私政策，提供方协议先作为历史预留 key 保留                                                                                                                                                                                                         |
| PWA 离线钱包    | 已提供 Service Worker 应用壳缓存、钱包离线快照接口和前端本地快照回退，离线时仅展示基础卡券信息                                                                                                                                                                                                                                            |
| API 应用        | 已有健康检查、身份认证、登录回跳校验、外部客户端会话校验、管理员后台概览、管理员客户端应用管理、管理员用户审核、提供方审核、发卡方认证、发卡方 API 密钥创建/轮换/停用审批、发卡方 Webhook 创建审批、开放发放 API、卡券模板审核、发卡方生成领取码、发卡方权益调整、操作链接过期清理、钱包离线快照、用户提醒、平台状态、主题计划、审计查询、权益调整、BDSLM 聊天与玩家位置 client 起点 |
| 数据模型        | Prisma schema 已覆盖主要实体，并新增用户角色、用户会话、发卡方账号/会话、发卡方 API 密钥、API 密钥创建/轮换/停用申请、发卡方 Webhook 端点、Webhook 创建申请和投递记录、验证码检查位置、验证码用途、卡券排序字段、用户站内提醒和新设备登录确认请求；后续需要把网页登录身份从独立 `ProviderAccount` 迁移为 `User` + `ProviderMembership`，保留 API 密钥作为机器身份                                                                                                     |
| 事件契约        | `packages/contracts` 已定义主要领域事件，包含账户删除、用户偏好更新、临期提醒、发卡方账号、发卡方 API 密钥创建/轮换/停用审批、发卡方 Webhook 创建审批、客户端应用、卡券排序、新设备登录确认、服务器账号换绑、操作链接创建/消费/过期/撤销、平台状态、主题计划、协议文档和存储告警事件                                                               |

## 4. 第一阶段目标：真实账号闭环

目标：让注册、审核、登录不再停留在页面骨架。

需要完成：

- 用户注册申请接口：提交用户名、邮箱、审核信息，并记录注册 IP 与本地粗分类 IP 属地；管理员用户审核页已展示这些信息。后续如需省/州级精准属地，可替换为离线 IP 库或可信查询服务。
- 服务器验证注册接口：提交用户名、邮箱、服务器 ID，创建验证码挑战；本次聊天验证码验证成功后直接激活账户、写入当前浏览器会话并进入钱包，旧的已验证 challenge 不重复换取会话。
- BDSLM 聊天验证流程：轮询聊天消息，匹配服务器 ID 与验证码；后端统一通过 BDSLM 消息读取器兼容 `name` / `text` 作为服务器 ID、`content` / `message` / `body` 作为聊天内容。
- 验证码刷新规则：如果用户发送了其他内容，需要及时作废旧验证码并下发新验证码。
- 管理员审核用户接口：通过、拒绝、填写拒绝原因。
- 用户重新提交审核信息接口：被拒绝或待审核用户可在受限账户页补充审核信息，状态重新进入 `PendingReview`，并记录注册 IP / IP 属地和审计事件。
- 发卡方重新提交入驻申请：被拒绝或待审核的提供方可在 `/provider/register` 使用原标识、原联系邮箱和负责人密码更新入驻资料，状态重新进入 `PendingReview` 并写入 `ProviderSubmitted`。
- Active 发卡方资料变更申请：发卡方在 `/provider/dashboard` 提交名称、头像图床 HTTPS 图片链接、介绍链接、联系人、联系邮箱和业务说明变更；头像可留空，如填写必须是 HTTPS 且路径后缀为 `png`、`jpg`、`jpeg`、`webp`、`gif` 或 `avif`；介绍链接可留空，如填写必须是 HTTPS URL。系统创建 `ProviderProfileChangeRequest`，管理员通过前不改写正式资料。
- 管理员介入重置用户 PIN。已完成最小闭环：`GET /admin/users` 搜索用户目录，`POST /admin/users/:userId/pin/reset` 写入新 PIN 哈希并发布审计事件。
- 登录接口：用户名优先，邮箱备选；非 `Active` 且未删除的普通用户可登录为受限会话并跳转到账户页查看状态。
- 会话机制：登录后写入安全 cookie，提供 `GET /auth/session`。
- 业务访问控制：钱包、核销、转赠、争议、通知、PIN、设备管理、服务器账号换绑和偏好设置等用户侧能力必须通过 Active 用户校验；非 Active 会话只能读取基本会话状态、退出登录或注销账户，不能访问卡包和账户安全设置接口。
- 新设备登录验证。已完成服务器账号验证和已登录设备确认两个最小闭环：已有设备的账户从新设备登录时，后端可同时返回服务器聊天验证码和账户页确认请求，任一验证通过后才绑定设备和创建会话。
- 服务器账号换绑。已完成账户页发起换绑、BDSLM 聊天验证码检查、换绑成功后撤销其余设备和会话、写入审计事件的最小闭环。
- 退出登录接口。
- 注销账户接口：用户输入当前密码后把自己的账户软删除为 `Deleted`，撤销当前账户所有会话和设备，保留卡券、流水、争议与审计引用。
- 管理员登录入口：复用账号系统，但必须校验管理员权限和管理员 PIN。
- 自定义登录回跳与会话校验。已完成管理员登记客户端应用、服务端严格校验 `redirect_uri`、登录成功后携带 `state` 返回外部项目、按允许来源校验当前登录态的最小闭环。

验收标准：

- 用户可以从 `/register` 提交审核注册，并在数据库中生成待审核用户。
- 待审核用户可以从 `/login` 登录并进入 `/account` 查看审核状态，但访问钱包接口应被后端拒绝。
- 管理员拒绝用户后，用户重新登录 `/account` 应能看到拒绝原因，并可提交新的审核信息重新进入待审核列表。
- 管理员可以审核通过该用户。
- 审核通过后用户可以从 `/login` 登录。
- 用户刷新页面后仍能保持登录状态。
- 用户可以在账户页退出登录或注销自己的账户。
- 未登录访问需要登录的页面时，会被正确引导到登录页。

## 5. 第二阶段目标：钱包与添加卡券闭环

目标：让用户登录后能领取并看到真实卡券。

需要完成：

- 钱包列表接口：返回当前用户持有的卡券。
- 卡券详情接口：返回余额、权益类型、状态、有效期、卡面和规则摘要。已完成最小闭环：`GET /wallet/passes/:passId`；交易记录已拆到独立接口 `GET /wallet/passes/:passId/ledger`，用于详情弹窗按需刷新流水，避免打开详情时默认加载流水列表。
- 添加卡券 token 接口：管理员可生成添加链接/二维码所需 token。已完成最小闭环：管理员和发卡方生成领取码后可复制完整添加链接，单个领取码会在浏览器本地生成二维码。
- 添加卡券预览接口。已完成最小闭环：`GET /wallet/add-tokens/preview` 可按领取码展示提供方、卡券标题、权益类型、初始值、领取码有效期、卡券有效期和服务器账号限制。
- 添加卡券领取接口：校验登录状态、token 状态、过期时间、是否要求服务器账号验证。
- 首页接入真实钱包数据。
- 空状态和有卡状态都要可测试。
- 编辑模式接入真实排序或归档操作。已完成最小闭环：`POST /wallet/passes/reorder` 与 `POST /wallet/passes/:passId/archive`。
- 搜索栏接入当前用户持有卡券的本地或服务端过滤。
- 离线基础信息快照。已完成最小闭环：`GET /wallet/offline-snapshot` 返回当前用户卡券摘要，前端保存最近快照并在断网时只读展示。
- 积分/次数过期提醒。已完成最小闭环：发卡时可设置卡券有效天数并写入 `Pass.expiresAt`，`GET /notifications` 会按用户设置的提前天数扫描临期积分/次数卡券并生成去重站内提醒，`POST /notifications/:notificationId/read` 可标记已读。

验收标准：

- 登录用户打开 `/add?token=...` 可以领取一张真实卡券。
- 未登录用户打开 `/add?token=...` 会被引导到 `/login?next=/add?...`，登录成功后继续添加动作。
- 用户在 `/add` 输入领取码或打开添加链接时，可以先看到真实卡券来源、权益和领取限制。
- 领取后首页出现该卡券，并自动打开该卡券详情。
- 点击卡券可以看到真实详情。
- 删除或归档卡券后，刷新页面仍保持结果。

## 6. 第三阶段目标：提供方发卡与额度调整闭环

目标：让提供方可以创建卡券模板、发放卡券、调整用户权益。

需要完成：

- 提供方创建与管理员审批。已完成公开入驻申请、管理员手动创建提供方和 owner 账号、管理员审核最小闭环：`POST /providers/register`、`GET/POST /admin/providers`、`GET /admin/providers/pending`、`POST /admin/providers/:providerId/approve|reject`。
- 卡券模板创建：类型支持金额、积分、次数，展示名称可自定义。
- 卡面配置：平台模板、颜色、logo、字段、背景图或图床链接。已完成卡面模板变体预留增删接口最小闭环：`GET /card-template-variants`、`GET/POST /admin/card-template-variants`、`POST /admin/card-template-variants/:variantId`、`POST /admin/card-template-variants/:variantId/delete`，发卡方模板页会读取启用变体；已完成卡面标题隐藏第一版，模板字段写入 `fields.hideTitle`，钱包首页卡面、领取预览和离线缓存会按该字段隐藏标题和余额；发卡方创建模板、管理员模板审核、添加卡片和操作链接预览已统一为“卡面内只保留卡面视觉与卡号末四个字符占位，文字信息移到卡片外”；管理员模板页可同时查看待审核模板和已过审模板。
- 转赠规则：发行方可配置是否允许转赠，接收方必须确认。已完成最小闭环：`POST /wallet/passes/:passId/transfer`、`GET /wallet/transfers`、`POST /wallet/transfers/:transferId/accept|reject|cancel`，接收成功后卡券归属切换到接收方。
- 模板变更审批：所有卡券信息变化都需要管理员审核。
- 后台发放卡券：单次几十张规模即可。已完成发卡方同步批量生成领取码最小闭环：`POST /provider/issuing/add-pass-token-batches`，并区分领取码有效天数和卡券自身有效天数。已完成管理员和发卡方领取码列表第一版：后续只展示尾号、状态、领取人和过期时间，并允许撤销仍为 `Active` 的领取码；已完成作废并重发最小闭环，未领取且仍关联 `Issued` 卡券的领取码可生成新完整码，旧码置为 `Revoked`。
- 额度调整接口：发放、增加、扣减、冻结、解冻、透支展示。已完成管理员增减值调整与冻结/解冻最小闭环：`POST /admin/passes/:passId/adjust`、`POST /admin/passes/:passId/freeze|unfreeze`。已完成卡内额度补充第一版：模板规则配置 `allowTopUpIn`/`allowTopUpOut`，用户在钱包详情可选择 PIN 或服务器账号确认；PIN 路径调用 `POST /wallet/passes/:passId/top-ups`，服务器账号路径调用 `POST /wallet/passes/:passId/top-ups/server-challenge/start` 和 `POST /wallet/passes/:passId/top-ups/confirm-server`，等待服务器验证时可调用 `POST /wallet/top-ups/:topUpId/cancel` 取消请求；`GET /wallet/top-ups?passId=...` 可查询该卡相关补充记录。同一用户同权益类型卡券之间事务性扣减来源卡并补充目标卡，写入 `PassTopUpRequest` 状态、二次验证事件、两条 `top_up` 流水和 `PassTopUpRequested/PassTopUpSucceeded/PassTopUpFailed/PassTopUpExpired/PassTopUpCancelled` 事件。已完成管理员补充冲正最小闭环：`POST /admin/passes/top-ups/:topUpId/reverse` 会追加两条 `refund` 流水、把用户主动补充请求更新为 `Reversed`，并发布 `PassTopUpReversed` 与 `PassBalanceChanged`。
- 流水记录：每次调整都写入 `LedgerEntry`。已完成管理员调整流水写入。
- CSV 导出：提供方或管理员导出发放记录、流水记录。已完成发卡方卡券清单与流水导出最小闭环：`GET /provider/issuing/passes/export.csv`、`GET /provider/issuing/ledger/export.csv`；已完成管理员用户目录、提供方目录、全站卡券清单与流水导出最小闭环：`GET /admin/users/export.csv`、`GET /admin/providers/export.csv`、`GET /admin/passes/export.csv`、`GET /admin/passes/ledger/export.csv`。

验收标准：

- 管理员创建或审核通过一个提供方。
- 提供方创建并提交一个卡券模板。
- 管理员审核通过模板。
- 提供方发放卡券给用户。
- 用户钱包中出现该卡券。
- 提供方调整余额后，用户详情页余额和流水同步变化。

## 7. 第四阶段目标：卡券使用与核销闭环

目标：让“消耗余额/权益”成为真实流程，而不是静态详情。

需要完成：

- 核销请求创建：提供方可在后台发起，用户也可在钱包详情中主动发起消耗请求。
- `/add` 核销入口：发卡方专用登录态打开 `/add`，或双 session 下显式访问 `/add?mode=redeem` 后进入核销模式，可输入或通过链接传入 `publicNumber`、领取码或添加链接读取卡券并发起核销；领取码在核销模式下只用于反查对应卡片，即使领取码已经过期也不影响定位。模板规则可配置允许核销方名单，默认只允许原发卡方自身核销。
- 验证方式：PIN 或服务器账号验证。已完成最小闭环：用户可在账户页设置 PIN，提供方或用户可发起 PIN/服务器账号验证的消耗请求，并复用同一套待确认、重试、扣减流水和事件。
- 核销有效期：默认 2 分钟，允许提供方配置。已完成最小闭环：发卡方发起请求时可设置 30 到 3600 秒有效期。
- 重试规则：由提供方配置。已完成最小闭环：发卡方发起请求时可设置 1 到 10 次最大验证尝试，PIN 错误会记录失败次数；次数耗尽前请求仍可重试，耗尽后置为失败且不扣减权益。
- 成功核销：写入流水，更新余额/次数/积分。已完成最小闭环：`POST /wallet/redemption-requests/:requestId/confirm-server|confirm-pin`。
- 失败核销：记录失败原因和是否可重试。已完成最小闭环：过期、余额不足、PIN 错误会给出明确失败状态或错误；PIN 错误会发布带尝试次数和剩余次数的 `PassUseFailed` 事件。
- 已完成核销冲正：已完成最小闭环：发卡方可在 `/provider/passes` 对 `Succeeded` 核销请求发起冲正，开放 API 可调用 `POST /open/provider/redemptions/:requestId/reverse`；系统追加 `refund` 流水、恢复权益、把请求标记为 `Reversed`，并发布 `PassUseReversed` 与 `PassBalanceChanged`。
- 票券字段：座位、场次、检票状态、改签/取消状态。已完成最小闭环：发卡方生成领取码时可写入初始票券字段，后续在 `/provider/passes` 提交票券字段变更申请；管理员在 `/admin/passes` 审核通过后才写入卡券可见信息，钱包详情展示审核通过后的票券信息，CSV 导出包含票券字段，提交/通过/拒绝分别发布 `PassTicketUpdateSubmitted`、`PassTicketUpdateApproved`、`PassTicketUpdateRejected`，通过后再发布 `PassTicketStatusUpdated`。
- 证件/钥匙验证：服务器账号验证 + 玩家位置范围验证。已完成最小闭环：发卡方创建证件/钥匙模板或提交新版时可用多位置编辑器配置最多 10 个圆形/矩形范围，管理员审核时可看到 `locationRules` 和卡面背景图预览，用户在钱包详情中可调用 `POST /wallet/passes/:passId/verify-location` 拉取 BDSLM 玩家位置并判断范围，任一位置范围命中即通过，成功后发布 `ServerLocationVerified` 审计事件。

验收标准：

- 发起一笔消耗余额请求后，用户能完成验证。
- 成功后余额减少，流水增加。
- 超时、余额不足、验证失败都有明确状态。
- 核销失败不会错误扣减权益。

## 8. 第五阶段目标：后台管理与系统运营

目标：让管理员能够维护系统，而不需要直接改数据库。

需要完成：

- 用户审核列表和用户目录。
- 提供方审核列表。已完成最小闭环：管理员通过 `/admin/providers` 查看、通过或拒绝入驻申请。
- 提供方资料变更审核。已完成第一版：管理员通过 `/admin/providers` 查看当前资料和提交资料的差异，通过后写入 Provider 正式资料，拒绝时保存审核意见。
- API 密钥创建/轮换/停用审核。已完成第一版：发卡方在 `/provider/api-keys` 提交密钥变更申请，管理员在 `/admin/providers` 审核通过后才创建新密钥、轮换旧密钥或停用目标密钥；创建/轮换产生的新明文密钥由发卡方一次性查看。
- Webhook 新增端点审核。已完成第一版：发卡方在 `/provider/webhooks` 提交端点申请，管理员在 `/admin/providers` 审核通过后才创建真实端点，发卡方随后一次性查看签名密钥。
- 卡券模板审核列表。
- 卡券信息变更审核。已完成第一版票券字段变更审核：发卡方提交变更，管理员通过后才生效；后续可扩展到账户卡展示字段、证件/钥匙核验规则以外的单卡字段。
- 手动修改用户余额和权益、冻结/解冻卡券。已完成最小闭环：管理员通过 `/admin/passes` 搜索卡券，输入原因和管理员 PIN 后提交权益调整或冻结/解冻操作。
- 审计记录查询。已完成最小闭环：业务事件自动落库，管理员通过 `/admin/audit` 查看最近日志。
- 争议记录状态流转。已完成最小闭环：`POST /wallet/disputes`、`GET /provider/disputes`、`GET /admin/disputes`、`POST /admin/disputes/:disputeId/status`，状态变化会发布 `DisputeStatusChanged` 并进入审计；用户可把当前卡券、流水、核销请求、管理员调整记录或补充记录中的额度补充请求作为争议对象。管理员处理 `redemption_request` 或 `pass_top_up` 争议时，`/admin/disputes` 可输入冲正原因和管理员 PIN，调用对应冲正接口后自动把争议标记为 `Reversed`；普通卡券、流水和管理员调整争议只能按状态机填写处理备注推进，不能直接伪装为已反转。
- 全站公告与维护状态配置。已完成最小闭环：`GET /platform/status`、`GET/POST /admin/platform/status` 和 `/admin/platform` 页面，保存后发布 `PlatformStatusUpdated`。
- 主题色自动切换计划配置。已完成最小闭环：`GET /theme/schedule`、`GET/POST /admin/theme/schedule` 和 `/admin/theme` 页面。
- 存储空间检测与告警。已完成最小闭环：`GET /admin/storage/status`、`POST /admin/storage/check` 和 `/admin/storage` 页面。
- 服务条款、隐私政策维护。已完成协议文档最小闭环：`GET /legal/documents/:key`、`GET/POST /admin/legal/documents/:key` 和 `/admin/legal` 页面，保存后发布 `LegalDocumentUpdated`；提供方协议第一阶段从产品入口、公开页面和管理员维护入口移除，后续只作为历史预留 key。
- 初始超级管理员创建方式：种子脚本或命令行工具。

验收标准：

- 管理员能通过后台完成用户、提供方、模板的审核。
- 管理员的敏感操作会生成审计记录。
- 用户提交争议后，管理员可以在 `/admin/disputes` 推进状态；核销请求和额度补充争议可以在该页直接冲正并标记已反转；普通卡券、流水和管理员调整争议需要填写处理备注后才能认可、驳回、要求补充或关闭；发卡方可以在 `/provider/disputes` 查看自己卡券相关争议。
- 主题色自动切换计划可以在后台修改，未登录用户也能看到新配置生效。
- 存储空间低于阈值时，后台能看到提醒。

## 9. 第六阶段目标：PWA 与部署可用性

目标：保证项目可以在 Windows Server + 宝塔面板 + nginx 反代环境中部署。

需要完成：

- PWA 离线展示卡券基础信息。已完成最小闭环：Service Worker 缓存应用壳，前端本地保存最近钱包快照，离线时显示基础卡券并禁止排序、删除、核销等写操作。
- Web、API 独立进程部署。
- SQLite 同机部署说明、备份流程，以及后续迁移 PostgreSQL 的预留说明。
- nginx 反向代理配置示例。
- Windows 原生进程守护方案。
- `.env` 配置说明。
- 数据库迁移和回滚说明。
- 生产环境日志、备份、存储告警说明。

验收标准：

- 新机器按部署文档可以启动 Web 与 API。
- nginx 反代后前端可以正常访问 API。
- 刷新、深链接、PWA manifest 不报错。
- 离线时可以展示最近同步过的基础卡券信息。
- 离线状态下尝试编辑、删除或核销时必须给出明确反馈，不允许静默失败或伪造成功。

## 10. 需要优先避免的问题

- 页面按钮没有任何反馈。
- 前端显示成功，但后端没有真实记录。
- Service 之间互相直接调用导致模块耦合。
- BDSLM 轮询放进 Web 进程，导致部署和扩展困难。
- 核销没有幂等键，重复请求造成重复扣减。
- 审计记录缺失，管理员手动修改后无法追溯。
- 使用过新的浏览器 API，破坏 WebView 114 / Safari 17 兼容性。
- 只做桌面或只做移动端，另一端布局不可用。

## 11. 建议最近一轮开发目标

最近一轮应聚焦第一阶段和第二阶段的最小闭环：

1. 实现真实用户注册申请接口。
2. 实现管理员审核用户接口和最简后台页面。
3. 实现登录、会话、退出登录。
4. 实现钱包列表接口，登录后首页读取真实数据。
5. 实现添加卡券 token 和领取接口。
6. 做一个管理员种子脚本，方便本地测试。

完成这 6 项后，项目就可以从“页面原型”进入“可测试产品雏形”。

## 12. 当前本地验证注意事项

本轮已经涉及后端、数据库 schema 和 Next rewrites，因此要验证真实效果，需要执行：

1. `npx --yes pnpm@10.14.0 db:push`：把 `UserRole`、`AuthSession`、验证码检查字段、验证码用途字段（含 `server_account_rebind`）、卡券排序字段、`PassTransfer` 转赠表、`UserNotification` 站内提醒表、`DeviceLoginApproval` 新设备确认表、`ProviderWebhookEndpoint` 回调端点表、`ProviderWebhookChangeRequest` 端点创建申请表、`ProviderWebhookDelivery` 投递记录表等同步到本地数据库。
2. `npx --yes pnpm@10.14.0 seed:super-admin`：使用 `.env` 中的 `SEED_ADMIN_*` 创建或更新超级管理员。
3. 重启 API 进程：后端 Nest 代码变更需要重启或由 watch 模式重载。
4. 重启 Web 进程：`next.config.mjs` 的 `/api/:path*` rewrites 变更需要重启 Next。

验证路径：

- `/register` 提交管理员审核注册。
- `/register` 切到服务器验证，提交用户名、邮箱、密码和服务器 ID 后应快速创建验证码；如果 API、数据库或 BDSLM 不可用，应显示明确错误。
- `/admin/login` 使用超级管理员密码和管理员 PIN 登录；PIN 错误、缺少 PIN、普通用户账号都不应创建后台会话。
- `/admin/users` 审核通过用户；在用户目录中搜索已激活用户，输入 4 到 12 位新 PIN 后重置，`/admin/audit` 应出现 `UserPinResetByAdmin`。
- `/admin/client-applications` 登记外部项目的 `client_id`、允许回跳地址和允许来源；创建或更新后 `/admin/audit` 应出现 `ClientApplicationCreated` 或 `ClientApplicationUpdated`。
- `/login?client_id=...&redirect_uri=...&state=...` 使用已登记的精确回跳地址时，登录页应显示外部项目名称，登录成功后跳回该地址并附带 `state`；未登记或不匹配的 `redirect_uri` 不应回跳外部地址。
- 外部项目从登记的允许来源携带 Cookie 请求 `/api/auth/client-session?client_id=...` 时，Active 用户应得到 `authenticated=true` 和当前用户摘要；非 Active 用户必须返回未认证结果；未登记来源或停用应用不应通过 CORS 校验。
- `/admin/audit` 查看注册、审核、发卡、领卡、排序、注销等领域事件形成的审计记录。
- `/provider/register` 提交提供方入驻申请；申请被拒后，使用相同提供方标识、联系邮箱和负责人密码重新提交，应重新进入待审核状态。
- `/admin/providers` 手动创建提供方和 owner 账号，审核通过/拒绝提供方入驻申请，或对已启用提供方执行停用、恢复和归档；`/admin/audit` 应出现 `ProviderCreatedByAdmin`、`ProviderAccountCreated`、`ProviderApproved`、`ProviderRejected`、`ProviderSuspended`、`ProviderUnsuspended` 或 `ProviderArchived`。
- Active 发卡方登录 `/provider/dashboard` 后提交资料变更申请；管理员在 `/admin/providers` 的“资料变更待审”中通过后，提供方正式名称、头像、介绍链接、联系人、联系邮箱和业务说明才更新；`/admin/audit` 应出现 `ProviderProfileChangeSubmitted` 和 `ProviderProfileChangeApproved`，拒绝时应出现 `ProviderProfileChangeRejected`。
- `/admin/card-template-variants` 创建、停用、编辑或删除卡面模板变体；`/admin/audit` 应出现 `CardTemplateVariantCreated`、`CardTemplateVariantUpdated` 或 `CardTemplateVariantDeleted`。
- `/admin/platform` 启用全站公告或维护状态；刷新任意页面顶部应出现平台横幅，`/admin/audit` 应出现 `PlatformStatusUpdated`。
- `/admin/theme` 配置主题色自动切换计划；未登录用户打开主题弹窗时也应读取公开计划。
- `/admin/storage` 查看服务器磁盘剩余空间，必要时点击立即检测并在审计页查看 `StorageAlertRaised` 或 `StorageAlertResolved`。
- `/login` 使用审核通过的用户登录。
- 已绑定设备的服务器账号用户在新设备上登录时，应看到服务器聊天验证码和已登录设备确认提示；用对应服务器 ID 发送验证码并点击检查后才会创建会话，`/admin/audit` 应出现 `ServerVerificationCodeIssued`、`DeviceLoginVerified` 和 `DeviceBound`。
- 已绑定设备的用户在新设备上登录后，回到任一已登录设备打开 `/account`，应看到待确认的新设备登录请求；批准后回到新设备点击“已批准，检查”才会创建会话，`/admin/audit` 应出现 `DeviceLoginApprovalRequested`、`DeviceLoginApprovalApproved`、`DeviceBound` 和 `UserLoggedIn`；拒绝后新设备继续检查应显示已被拒绝。
- `/account` 应使用标题栏 + 账户摘要 + 设置入口布局；PIN、服务器账号换绑、提醒设置、新设备确认、设备管理、审核补充和注销账户都应通过弹窗打开，关闭弹窗后回到账户总览。
- `/account` 在服务器账号弹窗输入新的服务器 ID 开始换绑，应看到服务器聊天验证码；用新的服务器 ID 发送验证码并点击检查后，账户页应显示新的服务器 ID，其余设备会话应失效，`/admin/audit` 应出现 `ServerVerificationCodeIssued`、`ServerAccountVerified` 和 `ServerAccountRebound`。
- `/account` 在提醒偏好弹窗修改积分/次数过期提醒天数，保存后刷新会话应保持新值，`/admin/audit` 应出现 `UserPreferencesUpdated`。
- `/account` 测试退出登录和注销账户弹窗。
- 创建一张积分或次数卡券，并在 `/admin/add-pass-token` 或 `/provider/issue` 设置卡券有效天数，让 `expiresAt` 落在用户设置的提醒天数内；登录用户打开 `/` 时应看到临期提醒，点击“查看”定位到对应卡券，点击“已读”后提醒从首页收起，`/admin/audit` 应出现 `PassExpirationReminderCreated` 和 `UserNotificationRead`。
- `/admin/add-pass-token` 生成真实领取码；页面应能分别设置领取码有效天数和卡券有效天数。
- `/add` 输入领取码领取卡券；管理员生成领取码时会写入初始发放流水。
- `/` 查看真实钱包卡券和详情，详情面板应显示最近流水。
- 登录用户打开 `/` 后会同步 `/api/wallet/offline-snapshot`；断开 API 后再次打开首页，应显示最近一次同步的基础卡券数据和离线提示。
- `/admin/passes` 搜索真实卡券并提交权益调整；提交时必须输入管理员 PIN，PIN 错误时不能产生流水；调整成功后用户详情页余额和流水应同步变化，审计页应出现 `PinVerificationSucceeded`、`AdminBalanceAdjustmentRequested`、`AdminBalanceAdjustmentApproved` 和 `PassBalanceChanged`。
- `/admin/passes` 选择卡券后输入原因和管理员 PIN 冻结或解冻；冻结后发卡方不能发起消耗请求，`/admin/audit` 应出现 `PinVerificationSucceeded`、`PassFrozen` 或 `PassUnfrozen`。
- `/admin/passes` 按关键词搜索后导出卡券 CSV 或流水 CSV，导出内容应匹配当前搜索条件。
- `/provider/issue` 切换到批量发放，生成多个领取码后复制全部添加链接。
- `/provider/api-keys` 提交 API 密钥创建、轮换或停用申请；管理员在 `/admin/providers` 的“API 密钥待审”通过创建/轮换申请后，发卡方回到 `/provider/api-keys` 一次性查看新明文密钥；通过停用申请后旧密钥不能继续调用开放接口。用该密钥调用 `POST /api/open/provider/issuing/add-pass-tokens` 生成领取码、调用 `GET /api/open/provider/issuing/passes` 查询卡券、调用 `POST /api/open/provider/issuing/passes/:passId/freeze|unfreeze|archive` 更新卡券状态、调用 `POST /api/open/provider/issuing/passes/:passId/ticket` 提交票券字段变更申请、调用 `POST /api/open/provider/issuing/passes/:passId/adjust` 调整权益、调用 `POST /api/open/provider/redemptions` 发起核销、调用 `POST /api/open/provider/redemptions/:requestId/cancel` 取消待确认核销、调用 `POST /api/open/provider/redemptions/:requestId/reverse` 冲正已完成核销、调用 `GET /api/open/provider/redemptions` 查询核销记录。开放写接口必须带 `X-LDPass-Timestamp`、`X-LDPass-Idempotency-Key` 和 `X-LDPass-Signature`；同一幂等键重复提交应返回第一次响应，不重复发卡、重复冻结/解冻、重复归档、重复票券字段变更申请、重复核销取消、重复核销冲正或重复扣减；超过密钥/scope 限流阈值时应返回 429。`/admin/audit` 应出现 `ProviderApiKeyChangeSubmitted`、`ProviderApiKeyChangeApproved`、`ProviderApiKeyCreated`、`ProviderApiKeySecretClaimed`、`ProviderApiKeyRotated`、`ProviderApiKeyRevoked`、`PassIssued`、`PassFrozen`、`PassUnfrozen`、`PassDeleted`、`PassTicketUpdateSubmitted`、`PassTicketUpdateApproved`、`PassTicketStatusUpdated`、`PassBalanceChanged`、`PassUseRequested`、`PassUseCancelled` 和 `PassUseReversed`。轮换或停用密钥后旧密钥不能继续调用开放接口。
- `/provider/webhooks` 提交 Webhook 端点创建、修改、启停、删除或密钥轮换申请；管理员在 `/admin/providers` 的“Webhook 配置待审”通过后，正式端点配置才会被创建、更新、停用/启用、软删除或写入新密钥。新增和轮换申请通过后，发卡方回到 `/provider/webhooks` 一次性查看签名密钥。执行发卡、领取、权益调整、票券字段变更提交/审核、核销、冻结/解冻、归档或争议状态变化后，未删除且已启用的 `ProviderWebhookEndpoint` 应产生对应 `ProviderWebhookDelivery`。接收端返回 2xx 时端点最近成功时间更新；返回非 2xx 或超时时应进入失败状态并按退避重试。提交、通过、拒绝、领取密钥和正式创建/修改/轮换/删除端点后，`/admin/audit` 应出现 `ProviderWebhookChangeSubmitted`、`ProviderWebhookChangeApproved`、`ProviderWebhookChangeRejected`、`ProviderWebhookSecretClaimed`、`ProviderWebhookEndpointCreated`、`ProviderWebhookEndpointUpdated`、`ProviderWebhookSecretRotated` 或 `ProviderWebhookEndpointDeleted`；新增端点申请仍保留 `ProviderWebhookEndpointCreateSubmitted`、`ProviderWebhookEndpointCreateApproved`、`ProviderWebhookEndpointCreateRejected` 兼容审计事件。
- `/provider/webhooks` 展开某个端点的投递记录，应能看到最近事件类型、状态、尝试次数、HTTP 状态和错误信息；对失败或已放弃记录点击“重试”后应重新排队，下一轮调度器会再次投递，`/admin/audit` 应出现 `ProviderWebhookDeliveryRetryRequested`。
- `/provider/passes` 按关键词搜索卡券后导出卡券 CSV 或流水 CSV。
- `/provider/templates` 创建卡券模板时，模板变体下拉框应优先显示管理员已启用且匹配当前分类的卡面变体。
- `/provider/templates` 对已有模板点击“提交新版”，修改卡面或规则后应生成新的待审核版本；审核通过前 `/provider/issue` 仍只能使用原 active 版本，管理员在 `/admin/pass-templates` 通过后，新发放卡券应绑定新版本，旧卡券详情仍显示旧版本字段；管理员也可在 `/admin/pass-templates` 随时查看已过审模板版本。`/admin/audit` 应出现 `PassTemplateUpdateSubmitted` 和 `PassTemplateApproved`。
- 发卡方在 `/provider/templates` 创建模板时勾选允许转赠；用户领取该模板卡券后，在 `/` 的详情中向另一个激活用户发起转赠；接收方登录后在首页转赠请求中接收或拒绝；接收成功后卡券出现在接收方钱包，`/admin/audit` 应出现 `PassTransferRequested` 和 `PassTransferAccepted`。
- 票券模板发放时在 `/provider/issue` 填写活动、场地、场次和座位；领取后用户在 `/` 详情查看票券信息；发卡方在 `/provider/passes` 提交检票、改签/取消或场次座位变更申请；管理员在 `/admin/passes` 通过后用户详情才显示新票券信息，`/admin/audit` 应出现 `PassTicketUpdateSubmitted`、`PassTicketUpdateApproved` 和 `PassTicketStatusUpdated`；拒绝时应出现 `PassTicketUpdateRejected`。
- 证件/钥匙模板在 `/provider/templates` 启用位置核验并填写一个或多个圆形/矩形范围；`/admin/pass-templates` 审核通过后发放并领取；用户未完成服务器账号验证时，`/` 的卡券详情应提示先前往账户页验证且不能直接发起位置核验；已验证用户点击“验证当前位置”后，在线且位于任一范围内时应显示核验成功，`/admin/audit` 应出现 `ServerLocationVerified`。
- `/account` 设置 PIN；可由 `/provider/passes` 对已领取卡券发起消耗请求，也可由用户在 `/` 的卡券详情中输入消耗值并发起使用；用户确认后余额和流水应刷新。
- 发卡方专用登录态打开 `/add?cardNumber=...`、`/add?token=...` 或手动输入卡号/领取码/添加链接，应进入核销模式；若同一浏览器同时登录普通用户和发卡方，则必须使用 `/add?mode=redeem&cardNumber=...` 或 `/add?mode=redeem&token=...` 显式进入核销模式。当前发卡方是原发卡方或在模板允许核销名单中，且卡券已领取、未冻结/过期/归档时，才可发起待用户确认的核销请求。普通用户登录态打开 `/add` 时仍只能通过领取码/添加链接添加卡券，不能凭卡号领取。
- `/provider/passes` 对已完成核销点击“冲正”，填写原因后卡券权益应加回，核销状态变为已冲正，`/admin/audit` 应出现 `PassUseReversed` 和 `PassBalanceChanged`。
- `/` 的卡券详情中通过弹窗提交争议；争议按钮先进入争议记录弹窗，再进入提交争议弹窗，补充记录中的“提交争议”应直接打开提交争议弹窗并预选对应额度补充请求；当前卡券、流水、核销请求、管理员调整记录和补充记录中的额度补充请求可作为争议对象；`/provider/disputes` 查看关联争议；`/admin/disputes` 更新争议状态，可冲正的争议能执行冲正并标记已反转，普通争议需要处理备注才能进入需要补充、认可、驳回或关闭；`/admin/audit` 应出现 `DisputeStatusChanged`。
- 平板和手机视图中，选择卡券后详情面板应以可滚动浮层显示在当前视口内，而不是被卡券列表或底部分类栏遮挡。
- `/` 打开编辑模式，调整卡券顺序或移除卡券；刷新后顺序和归档结果应保持。

## 13. 下一轮修正目标：后台信息架构与关键语义对齐

本轮用户测试反馈说明：系统已经有不少最小闭环，但体验和业务语义还没有完全收敛。下一轮不应继续堆新页面，而应优先修正以下问题。

本轮已先完成多项前后端闭环：管理员用户封禁/解封/软删除、UTC+8 绝对时间主题计划、存储状态项目占用统计、核销场景服务器账号本次验证码确认、管理员后台统一导航壳、发卡方后台统一导航壳、提供方资料变更审批、Webhook 配置全生命周期审批。

### 13.1 必须优先处理

1. 后台页面布局统一：管理员后台、发卡方后台和账户页已完成第一版“标题栏 + 主内容区”布局；账户页修改项已收敛为弹窗，后续继续清理协议页等工具页，减少大面积悬浮表单卡片。
2. 后台导航统一：管理员后台和发卡方后台已完成第一版侧边导航，窄屏使用横向滚动导航；后续继续减少各 Panel 内部重复的二级入口。
3. 用户治理闭环：`/admin/users` 增加封禁、解封、管理员删除账户；操作必须二次验证、撤销会话并写入审计。已完成第一版。
4. 提供方配置变更审批：Active 发卡方资料变更已完成第一版，覆盖名称、头像、介绍链接、联系人、联系邮箱、业务说明；Webhook 创建、修改、启停、删除、密钥轮换审批和 API 密钥创建/轮换/停用审批已完成第一版。后续可继续细化更细角色权限和低风险配置的快速审批规则。
5. 服务器账号确认语义修正：核销、额度补充等敏感操作选择“服务器账号确认”时，需要重新发放带前缀聊天验证码，不能仅检查用户曾经绑定过服务器账号。核销确认和直接卡内额度补充确认已完成第一版。
6. 主题计划模型修正：从“每日某分钟切换”改为“指定日期时间（UTC+8）之后切换到指定主题色”的计划列表。已完成第一版。
7. 视觉基础修正：已消除深色模式中的青绿色背景偏色，统一按钮 reset，去掉浏览器默认 3D 浮雕描边。

### 13.2 第二优先级

1. 存储状态增加本项目占用空间统计，至少拆分项目总占用、数据库、日志、上传素材。已完成第一版。
2. 卡面标题允许隐藏，模板生成和管理员审核时增加含背景图片的卡面预览。
3. 位置核验支持多个位置范围，第一阶段建议命中任意范围即通过。
4. 卡券详情拆层：已完成第二版，详情页只保留摘要和主操作入口，卡片详情、充值、来源卡选择、发起核销、待确认核销、交易记录、争议记录、提交争议和转赠进入弹窗。
5. 服务条款和隐私政策先落地框架，提供方协议第一阶段从 UI 中去掉。

### 13.3 第三优先级

1. 使用链接和补充链接：外部项目生成一次性链接，用户登录后预览并确认，不允许打开链接即直接扣减；补充链接已接入 `PassTopUpRequest` 状态机。
2. 卡内额度补充请求状态机：第一版已完成用户主动钱包补充和补充链接的 `Created`、`WaitingVerification`、`Succeeded`、`Failed`、`Cancelled`、`Expired`、`Reversed` 状态，并允许用户把补充记录中的额度补充请求提交为争议对象。
3. 完整领取码展示规则固定为生成时一次性展示，后续只展示尾号、状态和领取信息；如丢失则作废重发。

更完整的拆解见 `docs/current-status-and-gap-review.md`。
