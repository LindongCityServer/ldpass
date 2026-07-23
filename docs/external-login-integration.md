# 外部登录接入说明

本文档说明外部系统如何接入临东通登录能力，并评估当前轻量接入方案与标准 OAuth / OIDC 方案的差异。

## 当前已支持的轻量登录回跳

当前项目支持“登录回跳 + 会话校验 API”的最小闭环，适合可信外部 Web 系统判断用户是否已经在临东通登录。

### 1. 登记客户端应用

管理员在 `/admin/client-applications` 创建客户端应用，配置：

- `client_id`
- 应用名称
- 精确允许的 `redirect_uri`
- 允许携带 Cookie 调用会话校验接口的 Origin
- 是否启用

`redirect_uri` 和 Origin 必须精确登记，未登记或已停用的应用不能通过校验。

### 2. 跳转到登录页

外部系统将用户跳转到：

```text
/login?client_id=<client_id>&redirect_uri=<redirect_uri>&state=<state>
```

登录页会调用：

```http
GET /api/auth/login/redirect?client_id=<client_id>&redirect_uri=<redirect_uri>&state=<state>
```

服务端确认 `client_id` 和 `redirect_uri` 有效后，用户登录成功会回跳到登记的 `redirect_uri`，并原样带回 `state`。

如果用户打开登录页时当前设备已经存在临东通 Active 会话，页面会显示“使用当前账号”按钮。用户点击后不需要重新输入密码，系统会直接使用当前账号回跳到已登记的 `redirect_uri`。

如果用户改为输入另一个账号，临东通不会覆盖当前设备已有的主会话。服务端会为该 `client_id` 签发一个隔离的外部验证会话，仅供回跳方通过 `client-session` 读取本次输入的账号。该验证会话有效期为 5 分钟，回跳方应在落地后立即完成校验并建立自己的业务会话。

如果当前设备原本没有临东通会话，登录成功仍会建立正常的临东通主会话，同时签发本次外部验证会话。

### 2.1 跨站 iframe 回跳

当外层页面与临东通不是同一二级域名时，登录页仍可放在 iframe 中，登录成功后会在该 iframe 内跳转到已登记的 `redirect_uri`。嵌入态仅会将本次 5 分钟外部验证会话签发为 host-only 的 `SameSite=None; Secure; Partitioned` Cookie；临东通主会话继续保持 `SameSite=Lax`，不会被外部页面用于访问钱包或账户接口。

生产环境必须使用 HTTPS，并保持 `AUTH_COOKIE_SECURE=true`。支持 Storage Access API 的浏览器会在用户提交登录时请求存储权限；支持 CHIPS 的浏览器则可使用分区 Cookie 完成本次 iframe 回跳。仍完全拒绝第三方存储的浏览器需要退回到顶层登录，后续可升级为 Authorization Code + PKCE。

### 3. 跳转到账号验证页

外部系统如果需要用户对当前账号做一次二次确认，可以将用户跳转到：

```text
/verify-account?client_id=<client_id>&redirect_uri=<redirect_uri>&state=<state>&purpose=<purpose>
```

参数规则和登录页一致：

| 参数           | 必填 | 说明                                                                                                 |
| -------------- | ---- | ---------------------------------------------------------------------------------------------------- |
| `client_id`    | 是   | 管理员登记的客户端应用标识。                                                                         |
| `redirect_uri` | 是   | 必须精确命中该客户端应用的允许回跳地址。                                                             |
| `state`        | 建议 | 外部系统生成的不可预测随机值，回跳后必须校验。                                                       |
| `purpose`      | 否   | 外部系统自定义业务用途，例如 `checkout-confirm` 或订单号摘要。仅用于审计和回跳提示，不应放敏感数据。 |

页面会要求用户先处于已登录且 Active 状态。未登录时会引导用户登录并回到本页继续验证。

用户可选择两种方式：

- `pin`：输入临东通账户 PIN。
- `server_account`：获取验证码，并使用已绑定且已验证的服务器账号在服务器聊天中发送验证码。

验证成功后，临东通会回跳到已登记的 `redirect_uri`，并追加：

| 回跳参数              | 说明                                             |
| --------------------- | ------------------------------------------------ |
| `state`               | 原样带回外部系统传入的 `state`。                 |
| `ldpass_verification` | 固定为 `ok`。                                    |
| `ldpass_method`       | 本次验证方式，取值为 `pin` 或 `server_account`。 |
| `ldpass_purpose`      | 传入 `purpose` 时带回。                          |

外部系统必须校验 `state`，并在需要读取当前用户时继续调用会话校验接口，不要只凭回跳参数识别用户身份。

### 4. 校验当前登录态

外部系统前端从已登记 Origin 携带 Cookie 调用临东通的 API 域名：

```http
GET /api/auth/client-session?client_id=<client_id>
```

请求必须带上浏览器凭据，例如：

```ts
await fetch('https://<ldpass-host>/api/auth/client-session?client_id=<client_id>', {
  credentials: 'include',
});
```

响应会返回当前账户校验结果。只有状态为 `Active` 的普通用户会被视为已认证。

当请求对应的 `client_id` 存在尚未过期的隔离验证会话时，接口优先返回该会话中的账号；否则回退到临东通主会话。因此，同一设备可以保持临东通账号不变，同时用另一个账号完成某个外部应用的单次登录验证。隔离验证会话不能用于访问临东通钱包、账户中心或其他客户端应用。

```json
{
  "authenticated": true,
  "clientApplication": {
    "clientId": "<client_id>",
    "name": "<application_name>"
  },
  "user": {
    "id": "<user_id>",
    "username": "<username>",
    "email": "<email>",
    "serverAccountVerified": true
  }
}
```

待审核、被拒绝、等待服务器验证、封禁或已删除账户都不能被外部系统当作已登录用户使用。

## 与标准 OAuth / OIDC 的差异

当前方案不是完整 OAuth 2.0 / OIDC Provider。它没有：

- Authorization Code
- Token Endpoint
- Refresh Token
- Access Token / ID Token
- Scope 与 Consent 页面
- PKCE
- Token 撤销与 introspection

因此当前方案适合“同一产品体系内的可信 Web 页面确认登录态”，不适合把临东通作为通用第三方身份提供方。

## 两种方案评估

轻量会话校验 API 适合：

- 外部系统和临东通部署在同一可信业务体系内
- 外部系统只需要判断用户是否已登录
- 外部系统不需要长期持有用户授权
- 接入端主要是浏览器 Web 页面

标准 OAuth / OIDC 适合：

- 第三方应用需要标准授权流程
- 移动端、桌面端或后端服务需要获取 token
- 需要 scope、用户授权确认、撤销授权
- 需要标准 ID Token 或接入通用身份中间件
- 需要和更多外部开发者或组织开放集成

建议当前阶段保留轻量方案；如果后续开放给第三方生态，再新增标准 OIDC Provider，采用 Authorization Code + PKCE，并继续复用现有的 `ClientApplication` 登记模型作为应用注册基础。

## 安全要求

- `redirect_uri` 必须精确匹配，不使用域名前缀匹配。
- 外部系统必须生成不可预测的 `state`，并在回跳后校验，防止 CSRF。
- 生产环境必须使用 HTTPS。
- 会话校验请求必须使用已登记 Origin，并开启 Cookie credentials。
- 回跳页应在 5 分钟内调用会话校验接口，不应把隔离验证会话当作外部应用的长期登录态。
- 外部系统必须只把 `authenticated=true` 且用户状态有效的响应视为登录成功。
- 外部账号验证回跳必须同时校验 `state` 和当前会话，不要把 `ldpass_verification=ok` 当作长期授权凭据。
- 登录、回跳校验、会话校验接口应持续保留限流和审计。
- 不要把当前轻量方案返回的用户信息当作长期授权 token 使用。

## 后续升级到标准 OIDC 的组件清单

如果要升级为标准 OIDC Provider，建议新增：

- 授权端点：`GET /oauth/authorize`
- Token 端点：`POST /oauth/token`
- JWKS：`GET /.well-known/jwks.json`
- OIDC Discovery：`GET /.well-known/openid-configuration`
- 用户信息端点：`GET /oauth/userinfo`
- 授权码、Access Token、Refresh Token 存储表
- Scope、Consent、授权撤销和客户端密钥轮换
- PKCE 校验和 token 签名密钥轮换
