# QQ 互联登录接入说明

本文档说明临东通如何接入 QQ 互联（网站应用 OAuth2.0）实现「使用 QQ 登录」，包括配置项、回调地址规则、已实现的接口和当前限制。

## 1. 与「QQ 机器人绑定」的区别

项目里已有的 `docs/qq-link-integration.md` 是 **QQ 官方机器人** 的账号绑定（`YctQqLink`，机器人事件里的 openid）。

本文档说的是 **QQ 互联网站应用登录**（用户在网页上点「QQ 登录」）：

- 身份来源不同：QQ 互联的 openid 按 appid 隔离，和机器人事件里的 openid 不是同一个身份空间。
- 数据表不同：登录绑定记在 `QqConnectBinding`，机器人绑定继续用 `YctQqLink`，两套互不影响。

## 2. 前置条件

1. 在 [QQ 互联](https://connect.qq.com/manage.html) 创建「网站应用」，拿到 **APP ID / APP KEY**。
2. 域名已完成 ICP 备案，且备案主体与 QQ 互联开发者认证主体一致。
3. 后台登记「网站回调地址」，规则见下一节。
4. 审核通过前，只有开发者注册的 QQ 号能完成登录；审核通过后才对全部 QQ 用户开放。

## 3. 回调地址

本项目的回调固定为：

```text
https://<站点域名>/api/auth/qq/callback
```

对生产环境即 `https://ldpass.shangxiaoguan.top/api/auth/qq/callback`。

QQ 互联的校验规则（见[官方 FAQ](https://wiki.connect.qq.com/%E5%9B%9E%E8%B0%83%E5%9C%B0%E5%9D%80%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98%E5%8F%8A%E4%BF%AE%E6%94%B9%E6%96%B9%E6%B3%95/)）：

- **协议 + 域名 + path 必须完全一致**，不做前缀匹配；不一致返回 `100010`。
- 多个地址用英文分号 `;` 分隔，总长 ≤ 1024。
- 不支持 `localhost`，也不能带端口，必须是公网可达域名。
- 不能带 `#`；追加查询参数可以，但域名与 path 部分必须一致。
- 修改回调地址不需要重新审核，缓存最迟约 30 分钟同步。

## 4. 配置项

| 变量 | 说明 |
| --- | --- |
| `QQ_CONNECT_ENABLED` | 设为 `false` 时关闭入口，默认开启。 |
| `QQ_CONNECT_APP_ID` | QQ 互联 APP ID。 |
| `QQ_CONNECT_APP_KEY` | QQ 互联 APP KEY，仅服务端使用，不要下发到前端。 |
| `QQ_CONNECT_REDIRECT_URI` | 必须与后台登记的回调地址逐字一致。留空时按 `LDPASS_PUBLIC_ORIGIN` / `WEB_ORIGIN` + `/api/auth/qq/callback` 推导，仅适合本地排查。 |

`APP_ID` / `APP_KEY` 任一为空时，登录页不会显示「使用 QQ 登录」入口，接口返回 503。

## 5. 已实现的接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/qq/status` | 返回 `{ enabled }`，前端据此决定是否显示入口。 |
| GET | `/api/auth/qq/start?redirect=/account` | 生成 state、写入签名 Cookie，302 跳转到 QQ 授权页。`redirect` 只接受站内相对路径。 |
| GET | `/api/auth/qq/callback` | QQ 回调。校验 state → 换 access_token → 取 openid → 绑定或登录 → 302 回站内。 |

### 回调结果

| 结果 | 跳转 |
| --- | --- |
| 已绑定的 QQ | 建立会话，回到 `start` 时传入的 `redirect`（默认 `/account`） |
| 未绑定，且当前已登录 | 绑定到当前账号，跳 `/account?qq=bound` |
| 未绑定，且当前未登录 | `/login?qq=unbound`（提示先登录再绑定） |
| state 失效或校验失败 | `/login?qq=state` |
| 用户取消授权 | `/login?qq=denied` |
| 换取 token / openid 失败 | `/login?qq=failed` |
| QQ 已绑定到其他账号 | `/login?qq=conflict` |
| 当前账号未激活 | `/login?qq=inactive` |
| 绑定账号已被删除 | `/login?qq=unavailable` |
| 未配置或已关闭 | `/login?qq=disabled` |

## 6. state 设计

- 每次点击登录生成随机 state，载荷（state、回跳路径、过期时间）经 `HMAC-SHA256(SESSION_SECRET)` 签名后放进 `ldpass_qq_state` Cookie。
- Cookie 为 `HttpOnly` + `SameSite=Lax` + `Path=/api/auth/qq`，10 分钟有效。
- 回调时同时校验签名和 state 是否一致（常量时间比较），校验完立即清除 Cookie，保证一次性。
- 回跳路径只允许站内相对地址，拒绝 `//`、`/api/`、反斜杠和控制字符，避免开放重定向。

## 7. 本地开发的限制

QQ 互联不接受 `localhost` 回调，所以**本地 3200 端口无法完成整条链路**：

- 可以验证：点击入口会 302 到 `graph.qq.com`，state Cookie 正确写入，回调路由存在且拒绝非法 state。
- 无法验证：QQ 授权后跳回本机。回调会落到登记的线上地址，需要线上已经部署这套代码。

要在本地跑通全链路，需要把 3200 端口映射到一个已备案的公网 HTTPS 域名，并把该地址登记进 QQ 互联后台。

## 8. 后续待办

- 账户页提供「解绑 QQ」入口（当前只能通过数据表或后台处理）。
- 自动注册：目前未绑定 QQ 不会自动建号，避免绕过注册审核流程。
- UnionID 多应用打通（QQ 互联同一开发者下的多个应用可共享 unionid）。
- 把 QQ 登录事件补充到审计明细（目前只发 `UserLoggedIn` 事件）。
