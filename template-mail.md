# B2B 开发信模板（明纬电源）

## 固定规则
1. 主题根据背调公司自行确认（必须与客户业务相关）。
2. 开头固定为：`Dear {{company_name}} Team,`
3. 正文必须按以下顺序组织。
4. AI 只生成问候和正文，不生成个人签名、WhatsApp、邮箱或官网。
5. 系统发送前统一追加 `MEAN WELL KULON TEAM` HTML 签名。

## 正文结构（英文）

Dear {{company_name}} Team,

Hope you are doing well.

This is the export team at {{your_company_name}}. We are a long-term MEAN WELL distributor and we now work with 3000+ partners worldwide. If your team also needs other power supply brands, we can support those as well.

Based on our review of your website, we understand your business is in {{customer_industry}}. We can provide customized product recommendations based on your actual project requirements.

For your application, we suggest starting with {{recommended_models}} (1-2 models), because {{model_reasoning}}.

Our key advantages for your business:
{{selected_advantages_by_customer_type}}

Would it be useful if we suggested one or two suitable series based on your voltage, wattage, enclosure, and certification requirements?

---

## 优势总库（7条）
1. 在有真实报价依据时说明成本优势，不写固定降幅。
2. 在有真实物流方案时说明交期和运输支持，不保证到货日期。
3. 仅在已确认适用的国家和渠道说明税务或清关方案。
4. 明纬电源整套技术支持。
5. 进出关顺利交付。
6. 定制化电源，可按细节要求配置。
7. 享受全球明纬官网售后支持，正品可查。

## 按客户类型选优势（必须遵守）
- 客户是工厂（Factory）：
  - 必须突出：成本、技术支持、定制化
  - 推荐映射：1 + 4 + 6
- 客户是工程商（Engineering Contractor / System Integrator）：
  - 必须突出：技术支持、售后
  - 推荐映射：4 + 7（可补充 6）
- 客户是贸易商（Trader / Distributor）：
  - 必须突出：成本、交期、进出关、免税
  - 推荐映射：1 + 2 + 5 + 3

## 变量说明
- `{{company_name}}`：客户公司名
- `{{customer_industry}}`：根据官网分析出的行业
- `{{recommended_models}}`：1-2 个推荐型号（可写型号系列）
- `{{model_reasoning}}`：推荐理由（与客户行业/需求对应）
- `{{selected_advantages_by_customer_type}}`：按客户类型选出的优势段落
- `{{your_company_name}}`：你的公司名称
- `{{your_website}}`：你的官网

## 固定 HTML 签名

- 团队：`MEAN WELL KULON TEAM`
- 邮箱：`Sales@kulon.com`
- 官网：`https://meanwell-led.com/`
- 代码：`templates/email-signature.html`
