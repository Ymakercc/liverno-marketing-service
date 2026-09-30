import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FeishuClient,
  DELIVERY_TRACKING_FIELDS,
  FOLLOWUP_FIELDS,
  INBOUND_TRACKING_FIELDS,
  RESEARCH_AUDIT_FIELDS,
  chooseCanonicalCompanyRecord,
  normalizeDraftRecord,
  summarizeDraftRecords,
} from '../src/lib/feishu-client.mjs';

test('canonical company record prefers a completed research audit over contact draft rows', () => {
  const record = chooseCanonicalCompanyRecord([
    { record_id: 'draft-1', last_modified_time: '3', fields: { 备注: '客户编号: C1', 筛选结果: '' } },
    { record_id: 'research-old', last_modified_time: '1', fields: { 备注: '记录类型: Apollo背调审计', 筛选结果: '' } },
    { record_id: 'research-final', last_modified_time: '2', fields: { 备注: '记录类型: Apollo背调审计', 筛选结果: '已进入营销队列' } },
  ]);
  assert.equal(record.record_id, 'research-final');
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function makeFields() {
  return [...FOLLOWUP_FIELDS, ...RESEARCH_AUDIT_FIELDS.map((field) => field.field_name)].map((fieldName) => ({
    field_name: fieldName,
    type: fieldName === '官网' ? 15 : 1,
    is_primary: fieldName === '公司名',
  }));
}

test('Feishu creates missing screening audit fields once', async () => {
  const created = [];
  let fields = makeFields().filter((field) => !RESEARCH_AUDIT_FIELDS.some((item) => item.field_name === field.field_name));
  const client = new FeishuClient(
    { baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret', appToken: 'base', tableId: 'table' },
    { fetchImpl: async (url, options) => {
      if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
      if (options.method === 'GET') return jsonResponse({ code: 0, data: { items: fields } });
      const body = JSON.parse(options.body);
      created.push(body.field_name);
      fields = [...fields, body];
      return jsonResponse({ code: 0, data: { field: body } });
    } },
  );

  const result = await client.ensureResearchAuditFields();

  assert.deepEqual(created, ['筛选结果', '排除原因']);
  assert.deepEqual(result.created, ['筛选结果', '排除原因']);
  assert.ok(result.fields.some((field) => field.field_name === '排除原因'));
});

test('Feishu schema check is read-only and accepts the existing review table', async () => {
  const calls = [];
  const client = new FeishuClient(
    {
      baseUrl: 'https://feishu.example',
      appId: 'app',
      appSecret: 'secret',
      appToken: 'base',
      tableId: 'table',
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.includes('/auth/v3/')) {
          return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
        }
        return jsonResponse({ code: 0, data: { items: makeFields() } });
      },
    },
  );

  const result = await client.checkDraftFields();
  assert.equal(result.ok, true);
  assert.equal(result.requiredFieldCount, FOLLOWUP_FIELDS.length);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET']);
});

test('Feishu can delete a specified obsolete field', async () => {
  const calls = [];
  const client = new FeishuClient(
    { baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret', appToken: 'base', tableId: 'table' },
    { fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
      if (options.method === 'GET') return jsonResponse({ code: 0, data: { items: [{ field_id: 'fld-old', field_name: '是否允许发送' }] } });
      return jsonResponse({ code: 0, data: { field_id: 'fld-old' } });
    } },
  );

  const fields = await client.listFields();
  await client.deleteField(fields[0].field_id);

  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'DELETE']);
  assert.match(calls.at(-1).url, /\/fields\/fld-old$/);
});

test('Feishu draft record maps to the existing field names without a send permission field', async () => {
  let recordBody;
  const client = new FeishuClient(
    {
      baseUrl: 'https://feishu.example',
      appId: 'app',
      appSecret: 'secret',
      appToken: 'base',
      tableId: 'table',
    },
    {
      fetchImpl: async (url, options) => {
        if (url.includes('/auth/v3/')) {
          return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
        }
        if (options.method === 'GET') {
          return jsonResponse({ code: 0, data: { items: makeFields() } });
        }
        if (url.includes('/records/search')) {
          return jsonResponse({ code: 0, data: { items: [] } });
        }
        recordBody = JSON.parse(options.body);
        return jsonResponse({ code: 0, data: { record: { record_id: 'rec1' } } });
      },
    },
  );

  const record = await client.createDraftRecord({
    customer: {
      id: 'cust1',
      billCode: 'IN001',
      companyName: 'Example Power',
      website: 'example.com',
      country: 'India',
      industry: 'Industrial automation',
    },
    contact: { id: 'contact1', name: 'Anika', email: 'anika@example.com', jobRole: 'Director' },
    draft: {
      qualified: true,
      qualificationReason: 'Relevant distributor',
      country: 'India',
      industry: 'Industrial automation',
      customerType: 'distributor',
      customerProfile: 'Industrial distributor',
      painPoints: ['lead time'],
      recommendedProducts: [{ name: 'DIN rail', reason: 'Control cabinet use' }],
      emailSubject: 'Power supply support',
      emailBody: 'Dear Example Power Team,',
      personalizationNotes: ['CRM industry'],
      riskFlags: [],
      compliance: { approved: true, issues: [] },
      debug: { model: 'relay-model' },
    },
  });

  assert.equal(record.record_id, 'rec1');
  assert.equal(recordBody.fields['公司名'], 'Example Power');
  assert.equal('是否允许发送' in recordBody.fields, false);
  assert.equal(recordBody.fields['人工审核状态'], '背调完成·精准');
  assert.deepEqual(recordBody.fields['官网'], { link: 'https://example.com', text: 'example.com' });
  assert.equal(recordBody.fields['AI邮件主题'], 'Power supply support');
});

test('Feishu research audit is created before Apollo and updated with all usable enrichment data', async () => {
  const bodies = [];
  const client = new FeishuClient(
    { baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret', appToken: 'base', tableId: 'table' },
    { fetchImpl: async (url, options) => {
      if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
      if (options.method === 'GET') return jsonResponse({ code: 0, data: { items: [...makeFields(), { field_name: '下一步动作', type: 1 }] } });
      if (url.includes('/records/search')) return jsonResponse({ code: 0, data: { items: [] } });
      bodies.push(JSON.parse(options.body));
      return jsonResponse({ code: 0, data: { record: { record_id: 'research-1' } } });
    } },
  );
  const customer = { id: 'cust1', billCode: 'AR001', companyName: 'Industrial Controles', website: 'industrial.example', country: 'Argentina' };
  const record = await client.createResearchRecord({ customer, contacts: [{ name: 'Sales', email: 'sales@industrial.example' }] });
  await client.updateResearchRecord(record.record_id, {
    customer,
    enrichment: {
      status: 'enriched', confidence: 100,
      organization: { id: 'org1', name: 'Industrial Controles', domain: 'industrial.example', industry: 'Industrial Automation', employeeCount: 50 },
      contactCandidates: [{
        source: 'apollo_match', emailVerified: true, writebackApplied: false,
        writebackError: '联系人昵称字段不能为空',
        contact: { id: 'c1', name: 'Buyer', email: 'buyer@industrial.example', jobRole: 'Purchasing Manager' },
        person: { id: 'p1', emailStatus: 'verified', linkedinUrl: 'https://linkedin.example/p1' },
      }],
      changes: [{ entity: 'contact', field: 'jobs', value: 'Purchasing Manager' }],
    },
    websiteEvidence: { status: 'fetched', title: 'Industrial Controls', description: 'Automation', signals: { meanWellMentioned: true, matchedTerms: ['mean well'] } },
    decision: { qualified: true, reason: 'Official website lists MEAN WELL products.' },
    screeningResult: '已进入营销队列',
    exclusionReason: '',
  });

  assert.equal(bodies[0].fields['人工审核状态'], '背调中');
  assert.equal(bodies[1].fields['人工审核状态'], '背调完成·精准');
  assert.match(bodies[1].fields['备注'], /Apollo组织ID: org1/);
  assert.match(bodies[1].fields['备注'], /buyer@industrial\.example/);
  assert.match(bodies[1].fields['备注'], /孚盟回填=失败: 联系人昵称字段不能为空/);
  assert.match(bodies[1].fields['备注'], /官网直接出现MEAN WELL: 是/);
  assert.equal(bodies[1].fields['筛选结果'], '已进入营销队列');
  assert.equal(bodies[1].fields['排除原因'], '');
});

test('Feishu reuses one company record and merges individual contact values without duplicates', async () => {
  let updateBody;
  const existing = {
    record_id: 'company-1',
    fields: {
      '孚盟客户ID': 'cust1',
      '孚盟联系人ID': 'contact1; contact2',
      '联系人姓名': 'Anika; Raj',
      '联系人邮箱': 'anika@example.com; raj@example.com',
      '备注': '记录类型: Apollo背调审计',
    },
  };
  const client = new FeishuClient(
    {
      baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret',
      appToken: 'base', tableId: 'table',
    },
    { fetchImpl: async (url, options) => {
      if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
      if (options.method === 'GET') return jsonResponse({ code: 0, data: { items: makeFields() } });
      if (url.includes('/records/search')) return jsonResponse({ code: 0, data: { items: [existing] } });
      updateBody = JSON.parse(options.body);
      return jsonResponse({ code: 0, data: { record: existing } });
    } },
  );

  const record = await client.createDraftRecord({
    customer: { id: 'cust1', companyName: 'Example Power', website: 'example.com', country: 'India' },
    contact: { id: 'contact2', name: 'Raj', email: 'raj@example.com', jobRole: 'Buyer' },
    draft: {
      qualified: true, qualificationReason: 'Relevant distributor', country: 'India', industry: 'Industrial',
      customerType: 'distributor', customerProfile: 'Industrial distributor', painPoints: [],
      recommendedProducts: [], emailSubject: 'Power supply support', emailBody: 'Hello',
      personalizationNotes: [], riskFlags: [], compliance: { approved: true, issues: [] }, debug: {},
    },
  });

  assert.equal(record.record_id, 'company-1');
  assert.equal(updateBody.fields['孚盟联系人ID'], 'contact1; contact2');
  assert.equal(updateBody.fields['联系人姓名'], 'Anika; Raj');
  assert.equal(updateBody.fields['联系人邮箱'], 'anika@example.com; raj@example.com');
  assert.equal('是否允许发送' in updateBody.fields, false);
});

test('Feishu draft record normalization handles rich field values', () => {
  const item = normalizeDraftRecord({
    record_id: 'rec1',
    created_time: '1755187200000',
    last_modified_time: '1755273600000',
    fields: {
      公司名: [{ text: 'Example Power' }],
      孚盟客户ID: 1201,
      联系人姓名: 'Anika',
      联系人邮箱: [{ text: 'anika@example.com' }],
      官网: { link: 'https://example.com', text: 'Example' },
      AI邮件正文: [{ text: 'First line.\n' }, { text: 'Second line.' }],
      人工审核状态: { text: '已批准' },
      筛选结果: '已排除·证据不足',
      排除原因: '官网证据不足',
    },
  });

  assert.equal(item.recordId, 'rec1');
  assert.equal(item.companyName, 'Example Power');
  assert.equal(item.customerId, '1201');
  assert.equal(item.contactEmail, 'anika@example.com');
  assert.equal(item.website, 'https://example.com');
  assert.equal(item.emailBody, 'First line.\nSecond line.');
  assert.equal(item.reviewStatus, '已批准');
  assert.equal('allowedToSend' in item, false);
  assert.equal(item.screeningResult, '已排除·证据不足');
  assert.equal(item.exclusionReason, '官网证据不足');
  assert.equal(item.createdAt, '2025-08-14T16:00:00.000Z');
  assert.equal(item.updatedAt, '2025-08-15T16:00:00.000Z');
});

test('Feishu draft summary groups processing status without send permission counts', () => {
  const summary = summarizeDraftRecords([
    { reviewStatus: '背调中' },
    { reviewStatus: '背调完成·精准' },
    { reviewStatus: '背调完成·精准' },
  ]);

  assert.deepEqual(summary, {
    total: 3,
    byReviewStatus: { 背调中: 1, '背调完成·精准': 2 },
  });
});

test('Feishu draft listing is read-only, paginated, sorted by recency, and limited', async () => {
  const calls = [];
  const client = new FeishuClient(
    {
      baseUrl: 'https://feishu.example',
      appId: 'app',
      appSecret: 'secret',
      appToken: 'base',
      tableId: 'table',
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, method: options.method });
        if (url.includes('/auth/v3/')) {
          return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
        }
        if (url.includes('page_token=next')) {
          return jsonResponse({
            code: 0,
            data: {
              items: [
                {
                  record_id: 'newest',
                  created_time: '3000',
                  fields: { 公司名: 'Newest', 人工审核状态: '已拒绝' },
                },
              ],
              has_more: false,
            },
          });
        }
        return jsonResponse({
          code: 0,
          data: {
            items: [
              {
                record_id: 'oldest',
                created_time: '1000',
                fields: { 公司名: 'Oldest', 人工审核状态: '待审核' },
              },
              {
                record_id: 'middle',
                created_time: '2000',
                fields: { 公司名: 'Middle', 人工审核状态: '已批准' },
              },
            ],
            has_more: true,
            page_token: 'next',
          },
        });
      },
    },
  );

  const result = await client.listDraftRecords({ limit: 2 });

  assert.deepEqual(result.items.map((item) => item.recordId), ['newest', 'middle']);
  assert.deepEqual(result.summary, {
    total: 2,
    byReviewStatus: { 已拒绝: 1, 已批准: 1 },
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'GET']);
  assert.match(calls[2].url, /page_token=next/);
});

test('Feishu draft records can be read and updated for send status', async () => {
  const calls = [];
  const client = new FeishuClient(
    {
      baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret', appToken: 'base', tableId: 'table',
    },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
        if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
        if (url.endsWith('/records/rec1')) {
          if (options.method === 'GET') return jsonResponse({ code: 0, data: { record: { record_id: 'rec1', fields: { 孚盟客户ID: 'cust1', 联系人邮箱: 'buyer@example.com', 人工审核状态: '已批准' } } } });
          return jsonResponse({ code: 0, data: { record: { record_id: 'rec1' } } });
        }
        return jsonResponse({ code: 0, data: { items: [{ field_name: '发送平台' }, { field_name: '送达状态' }, { field_name: '最后发送时间' }, { field_name: '下一步动作' }] } });
      },
    },
  );

  const record = await client.getDraftRecord('rec1');
  assert.equal(record.customerId, 'cust1');
  await client.updateSendStatus('rec1', { status: '已发送', sentAt: new Date('2026-08-22T00:00:00.000Z') });
  assert.deepEqual(calls.map((call) => call.method), ['POST', 'GET', 'GET', 'PUT']);
  assert.equal(calls.at(-1).body.fields['送达状态'], '已发送');
  assert.equal(calls.at(-1).body.fields['发送平台'], 'Brevo');
  assert.equal(calls.at(-1).body.fields['最后发送时间'], new Date('2026-08-22T00:00:00.000Z').getTime());
});

test('Feishu creates delivery counters and writes aggregated Brevo tracking fields', async () => {
  const calls = [];
  let fields = DELIVERY_TRACKING_FIELDS
    .filter((field) => !['打开次数', '点击次数'].includes(field.field_name));
  const client = new FeishuClient(
    {
      baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret', appToken: 'base', tableId: 'table',
    },
    {
      fetchImpl: async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url, method: options.method, body });
        if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
        if (url.endsWith('/fields') && options.method === 'POST') {
          fields = [...fields, body];
          return jsonResponse({ code: 0, data: { field: body } });
        }
        if (url.includes('/fields?')) return jsonResponse({ code: 0, data: { items: fields } });
        return jsonResponse({ code: 0, data: { record: { record_id: 'rec-company' } } });
      },
    },
  );

  await client.updateDeliveryTracking('rec-company', {
    statusLabel: '已打开 · 1 封异常',
    openCount: 5,
    clickCount: 2,
    lastSentAt: '2026-09-03T01:00:00.000Z',
    lastOpenedAt: '2026-09-03T02:00:00.000Z',
    lastClickedAt: '2026-09-03T03:00:00.000Z',
    lastClickedLink: 'https://example.com/product',
    failureReason: 'Mailbox unavailable',
    nextAction: '关注客户回复，并检查异常邮箱',
  });

  const created = calls.filter((call) => call.url.endsWith('/fields') && call.method === 'POST');
  assert.deepEqual(created.map((call) => call.body.field_name), ['打开次数', '点击次数']);
  const update = calls.find((call) => call.url.endsWith('/records/rec-company') && call.method === 'PUT');
  assert.equal(update.body.fields['送达状态'], '已打开 · 1 封异常');
  assert.equal(update.body.fields['打开次数'], 5);
  assert.equal(update.body.fields['点击次数'], 2);
  assert.equal(update.body.fields['最后发送时间'], new Date('2026-09-03T01:00:00.000Z').getTime());
  assert.deepEqual(update.body.fields['最后点击链接'], {
    link: 'https://example.com/product', text: 'https://example.com/product',
  });
  assert.equal(update.body.fields['退信原因'], 'Mailbox unavailable');
});

test('Feishu delivery backfill updates records in bounded batches', async () => {
  const calls = [];
  const client = new FeishuClient(
    {
      baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret', appToken: 'base', tableId: 'table',
    },
    {
      fetchImpl: async (url, options) => {
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ url, method: options.method, body });
        if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
        if (url.includes('/fields?')) return jsonResponse({ code: 0, data: { items: DELIVERY_TRACKING_FIELDS } });
        return jsonResponse({ code: 0, data: { records: body.records } });
      },
    },
  );

  const result = await client.batchUpdateDeliveryTracking([
    { recordId: 'rec-1', statusLabel: '已送达', openCount: 0, clickCount: 0 },
    { recordId: 'rec-2', statusLabel: '已打开', openCount: 3, clickCount: 0 },
    { recordId: 'rec-3', statusLabel: '已点击', openCount: 4, clickCount: 2 },
  ], { batchSize: 2 });

  assert.deepEqual(result, { requested: 3, updated: 3 });
  const updates = calls.filter((call) => call.url.endsWith('/records/batch_update'));
  assert.equal(updates.length, 2);
  assert.deepEqual(updates.map((call) => call.body.records.length), [2, 1]);
  assert.equal(updates[0].body.records[1].fields['打开次数'], 3);
});

test('Feishu creates and updates inbound reply tracking fields', async () => {
  const calls = [];
  let fields = [{ field_name: '回复状态', type: 1 }, { field_name: '下一步动作', type: 1 }];
  const client = new FeishuClient(
    { baseUrl: 'https://feishu.example', appId: 'app', appSecret: 'secret', appToken: 'base', tableId: 'table' },
    { fetchImpl: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ url, method: options.method, body });
      if (url.includes('/auth/v3/')) return jsonResponse({ code: 0, tenant_access_token: 'token', expire: 7200 });
      if (url.endsWith('/fields') && options.method === 'POST') {
        fields = [...fields, body];
        return jsonResponse({ code: 0, data: { field: body } });
      }
      if (url.includes('/fields?')) return jsonResponse({ code: 0, data: { items: fields } });
      return jsonResponse({ code: 0, data: { record: { record_id: 'rec-1' } } });
    } },
  );
  await client.updateInboundReply('rec-1', {
    status: '已回复·待人工查看', receivedAt: '2026-09-05T01:00:00.000Z',
    subject: 'Re: Power supplies', preview: 'Please quote these models.',
  });
  const created = calls.filter((call) => call.url.endsWith('/fields') && call.method === 'POST');
  assert.deepEqual(created.map((call) => call.body.field_name), INBOUND_TRACKING_FIELDS
    .filter((field) => !['回复状态', '下一步动作'].includes(field.field_name))
    .map((field) => field.field_name));
  const update = calls.find((call) => call.url.endsWith('/records/rec-1') && call.method === 'PUT');
  assert.equal(update.body.fields['回复状态'], '已回复·待人工查看');
  assert.equal(update.body.fields['回复主题'], 'Re: Power supplies');
  assert.equal(update.body.fields['回复摘要'], 'Please quote these models.');
});
