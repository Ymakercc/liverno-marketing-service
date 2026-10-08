import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MarketingStore } from '../src/lib/marketing-store.mjs';

function makeStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-marketing-'));
  const store = new MarketingStore({ databasePath: path.join(directory, 'marketing.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return store;
}

function input(overrides = {}) {
  return {
    customerId: 'customer-1', contactId: 'contact-1', companyName: 'Example',
    contactName: 'Asha', email: 'asha@example.com', country: 'India', timeZone: 'Asia/Kolkata',
    subject: 'Power supplies', htmlContent: '<p>Hello</p>', textContent: 'Hello',
    scheduledAt: new Date(Date.now() - 60_000).toISOString(), status: 'queued', score: 95,
    ...overrides,
  };
}

test('marketing queue is idempotent, enforces daily capacity, and suppresses stopped recipients', (t) => {
  const store = makeStore(t);
  const first = store.enqueue(input());
  const duplicate = store.enqueue(input());
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);

  const due = store.reserveDue({ limit: 10, dailyLimit: 1 });
  assert.equal(due.length, 1);
  store.markSent(due[0].id, '<message-1>');
  assert.equal(store.listSentJobs().length, 1);
  assert.equal(store.listSentJobs()[0].messageId, '<message-1>');
  assert.equal(store.reserveDue({ limit: 10, dailyLimit: 1 }).length, 0);

  store.enqueue(input({ customerId: 'customer-2', email: 'blocked@example.com' }));
  store.suppress('blocked@example.com', 'hard_bounce', 'brevo_webhook');
  assert.equal(store.isSuppressed('blocked@example.com'), true);
  assert.equal(store.getDashboard().summary.suppressed, 1);
  assert.equal(store.getDashboard().items.find((item) => item.email === 'blocked@example.com').status, 'cancelled');
});

test('a processing reservation consumes shared capacity until it is resolved', (t) => {
  const store = makeStore(t);
  const first = store.enqueue(input()).job;
  store.enqueue(input({ customerId: 'customer-2', contactId: 'contact-2',
    email: 'other@example.com' }));
  assert.equal(store.reserveDue({ limit: 1, dailyLimit: 1 }).length, 1);
  assert.equal(store.reserveDue({ limit: 1, dailyLimit: 1 }).length, 0);
  store.deferJob(first.id, 'temporary block', new Date(Date.now() + 60_000).toISOString(),
    { restoreAttempt: true });
  assert.equal(store.reserveDue({ limit: 1, dailyLimit: 1 }).length, 1);
});

test('sent jobs can be resolved from a Brevo message id for email previews', (t) => {
  const store = makeStore(t);
  const created = store.enqueue(input());
  store.markSent(created.job.id, '<preview-message@brevo>');

  const found = store.findJobByMessageId('<preview-message@brevo>');
  assert.equal(found.id, created.job.id);
  assert.equal(found.companyName, 'Example');
  assert.equal(found.htmlContent, '<p>Hello</p>');
  assert.equal(store.findJobByMessageId(''), null);
  assert.equal(store.findJobByMessageId('<missing@brevo>'), null);
});

test('inbound replies match sent jobs by reply headers before sender email fallback', (t) => {
  const store = makeStore(t);
  const older = store.enqueue(input({ email: 'buyer@example.com', customerId: 'company-1' })).job;
  store.markSent(older.id, '<sent-message>', '2026-09-01T01:00:00.000Z');
  const byHeader = store.findSentJobForInbound({
    messageIds: ['<unrelated>', '<sent-message>'], senderEmail: 'different@example.com',
  });
  assert.equal(byHeader.job.id, older.id);
  assert.equal(byHeader.method, 'reply_header');
  const bySender = store.findSentJobForInbound({ senderEmail: 'BUYER@example.com' });
  assert.equal(bySender.job.id, older.id);
  assert.equal(bySender.method, 'sender_email');
});

test('second-touch jobs are deduplicated separately and take dispatch priority', (t) => {
  const store = makeStore(t);
  store.enqueue(input({ campaign: 'initial_outreach_v1' }));
  const followup = store.enqueue(input({ campaign: 'second_touch_v1' }));

  assert.equal(followup.created, true);
  assert.equal(store.findCampaignJob({
    campaign: 'second_touch_v1', customerId: 'customer-1', recipient: 'asha@example.com',
  }).id, followup.job.id);
  assert.deepEqual(store.getCampaignSummary('second_touch_v1'), {
    total: 1, queued: 1, sent: 0, failed: 0, byStatus: { queued: 1 },
  });
  const [reserved] = store.reserveDue({ limit: 1, dailyLimit: 10 });
  assert.equal(reserved.campaign, 'second_touch_v1');
});

test('sent summary counts unique companies within a requested time window', (t) => {
  const store = makeStore(t);
  const first = store.enqueue(input({ customerId: 'company-1', companyName: 'One', email: 'one@example.com' }));
  const second = store.enqueue(input({ customerId: 'company-1', companyName: 'One', email: 'two@example.com', contactId: 'contact-2' }));
  const followup = store.enqueue(input({
    campaign: 'second_touch_v1', customerId: 'company-1', companyName: 'One', email: 'one@example.com',
  }));
  const outside = store.enqueue(input({ customerId: 'company-2', companyName: 'Two', email: 'outside@example.com' }));
  store.markSent(first.job.id, 'message-1', '2026-09-02T02:00:00.000Z');
  store.markSent(second.job.id, 'message-2', '2026-09-02T03:00:00.000Z');
  store.markSent(followup.job.id, 'message-followup', '2026-09-02T04:00:00.000Z');
  store.markSent(outside.job.id, 'message-3', '2026-09-01T03:00:00.000Z');

  assert.deepEqual(store.getSentSummary({
    from: '2026-09-02T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z',
  }), {
    emails: 3,
    companies: 1,
    firstSentAt: '2026-09-02T02:00:00.000Z',
    lastSentAt: '2026-09-02T04:00:00.000Z',
  });
  assert.deepEqual(store.getSentSummary({
    from: '2026-09-02T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z',
    campaign: 'initial_outreach_v1',
  }), {
    emails: 2,
    companies: 1,
    firstSentAt: '2026-09-02T02:00:00.000Z',
    lastSentAt: '2026-09-02T03:00:00.000Z',
  });
  assert.deepEqual(store.getSentSummary({
    from: '2026-09-02T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z',
    campaign: 'second_touch_v1',
  }), {
    emails: 1,
    companies: 1,
    firstSentAt: '2026-09-02T04:00:00.000Z',
    lastSentAt: '2026-09-02T04:00:00.000Z',
  });
  assert.equal(store.getSentSummary({
    from: '2026-09-02T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z', campaign: 'all',
  }).emails, 3);
});

test('legacy jobs without exact model images are cancelled before delivery', (t) => {
  const store = makeStore(t);
  const legacy = store.enqueue(input({ email: 'legacy@example.com' }));
  const current = store.enqueue(input({
    email: 'current@example.com',
    draft: { pricing: { products: [{ model: 'LRS-350-24', imageAvailable: true, imageSource: 'exact_model_asset' }] } },
  }));
  const manifest = store.enqueue(input({
    customerId: 'customer-2',
    email: 'manifest@example.com',
    draft: { pricing: { products: [{ model: 'HDR-60-24', imageAvailable: true, imageSource: 'exact_model_manifest' }] } },
  }));

  const cancelled = store.cancelJobsMissingExactProductImages('missing exact model image');

  assert.equal(cancelled, 1);
  assert.equal(store.getJob(legacy.job.id).status, 'cancelled');
  assert.equal(store.getJob(legacy.job.id).failureReason, 'missing exact model image');
  assert.equal(store.getJob(current.job.id).status, 'queued');
  assert.equal(store.getJob(manifest.job.id).status, 'queued');
});

test('cancelled jobs with newly accepted image sources are restored', (t) => {
  const store = makeStore(t);
  const job = store.enqueue(input({
    draft: { pricing: { products: [{ model: 'HDR-60-24', imageAvailable: true, imageSource: 'exact_model_manifest' }] } },
  }));
  store.markCancelled(job.job.id, '邮件任务缺少具体型号产品图，已取消。');

  assert.equal(store.recoverImageReadyCancelledJobs(), 1);
  assert.equal(store.getJob(job.job.id).status, 'queued');
  assert.equal(store.getJob(job.job.id).failureReason, '');
});

test('recent enrichment attempts apply customer cooldown even when no job was queued', (t) => {
  const store = makeStore(t);
  assert.equal(store.hasRecentCustomerActivity('customer-1', 7), false);
  store.recordEnrichment({
    customerId: 'customer-1',
    companyName: 'Example',
    status: 'contact_not_found',
  });
  assert.equal(store.hasRecentCustomerActivity('customer-1', 7), true);
  assert.equal(store.hasRecentCustomerActivity('customer-2', 7), false);
});

test('marketing queue persists the Feishu review record id', (t) => {
  const store = makeStore(t);
  const result = store.enqueue(input({ feishuRecordId: 'rec-1' }));
  assert.equal(result.job.feishuRecordId, 'rec-1');
  assert.equal(store.getDashboard().items[0].feishuRecordId, 'rec-1');
});

test('provider-wide deferral restores the reserved attempt', (t) => {
  const store = makeStore(t);
  const created = store.enqueue(input());
  const [reserved] = store.reserveDue({ limit: 1, dailyLimit: 10 });
  assert.equal(reserved.attempts, 1);
  store.deferJob(created.job.id, 'Brevo account blocked', new Date().toISOString(), { restoreAttempt: true });
  const restored = store.getJob(created.job.id);
  assert.equal(restored.status, 'queued');
  assert.equal(restored.attempts, 0);
});

test('queue reservation skips due jobs outside their recipient send window', (t) => {
  const store = makeStore(t);
  const scheduledAt = '2026-09-01T12:00:00.000Z';
  store.enqueue(input({ email: 'inside@example.com', timeZone: 'America/New_York', scheduledAt }));
  store.enqueue(input({ customerId: 'customer-2', email: 'outside@example.com', timeZone: 'Asia/Kolkata', scheduledAt }));
  const jobs = store.reserveDue({
    limit: 10,
    dailyLimit: 10,
    now: new Date('2026-09-01T13:00:00.000Z'),
    isEligible: (job) => job.timeZone === 'America/New_York',
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].email, 'inside@example.com');
  assert.equal(store.findLatestJob({ customerId: 'customer-2', recipient: 'outside@example.com' }).status, 'queued');
  assert.equal(store.findLatestJob({ customerId: 'customer-2', recipient: 'outside@example.com' }).attempts, 0);
});

test('Brevo authentication failures are recovered after account access returns', (t) => {
  const store = makeStore(t);
  const first = store.enqueue(input({ email: 'first@example.com' }));
  const second = store.enqueue(input({ customerId: 'customer-2', email: 'second@example.com' }));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const due = store.reserveDue({ limit: 10, dailyLimit: 10, now: new Date(Date.now() + attempt * 60_000) });
    assert.equal(due.length, 2);
    for (const job of due) {
      store.markFailed(job.id, new Error('Brevo 请求失败（HTTP 401）'), { retryDelayMinutes: 0 });
    }
  }
  assert.equal(store.getJob(first.job.id).status, 'failed');
  assert.equal(store.getJob(second.job.id).status, 'failed');
  assert.equal(store.recoverBrevoAuthFailures(), 2);
  assert.equal(store.getJob(first.job.id).status, 'queued');
  assert.equal(store.getJob(first.job.id).attempts, 0);
  assert.equal(store.recoverBrevoAuthFailures(), 0);
});

test('company Feishu relink updates every job and enrichment audit reference', (t) => {
  const store = makeStore(t);
  store.enqueue(input({ customerId: 'customer-1', email: 'one@example.com', feishuRecordId: 'draft-1' }));
  store.enqueue(input({ customerId: 'customer-1', contactId: 'contact-2', email: 'two@example.com', feishuRecordId: 'draft-2' }));
  store.recordEnrichment({ customerId: 'customer-1', companyName: 'Example', status: 'enriched' });
  const result = store.relinkCompanyFeishuRecord('customer-1', 'company-1');
  assert.deepEqual(result, { jobs: 2, enrichments: 1 });
  assert.ok(store.getDashboard().items.every((item) => item.feishuRecordId === 'company-1'));
  assert.equal(store.listEnrichmentRunsSince('2000-01-01T00:00:00.000Z')[0].feishuRecordId, 'company-1');
});

test('daily marketing stats count researched and marketed companies separately', (t) => {
  const store = makeStore(t);
  store.recordEnrichment({ customerId: 'researched-only', companyName: 'Research Only', status: 'company_mismatch' });
  store.recordEnrichment({ customerId: 'failed-only', companyName: 'Failed Only', status: 'failed' });
  store.enqueue(input({ customerId: 'marketed-1', email: 'one@example.com', status: 'queued' }));
  store.enqueue(input({ customerId: 'marketed-2', email: 'two@example.com', status: 'needs_attention' }));
  const sent = store.enqueue(input({ customerId: 'marketed-sent', email: 'sent@example.com' }));
  store.markSent(sent.job.id, 'message-sent');
  const stats = store.getDailyMarketingStats();
  assert.equal(stats.companiesPreparedToday, 5);
  assert.equal(stats.companiesResearchedTotal, 1);
  assert.equal(stats.companiesMarketedTotal, 1);
  assert.equal(stats.companiesMarketedToday, 2);
});

test('screening dashboard keeps each run and aggregates today', (t) => {
  const store = makeStore(t);
  const first = store.recordScreeningBatch({
    source: 'automatic',
    researched: 10,
    scanned: 20,
    qualified: 4,
    excluded: 2,
    pending: 4,
    enriched: 7,
    companyMismatch: 2,
    contactNotFound: 1,
    queuedCompanies: 4,
    queuedEmails: 12,
    contactsFound: 15,
    contactsCreated: 3,
  });
  const second = store.recordScreeningBatch({
    source: 'automatic',
    researched: 5,
    scanned: 9,
    qualified: 2,
    excluded: 1,
    pending: 2,
    enriched: 3,
    companyMismatch: 1,
    contactNotFound: 1,
    queuedCompanies: 2,
    queuedEmails: 6,
    contactsFound: 8,
    contactsCreated: 1,
  });

  const dashboard = store.getScreeningDashboard();
  assert.equal(dashboard.batches.length, 2);
  assert.equal(dashboard.batches[0].id, second.id);
  assert.equal(dashboard.batches[1].id, first.id);
  assert.deepEqual(dashboard.today, {
    id: 'today', source: 'today', researched: 15, scanned: 29, qualified: 6,
    excluded: 3, pending: 6, enriched: 10, companyMismatch: 3,
    contactNotFound: 2, failed: 0, queuedCompanies: 6, queuedEmails: 18,
    contactsFound: 23, contactsCreated: 4,
  });
});

test('company email guard allows at most five first-touch recipients', (t) => {
  const store = makeStore(t);
  for (let index = 0; index < 5; index += 1) {
    store.enqueue(input({
      contactId: `contact-${index}`,
      email: `buyer${index}@example.com`,
    }));
  }
  assert.equal(store.canContact({ customerId: 'customer-1', recipient: 'buyer5@example.com', companyEmailLimit: 5 }), false);
  assert.equal(store.canContact({ customerId: 'customer-2', recipient: 'buyer5@example.com', companyEmailLimit: 5 }), true);
});

test('dashboard separates explicit exclusions from target customers needing enrichment', (t) => {
  const store = makeStore(t);
  store.recordExclusion({
    customerId: 'customer-1', companyName: 'Not Precise Ltd', country: 'India',
    reasonCode: 'not_precise', reason: '官网确认其主营财务 SaaS，与电源业务无关',
  });
  store.recordExclusion({
    customerId: 'customer-2', companyName: 'Lighting Target Ltd', country: 'Argentina',
    reasonCode: 'contact_quality_failed', reason: '未排除：联系人邮箱尚未验证，继续补全',
  });
  const dashboard = store.getDashboard();
  assert.equal(dashboard.summary.excludedToday, 1);
  assert.equal(dashboard.summary.pendingToday, 1);
  assert.equal(dashboard.exclusions[0].companyName, 'Not Precise Ltd');
  assert.equal(dashboard.exclusions[0].reasonCode, 'not_precise');
  assert.equal(dashboard.pending[0].companyName, 'Lighting Target Ltd');
  const stats = store.getDailyMarketingStats();
  assert.equal(stats.excludedCompaniesToday, 1);
  assert.equal(stats.pendingCompaniesToday, 1);
  store.recordExclusion({
    customerId: 'customer-1', companyName: 'Not Precise Ltd', country: 'India',
    reasonCode: 'not_precise', reason: '官网确认为财务 SaaS，与电源无直接匹配',
  });
  assert.equal(store.getDashboard().exclusions[0].reason, '官网确认为财务 SaaS，与电源无直接匹配');
  store.resolveCompanyExclusions('customer-1', 'Official website confirms a direct fit');
  const resolved = store.getDashboard();
  assert.equal(resolved.summary.excludedToday, 0);
  assert.equal(resolved.exclusions.length, 0);
  assert.equal(resolved.summary.pendingToday, 1);
});

test('customer job summary distinguishes active queued work', (t) => {
  const store = makeStore(t);
  store.enqueue(input({ customerId: 'customer-summary', email: 'one@example.com' }));
  const summary = store.getCustomerJobSummary('customer-summary');
  assert.deepEqual(summary, { total: 1, active: 1, sent: 0 });
});

test('enrichment runs retain Feishu audit synchronization state', (t) => {
  const store = makeStore(t);
  const run = store.recordEnrichment({
    customerId: 'customer-audit', companyName: 'Audit Power', status: 'enriched', confidence: 98,
  });
  store.attachEnrichmentFeishuRecord(run.id, { recordId: 'rec-audit', status: 'synced' });
  const [saved] = store.listEnrichmentRunsSince('2000-01-01T00:00:00.000Z');
  assert.equal(saved.feishuRecordId, 'rec-audit');
  assert.equal(saved.feishuSyncStatus, 'synced');
});

test('incomplete Feishu audit query only returns reusable unsynced records', (t) => {
  const store = makeStore(t);
  const incomplete = store.recordEnrichment({
    customerId: 'customer-incomplete', companyName: 'Incomplete Power', status: 'enriched',
  });
  const synced = store.recordEnrichment({
    customerId: 'customer-synced', companyName: 'Synced Power', status: 'enriched',
  });
  store.recordEnrichment({
    customerId: 'customer-legacy', companyName: 'Legacy Power', status: 'enriched',
  });
  store.attachEnrichmentFeishuRecord(incomplete.id, { recordId: 'rec-incomplete', status: 'created' });
  store.attachEnrichmentFeishuRecord(synced.id, { recordId: 'rec-synced', status: 'synced' });

  const runs = store.listIncompleteEnrichmentAudits();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].customerId, 'customer-incomplete');
  assert.equal(runs[0].feishuRecordId, 'rec-incomplete');
});
