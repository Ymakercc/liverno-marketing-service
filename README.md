# KULON Marketing Console

KULON 外贸营销控制台。项目将孚盟客户、Apollo 补全、AI 邮件、n8n 排期、Brevo 发送和状态回传集中到一个本地网页。

本项目继续使用原 GitHub 仓库：

- `https://github.com/RollinsLy/b2b-email-marketing-automation.git`
- 当前 Git 远端名：`origin`
- 不切换到后来新建的 `N8N-Marketing` 仓库，避免历史和配置说明分散。

## 当前流程

```text
孚盟客户/联系人
  -> Apollo 公司/联系人/已验证邮箱补全
  -> 只补空字段或新增联系人回填孚盟
  -> AI 生成首封邮件并自动质检
  -> 自动创建飞书 AI 跟进记录
  -> 按客户当地工作时间排队
  -> n8n 每 15 分钟触发，后端检查总开关、发信开关、每日限额和收件人当地工作时间后调用 Brevo
  -> 发送结果回写飞书，并新增孚盟邮件跟进
  -> Brevo Webhook 将送达/打开/点击/退信按公司汇总到飞书，并同步展示在网页
  -> 首封打开者按 2/5 个工作日规则自动进入第二轮队列
  -> n8n 每 5 分钟读取阿里企业邮箱，固定规则先识别退信/自动回复/退订，再由 Xiaomi MiMo 分析人工邮件意图并回填飞书
```

当前基础版已完成：

- 孚盟候选客户筛选，排除成交、停业和拒联。
- Apollo 公司匹配评分、目标职位排序和邮箱补全。
- 孚盟客户官网部分更新、联系人新增/补充和发信跟进记录。
- AI 邮件、事实/长度/占位符/收件人自动质检。
- SQLite 持久化发送队列、幂等、客户冷却期、每日限额和退信抑制。
- Brevo Transactional API 发送与 Webhook 状态回传。
- 三条 n8n 定时工作流：候选漏斗每 10 分钟运行，发送调度每 15 分钟运行，收件箱每 5 分钟运行。
- 候选扫描覆盖整个孚盟营销公海池，补全失败的客户也会进入 7 天冷却，避免每天重复消耗 Apollo Credits。
- 第二轮营销复用首封已经保存的公司画像、联系人和产品推荐，不再次调用 Apollo；同一公司最多选择 2 个真实打开者，首批总计最多 50 封。

**默认不会误发。** `FUMENG_WRITEBACK_ENABLED`、`EMAIL_SENDING_ENABLED` 和 `SECOND_TOUCH_ENABLED` 默认为 `false`；源工作流模板默认未激活，当前本机 n8n 已启用新版定时工作流。正式运行时，网页可设置每日营销公司目标；系统会持续背调候选客户，直到达到公司目标、没有更多候选，或达到内部背调上限。超过每日发送额度的邮件会保留在队列中。Apollo 明确返回额度耗尽时，系统只会自动关闭新增背调，营销总开关和 Brevo 发信仍可保持开启，现有队列继续按每日发送上限处理。

Brevo 状态回传已经接入控制台。配置公网 Webhook 后，发送队列会记录并展示已发送、已送达、已打开、已点击、延迟投递、软/硬退信、无效邮箱、拦截、退订和投诉等事件。事件保存在本机 `.data/delivery.sqlite`，并按飞书公司记录汇总更新“送达状态、打开次数、点击次数、最后发送/打开/点击时间、最后点击链接、退信原因和下一步动作”。本地事件库不会提交到 Git。

阿里企业邮箱收件监控使用 IMAP 客户端授权码。授权码从控制台“系统连接”页面填写并使用 AES-256-GCM 加密保存在本机 `.data/`，不会进入 n8n、网页响应或 Git。固定规则先识别退信、自动回复、退订、KULON 内部/测试邮件和第三方 B2B 平台导流通知；其余人工邮件由独立的 Xiaomi MiMo 模型区分明确询盘、潜在意向、普通回复和无关邮件，并保存置信度、判断理由与需求摘要。只有买家或采购组织直接发来的需求才算询盘，内部测试和 B2B 平台转发或推广的采购线索归为无关邮件。模型不可用时使用保守规则降级，不会把所有人工回复直接认定为询盘。

## 控制台模块

- **总览**：查看系统状态、试运行进度和完整营销流程。
- **客户池**：从孚盟同步客户，按营销公海池、所属人、国家/地区、行业、客户状态和邮箱情况分类筛选，并可点击表头对完整结果集排序。
- **AI 审核**：查看单客户草稿；自动流程生成的草稿会自动进入飞书审核表。
- **发送队列**：展示首封和第二轮的待发送、已发送和异常任务；默认不要求逐条人工放行。
- **询盘回复**：优先查看明确询盘与潜在意向，并查看回复原文、对应公司/联系人、MiMo 置信度、判断理由、需求摘要和飞书同步状态。
- **排除留痕**：所有已背调但未进入营销队列的客户都在网页列出中文原因，并写入飞书“筛选结果”和“排除原因”字段。
- **营销总开关**：开启后立即运行首封营销；暂停后保留现有队列，重启后按开关状态继续。
- **邮件模板**：查看当前首封模板和第二轮精准型号跟进模板。
- **使用说明**：查看每日邮箱额度、内部背调上限、数据边界和局域网访问地址。
- **系统连接**：检查孚盟、中转站、飞书等配置状态；可在网页修改中转站地址、模型和 Key，Key 只显示末尾四位。
- **小米 MiMo 询盘识别**：在“系统连接”中单独填写 MiMo Key、测试连接并开启，不影响生成营销邮件的原有中转站模型。

## 本地启动

需要 Node.js 22.13 或以上版本。

```bash
cp .env.example .env
# 在 .env 中填写本机凭证
npm test
npm start
```

打开控制台：<http://127.0.0.1:8787>

营销公海池按孚盟所属人账号识别，在 `.env` 中配置：

```dotenv
FUMENG_PUBLIC_SEA_OWNER_ID=所属人ID
```

项目中的“公海客户”是业务上统一归属的孚盟账号，不使用 `seasFlag` 判断。导入期间控制台显示孚盟接口的实时总量，不保存固定数量。

不读取孚盟、不调用中转站、不写入飞书的界面演示：

<http://127.0.0.1:8787/?demo=1>

邮件视觉稿预览：

<http://127.0.0.1:8787/email-artwork-preview.html>

第二轮生产模板预览：

<http://127.0.0.1:8787/second-touch-preview.html>

详细配置、边界和基础试运行步骤见 [`docs/V2试运行说明.md`](docs/V2试运行说明.md)。

在创建 Apollo Key 之前，可确认其他配置已就绪：

```bash
npm run preflight -- --allow-missing-apollo
```

## Apollo 与基础自动化

在 `.env` 填入 Apollo Key 后先运行烟囱测试：

```dotenv
APOLLO_API_KEY=
FUMENG_WRITEBACK_ENABLED=false
APOLLO_RESEARCH_ENABLED=true
EMAIL_SENDING_ENABLED=false
DAILY_SEND_LIMIT=10
DAILY_COMPANY_LIMIT=10
DAILY_RESEARCH_LIMIT=100
```

```bash
npm run preflight
npm run smoke:apollo
npm test
```

`smoke:apollo` 会依次验证 Organization Enrichment、Organization Search、People Search 和 People Match，确保 Key 具备完整流程权限。测试不输出邮箱或 Key，People Match 最多消耗 1 个 Apollo 邮箱 Credit。

三个每日数量配置含义不同：

- `DAILY_COMPANY_LIMIT`：每日营销公司目标/上限，网页可以修改；实际公司数可能因候选质量或缺少已验证联系人而更低。
- `APOLLO_RESEARCH_ENABLED`：是否允许新增 Apollo 背调。额度耗尽时系统自动改为 `false`；补充额度后可在网页重新开启。
- `DAILY_RESEARCH_LIMIT`：系统每天最多实际调用 Apollo 背调的内部安全次数，不代表 Apollo 账户剩余额度。公司数量不是发送数量，邮件队列超过当天发送额度后仍可继续寻找精准客户。
- `DAILY_SEND_LIMIT`：Brevo 每天实际发送的邮箱上限，当前基础营销上限为 300 封；它不限制背调或排队数量。
- `SECOND_TOUCH_ENABLED`：是否启用第二轮营销。只有首封已发送、至少打开 1 次且没有退订、投诉、硬退信、无效邮箱或拦截事件的联系人可进入。
- `SECOND_TOUCH_PILOT_LIMIT`：第二轮试运行的累计邮件上限，当前为 50 封；首封和第二轮共同占用 `DAILY_SEND_LIMIT`。
- `SECOND_TOUCH_MAX_CONTACTS_PER_COMPANY`：同一公司第二轮最多发送的真实打开者数量，当前为 2。
- `SECOND_TOUCH_MULTI_OPEN_DELAY_DAYS`：打开至少 2 次的联系人在首封后等待的工作日，当前为 2。
- `SECOND_TOUCH_SINGLE_OPEN_DELAY_DAYS`：只打开 1 次的联系人在首封后等待的工作日，当前为 5。
- `EMAIL_ASSET_PUBLIC_BASE_URL`：邮件图片的公网前缀，当前为 `https://meanwell.business`。产品卡片只接受完整型号对应的具体产品图，或有明确产品型号前缀的具体基础型号图，不使用纯系列横幅或分类代表图。
- `EMAIL_PRODUCT_IMAGE_DIRECTORY`：本地具体型号图片目录，默认是 `public/assets/product-images`。
- `EMAIL_PRODUCT_IMAGE_MANIFEST_PATH`：可选的型号到图片文件/公网 URL 映射，默认是 `public/assets/product-images/index.json`。
- `EMAIL_PRODUCT_IMAGE_PUBLIC_PATH`：Hostinger 下的产品图片目录，当前为 `/MarketResource/AllSeriesPicturesOfMEANWELL`。
- `EMAIL_PRODUCT_IMAGE_ALLOW_BASE_MODEL_FALLBACK`：完整型号没有图片时，是否允许匹配已有的具体基础型号图片，例如 `HLG-100-24` 匹配 `HLG-100H.png`；纯 `HLG`、`LRS` 等系列名不会匹配。
- Hostinger 现有型号图片位于 `public_html/MarketResource/AllSeriesPicturesOfMEANWELL/`，按产品类型、系列和型号分层存放。邮件 Logo、Banner 和签名背景位于 `public_html/email_images/` 与 `public_html/sign_images/`。
- 上传包还包含 `signature-bgc.png`，用于邮件签名背景；上传后首封邮件的图片从 Hostinger 加载。
- 同一家公司首轮最多排入 5 个不同联系人；非精准、证据不足或联系人质检未通过的客户都会进入网页“今日排除客户”明细，但保留不同的筛选结果，不会把“证据不足”误标为“非精准”。

三个运行开关相互独立：营销总开关控制整套后台调度，Apollo 背调开关只控制新增背调，Brevo 发信开关只控制真实发送。需要清空既有队列而不再消耗 Apollo 额度时，应保持营销总开关和 Brevo 发信开启，并暂停 Apollo 背调。

背调证据不足、Apollo 公司待核对、无关键联系人、邮箱未验证、邮件质检失败和飞书写入失败都属于“未进入营销”，必须保留具体原因。飞书缺少审计字段时，系统会自动创建两个普通文本字段。已有审计文件可用以下命令回填，该命令不会调用 Apollo 或发信：

```bash
npm run feishu:backfill-screening -- --file=.data/validation/audit-YYYY-MM-DD.json
```

n8n 中已导入：

- `KULON 01 - Apollo补全与营销排队`
- `KULON 02 - 按时区发送已排期邮件`
- `KULON 03 - 阿里邮箱询盘监控`

源文件位于 `workflows/kulon-*.json`。`npm run n8n:prepare-import` 会生成本机 Token 并在 `.data/n8n-import/` 创建不可提交的导入副本。

## 正式邮箱口径

发件人、回复地址和团队签名统一使用：

```text
marketing@kulon.com
```

当前正式发送开关默认关闭。Brevo 发件人、Webhook、SPF/DKIM/DMARC 和退信/退订/投诉停止规则已接入。

### Brevo 状态 Webhook

在 `.env` 中填写：

```dotenv
BREVO_WEBHOOK_TOKEN=随机长字符串
BREVO_WEBHOOK_PUBLIC_URL=https://brevo-webhook.example.com/api/webhooks/brevo
DELIVERY_DATABASE_PATH=.data/delivery.sqlite
BREVO_TUNNEL_ID=Cloudflare-Tunnel-ID
CLOUDFLARED_ORIGIN_CERT=/Users/your-name/.cloudflared/cert.pem
```

公网地址必须只把 `/api/webhooks/brevo` 转发到隔离网关 `127.0.0.1:8790`；网关再把通过鉴权的请求转发给本机 `8787`。配置完成后注册 Webhook：

```bash
npm run brevo:webhook -- --dry-run
npm run brevo:webhook
```

完成一次 `cloudflared tunnel login` 授权后，可用一条命令启动控制台、隔离网关和 Tunnel：

```bash
npm run start:tracking
```

启动脚本通过本机 Cloudflare 凭证动态获取 Tunnel token，不会把 token 写入 `.env` 或仓库。该命令需要保持运行；电脑重启后需重新执行。

Brevo 通过 Bearer Token 调用回调接口。重复事件会按消息、事件、时间和链接自动去重；硬退信、无效邮箱、拦截、退订和投诉会标记为停止发送。普通邮件回复不属于 Brevo 出站事件，由 `KULON 03 - 阿里邮箱询盘监控` 通过 IMAP 每 5 分钟读取。

### 阿里企业邮箱收件监控

1. 在阿里企业邮箱后台为 `marketing@kulon.com` 开启 IMAP/SMTP 客户端服务并生成客户端授权码。
2. 在本机打开控制台“系统连接”，填写邮箱账号与客户端授权码，勾选“连接测试成功后开启自动监控”。
3. 点击“保存并测试”。连接成功后授权码加密落盘，页面显示监控已开启。
4. 在 n8n 导入并启用 `KULON 03 - 阿里邮箱询盘监控`。之后在控制台“询盘回复”查看结果。

首次检查最多读取最近 30 天、200 封邮件；后续按 IMAP UID 增量读取。收件正文最多保存 20,000 字符，HTML 经过清洗后仅用于隔离预览，不执行邮件脚本。用于分类时只向 MiMo 发送最新回复正文（最多 6,000 字符）、主题和有限的营销匹配上下文，不发送收件邮箱地址。关闭监控不会删除历史记录。

收件箱智能分类使用独立的小米 MiMo 配置。当前使用中国区 Token Plan 接口和 `mimo-v2.5-pro`；接口兼容 OpenAI Chat Completions：

```dotenv
MIMO_INBOX_CLASSIFICATION_ENABLED=false
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5-pro
MIMO_API_KEY=
```

也可以在网页“系统连接 → 小米 MiMo 询盘识别”中填写 Key 并开启。开启后，历史上尚未由 MiMo 判断的邮件会在后台逐批重新分类；n8n 收件监控工作流无需修改。

已有 Brevo 历史事件可按公司一次性回填飞书：

```bash
npm run feishu:backfill-delivery
```

## 目录

- `src/`：Node.js 服务、Apollo/孚盟/Brevo/中转站客户端、营销队列和邮件组合器。
- `public/`：统一营销控制台和邮件模板预览。
- `test/`：单元测试。
- `docs/`：试运行说明。
- `workflows/kulon-*.json`：当前基础自动营销工作流。
- `workflows/n8n.sanitized.json`：旧 n8n 流程的脱敏版本，仅供参考。
- `scripts/sanitize-workflow.mjs`：旧流程脱敏脚本。
- `项目运行手册.md`：原 n8n 项目恢复手册。
- `OpenAI-Agent二代方案.md`：AI Agent 架构方案。

## 安全与密钥

- `.env`、原始 n8n 导出、执行记录和临时导入包不得提交 GitHub。
- 首次启动后，在运行服务的电脑上打开 `http://127.0.0.1:8787` 设置网页登录密码；局域网设备不能执行首次设密。
- 网页密码只以 scrypt 哈希形式保存在 `.env` 的 `WEB_LOGIN_PASSWORD_HASH` 中，登录会话有效期为 7 天；可在“系统连接”中修改密码。
- 网页登录只保护人工控制台和普通浏览器 API；n8n 自动化、Brevo Webhook 与健康检查继续使用各自的鉴权方式运行。
- 只提交 `.env.example`，其中不得出现真实 API Key、App Secret、密码或客户数据。
- 网页只显示密钥是否已配置和末尾四位，完整密钥不会回显；中转站、MiMo 和邮箱授权码可在受登录与局域网限制保护的“系统连接”页面更新。
- 中转站会接收客户公司、官网、联系人姓名和职位；当前设计不把联系人邮箱发送给模型。Xiaomi MiMo 会接收收件主题、最新回复正文、公司/联系人名称和原营销邮件主题，用于判断邮件意图，同样不接收邮箱地址。
- Apollo API Key、孚盟 App Secret、Brevo API Key、中转站 Key 和自动化 Token 只能保存在本机 `.env` 或 n8n 本地数据库中；阿里邮箱授权码只保存在本机加密配置中。
- GitHub 仓库建议保持私有；脱敏后的流程、模板和字段设计仍属于业务资产。

## 旧 n8n 流程

旧流程可能包含 Gemini、Firecrawl、调试收件人或强制发送设置，不能直接作为生产流程启用。需要重新生成脱敏副本时运行：

```bash
node scripts/sanitize-workflow.mjs
```

脚本读取本地 `n8n.json`，输出 `workflows/n8n.sanitized.json`。
