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

### 3. 校验当前登录态

外部系统前端从已登记 Origin 携带 Cookie 调用：

```http
GET /api/auth/client-session?client_id=<client_id>
```

请求必须带上浏览器凭据，例如：

```ts
await fetch('/api/auth/client-session?client_id=<client_id>', {
  credentials: 'include',
});
```

响应会返回当前账户校验结果。只有状态为 `Active` 的普通用户会被视为已认证。

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
- 外部系统必须只把 `authenticated=true` 且用户状态有效的响应视为登录成功。
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
