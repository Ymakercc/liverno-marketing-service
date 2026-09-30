import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { InboxStore } from '../src/lib/inbox-store.mjs';
import { extractNewestReply, MailboxMonitor } from '../src/services/mailbox-monitor.mjs';

function emailSource({ from, messageId, inReplyTo = '', subject, body }) {
  const headers = [
    `From: ${from}`,
    'To: marketing@kulon.com',
    `Date: Fri, 05 Sep 2026 09:00:00 +0800`,
    `Message-ID: ${messageId}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : '',
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
  ].filter(Boolean);
  return Buffer.from([...headers, '', body].join('\r\n'));
}

test('newest reply extraction excludes quoted outbound content', () => {
  assert.equal(extractNewestReply([
    'Thanks, received.',
    '',
    'On Thu, Sep 4, 2026 at 10:00 AM Sales <sales@example.com> wrote:',
    '> Please quote 100 pcs HDR-60-24.',
  ].join('\n')), 'Thanks, received.');
  assert.equal(extractNewestReply([
    'Please send the catalog.',
    '',
    '-----Original Message-----',
    'From: Sales <sales@example.com>',
    'Subject: MEAN WELL quotation',
  ].join('\n')), 'Please send the catalog.');
});

test('fixed mailbox rules take priority over MiMo', async () => {
  let aiCalls = 0;
  const monitor = new MailboxMonitor({
    mimo: {
      configured: true,
      async classifyInboundEmail() { aiCalls += 1; throw new Error('should not run'); },
    },
  });
  const headers = new Map([['auto-submitted', 'auto-replied']]);
  const automatic = await monitor.classify({ subject: 'Re: products', text: 'Back next week', headers }, 'buyer@example.com', null);
  const bounce = await monitor.classify({ subject: 'Mail delivery failed', text: '', headers: new Map() }, 'postmaster@example.com', null);
  const optOut = await monitor.classify(
    { subject: 'Re: products', text: 'Please stop emailing me.', headers: new Map() },
    'buyer@example.com',
    { job: { companyName: 'Example' } },
  );
  assert.equal(automatic.classification, 'auto_reply');
  assert.equal(bounce.classification, 'bounce');
  assert.equal(optOut.classification, 'opt_out');
  assert.equal(aiCalls, 0);
});

test('unsubscribe text in an unmatched newsletter is left to MiMo', async () => {
  let aiCalls = 0;
  const monitor = new MailboxMonitor({
    mimo: {
      configured: true,
      async classifyInboundEmail() {
        aiCalls += 1;
        return {
          classification: 'unrelated', confidence: 0.99, reason: '这是营销通讯。',
          summary: '', details: {}, source: 'mimo', model: 'mimo-v2.5-pro', error: '',
        };
      },
    },
  });
  const result = await monitor.classify(
    { subject: 'Product newsletter', text: 'Latest news\nUnsubscribe', headers: new Map() },
    'newsletter@example.com',
    null,
  );
  assert.equal(result.classification, 'unrelated');
  assert.equal(result.source, 'mimo');
  assert.equal(aiCalls, 1);
});

test('B2B platform lead alerts are unrelated even when they contain RFQ language', async () => {
  let aiCalls = 0;
  const monitor = new MailboxMonitor({
    mimo: {
      configured: true,
      async classifyInboundEmail() { aiCalls += 1; throw new Error('should not run'); },
    },
  });
  const result = await monitor.classify({
    subject: 'You received a new purchase inquiry through B2Brazil',
    text: 'Buyer requests a formal quotation, unit price and lead time.',
    headers: new Map(),
  }, 'b2brazil@b2blead.co', null);
  assert.equal(result.classification, 'unrelated');
  assert.equal(result.source, 'rule');
  assert.match(result.reason, /第三方 B2B 平台/);
  assert.equal(aiCalls, 0);
});

test('KULON internal and explicitly tagged test mail never become sales leads', async () => {
  let aiCalls = 0;
  const monitor = new MailboxMonitor({
    mimo: {
      configured: true,
      async classifyInboundEmail() { aiCalls += 1; throw new Error('should not run'); },
    },
  });
  const internal = await monitor.classify({
    subject: 'Hello', text: 'Please contact me.', headers: new Map(),
  }, 'allen@kulon.com', null);
  const testReply = await monitor.classify({
    subject: 'Re: [TEST] MEAN WELL sender verification',
    text: 'I hope we establish a good relationship.', headers: new Map(),
  }, 'buyer@example.invalid', null);
  assert.equal(internal.classification, 'unrelated');
  assert.equal(testReply.classification, 'unrelated');
  assert.equal(internal.source, 'rule');
  assert.equal(testReply.source, 'rule');
  assert.match(testReply.reason, /测试邮件/);
  assert.equal(aiCalls, 0);
});

test('mailbox classification falls back conservatively when MiMo fails', async () => {
  const monitor = new MailboxMonitor({
    mimo: {
      configured: true,
      async classifyInboundEmail() { throw new Error('temporary MiMo failure'); },
    },
  });
  const result = await monitor.classify(
    { subject: 'Re: products', text: 'Thanks.', headers: new Map() },
    'buyer@example.com',
    { job: { companyName: 'Example' } },
  );
  assert.equal(result.classification, 'ordinary_reply');
  assert.equal(result.source, 'fallback');
  assert.match(result.error, /temporary MiMo failure/);
});

test('mailbox monitor matches human replies, suppresses follow-ups, and ignores auto replies', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-mailbox-monitor-'));
  const inbox = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { inbox.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const messages = [
    {
      uid: 10,
      source: emailSource({
        from: 'Buyer <buyer@example.com>', messageId: '<reply-1>', inReplyTo: '<sent-1>',
        subject: 'Re: MEAN WELL power supplies', body: 'Please send a quotation for the listed models.',
      }),
    },
    {
      uid: 11,
      source: emailSource({
        from: 'Buyer <buyer@example.com>', messageId: '<auto-1>', inReplyTo: '<sent-1>',
        subject: 'Automatic Reply: Away from office', body: 'I will return next week.',
      }),
    },
  ];
  const imap = {
    mailbox: { exists: 11, uidNext: 12, uidValidity: 7n },
    async connect() {},
    async mailboxOpen() { return this.mailbox; },
    async search() { return [10, 11]; },
    async *fetch() { for (const message of messages) yield message; },
    async logout() {},
  };
  const calls = [];
  const job = {
    id: 'job-1', customerId: 'customer-1', companyName: 'Example Industries', contactName: 'Buyer',
    email: 'buyer@example.com', feishuRecordId: 'rec-1', messageId: '<sent-1>',
  };
  const marketing = {
    findSentJobForInbound: ({ messageIds }) => messageIds.includes('<sent-1>') ? { job, method: 'reply_header' } : null,
    suppress: (...args) => calls.push(['suppress', ...args]),
    addEvent: (...args) => calls.push(['event', ...args]),
  };
  const feishu = { updateInboundReply: async (...args) => calls.push(['feishu', ...args]) };
  const config = { mailbox: {
    enabled: true, host: 'imap.qiye.aliyun.com', port: 993, secure: true,
    username: 'marketing@kulon.com', password: 'secret', folder: 'INBOX',
    initialLookbackDays: 30, maxMessagesPerPoll: 200,
  } };
  const monitor = new MailboxMonitor({ config, inbox, marketing, feishu, imapFactory: () => imap });
  const result = await monitor.poll();

  assert.deepEqual(result, {
    checked: 2, created: 2, inquiries: 1, potentialInterests: 0, ordinaryReplies: 0,
    optOuts: 0, autoReplies: 1, bounces: 0, unmatched: 0, aiClassified: 0,
    reclassified: 0, synced: 1, failed: 0,
  });
  assert.equal(calls.filter((call) => call[0] === 'suppress').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'event').length, 1);
  assert.equal(calls.filter((call) => call[0] === 'feishu').length, 1);
  assert.equal(inbox.getDashboard().summary.inquiries, 1);
  assert.equal(inbox.getState('marketing@kulon.com').lastUid, 11);
});

test('mailbox monitor uses MiMo for human replies and does not treat thanks as an inquiry', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-mailbox-mimo-'));
  const inbox = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { inbox.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const messages = [
    { uid: 1, source: emailSource({ from: 'Buyer <buyer@example.com>', messageId: '<thanks>', inReplyTo: '<sent-1>', subject: 'Re: MEAN WELL', body: 'Thanks.' }) },
    { uid: 2, source: emailSource({ from: 'Buyer <buyer@example.com>', messageId: '<quote>', inReplyTo: '<sent-1>', subject: 'Re: MEAN WELL', body: 'Please quote 100 pcs HDR-60-24.' }) },
  ];
  const imap = {
    mailbox: { exists: 2, uidNext: 3, uidValidity: 8n },
    async connect() {}, async mailboxOpen() { return this.mailbox; }, async search() { return [1, 2]; },
    async *fetch() { for (const message of messages) yield message; }, async logout() {},
  };
  const job = { id: 'job-1', customerId: 'customer-1', companyName: 'Example', contactName: 'Buyer', feishuRecordId: 'rec-1', subject: 'MEAN WELL products' };
  const marketing = {
    findSentJobForInbound: () => ({ job, method: 'reply_header' }), suppress() {}, addEvent() {},
  };
  const mimo = {
    configured: true,
    async classifyInboundEmail({ newestText }) {
      const inquiry = newestText.includes('100 pcs');
      return {
        classification: inquiry ? 'inquiry' : 'ordinary_reply', confidence: 0.98,
        reason: inquiry ? '客户要求报价。' : '只是礼貌致谢。', summary: inquiry ? 'HDR-60-24 100件询价' : '',
        details: { language: 'English', purchaseSignals: inquiry ? ['HDR-60-24', '100 pcs', 'quotation'] : [] },
        source: 'mimo', model: 'mimo-v2.5', error: '',
      };
    },
  };
  const config = { mailbox: {
    enabled: true, host: 'imap.qiye.aliyun.com', port: 993, secure: true,
    username: 'marketing@kulon.com', password: 'secret', folder: 'INBOX', initialLookbackDays: 30, maxMessagesPerPoll: 200,
  } };
  const monitor = new MailboxMonitor({ config, inbox, marketing, feishu: { updateInboundReply: async () => {} }, mimo, imapFactory: () => imap });
  const result = await monitor.poll();
  assert.equal(result.inquiries, 1);
  assert.equal(result.ordinaryReplies, 1);
  assert.equal(result.aiClassified, 2);
  const dashboard = inbox.getDashboard();
  assert.equal(dashboard.summary.inquiries, 1);
  assert.equal(dashboard.summary.ordinaryReplies, 1);
  assert.equal(dashboard.summary.aiClassified, 2);
  assert.equal(dashboard.items.find((item) => item.messageId === '<thanks>').classificationReason, '只是礼貌致谢。');
});

test('mailbox connection can be tested before monitoring is enabled', async () => {
  const imap = {
    async connect() {},
    async mailboxOpen() { return { exists: 18 }; },
    async logout() {},
  };
  const monitor = new MailboxMonitor({
    config: { mailbox: {
      enabled: false, host: 'imap.qiye.aliyun.com', port: 993, secure: true,
      username: 'marketing@kulon.com', password: 'secret', folder: 'INBOX',
    } },
    imapFactory: () => imap,
  });
  assert.deepEqual(await monitor.testConnection(), {
    ok: true, mailbox: 'marketing@kulon.com', folder: 'INBOX', messages: 18,
  });
});

test('mailbox monitor backfills HTML for an existing stored message', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-mailbox-html-backfill-'));
  const inbox = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { inbox.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const existing = inbox.ingest({
    mailbox: 'marketing@kulon.com', uidValidity: '3', uid: 1, messageId: '<existing-html>',
    fromEmail: 'buyer@example.com', receivedAt: '2026-09-04T08:00:00.000Z',
    subject: 'Re: quotation', textBody: 'Please quote.', classification: 'unmatched',
  });
  inbox.updateState('marketing@kulon.com', { uidValidity: '3', lastUid: 1, success: true });
  const source = Buffer.from([
    'From: Buyer <buyer@example.com>', 'To: marketing@kulon.com',
    'Date: Thu, 04 Sep 2026 16:00:00 +0800', 'Message-ID: <existing-html>',
    'Subject: Re: quotation', 'Content-Type: text/html; charset=utf-8', '',
    '<table style="color:#063"><tr><td>Please quote.</td></tr></table>',
  ].join('\r\n'));
  const imap = {
    mailbox: { exists: 1, uidNext: 2, uidValidity: 3n },
    async connect() {}, async mailboxOpen() { return this.mailbox; },
    async *fetch() { yield { uid: 1, source }; }, async logout() {},
  };
  const monitor = new MailboxMonitor({
    config: { mailbox: {
      enabled: true, host: 'imap.qiye.aliyun.com', port: 993, secure: true,
      username: 'marketing@kulon.com', password: 'secret', folder: 'INBOX',
      initialLookbackDays: 30, maxMessagesPerPoll: 200,
    } },
    inbox, marketing: { findSentJobForInbound: () => null }, imapFactory: () => imap,
  });
  const result = await monitor.poll();
  assert.equal(result.created, 0);
  assert.equal(result.checked, 1);
  assert.equal(inbox.get(existing.item.id).htmlBody.includes('<table style="color:#063">'), true);
  assert.equal(inbox.listMissingHtml({ mailbox: 'marketing@kulon.com', uidValidity: '3' }).length, 0);
});

test('one malformed message does not block newer inbox messages', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-mailbox-malformed-'));
  const inbox = new InboxStore({ databasePath: path.join(directory, 'inbox.sqlite') });
  t.after(() => { inbox.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const imap = {
    mailbox: { exists: 2, uidNext: 3, uidValidity: 9n },
    async connect() {},
    async mailboxOpen() { return this.mailbox; },
    async search() { return [1, 2]; },
    async *fetch() { yield { uid: 1, source: Buffer.from('bad') }; yield { uid: 2, source: Buffer.from('good') }; },
    async logout() {},
  };
  const parsed = {
    from: { value: [{ address: 'new@example.com', name: 'New sender' }] },
    headers: new Map(), messageId: '<new>', subject: 'Introduction', text: 'Hello', date: new Date(),
  };
  const monitor = new MailboxMonitor({
    config: { mailbox: {
      enabled: true, host: 'imap.qiye.aliyun.com', port: 993, secure: true,
      username: 'marketing@kulon.com', password: 'secret', folder: 'INBOX',
      initialLookbackDays: 30, maxMessagesPerPoll: 200,
    } },
    inbox,
    marketing: { findSentJobForInbound: () => null },
    imapFactory: () => imap,
    parseMessage: async (source) => source.toString() === 'bad' ? Promise.reject(new Error('parse failed')) : parsed,
  });
  const result = await monitor.poll();
  assert.equal(result.failed, 1);
  assert.equal(result.created, 1);
  assert.equal(result.unmatched, 1);
  assert.equal(inbox.getState('marketing@kulon.com').lastUid, 2);
});
