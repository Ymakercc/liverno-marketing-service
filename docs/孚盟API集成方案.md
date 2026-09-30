# 孚盟 API 集成方案

## 定位

孚盟作为客户和联系人主数据源，飞书只作为 AI 背调和自动营销监管看板。

推荐数据流：

```text
孚盟客户/联系人 -> Apollo 补全 -> OpenAI 判断与生成邮件 -> 飞书记录 -> 邮件平台发送 -> 飞书回填 -> 孚盟跟进回写
```

## 核心接口

### 鉴权

- URL：`POST /auth-server/open/acquire_token`
- Body：`{ "appId": "...", "appSecret": "..." }`
- 返回：`accessToken`, `expireTime`
- 后续请求：`accessToken` 放请求头。

### 客户

模块：`NewBF001`

- 客户列表：`POST /bill-server/pure/get_page_list`
- 客户详情：`POST /open-platform-server/pure/get_detail_info`
- 新增客户：`POST /open-platform-server/pure/addSingleCustomer`
- 修改客户：`POST /open-platform-server/pure/edit_customer`
- 部分字段更新：`POST /bill-server/pure/modifyStructFieldData`

关键字段：

| 用途 | 孚盟字段 |
| --- | --- |
| 客户主键 | `key_id` |
| 客户编号 | `billCode` |
| 公司名 | `custName` |
| 官网 | `web` |
| 主联系人 ID | `contId` |
| 主联系人姓名 | `contName` |
| 主联系人邮箱 | `mailAddress` |
| 国家/地区 | `countryId` |
| 行业 | `industry` |
| 主营产品 | `productRange` |
| 最后跟进时间 | `lastTrackDate` |
| 修改时间 | `modifyDate` |
| 孚盟系统公海标志 | `seasFlag` / `fieldId=1110078` |
| 公海分组 | `seasGroup` / `fieldId=1110096` |
| 所属人 | `ownerCtId` / `fieldId=1110018` |

本项目业务上的“公海客户”不是孚盟系统公海状态，而是一个名称为“公海客户”的孚盟所属人账号。原公海客户正在转入客户池并归属到这个账号，筛选规则为：

- 营销公海池：`fieldId=1110018`、`operatorId=72`、`itemValue=["<FUMENG_PUBLIC_SEA_OWNER_ID>"]`。
- 其他所属人客户：同一字段使用 `operatorId=73` 排除该账号。
- 导入仍在进行，客户总量必须以接口实时返回为准，不能在代码或文档中写死。
- `seasFlag` 仅保留为孚盟原始系统字段，不作为本项目营销公海池的判断依据。

### 联系人

模块：`NewBF003`

- 联系人列表/查询：`POST /bill-server/pure/get_page_list`
- 新增联系人：`POST /bill-server/pure/add_one`
- 修改联系人：`POST /bill-server/pure/edit_one`

按客户查询联系人时使用：

```json
{
  "moduleCode": "NewBF003",
  "optCode": "otview",
  "page": { "from": 0, "size": 50 },
  "withoutRight": true,
  "subBill": {
    "keyId": "客户key_id",
    "originModuleCode": "NewBF001",
    "targetModuleCode": "NewBF003"
  }
}
```

注意：实测 `optCode` 使用文档里的 `otView` 会返回 `Forbidden`，使用小写 `otview` 并带 `withoutRight: true` 可正常读取。

### 客户跟进

模块：`NewBF004`

- 跟进列表：通用列表接口
- 查询跟进：`POST /bill-server/pure/get_detail_info`
- 新建跟进：`POST /bill-server/pure/add_one`
- 修改跟进：`POST /bill-server/pure/edit_one`

邮件发送后可以新增一条跟进，记录：

- 邮件主题
- 邮件摘要
- 发送平台
- 发送时间
- 下一步动作

## 当前自动营销接口

```text
GET  /api/automation/candidates
POST /api/automation/prepare
POST /api/automation/send-due
GET  /api/feishu/drafts
GET  /api/settings/relay
PUT  /api/settings/relay
```

`/api/automation/prepare` 内部按“Apollo 补全 -> 孚盟回填 -> AI 判断与生成首封 -> 飞书记录 -> 本地排队”执行。
`/api/automation/send-due` 对已完成背调、判断为精准且找到合格联系人邮箱的任务直接调用 Brevo；飞书只作为自动记录和监管看板。发送成功后回填飞书，并按配置新增孚盟邮件跟进。不会等待人工审核或“是否允许发送”字段。

飞书回填的目标不是客户主数据表，而是：

- Base：`<FEISHU_APP_TOKEN>`
- Table：`<FEISHU_TABLE_ID>`（外贸AI跟进记录 / AI跟进记录）
- 链接：`https://liverno-cd.feishu.cn/base/<FEISHU_APP_TOKEN>?table=<FEISHU_TABLE_ID>&view=<FEISHU_VIEW_ID>`

孚盟仍然是客户、联系人和邮件跟进的主数据源；飞书是 Apollo 背调、AI 判断、排除原因、邮件内容和发送状态的监管看板。

## 落地注意事项

1. `ownerCtId` 和 `ownerDeptKey` 是后续写入孚盟时的关键字段。
2. 国家、客户阶段、客户等级、跟进方式等多为 ID，需要字典映射。
   - 客户字段 `industry` 实际使用字典 `dictCode=38`（所属行业），不是 `dictCode=1`。
   - 客户字段 `productRange` 使用字典 `dictCode=915`（主营产品）。
   - 客户字段 `custState` 使用字典 `dictCode=7`（客户状态）。当前账号实测枚举为：`1=线索`、`2=意向`、`3=成交`、`5=停业`、`6=拒联`。
   - 背调候选不要求必须是“线索”或“意向”。除明确的 `custState=3` 成交、`5` 停业、`6` 拒联外，其他状态先进入 Apollo/AI 背调，再判断是否精准。不能把 API 的响应码 `code=0` 当作客户成交状态。
3. 客户列表还可提供 `quotationCreateDate`、`orderCreateDate`、`businessCreateDate`、`nextTrackDate` 等字段。正式生成候选名单时应同时保留这些字段，方便判断是否已有报价/订单并控制跟进节奏。
4. 增量同步可以用客户 `modifyDate`，列表字段 ID 为 `1110027`。
5. 飞书记录用于审计和监管，不作为自动发送的人工放行开关。
6. 所有真实密钥只放 `.env`，不要提交到 GitHub。

## 本地烟囱测试

填好 `.env` 后，可用下面脚本做只读验证：

```bash
node scripts/fumeng-smoke-test.mjs
```

脚本会验证：

1. 鉴权是否成功。
2. 是否能读取客户列表。
3. 是否能读取第一条客户下的联系人列表。

脚本不会打印密钥或 access token，联系人邮箱会做脱敏。
