import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/lib/errors.mjs';
import {
  MarketingService,
  secondTouchEligibleAt,
  draftQuality,
  selectEmailProducts,
  screeningOutcome,
  websiteDecision,
} from '../src/services/marketing-service.mjs';

function goodDraft() {
  return {
    qualified: true,
    compliance: { approved: true, issues: [] },
    reviewRequired: false,
    emailSubject: 'Reliable industrial power supply support',
    emailBody: Array.from({ length: 100 }, (_, index) => `word${index}`).join(' '),
  };
}

test('priced product selection replaces missing model images with relevant image-ready models', () => {
  const entries = Array.from({ length: 7 }, (_, index) => ({
    model: `AD-${index + 1}A`,
    marketingPrice: 10 + index,
    currency: 'USD',
    quoteDate: `2026-07-0${index + 1}`,
  }));
  const availableImages = Object.fromEntries(entries.slice(0, 6).map((entry) => [
    entry.model,
    `https://assets.example/${entry.model}.png`,
  ]));

  const products = selectEmailProducts({
    recommendedProducts: [{ name: 'AD series', reason: 'Backup power application' }],
    catalog: { entries },
    limit: 6,
    emailAssets: { availableImages },
  });

  assert.equal(products.length, 6);
  assert.ok(products.every((product) => product.imageAvailable));
  assert.ok(products.every((product) => product.imageSource === 'exact_model_asset'));
});

test('automatic draft quality requires a valid recipient, applied write-back, and clean content', () => {
  const base = {
    enrichment: {
      confidence: 100,
      emailVerified: true,
      contact: { email: 'buyer@example.com', jobRole: 'Purchasing Manager' },
      changes: [{ field: 'create' }],
      writebackApplied: true,
    },
    draft: goodDraft(),
    autoApproveScore: 85,
  };
  const approved = draftQuality(base);
  const blocked = draftQuality({
    ...base,
    enrichment: { ...base.enrichment, writebackApplied: false, writebackError: 'nickname is required' },
    draft: { ...base.draft, emailBody: `${base.draft.emailBody} {{company}}` },
  });
  assert.equal(approved.approved, true);
  assert.equal(blocked.approved, false);
  assert.ok(blocked.issues.some((issue) => issue.includes('占位符')));
  assert.ok(blocked.issues.some((issue) => issue.includes('回填孚盟')));
  assert.ok(blocked.issues.some((issue) => issue.includes('nickname is required')));
  const cjkBlocked = draftQuality({
    ...base,
    draft: { ...base.draft, emailBody: `${base.draft.emailBody} 这里仍有中文。` },
  });
  assert.equal(cjkBlocked.approved, false);
  assert.ok(cjkBlocked.issues.some((issue) => issue.includes('中文字符')));
});

test('automatic draft quality can queue a valid Apollo contact before provider verification', () => {
  const result = draftQuality({
    enrichment: {
      confidence: 100,
      emailVerified: false,
      source: 'apollo_search',
      contact: { email: 'buyer@example.com', jobRole: 'Purchasing Manager' },
      changes: [],
      writebackApplied: false,
    },
    draft: goodDraft(),
    autoApproveScore: 85,
  });
  assert.equal(result.approved, true);
  assert.ok(result.warnings.some((warning) => warning.includes('未标记为已验证')));
});

test('screening outcomes separate explicit exclusion from records needing enrichment', () => {
  assert.deepEqual(
    screeningOutcome({ enrichment: { status: 'failed', error: 'quota exceeded' } }),
    { result: '待补全·背调失败', code: 'research_failed', reason: '未排除：Apollo 背调失败，等待重试。quota exceeded' },
  );
  assert.match(
    screeningOutcome({ enrichment: { status: 'enriched' }, decision: { qualified: false, reason: 'SaaS only' } }).reason,
    /非精准客户.*SaaS only/,
  );
  assert.match(
    screeningOutcome({ enrichment: { status: 'enriched' }, decision: { qualified: null, reason: '缺少官网' } }).reason,
    /证据不足.*缺少官网/,
  );
  assert.match(
    screeningOutcome({ enrichment: { status: 'company_mismatch' }, decision: { qualified: true, reason: '业务精准' } }).reason,
    /Apollo 尚未匹配.*业务精准/,
  );
  assert.equal(
    screeningOutcome({ enrichment: { status: 'company_mismatch' }, decision: { qualified: true, reason: '业务精准' } }).result,
    '营销目标·待补全',
  );
});

test('website decision only rejects when evidence supports a confident model rejection', () => {
  const uncertain = websiteDecision(
    { status: 'failed', text: '', signals: { directFit: false } },
    { qualified: false, reviewRequired: true, qualificationReason: 'Website could not be reviewed.' },
  );
  const targetWithoutWebsite = websiteDecision(
    { status: 'failed', text: '', signals: { directFit: false } },
    { qualified: true, reviewRequired: false, qualificationReason: 'Apollo organization data confirms an industrial controls company.' },
  );
  const uncertainWithText = websiteDecision(
    {
      status: 'fetched',
      text: 'Generic company description without enough product or industry detail. '.repeat(5),
      signals: { directFit: false },
    },
    { qualified: false, reviewRequired: true, qualificationReason: 'Business fit remains uncertain.' },
  );
  const rejected = websiteDecision(
    {
      status: 'fetched',
      text: '2GIS provides digital city maps, local business listings, navigation, advertising, and consumer discovery tools. '.repeat(3),
      signals: { directFit: false },
    },
    { qualified: false, reviewRequired: false, qualificationReason: 'Unrelated mapping and advertising platform.' },
  );
  assert.equal(uncertain.qualified, null);
  assert.equal(targetWithoutWebsite.qualified, true);
  assert.equal(uncertainWithText.qualified, null);
  assert.equal(rejected.qualified, false);
});

test('startup recovery completes interrupted Feishu audit without creating a duplicate record', async () => {
  const attached = [];
  const updates = [];
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({
        id: 'customer-1', companyName: 'Recovered Power', country: 'Sweden', website: 'recovered.example',
      }),
      listContacts: async () => [{
        id: 'contact-1', name: 'Buyer', email: 'buyer@recovered.example', jobRole: 'Purchasing Manager',
      }],
    },
    enrichment: {},
    drafts: {},
    marketing: {
      listIncompleteEnrichmentAudits: () => [{
        id: 'run-1', customerId: 'customer-1', companyName: 'Recovered Power', status: 'enriched',
        confidence: 98, apolloOrgId: 'org-1', apolloPersonId: 'person-1', changes: [],
        details: { organization: { id: 'org-1', name: 'Recovered Power' }, emailVerified: true },
        feishuRecordId: 'rec-existing', feishuSyncStatus: 'created',
      }],
      attachEnrichmentFeishuRecord: (id, value) => attached.push({ id, ...value }),
    },
    feishu: {
      updateResearchRecord: async (recordId, value) => updates.push({ recordId, ...value }),
    },
    brevo: {},
    config: {},
  });

  const result = await service.recoverIncompleteFeishuResearchAudits();
  assert.deepEqual(result, { found: 1, recovered: 1, failed: 0, failures: [] });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].recordId, 'rec-existing');
  assert.equal(updates[0].enrichment.contactCandidates[0].person.id, 'person-1');
  assert.match(updates[0].exclusionReason, /未排除.*自动补写/);
  assert.deepEqual(attached, [{
    id: 'run-1', recordId: 'rec-existing', status: 'synced',
  }]);
});

test('send dispatcher rechecks Fumeng state, sends once, then records follow-up', async () => {
  const calls = [];
  const job = {
    id: 'job-1', customerId: 'customer-1', contactId: 'contact-1', email: 'buyer@example.com',
    campaign: 'second_touch_v1', contactName: 'Buyer', subject: 'Power supplies',
    htmlContent: '<p>Hello</p>', textContent: 'Hello',
  };
  const marketing = {
    reserveDue: () => [job], isSuppressed: () => false,
    markSent: (id, messageId) => calls.push(['sent', id, messageId]),
    markFailed: () => { throw new Error('not expected'); },
    markCancelled: () => { throw new Error('not expected'); },
    addEvent: (id, event) => calls.push(['event', id, event]),
  };
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-1', companyName: 'Example', customerStateId: '2', ownerContactId: 'owner', ownerDepartmentKey: 'dept' }),
      listContacts: async () => [{ id: 'contact-1', name: 'Buyer', email: 'buyer@example.com' }],
      addEmailFollowup: async () => ({ id: 'followup-1' }),
    },
    enrichment: {}, drafts: {}, marketing,
    brevo: { send: async () => ({ messageId: '<message-1>' }) },
    delivery: { recordSent: (input) => calls.push(['delivery', input.messageId, input.email, input.campaign]) },
    config: {
      brevo: { sendingEnabled: true },
      fumeng: { writebackEnabled: true },
      marketing: { enabled: true, dailySendLimit: 10 },
    },
  });
  const result = await service.sendDue({ limit: 10 });
  assert.equal(result.sent, 1);
  assert.deepEqual(calls[0], ['sent', 'job-1', '<message-1>']);
  assert.deepEqual(calls[1], ['delivery', '<message-1>', 'buyer@example.com', 'second_touch_v1']);
  assert.deepEqual(calls[2], ['event', 'job-1', 'delivery_status_recorded']);
  assert.deepEqual(calls[3], ['event', 'job-1', 'fumeng_followup_created']);
});

test('send dispatcher keeps sending queued emails while Apollo research is paused', async () => {
  let sent = 0;
  const job = {
    id: 'job-queued', customerId: 'customer-1', contactId: 'contact-1', email: 'buyer@example.com',
    contactName: 'Buyer', subject: 'Power supplies', htmlContent: '<p>Hello</p>', textContent: 'Hello',
  };
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-1', companyName: 'Example', customerStateId: '2' }),
      listContacts: async () => [{ id: 'contact-1', name: 'Buyer', email: 'buyer@example.com' }],
    },
    enrichment: {}, drafts: {},
    marketing: {
      reserveDue: () => [job],
      isSuppressed: () => false,
      markSent: () => { sent += 1; },
      markFailed: () => {},
      markCancelled: () => {},
      addEvent: () => {},
    },
    brevo: { send: async () => ({ messageId: '<message-queued>' }) },
    config: {
      brevo: { sendingEnabled: true },
      fumeng: { writebackEnabled: false },
      marketing: { enabled: true, researchEnabled: false, dailySendLimit: 300 },
    },
  });

  const result = await service.sendDue({ limit: 1 });

  assert.equal(result.sent, 1);
  assert.equal(sent, 1);
});

test('second-touch eligibility uses two or five business days', () => {
  assert.equal(
    secondTouchEligibleAt('2026-08-28T08:00:00.000Z', 2).toISOString(),
    '2026-09-01T08:00:00.000Z',
  );
  assert.equal(
    secondTouchEligibleAt('2026-08-28T08:00:00.000Z', 1).toISOString(),
    '2026-09-04T08:00:00.000Z',
  );
});

test('second-touch queue reuses stored research and limits each company to two openers', () => {
  const products = Array.from({ length: 6 }, (_, index) => ({
    model: `MODEL-${index + 1}`,
    price: 70 + index,
    currency: 'CNY',
    availability: 'In Stock',
    imageUrl: `https://assets.example.test/model-${index + 1}.png`,
    imageAvailable: true,
    imageSource: 'exact_model_asset',
  }));
  const firstJobs = new Map(['one', 'two', 'three'].map((messageId, index) => [messageId, {
    id: `first-${messageId}`,
    campaign: 'initial_outreach_v1',
    customerId: 'company-1',
    contactId: `contact-${index + 1}`,
    companyName: 'Apex Controls',
    contactName: `Buyer ${index + 1}`,
    email: `buyer${index + 1}@example.com`,
    country: 'India',
    timeZone: 'UTC',
    status: 'sent',
    score: 95,
    sentAt: '2026-09-01T08:00:00.000Z',
    apollo: { organizationId: 'apollo-company' },
    writeback: { applied: true },
    feishuRecordId: 'rec-company-1',
    draft: { industry: 'Industrial automation', country: 'India', pricing: { priceListDate: '2026-08-29', products } },
  }]));
  const enqueued = [];
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {}, brevo: {},
    delivery: {
      listOpenedRecipients: () => ['one', 'two', 'three'].map((messageId, index) => ({
        messageId, email: `buyer${index + 1}@example.com`, openCount: 4 - index,
        lastOpenAt: `2026-09-0${index + 1}T10:00:00.000Z`,
      })),
    },
    marketing: {
      findJobByMessageId: (messageId) => firstJobs.get(messageId),
      findCampaignJob: () => null,
      getCampaignSummary: () => ({ total: 0, queued: 0, sent: 0, failed: 0, byStatus: {} }),
      isSuppressed: () => false,
      enqueue: (job) => { enqueued.push(job); return { created: true, job }; },
    },
    priceCatalog: {
      generatedDate: '2026-08-29',
      entries: products.map((product, index) => ({
        model: product.model,
        quoteDate: '2026-08-29',
        marketingPrice: product.price,
        currency: 'CNY',
        emailPrice: 10 + index,
        emailCurrency: 'USD',
      })),
    },
    config: {
      sales: {
        teamName: 'MEAN WELL KULON TEAM',
        email: 'marketing@kulon.com',
        website: 'https://meanwell-led.com/',
        logoUrl: 'https://assets.example.test/logo.png',
      },
      marketing: {
        secondTouchEnabled: true,
        secondTouchPilotLimit: 50,
        secondTouchMaxContactsPerCompany: 2,
        secondTouchMultiOpenDelayDays: 2,
        secondTouchSingleOpenDelayDays: 5,
        sendWindowStartHour: 9,
        sendWindowEndHour: 16,
      },
    },
  });

  const result = service.queueSecondTouch({ now: new Date('2026-09-04T10:00:00.000Z') });
  assert.equal(result.created, 2);
  assert.equal(enqueued.length, 2);
  assert.ok(enqueued.every((job) => job.campaign === 'second_touch_v1'));
  assert.ok(enqueued.every((job) => job.draft.pricing.products.length === 4));
  assert.ok(enqueued.every((job) => job.draft.pricing.products.every((product) => product.currency === 'USD')));
  assert.ok(enqueued.every((job) => job.apollo.organizationId === 'apollo-company'));
  assert.doesNotMatch(enqueued[0].htmlContent, /FOLLOW-UP|SECOND TOUCH|Focused model selection/i);
});

test('send dispatcher does not reserve jobs while sending is disabled', async () => {
  let reserved = false;
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {}, brevo: {},
    marketing: { reserveDue: () => { reserved = true; return []; } },
    config: { brevo: { sendingEnabled: false }, marketing: { enabled: true, dailySendLimit: 10 } },
  });
  const result = await service.sendDue({ limit: 10 });
  assert.equal(result.skipped, 'sending_disabled');
  assert.equal(reserved, false);
});

test('send dispatcher only reserves recipients currently inside their local business window', async () => {
  let eligibility;
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {},
    marketing: {
      recoverBrevoAuthFailures: () => 0,
      reserveDue: (options) => { eligibility = options.isEligible; return []; },
    },
    brevo: { checkAccess: async () => ({ ok: true }) },
    config: {
      brevo: { sendingEnabled: true },
      marketing: { enabled: true, dailySendLimit: 300, sendWindowStartHour: 9, sendWindowEndHour: 16 },
    },
  });
  const now = new Date('2026-09-01T13:00:00.000Z');
  await service.sendDue({ limit: 10, now });
  assert.equal(eligibility({ timeZone: 'America/New_York' }), true);
  assert.equal(eligibility({ timeZone: 'Asia/Kolkata' }), false);
  assert.equal(eligibility({ timeZone: '' }), false);
});

test('candidate selection scans beyond the first 1000 records and skips recent enrichment attempts', async () => {
  let calls = 0;
  const service = new MarketingService({
    fumeng: {
      listCustomers: async ({ from, size }) => {
        calls += 1;
        const items = Array.from({ length: Math.min(size, 1051 - from) }, (_, index) => {
          const position = from + index;
          return {
            id: `customer-${position}`,
            customerStateId: position >= 1000 ? '1' : '3',
          };
        });
        return { total: 1051, items };
      },
    },
    enrichment: {}, drafts: {}, brevo: {},
    marketing: {
      hasRecentCustomerActivity: (customerId) => customerId === 'customer-1000',
    },
    config: { marketing: { companyCooldownDays: 7 } },
  });

  const result = await service.listCandidates({ limit: 2 });
  assert.deepEqual(result.items.map((item) => item.id), ['customer-1001', 'customer-1002']);
  assert.equal(result.scanned, 1050);
  assert.equal(result.sourceTotal, 1051);
  assert.equal(calls, 21);
});

test('daily marketing can queue beyond the send quota and stops at the company target', async () => {
  let allocated = 0;
  let marketed = 0;
  let recordedBatch;
  const prepared = [];
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {}, brevo: {},
    marketing: {
      getDailyMarketingStats: () => ({ emailsAllocatedToday: allocated, emailsSentToday: 0, companiesMarketedToday: marketed }),
      recordScreeningBatch: (batch) => { recordedBatch = batch; return { id: 'batch-1', ...batch }; },
    },
    config: { marketing: { enabled: true, dailyCompanyLimit: 2, dailyResearchLimit: 10, dailySendLimit: 1 } },
  });
  service.listCandidates = async ({ limit }) => ({
    total: limit,
    scanned: limit,
    sourceTotal: limit,
    items: Array.from({ length: limit }, (_, index) => ({ id: `customer-${index}` })),
  });
  service.prepareCustomer = async ({ customerId }) => {
    allocated += 2;
    marketed += 1;
    prepared.push(customerId);
    return {
      queued: true,
      customerId,
      decision: { qualified: true },
      enrichment: {
        status: 'enriched',
        contactCandidates: [{ contact: { email: `${customerId}@example.com` } }],
        changes: [{ entity: 'contact', field: 'create', value: `${customerId}@example.com` }],
      },
      jobs: [{ created: true }, { created: true }],
    };
  };

  const result = await service.runDailyMarketing();

  assert.equal(result.targetCompanies, 2);
  assert.equal(result.researchLimit, 10);
  assert.equal(result.dailySendLimit, 1);
  assert.equal(result.researched, 2);
  assert.deepEqual(prepared, ['customer-0', 'customer-1']);
  assert.equal(allocated, 4);
  assert.equal(recordedBatch.researched, 2);
  assert.equal(recordedBatch.qualified, 2);
  assert.equal(recordedBatch.queuedEmails, 4);
  assert.equal(recordedBatch.contactsFound, 2);
  assert.equal(recordedBatch.contactsCreated, 2);
  assert.equal(result.screeningBatch.id, 'batch-1');
});

test('daily marketing respects the remaining cumulative Apollo research limit', async () => {
  const prepared = [];
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {}, brevo: {},
    marketing: {
      getDailyMarketingStats: () => ({
        apolloResearchToday: 9,
        companiesMarketedToday: 0,
      }),
    },
    config: { marketing: { enabled: true, dailyCompanyLimit: 10, dailyResearchLimit: 10, dailySendLimit: 300 } },
  });
  service.listCandidates = async ({ limit }) => ({
    scanned: limit,
    sourceTotal: 10,
    items: Array.from({ length: limit }, (_, index) => ({ id: `customer-${index}` })),
  });
  service.prepareCustomer = async ({ customerId }) => {
    prepared.push(customerId);
    return { queued: false, reason: 'qualification_uncertain' };
  };

  const result = await service.runDailyMarketing({ researchLimit: 10 });

  assert.equal(result.researchLimit, 1);
  assert.equal(result.researched, 1);
  assert.deepEqual(prepared, ['customer-0']);
});

test('daily marketing stops immediately and persists the pause when Apollo credits are exhausted', async () => {
  const prepared = [];
  const pauses = [];
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {}, brevo: {},
    marketing: {
      getDailyMarketingStats: () => ({ apolloResearchToday: prepared.length, companiesMarketedToday: 0 }),
      recordScreeningBatch: (batch) => batch,
    },
    config: {
      marketing: {
        enabled: true,
        researchEnabled: true,
        researchPauseReason: '',
        dailyCompanyLimit: 10,
        dailyResearchLimit: 100,
        dailySendLimit: 300,
      },
    },
    onResearchPaused: async (value) => { pauses.push(value); },
  });
  service.listCandidates = async () => ({
    scanned: 3,
    sourceTotal: 3,
    items: [{ id: 'customer-1' }, { id: 'customer-2' }, { id: 'customer-3' }],
  });
  service.prepareCustomer = async ({ customerId }) => {
    prepared.push(customerId);
    throw new AppError('Apollo credits exhausted', {
      status: 429,
      code: 'APOLLO_CREDITS_EXHAUSTED',
    });
  };

  const result = await service.runDailyMarketing();

  assert.deepEqual(prepared, ['customer-1']);
  assert.equal(result.researchPaused, true);
  assert.equal(result.researchPauseReason, 'apollo_credits_exhausted');
  assert.equal(service.config.marketing.researchEnabled, false);
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].reason, 'apollo_credits_exhausted');
});

test('candidate preparation creates a Feishu review record before queueing', async () => {
  const calls = [];
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-1', companyName: 'Example Power', country: '印度', countryEnglish: 'INDIA', website: 'example.com' }),
      listContacts: async () => [{ id: 'contact-1', name: 'Buyer', email: 'buyer@example.com', jobRole: 'Purchasing Manager' }],
    },
    enrichment: {
      enrich: async () => ({
        status: 'enriched', customer: { id: 'customer-1', companyName: 'Example Power', country: '印度', website: 'example.com' },
        contact: { id: 'contact-1', name: 'Buyer', email: 'buyer@example.com', jobRole: 'Purchasing Manager' },
        confidence: 100, emailVerified: true, changes: [], writebackApplied: true, runId: 'run-1',
      }),
    },
    drafts: {
      researchCompany: async () => ({
        status: 'fetched', finalUrl: 'https://example.com/', title: 'Example Power',
        description: 'Industrial power supply distributor', text: 'Industrial power supply distributor',
        signals: { meanWellMentioned: false, matchedTerms: ['power supply'], directFit: false },
      }),
      analyzeCompanyFromData: async () => ({ draft: {
        qualified: true, compliance: { approved: true, issues: [] }, reviewRequired: false,
        emailSubject: 'Reliable industrial power supply support',
        emailBody: Array.from({ length: 100 }, (_, index) => `word${index}`).join(' '),
        customerType: 'distributor', customerProfile: 'Industrial distributor', country: 'India',
        industry: 'Industrial', qualificationReason: 'Relevant buyer', painPoints: [], recommendedProducts: [],
        personalizationNotes: [], riskFlags: [], debug: { model: 'relay-model' },
      } }),
    },
    marketing: {
      canContact: () => true,
      enqueue: (input) => { calls.push(input); return { created: true, job: { id: 'job-1', ...input } }; },
      attachEnrichmentFeishuRecord: () => {},
      resolveCompanyExclusions: () => {},
    },
    feishu: {
      createResearchRecord: async ({ customer }) => { calls.push(['research-create', customer.id]); return { record_id: 'research-1' }; },
      updateResearchRecord: async (recordId) => { calls.push(['research-update', recordId]); return { record_id: recordId }; },
    },
    brevo: {},
    config: {
      fumeng: { writebackEnabled: true },
      marketing: { companyCooldownDays: 7, autoApproveScore: 85, sendWindowStartHour: 9, sendWindowEndHour: 16 },
      sales: { teamName: 'KULON TEAM', email: 'marketing@kulon.com', website: 'https://meanwell-led.com/' },
    },
  });

  const result = await service.prepareCustomer({ customerId: 'customer-1' });
  assert.equal(result.feishuRecordId, 'research-1');
  assert.equal(result.researchRecordId, 'research-1');
  assert.equal('waitingForFeishuReview' in result, false);
  assert.equal(calls.find((item) => !Array.isArray(item)).feishuRecordId, 'research-1');
  assert.equal(calls.some((item) => Array.isArray(item) && item[0] === 'draft-create'), false);
});

test('candidate preparation records missing exact model images and does not queue an email', async () => {
  const updates = [];
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-images', companyName: 'Example Power', country: '印度', website: 'example.com' }),
      listContacts: async () => [{ id: 'contact-images', name: 'Buyer', email: 'buyer@example.com', jobRole: 'Purchasing Manager' }],
    },
    enrichment: {
      enrich: async () => ({
        status: 'enriched', customer: { id: 'customer-images', companyName: 'Example Power', country: '印度', website: 'example.com' },
        contact: { id: 'contact-images', name: 'Buyer', email: 'buyer@example.com', jobRole: 'Purchasing Manager' },
        confidence: 100, emailVerified: true, changes: [], writebackApplied: true, runId: 'run-images',
      }),
    },
    drafts: {
      analyzeCompanyFromData: async () => ({ draft: {
        ...goodDraft(), customerType: 'distributor', customerProfile: 'Industrial distributor', country: 'India',
        industry: 'Industrial', qualificationReason: 'Relevant buyer', recommendedProducts: [{ name: 'LRS series', reason: 'Enclosed models' }],
      } }),
    },
    marketing: {
      canContact: () => true,
      enqueue: () => { throw new Error('must not queue without exact images'); },
      recordExclusion: (input) => { updates.push({ type: 'exclusion', ...input }); },
      attachEnrichmentFeishuRecord: () => {},
      resolveCompanyExclusions: () => {},
    },
    feishu: {
      createResearchRecord: async () => ({ record_id: 'research-images' }),
      updateResearchRecord: async (recordId, input) => { updates.push({ type: 'research', recordId, ...input }); return { record_id: recordId }; },
    },
    brevo: {},
    config: {
      fumeng: { writebackEnabled: true },
      marketing: { companyCooldownDays: 7, autoApproveScore: 85, sendWindowStartHour: 9, sendWindowEndHour: 16 },
      pricing: { maxEmailModels: 6 },
      sales: { teamName: 'KULON TEAM', email: 'marketing@kulon.com', website: 'https://meanwell-led.com/' },
    },
    priceCatalog: {
      generatedDate: '2026-08-29',
      entries: Array.from({ length: 6 }, (_, index) => ({
        model: `LRS-${index + 1}-24`, marketingPrice: 100 + index, currency: 'CNY', quoteDate: '2026-08-29',
      })),
    },
  });

  const result = await service.prepareCustomer({ customerId: 'customer-images' });

  assert.equal(result.queued, false);
  assert.equal(result.reason, 'product_images_missing');
  assert.equal(result.missingModels.length, 6);
  assert.match(updates.filter((item) => item.type === 'research').at(-1).exclusionReason, /具体产品图/);
});

test('company qualification still runs when Apollo cannot match the organization', async () => {
  const updates = [];
  let analyzed = false;
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-2', companyName: 'Industrial Controls', website: 'industrial.example', country: 'Argentina' }),
      listContacts: async () => [{ id: 'contact-2', name: 'Sales', email: 'sales@industrial.example' }],
    },
    enrichment: { enrich: async () => ({
      runId: 'run-2', status: 'company_mismatch', confidence: 30,
      customer: { id: 'customer-2', companyName: 'Industrial Controls', website: 'industrial.example', country: 'Argentina' },
      organization: { id: 'wrong-org', website: 'wrong.example' }, changes: [],
    }) },
    drafts: {
      researchCompany: async (customer) => {
        assert.equal(customer.website, 'industrial.example');
        return {
          status: 'fetched', finalUrl: 'https://industrial.example/', text: 'MEAN WELL industrial automation',
          signals: { directFit: true, meanWellMentioned: true, matchedTerms: ['mean well'] },
        };
      },
      analyzeCompanyFromData: async () => {
        analyzed = true;
        return { draft: { ...goodDraft(), qualificationReason: 'Relevant industrial controls company.' } };
      },
    },
    marketing: { attachEnrichmentFeishuRecord: () => {}, resolveCompanyExclusions: () => {} },
    feishu: {
      createResearchRecord: async () => ({ record_id: 'research-2' }),
      updateResearchRecord: async (id, input) => { updates.push(input); return { record_id: id }; },
    },
    brevo: {},
    config: { apollo: { minimumCompanyScore: 75 }, marketing: { enabled: true } },
  });

  const result = await service.prepareCustomer({ customerId: 'customer-2' });

  assert.equal(analyzed, true);
  assert.equal(result.queued, false);
  assert.equal(result.reason, 'company_mismatch');
  assert.equal(result.decision.qualified, true);
  assert.equal(updates[0].decision.qualified, true);
});

test('validation mode can research while marketing and sending remain paused', async () => {
  const prepared = [];
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {}, brevo: {},
    marketing: { getDailyMarketingStats: () => ({ companiesMarketedToday: 0 }) },
    config: { marketing: { enabled: false, dailyCompanyLimit: 10, dailyResearchLimit: 10, dailySendLimit: 300 } },
  });
  service.listCandidates = async ({ limit }) => ({
    scanned: limit, sourceTotal: limit,
    items: Array.from({ length: limit }, (_, index) => ({ id: `validation-${index}` })),
  });
  service.prepareCustomer = async (input) => {
    prepared.push(input);
    return { queued: false, reason: 'qualification_uncertain' };
  };

  const result = await service.runDailyMarketing({ researchLimit: 10, allowWhenPaused: true });

  assert.equal(result.researched, 10);
  assert.equal(prepared.length, 10);
  assert.ok(prepared.every((item) => item.allowWhenPaused === true));
});

test('Apollo is not called when the mandatory Feishu research audit cannot be created', async () => {
  let apolloCalled = false;
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-1', companyName: 'Example' }),
      listContacts: async () => [],
    },
    enrichment: { enrich: async () => { apolloCalled = true; return {}; } },
    drafts: {}, marketing: {}, brevo: {},
    feishu: {
      createResearchRecord: async () => { throw new Error('permission denied'); },
      updateResearchRecord: async () => {},
    },
    config: { marketing: { enabled: true } },
  });

  await assert.rejects(() => service.prepareCustomer({ customerId: 'customer-1' }), /未调用 Apollo/);
  assert.equal(apolloCalled, false);
});

test('send dispatcher sends a qualified queued email without Feishu approval', async () => {
  let sent = false;
  let getDraftRecordCalled = false;
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-1', companyName: 'Example', customerStateId: '2' }),
      listContacts: async () => [{ id: 'contact-1', name: 'Buyer', email: 'buyer@example.com' }],
    },
    enrichment: {}, drafts: {},
    marketing: {
      reserveDue: () => [{ id: 'job-1', customerId: 'customer-1', email: 'buyer@example.com', feishuRecordId: 'rec-1' }],
      isSuppressed: () => false,
      markSent: () => {},
      markCancelled: () => { throw new Error('not expected'); },
      markFailed: () => { throw new Error('not expected'); },
      addEvent: () => {},
    },
    feishu: { getDraftRecord: async () => { getDraftRecordCalled = true; throw new Error('approval must not be read'); } },
    brevo: { send: async () => { sent = true; return { messageId: 'message' }; } },
    config: { brevo: { sendingEnabled: true }, fumeng: { writebackEnabled: false }, marketing: { enabled: true, dailySendLimit: 10 } },
  });
  const result = await service.sendDue({ limit: 1 });
  assert.equal(result.sent, 1);
  assert.equal(result.results[0].status, 'sent');
  assert.equal(sent, true);
  assert.equal(getDraftRecordCalled, false);
});

test('send dispatcher does not reserve jobs while Brevo account access is blocked', async () => {
  let reserved = false;
  const service = new MarketingService({
    fumeng: {}, enrichment: {}, drafts: {}, feishu: {},
    marketing: {
      reserveDue: () => { reserved = true; return []; },
    },
    brevo: {
      checkAccess: async () => {
        throw new AppError('Brevo 暂停发信：Unrecognised IP address', {
          status: 503,
          code: 'BREVO_ACCESS_BLOCKED',
        });
      },
    },
    config: { brevo: { sendingEnabled: true }, marketing: { enabled: true, dailySendLimit: 10 } },
  });
  const result = await service.sendDue({ limit: 10 });
  assert.equal(result.skipped, 'brevo_access_blocked');
  assert.equal(result.reserved, 0);
  assert.equal(reserved, false);
});

test('send dispatcher recovers Brevo auth failures only after access succeeds', async () => {
  let recovered = 0;
  const service = new MarketingService({
    fumeng: {
      getCustomer: async () => ({ id: 'customer-1', companyName: 'Example', customerStateId: '2' }),
      listContacts: async () => [{ id: 'contact-1', name: 'Buyer', email: 'buyer@example.com' }],
    },
    enrichment: {}, drafts: {}, feishu: {},
    marketing: {
      recoverBrevoAuthFailures: () => { recovered += 1; return 933; },
      reserveDue: () => [{ id: 'job-1', customerId: 'customer-1', contactId: 'contact-1', email: 'buyer@example.com' }],
      isSuppressed: () => false,
      markSent: () => {},
      addEvent: () => {},
    },
    brevo: {
      checkAccess: async () => ({ ok: true }),
      send: async () => ({ messageId: 'message' }),
    },
    config: {
      brevo: { sendingEnabled: true },
      fumeng: { writebackEnabled: false },
      marketing: { enabled: true, dailySendLimit: 10 },
    },
  });
  const result = await service.sendDue({ limit: 1 });
  assert.equal(result.sent, 1);
  assert.equal(result.recovered, 933);
  assert.equal(recovered, 1);
});
