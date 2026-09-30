import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DeliveryStore, normalizeBrevoEvent } from '../src/lib/delivery-store.mjs';

test('Brevo events normalize provider naming and tracking metadata', () => {
  const event = normalizeBrevoEvent({
    event: 'uniqueOpened',
    email: ' Buyer@Example.com ',
    'message-id': '<message@example>',
    subject: 'Product options',
    ts_event: 1_765_780_800,
    tags: ['record_rec123', 'customer_cus456'],
  });

  assert.equal(event.eventType, 'opened');
  assert.equal(event.email, 'buyer@example.com');
  assert.equal(event.messageId, '<message@example>');
  assert.equal(event.recordId, 'rec123');
  assert.equal(event.customerId, 'cus456');
});

test('delivery store deduplicates events and derives message outcomes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-'));
  const store = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const now = Date.now();
  const event = (messageId, email, type, offset, extra = {}) => ({
    event: type,
    email,
    'message-id': messageId,
    subject: 'MEAN WELL introduction',
    ts_epoch: now + offset,
    ...extra,
  });

  const first = store.ingest([
    event('message-1', 'buyer@example.com', 'sent', 0),
    event('message-1', 'buyer@example.com', 'delivered', 1_000),
    event('message-1', 'buyer@example.com', 'opened', 2_000),
    event('message-2', 'invalid@example.com', 'sent', 0),
    event('message-2', 'invalid@example.com', 'hardBounce', 3_000, { reason: 'Mailbox does not exist' }),
  ]);
  const duplicate = store.ingest(event('message-1', 'buyer@example.com', 'opened', 2_000));
  const dashboard = store.getDashboard();

  assert.equal(first.accepted, 5);
  assert.equal(duplicate.duplicates, 1);
  assert.equal(dashboard.summary.total, 2);
  assert.equal(dashboard.summary.sentToday, 2);
  assert.equal(dashboard.summary.delivered, 1);
  assert.equal(dashboard.summary.opened, 1);
  assert.equal(dashboard.summary.failed, 1);
  assert.equal(dashboard.summary.stopped, 1);
  assert.equal(dashboard.items.find((item) => item.messageId === 'message-1').status, 'opened');
  assert.equal(dashboard.items.find((item) => item.messageId === 'message-2').status, 'hard_bounce');
  assert.equal(dashboard.items.find((item) => item.messageId === 'message-2').failureReason, 'Mailbox does not exist');
});

test('delivery dashboard filters messages by their first send event', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-period-'));
  const store = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  store.ingest([
    { event: 'sent', email: 'today@example.com', 'message-id': 'today', timestamp: '2026-09-02T02:00:00.000Z' },
    { event: 'sent', email: 'yesterday@example.com', 'message-id': 'yesterday', timestamp: '2026-09-01T02:00:00.000Z' },
  ]);
  const dashboard = store.getDashboard({
    from: '2026-09-02T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z',
  });
  assert.equal(dashboard.items.length, 1);
  assert.equal(dashboard.items[0].messageId, 'today');
  assert.equal(dashboard.summary.total, 1);
  assert.equal(dashboard.summary.eventTotal, 1);
});

test('delivery store migrates legacy message tables with an empty campaign', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-legacy-'));
  const databasePath = path.join(directory, 'delivery.sqlite');
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE delivery_messages (
      message_key TEXT PRIMARY KEY, message_id TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, stopped INTEGER NOT NULL DEFAULT 0,
      record_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL DEFAULT '', first_event_at TEXT NOT NULL,
      last_event_at TEXT NOT NULL, failure_reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
    );
    INSERT INTO delivery_messages (
      message_key, message_id, email, status, first_event_at, last_event_at, updated_at
    ) VALUES ('legacy', 'legacy', 'legacy@example.com', 'sent',
      '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z', '2026-09-01T08:00:00.000Z');
  `);
  legacy.close();

  const store = new DeliveryStore({ databasePath });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  const campaignColumn = store.db.prepare('PRAGMA table_info(delivery_messages)').all()
    .find((column) => column.name === 'campaign');
  assert.equal(campaignColumn.notnull, 1);
  assert.equal(store.getDashboard().items[0].campaign, '');
});

test('delivery store records sent marketing jobs idempotently before provider events arrive', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-sent-'));
  const store = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  const sent = {
    messageId: '<message-sent>', email: 'buyer@example.com', subject: 'Power supplies',
    occurredAt: '2026-09-01T08:00:00.000Z', recordId: 'rec-1', customerId: 'customer-1',
    campaign: 'initial_outreach_v1',
  };
  assert.equal(store.recordSent({ ...sent, campaign: '' }).accepted, 1);
  assert.equal(store.getDashboard().items[0].campaign, '');
  assert.equal(store.recordSentJobs([sent]).duplicates, 1);

  const dashboard = store.getDashboard();
  assert.equal(dashboard.summary.total, 1);
  assert.equal(dashboard.items[0].status, 'sent');
  assert.equal(dashboard.items[0].recordId, 'rec-1');
  assert.equal(dashboard.items[0].campaign, 'initial_outreach_v1');

  store.ingest({
    event: 'opened', email: sent.email, 'message-id': sent.messageId,
    timestamp: '2026-09-01T09:00:00.000Z',
    'X-Mailin-custom': { campaign: 'second_touch_v1' },
  });
  assert.equal(store.getDashboard().items[0].campaign, 'initial_outreach_v1');
  assert.equal(store.recordSentJobs([sent]).duplicates, 1);
  assert.equal(store.getDashboard().summary.eventTotal, 2);
});

test('delivery dashboard filters lists and summaries by campaign, status, and period', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-campaign-'));
  const store = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  const record = (messageId, campaign, occurredAt) => store.recordSent({
    messageId, campaign, occurredAt, email: `${messageId}@example.com`, subject: 'Power supplies',
  });
  record('initial-opened', 'initial_outreach_v1', '2026-09-02T02:00:00.000Z');
  store.ingest({
    event: 'opened', email: 'initial-opened@example.com', 'message-id': 'initial-opened',
    timestamp: '2026-09-02T03:00:00.000Z',
  });
  record('initial-outside', 'initial_outreach_v1', '2026-09-01T02:00:00.000Z');
  record('second-failed', 'second_touch_v1', '2026-09-02T04:00:00.000Z');
  store.ingest({
    event: 'hardBounce', email: 'second-failed@example.com', 'message-id': 'second-failed',
    timestamp: '2026-09-02T05:00:00.000Z', reason: 'Mailbox unavailable',
  });

  const period = { from: '2026-09-02T00:00:00.000Z', to: '2026-09-03T00:00:00.000Z' };
  const initial = store.getDashboard({ ...period, campaign: 'initial_outreach_v1', status: 'opened', limit: 1 });
  assert.equal(initial.items.length, 1);
  assert.equal(initial.items[0].messageId, 'initial-opened');
  assert.equal(initial.items[0].campaign, 'initial_outreach_v1');
  assert.deepEqual(initial.summary.byStatus, { opened: 1 });
  assert.equal(initial.summary.total, 1);
  assert.equal(initial.summary.eventTotal, 2);
  assert.equal(initial.summary.opened, 1);
  assert.equal(initial.summary.failed, 0);

  const second = store.getDashboard({ ...period, campaign: 'second_touch_v1' });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].messageId, 'second-failed');
  assert.equal(second.summary.total, 1);
  assert.equal(second.summary.eventTotal, 2);
  assert.equal(second.summary.failed, 1);

  assert.equal(store.getDashboard({ ...period, campaign: 'all' }).summary.total, 2);
  assert.equal(store.getDashboard({ ...period, campaign: '' }).summary.total, 2);
});

test('opened recipient candidates count engagement and exclude stopped email addresses', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-opened-'));
  const store = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  store.ingest([
    { event: 'sent', email: 'buyer@example.com', 'message-id': 'healthy', timestamp: '2026-08-25T08:00:00.000Z' },
    { event: 'delivered', email: 'buyer@example.com', 'message-id': 'healthy', timestamp: '2026-08-25T08:01:00.000Z' },
    { event: 'opened', email: 'buyer@example.com', 'message-id': 'healthy', timestamp: '2026-08-25T09:00:00.000Z' },
    { event: 'opened', email: 'buyer@example.com', 'message-id': 'healthy', timestamp: '2026-08-26T09:00:00.000Z' },
    { event: 'sent', email: 'blocked@example.com', 'message-id': 'blocked-first', timestamp: '2026-08-25T08:00:00.000Z' },
    { event: 'opened', email: 'blocked@example.com', 'message-id': 'blocked-first', timestamp: '2026-08-25T09:00:00.000Z' },
    { event: 'hardBounce', email: 'blocked@example.com', 'message-id': 'blocked-later', timestamp: '2026-08-27T09:00:00.000Z' },
  ]);

  const candidates = store.listOpenedRecipients();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].messageId, 'healthy');
  assert.equal(candidates[0].email, 'buyer@example.com');
  assert.equal(candidates[0].openCount, 2);
  assert.equal(candidates[0].lastOpenAt, '2026-08-26T09:00:00.000Z');
});

test('delivery dashboard reports and sorts repeated opens and clicks across the full result set', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-ranking-'));
  const store = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  store.ingest([
    { event: 'sent', email: 'one@example.com', 'message-id': 'one', timestamp: '2026-09-03T01:00:00.000Z' },
    { event: 'opened', email: 'one@example.com', 'message-id': 'one', timestamp: '2026-09-03T01:01:00.000Z' },
    { event: 'sent', email: 'three@example.com', 'message-id': 'three', timestamp: '2026-09-03T02:00:00.000Z' },
    { event: 'opened', email: 'three@example.com', 'message-id': 'three', timestamp: '2026-09-03T02:01:00.000Z' },
    { event: 'opened', email: 'three@example.com', 'message-id': 'three', timestamp: '2026-09-03T02:02:00.000Z' },
    { event: 'opened', email: 'three@example.com', 'message-id': 'three', timestamp: '2026-09-03T02:03:00.000Z' },
    { event: 'click', email: 'three@example.com', 'message-id': 'three', timestamp: '2026-09-03T02:04:00.000Z', link: 'https://example.com/one' },
    { event: 'sent', email: 'clicker@example.com', 'message-id': 'clicker', timestamp: '2026-09-03T03:00:00.000Z' },
    { event: 'click', email: 'clicker@example.com', 'message-id': 'clicker', timestamp: '2026-09-03T03:01:00.000Z', link: 'https://example.com/one' },
    { event: 'click', email: 'clicker@example.com', 'message-id': 'clicker', timestamp: '2026-09-03T03:02:00.000Z', link: 'https://example.com/two' },
  ]);

  const opens = store.getDashboard({ sort: 'opens_desc', limit: 2 });
  assert.deepEqual(opens.items.map((item) => item.messageId), ['three', 'one']);
  assert.deepEqual(opens.items.map((item) => [item.openCount, item.clickCount]), [[3, 1], [1, 0]]);

  const clicks = store.getDashboard({ sort: 'clicks_desc' });
  assert.deepEqual(clicks.items.map((item) => item.messageId), ['clicker', 'three', 'one']);
  assert.deepEqual(clicks.items.map((item) => item.clickCount), [2, 1, 0]);
});

test('Feishu delivery summary aggregates every message attached to one company record', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-delivery-feishu-'));
  const store = new DeliveryStore({ databasePath: path.join(directory, 'delivery.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  store.recordSent({
    messageId: 'opened-message', email: 'buyer@example.com', recordId: 'rec-company', customerId: 'customer-1',
    occurredAt: '2026-09-03T01:00:00.000Z', subject: 'First contact',
  });
  store.ingest([
    { event: 'opened', email: 'buyer@example.com', 'message-id': 'opened-message', timestamp: '2026-09-03T02:00:00.000Z' },
    { event: 'opened', email: 'buyer@example.com', 'message-id': 'opened-message', timestamp: '2026-09-03T03:00:00.000Z' },
  ]);
  store.recordSent({
    messageId: 'failed-message', email: 'other@example.com', recordId: 'rec-company', customerId: 'customer-1',
    occurredAt: '2026-09-03T04:00:00.000Z', subject: 'Second contact',
  });
  store.ingest({
    event: 'hardBounce', email: 'other@example.com', 'message-id': 'failed-message',
    timestamp: '2026-09-03T05:00:00.000Z', reason: 'Mailbox unavailable',
  });

  const [summary] = store.getFeishuTrackingSummariesForMessages(['opened-message']);
  assert.equal(summary.recordId, 'rec-company');
  assert.equal(summary.customerId, 'customer-1');
  assert.equal(summary.messageCount, 2);
  assert.equal(summary.status, 'opened');
  assert.equal(summary.statusLabel, '已打开 · 1 封异常');
  assert.equal(summary.openCount, 2);
  assert.equal(summary.clickCount, 0);
  assert.equal(summary.stoppedMessages, 1);
  assert.equal(summary.lastOpenedAt, '2026-09-03T03:00:00.000Z');
  assert.equal(summary.lastSentAt, '2026-09-03T04:00:00.000Z');
  assert.equal(summary.failureReason, 'Mailbox unavailable');
  assert.equal(summary.nextAction, '关注客户回复，并检查异常邮箱');
});
