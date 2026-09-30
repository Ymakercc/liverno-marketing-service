import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InboxStore } from '../src/lib/inbox-store.mjs';

test('inbox store deduplicates messages and summarizes reply classifications', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-inbox-store-'));
  const store = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const base = {
    mailbox: 'marketing@kulon.com', uidValidity: '1', fromEmail: 'buyer@example.com',
    receivedAt: '2026-09-05T01:00:00.000Z', subject: 'Re: Power supplies', preview: 'Please quote.',
  };
  const first = store.ingest({
    ...base, uid: 10, messageId: '<reply-1>', classification: 'inquiry',
    marketingJobId: 'job-1', customerId: 'customer-1', companyName: 'Example',
  });
  const duplicate = store.ingest({ ...base, uid: 10, messageId: '<reply-1>', classification: 'inquiry' });
  store.ingest({ ...base, uid: 11, messageId: '<auto-1>', classification: 'auto_reply' });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(store.listMissingHtml({ mailbox: 'marketing@kulon.com', uidValidity: '1' }).length, 2);
  const updated = store.ingest({
    ...base, uid: 10, messageId: '<reply-1>', classification: 'inquiry',
    htmlBody: '<p>Please quote.</p>', htmlChecked: true,
  });
  assert.equal(updated.created, false);
  assert.equal(store.get(first.item.id).htmlBody, '<p>Please quote.</p>');
  assert.equal(store.listMissingHtml({ mailbox: 'marketing@kulon.com', uidValidity: '1' }).length, 1);
  const dashboard = store.getDashboard({ from: '2026-09-05T00:00:00.000Z' });
  assert.deepEqual(dashboard.summary, {
    total: 2, inquiries: 1, potentialInterests: 0, ordinaryReplies: 0, optOuts: 0,
    actionable: 1, aiClassified: 0, matched: 1, autoReplies: 1, bounces: 0, unmatched: 0,
    byClassification: { auto_reply: 1, inquiry: 1 },
  });
  assert.equal(dashboard.items[0].classification, 'auto_reply');
});

test('inbox store persists AI classification evidence and can reclassify legacy messages', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-inbox-ai-'));
  const store = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const { item } = store.ingest({
    mailbox: 'marketing@kulon.com', uidValidity: '2', uid: 1, messageId: '<legacy>',
    fromEmail: 'buyer@example.com', receivedAt: '2026-09-05T01:00:00.000Z',
    subject: 'Re: product information', textBody: 'Thanks', classification: 'inquiry',
    marketingJobId: 'job-1', feishuRecordId: 'rec-1', feishuSyncStatus: 'synced',
  });
  assert.equal(store.listPendingClassification().length, 1);
  const updated = store.updateClassification(item.id, {
    classification: 'ordinary_reply', classificationSource: 'mimo',
    classificationConfidence: 0.98, classificationReason: '只是礼貌致谢。',
    classificationSummary: '', classificationDetails: { language: 'English', purchaseSignals: [] },
    classifierModel: 'mimo-v2.5', syncToFeishu: true,
  });
  assert.equal(updated.classification, 'ordinary_reply');
  assert.equal(updated.classificationSource, 'mimo');
  assert.equal(updated.classificationConfidence, 0.98);
  assert.equal(updated.feishuSyncStatus, 'pending');
  assert.equal(store.listPendingClassification().length, 0);
});

test('inbox store retries fallback classifications only after the cooldown', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-inbox-retry-'));
  const store = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const oldFallback = store.ingest({
    mailbox: 'marketing@kulon.com', uidValidity: '3', uid: 1, messageId: '<old-fallback>',
    fromEmail: 'old@example.com', receivedAt: '2026-09-05T00:00:00.000Z',
    subject: 'Re: products', textBody: 'Thanks', classification: 'ordinary_reply',
    classificationSource: 'fallback', classifiedAt: '2026-09-05T00:00:00.000Z',
  }).item;
  store.ingest({
    mailbox: 'marketing@kulon.com', uidValidity: '3', uid: 2, messageId: '<new-fallback>',
    fromEmail: 'new@example.com', receivedAt: '2026-09-05T01:00:00.000Z',
    subject: 'Re: products', textBody: 'Thanks', classification: 'ordinary_reply',
    classificationSource: 'fallback', classifiedAt: '2026-09-05T01:00:00.000Z',
  });
  const pending = store.listPendingClassification({
    includeFallback: true,
    retryBefore: '2026-09-05T00:30:00.000Z',
  });
  assert.deepEqual(pending.map((item) => item.id), [oldFallback.id]);
});

test('inbox store persists mailbox cursor and pending Feishu replies', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-inbox-state-'));
  const store = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  store.updateState('marketing@kulon.com', { uidValidity: '99', lastUid: 42, success: true });
  assert.equal(store.getState('marketing@kulon.com').lastUid, 42);
  const { item } = store.ingest({
    mailbox: 'marketing@kulon.com', uidValidity: '99', uid: 42, messageId: '<reply>',
    fromEmail: 'buyer@example.com', receivedAt: '2026-09-05T01:00:00.000Z',
    classification: 'inquiry', feishuRecordId: 'rec-1', feishuSyncStatus: 'pending',
  });
  assert.equal(store.listPendingFeishu().length, 1);
  store.markFeishuSync(item.id, { status: 'synced' });
  assert.equal(store.listPendingFeishu().length, 0);
});
