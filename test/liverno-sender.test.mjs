import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DeliveryStore } from '../src/lib/delivery-store.mjs';
import { MarketingStore } from '../src/lib/marketing-store.mjs';
import { LivernoSenderService } from '../src/services/liverno-sender-service.mjs';

const SOURCE_ID = '190415ea-33ea-4001-bd69-9004e044e83a';
const NOW = new Date('2026-10-08T10:00:00.000Z');

function fixture(t, { dedup = { status: 'clear' }, sendError = null, dailySendLimit = 10 } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liverno-sender-'));
  const marketing = new MarketingStore({ databasePath: path.join(directory, 'marketing.sqlite') });
  const delivery = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => {
    delivery.close(); marketing.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const record = {
    id: 'research-1', source: 'liverno', source_id: SOURCE_ID, domain: 'example.com',
    status: 'completed', qualification: { status: 'qualified', qualified: true },
    company: { domain: 'example.com', apollo_name: 'Example Automation' },
    contacts: [{ person_id: 'person-1', has_email: true, email_status: 'verified' }],
  };
  const customer = marketing.ensureLivernoCustomer(record);
  marketing.claimLivernoHandoff(customer.id);
  marketing.saveLivernoContact({ customerId: customer.id, personId: 'person-1',
    name: 'Buyer', title: 'Purchasing Manager', recipient: 'buyer@example.com',
    emailStatus: 'verified' });
  const draft = {
    qualified: true, compliance: { approved: true, issues: [] }, reviewRequired: false,
    emailSubject: 'Industrial power supply options',
    emailBody: Array.from({ length: 100 }, (_, index) => `word${index}`).join(' '),
    pricing: { products: Array.from({ length: 6 }, (_, index) => ({
      model: `AD-${index + 1}A`, currency: 'USD', imageAvailable: true,
      imageSource: 'exact_model_asset',
    })) },
  };
  const job = marketing.enqueue({
    source: 'liverno', sourceId: SOURCE_ID, researchId: record.id, domain: record.domain,
    customerId: customer.id, contactId: 'person-1', companyName: 'Example Automation',
    contactName: 'Buyer', email: 'buyer@example.com', country: 'United Kingdom',
    timeZone: 'UTC', subject: draft.emailSubject, htmlContent: '<p>Hello</p>',
    textContent: 'Hello', scheduledAt: '2026-10-08T09:00:00.000Z', score: 95,
    apollo: { personId: 'person-1', emailVerified: true }, draft,
  }).job;
  marketing.finishLivernoHandoff(customer.id, job.id);
  const calls = { access: 0, dedup: 0, send: 0 };
  const sender = new LivernoSenderService({
    marketing, delivery,
    research: { getBySource: (source, id) =>
      source === 'liverno' && id === SOURCE_ID ? record : null },
    handoff: { async checkCrossSource(id) {
      calls.dedup += 1;
      assert.equal(id, SOURCE_ID);
      if (dedup instanceof Error) throw dedup;
      return dedup;
    } },
    brevo: {
      async checkAccess() { calls.access += 1; },
      async send(input) {
        calls.send += 1;
        assert.equal(input.jobId, job.id);
        assert.equal(input.to, job.email);
        assert.equal(input.campaign, job.campaign);
        if (sendError) throw sendError;
        return { messageId: '<liverno-mock-message>' };
      },
    },
    config: { marketing: { enabled: true, autoApproveScore: 80, dailySendLimit,
      sendWindowStartHour: 9, sendWindowEndHour: 17 }, brevo: { sendingEnabled: true } },
  });
  return { sender, marketing, delivery, record, job, calls };
}

test('clear dedup sends once through mocked Brevo and records a delivery event', async (t) => {
  const { sender, marketing, delivery, job, calls } = fixture(t);
  const first = await sender.sendDue({ now: NOW });
  const second = await sender.sendDue({ now: NOW });
  assert.equal(first.reserved, 1);
  assert.equal(first.sent, 1);
  assert.equal(second.reserved, 0);
  assert.equal(calls.send, 1);
  assert.equal(calls.dedup, 1);
  assert.equal(marketing.getJob(job.id).status, 'sent');
  assert.equal(marketing.getJob(job.id).messageId, '<liverno-mock-message>');
  const message = delivery.getDashboard({ from: '2026-10-08T00:00:00.000Z' })
    .items.find((item) => item.messageId === '<liverno-mock-message>');
  assert.equal(message.status, 'sent');
  assert.equal(message.campaign, 'initial_outreach_v1');
  assert.equal(marketing.db.prepare(`
    SELECT COUNT(*) AS count FROM marketing_events WHERE job_id = ? AND event = 'delivery_status_recorded'
  `).get(job.id).count, 1);
});

for (const [label, dedup, status, reason] of [
  ['duplicate', { status: 'duplicate' }, 'cancelled', 'cross_source_duplicate'],
  ['unknown', { status: 'unknown' }, 'queued', 'cross_source_unverified'],
  ['exception', new Error('Fumeng unavailable'), 'queued', 'cross_source_check_failed'],
]) {
  test(`${label} cross-source result blocks sending`, async (t) => {
    const { sender, marketing, job, calls } = fixture(t, { dedup });
    const result = await sender.sendDue({ now: NOW });
    assert.equal(result.sent, 0);
    assert.equal(calls.send, 0);
    assert.equal(result.results[0].reason, reason);
    assert.equal(marketing.getJob(job.id).status, status);
    if (status === 'queued') {
      assert.equal(marketing.getJob(job.id).attempts, 0);
      assert.equal((await sender.sendDue({ now: NOW })).reserved, 0);
    }
  });
}

test('suppression and changed qualification cancel before dedup or Brevo', async (t) => {
  const { sender, marketing, record, job, calls } = fixture(t);
  record.qualification.qualified = false;
  const result = await sender.sendDue({ now: NOW });
  assert.equal(result.results[0].reason, 'liverno_evidence_changed');
  assert.equal(marketing.getJob(job.id).status, 'cancelled');
  assert.equal(calls.dedup, 0);
  assert.equal(calls.send, 0);
});

test('suppression applied during dedup prevents the send', async (t) => {
  const { sender, marketing, job, calls } = fixture(t);
  sender.handoff.checkCrossSource = async () => {
    marketing.suppress(job.email, 'hard_bounce');
    return { status: 'clear' };
  };
  const result = await sender.sendDue({ now: NOW });
  assert.equal(result.sent, 0);
  assert.equal(calls.send, 0);
  assert.equal(marketing.getJob(job.id).status, 'cancelled');
});

test('ambiguous Brevo failure needs manual attention and never auto-retries', async (t) => {
  const { sender, marketing, job, calls } = fixture(t, {
    sendError: new Error('connection lost after submit'),
  });
  const first = await sender.sendDue({ now: NOW });
  const second = await sender.sendDue({ now: NOW });
  assert.equal(first.failed, 1);
  assert.equal(first.results[0].status, 'needs_attention');
  assert.equal(second.reserved, 0);
  assert.equal(marketing.getJob(job.id).status, 'needs_attention');
  assert.equal(calls.send, 1);
});

test('shared daily quota and local send window gate Liverno reservations', async (t) => {
  const { sender, marketing, job, calls } = fixture(t, { dailySendLimit: 1 });
  assert.equal((await sender.sendDue({ now: new Date('2026-10-08T07:00:00.000Z') })).reserved, 0);
  const prior = marketing.enqueue({ customerId: 'fumeng-1', contactId: 'c-1',
    companyName: 'Other', email: 'other@example.com', subject: 'Other',
    htmlContent: '<p>Other</p>', scheduledAt: NOW.toISOString() }).job;
  marketing.markSent(prior.id, '<prior>', NOW.toISOString());
  assert.equal((await sender.sendDue({ now: NOW })).reserved, 0);
  assert.equal(marketing.getJob(job.id).status, 'queued');
  assert.equal(calls.send, 0);
});
