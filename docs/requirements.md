# 临东通卡包管理网站需求文档

## 1. 项目定位

临东通是一个面向用户、卡券提供方与网站管理员的卡包管理网站。产品体验参考 Apple Wallet：用户可以集中管理银行卡样式账户卡、交通/校园/会员/票券/自动扣费等凭证，以卡片堆叠、详情面板、确认使用、使用结果回执等方式完成日常操作。

本项目不涉及真实资金流动。产品文案、接口命名与业务模型应避免把平台描述为资金支付系统，优先使用“消耗余额”“使用余额”“确认使用”“核销”“权益扣减”“额度补充”等措辞。

## 2. 设计输入

### 2.1 已有原型观察

- 整体视觉：白底、轻量导航、卡片堆叠、绿色品牌主色，局部使用灰色信息面板。
- 品牌标识：临东通 / LD PASS，绿色到黄色渐变图形。
- 用户首页：左侧为分类导航，中间为卡包堆叠列表，右侧为选中卡片详情。首页卡片一般只显示卡面图片和左下角卡号末四个字符；如果没有上传卡面图片，才在卡片顶部显示标题和余额；如果模板勾选隐藏标题，则隐藏标题和余额，只保留左下角卡号末四个字符。
- 移动端首页：顶部工具栏包含搜索、添加、编辑、头像入口；普通用户头像优先使用已验证 Minecraft 服务器账号派生图片，失败时回退默认占位；卡包列表为纵向堆叠卡片。
- 卡片类型：账户/卡、证件/钥匙、票券、自动扣费。其中自动扣费属于后续阶段。
- 卡片详情：展示卡面、卡号末四个字符、余额、充值/乘车/取消等操作、发卡方信息、完整卡号、账户信息、交易记录。原型中的“充值”后续需根据真实业务转译为“额度补充”等非资金化文案。当前详情默认保留摘要和模块入口，余额摘要只展示权益值，发卡方进入独立模块并可展示发卡方审核通过的介绍链接；卡片详情、发卡方、充值、来源卡选择、发起核销、待确认核销、交易记录、争议记录、提交争议和转赠都进入弹窗闭环；交易记录通过独立接口按需读取，并合并展示额度补充请求记录。
- 使用确认：展示待使用卡片、金额/余额变更、确认按钮、校验方式、验证码/二维码/方向码等。
- 使用结果：成功页展示消耗金额、优惠/减免、提供方/接收方、备注、账户、时间、订单号；失败页展示错误原因与订单号。原型中的“收款方”应转译为“提供方”“接收方”或具体业务对象。
- 票券详情：展示航班/赛事/座位/时间/地点等信息，并保留核验入口。
- 卡券提供方展示：例如书店积分、球队赛事票、饭店房间/积分等卡券卡片。

### 2.2 图标与前端资源

- 图标优先使用 Material Symbols。
- Material Symbols 可以全部通过 CDN 引入。
- 生产环境仍需保留降级方案：CDN 不可用时页面功能不应阻塞，只是图标显示降级。
- 项目 Logo 源文件存放目录：`assets/brand/`。
- 当前品牌素材：
  - `assets/brand/ldpass_icon_color.svg`：彩色版 Logo。
  - `assets/brand/ldpass_icon.svg`：单色版 Logo。
  - `assets/brand/ldpass_background_01.svg`：广告图背景。
- 当前 SVG 已确认无 UTF-8 BOM；包含内嵌 `data:image/png;base64` 资源和 SVG 内部引用。
- 前端使用 SVG 时应按静态资源引用，不要把 SVG 文本直接注入 DOM。
- 卡面背景图支持提供方上传，也支持填写图床链接。
- 卡面背景图裁剪宽高比固定为 `856:540`。
- 上传图片大小限制为 1 MB 以内。
- 背景图、Logo、字段等卡券可见信息都需要管理员审核通过后才能发布。

### 2.3 已确认产品决策

- 第一阶段余额类型支持金额、积分、次数。
- 对外展示名称允许由卡券模板自定义，例如“余额”“积分”“剩余次数”“可用餐次”等。
- 其他复杂权益优先判断能否归入金额、积分、次数；如果核心是入场、座位、乘车、活动资格等凭证，则归入“票券”模型。
- 项目完全不接入真实支付通道。
- 金额类权益不显示货币符号，默认使用“额度”等非资金化名称。
- 转赠、共享、冻结额度、透支额度、积分过期、次数过期等规则由发行方在模板中配置。
- 第一阶段一张卡券只包含一种权益类型，不支持同一张卡券同时包含金额、积分、次数等多种权益。
- 普通用户主动“补充额度”不进入最早的注册/领卡闭环，但需要从当前模型开始预留；后续应支持部分卡片从其他已授权卡片中消耗额度，为目标卡片补充额度。
- 第一阶段由提供方发放卡券、调整额度或同步权益。
- 对外能力优先级：先做可复用的登录验证，再做添加卡券链接/二维码。
- 第一阶段卡券类型包含账户/卡、证件/钥匙、票券。
- 自动扣费/自动权益扣减后续阶段再做。
- 技术栈优先在 Node.js / TypeScript 生态内评估，降低学习和维护成本。
- 长期身份模型采用统一用户账户：同一个登录主体可以同时是普通持卡用户、管理员或某个发卡方的成员；发卡方能力应通过成员身份、角色和当前工作区授予，而不是维护一套与普通用户完全割裂的网页登录账户。短期如果仍保留独立发卡方 session，遇到同一浏览器同时存在普通用户和发卡方 session 时，默认按普通用户上下文处理，发卡方核销必须显式进入对应模式，避免设备角色冲突。

## 3. 目标用户与体验目标

### 3.1 普通用户

用户需要快速找到、添加、查看和使用自己的卡券。

核心体验目标：

- 打开网站后能像钱包一样直观看到全部卡片。
- 能按分类、搜索、发卡方、最近使用快速定位卡券。
- 能安全地查看敏感信息，例如完整卡号、验证码、二维码。
- 能用清晰的确认流程完成“消耗余额/核销/使用权益”。
- 能查看使用记录、失败原因、余额变化与凭证编号。
- 能通过外部链接或二维码快速登录并添加卡包。

### 3.2 卡券提供方

提供方需要创建、发放、管理和核销自己的卡券。

核心体验目标：

- 能配置卡券模板，包括卡面样式、字段、权益规则、有效期、核销方式。
- 能通过链接、二维码、嵌入按钮或开放接口让用户添加卡券。
- 能查询用户持有状态、使用记录、核销结果与异常状态。
- 后续能配置自动扣费/自动权益扣减规则，但需要用户明确授权。
- 能接入外部业务系统，完成卡券发放、余额变更、核销确认、状态同步。

### 3.3 网站管理员

管理员需要维护平台安全、合规、内容质量与运营状态。

核心体验目标：

- 能审核提供方资质、卡券模板、品牌资源与敏感文案。
- 能管理用户、提供方、卡券、事件日志与异常记录。
- 能配置全站文案规范，避免出现真实金融支付暗示。
- 能查看系统健康状态、接口调用量、失败率、风控命中记录。
- 能冻结异常卡券、禁用提供方、撤销错误发放或标记争议记录。

## 4. 业务范围

### 4.1 第一阶段 MVP

- 用户注册申请、管理员审核、登录、退出。
- 服务器账户验证免审核注册流程。
- 可复用登录验证能力，供临东通和其他项目使用。
- 用户卡包首页。
- 卡券分类与卡片堆叠展示。
- 添加卡券。
- 添加卡券链接/二维码。
- 卡券详情。
- 金额、积分、次数三类余额/权益展示。
- 余额消耗或权益核销确认。
- 使用成功/失败结果页。
- 使用记录列表。
- 提供方后台基础能力：创建卡券模板、发放卡券、调整金额/积分/次数、查看核销记录。
- 管理员后台基础能力：提供方审核、卡券模板审核、用户与卡券查询。
- 对外访问入口：登录跳转、登录后回跳、添加卡券链接、添加卡券二维码。

### 4.2 后续阶段

- 多种核验方式：商户扫码、用户出示码、一次性验证码、动态方向码、人工确认码、NFC/近场能力预留。
- 自动扣费/自动权益扣减授权。
- 卡内额度补充：从其他支持对外补充的卡片内消耗余额或权益，为目标卡片补充额度。
- 使用链接和补充链接：外部项目可引导用户打开一次性链接，预览后由用户确认消耗或补充；第一版已支持发卡方后台和开放 API 生成短有效期操作链接。
- 对外开放 API：卡券发放、状态查询、额度调整、核销结果查询、冻结/取消等。
- 同一张卡券包含多种权益。
- 卡券共享、家庭成员、企业成员。
- 离线可展示凭证。
- 更高级的提供方 Webhook 管理，例如手动重放、投递详情检索和失败告警。
- 管理员风控规则配置。
- 主题卡面与品牌素材库。

## 5. 核心术语

| 术语      | 含义                                                       | 备注                                                               |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 卡包      | 用户持有卡券的集合                                         | 类似 Apple Wallet 的钱包视图                                       |
| 卡券      | 平台内可展示、管理、使用的凭证                             | 第一阶段包括账户/卡、证件/钥匙、票券；自动扣费后续支持             |
| 卡券模板  | 提供方定义的卡券样式与字段规则                             | 由提供方创建，管理员可审核                                         |
| 持卡实例  | 某个用户实际持有的一张卡券                                 | 由模板发放而来                                                     |
| 余额/权益 | 平台展示的金额、积分、次数                                 | 对外展示名称可由模板自定义，不等同于真实资金；金额类不显示货币符号 |
| 消耗余额  | 用户使用卡券时扣减展示额度或权益                           | 替代“支付”类文案                                                   |
| 额度调整  | 提供方对用户持卡实例的金额、积分、次数进行增加、减少或同步 | 第一阶段由提供方操作，不把平台描述为真实充值或支付                 |
| 额度补充  | 用户在授权后从来源卡消耗额度，为目标卡增加展示额度或权益   | 不接入真实支付通道；后续支持，当前需要预留规则、流水和审计         |
| 冻结额度  | 发行方或管理员限制某部分额度暂不可用                       | 是否允许由发行方规则配置                                           |
| 透支额度  | 发行方允许额度扣减到 0 以下的范围                          | 是否允许、上限和场景由发行方规则配置                               |
| 核销      | 提供方确认某项权益已经被使用                               | 常用于票券、优惠券、活动券                                         |
| 提供方    | 发行或管理卡券的组织                                       | 商户、学校、交通机构、场馆等                                       |
| 管理员    | 平台运营与安全管理人员                                     | 负责审核与治理                                                     |

## 6. 文案规范

### 6.1 推荐使用

- 确认使用
- 消耗余额
- 使用余额
- 权益扣减
- 核销
- 额度补充
- 增加额度
- 卡券余额
- 使用记录
- 使用成功
- 使用未完成

### 6.2 需避免或谨慎使用

- 支付
- 付款
- 收款
- 交易支付
- 支付账户
- 金融账户
- 银行扣款

如必须描述第三方系统返回的原始字段，应在用户界面转译为平台术语，在接口内部保留兼容字段也需要增加清晰注释。

## 7. 功能需求

### 7.1 用户端

#### 7.1.1 账户注册与登录

- 正常注册后进入待审核状态，需要管理员审核通过后才完成注册。
- 注册申请需要提交用户名、邮箱、审核信息。
- 系统需要记录注册时的 IP 地址。
- 如果可用，应记录注册 IP 的省/州级属地；IP 属地只能作为辅助信息，不能作为强身份校验依据。
- 待审核、被拒绝、等待服务器验证或被封禁的用户可以登录到账户页查看状态、退出登录或注销账户，但不能使用卡包能力；已删除账户不能重新登录。
- 用户自助注销或管理员删除普通用户后，需要释放该账号占用的用户名、邮箱和服务器 ID；审计、流水、卡券、争议等历史引用不能直接丢失，应使用稳定匿名代号保留“同一已删除账号”的可追溯性。
- 卡包、转赠、核销、争议、通知、PIN、设备管理、服务器账号换绑和偏好设置等用户侧业务/安全接口必须只允许 `Active` 用户访问；即使用户持有旧会话 Cookie，只要账户状态不再是 `Active`，后端也必须拒绝这些操作。
- 管理员审核通过后，账户进入可用状态。
- 管理员拒绝后，需要展示拒绝原因和重新提交入口；用户可在受限账户页补充审核信息并重新进入待审核状态。
- 如果用户能通过服务器账户验证，可免管理员审核完成注册。
- 服务器账户验证注册成功后，网站应为当前浏览器创建登录会话并进入钱包；旧的已验证 challenge 不能被反复用于创建新会话。
- 服务器账户验证时，用户需要提供自己的服务器 ID。
- 网站生成一次性验证码并展示给用户，验证码必须带有明确前缀，例如 `LDPASS-123456`。
- 用户需要进入服务器聊天并输入完整的带前缀验证码。
- 服务器侧组件监听聊天消息，将验证结果回传给网站。
- 如果用户在服务器聊天中发送了其他内容，当前验证码应立即失效并刷新，避免旧验证码被继续尝试或泄露。
- 验证码需要设置有效期、刷新次数限制、失败次数限制和冷却时间。
- 当前服务器聊天可通过 BDSLM WebChat 接口轮询获取，详见“8.4 服务器聊天验证接入”。
- 第一阶段登录方式优先使用用户名，邮箱作为备选登录方式。
- 用户实名与手机号验证不是第一阶段必需能力。
- 需要支持登录设备管理，用于登录安全、敏感操作确认和异常设备提醒。
- 登录设备上限按操作系统区分；一个用户在每种操作系统下最多保留 2 台活动登录设备，超出时自动下线同系统最早登录的设备。
- 新设备登录需要通过服务器账户验证，或由已登录设备确认。
- 服务器账户验证成功后允许换绑服务器 ID。
- 服务器 ID 换绑后，该用户其余设备需要全部退出登录。
- 支持外部添加卡券场景下的登录后回跳；站内继续操作使用 `next` 参数，且只接受同站相对路径。
- 支持第三方系统通过安全链接引导用户登录。
- 支持登录态过期后的继续操作恢复。
- 敏感操作需要二次验证或短时确认，第一阶段支持服务器账户验证或输入 PIN。
- PIN 重置以服务器账户验证为主，允许管理员介入。

#### 7.1.2 卡包首页

- 展示用户持有的全部卡券。
- 第一阶段支持分类：账户/卡、证件/钥匙、票券。
- 自动扣费分类后续再开放，但导航与数据模型可以预留扩展位。
- 支持搜索、添加、编辑、用户入口。
- 支持桌面端三栏布局：分类、卡片堆叠、详情。
- 支持移动端单栏布局：顶部工具栏、卡片堆叠、详情抽屉或新页面。
- 卡片可显示名称、发卡方、卡号末四个字符、余额、状态、有效期、关键标签。

#### 7.1.3 添加卡券

- 用户可通过站内添加入口添加卡券。
- 用户可通过外部链接添加卡券。
- 用户可通过扫描二维码添加卡券。
- 添加卡券链接/二维码必须由已登录用户领取。
- `/add` 只作为添加卡券入口，普通用户只能通过领取码或添加链接领取卡券，即使 URL 带有 `cardNumber` 也不启用核销能力。发卡方现场核销使用独立的 `/provider/redemptions` 页面，只按已领取卡片的完整卡号定位并发起核销；领取码和添加链接不再作为核销定位凭据。
- 提供方可以配置领取限制，例如仅允许已完成服务器账户验证的用户领取。
- 添加前应展示卡券来源、提供方、需要授权的信息与有效期；第一版通过 `GET /wallet/add-tokens/preview` 展示提供方、卡券标题或标题隐藏状态、权益类型、初始值、领取有效期、卡券有效期、背景图预览和服务器账号限制。
- 添加成功后跳转到卡券详情或卡包首页。
- 添加失败应展示可理解的原因，例如链接过期、已添加、无权限、提供方暂停发放。

#### 7.1.4 卡券详情

- 展示卡面与关键字段。
- 卡面标题允许由模板配置为显示或隐藏。
- 展示金额、积分、次数三类余额/权益。
- 票券类展示时间、地点、座位、编号、入场说明等票据字段。
- 证件/钥匙类需要支持核验能力。
- 证件/钥匙类核验第一阶段至少包含服务器账户验证与玩家位置范围验证。
- 位置核验不区分维度。
- 位置范围由提供方自行配置，并与卡券其他信息一起提交管理员审批，且支持多个位置范围；第一阶段规则为命中任意一个范围即视为通过。
- 位置数据有效期为 1 分钟。
- 展示发卡方信息、服务说明和审核通过的介绍链接。
- 展示使用记录。
- 支持删除、隐藏或归档卡券。
- 支持查看敏感字段，但需要隐私保护。
- 卡片详情、发卡方、充值、选择来源卡、发起核销、待确认核销、交易记录、争议记录、提交争议和转赠应优先通过弹窗展示；关闭弹窗后回到当前卡券详情，避免主详情面板继续堆叠复杂表单。额度补充请求记录应合并到交易记录弹窗中展示，不再作为充值弹窗里的独立历史列表。

#### 7.1.5 确认使用/核销

- 使用前展示本次将消耗的余额或权益。
- 展示提供方、备注、卡券来源、预计余额变化。
- 支持用户取消。
- 第一阶段核验方式优先支持服务器账户验证与 PIN。
- 服务器账户验证用于敏感操作时，必须为本次操作重新生成聊天验证码；不能只因为用户曾经绑定过服务器账号就直接通过。
- “按下验证按钮确认你是某某用户”、动态方向码、NFC/近场核验等短期内不考虑。
- 重试规则由提供方配置；第一版支持配置最大验证尝试次数，PIN 错误会累计失败次数，次数耗尽后请求失败且不能继续确认。
- 核销有效期由提供方配置，默认 2 分钟。
- 成功后展示结果凭证。
- 失败后展示失败原因、错误码、可重试建议。

#### 7.1.6 自动扣费/自动权益扣减

自动扣费/自动权益扣减不进入第一阶段，以下为后续需求预留：

- 用户必须主动授权。
- 授权页需要说明提供方、规则、上限、周期、取消方式。
- 用户可随时查看和取消授权。
- 每次自动扣减都要形成记录。
- 异常扣减需要可申诉或可标记。

### 7.2 提供方后台

#### 7.2.1 提供方入驻

- 提供方可以由管理员手动创建。
- 提供方也可以开放注册，但注册后必须经管理员审批。
- 提供方提交名称、标识、联系人、业务说明、品牌素材。
- 管理员审核后启用。
- 提供方启用后的名称、头像图床链接、介绍链接、联系人、联系邮箱、业务说明等资料变更必须提交管理员审批；审批通过前仍展示和使用旧资料。发卡方头像可以留空；如填写，必须是 HTTPS 图片链接，且仅允许 `png`、`jpg`、`jpeg`、`webp`、`gif` 或 `avif` 后缀；介绍链接可以留空，如填写必须是 HTTPS URL。
- 发卡方新增、轮换、停用 API 密钥都属于外部集成配置变化，必须提交管理员审批；审批通过前不能调用开放 API、不能下发新明文密钥，也不能停用旧密钥。
- 发卡方创建、修改、启停、删除 Webhook 回调端点以及轮换签名密钥都属于外部集成配置变化，必须提交管理员审批；审批通过前不能创建可投递端点、改写正式端点配置、删除端点或下发新签名密钥。
- 第一阶段不考虑提供方多门店、多操作员、多角色权限。

#### 7.2.2 卡券模板管理

- 创建卡券模板。
- 配置卡面样式、字段、分类、有效期、状态规则。
- 平台提供固定卡面模板，并提供多种变体。
- 卡面模板变体预留增删接口，方便后续按业务增补账户卡、积分卡、次数卡、证件/钥匙、票券等变体。
- 卡面标题、字段可见性、背景图预览应纳入模板配置与审核范围；所有创建模板、模板审核、添加卡片和操作链接里的卡面预览应与钱包首页卡片布局一致，卡面内只保留卡面视觉与卡号末四个字符占位，标题、发卡方、Logo、类型、余额、规则说明等信息移到卡片外的信息区。
- 第一阶段配置可用权益类型：金额、积分、次数。
- 展示名称允许模板自定义，例如“余额”“积分”“剩余次数”“可用餐次”。
- 金额类权益不显示货币符号。
- 一张卡券第一阶段只允许配置一种权益类型。
- 发行方可配置转赠、共享、冻结额度、透支额度、积分过期、次数过期等规则。
- 发行方每次修改卡券规则都需要重新提交管理员审批。
- 发行方可以关闭转赠功能。
- 开启转赠后，转赠需要接收方确认。
- 透支状态允许在用户界面显示为负数。
- 发放时需要区分领取码有效期和卡券自身有效期；卡券自身有效期写入 `Pass.expiresAt`，不设置则长期有效。
- 积分/次数过期前可以提醒用户，提醒时间由用户自行设置，默认提前 7 天。
- 票券类配置票面字段，例如时间、地点、座位、场次、检票状态、入场说明、票号、改签/取消规则。
- 证件/钥匙类配置核验规则，例如需要服务器账户验证、玩家位置范围验证；位置规则需要支持多个圆形或矩形范围。第一版发卡方模板页已提供多位置编辑器，最多配置 10 个范围，命中任意范围即通过。
- 第一阶段配置使用方式：服务器账户验证、PIN。
- 商户扫码、用户出示码后续再开放。
- 系统自动扣减后续再开放。
- 模板变更需要版本化，避免影响已发放卡券的历史记录。
- 发卡方生成或提交模板时应提供统一卡面预览，管理员审核模板时也应看到含背景图的卡面预览；管理员后台还应能随时查看已经过审的模板版本，不只显示待审核模板。

#### 7.2.3 发放与同步

- 单个发放。
- 批量发放。
- 第一阶段通过提供方后台发放；当前也已提供开放提供方 API 发放、查询、撤销和作废重发领取码。
- 生成添加链接或二维码。
- 添加链接/二维码必须由已登录用户领取。
- 提供方可以配置领取限制，例如是否要求用户已完成服务器账户验证。
- 查询发放状态。
- 同步余额、状态、有效期、冻结等信息。
- 支持提供方调整金额、积分、次数，并生成余额/权益流水。

#### 7.2.4 核销与记录

- 提供方可发起核销请求。
- 提供方可验证用户出示的二维码/验证码。
- 提供方可查看核销记录。
- 需要支持幂等，避免重复扣减。
- 异常核销需要撤销或冲正机制。第一阶段已实现已完成核销冲正：追加 `refund` 流水、恢复权益、保留原消耗流水，并将核销请求标记为 `Reversed`。
- 卡券模板可配置允许核销方名单；默认仅允许原发卡方核销。被授权的其他发卡方可在 `/provider/redemptions` 按已领取卡片的 `publicNumber` 预览并发起核销，后端必须同时校验卡券状态、持卡用户、模板授权名单和幂等键。

### 7.3 管理员后台

#### 7.3.1 审核治理

- 审核普通用户注册申请。
- 查看注册申请中的用户名、邮箱、审核信息、注册 IP、IP 省/州级属地。
- 通过或拒绝普通用户注册申请。
- 拒绝注册申请时需要填写原因。
- 审核开放注册的提供方。
- 审核提供方入驻。
- 审核卡券模板及其所有信息。
- 审核品牌素材。
- 审核卡面颜色、Logo、字段、背景图片、图床链接。
- 所有卡券可见信息必须管理员手动审批通过后才能发布。
- 敏感词审核第一阶段可以不做，但保留后续扩展位。
- 冻结异常提供方或卡券模板。

#### 7.3.2 查询与处置

- 查询用户、提供方、卡券、发放记录、核销记录。
- 查看事件日志与接口调用日志。
- 标记风险记录。
- 管理员可以封禁、解封和删除用户账户；封禁或删除后必须撤销相关会话，并写入不可变审计记录。
- 用户删除建议第一阶段采用软删除，保留卡券、流水、争议和审计引用，避免破坏历史追溯。
- 手动冻结/解冻卡券。
- 手动修改用户余额/权益，但必须记录原因并经过受控审批。
- 处理争议或误发放记录。

#### 7.3.3 管理员余额/权益调整审批

管理员手动修改用户余额或权益属于高风险操作，建议第一阶段采用以下规则：

- 发起人必须填写调整原因、关联对象、调整前后值、凭据说明。
- 系统自动生成预览，不直接写入余额。
- 第一阶段暂不考虑双人审批。
- 管理员执行调整前必须通过 PIN 或服务器账户验证二次确认。
- 执行后必须生成余额/权益流水、审计事件和管理员操作日志。
- 调整记录不可物理删除，只能标记作废或通过反向调整纠正。
- 如果调整引发争议，进入争议记录流程。

#### 7.3.4 争议记录

- 争议记录需要状态流转。
- 建议状态：`Submitted`、`InReview`、`NeedMoreInfo`、`Approved`、`Rejected`、`Reversed`、`Closed`。
- 争议可关联用户、提供方、卡券、余额/权益流水、核销记录、管理员调整记录和额度补充请求；额度补充争议使用 `subjectType=pass_top_up` 与补充 ID 关联。
- 管理员处理核销请求或额度补充争议时，可以在争议页输入冲正原因和管理员 PIN，调用对应冲正能力后把争议标记为 `Reversed`；不能只把可冲正争议状态改成 `Reversed` 而不执行冲正。
- 普通卡券、流水和管理员调整争议不直接触发账务反转，管理员只能按状态机推进处理结论；`NeedMoreInfo`、`Approved`、`Rejected`、`Closed` 必须填写处理备注，`Reversed` 必须由实际冲正动作确认后写入。
- 用户提交争议时，后端必须校验核销请求、额度补充请求、流水或管理员调整记录确实属于当前用户持有的卡券，避免构造其他对象 ID 发起争议。
- 每次状态变化都需要记录处理人、原因、时间和备注。

#### 7.3.5 系统配置

- 配置卡券分类。
- 配置敏感词与替换建议。
- 配置对外 API 开关、限流、密钥策略。
- 配置全站公告和维护状态。
- 第一阶段已实现 `/admin/platform` 管理全站公告和维护状态，公开接口 `/api/platform/status` 可被未登录用户读取，页面顶部会显示平台横幅。
- 维护服务条款和隐私政策。提供方协议第一阶段先去掉；若代码中保留历史 key，只能作为后续预留能力，产品入口、公开页面和管理员维护入口都不展示。

## 8. 对外访问与开放能力

### 8.1 外部登录入口

外部系统可以把用户引导到临东通登录页，登录完成后回跳到指定业务动作，例如添加卡券、确认授权、查看卡券详情。

第一阶段优先把登录验证能力做成可复用模块，供临东通和其他项目接入。它不应依赖卡包业务模块，只负责用户身份、会话、授权回跳与登录状态校验。

当前部署与接入前提：

- 临东通部署在三级域名上。
- 当前接入项目共享同一个二级域名。
- 第一阶段优先使用自定义登录回跳 + 会话校验。
- 未来如出现跨二级域名或第三方开放接入，再升级为标准 OIDC。

需要支持：

- `redirect_uri`
- `state`
- `client_id`
- 登录后继续动作
- 链接过期处理
- 防伪造校验
- 会话校验接口
- 退出登录后的全局或单项目会话清理

后续如果其他项目需要更标准的接入方式，可扩展为 OpenID Connect 风格的授权服务。

### 8.2 添加卡券链接

添加卡券链接/二维码排在登录验证之后实现。提供方可以在后台生成添加卡券链接或二维码，用户打开后如未登录，先进入登录流程，登录成功后回到添加卡券确认页。站内添加场景使用 `/login?next=/add?...` 保存继续动作，`next` 必须是同站相对路径，不能接受完整 URL 或协议相对 URL。添加页应先调用预览接口读取真实卡券来源、权益和限制，再让用户确认领取。二维码必须在站内本地生成，不能把领取码发送给第三方二维码图片服务。

完整领取码原则上只在生成成功时展示一次。数据库应保存领取码哈希，后续后台列表只展示尾号、状态、领取人和过期时间；如果完整码丢失，应作废旧码并重新生成，而不是明文找回。当前管理员 `/admin/add-pass-token` 和发卡方 `/provider/issue` 已提供领取码列表、Active 领取码撤销能力，以及未领取领取码的作废并重发能力；重发只适用于仍关联未领取 `Issued` 卡券的领取码。

新生成的领取码必须保持 `LD-` 前缀，前缀后只由大写字母和数字组成。领取和预览接口不应把这条新生成规则作为强输入校验，因为测试期曾生成带连字符或下划线的历史码；旧码仍需要能按原哈希领取、撤销或作废重发。

领取码和卡号职责需要分开：领取码/添加链接是用户把实体卡添加进系统的凭证，可能过期、撤销或作废重发；卡号 `publicNumber` 是卡片稳定编号，用于实体卡印刷、人工核对、客服检索、争议和核销现场确认。生成或重发领取码时，后台应同时展示对应卡号，批量发放结果应能复制“卡号、掩码卡号、领取码、添加链接”的对应关系，避免实体卡制卡时无法对号。

链接应包含：

- 提供方标识
- 卡券模板标识
- 发放批次或领取令牌
- 有效期
- 签名
- 可选的外部用户标识

### 8.3 开放 API

开放 API 不作为第一阶段最早优先项，先完成登录验证、提供方后台发放、添加卡券链接/二维码。当前最小闭环已支持发卡方在 `/provider/api-keys` 提交 API 密钥创建、轮换和停用申请；管理员审核通过创建/轮换申请后，发卡方只能一次性查看新明文密钥；管理员审核通过停用申请后旧密钥才会失效。通过 `Authorization: Bearer <API 密钥>` 可调用开放发放接口：

- `POST /api/open/provider/issuing/add-pass-tokens`
- `POST /api/open/provider/issuing/add-pass-token-batches`
- `GET /api/open/provider/issuing/add-pass-tokens`
- `POST /api/open/provider/issuing/add-pass-tokens/:tokenId/revoke`
- `POST /api/open/provider/issuing/add-pass-tokens/:tokenId/reissue`
- `GET /api/open/provider/issuing/passes`
- `POST /api/open/provider/issuing/passes/:passId/adjust`
- `POST /api/open/provider/issuing/passes/:passId/freeze`
- `POST /api/open/provider/issuing/passes/:passId/unfreeze`
- `POST /api/open/provider/issuing/passes/:passId/archive`
- `POST /api/open/provider/issuing/passes/:passId/ticket`
- `POST /api/open/provider/action-links`
- `GET /api/open/provider/action-links`
- `POST /api/open/provider/action-links/:actionLinkId/revoke`
- `POST /api/open/provider/action-links/revoke-batch`
- `POST /api/open/provider/redemptions`
- `POST /api/open/provider/redemptions/:requestId/cancel`
- `POST /api/open/provider/redemptions/:requestId/reverse`
- `GET /api/open/provider/redemptions`

当前开放 API 支持外部系统发放领取码、批量发放、查询/撤销/作废并重发领取码、查询卡券、调整权益、冻结/解冻/归档卡券、提交票券字段变更申请、发起核销、取消待确认核销、冲正已完成核销、查询核销记录，以及生成、查询和撤销操作链接。外部系统可以通过 `add_pass_token:read` 读取本发卡方领取码列表，通过 `add_pass_token:revoke` 撤销仍可领取的码，通过 `add_pass_token:reissue` 对未领取且仍关联 `Issued` 卡券的码执行作废并重发；重发结果里的完整新码仍只展示一次。操作链接生成需要 `action_links:create`，查询需要 `action_links:read`，单条撤销和批量撤销需要 `action_links:revoke`。使用链接和补充链接的第一版规则为：用户打开短有效期 `/action?token=...` 链接后先看到预览，再确认；确认使用链接和额度补充链接都支持 PIN 或本次服务器聊天验证码。确认成功后才写入核销或额度补充流水，不能打开链接即直接扣减。补充链接会先创建 `PassTopUpRequest`，记录 `actionLinkId`，并在确认、取消、过期、失败和管理员冲正时进入对应状态。用户在钱包详情中主动进行卡内额度补充时，第一版支持 PIN 或服务器账号本次聊天验证码：PIN 路径成功后写入 `PinVerificationSucceeded(purpose: pass_top_up)`；服务器账号路径需要先生成 `LDPASS-` 前缀验证码，用户用绑定服务器 ID 发送完整验证码后再确认。发卡方后台和开放 API 均能按类型、状态和卡券范围筛选操作链接，并对仍为 `Active` 的链接执行单条撤销或批量撤销；完整链接只在生成结果中展示一次。操作链接过期状态由读取时检查和 API 后台定时清理任务共同兜底，避免长期保留可用状态的过期链接，等待中的补充请求会同步变为 `Expired`。已完成的额度补充第一版由管理员在 `/admin/passes` 按补充 ID 冲正，追加 `refund` 流水而不是删除原流水。

当前已补充发卡方 Webhook 最小闭环：发卡方在 `/provider/webhooks` 提交端点创建、修改、启停、删除或密钥轮换申请并选择事件，管理员在 `/admin/providers` 审核通过后才创建真实端点、应用修改、启停端点、软删除端点或写入新签名密钥。新增和轮换申请通过后，发卡方可一次性查看签名密钥；系统把领域事件写入 `OutboxEvent` 后只投递给未删除且已启用的端点，失败按指数退避重试，投递不会阻塞用户领取、核销或权益调整等主流程。

所有写操作必须具备：

- 身份认证：当前开放提供方 API 已通过 Bearer API 密钥和 scope 校验实现。
- 签名校验：当前开放提供方 API 写接口已通过 `X-LDPass-Signature` 实现 HMAC-SHA256 签名。
- 幂等键：当前开放提供方 API 写接口已通过 `X-LDPass-Idempotency-Key` 和 `OpenApiIdempotencyRecord` 实现成功响应复用。
- 请求时间戳：当前开放提供方 API 写接口已通过 `X-LDPass-Timestamp` 实现 5 分钟时间偏差校验。
- 速率限制：当前开放提供方 API 已按 API 密钥和 scope 使用固定窗口限制，默认每 60 秒 120 次，可通过 `OPEN_API_RATE_LIMIT_WINDOW_SECONDS` 和 `OPEN_API_RATE_LIMIT_MAX_REQUESTS` 调整。
- 审计日志：发放、权益调整和密钥生命周期变化已经进入领域事件审计。
- Webhook 签名：当前 Webhook 投递使用 `X-LDPass-Timestamp` 和原始 JSON 请求体计算 HMAC-SHA256，签名放在 `X-LDPass-Signature: v1=...`，签名密钥只在管理员通过创建申请或轮换申请后显示一次。

### 8.4 服务器聊天验证接入

服务器账户验证用于免管理员审核完成注册。当前可用聊天来源为 BDSLM WebChat 接口：

- 聊天拉取接口：`GET http://ld.cmsy.xyz:19136/api/chat/fetch`
- 增量拉取接口：`GET http://ld.cmsy.xyz:19136/api/chat/fetch?start=<messageId>`
- 玩家位置接口：`GET http://ld.cmsy.xyz:19136/api/getPlayerMarkers`
- 服务信息接口：`GET http://ld.cmsy.xyz:19136/api/info`
- 线上聊天前端脚本：`GET http://ld.cmsy.xyz:19136/unmined.webchat.js`
- 当前实测 `api/info` 返回：`BDSLM v0.3.4`
- 当前实测无新消息时，`api/chat/fetch` 返回空数组：`[]`
- 当前实测无在线玩家或无标记时，`api/getPlayerMarkers` 返回空数组：`[]`
- 当前实测 `unmined.webchat.js` 返回 `application/javascript`，其轮询逻辑可作为 Adapter 参考。

BDSLM 源码显示，`/api/chat/fetch` 行为如下：

- 不传 `start` 时返回当前缓存的全部聊天消息。
- 传 `start` 时返回从指定消息 ID 开始的后续消息。
- 聊天消息缓存约 10 分钟。
- 官方前端示例和线上 `unmined.webchat.js` 每 1 秒轮询一次，并使用 `start = lastid + 1` 增量获取消息。
- 前端脚本会把 `prefix`、`name`、`time`、`content` 拼接到聊天 DOM 中；临东通只借鉴拉取和增量游标策略，不复用其 DOM 拼接方式。

聊天消息结构草案：

```ts
export interface BdslmChatMessage {
  id: number;
  prefix?: string;
  name?: string;
  text?: string;
  time: [number, number, number, number, number, number];
  content?: string;
  message?: string;
  body?: string;
}
```

字段含义：

- `id`：BDSLM 内部递增消息 ID。
- `prefix`：服务器聊天前缀，可能包含 HTML。
- `name` / `text`：玩家显示名；临东通将其视为服务器 ID，后端 Adapter 会优先读取 `name`，没有时兼容 `text`。
- `time`：UTC 时间数组，格式为 `[year, month, day, hour, minute, second]`。
- `content` / `message` / `body`：聊天内容；后端 Adapter 会优先读取 `content`，没有时兼容其他常见字段名。

玩家位置结构草案：

```ts
export interface BdslmPlayerMarker {
  x: number;
  z: number;
  image: string;
  imageAnchor: [number, number];
  imageScale: number;
  text: string;
  textColor: string;
  offsetX: number;
  offsetY: number;
  font: string;
}
```

位置字段说明：

- `x`、`z`：玩家所在坐标，可用于范围核验。
- `text`：玩家显示名，源码中来自 `getName()`；临东通将其视为服务器 ID。
- 当前接口未返回维度、世界名、Y 坐标、XUID/UUID 等稳定身份字段。

临东通实现要求：

- 新增 `ServerChatAdapter`，由它负责轮询 BDSLM 接口，不让 Identity 模块直接依赖 BDSLM。
- 新增 `ServerPositionAdapter`，由它负责拉取玩家位置并判断是否在卡券模板配置的范围内。
- Adapter 只向 Identity 发出结构化事件，例如“观察到某玩家输入某内容”。
- Adapter 需要保存每个服务器的 `lastMessageId`，避免重复消费同一条消息。
- Adapter 启动时应从当前最新消息开始，避免把历史聊天误判为验证码。
- Adapter 建议以 `lastMessageId + 1` 方式轮询，默认轮询间隔可先参考线上脚本设为 1 秒，后续按服务器压力调整。
- 验证码匹配时必须同时匹配服务器 ID 与完整验证码内容；验证码内容必须包含平台前缀，例如 `LDPASS-123456`。
- 如果同一服务器 ID 在验证期间发送了非当前验证码内容，则触发验证码刷新。
- 验证成功后，验证码立即失效，避免同一条聊天消息被重复用于多个账号。
- 证件/钥匙类位置核验需要同时满足：用户已完成服务器账户验证、当前玩家位置在提供方配置范围内、位置数据未过期。
- 位置核验不区分维度。
- 位置数据有效期为 1 分钟。
- 位置范围由提供方自行配置，并与卡券其他信息一起送管理员审批。
- 位置范围建议支持多个圆形范围和矩形范围；第一阶段可采用命中任意范围即通过。
- 位置核验失败需要区分：玩家不在线、玩家位置未知、玩家不在范围内、服务器接口不可用。
- `prefix` 和 `content` 绝不能直接作为 HTML 渲染，后台查看时需要转义，避免跨站脚本风险。
- BDSLM 接口当前未体现鉴权能力，生产环境需要通过内网访问、反向代理鉴权、IP 白名单或网关签名保护。
- 第一阶段暂不支持多个 BDSLM 服务器，只接入当前服务器。

后续实现细化：

1. 轮询频率是否接受 1 秒；如果服务器压力较高，可以调整为 2-5 秒。
2. BDSLM 接口是否会跨重启重置消息 ID；如果会，Adapter 需要处理 ID 回绕。

## 9. 事件驱动设计

后端实现应采用事件驱动方式解耦。业务 Service 只负责核心数据操作，成功后通过 EventBus 发出事件；通知、审计、同步、风控等副作用由监听器处理。

### 9.1 事件列表

| 事件名                                   | 触发时机                               | 主要消费者                   |
| ---------------------------------------- | -------------------------------------- | ---------------------------- |
| `UserRegistrationSubmitted`              | 用户提交注册申请                       | 管理员审核、审计、风控       |
| `UserRegistrationApproved`               | 管理员审核通过注册申请                 | 通知、账户启用、审计         |
| `UserRegistrationRejected`               | 管理员拒绝注册申请                     | 通知、审计                   |
| `ServerVerificationCodeIssued`           | 服务器账户验证码生成                   | 审计、验证码展示             |
| `ServerVerificationCodeRotated`          | 用户在服务器聊天输入其他内容或触发刷新 | 审计、验证码更新             |
| `ServerAccountVerified`                  | 服务器账户验证成功                     | 账户启用、审计               |
| `ServerAccountRebound`                   | 用户通过服务器账户验证换绑服务器 ID    | 审计、会话与设备治理         |
| `DeviceLoginVerified`                    | 新设备登录通过服务器账户验证           | 审计、新设备登录确认         |
| `DeviceLoginApprovalRequested`           | 新设备登录等待已登录设备确认           | 审计、账户安全提醒           |
| `DeviceLoginApprovalApproved`            | 已登录设备批准新设备登录               | 审计、新设备登录确认         |
| `DeviceLoginApprovalRejected`            | 已登录设备拒绝新设备登录               | 审计、风控                   |
| `LoginDeviceRecorded`                    | 用户登录设备记录已更新                 | 审计、风控                   |
| `LoginDeviceSignedOut`                   | 登录设备被用户或系统下线               | 审计、会话治理               |
| `PinVerificationSucceeded`               | PIN 二次验证成功                       | 审计、敏感操作               |
| `UserRegistered`                         | 用户账户正式可用                       | 审计、欢迎通知               |
| `UserLoggedIn`                           | 用户登录成功                           | 审计、风控                   |
| `UserAccountDeleted`                     | 用户主动注销账户或管理员删除账户       | 审计、会话清理               |
| `UserSuspended`                          | 管理员封禁用户账户                     | 审计、会话清理、风控         |
| `UserUnsuspended`                        | 管理员解除用户封禁                     | 审计、账户恢复               |
| `UserDeletedByAdmin`                     | 管理员删除用户账户                     | 审计、会话清理、历史引用保留 |
| `UserPreferencesUpdated`                 | 用户修改账户偏好，例如过期提醒时间     | 审计、提醒调度               |
| `CredentialChanged`                      | 用户自助修改密码/PIN 或管理员重置密码  | 审计、账户安全               |
| `ProviderSubmitted`                      | 提供方提交或重新提交入驻申请           | 管理员审核、审计             |
| `ProviderCreatedByAdmin`                 | 管理员手动创建提供方                   | 审计、权限开通               |
| `ProviderAccountCreated`                 | 提供方入驻时创建负责人账号             | 审计、账号启用               |
| `ProviderApproved`                       | 提供方审核通过                         | 通知、权限开通               |
| `ProviderRejected`                       | 提供方审核拒绝                         | 通知、审计                   |
| `ProviderSuspended`                      | 管理员停用提供方                       | 权限收回、审计               |
| `ProviderUnsuspended`                    | 管理员恢复已停用提供方                 | 权限恢复、审计               |
| `ProviderArchived`                       | 管理员归档提供方                       | 权限收回、凭据停用、审计     |
| `ProviderLoggedIn`                       | 发卡方负责人登录成功                   | 审计、风控                   |
| `ProviderProfileChangeSubmitted`         | 发卡方提交资料变更申请                 | 管理员审核、审计             |
| `ProviderProfileChangeApproved`          | 管理员通过资料变更申请                 | 资料更新、审计               |
| `ProviderProfileChangeRejected`          | 管理员拒绝资料变更申请                 | 审计、反馈                   |
| `ProviderApiKeyCreateSubmitted`          | 发卡方提交 API 密钥创建申请            | 管理员审核、审计             |
| `ProviderApiKeyCreateApproved`           | 管理员通过 API 密钥创建申请            | 创建密钥、审计               |
| `ProviderApiKeyCreateRejected`           | 管理员拒绝 API 密钥创建申请            | 审计、反馈                   |
| `ProviderApiKeyCreated`                  | 发卡方创建开放 API 密钥                | 审计、开放接入治理           |
| `ProviderApiKeySecretClaimed`            | 发卡方一次性查看已通过申请的明文密钥   | 审计、密钥交付               |
| `ProviderApiKeyRotated`                  | 发卡方轮换开放 API 密钥                | 审计、密钥泄漏响应           |
| `ProviderApiKeyRevoked`                  | 发卡方停用开放 API 密钥                | 审计、权限收回               |
| `ProviderWebhookEndpointCreateSubmitted` | 发卡方提交 Webhook 端点创建申请        | 管理员审核、审计             |
| `ProviderWebhookEndpointCreateApproved`  | 管理员通过 Webhook 端点创建申请        | 创建端点、审计               |
| `ProviderWebhookEndpointCreateRejected`  | 管理员拒绝 Webhook 端点创建申请        | 审计、反馈                   |
| `ProviderWebhookChangeSubmitted`         | 发卡方提交 Webhook 配置变更申请        | 管理员审核、审计             |
| `ProviderWebhookChangeApproved`          | 管理员通过 Webhook 配置变更申请        | 应用配置、审计               |
| `ProviderWebhookChangeRejected`          | 管理员拒绝 Webhook 配置变更申请        | 审计、反馈                   |
| `ProviderWebhookEndpointCreated`         | Webhook 回调端点正式创建               | 审计、开放接入治理           |
| `ProviderWebhookSecretClaimed`           | 发卡方一次性查看已通过端点的签名密钥   | 审计、密钥交付               |
| `ProviderWebhookEndpointUpdated`         | 管理员审批后应用 Webhook 回调端点修改  | 审计、开放接入治理           |
| `ProviderWebhookSecretRotated`           | 管理员审批后轮换 Webhook 签名密钥      | 审计、密钥泄漏响应           |
| `ProviderWebhookEndpointDeleted`         | 管理员审批后软删除 Webhook 回调端点    | 审计、权限收回               |
| `ProviderWebhookDeliveryRetryRequested`  | 发卡方手动重新排队 Webhook 投递        | 审计、开放接入治理           |
| `ClientApplicationCreated`               | 管理员登记外部接入应用                 | 审计、开放接入治理           |
| `ClientApplicationUpdated`               | 管理员修改外部接入应用白名单或启用状态 | 审计、开放接入治理           |
| `PassTemplateCreated`                    | 卡券模板创建成功                       | 审计、审核队列               |
| `PassTemplateUpdateSubmitted`            | 发卡方提交卡券模板新版本               | 审计、审核队列               |
| `PassTemplateApproved`                   | 卡券模板审核通过                       | 通知、发放开关               |
| `PassTemplateRejected`                   | 卡券模板或卡券信息审核拒绝             | 通知、审计                   |
| `PassIssued`                             | 卡券发放成功                           | 通知、外部同步               |
| `PassAddedToWallet`                      | 用户添加卡券成功                       | 审计、推荐排序               |
| `AddPassTokenRevoked`                    | 领取码被撤销                           | 审计、外部同步               |
| `AddPassTokenReissued`                   | 领取码作废并重发                       | 审计、外部同步               |
| `WalletActionLinkCreated`                | 操作链接已生成                         | 审计、外部同步               |
| `WalletActionLinkConsumed`               | 操作链接已被用户确认使用               | 审计、外部同步               |
| `WalletActionLinkExpired`                | 操作链接已过期                         | 审计、外部同步               |
| `WalletActionLinkRevoked`                | 操作链接被撤销                         | 审计、外部同步               |
| `PassTransferRequested`                  | 用户发起卡券转赠                       | 审计、外部同步               |
| `PassTransferAccepted`                   | 接收方接受卡券转赠                     | 审计、外部同步               |
| `PassTransferRejected`                   | 接收方拒绝卡券转赠                     | 审计、外部同步               |
| `PassTransferCancelled`                  | 发起方取消卡券转赠                     | 审计、外部同步               |
| `PassOrderUpdated`                       | 用户调整钱包卡券顺序                   | 审计、排序同步               |
| `PassBalanceChanged`                     | 卡券余额/权益变化                      | 记录、通知、风控             |
| `PassTicketUpdateSubmitted`              | 发卡方提交票券字段变更申请             | 管理员审核、审计、外部同步   |
| `PassTicketUpdateApproved`               | 管理员通过票券字段变更申请             | 审计、外部同步               |
| `PassTicketUpdateRejected`               | 管理员拒绝票券字段变更申请             | 审计、外部同步               |
| `PassTicketStatusUpdated`                | 票券字段审核通过并已写入卡券           | 用户展示、审计、外部同步     |
| `PassExpirationReminderCreated`          | 系统为临期积分/次数卡券生成站内提醒    | 审计、提醒展示               |
| `UserNotificationRead`                   | 用户将站内提醒标记为已读               | 审计、提醒状态               |
| `AdminBalanceAdjustmentRequested`        | 管理员发起余额/权益调整                | 审批、审计                   |
| `AdminBalanceAdjustmentApproved`         | 管理员调整审批通过                     | 执行调整、审计               |
| `DisputeStatusChanged`                   | 争议状态变化                           | 审计、通知                   |
| `ServerLocationVerified`                 | 服务器位置范围核验成功                 | 核销、审计                   |
| `PassUseRequested`                       | 用户或提供方发起使用请求               | 风控、核验                   |
| `PassUseSucceeded`                       | 使用/核销成功                          | 记录、通知、外部同步         |
| `PassUseReversed`                        | 已完成使用/核销被冲正                  | 审计、外部同步、争议处理     |
| `PassUseFailed`                          | 使用/核销失败                          | 记录、告警、用户提示         |
| `PassUseCancelled`                       | 提供方取消待确认核销                   | 审计、外部同步               |
| `PassTopUpRequested`                     | 用户发起卡内额度补充请求               | 风控、核验                   |
| `PassTopUpSucceeded`                     | 来源卡消耗并成功补充目标卡             | 记录、通知、外部同步         |
| `PassTopUpFailed`                        | 卡内额度补充失败                       | 记录、用户提示               |
| `PassTopUpExpired`                       | 等待验证的额度补充请求过期             | 审计、用户提示               |
| `PassTopUpCancelled`                     | 用户取消等待验证的额度补充请求         | 审计、用户提示               |
| `PassTopUpReversed`                      | 已完成额度补充被冲正                   | 审计、外部同步、争议处理     |
| `AutoDeductionAuthorized`                | 用户授权自动扣减                       | 审计、提醒                   |
| `AutoDeductionCancelled`                 | 用户取消自动扣减                       | 审计、外部同步               |
| `PassFrozen`                             | 卡券被冻结                             | 通知、风控                   |
| `PassUnfrozen`                           | 卡券被解冻                             | 审计、恢复使用               |
| `PassDeleted`                            | 用户删除或归档卡券                     | 审计、排序清理               |
| `PlatformStatusUpdated`                  | 管理员更新全站公告或维护状态           | 审计、前端平台横幅刷新       |
| `PlatformThemeScheduleUpdated`           | 管理员更新主题色自动切换计划           | 审计、前端配置刷新           |
| `LegalDocumentUpdated`                   | 管理员更新服务条款或隐私政策           | 审计、公开协议页刷新         |
| `StorageAlertRaised`                     | 系统检测到剩余存储空间低于阈值         | 管理员提醒、审计             |
| `StorageAlertResolved`                   | 系统检测到活动存储告警已恢复           | 管理员提醒、审计             |

### 9.2 TypeScript Event Schema 草案

```ts
export interface BaseEvent {
  eventId: string;
  occurredAt: string;
  actorType: 'user' | 'provider' | 'admin' | 'system';
  actorId: string;
  traceId?: string;
}

export type UserStatus =
  | 'Draft'
  | 'PendingReview'
  | 'Rejected'
  | 'WaitingServerVerification'
  | 'CodeRotated'
  | 'Verified'
  | 'Approved'
  | 'Active'
  | 'Failed'
  | 'Suspended'
  | 'Deleted';

export type ProviderStatus = 'PendingReview' | 'Rejected' | 'Active' | 'Suspended' | 'Archived';

export type PassTopUpStatus =
  | 'Created'
  | 'WaitingVerification'
  | 'Succeeded'
  | 'Failed'
  | 'Cancelled'
  | 'Expired'
  | 'Reversed';

export interface UserRegistrationSubmitted extends BaseEvent {
  type: 'UserRegistrationSubmitted';
  payload: {
    userId: string;
    username: string;
    email: string;
    reviewInfo: string;
    registrationIp: string;
    ipRegion?: {
      country?: string;
      provinceOrState?: string;
      city?: string;
      source: string;
    };
    reviewMode: 'admin_review' | 'server_account_verification';
    resubmitted?: boolean;
    previousStatus?: UserStatus;
  };
}

export interface UserRegistrationApproved extends BaseEvent {
  type: 'UserRegistrationApproved';
  payload: {
    userId: string;
    approvedBy: string;
  };
}

export interface UserRegistrationRejected extends BaseEvent {
  type: 'UserRegistrationRejected';
  payload: {
    userId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ServerVerificationCodeIssued extends BaseEvent {
  type: 'ServerVerificationCodeIssued';
  payload: {
    userId: string;
    serverId: string;
    verificationId: string;
    expiresAt: string;
    purpose?: 'registration' | 'login_device' | 'server_account_rebind' | 'pass_use';
  };
}

export interface ServerVerificationCodeRotated extends BaseEvent {
  type: 'ServerVerificationCodeRotated';
  payload: {
    userId: string;
    serverId: string;
    verificationId: string;
    previousVerificationId: string;
    reason: 'chat_mismatch' | 'manual_refresh' | 'expired' | 'rate_limit_retry';
    purpose?: 'registration' | 'login_device' | 'server_account_rebind' | 'pass_use';
  };
}

export interface ServerAccountVerified extends BaseEvent {
  type: 'ServerAccountVerified';
  payload: {
    userId: string;
    serverId: string;
    verificationId: string;
  };
}

export interface ServerAccountRebound extends BaseEvent {
  type: 'ServerAccountRebound';
  payload: {
    userId: string;
    previousServerId: string;
    nextServerId: string;
    revokedDeviceIds: string[];
  };
}

export interface DeviceLoginVerified extends BaseEvent {
  type: 'DeviceLoginVerified';
  payload: {
    userId: string;
    deviceId: string;
    serverId: string;
    verificationId: string;
  };
}

export interface DeviceLoginApprovalRequested extends BaseEvent {
  type: 'DeviceLoginApprovalRequested';
  payload: {
    approvalId: string;
    userId: string;
    deviceSystem: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'other';
    deviceLabel?: string;
    expiresAt: string;
  };
}

export interface DeviceLoginApprovalApproved extends BaseEvent {
  type: 'DeviceLoginApprovalApproved';
  payload: {
    approvalId: string;
    userId: string;
    approvedBy: string;
  };
}

export interface DeviceLoginApprovalRejected extends BaseEvent {
  type: 'DeviceLoginApprovalRejected';
  payload: {
    approvalId: string;
    userId: string;
    rejectedBy: string;
  };
}

export interface LoginDeviceRecorded extends BaseEvent {
  type: 'LoginDeviceRecorded';
  payload: {
    userId: string;
    deviceId: string;
    deviceSystem: DeviceSystem;
    deviceLabel?: string;
    lastLoginIp?: string;
    lastLoginIpRegion?: IpRegion;
    lastLoginAt: string;
    isNew: boolean;
    replacedDeviceId?: string;
  };
}

export interface LoginDeviceSignedOut extends BaseEvent {
  type: 'LoginDeviceSignedOut';
  payload: {
    userId: string;
    deviceId: string;
    reason: 'device_limit' | 'user_revoked' | 'admin_revoked';
    replacedByDeviceId?: string;
  };
}

export interface PinVerificationSucceeded extends BaseEvent {
  type: 'PinVerificationSucceeded';
  payload: {
    userId: string;
    challengeId: string;
    purpose: 'login' | 'sensitive_action' | 'admin_adjustment' | 'pass_use';
  };
}

export interface UserRegistered extends BaseEvent {
  type: 'UserRegistered';
  payload: {
    userId: string;
    loginIdentifierType: 'phone' | 'email' | 'username';
    registrationPath: 'admin_approved' | 'server_account_verified';
  };
}

export interface UserLoggedIn extends BaseEvent {
  type: 'UserLoggedIn';
  payload: {
    userId: string;
    deviceId?: string;
    clientId?: string;
    accountStatus?: UserStatus;
    restricted?: boolean;
  };
}

export interface UserAccountDeleted extends BaseEvent {
  type: 'UserAccountDeleted';
  payload: {
    userId: string;
    reason: 'self_requested' | 'admin_removed';
  };
}

export interface UserSuspended extends BaseEvent {
  type: 'UserSuspended';
  payload: {
    userId: string;
    suspendedBy: string;
    reason: string;
  };
}

export interface UserUnsuspended extends BaseEvent {
  type: 'UserUnsuspended';
  payload: {
    userId: string;
    unsuspendedBy: string;
    reason: string;
  };
}

export interface UserDeletedByAdmin extends BaseEvent {
  type: 'UserDeletedByAdmin';
  payload: {
    userId: string;
    deletedBy: string;
    reason: string;
    deletionMode: 'soft_delete';
  };
}

export interface ProviderSubmitted extends BaseEvent {
  type: 'ProviderSubmitted';
  payload: {
    providerId: string;
    source: 'admin_created' | 'open_registration';
    resubmitted?: boolean;
    previousStatus?: ProviderStatus;
  };
}

export interface ProviderAccountCreated extends BaseEvent {
  type: 'ProviderAccountCreated';
  payload: {
    providerId: string;
    providerAccountId: string;
    email: string;
  };
}

export interface ProviderApproved extends BaseEvent {
  type: 'ProviderApproved';
  payload: {
    providerId: string;
    approvedBy: string;
  };
}

export interface ProviderRejected extends BaseEvent {
  type: 'ProviderRejected';
  payload: {
    providerId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ProviderSuspended extends BaseEvent {
  type: 'ProviderSuspended';
  payload: {
    providerId: string;
    suspendedBy: string;
    reason: string;
  };
}

export interface ProviderUnsuspended extends BaseEvent {
  type: 'ProviderUnsuspended';
  payload: {
    providerId: string;
    unsuspendedBy: string;
    reason: string;
  };
}

export interface ProviderArchived extends BaseEvent {
  type: 'ProviderArchived';
  payload: {
    providerId: string;
    archivedBy: string;
    reason: string;
    archivedAccountCount: number;
    revokedApiKeyCount: number;
    disabledWebhookEndpointCount: number;
  };
}

export interface ProviderLoggedIn extends BaseEvent {
  type: 'ProviderLoggedIn';
  payload: {
    providerId: string;
    providerAccountId: string;
  };
}

export interface ProviderApiKeyCreateSubmitted extends BaseEvent {
  type: 'ProviderApiKeyCreateSubmitted';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    requestedBy: string;
    scopes: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyCreateApproved extends BaseEvent {
  type: 'ProviderApiKeyCreateApproved';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    apiKeyId: string;
    approvedBy: string;
    scopes: ProviderApiKeyScope[];
  };
}

export interface ProviderApiKeyCreateRejected extends BaseEvent {
  type: 'ProviderApiKeyCreateRejected';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ProviderApiKeySecretClaimed extends BaseEvent {
  type: 'ProviderApiKeySecretClaimed';
  payload: {
    providerId: string;
    apiKeyChangeRequestId: string;
    apiKeyId: string;
    claimedBy: string;
  };
}

export interface ProviderWebhookEndpointCreateSubmitted extends BaseEvent {
  type: 'ProviderWebhookEndpointCreateSubmitted';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    requestedBy: string;
    eventTypes: string[];
  };
}

export interface ProviderWebhookEndpointCreateApproved extends BaseEvent {
  type: 'ProviderWebhookEndpointCreateApproved';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    endpointId: string;
    approvedBy: string;
    eventTypes: string[];
  };
}

export interface ProviderWebhookEndpointCreateRejected extends BaseEvent {
  type: 'ProviderWebhookEndpointCreateRejected';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface ProviderWebhookChangeSubmitted extends BaseEvent {
  type: 'ProviderWebhookChangeSubmitted';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    kind: 'CreateEndpoint' | 'UpdateEndpoint' | 'RotateSecret' | 'DeleteEndpoint';
    requestedBy: string;
    status: 'PendingReview';
    endpointId?: string;
    eventTypes?: string[];
    enabled?: boolean;
  };
}

export interface ProviderWebhookChangeApproved extends BaseEvent {
  type: 'ProviderWebhookChangeApproved';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    kind: 'CreateEndpoint' | 'UpdateEndpoint' | 'RotateSecret' | 'DeleteEndpoint';
    approvedBy: string;
    endpointId?: string;
    eventTypes?: string[];
    enabled?: boolean;
  };
}

export interface ProviderWebhookChangeRejected extends BaseEvent {
  type: 'ProviderWebhookChangeRejected';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    kind: 'CreateEndpoint' | 'UpdateEndpoint' | 'RotateSecret' | 'DeleteEndpoint';
    rejectedBy: string;
    reason: string;
    endpointId?: string;
  };
}

export interface ProviderWebhookEndpointCreated extends BaseEvent {
  type: 'ProviderWebhookEndpointCreated';
  payload: {
    providerId: string;
    endpointId: string;
    createdBy: string;
    eventTypes: string[];
  };
}

export interface ProviderWebhookSecretClaimed extends BaseEvent {
  type: 'ProviderWebhookSecretClaimed';
  payload: {
    providerId: string;
    webhookChangeRequestId: string;
    endpointId: string;
    claimedBy: string;
  };
}

export interface ProviderWebhookEndpointUpdated extends BaseEvent {
  type: 'ProviderWebhookEndpointUpdated';
  payload: {
    providerId: string;
    endpointId: string;
    updatedBy: string;
    enabled: boolean;
    eventTypes: string[];
  };
}

export interface ProviderWebhookSecretRotated extends BaseEvent {
  type: 'ProviderWebhookSecretRotated';
  payload: {
    providerId: string;
    endpointId: string;
    rotatedBy: string;
  };
}

export interface ProviderWebhookEndpointDeleted extends BaseEvent {
  type: 'ProviderWebhookEndpointDeleted';
  payload: {
    providerId: string;
    endpointId: string;
    deletedBy: string;
  };
}

export interface ProviderWebhookDeliveryRetryRequested extends BaseEvent {
  type: 'ProviderWebhookDeliveryRetryRequested';
  payload: {
    providerId: string;
    endpointId: string;
    deliveryId: string;
    requestedBy: string;
  };
}

export interface ClientApplicationCreated extends BaseEvent {
  type: 'ClientApplicationCreated';
  payload: {
    clientApplicationId: string;
    clientId: string;
    name: string;
    createdBy: string;
  };
}

export interface ClientApplicationUpdated extends BaseEvent {
  type: 'ClientApplicationUpdated';
  payload: {
    clientApplicationId: string;
    clientId: string;
    name: string;
    enabled: boolean;
    updatedBy: string;
  };
}

export interface PassTemplateCreated extends BaseEvent {
  type: 'PassTemplateCreated';
  payload: {
    providerId: string;
    templateId: string;
    category: 'account' | 'identity' | 'ticket' | 'auto_deduction' | 'membership' | 'coupon';
    version: number;
  };
}

export interface PassTemplateUpdateSubmitted extends BaseEvent {
  type: 'PassTemplateUpdateSubmitted';
  payload: {
    providerId: string;
    templateId: string;
    category: PassCategory;
    benefitType: BenefitType;
    version: number;
  };
}

export interface PassTemplateRejected extends BaseEvent {
  type: 'PassTemplateRejected';
  payload: {
    providerId: string;
    templateId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface PassIssued extends BaseEvent {
  type: 'PassIssued';
  payload: {
    providerId: string;
    templateId: string;
    passId: string;
    externalUserId?: string;
    issueBatchId?: string;
  };
}

export interface PassAddedToWallet extends BaseEvent {
  type: 'PassAddedToWallet';
  payload: {
    userId: string;
    passId: string;
    source: 'manual' | 'link' | 'qr_code' | 'api';
  };
}

export interface PassOrderUpdated extends BaseEvent {
  type: 'PassOrderUpdated';
  payload: {
    userId: string;
    passIds: string[];
  };
}

export interface PassBalanceChanged extends BaseEvent {
  type: 'PassBalanceChanged';
  payload: {
    passId: string;
    providerId: string;
    balanceType: 'amount' | 'points' | 'times' | 'rooms' | 'custom';
    beforeValue: string;
    afterValue: string;
    changeValue: string;
    reason: 'issue' | 'top_up' | 'use' | 'adjustment' | 'refund' | 'sync';
    referenceId?: string;
  };
}

export interface PassTicketUpdateSubmitted extends BaseEvent {
  type: 'PassTicketUpdateSubmitted';
  payload: {
    ticketUpdateRequestId: string;
    passId: string;
    providerId: string;
    requestedBy: string;
  };
}

export interface PassTicketUpdateApproved extends BaseEvent {
  type: 'PassTicketUpdateApproved';
  payload: {
    ticketUpdateRequestId: string;
    passId: string;
    providerId: string;
    approvedBy: string;
  };
}

export interface PassTicketUpdateRejected extends BaseEvent {
  type: 'PassTicketUpdateRejected';
  payload: {
    ticketUpdateRequestId: string;
    passId: string;
    providerId: string;
    rejectedBy: string;
    reason: string;
  };
}

export interface PassTicketStatusUpdated extends BaseEvent {
  type: 'PassTicketStatusUpdated';
  payload: {
    passId: string;
    providerId: string;
    checkInStatus?: 'not_checked_in' | 'checked_in' | 'voided';
    changeStatus?: 'none' | 'rescheduled' | 'cancelled';
    eventName?: string;
    startsAt?: string;
    seatLabel?: string;
  };
}

export interface AdminBalanceAdjustmentRequested extends BaseEvent {
  type: 'AdminBalanceAdjustmentRequested';
  payload: {
    adjustmentId: string;
    passId: string;
    requestedBy: string;
    balanceType: 'amount' | 'points' | 'times';
    beforeValue: string;
    afterValue: string;
    reason: string;
    riskLevel: 'low' | 'high';
  };
}

export interface AdminBalanceAdjustmentApproved extends BaseEvent {
  type: 'AdminBalanceAdjustmentApproved';
  payload: {
    adjustmentId: string;
    approvedBy: string;
    ledgerEntryId: string;
  };
}

export interface DisputeStatusChanged extends BaseEvent {
  type: 'DisputeStatusChanged';
  payload: {
    disputeId: string;
    fromStatus?:
      | 'Submitted'
      | 'InReview'
      | 'NeedMoreInfo'
      | 'Approved'
      | 'Rejected'
      | 'Reversed'
      | 'Closed';
    toStatus:
      | 'Submitted'
      | 'InReview'
      | 'NeedMoreInfo'
      | 'Approved'
      | 'Rejected'
      | 'Reversed'
      | 'Closed';
    reason?: string;
  };
}

export interface ServerLocationVerified extends BaseEvent {
  type: 'ServerLocationVerified';
  payload: {
    userId: string;
    serverId: string;
    playerName: string;
    ruleId: string;
    x: number;
    z: number;
    verifiedAt: string;
  };
}

export interface PassUseRequested extends BaseEvent {
  type: 'PassUseRequested';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    amount?: string;
    benefitCode?: string;
    verificationMethod: 'server_account' | 'pin' | 'qr_code' | 'manual';
    expiresAt?: string;
    maxVerificationAttempts?: number;
  };
}

export interface PassUseSucceeded extends BaseEvent {
  type: 'PassUseSucceeded';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    recordId: string;
    consumedValue?: string;
    discountValue?: string;
    remainingValue?: string;
  };
}

export interface PassUseReversed extends BaseEvent {
  type: 'PassUseReversed';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    recordId: string;
    refundedValue: string;
    remainingValue: string;
    reason: string;
  };
}

export interface PassUseFailed extends BaseEvent {
  type: 'PassUseFailed';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    attemptCount?: number;
    maxAttempts?: number;
    remainingAttempts?: number;
  };
}

export interface PassUseCancelled extends BaseEvent {
  type: 'PassUseCancelled';
  payload: {
    passId: string;
    providerId: string;
    requestId: string;
    cancelledBy: string;
    reason: string;
  };
}

export interface PassTopUpRequested extends BaseEvent {
  type: 'PassTopUpRequested';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    providerId: string;
    sourceProviderId: string;
    benefitType: BenefitType;
    value: string;
    verificationMethod: VerificationMethod;
    status: PassTopUpStatus;
    expiresAt?: string;
  };
}

export interface PassTopUpSucceeded extends BaseEvent {
  type: 'PassTopUpSucceeded';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    providerId: string;
    sourceProviderId: string;
    benefitType: BenefitType;
    value: string;
    sourceLedgerEntryId: string;
    targetLedgerEntryId: string;
  };
}

export interface PassTopUpFailed extends BaseEvent {
  type: 'PassTopUpFailed';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  };
}

export interface PassTopUpExpired extends BaseEvent {
  type: 'PassTopUpExpired';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    expiredAt: string;
  };
}

export interface PassTopUpCancelled extends BaseEvent {
  type: 'PassTopUpCancelled';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    actionLinkId?: string;
    reason?: string;
  };
}

export interface PassTopUpReversed extends BaseEvent {
  type: 'PassTopUpReversed';
  payload: {
    topUpId: string;
    userId: string;
    sourcePassId: string;
    targetPassId: string;
    providerId: string;
    sourceProviderId: string;
    benefitType: BenefitType;
    reversedValue: string;
    sourceLedgerEntryId: string;
    targetLedgerEntryId: string;
    sourceRefundLedgerEntryId: string;
    targetRefundLedgerEntryId: string;
    reversedBy: string;
    reason: string;
  };
}

export interface AutoDeductionAuthorized extends BaseEvent {
  type: 'AutoDeductionAuthorized';
  payload: {
    userId: string;
    passId: string;
    providerId: string;
    authorizationId: string;
    limitValue?: string;
    period?: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
  };
}

export interface PlatformThemeScheduleUpdated extends BaseEvent {
  type: 'PlatformThemeScheduleUpdated';
  payload: {
    updatedBy: string;
    entries: Array<{
      effectiveAt: string;
      tone: 'teal' | 'red' | 'gray';
      enabled: boolean;
      note?: string;
    }>;
  };
}

export interface StorageAlertRaised extends BaseEvent {
  type: 'StorageAlertRaised';
  payload: {
    alertId: string;
    drive: string;
    freeBytes: string;
    totalBytes: string;
    projectUsedBytes?: string;
    thresholdBytes?: string;
    thresholdRatio?: string;
  };
}

export interface StorageAlertResolved extends BaseEvent {
  type: 'StorageAlertResolved';
  payload: {
    alertId: string;
    drive: string;
    freeBytes: string;
    totalBytes: string;
  };
}
```

### 9.3 模块边界与解耦约束

为避免功能模块之间耦合过重，后续实现必须遵守以下规则：

- 业务 Service 不允许直接 import 其他业务 Service。
- 业务 Service 只负责本模块的核心数据操作、状态校验与事件发出。
- 跨模块副作用通过事件监听器完成，例如审计、通知、风控、Webhook、统计。
- 需要强一致的业务编排时，由应用层 Use Case / Command Handler 负责协调，不让底层 Service 互相调用。
- 模块之间共享 TypeScript 类型、事件 Schema、错误码与只读查询接口，避免共享可变业务逻辑。
- 每个模块应拥有清晰的数据所有权；其他模块不能直接修改不属于自己的业务表。
- 所有跨模块写操作必须产生审计记录，并尽量通过 Outbox 或事件表保证事件不丢失。
- 第一阶段可以使用进程内 EventEmitter，但 EventBus 接口必须抽象出来，后续可替换为队列或消息总线。

### 9.4 建议模块拆分

| 模块                        | 职责                                                                   | 禁止依赖                                        |
| --------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Identity                    | 用户、注册审核、服务器账户验证状态、登录、会话、外部回跳、登录状态校验 | Wallet、Pass、Ledger、Redemption                |
| Server Verification Adapter | 对接服务器聊天事件、匹配验证码、回传验证结果                           | Wallet、Pass、Ledger、Redemption、Admin Console |
| Wallet                      | 用户卡包、卡片排序、隐藏、归档、详情聚合                               | Provider 后台 Service、Admin Service            |
| Pass Template               | 卡券模板、字段配置、卡面配置、版本管理                                 | Wallet 实例数据                                 |
| Issuing                     | 发放、领取令牌、添加链接、二维码                                       | Redemption 核销流程                             |
| Ledger                      | 金额、积分、次数流水与当前值计算                                       | UI 展示逻辑                                     |
| Redemption                  | 使用请求、核销确认、结果记录                                           | Provider 后台页面逻辑                           |
| Provider Portal             | 提供方后台权限、操作入口                                               | 用户端页面状态                                  |
| Admin Console               | 审核、治理、冻结、查询                                                 | 具体业务模块内部实现                            |
| Audit                       | 审计日志                                                               | 任何业务模块的核心写逻辑                        |
| Storage Monitor             | 检测磁盘剩余空间、维护活动告警、发出存储告警事件                       | 业务 Service、前端页面状态                      |

### 9.5 事件驱动落地顺序

第一阶段不需要一开始就引入复杂消息中间件，但代码结构必须为升级留出口：

1. 先定义 `EventBus` 接口、事件类型、事件发布器。
2. MVP 使用进程内事件分发，同时把关键业务事件写入数据库事件表。
3. 当出现异步重试、Webhook、批量导入、风控延迟处理等需求时，引入队列。
4. 当多实例部署或跨服务部署成为刚需时，再把 EventBus 替换为 Redis Stream、BullMQ、NATS、Kafka 等实现。

## 10. 状态机草案

### 10.1 用户注册状态

正常审核注册：

```text
Draft -> PendingReview -> Approved -> Active
                      \-> Rejected -> PendingReview
```

服务器账户验证免审注册：

```text
Draft -> WaitingServerVerification -> Verified -> Active
                 |         ^
                 |         |
                 -> CodeRotated
                 -> Expired
                 -> Failed
```

说明：

- `PendingReview` 表示注册申请已提交，等待管理员审核。
- `Approved` 表示管理员已审核通过，随后账户进入 `Active`。
- `WaitingServerVerification` 表示用户已提交服务器 ID，等待在服务器聊天内输入验证码。
- `CodeRotated` 表示旧验证码失效并生成了新验证码，通常由聊天内容不匹配、用户手动刷新或过期触发。
- `Verified` 表示服务器账户验证成功，可免管理员审核进入 `Active`。
- `Failed` 表示超过失败次数、触发风控或验证流程被关闭。

### 10.2 卡券模板状态

```text
Draft -> PendingReview -> Approved -> Active -> Suspended -> Archived
                    \-> Rejected
```

### 10.3 用户持卡实例状态

```text
Issued -> Added -> Active -> Frozen -> Active
                     |        |
                     |        -> Deleted/Archived
                     -> Expired
                     -> UsedUp
```

### 10.4 使用/核销请求状态

```text
Created -> WaitingVerification -> Verified -> Processing -> Succeeded
                  |                    |             |
                  |                    |             -> Failed
                  |                    -> Cancelled
                  -> Expired
```

`WaitingVerification` 可包含服务器账户验证、PIN 验证、服务器位置范围验证等子流程。重试规则和有效期由提供方配置，默认有效期为 2 分钟。

## 11. 非功能需求

### 11.1 安全

- 外部链接必须签名并设置有效期。
- 核销和余额变更必须幂等。
- 敏感字段默认脱敏。
- 二维码、验证码、方向码必须短期有效。
- 注册 IP 和 IP 属地属于安全审计信息，后台展示时需要控制权限。
- IP 属地查询结果可能不准确，只能辅助审核，不能作为唯一判断依据。
- 服务器账户验证码必须短期有效，且只能使用一次。
- 用户在服务器聊天中输入不匹配内容后，旧验证码必须立即失效并刷新。
- 服务器聊天验证需要防重放，服务器侧回调必须带签名、时间戳和随机串。
- 服务器账户验证需要限制生成验证码频率、失败次数和同一服务器 ID 的绑定次数。
- PIN 不允许明文保存，必须使用适合密码/PIN 的哈希方案。
- PIN 验证需要限制尝试次数、失败冷却和异常提醒。
- 登录设备需要可查看、可下线，并记录首次出现时间、最后登录时间、最后登录 IP、当时 IP 属地和大致设备信息。
- 设备指纹只能作为辅助风控信号，不能作为唯一登录凭据。
- 管理员操作必须审计。
- 余额/权益调整、核销、管理员审批、卡券模板发布必须保留不可变审计记录。
- 审计记录不允许物理删除；如需纠错，应追加修正记录。
- 审计记录目标为永久保留。
- 考虑目标服务器存储空间较少，审计应区分核心记录与重型上下文。
- 核心审计记录永久保留在数据库中，包括事件 ID、主体、动作、对象、时间、结果、原因、哈希摘要。
- 第一阶段不做站外审计归档。
- 请求体、响应体、截图、导入文件等重型上下文应压缩后本机归档，或仅保留哈希摘要与必要索引。
- 审计表需要按时间分区或按月归档，避免长期拖慢后台查询。
- 系统需要检测云服务器剩余存储空间。
- 当剩余存储空间低于阈值时，需要向管理员提醒。
- 提供方 API 密钥需要可轮换。

### 11.2 可用性

- 移动端优先保证添加卡券、出示凭证、确认使用流程顺畅。
- 桌面端优先保证管理、查询、批量操作效率。
- 失败页面需要明确告诉用户是否已扣减、是否可重试、如何处理。

### 11.3 可扩展性

- 卡券字段应支持模板化配置。
- 余额类型第一阶段支持金额、积分、次数，展示名称与单位可由模板自定义。
- 核验方式应可插拔。
- 提供方接入应隔离，避免单个提供方异常影响全站。

### 11.4 合规与风险提示

- 平台不宣传、不承诺真实资金清算能力。
- 页面文案避免让用户误以为临东通是支付机构或银行。
- 所有“余额”需要在服务条款中说明其业务含义与适用范围。
- 第一阶段需要提供服务条款和隐私政策框架；提供方协议先去掉，后续当发卡方责任、资质审核和违规处置规则稳定后再补。
- 隐私政策需要说明注册 IP、IP 属地、登录设备信息、服务器账户验证、服务器聊天验证、玩家位置范围核验等数据用途。
- 服务条款需要说明临东通不接入真实支付通道，“余额/额度/积分/次数”属于平台内展示权益，不代表银行账户或清算资金。

### 11.5 多设备性能要求

临东通需要兼顾手机、平板、桌面端以及性能较弱的设备。性能优化应作为架构要求，而不是上线前的补救工作。

目标范围：

- 手机端和桌面端同等重要。
- 最低兼容目标为 Android WebView 114、Safari 17。
- 普通用户持有卡券数量预计为几十张。
- 提供方后台单次发放规模预计为几十条。
- 卡券种类预计为几十种。
- 管理员后台需要支持 CSV 导出。
- 可以做 PWA，但必须提供非 PWA 的正常浏览器访问体验。
- PWA 需要离线展示卡券基础信息。

用户端要求：

- 首页首屏优先加载卡包列表与默认选中卡片，卡券详情、历史记录、二维码等内容按需加载。
- 卡片堆叠动画必须可降级；低性能设备或开启系统“减少动态效果”时减少动画。
- 卡面图片、品牌 Logo、Material Symbols 字体资源需要懒加载、缓存或本地化方案。
- 用户卡券数量虽然预计为几十张，但仍应避免一次性渲染复杂详情和全部历史记录。
- 二维码、验证码、方向码等短时凭证只在需要时生成，过期后及时销毁。
- 移动端避免复杂阴影、过度滤镜、大面积模糊和长时间运行的动画。
- 老安卓 WebView 不保证支持所有现代 API；关键功能不能只依赖 WebAuthn、复杂 Service Worker 或最新 CSS 特性。
- PWA 能力用于添加到桌面、静态资源缓存、弱网体验和离线展示卡券基础信息。
- 离线状态下只展示基础信息和已缓存卡面，不允许执行核销、额度调整、领取卡券等需要服务端确认的操作。

提供方后台要求：

- 发放记录、核销记录、用户持卡列表必须服务端分页。
- 搜索、筛选、排序由后端完成，并为常用查询建立索引。
- 批量发放、批量调整额度即使第一阶段规模只有几十条，也应走统一任务模型，前端只展示进度与结果。
- CSV 导入/导出不能阻塞主线程，结果文件异步生成。

管理员后台要求：

- 全站查询默认限制时间范围和分页大小。
- 审计日志、事件日志、接口日志使用服务端筛选，避免浏览器一次拉取大数据。
- 高风险操作页面优先保证信息完整和确认清晰，不追求复杂动画。

通用性能策略：

- 用户端、提供方后台、管理员后台按路由拆分代码，互不打包彼此不需要的页面。
- 首屏接口返回聚合后的轻量 ViewModel，避免前端发起瀑布式请求。
- 大对象字段、历史记录、审计日志按需请求。
- 所有列表接口使用游标分页或稳定排序分页。
- 对图标字体、卡面图片、Logo、静态资源设置长期缓存与版本化文件名。
- 需要定义基础性能预算，例如首屏 JS 体积、首屏接口数量、移动端首屏渲染时间，具体数值在前端技术方案阶段确认。

## 12. 工业界常见设计模式

大型卡包、会员权益、票券平台通常会拆成以下组件：

- Identity Service：用户身份、登录、会话、外部授权。
- Wallet Service：用户卡包、持卡实例、排序、隐藏、归档。
- Pass Template Service：卡券模板、字段定义、卡面配置、版本管理。
- Issuing Service：发放、领取链接、二维码、批次。
- Ledger Service：余额/权益流水，保证幂等与可追溯。
- Redemption Service：使用请求、核销、验证码、二维码校验。
- Provider Portal：提供方后台。
- Admin Console：管理员后台。
- EventBus：事件分发。
- Audit Log：审计日志。
- Webhook Worker：对外回调。
- Risk Engine：限流、风控、异常拦截。

核心原则是：账户、卡券、余额流水、核销记录分开建模；用户界面的“卡片”不是余额本身，余额变化必须由流水驱动，不能只改卡片上的一个数字。

## 13. 高频踩坑点

- 重复核销：用户连点、网络重试、提供方超时重发都会导致重复扣减。必须使用幂等键和状态机锁。
- 链接泄露：添加卡券链接如果没有有效期和签名，可能被转发后滥领。
- 余额只存当前值：如果没有流水表，后续无法解释余额为什么变化。
- 模板直接覆盖：修改卡券模板后影响历史卡券展示，导致旧凭证字段错乱。模板需要版本化。
- 外部回调阻塞主流程：提供方 Webhook 失败不应阻塞用户页面，应通过事件监听器异步重试。
- 自动扣减授权不清晰：用户找不到取消入口会造成投诉。
- 文案误导：使用“支付、付款、收款”等词可能让产品被误解为资金清算工具。

一个典型事故是：系统在核销成功后同步通知外部系统，外部系统超时，调用方以为失败又重试一次。如果内部没有幂等键，用户权益会被扣两次；如果又没有流水，只能靠日志手动猜，修复成本非常高。

## 14. 建议核心测试用例

后续实现时至少验证：

- 同一个核销请求重复提交，只产生一条成功记录。
- 添加卡券链接过期后不可领取。
- 未登录用户通过添加链接登录后能回到原动作。
- 未登录用户不能领取添加卡券链接。
- 提供方配置“仅服务器账户已验证用户可领取”后，未验证用户不能领取。
- 卡券被冻结后不能继续使用。
- 用户取消确认后不会产生余额扣减。
- 核销成功但外部 Webhook 失败时，用户结果页仍显示成功，Webhook 后台重试。
- 自动扣减授权取消后，提供方不能继续发起自动扣减。
- 模板升级后，旧卡券仍按旧版本字段正确展示。
- 服务器聊天输入错误内容后，旧验证码失效并生成新验证码。
- 新设备登录通过已登录设备确认后，新设备可以建立会话。
- 服务器 ID 换绑后，其余设备会话全部失效。
- 证件/钥匙类位置核验时，玩家不在线、位置未知、不在范围内分别返回明确失败原因。
- PWA 离线时可以展示已缓存卡券基础信息，但不能执行核销、领取、额度调整。
- 管理员余额/权益调整审批通过后，必须同时产生流水和不可变审计记录。
- 审计重型上下文归档后，核心审计记录仍可通过哈希或引用追溯。
- 云服务器剩余存储空间低于阈值时，管理员能收到提醒。
- 用户设置积分/次数过期提醒时间后，系统按用户设置提醒；未设置时默认提前 7 天。
- 发行方关闭转赠后，用户不能发起该卡券的转赠。

## 15. 技术栈评估

### 15.1 推荐方案：TypeScript Monorepo + Next.js + NestJS

建议优先采用 TypeScript 单一语言栈，降低前后端上下文切换成本，同时保留清晰的模块边界。

建议组成：

- 前端：Next.js App Router。
- 后端：Next.js Route Handlers 内嵌后端业务模块，沿用 Nest application context、事件总线和 Prisma。
- 数据库：SQLite 默认方案；后续规模扩大后可迁移 PostgreSQL。
- ORM：Prisma。
- 认证：优先评估 Better Auth；如果最终决定前后端强绑定在 Next.js 内，可评估 Auth.js。
- 样式：Tailwind CSS + 少量手写 CSS 变量。
- 图标：Material Symbols，可通过 CDN 引入，并保留显示降级方案。
- 包管理与仓库：pnpm workspace 或同类 monorepo 工具。
- 部署：云服务器部署，目标系统为 Windows Server，目前通过宝塔面板管理各网站项目。
- 进程形态：所有服务以宝塔面板 + Windows 原生进程方式部署，第一阶段不使用 Docker / Docker Compose。
- 数据库：SQLite 文件先部署在同一台云服务器项目目录内。
- 应用形态：从第一阶段开始采用单 Next.js 主应用；`apps/api` 保留为后端业务模块边界，不作为独立 HTTP 服务启动。
- 交付要求：需要提供详尽部署文档，包括环境变量、数据库迁移、反向代理、HTTPS、后台任务、PWA 配置和回滚方式。

推荐理由：

- 你熟悉 Node.js，TypeScript 生态学习成本最低。
- Next.js 适合做用户端卡包这种需要首屏体验、路由拆包、图片/字体优化的 Web App。
- 后端模块继续保留 Provider、事件、鉴权、限流等边界，避免业务逻辑散落在页面组件或 Route Handler 中。
- 登录验证需要复用给其他项目时，Identity 模块仍保持独立业务边界，只是由 Next.js API Route 统一承接 HTTP 入口。
- `apps/api` 模块边界有利于后续接入其他同二级域名项目、服务端任务和 BDSLM Adapter；如果后台任务变重，再拆 worker 进程。
- SQLite 不需要单独数据库服务，适合当前低并发、低存储空间的单机部署；卡券、流水、事件、审计模型仍保持 Prisma 关系建模，后续可迁移 PostgreSQL。
- Prisma 可以把数据库模型、迁移和 TypeScript 类型串起来，减少手写 SQL 的低级错误。

推荐目录形态：

```text
apps/
  web/              # Next.js 用户端、提供方后台、管理员后台
  api/              # 后端业务模块，由 Next.js API Route 内嵌调用
  worker/           # 可选：后台任务、BDSLM 轮询、异步导出
packages/
  contracts/        # 事件 Schema、DTO、错误码、权限常量
  database/         # Prisma schema、迁移、种子脚本
  ui/               # 共享 UI 组件与设计变量
  event-bus/        # EventBus 抽象与实现
  config/           # ESLint、TypeScript、环境变量校验
```

部署文档至少需要覆盖：

- Windows Server 系统依赖、Node.js LTS、pnpm、SQLite 文件权限。
- 宝塔面板下站点、进程守护、反向代理、日志路径的配置方式。
- `apps/web` 单进程启动方式，以及后续可选 worker 进程的拆分条件。
- Windows 原生进程守护与开机自启配置。
- 宝塔面板下的 Nginx 反向代理配置。
- HTTPS 证书申请与续期。
- 跨子域名 Cookie 配置。
- 数据库迁移、备份与恢复。
- 同机 SQLite 的数据目录、备份目录和存储空间监控。
- 环境变量说明和密钥轮换。
- BDSLM 接口地址、访问控制、轮询间隔。
- PWA manifest、Service Worker 缓存策略、离线卡券基础信息缓存、关闭/回滚方式。
- Android WebView 114、Safari 17 兼容注意事项。
- 常见故障排查和回滚步骤。

### 15.2 当前方案：Next.js 全栈单体

组成：

- Next.js App Router
- Route Handlers
- 内嵌后端业务模块
- SQLite + Prisma

优点：

- 部署路径更短，页面和接口同源，不再需要单独 API 端口、CORS 和 PM2/NSSM 双进程配置。
- 用户端、提供方后台、管理员后台和 `/api/*` 都在同一个 Next.js 主应用内。
- 后端业务仍通过 `apps/api` 模块、事件总线和 Prisma 保持边界，不让页面直接改业务表。

风险：

- Route Handler 不能直接承载业务逻辑，否则会重新变成页面和接口耦合。
- Webhook、过期扫描、BDSLM 轮询等任务变重后，需要拆出 worker，避免长任务挤占请求路径。
- 多实例部署时，内存事件总线和定时任务需要重新评估，必要时引入队列或数据库锁。

适用条件：

- 第一阶段优先降低部署复杂度。
- 仍然坚持后端模块边界和事件驱动，不允许页面或 Route Handler 直接互相调用业务 Service。
- 接受后续按负载拆出 worker，而不是一开始强制维护独立 API 进程。

### 15.3 备选方案 B：Vue / Nuxt + Node API

组成：

- Nuxt 或 Vue + Vite
- NestJS / Express / Fastify
- SQLite + Prisma

优点：

- Vue 上手直观，模板语法对部分开发者更友好。
- Nuxt 也能处理 SSR、路由和数据加载。

风险：

- 如果你之前主要做 Node.js 而不是 Vue，学习成本不一定比 React/Next 更低。
- 社区组件、后台模板、认证示例需要重新筛选。
- 最终仍然需要一个结构化后端来解决登录复用和业务边界。

适用条件：

- 你明确偏好 Vue。
- 前端团队更熟 Nuxt/Vue。

### 15.4 不建议第一阶段采用：微服务

不建议一开始拆成多个独立服务。临东通确实有 Identity、Wallet、Ledger、Redemption 等天然边界，但第一阶段更适合“模块化单体”：代码边界清晰、数据库事务可控、部署简单，未来再按压力和团队规模拆服务。

可以先按微服务的边界写模块，但不要过早引入多仓库、多数据库、多套部署和复杂消息中间件。

### 15.5 身份认证技术建议

登录验证是第一阶段优先能力，而且未来要给其他项目使用，所以 Identity 模块需要单独设计。

第一阶段建议支持：

- 用户名 + 密码登录。
- 邮箱作为备选登录标识和找回入口。
- 登录设备管理。
- 敏感操作二次验证：服务器账户验证或 PIN。
- 登录后回跳：`redirect_uri` + `state`。
- 会话校验接口：其他项目可以检查当前用户是否已登录。
- 客户端应用登记：`client_id`、允许的回跳域名、应用名称。
- 当前最小闭环已支持管理员在 `/admin/client-applications` 登记客户端应用，由 `/login` 登录页通过服务端校验 `redirect_uri` 后回跳，并通过 `/api/auth/client-session?client_id=...` 按允许来源校验当前登录态。
- `/api/auth/client-session?client_id=...` 只把 `Active` 用户视为 `authenticated=true`；待审核、拒绝、等待服务器验证或其他非激活状态不能被外部项目当作已登录用户使用。
- 退出登录：支持仅退出当前项目或退出统一登录态。
- 项目部署在三级域名上，接入项目目前共享同一个二级域名。
- 如果所有接入项目都在同一二级域名下，可以优先使用同站会话 Cookie + 自定义登录回跳/会话校验。

需要先做 MVP 验证：

- 会话 Cookie 是否设置在共同二级域名下，例如 `.example.com`。
- 旧 Android WebView 对 SameSite、Secure Cookie、PWA 的支持情况。
- 是否需要多租户、组织、角色、管理员后台统一授权。

### 15.6 OAuth / OIDC 与自定义登录回跳评估

OAuth 2.0/2.1 更偏“授权委托”：一个应用拿到用户授权后，可以访问另一个服务的受保护资源。OpenID Connect 是建立在 OAuth 2.0 之上的身份层，更偏“登录认证”：应用可以确认用户是谁，并拿到标准化身份声明。

自定义登录回跳/会话校验更轻量：临东通维护统一登录态，其他同二级域名项目通过回跳和会话校验确认用户身份。

当前建议：

- 第一阶段采用自定义登录回跳 + 会话校验。
- 接口和数据模型按未来迁移到 OIDC 的方向设计，例如保留 `client_id`、`redirect_uri`、`state`、授权应用登记、回调白名单。
- 不在第一阶段完整实现 OAuth/OIDC Provider，避免把认证服务复杂度过早拉满。
- 当出现跨二级域名接入、第三方开发者接入、移动端原生应用接入、细粒度授权范围等需求时，再实现标准 OIDC。

自定义方案第一阶段需要提供：

- `GET /auth/login?client_id=...&redirect_uri=...&state=...`
- `GET /auth/session`
- `GET /auth/client-session?client_id=...`
- `POST /auth/logout`
- `POST /auth/challenges/pin`
- `POST /auth/challenges/server-account`
- 客户端应用管理后台：应用名、`client_id`、回调白名单、允许域名。

风险与约束：

- 自定义方案必须严格校验 `redirect_uri`，禁止开放跳转。
- 同二级域名 Cookie 需要启用 HTTPS，并正确设置 `Secure`、`HttpOnly`、`SameSite`。
- 如果旧 Android WebView 对 Cookie 策略兼容不佳，需要提供 token 回传或一次性登录票据的兼容流程。

### 15.7 官方文档依据

- [Next.js App Router](https://nextjs.org/docs/app)：官方文档说明 App Router 使用 React Server Components、Suspense、Server Functions 等能力。
- [NestJS Documentation](https://docs.nestjs.com/)：官方文档强调 NestJS 面向可扩展、松耦合、可维护的 Node.js 服务端架构，并提供模块、事件、队列、鉴权、OpenAPI 等能力。
- [Prisma Supported Databases](https://www.prisma.io/docs/orm/reference/supported-databases)：Prisma 官方列出 SQLite 与 PostgreSQL 均为支持数据库。
- [Node.js Releases](https://nodejs.org/en/about/previous-releases)：Node.js 官方建议生产应用使用 Active LTS 或 Maintenance LTS；截至 2026-06-20，Node 24 为 LTS，Node 26 为 Current。
- [Tailwind CSS with Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs)：Tailwind 官方提供 Next.js 集成方式。
- [Material Symbols Guide](https://developers.google.com/fonts/docs/material_symbols)：Google 官方说明 Material Symbols 可通过 Google Fonts 或自托管使用，并建议子集化减少字体体积。
- [Better Auth Introduction](https://better-auth.com/docs/introduction)：Better Auth 官方定位为框架无关的 TypeScript 认证与授权框架。
- [Auth.js Getting Started](https://authjs.dev/getting-started)：Auth.js 官方说明其支持 OAuth、Magic Links、Credentials、WebAuthn，并且项目已属于 Better Auth。
- [OAuth 2.0 RFC 6749](https://www.rfc-editor.org/rfc/rfc6749)：OAuth 2.0 授权框架的基础规范。
- [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html)：OpenID Connect 是基于 OAuth 2.0 的身份层。

## 16. 当前确认结果与剩余问题

### 16.1 已确认结论

产品边界：

- 项目完全不接入真实支付通道。
- 金额类权益不显示货币符号。
- 第一阶段支持金额、积分、次数三类权益。
- 对外展示名称允许自定义。
- 用户主动“补充额度”后续实现，但需要从当前模型开始预留；推荐理解为从来源卡消耗额度，为目标卡补充平台内展示权益。
- 第一阶段由提供方发放和调整额度。
- 转赠、共享、冻结额度、透支额度、积分过期、次数过期等规则由发行方配置。
- 第一阶段不支持同一张卡券包含多种权益。

用户与认证：

- 登录方式优先选择用户名，邮箱作为备选登录标识。
- 项目部署在三级域名上，当前接入项目共享同一个二级域名。
- 第一阶段采用自定义登录回跳 + 会话校验，预留未来 OIDC 扩展。
- 需要登录设备管理。
- 登录设备上限按操作系统区分，每种操作系统最多保留 2 台活动登录设备，超出时自动下线同系统最早登录的设备。
- 新设备登录可以通过服务器账户验证或已登录设备验证。
- 服务器账户验证成功后允许换绑，换绑后其余设备全部退出登录。
- PIN 重置以服务器账户验证为主，允许管理员介入。
- 用户实名和手机号验证不是第一阶段必需能力。
- 敏感操作需要二次验证，第一阶段支持服务器账户验证或 PIN。

提供方：

- 提供方允许管理员手动创建。
- 提供方也开放注册，但需要管理员审批。
- 第一阶段不考虑提供方多门店、多操作员、多角色权限。
- 第一阶段先做提供方后台发放与调整额度；当前已补齐开放提供方 API 的发放、查询、调整、状态变更、票券字段变更申请和核销入口。
- 添加卡券链接/二维码排在登录验证之后。
- 开放 API 已完成第一版，使用 Bearer API 密钥、scope、签名、时间戳、幂等键和限流保护写接口。
- 添加卡券链接必须由已登录用户领取。
- 是否限定为已验证服务器账户的用户，由提供方自行设置。

卡券模型：

- 第一阶段支持账户/卡、证件/钥匙、票券。
- 自动扣费后续再做。
- 卡面样式由平台提供固定模板，允许提供方修改颜色、Logo、字段、背景图片。
- 卡面背景图裁剪比例为 `856:540`。
- 上传背景图大小限制为 1 MB 以内，也允许使用图床链接。
- 所有卡券可见信息都需要管理员手动审批通过。
- 证件/钥匙类需要核验能力，至少包含服务器账户验证和玩家位置范围验证。
- 服务器 ID 等同于 BDSLM 返回的 `name`/`text` 字段。
- 位置核验不区分维度。
- 位置范围由提供方自行配置，并和其他卡券信息一并提交管理员审批。
- 位置核验需要支持多个位置范围，第一阶段建议命中任意范围即通过。
- 位置数据过期时间为 1 分钟。
- 第一阶段暂不支持多个 BDSLM 服务器。
- 发卡方配置每次变化都需要管理员审批。当前已覆盖资料变更、API 密钥创建/轮换/停用，以及 Webhook 创建、修改、启停、删除和密钥轮换；后续可继续细化低风险配置的快速审批和更细角色权限。
- 发行方可以关闭转赠功能。
- 转赠需要接收方确认。
- 透支状态允许在界面上显示为负数。
- 积分/次数过期前提醒时间由用户自行设置，默认提前 7 天。
- 票券支持座位、场次、检票状态、改签/取消等字段。

使用与核验：

- “按下验证按钮确认你是某某用户”和动态方向码短期内不考虑。
- 第一阶段核验方式只考虑服务器账户验证和 PIN。
- 服务器账户验证用于敏感操作时，需要为本次操作重新发放带前缀的聊天验证码。
- 重试规则由提供方决定；第一版支持最大验证尝试次数。
- 核销有效期由提供方决定，默认 2 分钟。

管理与合规：

- 第一阶段需要服务条款和隐私政策框架，提供方协议先去掉。
- 管理员需要能够封禁、解封和删除用户账户；删除建议先做软删除。
- 敏感词审核第一阶段可以先不做。
- 管理员可以手动修改用户余额和权益，但需要受控审批、原因记录、流水和审计。
- 暂时不考虑双人审批。
- 第一阶段管理员默认就是超级管理员。
- 管理员登录入口与普通用户登录入口区分，第一阶段建议使用 `/admin/login`。
- 管理员身份复用同一套 Identity 账户体系，但登录成功后必须校验管理员权限，不能仅依赖前端路径判断。
- 管理员登录必须进行二次验证，第一阶段支持 PIN 或服务器账户验证。
- 管理员初始账户建议通过受控种子脚本或命令行创建，不开放公开注册。
- 所有额度调整和核销都应保留不可变审计记录。
- 审计记录希望永久保留，但目标服务器存储空间较少，需要压缩、归档和摘要化策略。
- 第一阶段不做站外审计归档。
- 需要检测云服务器剩余存储空间，并在存储空间不足时提醒管理员。
- 争议记录需要状态流转。

技术与部署：

- 技术路线暂定为 Next.js + NestJS + SQLite + Prisma + TypeScript monorepo，保留后续迁移 PostgreSQL 的可能。
- 从第一阶段开始做独立 `api` 应用。
- 项目部署在云服务器上。
- 云服务器系统为 Windows Server，目前使用宝塔面板管理各网站项目。
- 云服务器反向代理使用 Nginx。
- 所有服务以宝塔面板 + Windows 原生进程方式部署。
- 第一阶段不使用 Docker / Docker Compose。
- SQLite 数据库文件先部署在同一台云服务器上。
- 需要详尽部署文档。
- 可以做 PWA，并需要离线展示卡券基础信息。
- 目标设备手机和桌面同等重要。
- 最低兼容目标为 Android WebView 114、Safari 17。
- 普通用户卡券数量预计最多几十张。
- 后台单次发放规模预计几十条。
- 卡券种类预计几十种。
- 管理员后台可以做 CSV 导出。

UI 与品牌：

- 先做 Apple Wallet 式的卡片堆叠及详情。
- 卡面模板需要多一些变体。
- 卡面模板变体预留增删接口即可。
- Material Symbols 可以全部通过 CDN 引入。
- Logo 源文件存放目录为 `assets/brand/`。
- Logo 可以提供 PNG/SVG。
- 页面外观支持浅色、深色、跟随系统三种模式。
- 主题色支持青绿色、红色、灰色、自动切换四种模式。
- 主题设置在未登录状态下也可以修改，并保存为本地偏好。
- 主题色默认选项为自动切换。
- 自动主题色的切换时间由管理员在后台动态配置，用户端读取平台配置后生效。
- 主题计划应是“在某月某日几点几分（UTC+8）之后切换到某个主题色”的绝对时间列表，而不是每日循环时间段。
- 除登录、注册页面外，后台和工具页面应优先使用标题栏 + 内容区布局；管理员后台和发卡方后台需要统一导航控件；账户页应使用标题栏 + 账户摘要 + 设置入口，PIN、服务器账号、提醒、设备、新设备确认、审核补充和注销等修改项通过弹窗打开。
- 管理员后台和发卡方后台在移动端、平板端不使用 tab 或横向滚动导航承载主要分类；应以后台首页/分类页作为上级页面，进入用户、提供方、模板、发放、核销等模块后用返回上级的二级页面承接详情、审核和表单。
- 自动主题色计划属于公共平台配置，未登录用户也能读取，但只有管理员可以修改。
- 前端不能按分类或本地时间自行决定自动主题色，只能解析管理员发布的公共计划；若配置暂不可用，则使用平台默认兜底色。
- 灰色主题色需要对品牌图片、广告背景、卡面图片等视觉素材进行灰调处理。

### 16.2 后续实现细化项

当前没有阻塞产品方向的问题。后续进入设计和开发前，可以继续细化：

1. BDSLM 轮询间隔是否保持 1 秒，以及接口重启后消息 ID 回绕的处理策略。
2. 存储空间不足提醒的阈值，例如剩余 5 GB、10 GB 或低于 15%。
3. 卡面模板变体增删接口的权限范围、审批流程和默认初始变体。
4. 管理员争议反转、管理员介入重置密码、异常账户处置的具体操作页面。
5. Web 进程守护或平台托管方式选型，例如宝塔进程守护、NSSM、Windows 服务、系统计划任务或云平台 Next.js 托管。
6. 管理员删除用户采用软删除还是硬删除；建议第一阶段软删除。
7. 服务器聊天验证码前缀已采用 `LDPASS-`，用户需要在服务器聊天内发送完整验证码。
8. 卡内额度补充是否第一阶段只允许同一用户持有的两张卡之间发生；建议先限制同一用户。
9. 完整领取码是否坚持只展示一次；建议只展示一次，后续通过作废旧码和重新生成解决遗失问题。
10. 主题计划没有任何已生效条目时的自动主题色兜底值；建议兜底青绿色，但用户设置默认仍是“自动切换”。
