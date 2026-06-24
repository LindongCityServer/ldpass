# 发卡方核销链接格式与参数

本文档说明发卡方现场核销页的链接格式、参数含义和后端校验规则。该链接用于发卡方工作人员按已领取卡片的卡号发起核销，不用于用户领取卡券。

## 页面入口

发卡方后台核销页：

```text
/provider/redemptions
```

携带卡号预填：

```text
/provider/redemptions?cardNumber=<publicNumber>
```

如果要生成完整 URL，使用当前站点域名拼接：

```text
<origin>/provider/redemptions?cardNumber=<publicNumber>
```

## 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `cardNumber` | 否 | 已领取卡片的完整公开卡号，也就是 `Pass.publicNumber`。不传时页面打开为空表单，工作人员可手动输入。 |

`cardNumber` 会在前后端做统一处理：

- 去掉空白字符。
- 转为大写。
- 如果输入的是包含 `cardNumber` 查询参数的完整链接，会读取其中的 `cardNumber`。
- 不读取 `token` 或 `claimCode`。

## 与领取码的边界

领取码和核销卡号职责分开：

- 领取码 / 添加链接用于用户把卡券添加到钱包。
- 核销链接只用于发卡方按已领取卡片发起核销。
- `LD-` 开头的领取码不能作为核销凭据。
- `/add` 不再进入发卡方核销模式，即使 URL 带有 `cardNumber` 也只作为添加卡券页面处理。

## 后端接口

核销页预览卡片：

```http
GET /api/provider/redemptions/pass-preview?cardNumber=<publicNumber>
```

按卡号发起核销：

```http
POST /api/provider/redemptions/by-card-number
Content-Type: application/json

{
  "cardNumber": "<publicNumber>",
  "requestedValue": "<decimal>",
  "verificationMethod": "pin",
  "idempotencyKey": "<unique_key>"
}
```

`verificationMethod` 可选值：

- `pin`：由持卡用户输入 PIN 确认。
- `server_account`：由持卡用户完成本次服务器聊天验证码确认。

接口还支持可选参数：

| 参数 | 说明 |
| --- | --- |
| `expiresInSeconds` | 核销请求有效秒数，范围 30 到 3600。未传时默认 120 秒。 |
| `maxVerificationAttempts` | 最大验证尝试次数，范围 1 到 10。 |
| `idempotencyKey` | 幂等键，重复提交同一键返回首次创建的请求。 |

## 校验规则

后端只允许核销满足以下条件的卡片：

- 卡号存在。
- 卡片已经被用户领取。
- 卡片未归档、未冻结、未过期。
- 当前发卡方是原发卡方，或在模板允许核销方名单中。
- 同一卡号如果匹配到多张当前发卡方可核销卡片，会返回冲突错误，需要先在后台确认完整卡券。

不满足条件时，接口会返回可读错误，例如“卡号不存在，或当前发卡方未被允许核销这张卡”或“卡券尚未被用户领取，不能发起消耗请求”。

## 推荐用法

实体卡、二维码或外部系统跳转到核销页时，只携带 `cardNumber`：

```text
<origin>/provider/redemptions?cardNumber=<publicNumber>
```

工作人员打开后先读取卡券，核对持卡用户、卡号、余额和状态，再填写核销数值并选择确认方式。核销成功创建后，持卡用户需要在钱包侧完成确认，系统才会扣减权益并写入流水。
