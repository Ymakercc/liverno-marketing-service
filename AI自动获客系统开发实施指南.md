# AI 自动获客系统当前实现说明

> 文档范围：只说明当前目录中已经存在的系统、实际代码结构、业务流程、运行数据和已知问题。
>
> 基线日期：2026-09-20。
>
> 本文不记录真实 API Key、App Secret、邮箱授权码、自动化 Token、客户数据或内部密码。

---

## 1. 系统是什么

当前项目是一套面向外贸 B2B 的 AI 自动获客与邮件营销系统。

它不是单纯的 n8n 工作流，也不是完全自主的 AI Agent。更准确的结构是：

> **n8n 定时调度 + Node.js 业务后端 + AI 客户分析和邮件生成 + CRM/邮件平台集成 + SQLite 状态管理。**

系统完成的主要工作是：

```text
从孚盟读取候选客户
→ 使用 Apollo 匹配公司和联系人
→ 抓取客户官网证据
→ 使用 AI 判断公司是否精准
→ 使用 AI 生成个性化开发信
→ 匹配真实产品、报价和产品图
→ 通过代码进行邮件质检
→ 按客户当地工作时间排队
→ 通过 Brevo 发送
→ 接收送达、打开、点击和退信状态
→ 读取阿里企业邮箱中的客户回复
→ 使用固定规则和 MiMo 判断是否为询盘
→ 将结果同步到飞书和孚盟
```

### 1.1 为什么它不是纯 n8n 系统

当前 n8n 只负责定时调用后端接口：

- 每 10 分钟触发客户背调和营销排队。
- 每 15 分钟触发到期邮件发送。
- 每 5 分钟触发企业邮箱读取。

客户筛选、Apollo 评分、AI 质检、队列、时区、额度、退信抑制和二次跟进都由 Node.js 后端处理。

### 1.2 为什么它不是完全自主 Agent

AI 在当前系统中负责：

- 理解客户公司和官网内容。
- 判断公司业务是否与电源产品匹配。
- 生成客户画像和开发信。
- 推荐产品系列。
- 判断收到的邮件是不是询盘。

但 AI 不负责：

- 自主规划整条流程。
- 自由选择和调用外部工具。
- 决定是否绕过发送开关。
- 管理每日额度和任务幂等。
- 直接修改密钥或数据库。
- 自主决定真实发送。

因此当前系统属于“带 AI 判断能力的确定性自动化工作流”。

---

## 2. 总体架构

```text
                    ┌──────────────────────┐
                    │ 孚盟 CRM 营销公海池 │
                    │ 客户、联系人、跟进  │
                    └──────────┬───────────┘
                               │
                               ▼
┌──────────┐ HTTP 调用 ┌──────────────────────────┐
│   n8n    ├──────────►│ Node.js Marketing Console│
│ 定时调度 │           │ 默认端口 8787           │
└──────────┘           └────────────┬─────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
       ┌────────────┐        ┌────────────┐        ┌────────────┐
       │   Apollo   │        │ 官网研究/AI│        │ 飞书多维表 │
       │公司/联系人 │        │筛选和写信  │        │审计与看板  │
       └────────────┘        └──────┬─────┘        └────────────┘
                                    │
                                    ▼
                          ┌──────────────────┐
                          │ SQLite 营销队列  │
                          └────────┬─────────┘
                                   │ 时区、额度、状态复核
                                   ▼
                          ┌──────────────────┐
                          │ Brevo 邮件发送   │
                          └────────┬─────────┘
                                   │ Webhook
                                   ▼
                         送达/打开/点击/退信
                                   │
                        ┌──────────┴──────────┐
                        ▼                     ▼
                 SQLite 投递库          飞书状态汇总

客户回复 → 阿里企业邮箱 IMAP → 固定规则/MiMo 分类
        → 询盘、普通回复、自动回复、无关邮件
        → 飞书同步、停止后续营销、销售人工跟进
```

### 2.1 各组件职责

| 组件 | 当前职责 |
|---|---|
| n8n | 定时触发、检查后端能力、调用自动化接口 |
| Node.js 后端 | 核心业务流程、API、权限、状态机和前端服务 |
| 孚盟 | 客户和联系人主数据、邮件跟进记录 |
| Apollo | 公司匹配、目标职位搜索、邮箱补全 |
| 官网研究 | 提取客户业务和产品证据 |
| AI 中转站 | 公司判断、客户画像、产品建议和开发信 |
| 飞书多维表格 | 背调审计、发送状态、投递汇总和询盘看板 |
| SQLite | 营销队列、幂等、冷却期、抑制和事件记录 |
| Brevo | 实际发送邮件和投递事件回传 |
| 阿里企业邮箱 | 接收客户回复 |
| Xiaomi MiMo | 对人工回复进行询盘意图分类 |

---

## 3. 当前目录结构

```text
n8n项目/
├─ src/                         核心后端源码
│  ├─ server.mjs               HTTP 服务入口、API、鉴权和组件装配
│  ├─ config.mjs               读取 .env 并生成统一配置
│  ├─ services/                业务流程编排
│  │  ├─ marketing-service.mjs 获客、筛选、排队、发送、二次跟进
│  │  ├─ enrichment-service.mjs Apollo 公司和联系人补全
│  │  ├─ draft-service.mjs     AI 客户判断和开发信生成
│  │  └─ mailbox-monitor.mjs   企业邮箱读取和询盘分类
│  └─ lib/                     外部客户端、数据库和通用工具
│
├─ public/                      浏览器控制台和邮件预览页面
├─ workflows/                   当前 n8n 定时工作流
├─ scripts/                     部署、验证、迁移和数据维护脚本
├─ test/                        Node.js 自动化测试
├─ templates/                   HTML 模板
├─ docs/                        项目说明和交接文档
│
├─ .data/                       本机数据库、日志、备份和导入包
├─ .local_docs/                 孚盟 API 文档和报价资料
├─ .cloudflared/                Cloudflare Tunnel 本机配置
├─ .tools/                      cloudflared 等本地工具
├─ .tmp_backups/                历史临时备份
├─ hostinger-email-assets/      准备上传公网的邮件图片
├─ node_modules/                npm 依赖
│
├─ .env                         当前机器的真实配置和密钥
├─ .env.example                 可提交的配置模板
├─ package.json                 项目信息和运行命令
├─ README.md                    当前版本主说明
│
├─ n8n.json                     旧版完整 n8n 流程
├─ workflow-live*.json          旧版线上流程备份
├─ gemini_prompt_template.txt   旧版 Gemini Prompt
└─ 项目运行手册.md              旧版 n8n 运行手册
```

### 3.1 目录之间的关系

```text
workflows/      决定什么时候调用
      ↓
src/server.mjs  接收 HTTP 请求并连接所有模块
      ↓
src/services/   决定业务步骤和顺序
      ↓
src/lib/        调用外部 API、操作数据库、处理邮件和时区
      ↓
.data/          保存执行状态和历史结果

public/         通过 server.mjs 提供给浏览器
scripts/        独立执行部署、验证和维护任务
test/           验证 src/ 中的行为
```

---

## 4. 核心源码模块

### 4.1 `src/server.mjs`

[`src/server.mjs`](src/server.mjs) 是项目启动入口。

运行：

```powershell
npm start
```

实际执行：

```powershell
node src/server.mjs
```

它负责：

- 创建 HTTP 服务。
- 默认监听 `8787`。
- 初始化外部 API Client。
- 初始化 SQLite Store。
- 初始化 Service 业务层。
- 提供浏览器控制台。
- 接收 n8n 自动化请求。
- 接收 Brevo Webhook。
- 处理网页登录和设置修改。
- 统一返回 JSON 和错误信息。

主要接口：

```text
/api/auth/*                 网页登录和密码设置
/api/health                 系统能力和运行开关
/api/settings/*             模型、邮箱和营销配置
/api/customers              孚盟客户
/api/marketing              营销队列和筛选结果
/api/delivery               投递状态
/api/inbox                  客户回复
/api/webhooks/brevo         Brevo 状态回传
/api/automation/*           n8n 自动化入口
/api/feishu/*               飞书记录
/api/drafts/*               AI 草稿
```

### 4.2 `src/config.mjs`

[`src/config.mjs`](src/config.mjs) 读取 `.env`，并把配置整理成：

```text
server        服务地址和端口
auth          网页登录
fumeng        孚盟 API
apollo        Apollo API
openai        AI 中转站
mimo          收件箱 AI 分类
feishu        飞书多维表格
brevo         邮件发送和 Webhook
mailbox       阿里企业邮箱 IMAP
emailAssets   产品图片
marketing     营销开关、限额和规则
sales         发件团队身份
pricing       报价目录和价格换算
```

`/api/health` 会将配置转换成能力状态，供 n8n 判断是否继续执行。

### 4.3 `src/services/marketing-service.mjs`

[`src/services/marketing-service.mjs`](src/services/marketing-service.mjs) 是当前系统最核心的业务文件。

它负责：

- 扫描孚盟候选客户。
- 控制每日营销公司目标。
- 控制 Apollo 背调次数。
- 调用飞书建立审计记录。
- 调用 Apollo 补全。
- 调用官网研究和 AI。
- 判断公司是否精准。
- 进行邮件质检。
- 匹配具体产品、价格和图片。
- 计算客户时区。
- 创建首封邮件队列。
- 创建第二轮跟进队列。
- 发送到期邮件。
- 回写飞书和孚盟。

主要方法：

```text
listCandidates()             查找候选客户
runDailyMarketing()          执行当日获客流程
prepareCustomer()            完整处理一家公司
queueManualDraft()           将手动草稿加入队列
getSecondTouchCandidates()   选择第二轮联系人
queueSecondTouch()           创建第二轮任务
sendDue()                    发送到期邮件
```

### 4.4 `src/services/enrichment-service.mjs`

[`src/services/enrichment-service.mjs`](src/services/enrichment-service.mjs) 负责 Apollo 公司和联系人补全。

具体处理：

```text
孚盟公司
→ Apollo 公司查找
→ 公司匹配评分
→ 目标职位搜索
→ 联系人评分
→ People Match 获取邮箱
→ 补充或新增孚盟联系人
```

### 4.5 `src/services/draft-service.mjs`

[`src/services/draft-service.mjs`](src/services/draft-service.mjs) 负责组织 AI 输入。

输入包括：

- 孚盟客户资料。
- 官网证据。
- Apollo 公司资料。
- 联系人姓名和职位。
- 公司判断和开发信规则。

要求 AI 返回结构化的：

- 公司是否精准。
- 判断理由。
- 客户画像。
- 产品系列建议。
- 邮件主题和正文。
- 风险标记。
- 合规结果。

联系人邮箱不会发送给营销文案模型。

### 4.6 `src/services/mailbox-monitor.mjs`

[`src/services/mailbox-monitor.mjs`](src/services/mailbox-monitor.mjs) 负责收件箱闭环：

- 连接阿里企业邮箱 IMAP。
- 根据 UID 增量读取邮件。
- 清理正文和 HTML。
- 匹配原始营销邮件。
- 识别退信、自动回复和退订。
- 调用 MiMo 判断人工邮件意图。
- 保存到 `inbox.sqlite`。
- 同步飞书。
- 对真实回复者停止后续营销。

---

## 5. `src/lib/` 底层模块

### 5.1 外部系统客户端

| 文件 | 作用 |
|---|---|
| `fumeng-client.mjs` | 孚盟鉴权、客户、联系人和跟进记录 |
| `apollo-client.mjs` | Apollo 公司和联系人接口 |
| `feishu-client.mjs` | 飞书字段、记录、发送和询盘状态 |
| `brevo-client.mjs` | Brevo 访问检查和真实发送 |
| `openai-client.mjs` | OpenAI 兼容的营销 AI 调用 |
| `mimo-client.mjs` | MiMo 回复意图分类 |

### 5.2 SQLite Store

| 文件 | 作用 |
|---|---|
| `marketing-store.mjs` | 营销队列、去重、重试、冷却、排除和抑制 |
| `delivery-store.mjs` | Brevo 事件去重、消息状态和投递汇总 |
| `inbox-store.mjs` | 收件箱邮件、分类和飞书同步状态 |

### 5.3 邮件、产品和时区工具

| 文件 | 作用 |
|---|---|
| `email-composer.mjs` | 生成首封、第二轮 HTML 和纯文本邮件 |
| `price-catalog.mjs` | 读取报价目录、计算价格、选择具体型号 |
| `product-images.mjs` | 匹配具体型号产品图 |
| `scheduling.mjs` | 国家、州、城市、时区和工作时间 |
| `website-research.mjs` | 抓取官网并阻止私网访问 |
| `inbound-email-html.mjs` | 清洗客户邮件 HTML 和跟踪内容 |

### 5.4 配置和安全工具

| 文件 | 作用 |
|---|---|
| `web-auth.mjs` | scrypt 密码哈希、Session 和 Cookie |
| `mailbox-settings.mjs` | AES-256-GCM 加密邮箱授权码 |
| `marketing-settings.mjs` | 修改营销和发送开关 |
| `relay-settings.mjs` | 修改 AI 中转站配置 |
| `mimo-settings.mjs` | 修改 MiMo 配置 |
| `network-access.mjs` | 判断本机和私有局域网地址 |
| `customer-eligibility.mjs` | 判断客户状态是否允许营销 |
| `errors.mjs` | 统一业务错误 |

---

## 6. 当前三条 n8n 工作流

新版工作流保存在 [`workflows/`](workflows/) 中。

### 6.1 客户背调和营销排队

文件：`kulon-candidate-preparation.json`

周期：每 10 分钟。

```text
手动触发 / 定时触发
→ GET /api/health
→ 检查 Apollo、孚盟写回、AI、飞书、Automation Token
→ POST /api/automation/run-daily
```

如果 Apollo 新增背调被暂停，这条工作流不会继续调用每日获客接口。

### 6.2 到期邮件发送

文件：`kulon-send-dispatch.json`

周期：每 15 分钟。

```text
手动触发 / 定时触发
→ GET /api/health
→ 检查发送能力、飞书和 Automation Token
→ POST /api/automation/send-due
```

### 6.3 企业邮箱监控

文件：`kulon-inbox-monitoring.json`

周期：每 5 分钟。

```text
手动触发 / 定时触发
→ GET /api/health
→ 检查邮箱监控和 Automation Token
→ POST /api/automation/inbox/poll
```

### 6.4 n8n 鉴权

三条工作流都使用：

```http
Authorization: Bearer <AUTOMATION_TOKEN>
```

后端使用常量时间比较 Token，防止直接字符串比较造成的时序侧信道。

工作流源模板默认 `active: false`，导入后不会自动激活。实际 n8n 实例里的激活状态需要在该实例中检查。

---

## 7. 候选客户筛选

系统从孚盟营销公海读取客户，按最后跟进时间升序扫描。

当前规则：

- 只处理配置的公海所属人。
- 跳过状态 ID `3`、`5`、`6`。
- 跳过最近 7 天已经背调、排队或发送过的客户。
- 每次读取 50 条，并持续翻页。
- 达到每日公司目标、没有候选或达到背调上限时停止。

三个每日数量配置含义不同：

| 配置 | 当前含义 |
|---|---|
| `DAILY_COMPANY_LIMIT` | 每天希望成功进入营销的公司数 |
| `DAILY_RESEARCH_LIMIT` | 每天最多调用 Apollo 背调的公司数 |
| `DAILY_SEND_LIMIT` | 每天最多实际发送的邮件数 |

队列可以超过当天发送额度；未发送任务留在后续工作日继续处理。

---

## 8. 飞书背调审计

系统处理一家公司时，首先在飞书创建背调记录：

```text
读取孚盟客户和联系人
→ 飞书创建“背调中”记录
→ 取得飞书 recordId
→ 才调用 Apollo
```

如果飞书创建失败：

- 不调用 Apollo。
- 本地记录排除/失败原因。
- 返回错误。

Apollo 完成后，飞书记录会更新：

- 公司和联系人信息。
- Apollo 公司置信度。
- 官网证据。
- AI 判断结果。
- 邮件草稿。
- 联系人处理结果。
- 是否进入营销队列。
- 未进入队列的原因。

飞书用于审计和运营查看，真正的任务状态仍保存在 SQLite。

---

## 9. Apollo 公司和联系人补全

### 9.1 公司评分

| 证据 | 分数 |
|---|---:|
| 基础分 | 5 |
| 官网域名完全一致 | +80 |
| 公司标准化名称完全一致 | +75 |
| 公司名称 Token 相似 | 最多 +40 |
| 国家或国家代码一致 | +15 |
| 行业相似 | +5 |
| 总分上限 | 100 |

当前通过阈值为 75。

搜索顺序：

```text
官网域名
→ Organization Enrichment
→ 达到阈值则接受

未找到或未达到阈值
→ Organization Search（名称 + 国家）
→ 无结果时移除国家条件重试
→ 选择评分最高的公司
```

### 9.2 联系人评分

| 证据 | 分数 |
|---|---:|
| Procurement/Purchasing/Sourcing/Buyer | +50 |
| Engineering/Technical/Product | +40 |
| Owner/Founder/Managing Director/CEO | +35 |
| Director/Head/Manager | +15 |
| Apollo 已验证邮箱 | +30 |
| LinkedIn | +5 |

联系人处理顺序：

```text
孚盟已有联系人邮箱
→ Apollo People Match

仍有联系人名额
→ Apollo People Search
→ 按职位评分排序
→ People Match 获取邮箱
```

每家公司最多保留 5 个不同邮箱。

### 9.3 孚盟写回

系统只补充空字段或新增联系人：

- 客户没有官网时补充官网。
- 联系人没有姓名时补充姓名。
- 联系人没有邮箱时补充邮箱。
- 联系人没有 LinkedIn 时补充 LinkedIn。
- 在备注中记录 Apollo Person ID 和补全时间。
- 找到新联系人时可以在孚盟新增联系人。

如果孚盟写回开关关闭，系统只生成变更计划，不真实写入。

---

## 10. 官网研究和公司精准度判断

官网研究提取：

- 页面标题。
- Description。
- Keywords。
- 页面正文。
- MEAN WELL 相关内容。
- 电源、自动化、控制柜、LED、系统集成等关键词。

安全限制：

- 禁止访问回环地址。
- 禁止访问私有局域网地址。
- 重定向后重新检查目标地址。
- 限制下载 HTML 大小。
- 限制发送给 AI 的证据长度。

AI 综合以下证据判断公司是否精准：

```text
孚盟 CRM 资料
+ 官网证据
+ Apollo 公司信息
```

主要目标客户包括：

- 电源、电气和电子元器件分销商。
- 工业自动化、控制系统、控制柜。
- LED 照明和驱动。
- 系统集成商。
- 通信、安防和能源设备公司。
- 产品中包含电气控制、驱动、充电或电源转换部件的设备制造商。

结果分为：

```text
qualified=true
→ 公司精准，继续处理联系人和邮件

qualified=false + reviewRequired=true
→ 证据不足，待核验，不发送

qualified=false + reviewRequired=false
→ 可靠证据表明业务无关，明确排除
```

如果官网无法访问或内容太少，系统不会因为“没有官网证据”直接判定非精准，而会保守进入待核验。

如果官网直接展示 MEAN WELL，并出现工业自动化或电源产品证据，代码可直接把公司判断为精准。

---

## 11. AI 邮件生成和代码质检

AI 生成：

- 公司精准度和判断依据。
- 客户画像。
- 个性化依据。
- 推荐产品系列。
- 英文邮件主题。
- 英文邮件正文。
- 风险标记。
- 合规检查结果。

AI 不生成最终完整邮件签名。最终邮件由代码拼接：

```text
AI 个性化正文
+ 代码生成的产品价格卡片
+ 统一团队签名
```

代码质检包括：

- AI 必须判定公司精准。
- AI 合规检查必须通过。
- 主题不能为空且不能超过 100 字符。
- 正文长度必须在 70–230 个英文词。
- 不能残留 `{{name}}`、`[company]` 等占位符。
- 英文正文不能残留中文字符。
- 收件邮箱格式必须有效。
- Apollo 新数据必须成功写回孚盟。
- 不能存在联系人写回错误。

邮件自动审批评分主要来自：

```text
Apollo 公司置信度 × 60%
+ 已验证邮箱 20 分
+ 联系人职位和 LinkedIn 最多 10 分
+ 邮箱格式 10 分
+ 公司精准且 AI 合规 10 分
```

当前自动审批阈值为 85。

---

## 12. 产品、报价和图片

AI 只推荐产品系列或类别，例如：

```text
LRS
HDR
HLG
DIN-rail power supply
LED driver
```

具体型号和价格由代码从本地报价目录选择：

```text
AI 推荐系列
→ 报价目录匹配具体型号
→ 计算营销价格
→ CNY 转 USD
→ 查找对应产品图
→ 生成邮件产品卡片
```

当前报价目录：

- 1334 个有效条目。
- 数据日期为 2026-08-29。
- 首封邮件要求匹配 6–8 个具体型号。
- 第二轮邮件要求 4 个具体型号。

产品图片只接受：

- 完整型号图片。
- Manifest 中明确映射的型号图片。
- 可以证明属于具体基础型号的图片。

不会使用纯系列 Banner 或分类代表图冒充型号实物图。

如果报价目录不可用、型号不足或图片缺失，系统不会把客户标成非精准，而是记录“营销目标·待补全”，暂不发送。

---

## 13. 营销队列和发送

通过质检的联系人会写入 `.data/marketing.sqlite`。

任务包含：

- Campaign。
- 客户和联系人 ID。
- 公司和联系人名称。
- 收件邮箱。
- 客户国家和时区。
- 主题、HTML、纯文本。
- 计划发送时间。
- 质量分数。
- Apollo 元数据。
- AI 草稿。
- 飞书记录 ID。
- 状态、尝试次数和失败原因。

任务使用唯一去重键，防止同一 Campaign、客户和邮箱重复排队。

### 13.1 时区和发送窗口

系统根据国家、州和城市解析 IANA 时区。

当前默认发送窗口是收件人当地时间：

```text
09:00–16:00
```

同一客户会增加确定性的 0–44 分钟偏移，避免大量邮件在整点同时发送。

### 13.2 发送前复核

`sendDue()` 会重新检查：

- 营销总开关是否开启。
- Brevo 真实发送开关是否开启。
- 当天是否还有发送额度。
- 当前是否处于收件人当地工作时间。
- 邮箱是否处于抑制名单。
- 邮件是否使用当前报价模板。
- 产品图片是否完整。
- 是否绑定飞书记录。
- 孚盟客户状态是否仍允许营销。
- 联系人是否仍存在于孚盟。
- Brevo 账户是否可以访问。

发送成功后：

1. 营销任务标记为 `sent`。
2. 投递库记录 `sent` 事件。
3. 飞书更新为“已发送”。
4. 孚盟写回开启时，创建邮件跟进记录。

Brevo 出现账户级 401/403 时，当前批次剩余任务整体推迟 15 分钟，不会逐条消耗重试次数。

---

## 14. Brevo 投递事件

Brevo 回调接口：

```text
POST /api/webhooks/brevo
```

支持 Bearer Token 或 `x-brevo-webhook-token` 鉴权。

事件标准化为：

```text
accepted
sent
delivered
opened
clicked
deferred
soft_bounce
hard_bounce
invalid_email
blocked
spam
unsubscribed
error
```

事件唯一键由消息、事件、时间和链接计算，重复 Webhook 不会重复计数。

以下状态会停止该邮箱后续营销：

- `hard_bounce`
- `invalid_email`
- `blocked`
- `spam`
- `unsubscribed`

投递状态会按飞书公司记录汇总多个联系人，更新：

- 送达状态。
- 打开次数。
- 点击次数。
- 最后发送、打开和点击时间。
- 最后点击链接。
- 退信原因。
- 下一步建议。

---

## 15. 第二轮营销

第二轮 Campaign 名称是：

```text
second_touch_v1
```

进入条件：

- 首封属于 `initial_outreach_v1`。
- 首封已经发送。
- 至少打开 1 次。
- 没有硬退信、无效邮箱、拦截、投诉或退订。

等待规则：

- 打开至少 2 次：等待 2 个工作日。
- 只打开 1 次：等待 5 个工作日。

其他限制：

- 每家公司最多选择 2 个打开者。
- 当前试运行总上限为 50 封。
- 复用首封保存的公司画像和产品建议。
- 不再次调用 Apollo。
- 必须有 4 个带 USD 价格和具体产品图的产品。
- 第二轮任务在发送队列中优先于首封任务。

---

## 16. 收件箱和询盘识别

客户回复通过阿里企业邮箱 IMAP 读取，不依赖 Brevo Webhook。

处理链路：

```text
IMAP 增量读取
→ 解析 MIME 邮件
→ 清理 HTML、脚本和跟踪像素
→ 根据 In-Reply-To、References 或发件人匹配营销任务
→ 固定规则分类
→ 其余人工邮件交给 MiMo
→ 保存 inbox.sqlite
→ 同步飞书
→ 对真实回复邮箱停止后续营销
```

固定规则优先识别：

- 退信。
- 自动回复。
- 退订。
- KULON 内部或测试邮件。
- 第三方 B2B 平台线索通知。

MiMo 对人工邮件分类：

```text
inquiry             明确询盘
potential_interest  潜在意向
ordinary_reply      普通回复
unrelated           无关邮件
```

系统同时保存：

- 分类结果。
- 置信度。
- 判断理由。
- 需求摘要。
- 匹配到的公司和联系人。
- 飞书同步状态。

MiMo 不可用时使用保守规则降级，不会把所有人工回复直接认定为询盘。

---

## 17. 三套 SQLite 数据库

| 数据库 | 当前作用 |
|---|---|
| `.data/marketing.sqlite` | 营销任务、背调、排除、冷却、重试和抑制 |
| `.data/delivery.sqlite` | Brevo 消息、送达、打开、点击、退信和退订 |
| `.data/inbox.sqlite` | 客户回复、HTML、意图分类和飞书同步 |

### 17.1 `marketing.sqlite`

主要保存：

- 邮件任务。
- 任务状态变化。
- Apollo 背调历史。
- 公司排除和待补全原因。
- 每日筛选批次。
- 邮箱抑制名单。
- 首封和第二轮 Campaign。

### 17.2 `delivery.sqlite`

主要保存：

- Brevo 原始事件。
- 标准化事件类型。
- 消息当前状态。
- 打开和点击次数。
- 退信原因。
- 点击链接。
- 飞书记录和孚盟客户关联。

### 17.3 `inbox.sqlite`

主要保存：

- 邮件基本信息。
- IMAP UID 和读取游标。
- 清洗后的正文和 HTML。
- 固定规则或 MiMo 分类。
- AI 判断依据和置信度。
- 对应营销任务。
- 飞书同步状态。

---

## 18. 浏览器控制台

[`public/`](public/) 是纯 HTML、CSS 和 JavaScript 前端，没有使用 React 或 Vue。

主要文件：

| 文件 | 作用 |
|---|---|
| `index.html` | 控制台主页面 |
| `app.js` | 调用后端 API 和渲染页面 |
| `styles.css` | 控制台样式 |
| `login.*` | 登录页面 |
| `email-templates.*` | 邮件模板展示 |
| `email-artwork-preview.*` | 首封邮件视觉预览 |
| `second-touch-preview.*` | 第二轮预览 |
| `sent-email-preview.*` | 已发送邮件预览 |
| `signature-preview.*` | 签名预览 |
| `marketing-email-builder.*` | 邮件构建页面 |

控制台模块包括：

- 系统总览。
- 客户池。
- AI 审核。
- 发送队列。
- 投递状态。
- 询盘回复。
- 排除留痕。
- 邮件模板。
- 系统连接。
- 使用说明。

网页登录使用 scrypt 密码哈希和 7 天 Session Cookie。

---

## 19. 脚本和测试

### 19.1 `scripts/`

主要脚本分为：

### 配置和连通性

```text
preflight.mjs
fumeng-smoke-test.mjs
apollo-smoke-test.mjs
relay-smoke-test.mjs
```

### n8n 工作流

```text
validate-n8n-workflows.mjs
prepare-n8n-import.mjs
sanitize-workflow.mjs
```

### Brevo 和 Tunnel

```text
register-brevo-webhook.mjs
brevo-webhook-gateway.mjs
run-brevo-tunnel.mjs
start-tracking-stack.mjs
```

### 数据回填和维护

```text
backfill-feishu-delivery.mjs
backfill-feishu-research.mjs
backfill-screening-outcomes.mjs
dedupe-feishu-companies.mjs
refresh-queued-email-html.mjs
reschedule-timezone-queue.mjs
requeue-image-blocked-drafts.mjs
```

### 19.2 `test/`

项目使用 Node.js 自带的 `node:test`：

```powershell
npm test
```

测试覆盖：

- Apollo、孚盟、飞书和 Brevo 客户端。
- 公司和联系人评分。
- AI 输入隐私和结构化输出。
- 邮件质检。
- 产品报价和图片。
- 队列幂等和每日额度。
- 时区发送。
- 第二轮规则。
- Webhook 去重。
- 退信抑制。
- 企业邮箱分类。
- 网页密码和 Session。
- 官网私网访问阻断。

当前测试结果：

```text
总计 163 项
通过 161 项
失败 2 项
```

两项失败都与 Windows 文件权限位有关：代码期望敏感文件为 Unix `0600`，Windows 实际返回 `0666`。业务流程测试没有因此失败，但 Windows 上的敏感文件权限需要依赖 NTFS ACL，而不能只依赖 POSIX mode。

---

## 20. 本机运行资料目录

### 20.1 `.data/`

保存当前机器运行状态：

- 三套 SQLite 数据库。
- 邮箱加密配置和密钥。
- 服务日志。
- n8n 本机导入包。
- 小批量验证结果。
- 数据库备份。

整个目录被 Git 忽略。

### 20.2 `.local_docs/`

保存本机业务资料：

- 孚盟 API 原始文档。
- 客户、联系人和跟进接口说明。
- Excel 报价表。
- 程序可解析的 Markdown 报价目录。

该目录不提交 Git。

### 20.3 `.cloudflared/`

保存 Cloudflare Tunnel 配置和本机凭据，用于把 Brevo 公网 Webhook 转发到本机隔离网关。

### 20.4 `.tools/`

当前包含本地 `cloudflared` 可执行文件。

### 20.5 `hostinger-email-assets/`

保存准备上传到 Hostinger 的邮件图片：

- Logo。
- 签名背景。
- 邮件 Banner。

真实邮件必须引用公网 HTTPS 图片，不能使用本机文件路径。

---

## 21. 旧版 n8n 流程

根目录中的以下文件属于旧版本：

```text
n8n.json
workflow-live.after.fix.json
workflow-live.to-import.fix-gemini.json
gemini_prompt_template.txt
template-mail.md
项目运行手册.md
```

旧版共 32 个 n8n 节点，主要链路是：

```text
飞书读取客户
→ Firecrawl 抓官网
→ Gemini 分析和生成邮件
→ n8n 判断时区
→ Brevo 直接发送
→ 飞书回写
→ Brevo Webhook 更新状态
```

旧流程不能直接重新启用，原因包括：

- `Parse & Schedule Time` 中仍存在 `forceDebugSend = true`。
- 旧流程可能绕过正常发送窗口。
- 包含旧变量 fallback。
- 包含旧发件邮箱配置。
- 使用旧飞书数据模型。
- 缺少新版 SQLite 队列和完整发送前复核。

当前实现应以：

```text
src/
+ workflows/kulon-*.json
```

为准。`workflows/n8n.sanitized.json` 只用于理解旧流程。

---

## 22. 当前配置状态

下面是当前本机 `.env` 的开关状态，只表示是否配置或是否开启，不包含真实密钥。

| 功能 | 当前状态 |
|---|---|
| 营销总开关 | 开启 |
| 孚盟写回 | 开启 |
| Brevo 真实发送 | 开启 |
| 第二轮营销 | 开启 |
| Apollo Key | 已配置 |
| Apollo 新增背调 | 暂停 |
| 飞书 | 已配置 |
| 营销 AI 中转站 | 已配置 |
| MiMo | 已配置并启用 |
| 企业邮箱 IMAP 监控 | 关闭 |
| Brevo Webhook | 已配置 |
| 网页密码 | 已配置 |

当前数量配置：

| 配置 | 当前值 |
|---|---:|
| 每日营销公司目标 | 100 |
| 每日 Apollo 背调上限 | 1000 |
| 每日发送上限 | 300 |
| 公司冷却期 | 7 天 |
| 每家公司联系人上限 | 5 |
| Apollo 公司匹配阈值 | 75 |
| 自动审批分数 | 85 |
| 当地发送窗口 | 09:00–16:00 |

当前本机没有以下端口监听：

```text
5678  n8n
8787  Node.js 控制台
8790  Brevo 隔离网关
```

因此系统此刻没有运行。但如果启动 Node.js 服务并启用 n8n 发送工作流，当前配置允许已有队列继续真实发送。

---

## 23. 当前历史数据

### 23.1 营销任务

```text
总任务            1620
已发送            1522
已取消              81
需要处理            17
首封任务          1570
第二轮任务          50
抑制邮箱           286
Apollo 背调记录   1422
排除/待补全记录   1049
```

### 23.2 Apollo 背调结果

```text
成功补全          658
背调失败          407
公司不匹配        339
找不到联系人       18
```

### 23.3 Brevo 消息当前状态

```text
已送达            589
已打开            254
已点击            175
硬退信            282
软退信             68
已发送无后续状态  151
退订                3
错误                2
```

硬退信约占全部投递消息的 18.5%。

### 23.4 收件箱分类

```text
总邮件             35
无关邮件           26
自动回复            4
普通回复            4
明确询盘            1
```

这些数据说明系统已经运行过实际营销，不是空白原型。

---

## 24. 当前已知问题和风险

### 24.1 未验证孚盟邮箱可能自动发送

当前联系人逻辑中：

- 孚盟已有邮箱会优先尝试 Apollo People Match。
- Apollo 没匹配上时，原孚盟邮箱仍可能保留。
- 邮件质检把 `fumeng` 视为可信联系人来源之一。
- 未验证邮箱只产生 warning，不一定产生硬错误。

因此以下情况可能自动入队：

```text
公司被 AI 判断为精准
+ 孚盟邮箱格式有效
+ 邮件没有硬性问题
```

这可能与当前 18.5% 的硬退信率有关。

### 24.2 客户状态采用默认允许

当前只明确排除状态 ID `3`、`5`、`6`，其他未知状态默认允许营销。

如果孚盟新增了“暂停联系”等状态，当前代码可能继续处理该客户。

### 24.3 Apollo 背调失败较多

1422 条背调中有 407 条失败。当前汇总没有进一步按以下原因拆分：

- Apollo Credit 耗尽。
- API 权限不足。
- 临时限流。
- 网络错误。
- 上游数据缺失。
- 飞书或孚盟写回失败。

### 24.4 Windows 敏感文件权限

代码使用 `chmod(0600)` 保护：

- `.env`
- 邮箱加密配置。
- 邮箱解密密钥。

但 Windows 不使用 Unix 权限位。当前两项自动化测试因此失败，真实保护需要依赖 NTFS ACL。

### 24.5 健康检查接口公开

`/api/health` 不要求网页登录，便于 n8n 调用。它不会返回完整密钥，但会返回：

- 哪些服务已经配置。
- 哪些开关已经开启。
- 部分运行状态和限额。

当前服务配置为监听 `0.0.0.0:8787`，部署时需要依赖 Windows 防火墙或网络边界限制访问。

### 24.6 当前文档与配置状态存在差异

README 强调默认发送关闭，但当前机器 `.env` 已经开启：

- 营销总开关。
- Brevo 真实发送。
- 第二轮营销。
- 孚盟写回。

代码默认值确实偏安全，但当前运行配置不是默认值。

### 24.7 工作区存在未提交修改

当前 `src/server.mjs` 有未提交修改，主要涉及：

- 公共邮件产品查询接口。
- 新邮件模板和邮件构建页面。
- 部分页面 CSP 的内联样式允许范围。

这些修改不属于本说明文档产生的变更。

### 24.8 `._*` 文件

目录中存在大量以 `._` 开头的文件，例如：

```text
._README.md
._src
._app.js
```

这些是 macOS 复制文件时产生的 AppleDouble 元数据，不是项目源码，也不参与运行。

---

## 25. 常用命令

### 安装依赖

```powershell
npm install
```

### 检查配置

```powershell
npm run preflight
```

Apollo 尚未配置时：

```powershell
npm run preflight -- --allow-missing-apollo
```

### 运行测试

```powershell
npm test
```

### 校验 n8n 工作流

```powershell
npm run n8n:validate
```

### 生成本机 n8n 导入包

```powershell
npm run n8n:prepare-import
```

### 启动控制台

```powershell
npm start
```

控制台地址：

```text
http://127.0.0.1:8787
```

### 启动控制台、Webhook 网关和 Tunnel

```powershell
npm run start:tracking
```

这条命令可能使系统具备接收公网 Brevo 回调的能力，运行前必须检查当前开关和配置。

---

## 26. 理解当前系统的推荐阅读顺序

1. [`README.md`](README.md)：当前业务说明和运行方式。
2. [`workflows/`](workflows/)：三条 n8n 定时工作流。
3. [`src/server.mjs`](src/server.mjs)：API、鉴权和模块装配。
4. [`src/services/marketing-service.mjs`](src/services/marketing-service.mjs)：完整获客主流程。
5. [`src/services/enrichment-service.mjs`](src/services/enrichment-service.mjs)：Apollo 公司和联系人匹配。
6. [`src/services/draft-service.mjs`](src/services/draft-service.mjs)：AI 输入、规则和输出。
7. [`src/lib/marketing-store.mjs`](src/lib/marketing-store.mjs)：队列、幂等、冷却和重试。
8. [`src/lib/email-composer.mjs`](src/lib/email-composer.mjs)：最终邮件 HTML。
9. [`src/lib/delivery-store.mjs`](src/lib/delivery-store.mjs)：Brevo 状态回传。
10. [`src/services/mailbox-monitor.mjs`](src/services/mailbox-monitor.mjs)：客户回复和询盘识别。

最核心的调用链是：

```text
POST /api/automation/run-daily
→ MarketingService.runDailyMarketing()
→ listCandidates()
→ prepareCustomer()
→ EnrichmentService.enrich()
→ DraftService.analyzeCompanyFromData()
→ draftQuality()
→ MarketingStore.enqueue()

POST /api/automation/send-due
→ MarketingService.sendDue()
→ MarketingStore.reserveDue()
→ BrevoClient.send()
→ DeliveryStore.recordSent()
→ 飞书和孚盟回写

POST /api/automation/inbox/poll
→ MailboxMonitor.poll()
→ 固定规则/MiMo 分类
→ InboxStore.ingest()
→ 飞书询盘同步和邮箱抑制
```

---

## 27. 当前系统总结

当前系统可以概括为四个子系统：

### 获客系统

```text
孚盟客户池
→ Apollo 公司和联系人补全
→ 官网证据研究
→ AI 精准度判断
```

### 内容系统

```text
AI 个性化正文
+ 真实报价目录
+ 具体型号产品图
+ 统一 HTML 模板和签名
```

### 营销调度系统

```text
SQLite 队列
+ 时区计算
+ 每日额度
+ 公司冷却期
+ 幂等和重试
+ Brevo 发送
```

### 反馈闭环系统

```text
Brevo 送达、打开、点击和退信
+ 阿里企业邮箱客户回复
+ MiMo 询盘分类
+ 第二轮跟进
+ 飞书和孚盟回写
```

一句话描述：

> 这是一套按照固定业务规则运行、在客户判断和内容生成环节使用 AI 的外贸 B2B 自动获客与邮件营销系统。
