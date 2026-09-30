import { AppError, readJsonResponse, requireConfiguration } from './errors.mjs';
import { normalizeDomain } from './apollo-client.mjs';

export const FOLLOWUP_FIELDS = [
  '公司名',
  '孚盟客户ID',
  '孚盟联系人ID',
  '联系人姓名',
  '联系人邮箱',
  '国家',
  '客户类型',
  '官网',
  '客户画像',
  'AI推荐产品',
  'AI邮件主题',
  'AI邮件正文',
  '人工审核状态',
  '备注',
];

export const RESEARCH_AUDIT_FIELDS = [
  { field_name: '筛选结果', type: 1 },
  { field_name: '排除原因', type: 1 },
];

export const DELIVERY_TRACKING_FIELDS = [
  { field_name: '发送平台', type: 1 },
  { field_name: '送达状态', type: 1 },
  { field_name: '最后发送时间', type: 5 },
  { field_name: '打开次数', type: 2 },
  { field_name: '点击次数', type: 2 },
  { field_name: '最后打开时间', type: 5 },
  { field_name: '最后点击时间', type: 5 },
  { field_name: '最后点击链接', type: 15 },
  { field_name: '退信原因', type: 1 },
  { field_name: '下一步动作', type: 1 },
];

export const INBOUND_TRACKING_FIELDS = [
  { field_name: '回复状态', type: 1 },
  { field_name: '最后回复时间', type: 5 },
  { field_name: '回复主题', type: 1 },
  { field_name: '回复摘要', type: 1 },
  { field_name: '下一步动作', type: 1 },
];

const DEFAULT_DRAFT_LIMIT = 50;
const MAX_DRAFT_LIMIT = 200;

function fieldText(value) {
  if (Array.isArray(value)) return value.map(fieldText).join('');
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') {
    if (value.text !== undefined) return fieldText(value.text);
    if (value.name !== undefined) return fieldText(value.name);
    if (value.value !== undefined) return fieldText(value.value);
    if (value.link !== undefined) return fieldText(value.link);
  }
  return '';
}

function fieldLink(value) {
  const item = Array.isArray(value) ? value[0] : value;
  if (item && typeof item === 'object') {
    return fieldText(item.link || item.url || item.text);
  }
  return fieldText(item);
}

function websiteLink(value) {
  const domain = normalizeDomain(value);
  return domain ? `https://${domain}` : '';
}

function compactList(values) {
  const items = (values || []).flatMap((value) =>
    fieldText(value).split(/[;；\n]+/).map((item) => item.trim()).filter(Boolean));
  return [...new Set(items)].join('; ');
}

function researchContacts(enrichment, fallback = []) {
  const candidates = enrichment?.contactCandidates || [];
  if (candidates.length) {
    return candidates.slice(0, 5).map((item) => ({
      id: item.contact?.id || '',
      name: item.contact?.name || item.person?.name || item.person?.title || 'Apollo Contact',
      email: item.contact?.email || item.person?.email || '',
      jobRole: item.contact?.jobRole || item.person?.title || '',
      linkedin: item.contact?.linkedin || item.person?.linkedinUrl || '',
      emailStatus: item.person?.emailStatus || (item.emailVerified ? 'verified' : 'unverified'),
      personId: item.person?.id || '',
      source: item.source || '',
      writebackApplied: item.writebackApplied,
      writebackError: item.writebackError || '',
      writebackChanged: Boolean(item.changes?.length),
    }));
  }
  return (fallback || []).filter((item) => item.email).slice(0, 5).map((item) => ({
    id: item.id || '', name: item.name || '', email: item.email || '', jobRole: item.jobRole || '',
    linkedin: item.linkedin || '', emailStatus: 'CRM', personId: '', source: 'fumeng',
  }));
}

function researchState(enrichment, decision) {
  if (!enrichment) return { label: '背调中', next: '等待 Apollo 返回' };
  if (enrichment.status === 'failed') return { label: '背调失败', next: '检查接口错误后重试' };
  if (decision?.qualified === true && enrichment.status === 'contact_not_found') {
    return { label: '背调完成·精准但无联系人', next: '补充关键联系人后进入营销' };
  }
  if (decision?.qualified === true && enrichment.status === 'company_mismatch') {
    return { label: '背调完成·精准·Apollo待核对', next: '核对 Apollo 公司身份并补充联系人' };
  }
  if (decision?.qualified === true) return { label: '背调完成·精准', next: '进入联系人邮箱质检' };
  if (decision?.qualified === false) return { label: '背调完成·不精准', next: '停止首封营销' };
  if (decision && decision.qualified === null) return { label: '背调完成·证据不足', next: '保留记录，等待补充官网证据' };
  if (enrichment.status === 'company_mismatch') return { label: '背调完成·公司待核对', next: '核对官网与公司身份' };
  if (enrichment.status === 'contact_not_found') return { label: '背调完成·无联系人', next: '补充关键联系人' };
  return { label: 'Apollo已完成·待AI判断', next: '读取官网并判断客户匹配度' };
}

function buildResearchNotes({
  customer,
  enrichment,
  contacts,
  websiteEvidence,
  decision,
  contactOutcomes,
  screeningResult,
  exclusionReason,
}) {
  const organization = enrichment?.organization || {};
  const people = researchContacts(enrichment, contacts);
  const organizationLines = [
    `Apollo组织ID: ${organization.id || enrichment?.apolloOrgId || '-'}`,
    `Apollo公司名: ${organization.name || '-'}`,
    `Apollo域名: ${organization.domain || '-'}`,
    `Apollo官网: ${organization.website || '-'}`,
    `Apollo国家/城市: ${[organization.country, organization.city].filter(Boolean).join(' / ') || '-'}`,
    `Apollo行业: ${organization.industry || '-'}`,
    `Apollo简介: ${organization.description || '-'}`,
    `Apollo关键词: ${(organization.keywords || []).join(', ') || '-'}`,
    `Apollo员工数: ${organization.employeeCount || '-'}`,
    `Apollo LinkedIn: ${organization.linkedinUrl || '-'}`,
    `公司匹配分: ${Number(enrichment?.confidence || 0)}`,
  ];
  const peopleLines = people.length
    ? people.map((person, index) => [
        `联系人${index + 1}`,
        person.name || '-',
        person.jobRole || '-',
        person.email || '-',
        `邮箱状态=${person.emailStatus || '-'}`,
        `Apollo Person ID=${person.personId || '-'}`,
        `来源=${person.source || '-'}`,
        person.writebackError
          ? `孚盟回填=失败: ${person.writebackError}`
          : person.writebackApplied
            ? '孚盟回填=成功'
            : person.writebackChanged
              ? '孚盟回填=未执行'
              : '孚盟回填=无需更新',
        person.linkedin ? `LinkedIn=${person.linkedin}` : '',
      ].filter(Boolean).join(' | '))
    : ['Apollo联系人: 未找到'];
  const changes = (enrichment?.changes || []).map((item) =>
    `${item.entity || '-'}:${item.field || '-'}=${fieldText(item.value)}`).join('; ') || '无';
  const evidence = websiteEvidence?.status === 'fetched'
    ? [
        `官网标题: ${websiteEvidence.title || '-'}`,
        `官网描述: ${websiteEvidence.description || '-'}`,
        `官网直接出现MEAN WELL: ${websiteEvidence.signals?.meanWellMentioned ? '是' : '否'}`,
        `官网匹配词: ${(websiteEvidence.signals?.matchedTerms || []).join(', ') || '-'}`,
      ]
    : [`官网读取: ${websiteEvidence?.status || '尚未执行'}${websiteEvidence?.error ? ` - ${websiteEvidence.error}` : ''}`];
  const outcomes = (contactOutcomes || []).map((item) =>
    `${item.email || '-'}: ${item.status || '-'}${item.reason ? ` (${item.reason})` : ''}`);
  return [
    '记录类型: Apollo背调审计',
    `孚盟客户编号: ${customer?.billCode || '-'}`,
    `Apollo状态: ${enrichment?.status || 'researching'}`,
    ...organizationLines,
    ...peopleLines,
    `孚盟回填: ${changes}`,
    ...evidence,
    `AI公司判断: ${decision ? `${decision.qualified === true ? '精准' : decision.qualified === false ? '不精准' : '证据不足'} - ${decision.reason || '-'}` : '待判断'}`,
    `筛选结果: ${screeningResult || '背调中'}`,
    `排除原因: ${exclusionReason || '未排除'}`,
    ...(outcomes.length ? ['联系人处理结果:', ...outcomes] : []),
    `错误: ${enrichment?.error || '-'}`,
    `更新时间: ${new Date().toISOString()}`,
  ].join('\n');
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timestampValue(value) {
  const timestamp = normalizeTimestamp(value);
  return timestamp ? new Date(timestamp).getTime() : null;
}

function deliveryTrackingFields(fieldDefinitions, summary = {}) {
  const names = new Set(fieldDefinitions.map((field) => field.field_name));
  const fields = {};
  const assign = (name, value) => {
    if (names.has(name) && value !== undefined && value !== null) fields[name] = value;
  };

  assign('发送平台', 'Brevo');
  assign('送达状态', summary.statusLabel || summary.status || '已发送');
  assign('打开次数', Number(summary.openCount || 0));
  assign('点击次数', Number(summary.clickCount || 0));
  assign('退信原因', summary.failureReason || '');
  assign('下一步动作', summary.nextAction || '等待客户回复');
  assign('最后发送时间', timestampValue(summary.lastSentAt));
  assign('最后打开时间', timestampValue(summary.lastOpenedAt));
  assign('最后点击时间', timestampValue(summary.lastClickedAt));
  if (summary.lastClickedLink) {
    assign('最后点击链接', { link: summary.lastClickedLink, text: summary.lastClickedLink });
  }
  return fields;
}

function recordTimestamp(record) {
  return Number(record.last_modified_time || record.created_time || 0);
}

function companyRecordScore(record) {
  const fields = record.fields || {};
  const notes = fieldText(fields['备注']);
  const screeningResult = fieldText(fields['筛选结果']);
  let score = 0;
  if (notes.includes('记录类型: Apollo背调审计')) score += 100;
  if (screeningResult) score += 30;
  if (fieldText(fields['联系人邮箱'])) score += 10;
  if (fieldText(fields['客户画像'])) score += 5;
  return score;
}

export function chooseCanonicalCompanyRecord(records = []) {
  return [...records].sort((left, right) =>
    companyRecordScore(right) - companyRecordScore(left) ||
    recordTimestamp(right) - recordTimestamp(left))[0] || null;
}

export function normalizeDraftRecord(record) {
  const fields = record.fields || {};
  const reviewStatus = fieldText(fields['人工审核状态']).trim() || '未设置';
  return {
    recordId: record.record_id || record.id || '',
    companyName: fieldText(fields['公司名']),
    customerId: fieldText(fields['孚盟客户ID']),
    contactId: fieldText(fields['孚盟联系人ID']),
    contactName: fieldText(fields['联系人姓名']),
    contactEmail: fieldText(fields['联系人邮箱']),
    country: fieldText(fields['国家']),
    customerType: fieldText(fields['客户类型']),
    website: fieldLink(fields['官网']),
    customerProfile: fieldText(fields['客户画像']),
    recommendedProducts: fieldText(fields['AI推荐产品']),
    emailSubject: fieldText(fields['AI邮件主题']),
    emailBody: fieldText(fields['AI邮件正文']),
    reviewStatus,
    screeningResult: fieldText(fields['筛选结果']),
    exclusionReason: fieldText(fields['排除原因']),
    notes: fieldText(fields['备注']),
    createdAt: normalizeTimestamp(record.created_time),
    updatedAt: normalizeTimestamp(record.last_modified_time),
  };
}

export function summarizeDraftRecords(items) {
  const byReviewStatus = {};
  for (const item of items) {
    byReviewStatus[item.reviewStatus] = (byReviewStatus[item.reviewStatus] || 0) + 1;
  }
  return {
    total: items.length,
    byReviewStatus,
  };
}

export class FeishuClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.fieldsCache = null;
    this.fieldsCacheExpiresAt = 0;
  }

  assertConfigured() {
    requireConfiguration(
      {
        FEISHU_APP_ID: this.config.appId,
        FEISHU_APP_SECRET: this.config.appSecret,
        FEISHU_APP_TOKEN: this.config.appToken,
        FEISHU_TABLE_ID: this.config.tableId,
      },
      '飞书',
    );
  }

  async getTenantToken() {
    this.assertConfigured();
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const response = await this.fetch(
      `${this.config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = await readJsonResponse(response, '飞书鉴权');
    if (Number(data.code) !== 0 || !data.tenant_access_token) {
      throw new AppError(`飞书鉴权失败：${data.msg || data.code}`, {
        status: 502,
        code: 'FEISHU_AUTH_ERROR',
      });
    }
    this.token = data.tenant_access_token;
    this.tokenExpiresAt = Date.now() + Math.max(Number(data.expire || 7200) - 300, 60) * 1000;
    return this.token;
  }

  async request(path, { method = 'GET', body } = {}) {
    const token = await this.getTenantToken();
    const response = await this.fetch(`${this.config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await readJsonResponse(response, '飞书多维表格');
    if (Number(data.code) !== 0) {
      throw new AppError(`飞书多维表格返回错误：${data.msg || data.code}`, {
        status: 502,
        code: 'FEISHU_API_ERROR',
        details: { upstreamCode: data.code },
      });
    }
    return data;
  }

  tablePath(suffix = '') {
    return `/open-apis/bitable/v1/apps/${encodeURIComponent(this.config.appToken)}/tables/${encodeURIComponent(this.config.tableId)}${suffix}`;
  }

  async listFields() {
    if (this.fieldsCache && Date.now() < this.fieldsCacheExpiresAt) return this.fieldsCache;
    const data = await this.request(this.tablePath('/fields?page_size=100'));
    this.fieldsCache = data.data?.items || [];
    this.fieldsCacheExpiresAt = Date.now() + 5 * 60_000;
    return this.fieldsCache;
  }

  async ensureResearchAuditFields() {
    const existing = await this.listFields();
    const names = new Set(existing.map((field) => field.field_name));
    const created = [];
    for (const definition of RESEARCH_AUDIT_FIELDS) {
      if (names.has(definition.field_name)) continue;
      await this.request(this.tablePath('/fields'), {
        method: 'POST',
        body: definition,
      });
      created.push(definition.field_name);
    }
    if (created.length) {
      this.fieldsCache = null;
      this.fieldsCacheExpiresAt = 0;
    }
    return { created, fields: created.length ? await this.listFields() : existing };
  }

  async ensureDeliveryTrackingFields() {
    const existing = await this.listFields();
    const names = new Set(existing.map((field) => field.field_name));
    const created = [];
    for (const definition of DELIVERY_TRACKING_FIELDS) {
      if (names.has(definition.field_name)) continue;
      await this.request(this.tablePath('/fields'), {
        method: 'POST',
        body: definition,
      });
      names.add(definition.field_name);
      created.push(definition.field_name);
    }
    if (created.length) {
      this.fieldsCache = null;
      this.fieldsCacheExpiresAt = 0;
    }
    return { created, fields: created.length ? await this.listFields() : existing };
  }

  async ensureInboundTrackingFields() {
    const existing = await this.listFields();
    const names = new Set(existing.map((field) => field.field_name));
    const created = [];
    for (const definition of INBOUND_TRACKING_FIELDS) {
      if (names.has(definition.field_name)) continue;
      await this.request(this.tablePath('/fields'), { method: 'POST', body: definition });
      names.add(definition.field_name);
      created.push(definition.field_name);
    }
    if (created.length) {
      this.fieldsCache = null;
      this.fieldsCacheExpiresAt = 0;
    }
    return { created, fields: created.length ? await this.listFields() : existing };
  }

  async checkDraftFields() {
    const existing = await this.listFields();
    const names = new Set(existing.map((field) => field.field_name));
    const missing = FOLLOWUP_FIELDS.filter((name) => !names.has(name));
    if (missing.length) {
      throw new AppError(`飞书表缺少必要字段：${missing.join(', ')}`, {
        status: 409,
        code: 'FEISHU_FIELDS_MISSING',
        details: { missing },
      });
    }
    return {
      ok: true,
      fieldCount: existing.length,
      requiredFieldCount: FOLLOWUP_FIELDS.length,
    };
  }

  async listDraftRecords({ limit = DEFAULT_DRAFT_LIMIT } = {}) {
    const parsedLimit = Number.parseInt(limit, 10);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), MAX_DRAFT_LIMIT)
      : DEFAULT_DRAFT_LIMIT;
    const records = await this.listRawRecords();

    const items = records
      .sort((left, right) => recordTimestamp(right) - recordTimestamp(left))
      .slice(0, safeLimit)
      .map(normalizeDraftRecord);

    return {
      items,
      summary: summarizeDraftRecords(items),
    };
  }

  async listRawRecords() {
    const records = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ page_size: '100' });
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.request(this.tablePath(`/records?${query}`));
      const page = data.data || {};
      records.push(...(page.items || []));
      pageToken = page.has_more && page.page_token ? page.page_token : '';
    } while (pageToken);
    return records;
  }

  async findCompanyRecords(customerId) {
    const id = fieldText(customerId).trim();
    if (!id) return [];
    const data = await this.request(this.tablePath('/records/search?page_size=100'), {
      method: 'POST',
      body: {
        filter: {
          conjunction: 'and',
          conditions: [{ field_name: '孚盟客户ID', operator: 'is', value: [id] }],
        },
      },
    });
    return data.data?.items || [];
  }

  async findCompanyRecord(customerId) {
    return chooseCanonicalCompanyRecord(await this.findCompanyRecords(customerId));
  }

  async getDraftRecord(recordId) {
    const id = String(recordId || '').trim();
    if (!id) throw new AppError('飞书记录 ID 不能为空', { status: 400, code: 'FEISHU_RECORD_INVALID' });
    const data = await this.request(this.tablePath(`/records/${encodeURIComponent(id)}`));
    const record = data.data?.record || data.data;
    if (!record) throw new AppError('飞书记录不存在', { status: 404, code: 'FEISHU_RECORD_NOT_FOUND' });
    return normalizeDraftRecord(record);
  }

  async updateDraftRecord(recordId, fields) {
    const id = String(recordId || '').trim();
    if (!id) throw new AppError('飞书记录 ID 不能为空', { status: 400, code: 'FEISHU_RECORD_INVALID' });
    const data = await this.request(this.tablePath(`/records/${encodeURIComponent(id)}`), {
      method: 'PUT',
      body: { fields },
    });
    return data.data?.record || data.data;
  }

  async deleteRecord(recordId) {
    const id = String(recordId || '').trim();
    if (!id) throw new AppError('飞书记录 ID 不能为空', { status: 400, code: 'FEISHU_RECORD_INVALID' });
    const data = await this.request(this.tablePath(`/records/${encodeURIComponent(id)}`), {
      method: 'DELETE',
    });
    return data.data || data;
  }

  async deleteField(fieldId) {
    const id = String(fieldId || '').trim();
    if (!id) throw new AppError('飞书字段 ID 不能为空', { status: 400, code: 'FEISHU_FIELD_INVALID' });
    const data = await this.request(this.tablePath(`/fields/${encodeURIComponent(id)}`), {
      method: 'DELETE',
    });
    this.fieldsCache = null;
    this.fieldsCacheExpiresAt = 0;
    return data.data || data;
  }

  async updateSendStatus(recordId, { status, sentAt = new Date(), reason = '' } = {}) {
    const fieldDefinitions = await this.listFields();
    const names = new Set(fieldDefinitions.map((field) => field.field_name));
    const fields = {};
    if (names.has('发送平台')) fields['发送平台'] = 'Brevo';
    if (names.has('送达状态')) fields['送达状态'] = status;
    if (names.has('最后发送时间')) fields['最后发送时间'] = sentAt.getTime();
    if (names.has('最后跟进时间')) fields['最后跟进时间'] = sentAt.getTime();
    if (names.has('退信原因')) fields['退信原因'] = reason;
    if (names.has('下一步动作')) fields['下一步动作'] = status === '已发送' ? '等待客户回复' : '检查发送异常';
    if (!Object.keys(fields).length) return null;
    return this.updateDraftRecord(recordId, fields);
  }

  async updateDeliveryTracking(recordId, summary = {}) {
    const { fields: fieldDefinitions } = await this.ensureDeliveryTrackingFields();
    const fields = deliveryTrackingFields(fieldDefinitions, summary);
    if (!Object.keys(fields).length) return null;
    return this.updateDraftRecord(recordId, fields);
  }

  async batchUpdateDeliveryTracking(summaries = [], { batchSize = 100 } = {}) {
    const safeBatchSize = Math.min(Math.max(Number(batchSize) || 100, 1), 500);
    const { fields: fieldDefinitions } = await this.ensureDeliveryTrackingFields();
    const records = summaries.map((summary) => ({
      record_id: String(summary.recordId || '').trim(),
      fields: deliveryTrackingFields(fieldDefinitions, summary),
    })).filter((record) => record.record_id && Object.keys(record.fields).length);
    let updated = 0;
    for (let index = 0; index < records.length; index += safeBatchSize) {
      const batch = records.slice(index, index + safeBatchSize);
      await this.request(this.tablePath('/records/batch_update'), {
        method: 'POST', body: { records: batch },
      });
      updated += batch.length;
    }
    return { requested: summaries.length, updated };
  }

  async updateInboundReply(recordId, reply = {}) {
    const { fields: fieldDefinitions } = await this.ensureInboundTrackingFields();
    const names = new Set(fieldDefinitions.map((field) => field.field_name));
    const fields = {};
    if (names.has('回复状态')) fields['回复状态'] = reply.status || '已回复·待人工查看';
    const receivedAt = timestampValue(reply.receivedAt);
    if (names.has('最后回复时间') && receivedAt !== null) fields['最后回复时间'] = receivedAt;
    if (names.has('回复主题')) fields['回复主题'] = fieldText(reply.subject).trim().slice(0, 500);
    if (names.has('回复摘要')) fields['回复摘要'] = fieldText(reply.preview).trim().slice(0, 1000);
    if (names.has('下一步动作')) fields['下一步动作'] = reply.nextAction || '人工查看客户回复';
    if (!Object.keys(fields).length) return null;
    return this.updateDraftRecord(recordId, fields);
  }

  async createResearchRecord({ customer, contacts = [] }) {
    const { fields: fieldDefinitions } = await this.ensureResearchAuditFields();
    const names = new Set(fieldDefinitions.map((field) => field.field_name));
    const website = websiteLink(customer.website);
    const recordFields = {
      公司名: customer.companyName,
      孚盟客户ID: customer.id,
      联系人姓名: compactList(contacts.slice(0, 5).map((item) => item.name)),
      联系人邮箱: compactList(contacts.slice(0, 5).map((item) => item.email)),
      国家: customer.country,
      ...(website ? { 官网: { link: website, text: normalizeDomain(customer.website) } } : {}),
      客户画像: 'Apollo 背调已建档，等待返回公司与联系人信息。',
      人工审核状态: '背调中',
      筛选结果: '背调中',
      排除原因: '',
      下一步动作: '等待 Apollo 返回',
      备注: buildResearchNotes({ customer, contacts, screeningResult: '背调中' }),
    };
    const filtered = Object.fromEntries(Object.entries(recordFields).filter(([name]) => names.has(name)));
    const existing = await this.findCompanyRecord(customer.id);
    if (existing) {
      await this.updateDraftRecord(existing.record_id || existing.id, filtered);
      return { ...existing, record_id: existing.record_id || existing.id };
    }
    const data = await this.request(this.tablePath('/records'), {
      method: 'POST', body: { fields: filtered },
    });
    return data.data?.record || data.data;
  }

  async updateResearchRecord(recordId, {
    customer,
    contacts = [],
    enrichment,
    websiteEvidence,
    decision,
    draft,
    contactOutcomes = [],
    screeningResult = '',
    exclusionReason = '',
  }) {
    const { fields: fieldDefinitions } = await this.ensureResearchAuditFields();
    const names = new Set(fieldDefinitions.map((field) => field.field_name));
    const people = researchContacts(enrichment, contacts);
    const organization = enrichment?.organization || {};
    const state = researchState(enrichment, decision);
    const website = websiteLink(customer.website || organization.website || organization.domain);
    const profile = draft?.customerProfile || [
      organization.name,
      organization.industry,
      organization.employeeCount ? `${organization.employeeCount} employees` : '',
      organization.country,
    ].filter(Boolean).join(' | ') || `Apollo状态：${enrichment?.status || 'unknown'}`;
    const recordFields = {
      公司名: customer.companyName,
      孚盟客户ID: customer.id,
      孚盟联系人ID: compactList(people.map((item) => item.id)),
      联系人姓名: compactList(people.map((item) => item.name)),
      联系人邮箱: compactList(people.map((item) => item.email)),
      国家: draft?.country || customer.country || organization.country,
      客户类型: draft?.customerType || organization.industry || '',
      ...(website ? { 官网: { link: website, text: normalizeDomain(customer.website || organization.website || organization.domain) } } : {}),
      客户画像: profile,
      AI推荐产品: (draft?.recommendedProducts || []).map((item) => `${item.name}: ${item.reason}`).join('\n'),
      AI邮件主题: draft?.emailSubject || '',
      AI邮件正文: draft?.emailBody || '',
      人工审核状态: state.label,
      筛选结果: screeningResult || state.label,
      排除原因: exclusionReason,
      下一步动作: state.next,
      备注: buildResearchNotes({
        customer,
        enrichment,
        contacts,
        websiteEvidence,
        decision,
        contactOutcomes,
        screeningResult: screeningResult || state.label,
        exclusionReason,
      }),
    };
    const filtered = Object.fromEntries(Object.entries(recordFields).filter(([name]) => names.has(name)));
    return this.updateDraftRecord(recordId, filtered);
  }

  async updateScreeningOutcome(recordId, { screeningResult, exclusionReason = '', nextAction = '' }) {
    const { fields: fieldDefinitions } = await this.ensureResearchAuditFields();
    const names = new Set(fieldDefinitions.map((field) => field.field_name));
    const fields = {
      筛选结果: screeningResult,
      排除原因: exclusionReason,
      ...(nextAction ? { 下一步动作: nextAction } : {}),
    };
    return this.updateDraftRecord(
      recordId,
      Object.fromEntries(Object.entries(fields).filter(([name]) => names.has(name))),
    );
  }

  async createDraftRecord({ customer, contact, draft }) {
    const fields = await this.listFields();
    const names = new Set(fields.map((field) => field.field_name));
    const missing = FOLLOWUP_FIELDS.filter((name) => !names.has(name));
    if (missing.length) {
      throw new AppError('飞书表缺少草稿字段，请先点击“检查飞书表结构”', {
        status: 409,
        code: 'FEISHU_FIELDS_MISSING',
        details: { missing },
      });
    }

    const recommendedProducts = draft.recommendedProducts
      .map((item) => `${item.name}: ${item.reason}`)
      .join('\n');
    const website = websiteLink(customer.website);
    const notes = [
      `客户编号: ${customer.billCode || '-'}`,
      `联系人职位: ${contact.jobRole || '-'}`,
      `AI判断: ${draft.qualified ? '建议开发' : '建议暂缓'} - ${draft.qualificationReason}`,
      `行业: ${draft.industry || customer.industry || '-'}`,
      `痛点: ${draft.painPoints.join('; ') || '-'}`,
      `个性化依据: ${draft.personalizationNotes.join('; ') || '-'}`,
      `风险提示: ${draft.riskFlags.join('; ') || '无'}`,
      `合规问题: ${draft.compliance?.issues?.join('; ') || '无'}`,
      `模型: ${draft.debug?.model || '-'}`,
      `生成时间: ${new Date().toISOString()}`,
    ].join('\n');
    const recordFields = {
      公司名: customer.companyName,
      孚盟客户ID: customer.id,
      孚盟联系人ID: contact.id,
      联系人姓名: contact.name,
      联系人邮箱: contact.email,
      国家: draft.country || customer.country,
      客户类型: draft.customerType,
      ...(website ? { 官网: { link: website, text: normalizeDomain(customer.website) } } : {}),
      客户画像: draft.customerProfile,
      AI推荐产品: recommendedProducts,
      AI邮件主题: draft.emailSubject,
      AI邮件正文: draft.emailBody,
      人工审核状态: '背调完成·精准',
      筛选结果: '已进入营销队列',
      排除原因: '',
      下一步动作: '等待定时发送',
      备注: notes,
    };
    const existing = await this.findCompanyRecord(customer.id);
    if (existing) {
      const existingFields = existing.fields || {};
      const merged = {
        ...recordFields,
        孚盟联系人ID: compactList([fieldText(existingFields['孚盟联系人ID']), contact.id]),
        联系人姓名: compactList([fieldText(existingFields['联系人姓名']), contact.name]),
        联系人邮箱: compactList([fieldText(existingFields['联系人邮箱']), contact.email]),
        备注: fieldText(existingFields['备注']).includes('记录类型: Apollo背调审计')
          ? `${fieldText(existingFields['备注'])}\n\n首封邮件草稿已更新: ${new Date().toISOString()}`
          : notes,
      };
      await this.updateDraftRecord(existing.record_id || existing.id, merged);
      return { ...existing, record_id: existing.record_id || existing.id };
    }
    const data = await this.request(this.tablePath('/records'), {
      method: 'POST',
      body: { fields: recordFields },
    });
    return data.data?.record || data.data;
  }
}
