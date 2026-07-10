# 发卡方外部网站核销链接接入流程

本文档说明发卡方如何在自己的外部网站中接入临东通核销能力，尤其是“扣减某张卡的特定余额或权益值”的流程。

结论先放前面：外部网站不应该把扣减数值直接拼进用户可改的 URL。正确做法是先由发卡方后端调用开放 API 创建一次性操作链接，临东通把目标卡、扣减值、验证方式和有效期写入服务端记录，再返回只包含 `token` 的 `/action` 链接给用户确认。

## 两种入口的边界

### 工作人员后台核销入口

发卡方工作人员在后台按卡号发起核销时，使用：

```text
/provider/redemptions?cardNumber=<publicNumber>
```

完整 URL：

```text
<origin>/provider/redemptions?cardNumber=<publicNumber>
```

这个入口需要发卡方后台会话，适合门店工作人员或运营后台使用。`cardNumber` 只用于预填卡号，工作人员仍需在后台读取卡券、填写扣减值并创建核销请求。

### 外部网站用户确认扣减入口

外部网站需要让用户自己确认扣减时，使用操作链接：

```text
<origin>/action?token=<token>
```

`token` 由开放 API 生成。用户打开后会看到本次操作、扣减值、卡券信息，并选择 PIN 或服务器账号验证码完成确认。确认成功后系统才会扣减余额、写入流水，并把链接标记为已消费。

## 标准接入流程

### 1. 准备 API 密钥

发卡方在 `/provider/api-keys` 申请 API 密钥，管理员审核通过后一次性查看明文密钥。外部网站的后端保存该密钥，前端浏览器不得保存或直接调用开放 API。

创建扣减链接至少需要：

- `action_links:create`
- 如需查询卡券定位 `targetPassId`，还需要 `passes:read`
- 如需查询或撤销链接，再申请 `action_links:read`、`action_links:revoke`

### 2. 找到要扣减的卡券

创建操作链接需要目标卡券 ID，也就是 `targetPassId`。如果外部系统只有公开卡号、持卡用户名或邮箱，可以先调用：

```http
GET /api/open/provider/issuing/passes?keyword=<publicNumber_or_username_or_email>
Authorization: Bearer <provider_api_key>
```

返回结果中选择属于当前业务订单的已领取卡券，并记录它的 `id` 作为 `targetPassId`。如果外部网站使用自己的会员号，建议在发卡或绑卡时保存会员号到临东通卡券 ID 的映射，不要依赖用户提交的会员号直接扣减。

### 3. 创建扣减操作链接

发卡方后端调用：

```http
POST /api/open/provider/action-links
Authorization: Bearer <provider_api_key>
Content-Type: application/json
X-LDPass-Timestamp: <Unix 秒/毫秒时间戳或 ISO 时间>
X-LDPass-Idempotency-Key: <同一业务订单稳定不变的幂等键>
X-LDPass-Signature: v1=<HMAC-SHA256 Base64URL 签名>

{
  "kind": "use",
  "targetPassId": "<pass_id>",
  "requestedValue": "12.50",
  "verificationMethod": "pin",
  "expiresInSeconds": 900,
  "note": "订单 202607090001 扣减"
}
```

字段说明：

| 字段                 | 必填 | 说明                                                              |
| -------------------- | ---- | ----------------------------------------------------------------- |
| `kind`               | 是   | 扣减固定传 `use`。`top_up` 是额度补充，不用于发卡方外部网站扣减。 |
| `targetPassId`       | 是   | 要扣减的已领取卡券 ID。                                           |
| `requestedValue`     | 是   | 本次扣减值，最多 6 位小数，必须大于 0。                           |
| `verificationMethod` | 是   | `pin` 或 `server_account`。                                       |
| `expiresInSeconds`   | 否   | 链接有效期，范围 60 到 86400 秒，未传默认 15 分钟。               |
| `note`               | 否   | 展示给用户和审计使用的说明，不要放敏感数据。                      |

服务端会校验：

- 目标卡券属于当前发卡方。
- 卡券已经被用户领取。
- `kind=use` 时卡券状态允许扣减。
- 可用余额满足 `balanceValue - frozenValue + overdraftLimit >= requestedValue`。
- 同一幂等键重复提交时返回首次创建的结果，不重复创建扣减链接。

响应示例：

```json
{
  "actionLink": {
    "id": "<action_link_id>",
    "kind": "use",
    "status": "Active",
    "targetPassId": "<pass_id>",
    "requestedValue": "12.5",
    "verificationMethod": "pin",
    "expiresAt": "2026-07-09T12:15:00.000Z",
    "token": "<token>",
    "actionPath": "/action?token=<url_encoded_token>"
  }
}
```

外部网站把 `actionPath` 拼到临东通站点域名后展示给用户：

```text
<origin>/action?token=<token>
```

### 4. 用户确认

用户打开 `/action?token=...` 后：

1. 未登录时先登录，登录后回到该链接。
2. 页面展示发卡方、卡券、当前值、本次扣减值和有效期。
3. 用户按链接要求输入 PIN，或获取服务器聊天验证码并发送。
4. 验证成功后，临东通创建核销请求、扣减余额、写入 `use` 流水，并消费该操作链接。

链接一旦消费、过期或撤销，不能再次用于扣减。

### 5. 外部网站同步结果

推荐通过 Webhook 监听以下事件：

- `WalletActionLinkConsumed`：操作链接已经被用户确认并消费。
- `PassUseRequested`：扣减请求创建。
- `PassUseSucceeded`：扣减成功。
- `PassUseFailed`：扣减失败。
- `PassBalanceChanged`：卡券余额发生变化。

如果暂时没有 Webhook，可以用 `GET /api/open/provider/action-links?targetPassId=<pass_id>&status=<status>` 按目标卡券和状态查询操作链接；核销记录可用 `GET /api/open/provider/redemptions` 查询。

## 开放 API 签名

写接口必须带签名和幂等键。签名内容按行拼接：

```text
LDPass-OpenAPI-V1
<HTTP_METHOD>
<route>
<X-LDPass-Timestamp>
<X-LDPass-Idempotency-Key>
<SHA256(body) 的 hex>
```

使用明文 API 密钥作为 HMAC-SHA256 key，结果用 Base64URL 编码，放入：

```text
X-LDPass-Signature: v1=<signature>
```

服务端允许 5 分钟时间偏差。`X-LDPass-Idempotency-Key` 应使用外部系统订单号或业务流水号派生，保证同一次业务重试稳定不变。

## 不推荐的做法

- 不要生成 `/action?requestedValue=12.50&cardNumber=...` 这种可篡改链接。
- 不要把 API 密钥放进浏览器、移动端或二维码。
- 不要把后台核销页 `/provider/redemptions?cardNumber=...` 发给普通用户确认扣减。
- 不要用 `kind=top_up` 表达扣减；扣减始终用 `kind=use`。
- 不要跳过用户确认直接调整余额。后台直接调账应走 `ledger:adjust` scope，并作为管理调整审计，不应伪装成用户核销。
