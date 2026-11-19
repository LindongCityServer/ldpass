# 临东通 × QQ 官方机器人绑定联调说明

本文对应临东通侧的 QQ 绑定实现，机器人代码不在本仓库内。QQ 官方机器人只能拿到
`user_openid`（单聊）和 `member_openid`（群聊），因此绑定关系只使用 openid，
不接收、不推断、不伪造 QQ 号。

## 1. 三条绑定流程

### 1.1 单聊主流程：机器人发送一次性网页链接

1. 用户在 QQ 私聊里发送 `/绑定`。
2. 机器人调用 `POST /api/internal/qq-link/token`，拿到 `url` 和 `expiresAt`（5 分钟）。
3. 机器人把链接发到私聊。
4. 用户打开 `/account/link/qq?token=...`：
   - 未登录时先跳转临东通登录，登录后保留 token 回到确认页；
   - 已登录且账户为 `Active` 时显示“将 QQ 账号绑定到当前临东通账号”。
5. 用户点击确认，网页调用 `POST /api/account/qq-link/confirm`，服务端在一个事务内消费 token 并创建
   `scope: "c2c"` 绑定。
6. token 只能使用一次；过期、已使用、openid 已绑定其他账号都会返回明确错误。

### 1.2 群聊主流程：网页只认领并展示确认码，回群 `/确认`

QQ 官方机器人只能被扫码加好友，群内用户很难私聊机器人，因此群聊采用“回群确认”：

1. 群成员在群里 @机器人 发送 `/绑定`。
2. 机器人调用 `POST /api/internal/qq-link/token`，请求体带
   `{ openId: member_openid, scope: "group", groupOpenId: group_openid }`，拿到 5 分钟有效的一次性
   网页链接。token 在服务端绑定 `openId + groupOpenId + scope`。
3. 机器人把链接回复到群里。
4. 用户打开链接并登录临东通。网页调用
   `POST /api/account/qq-link/group/claim` **认领** token：
   - 只记录目标临东通账号（`claimedByUserId`）并展示 6 位确认码，例如 `/确认 482913`；
   - **网页不会消费 token，也不会创建绑定**；
   - 同一个账号重复打开链接会得到同一个确认码；其他账号打开同一链接会得到 `token_claimed`。
5. 用户回到**同一个群**，@机器人 发送 `/确认 482913`。
6. 机器人从自己 5 分钟的 token 缓存里取出该群该成员的 token，调用
   `POST /api/internal/qq-link/confirm-group`，请求体带
   `{ token, openId: member_openid, groupOpenId: group_openid, code: "482913" }`。
7. 服务端校验：
   - token 有效、未过期、未被使用，且 `scope` 为 `group`；
   - token 里的 `openId` / `groupOpenId` 与机器人事件中的完全一致；
   - token 已被网页认领；
   - 确认码与 `tokenHash + claimedByUserId + claimedAt` 派生值一致；
   - 成功后原子消费 token 并创建 `scope: "group"` 的绑定。

> 群主/管理员没有特殊通道：`/确认` 只使用机器人事件里的 `member_openid`，不是 token 对应
> 成员时返回 `openid_mismatch`。网页链接被群里其他人点开、登录、认领，也不能代替成员完成确认。

### 1.3 兜底流程：网页生成绑定码（仅单聊）

1. 用户在临东通账户设置页点击「生成绑定码」。
2. 网页调用 `POST /api/account/qq-link/code`，拿到 8 位 Crockford Base32 绑定码（如 `K7M2-9QXF`），
   10 分钟有效。
3. 用户私聊机器人发送 `/绑定 K7M2-9QXF`。
4. 机器人调用 `POST /api/internal/qq-link/consume` 完成绑定。

该兜底流程没有 scope/groupOpenId 字段，只支持单聊；群聊继续使用 1.2 的网页 token 流程，
`/consume` 收到 `scope: "group"` 仍返回 `group_not_supported`，不会消费绑定码。

## 2. 服务端接口

所有内部接口统一使用：

```http
Authorization: Bearer <QQ_BOT_LINK_SECRET>
```

### 2.1 生成绑定码（网页会话）

`POST /api/account/qq-link/code`

请求体为空。必须携带临东通登录 Cookie，服务端只使用当前会话用户，不接受客户端传入的
`ldpassUserId`。

成功 `200`：

```json
{
  "code": "K7M2-9QXF",
  "expiresAt": "2026-11-19T10:10:00.000Z"
}
```

同一用户重新生成时旧码立即失效；每个用户最多 1 个 active 绑定码。

### 2.2 查看已绑定 QQ（网页会话）

`GET /api/account/qq-links`

成功 `200`：

```json
{
  "links": [
    {
      "id": "qq_link_1a2b3c4d5e6f7a8b9c0d1e2f",
      "scope": "c2c",
      "groupOpenId": null,
      "createdAt": "2026-11-19T10:00:00.000Z",
      "lastSeenAt": "2026-11-19T10:00:00.000Z"
    },
    {
      "id": "qq_link_2b3c4d5e6f7a8b9c0d1e2f3a",
      "scope": "group",
      "groupOpenId": "abcd…wxyz",
      "createdAt": "2026-11-19T10:01:00.000Z",
      "lastSeenAt": "2026-11-19T10:02:00.000Z"
    }
  ]
}
```

不返回 `qqOpenId`；群身份的 `groupOpenId` 只返回 `abcd…wxyz` 形式。

### 2.3 解绑（网页会话）

`DELETE /api/account/qq-links/[id]`

只允许解绑属于当前会话用户的 active 绑定，只撤销指定 id 这一条记录（群身份只影响当前群）。
成功 `200`：

```json
{ "ok": true }
```

### 2.4 校验绑定链接（网页，用于确认页）

`GET /api/account/qq-link/token?token=...`

该接口是确认页的校验接口，不需要登录，不会消费 token。成功 `200`：

```json
{
  "ok": true,
  "token": {
    "scope": "group",
    "expiresAt": "2026-11-19T10:05:00.000Z",
    "requiresGroupConfirmation": true
  }
}
```

`requiresGroupConfirmation` 为 `true` 时网页必须走 2.6 的认领流程，不能调用 2.5。
失败返回契约错误，例如 `token_invalid`、`token_expired`、`token_used`。

### 2.5 确认绑定链接（网页会话，仅 c2c）

`POST /api/account/qq-link/confirm`

```json
{ "token": "从 /account/link/qq?token=... 取到的 token" }
```

成功 `200`：

```json
{
  "ok": true,
  "link": {
    "id": "qq_link_1a2b3c4d5e6f7a8b9c0d1e2f",
    "scope": "c2c",
    "createdAt": "2026-11-19T10:00:00.000Z"
  }
}
```

对 `scope: "group"` 的 token 会返回 `400 group_confirm_required`，**不会消费 token、不会创建绑定**。
网页接口不能直接把群 token 消费掉，群绑定必须走 2.6 / 2.8。

### 2.6 认领群绑定链接并获取确认码（网页会话）

`POST /api/account/qq-link/group/claim`

必须携带临东通登录 Cookie，目标账号只取当前会话用户。请求：

```json
{ "token": "从 /account/link/qq?token=... 取到的 token" }
```

成功 `200`：

```json
{
  "ok": true,
  "scope": "group",
  "confirmCode": "482913",
  "expiresAt": "2026-11-19T10:05:00.000Z"
}
```

行为：

- 只记录 `claimedByUserId` / `claimedAt`，token 仍为 `active`，不创建绑定；
- 同一账号重复认领返回同一个确认码，刷新页面不会让已展示的码失效；
- 第一个认领的账号生效；其他账号再认领返回 `409 token_claimed`，避免链接在群里传播后被
  后来者“换绑”；
- 目标账号必须是 `Active` 状态；`scope: "c2c"` 的 token 返回 `400 group_mismatch`。

### 2.7 生成一次性网页链接（机器人）

`POST /api/internal/qq-link/token`

单聊：

```json
{
  "openId": "机器人事件里的 user_openid",
  "scope": "c2c",
  "groupOpenId": null
}
```

群聊：

```json
{
  "openId": "机器人事件里的 member_openid",
  "scope": "group",
  "groupOpenId": "机器人事件里的 group_openid"
}
```

成功 `200`：

```json
{
  "ok": true,
  "url": "https://ldpass.example.com/account/link/qq?token=...",
  "expiresAt": "2026-11-19T10:05:00.000Z"
}
```

- token 为 128 位随机数（base64url 后 22 字符），5 分钟有效且一次性，服务端只存 HMAC 哈希；
- 群聊 token 在服务端同时绑定 `openId + groupOpenId + scope`，不能用于单聊；
- 单聊 token 不接受 `groupOpenId`，群聊 token 必须带 `groupOpenId`，否则返回 `invalid_request`；
- 接口返回中**不包含确认码**，确认码只在登录后的网页认领时展示。

### 2.8 群内确认（机器人）

`POST /api/internal/qq-link/confirm-group`

```json
{
  "token": "机器人缓存的、由 2.7 获取的群 token",
  "openId": "机器人事件里的 member_openid",
  "groupOpenId": "机器人事件里的 group_openid",
  "code": "482913"
}
```

成功 `200`：

```json
{
  "ok": true,
  "link": {
    "id": "qq_link_2b3c4d5e6f7a8b9c0d1e2f3a",
    "ldpassUserId": "0f1e2d3c-...",
    "username": "小明",
    "scope": "group",
    "groupOpenId": "机器人事件里的 group_openid",
    "createdAt": "2026-11-19T10:02:00.000Z"
  }
}
```

校验顺序与失败码：

| 情况                               | error                   |
| ---------------------------------- | ----------------------- |
| token 不存在/格式错误              | `token_invalid`         |
| token 已使用                       | `token_used`            |
| token 已过期                       | `token_expired`         |
| token 不是群聊 token               | `group_mismatch`        |
| 请求 `openId` 与 token 不一致      | `openid_mismatch`       |
| 请求 `groupOpenId` 与 token 不一致 | `group_mismatch`        |
| token 还没有被网页认领             | `token_not_claimed`     |
| 确认码格式错误或不匹配             | `confirm_code_invalid`  |
| 目标账号不可用                     | `account_inactive`      |
| 同一 openid 已绑定其他临东通账号   | `openid_already_linked` |
| 并发竞争/其他绑定冲突              | `link_conflict`         |
| 同一身份并发确认，后到者           | `token_used`            |

失败不会消费 token（`confirm_code_invalid`、`openid_mismatch`、`group_mismatch`、`openid_already_linked`
等都可以在有效期内修正后重试）；成功后 token 变为 `used`，重复确认返回 `token_used`。
并发确认同一个 token 只有一个请求拿到 `200`。

### 2.9 消费绑定码（机器人，仅 c2c）

`POST /api/internal/qq-link/consume`

```json
{
  "code": "K7M2-9QXF",
  "openId": "机器人事件里的 user_openid",
  "scope": "c2c",
  "groupOpenId": null
}
```

成功 `200`：

```json
{
  "ok": true,
  "link": {
    "id": "qq_link_1a2b3c4d5e6f7a8b9c0d1e2f",
    "ldpassUserId": "0f1e2d3c-...",
    "username": "小明",
    "scope": "c2c",
    "createdAt": "2026-11-19T10:00:00.000Z"
  }
}
```

`scope: "group"` 仍返回 `400 group_not_supported`，群聊请使用 1.2 / 2.8 流程。

### 2.10 查询绑定（机器人 /我的绑定）

单聊：

`GET /api/internal/qq-link/resolve?openId=...&scope=c2c`

群聊：

`GET /api/internal/qq-link/resolve?openId=...&scope=group&groupOpenId=...`

```json
{
  "ok": true,
  "link": {
    "id": "qq_link_2b3c4d5e6f7a8b9c0d1e2f3a",
    "ldpassUserId": "0f1e2d3c-...",
    "username": "小明",
    "scope": "group",
    "groupOpenId": "group_openid"
  }
}
```

没有绑定：

```json
{ "ok": true, "link": null }
```

`scope` 省略时默认 `c2c`。群聊缺少 `groupOpenId`、c2c 携带 `groupOpenId` 都返回
`400 invalid_request`。查询会更新 `lastSeenAt`。

### 2.11 解绑（机器人 /解绑）

`POST /api/internal/qq-link/unlink`

单聊：

```json
{ "openId": "...", "scope": "c2c", "groupOpenId": null }
```

群聊：

```json
{ "openId": "member_openid", "scope": "group", "groupOpenId": "group_openid" }
```

只撤销 `openId + scope + groupOpenId` 对应的这一条 active 绑定；其他群身份和单聊绑定不受影响。
成功（包括本来就没有绑定）返回：

```json
{ "ok": true }
```

## 3. 错误码与 HTTP 状态

| error                    | HTTP | 含义                                         |
| ------------------------ | ---- | -------------------------------------------- |
| `code_invalid`           | 400  | 绑定码不存在/格式错误/已失效                 |
| `code_expired`           | 400  | 绑定码已过期                                 |
| `code_used`              | 409  | 绑定码已被使用                               |
| `openid_already_linked`  | 409  | 该 openid 已绑定其他临东通账号               |
| `link_conflict`          | 409  | 该 openid 存在冲突绑定/并发写冲突            |
| `group_not_supported`    | 400  | 该流程不支持群聊（如 `/consume` 绑定码流程） |
| `group_mismatch`         | 400  | 群 openid 或 token scope 与请求不一致        |
| `openid_mismatch`        | 400  | 发送确认的成员不是 token 对应成员            |
| `confirm_code_invalid`   | 400  | 群确认码格式错误或不匹配                     |
| `group_confirm_required` | 400  | 群 token 不能在网页直接确认                  |
| `token_not_claimed`      | 400  | 群 token 还没被登录网页认领                  |
| `token_claimed`          | 409  | 群 token 已被其他临东通账号认领              |
| `account_inactive`       | 403  | 认领 token 的账号已不可用                    |
| `invalid_request`        | 400  | 参数不合法                                   |
| `rate_limited`           | 429  | 触发限流                                     |
| `token_invalid`          | 400  | 网页 token 无效                              |
| `token_expired`          | 400  | 网页 token/确认码过期                        |
| `token_used`             | 409  | 网页 token 已使用                            |
| `not_linked`             | 404  | 仅用于失败审计，不直接返回给机器人           |

网页接口未登录时仍使用现有框架的 `401 { message, error, statusCode }` 结构；
内部接口和网页确认接口的业务失败使用 `{ ok:false, error, message }` 结构。

## 4. 数据存储与迁移

- 存储：现有 SQLite，位置由 `DATABASE_URL` 决定（本地默认 `data/ldpass.sqlite`）。
- Schema：`packages/database/prisma/schema.prisma`。
- 表：
  - `YctQqLink`：绑定关系，新增/使用 `qqScope`、`groupOpenId`；
  - `YctQqLinkCode`：一次性绑定码（c2c 兜底流程）；
  - `YctQqLinkToken`：一次性网页 token，新增 `claimedByUserId`、`claimedAt`。

### 4.1 唯一约束

逻辑唯一约束是：

```text
(qqOpenId, qqScope, groupOpenId) 在 active 状态下唯一
```

物理上由 `YctQqLink.activeKey` 唯一索引实现：

- c2c：`c2c:<openid>`；
- group：`group:<groupOpenId>:<openid>`；
- 解绑时置空 `activeKey`，因此 revoked 历史记录可以保留，同一身份解绑后可以重新绑定。

没有使用静态 `@@unique([qqOpenId, qqScope, groupOpenId])`，原因是 SQLite 的 NULL 不参与唯一比较，
c2c 行（`groupOpenId = NULL`）会退化为不受约束；同时 revoked 历史行会阻止同一身份重新绑定。
`activeKey` 是 SQLite/Prisma 下表达“active 唯一”的等价方案，且与原来的单聊约束完全兼容。

`activeOpenIdKey` 字段仅为兼容历史数据保留，**不再唯一**，新写入不再依赖它。否则同一个 openid
无法同时拥有单聊身份和多个群身份，群绑定也会被单聊唯一键误伤。

同一个 `ldpassUserId` 可以有多个群身份（不同 `groupOpenId`），也可以同时有单聊身份；
但同一个 openid 在任意 scope/群里都只能绑定一个临东通账号（服务端事务内校验）。

### 4.2 迁移步骤

本仓库没有提交 `prisma/migrations`，沿用 README 的 `prisma db push` 方式：

```bash
# 1. 备份数据库
cp data/ldpass.sqlite data/ldpass.sqlite.bak

# 2. 生成 Prisma Client
pnpm db:generate

# 3. 同步 schema
pnpm db:push
```

本次变更为：

- `YctQqLink.activeOpenIdKey` 去掉唯一索引（字段保留，历史数据不删除）；
- `YctQqLinkToken` 增加可空列 `claimedByUserId`、`claimedAt` 和对应索引/外键。

已有 c2c 绑定行仍保留 `activeKey`，迁移后继续可用。若 `db push` 提示需要确认，请先备份再按
Prisma 输出处理；不要删除 `YctQqLink` 历史表数据。

## 5. 机器人侧需要新增的配置

### 5.1 环境变量

服务端与机器人继续共用原有配置，**不需要新增密钥**：

| 变量                  | 位置            | 说明                                                     |
| --------------------- | --------------- | -------------------------------------------------------- |
| `QQ_BOT_LINK_SECRET`  | 服务端 + 机器人 | 内部接口 Bearer；至少 24 位独立随机串                    |
| `LDPASS_API_BASE_URL` | 机器人          | 临东通 API 根地址，例如 `https://ldpass.example.com`     |
| `LDPASS_WEB_BASE_URL` | 机器人（可选）  | 如果机器人自己拼接链接才需要；通常直接用接口返回的 `url` |

服务端另需：

| 变量                                   | 说明                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `LDPASS_PUBLIC_ORIGIN` 或 `WEB_ORIGIN` | 生成绑定网页链接的站点根地址；都未配置时回退请求 Host                                                      |
| `QQ_LINK_HASH_SECRET`                  | 可选；token/确认码派生的 HMAC 专用密钥，未配置时使用 `SESSION_SECRET`。更换后未使用的 token/确认码立即失效 |

### 5.2 QQ 开放平台

- 开启群聊 @机器人 消息事件（`GROUP_AT_MESSAGE_CREATE`）；
- 群消息里读取 `group_openid` 和 `member_openid`，不要使用 QQ 号或客户端传入的 openid；
- 机器人需要在收到 `/绑定` 后把 token 与 `(group_openid, member_openid)` 关联缓存，因为
  `/确认 482913` 消息本身只带确认码，不带 token。

建议的进程内缓存（不要写日志、不要持久化）：

```text
key:   `${group_openid}:${member_openid}`
value: { token, expiresAt }
TTL:   5 分钟（与 token 一致）
上限:  例如 10000 条，超出按过期时间淘汰
```

### 5.3 指令行为

| 场景                                              | 机器人行为                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 单聊 `/绑定`                                      | 调 2.7（`scope=c2c`），回复链接                                                            |
| 单聊 `/确认`                                      | 不适用；单聊链接在网页直接确认                                                             |
| 群内 @机器人 `/绑定`                              | 调 2.7（`scope=group` + `group_openid`），缓存 token，回复链接和“回群发送 /确认”提示       |
| 群内 @机器人 `/确认 482913`                       | 查缓存；缺失/过期则提示重新 `/绑定`；调用 2.8，使用事件里的 `member_openid`/`group_openid` |
| 2.8 返回 `ok: true`                               | 从缓存删除 token，回复绑定成功及对应临东通账号                                             |
| 返回 `token_used`/`token_expired`/`token_invalid` | 从缓存删除 token，提示重新 `/绑定`                                                         |
| 返回 `openid_mismatch`/`group_mismatch`           | 不要换用别人的 token；提示当前成员不是发起者                                               |
| 返回 `token_not_claimed`                          | 提示先打开网页登录并获取确认码                                                             |
| 返回 `confirm_code_invalid`                       | 保留 token，提示重新查看网页上的确认码                                                     |

机器人不得把 `token`、`url`、确认码写入日志或持久化存储；调试时最多记录 tokenId（如果自行保存）。
`/确认` 只使用事件中的 `member_openid`，因此群主/管理员无法替成员确认。

## 6. 安全行为

- 网页 token：128 位随机，5 分钟有效，一次性，只存 HMAC 哈希；群 token 绑定
  `openId + groupOpenId + scope`，跨 scope 使用返回 `group_mismatch`。
- 网页群确认页：只认领 token 并展示 6 位确认码，不消费 token；`/api/account/qq-link/confirm`
  对群 token 返回 `group_confirm_required`。
- 认领：第一个登录账号生效；其他账号返回 `token_claimed`。页面显示将要绑定的临东通账号，
  用户应在回群确认前核对。
- 群内确认：请求中的 `openId`/`groupOpenId` 必须与 token 完全一致；创建绑定时使用 token 中
  已校验的值，不直接信任请求参数。只有 token 对应的 `member_openid` 在同一个群发送 `/确认`
  才能成功，群主/管理员没有例外。
- 确认码：6 位数字，由 `tokenHash + claimedByUserId + claimedAt` 经 HMAC 派生，不落库、不写日志；
  5 分钟内有效，token 消费后一次性失效；错误确认码不消费 token。
- 限流：token 生成按 `scope + groupOpenId + openId` 15 次/10 分钟；群确认失败按同一身份
  10 次/10 分钟；绑定码消费失败按 openid；网页确认失败按用户。
- 审计：token 生成、认领成功/失败、群确认成功/失败、解绑、解绑失败都写 `AuditLog`；
  只记录 tokenId/codeId/qqLinkId、openid/groupOpenId 的 HMAC 指纹和 `abcd…wxyz` 掩码，
  不记录明文 token、确认码或完整 openid。
- 日志：本实现不打印 token、确认码、secret 或完整 openid。机器人侧也应避免把 `/token` 返回的
  `url`、token 或确认码写进日志。
- 响应头：账户接口 `Cache-Control: no-store`；`/account/link/qq` 与 `/login` 设置
  `Referrer-Policy: no-referrer` 和 `Cache-Control: no-store`，避免 token 通过 Referer 泄漏给
  字体等第三方资源，也避免带 token 的页面进入浏览器/中间层缓存。
- Service Worker 已排除 `/account/link/qq` 与 `/login`，避免把带 token 的页面写进 Cache Storage。
- 绑定码/网页 token 均在 URL 或请求体中短暂出现，部署层（Nginx/Next）的访问日志不应记录完整
  query string；如需记录请对 `token`、`code` 参数脱敏。

## 7. 测试

```bash
pnpm --filter @ldpass/api test:qq-link
```

测试会：

1. 生成 Prisma Client 并构建 API；
2. 在 `apps/api/test/.tmp/` 下创建临时 SQLite 并执行 `prisma db push`；
3. 直接调用 Next Route Handler 的 `handleNextApiRequest` 跑 31 个集成测试。

覆盖：

- 原有单聊流程 20 项：绑定码生成/消费、过期、重复消费、openid 冲突、未登录、错误 secret、
  解绑/resolve、重新绑定、网页解绑归属、并发消费、数据库唯一约束、审计脱敏、群聊绑定码拒绝、
  c2c 携带 groupOpenId 拒绝、消费限流、网页 token 生成/预览/确认、token 过期、openid 冲突、
  no-referrer/no-store 配置；
- 群聊新增 10 项：
  1. 群 token 生成 → 网页预览/认领 → 群内确认 → 绑定成功；
  2. 错误群 / 错误 openid / 群管理员不能确认，token 不被消费；
  3. 群里其他人打开链接不能完成绑定，也不能覆盖认领；
  4. 确认码错误不消费；未认领、过期、重复使用返回 `token_not_claimed`/`token_expired`/`token_used`；
  5. 群绑定与单聊绑定互相独立，同一账号可有多个群身份，同一 openid 不能绑第二个账号；
  6. resolve 按 group 查询，缺少 groupOpenId 或 c2c 携带 groupOpenId 被拒绝；
  7. 群解绑只解绑当前群身份，不影响其他群/单聊，解绑后可重新绑定；
  8. 并发确认同一个群 token 只成功一次；
  9. 群绑定审计不包含明文 token、确认码、完整 openid/groupOpenId；
  10. scope 隔离：群 token 不能网页确认，单聊 token 不能群确认。

本次结果：**31 passed / 0 failed**。

## 8. 与现有 c2c 流程的兼容说明

1. 单聊接口路径、请求体、响应字段保持不变；`GET /api/account/qq-link/token` 只新增
   `requiresGroupConfirmation` 字段，`resolve` 只新增 `groupOpenId` 字段，均为向后兼容的增量。
2. `scope` 在 `resolve` 中仍默认 `c2c`；单聊绑定码流程不变，`/consume` 继续只接受 c2c。
3. 群聊 token 之前一律返回 `group_not_supported`，现在会正常生成；网页确认群 token 从
   `group_not_supported` 变为 `group_confirm_required`，这是本次新增群能力对应的行为变化。
4. 原来的 21 个测试中 20 个完全不变；唯一改动的是“群聊不生成 token”这一条，改为验证群 token
   正常生成并绑定 `groupOpenId`。其余单聊测试全部原样通过。
5. 数据库对单聊 active 绑定的唯一性仍由 `activeKey` 保证；迁移后已有 `activeKey` 数据继续有效。
   `activeOpenIdKey` 不再是唯一键，避免群身份和单聊/多群身份互相误伤。
