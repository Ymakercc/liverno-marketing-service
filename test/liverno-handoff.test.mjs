import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MarketingStore } from '../src/lib/marketing-store.mjs';
import { LivernoHandoffService } from '../src/services/liverno-handoff-service.mjs';
import { MarketingService } from '../src/services/marketing-service.mjs';

const SOURCE_ID = '190415ea-33ea-4001-bd69-9004e044e83a';
const OTHER_ID = '290415ea-33ea-4001-bd69-9004e044e83a';

function research(overrides = {}) {
  return {
    id: 'research-1', source: 'liverno', source_id: SOURCE_ID,
    domain: 'example.com', status: 'completed',
    company: {
      apollo_organization_id: 'org-1', apollo_name: 'Verified Automation',
      domain: 'example.com', match_score: 90, country: 'Germany',
      industry: 'Industrial Automation', employee_count: 100,
    },
    contacts: [{ person_id: 'person-1', title: 'Purchasing Manager',
      has_email: true, email_status: 'verified' }],
    website_research: {
      status: 'fetched', final_url: 'https://example.com/',
      title: 'Verified Automation', description: 'Industrial control systems',
      keywords: 'automation', text: 'Industrial control systems and electronics.',
      signals: { meanWellMentioned: false, matchedTerms: ['automation'], directFit: false },
    },
    qualification: { status: 'qualified', qualified: true, reason: 'Industrial controls fit' },
    ...overrides,
  };
}

function fixture(t, record = research()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liverno-handoff-'));
  const marketing = new MarketingStore({ databasePath: path.join(directory, 'marketing.sqlite') });
  t.after(() => { marketing.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const entries = Array.from({ length: 6 }, (_, index) => ({
    model: `AD-${index + 1}A`, marketingPrice: 10 + index,
    currency: 'USD', quoteDate: '2026-10-01',
  }));
  const calls = { apollo: 0, draft: 0 };
  const config = {
    marketing: { enabled: true, autoApproveScore: 80, dailySendLimit: 10,
      sendWindowStartHour: 9, sendWindowEndHour: 17 },
    pricing: { maxEmailModels: 6 },
    emailAssets: { availableImages: Object.fromEntries(entries.map((entry) =>
      [entry.model, `https://assets.example/${entry.model}.png`])) },
    sales: { companyName: 'KULON', teamName: 'KULON Sales',
      email: 'sales@kulon.example', website: 'https://kulon.example' },
    brevo: { sendingEnabled: true },
  };
  const service = new LivernoHandoffService({
    research: { getBySource: (source, id) => source === 'liverno' && id === record.source_id ? record : null },
    marketing,
    apollo: { async matchPerson({ id }) {
      calls.apollo += 1;
      assert.equal(id, 'person-1');
      return { id, organizationId: 'org-1', email: 'buyer@example.com',
        emailStatus: 'verified', name: 'Buyer', title: 'Purchasing Manager' };
    } },
    drafts: { async generateFromData(input) {
      calls.draft += 1;
      assert.equal(input.researchWebsite, true);
      assert.equal(input.reuseQualification, true);
      assert.equal(input.websiteEvidence.status, 'fetched');
      assert.equal(input.qualificationDecision.qualified, true);
      return { draft: {
        qualified: true, reviewRequired: false,
        compliance: { approved: true, issues: [] },
        emailSubject: 'Industrial power supply options',
        emailBody: Array.from({ length: 100 }, (_, index) => `word${index}`).join(' '),
        recommendedProducts: [{ name: 'AD series', reason: 'Industrial controls' }],
      } };
    } },
    config, priceCatalog: { entries, generatedDate: '2026-10-01' },
  });
  return { service, marketing, calls, config };
}

test('qualified Research creates one local Liverno customer, contact, draft and unsent job', async (t) => {
  const { service, marketing, calls } = fixture(t);
  const result = await service.intake(SOURCE_ID);
  assert.equal(result.status, 'queued');
  assert.equal(result.fumengCustomerId, '');
  assert.notEqual(result.marketingCustomerId, SOURCE_ID);
  assert.equal(result.researchId, 'research-1');
  assert.equal(result.qualificationStatus, 'qualified');
  assert.equal(calls.apollo, 1);
  assert.equal(calls.draft, 1);
  const job = marketing.getJob(result.jobId);
  assert.equal(job.source, 'liverno');
  assert.equal(job.sourceId, SOURCE_ID);
  assert.equal(job.researchId, 'research-1');
  assert.equal(job.domain, 'example.com');
  assert.equal(job.customerId, result.marketingCustomerId);
  assert.equal(job.fumengCustomerId, '');
  assert.equal(job.status, 'queued');
  assert.equal(job.draft.pricing.products.length, 6);
  assert.ok(job.draft.pricing.products.every((product) => product.imageAvailable));
  assert.match(job.htmlContent, /Selected MEAN WELL models/);
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_contacts').get().count, 1);
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_customers').get().count, 1);
  assert.equal(result.jobId.includes('@'), false);
});

test('repeated Handoff returns the same customer and job without Apollo or draft repeats', async (t) => {
  const { service, marketing, calls } = fixture(t);
  const first = await service.intake(SOURCE_ID);
  const second = await service.intake(SOURCE_ID);
  assert.deepEqual(second, first);
  assert.equal(calls.apollo, 1);
  assert.equal(calls.draft, 1);
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_jobs').get().count, 1);
});

test('retry recovers an already enqueued job after an interrupted status update', async (t) => {
  const { service, marketing, calls } = fixture(t);
  const customer = marketing.ensureLivernoCustomer(research());
  marketing.claimLivernoHandoff(customer.id);
  const job = marketing.enqueue({ source: 'liverno', sourceId: SOURCE_ID,
    researchId: 'research-1', domain: 'example.com', customerId: customer.id,
    email: 'buyer@example.com', subject: 'Existing draft', htmlContent: '<p>Existing draft</p>' }).job;
  const result = await service.intake(SOURCE_ID);
  assert.equal(result.status, 'queued');
  assert.equal(result.jobId, job.id);
  assert.deepEqual(calls, { apollo: 0, draft: 0 });
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_jobs').get().count, 1);
});

for (const status of ['not_started', 'not_qualified', 'review_required', 'failed']) {
  test(`${status} Qualification cannot create a marketing customer`, async (t) => {
    const { service, marketing, calls } = fixture(t, research({
      qualification: { status, qualified: status === 'not_qualified' ? false : null },
    }));
    await assert.rejects(service.intake(SOURCE_ID), { code: 'QUALIFICATION_REQUIRED' });
    assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_customers').get().count, 0);
    assert.deepEqual(calls, { apollo: 0, draft: 0 });
  });
}

test('mismatched Liverno and Apollo domains block before marketing persistence', async (t) => {
  const record = research();
  record.company.domain = 'different.com';
  const { service, marketing } = fixture(t, record);
  await assert.rejects(service.intake(SOURCE_ID), { code: 'IDENTITY_DOMAIN_MISMATCH' });
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_customers').get().count, 0);
});

test('existing Fumeng job on the same domain blocks Liverno before person match', async (t) => {
  const { service, marketing, calls } = fixture(t);
  marketing.enqueue({ customerId: 'fumeng-123', email: 'other@example.com',
    domain: 'example.com', subject: 'Existing', htmlContent: '<p>Existing</p>' });
  const result = await service.intake(SOURCE_ID);
  assert.equal(result.status, 'blocked_duplicate');
  assert.equal(result.failureReason, 'domain_already_in_marketing');
  assert.deepEqual(calls, { apollo: 0, draft: 0 });
  assert.equal(marketing.db.prepare("SELECT COUNT(*) AS count FROM marketing_jobs WHERE source = 'liverno'").get().count, 0);
});

test('legacy Fumeng job without domain still blocks Liverno by recipient email', async (t) => {
  const { service, marketing, calls } = fixture(t);
  marketing.enqueue({ customerId: 'fumeng-123', email: 'buyer@example.com',
    subject: 'Existing', htmlContent: '<p>Existing</p>' });
  const result = await service.intake(SOURCE_ID);
  assert.equal(result.status, 'blocked_duplicate');
  assert.equal(calls.apollo, 1);
  assert.equal(calls.draft, 0);
});

test('missing verified Apollo person does not fabricate an email or queue work', async (t) => {
  const record = research({ contacts: [{ person_id: 'person-1', title: 'Buyer',
    has_email: false, email_status: 'unverified' }] });
  const { service, marketing, calls } = fixture(t, record);
  const result = await service.intake(SOURCE_ID);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'contact_email_unavailable');
  assert.deepEqual(calls, { apollo: 0, draft: 0 });
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_jobs').get().count, 0);
});

test('suppressed Apollo recipient is blocked before drafting', async (t) => {
  const { service, marketing, calls } = fixture(t);
  marketing.suppress('buyer@example.com', 'unsubscribed');
  const result = await service.intake(SOURCE_ID);
  assert.equal(result.status, 'blocked_duplicate');
  assert.equal(calls.draft, 0);
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_jobs').get().count, 0);
});

test('missing exact product images leaves the customer failed and the queue empty', async (t) => {
  const { service, marketing, config } = fixture(t);
  config.emailAssets.availableImages = {};
  const result = await service.intake(SOURCE_ID);
  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'price_or_product_images_insufficient');
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_jobs').get().count, 0);
});

test('concurrent Liverno Enterprises on the same domain create only one job', async (t) => {
  const { service, marketing, calls } = fixture(t);
  const other = research({ id: 'research-2', source_id: OTHER_ID });
  service.research.getBySource = (_source, id) => id === OTHER_ID ? other : research();
  const [first, second] = await Promise.all([service.intake(SOURCE_ID), service.intake(OTHER_ID)]);
  assert.deepEqual([first.status, second.status].sort(), ['blocked_duplicate', 'queued']);
  assert.equal(marketing.db.prepare('SELECT COUNT(*) AS count FROM marketing_jobs').get().count, 1);
  assert.equal(calls.apollo, 1);
});

test('Liverno jobs stay queued when sendDue runs and never access Fumeng or Brevo send', async (t) => {
  const { service, marketing, config } = fixture(t);
  const result = await service.intake(SOURCE_ID);
  const sender = new MarketingService({
    marketing, config,
    fumeng: { getCustomer() { throw new Error('Fumeng must not be called'); } },
    brevo: { async checkAccess() {}, async send() { throw new Error('Brevo must not send'); } },
  });
  sender.queueSecondTouch = () => ({ created: 0 });
  const outcome = await sender.sendDue({ now: new Date(Date.now() + 7 * 86_400_000) });
  assert.equal(outcome.reserved, 0);
  assert.equal(outcome.sent, 0);
  assert.equal(marketing.getJob(result.jobId).status, 'queued');
  assert.equal(marketing.canContact({ customerId: 'fumeng-456',
    recipient: 'other@example.com', domain: 'example.com' }), false);
});

test('legacy second-touch selection never treats a Liverno job as Fumeng work', async (t) => {
  const { service, marketing, config } = fixture(t);
  const result = await service.intake(SOURCE_ID);
  marketing.markSent(result.jobId, '<liverno-message>', new Date(Date.now() - 10 * 86_400_000).toISOString());
  const sender = new MarketingService({
    marketing, config,
    delivery: { listOpenedRecipients: () => [{
      messageId: '<liverno-message>', openCount: 2,
      lastOpenAt: new Date().toISOString(),
    }] },
  });
  assert.deepEqual(sender.getSecondTouchCandidates({
    now: new Date(Date.now() + 10 * 86_400_000),
  }), []);
});
