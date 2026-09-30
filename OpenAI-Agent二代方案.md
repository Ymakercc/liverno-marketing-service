# OpenAI Agent 二代外贸自动营销方案

最后整理时间：2026-08-01

## 目标

保留现有 n8n 的稳定编排能力，把最需要判断力的部分交给 OpenAI Agent：

- 客户是否值得开发
- 官网研究和客户画像
- 客户类型判断
- 明纬产品/卖点匹配
- 个性化开发信生成
- 合规和质量检查
- 回复/事件分析和下一步跟进建议

核心原则：Agent 当大脑，确定性系统负责发送、去重、限速、黑名单、退订、状态机和日志。

## 推荐总架构

```text
飞书客户表 / CRM
  ↓
n8n 读取和筛选客户
  ↓
OpenAI Agent Service
  ↓
生成客户画像、产品匹配、邮件草稿、合规检查结果
  ↓
人工审核队列
  ↓
Smartlead / Instantly / Apollo / 现有 Brevo 测试通道
  ↓
事件和回复 webhook
  ↓
OpenAI Reply/Event Agent 分析
  ↓
回写飞书
```

## OpenAI 接入方式

当前选型：使用 OpenAI 兼容中转站，不直接使用 OpenAI 官方 API Key。

V2 服务通过以下配置与供应商解耦：

- `OPENAI_BASE_URL`：中转站的 OpenAI 兼容根地址，通常以 `/v1` 结尾。
- `OPENAI_API_KEY`：中转站生成的 API Key。
- `OPENAI_MODEL`：中转站实际支持的模型名称。
- `OPENAI_API_STYLE=chat_completions`：优先使用大部分中转站支持的接口。

中转站必须兼容 `POST /chat/completions`。服务会先尝试 JSON Schema，若中转站不支持则自动退回 JSON Object。中转站是否支持官网搜索、Responses API、Agents SDK 由其自身能力决定，第一版不依赖这些功能。

推荐优先使用 OpenAI Agents SDK 或 Responses API。

如果第一阶段想快：

- n8n 通过 HTTP Request 调用一个简单的 `agent-service`。
- `agent-service` 内部调用 OpenAI Responses API。
- 先做单 Agent + 结构化输出。

如果第二阶段要长期维护：

- 使用 OpenAI Agents SDK。
- 拆分多个 Agent，并使用 handoffs、guardrails、sessions、tracing。
- 保留人工审批和可恢复状态。

## 模型分层建议

不要每一步都用同一个最贵模型。

建议初始配置：

- `gpt-5.6-terra`
  - 默认主力模型。
  - 用于客户研究、产品匹配、开发信生成。
  - 平衡质量和成本。
- `gpt-5.6-luna`
  - 高量低成本任务。
  - 用于字段清洗、简单分类、事件解析、重复检查。
- `gpt-5.6-sol`
  - 高价值客户或复杂客户。
  - 用于难判断客户、重点客户邮件、人工审核前的最终润色。

建议从 `gpt-5.6-terra` 开始，不急着上来就全部用 `sol`。

## Agent 角色拆分

第一阶段可以先做成一个 Agent，一次返回所有字段。

第二阶段再拆成这些角色：

### 1. Lead Agent

输入：

- 公司名
- 官网
- 邮箱
- 国家/区域，如果已有
- 历史跟进状态

输出：

- `qualified`: 是否值得开发
- `reason`: 判断理由
- `missingFields`: 缺失字段
- `riskFlags`: 风险标记，例如邮箱可疑、官网打不开、行业不匹配

### 2. Research Agent

输入：

- 公司名
- 官网
- 官网抓取文本

输出：

- `country`
- `region`
- `industry`
- `customerType`: factory / contractor / trader / distributor / unknown
- `customerProfile`
- `painPoints`
- `evidence`

### 3. Product Match Agent

输入：

- 客户画像
- 行业
- 应用场景
- 明纬产品知识库

输出：

- `recommendedProducts`
- `recommendedCategories`
- `reasoning`
- `advantages`

### 4. Copywriter Agent

输入：

- 客户画像
- 推荐产品
- 业务员信息
- 邮件模板规则

输出：

- `emailSubject`
- `emailBody`
- `personalizationNotes`

### 5. Compliance Agent

输入：

- 邮件主题
- 邮件正文
- 发件人信息
- 公司地址/退订信息

输出：

- `approved`
- `issues`
- `revisedSubject`
- `revisedBody`
- `complianceScore`

### 6. Reply/Event Agent

输入：

- Brevo/Smartlead/Instantly 事件
- 客户历史
- 邮件内容
- 客户回复正文，如果有

输出：

- `replyIntent`: interested / not_interested / unsubscribe / out_of_office / bounce / question / neutral
- `nextAction`
- `suggestedReply`
- `updateFields`

## 第一阶段推荐输出格式

n8n 最好只接收结构化 JSON，不要让模型自由输出正文混杂文本。

```json
{
  "qualified": true,
  "country": "India",
  "region": "Asia",
  "industry": "Automotive lighting",
  "customerType": "factory",
  "customerProfile": "The company manufactures automotive lighting systems and supplies OEM customers.",
  "painPoints": [
    "stable power for lighting production equipment",
    "reliable power supply sourcing for industrial projects"
  ],
  "recommendedProducts": [
    {
      "name": "LRS series",
      "reason": "cost-effective enclosed power supplies for industrial equipment"
    }
  ],
  "emailSubject": "Power supply support for automotive lighting production",
  "emailBody": "Dear ...",
  "compliance": {
    "approved": true,
    "issues": []
  },
  "reviewRequired": true
}
```

## 对现有 n8n 的改造点

保留：

- `Read Feishu Table`
- `Filter & Determine Timing`
- `Process Companies`
- `Check Send Window`
- `Expand Email Targets`
- `Delay 90-120s`
- `Brevo Send Email`，测试期可保留
- Brevo webhook 回写线

替换或新增：

- 用 `OpenAI Agent HTTP Request` 替代 `/scrape` + `Build Gemini Prompt` + `Gemini Analysis`。
- 也可以保留 `/scrape`，让 n8n 抓网页，Agent 只负责分析和写信。
- 新增 `Human Review Required?` 节点，前 50-100 个客户建议必须人工确认。
- 新增 `Update Feishu - Draft`，把草稿、画像、推荐产品先写回飞书，不一定立刻发送。

建议第一版流程：

```text
Read Feishu Table
  ↓
Filter & Determine Timing
  ↓
OpenAI Agent HTTP Request
  ↓
Update Feishu - Draft/Profile
  ↓
Human Review Required?
  ↓
Send Email
  ↓
Update Follow-up
```

## Agent Service API 设计

### POST `/agent/outbound-draft`

用途：生成客户画像、产品匹配和开发信草稿。

请求：

```json
{
  "recordId": "recxxxx",
  "companyName": "Example Company",
  "website": "https://example.com",
  "emails": ["buyer@example.com"],
  "followUpStatus": 0,
  "lastFollowUp": "",
  "lastOpenTime": "",
  "existingCustomerProfile": "",
  "sales": {
    "name": "Sales Name",
    "whatsapp": "+86...",
    "website": "https://..."
  }
}
```

响应：

```json
{
  "recordId": "recxxxx",
  "qualified": true,
  "reviewRequired": true,
  "country": "India",
  "region": "Asia",
  "industry": "Automotive lighting",
  "customerType": "factory",
  "customerProfile": "...",
  "recommendedProducts": [],
  "emailSubject": "...",
  "emailBody": "...",
  "compliance": {
    "approved": true,
    "issues": []
  },
  "debug": {
    "model": "gpt-5.6-terra",
    "runId": "..."
  }
}
```

### POST `/agent/event-analysis`

用途：分析打开、点击、回复、退信，并给出下一步动作。

请求：

```json
{
  "recordId": "recxxxx",
  "event": "opened",
  "email": "buyer@example.com",
  "occurredAt": "2026-08-01T12:00:00.000Z",
  "replyText": "",
  "history": {}
}
```

响应：

```json
{
  "recordId": "recxxxx",
  "intent": "opened",
  "nextAction": "wait_3_days",
  "suggestedFields": {
    "最后打开时间": 1785585600000
  },
  "notes": "Opened but no reply yet."
}
```

## 必备配置

Agent Service 环境变量：

- `OPENAI_API_KEY`
- `OPENAI_MODEL_DEFAULT=gpt-5.6-terra`
- `OPENAI_MODEL_CHEAP=gpt-5.6-luna`
- `OPENAI_MODEL_HIGH_VALUE=gpt-5.6-sol`
- `AGENT_SERVICE_TOKEN`
- `SALES_TEAM_NAME=MEAN WELL KULON TEAM`
- `SALES_EMAIL=Sales@kulon.com`
- `YOUR_COMPANY_NAME=Hangzhou Kulon Electronics Co.,Ltd.`
- `YOUR_WEBSITE`
- `SIGNATURE_BACKGROUND_URL`
- `COMPANY_ADDRESS`
- `UNSUBSCRIBE_BASE_URL`

n8n Variables：

- `AGENT_SERVICE_URL`
- `AGENT_SERVICE_TOKEN`
- `FROM_EMAIL`
- `BREVO_WEBHOOK_TOKEN`

## 人工审核规则

前期必须人工审核：

- 前 50-100 个客户
- 所有高价值客户
- 所有 `compliance.approved = false` 的客户
- 所有 `customerType = unknown` 的客户
- 所有模型置信度低的客户

后期可以自动发送：

- 官网抓取成功
- 邮件合规检查通过
- 推荐产品不为空
- 客户类型明确
- 邮箱不在黑名单/退订列表
- 跟进状态和时间窗口满足条件

## 合规和送达率底线

正式跑之前必须具备：

- SPF
- DKIM
- DMARC
- 退订机制
- 实体地址
- 黑名单/suppression list
- 退信处理
- 发送频率限制
- 多邮箱/多域名信誉管理

不建议让 Agent 直接调用 Gmail/Brevo 大量发送。Agent 只生成和判断，冷邮件投递最好交给 Smartlead、Instantly 或 Apollo。

## 推荐落地顺序

### 第 1 步：不动发送，只替换 Gemini

目标：用 OpenAI Agent 替代现在的 Gemini 写信。

做法：

1. 保留 n8n 主流程。
2. 新建 `agent-service`。
3. n8n 调 `/agent/outbound-draft`。
4. 写回飞书草稿。
5. 先不自动发，只人工看 10 个客户结果。

### 第 2 步：加人工审核

目标：飞书里加一个审核状态字段。

建议字段：

- `AI草稿主题`
- `AI草稿正文`
- `AI客户画像`
- `AI推荐产品`
- `AI合规结果`
- `人工审核状态`: pending / approved / rejected
- `是否允许发送`

### 第 3 步：接专业冷邮件平台

目标：把发送从 Brevo 测试通道迁移到 Smartlead/Instantly。

n8n 负责：

- 推送 approved lead 到冷邮件平台
- 接收事件 webhook
- 回写飞书

### 第 4 步：回复分析 Agent

目标：收到回复后自动分类，并生成建议回复。

注意：所有真实回复建议先人工确认，不建议一开始自动回复客户。

## 最小可行版本

最小版本只需要：

1. 一个 Node.js Agent Service。
2. 一个 `/agent/outbound-draft` 接口。
3. OpenAI `gpt-5.6-terra`。
4. n8n HTTP Request 节点调用这个接口。
5. 飞书写回 AI 草稿。
6. 人工确认后再发。

这比一上来完全重做更稳，也能最大程度复用你已经跑通的 n8n。
