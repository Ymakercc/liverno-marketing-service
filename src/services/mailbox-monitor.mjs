import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { AppError } from '../lib/errors.mjs';
import { prepareInboundEmailHtml } from '../lib/inbound-email-html.mjs';

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeEmail(value) {
  return clean(value).replace(/^mailto:/i, '').toLowerCase();
}

function messageIds(parsed) {
  const values = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references])];
  return [...new Set(values.flatMap((value) => clean(value).split(/\s+/)).filter(Boolean))];
}

function header(parsed, name) {
  return clean(parsed.headers?.get(name));
}

function isoDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString();
}

function classificationResult(classification, {
  confidence, reason, summary = '', details = {}, source = 'rule', model = '', error = '',
} = {}) {
  return {
    classification,
    confidence,
    reason,
    summary,
    details,
    source,
    model,
    error,
  };
}

export function extractNewestReply(value) {
  const lines = clean(value).replace(/\r/g, '').split('\n');
  const kept = [];
  const replyBoundary = /^(?:-{2,}\s*)?(?:original message|forwarded message|邮件原文|原始邮件|转发邮件)(?:\s*-{2,})?$/i;
  const wroteBoundary = /^(?:on .{3,} wrote:|在 .{3,} 写道[:：])$/i;
  const headerBoundary = /^(?:from|sent|to|subject|发件人|发送时间|收件人|主题)\s*[:：]/i;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (replyBoundary.test(line) || wroteBoundary.test(line)) break;
    const followingHeaders = lines.slice(index, index + 5)
      .filter((candidate) => headerBoundary.test(candidate.trim())).length;
    if (kept.length && headerBoundary.test(line) && followingHeaders >= 2) break;
    if (/^>/.test(line)) continue;
    kept.push(rawLine);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
}

function deterministicClassification(parsed, fromEmail, matched) {
  const subject = clean(parsed.subject).toLowerCase();
  const newestText = extractNewestReply(parsed.text);
  const body = newestText.toLowerCase();
  const [localPart, senderDomain = ''] = normalizeEmail(fromEmail).split('@');
  const autoSubmitted = header(parsed, 'auto-submitted').toLowerCase();
  const precedence = header(parsed, 'precedence').toLowerCase();
  const bounce = ['mailer-daemon', 'postmaster'].includes(localPart)
    || /delivery[ -]status notification|undeliver(?:ed|able)|mail delivery failed|returned mail/.test(subject);
  if (bounce) return classificationResult('bounce', {
    confidence: 1, reason: '发件地址或主题符合邮件退信通知特征。', summary: '',
  });
  const autoReply = (autoSubmitted && autoSubmitted !== 'no')
    || ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)
    || /out of office|automatic reply|auto(?:matic)?[ -]?reply|autoreply|away from (?:the )?office|vacation reply/.test(subject);
  if (autoReply) return classificationResult('auto_reply', {
    confidence: 1, reason: '邮件头或主题表明这是自动回复。', summary: '',
  });
  const internalOrTest = /(?:^|\.)kulon\.com$/i.test(senderDomain)
    || /\[(?:test|测试)\]|【(?:test|测试)】|测试邮件/i.test(subject);
  if (internalOrTest) return classificationResult('unrelated', {
    confidence: 1,
    reason: '这是 KULON 内部邮件或带有明确 TEST 标记的测试邮件，不属于客户询盘。',
    summary: '',
  });
  const b2bPlatformDomains = /(?:^|\.)(?:b2blead\.co|b2brazil\.com|tradekey\.com|exporthub\.com|go4worldbusiness\.com)$/i;
  if (b2bPlatformDomains.test(senderDomain)) return classificationResult('unrelated', {
    confidence: 0.99,
    reason: '这是第三方 B2B 平台的线索推广或采购信息通知，不是买家直接发来的询盘。',
    summary: '',
  });
  const optOut = /\b(unsubscribe|remove me|stop (?:emailing|contacting)|do not contact|not interested|no interest)\b|退订|取消订阅|不要再(?:发|联系)|停止(?:发送|联系)|没(?:有)?兴趣/i.test(`${subject}\n${body}`);
  if (optOut && matched) return classificationResult('opt_out', {
    confidence: 0.99, reason: '发件人明确拒绝、退订或要求停止联系。', summary: '客户要求停止联系。',
  });

  const inquirySignals = /\b(?:rfq|quotation|quote|pricing|price list|proforma|purchase order|lead time|delivery time|shipping cost|payment terms|sample|availability|moq|minimum order|datasheet|specification|certificate|discount|\d+\s*(?:pcs|pieces|units))\b|询价|报价|价格|交期|样品|运费|付款|数量|采购|下单|规格|认证/i;
  if (inquirySignals.test(`${subject}\n${body}`)) return classificationResult('inquiry', {
    confidence: 0.82, reason: '正文包含明确的报价、产品、数量、交期或采购需求信号。',
    summary: newestText.slice(0, 500), source: 'fallback', error: 'mimo_not_used',
  });
  const interestSignals = /\b(?:interested|catalog(?:ue)?|more information|send (?:me |us )?(?:details|information)|distributor|cooperation|project)\b|感兴趣|产品目录|更多资料|合作|项目/i;
  if (interestSignals.test(`${subject}\n${body}`)) return classificationResult('potential_interest', {
    confidence: 0.72, reason: '正文表达了产品或合作兴趣，但还没有形成明确询价条件。',
    summary: newestText.slice(0, 500), source: 'fallback', error: 'mimo_not_used',
  });
  const compact = body.replace(/[\s.!?,;:'"’”“，。！？；：-]/g, '');
  const courtesy = /^(?:thanks?(?:you)?|thankyou|received|noted|ok(?:ay)?|gotit|谢谢|感谢|收到|好的|知悉)$/i.test(compact);
  if (matched || courtesy) return classificationResult('ordinary_reply', {
    confidence: courtesy ? 0.96 : 0.58,
    reason: courtesy ? '正文只是致谢或确认收到，没有采购请求。' : '这是人工回复，但规则没有发现明确采购意向。',
    summary: '', source: 'fallback', error: 'mimo_not_used',
  });
  return classificationResult('unrelated', {
    confidence: 0.55, reason: '未匹配到营销记录，规则也没有发现采购或合作意向。',
    summary: '', source: 'fallback', error: 'mimo_not_used',
  });
}

function connectionOptions(mailbox) {
  return {
    host: mailbox.host,
    port: mailbox.port,
    secure: mailbox.secure !== false,
    auth: { user: mailbox.username, pass: mailbox.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    tls: { minVersion: 'TLSv1.2', servername: mailbox.host },
  };
}

const HUMAN_CLASSIFICATIONS = new Set(['inquiry', 'potential_interest', 'ordinary_reply', 'opt_out']);

export class MailboxMonitor {
  constructor({ config, inbox, marketing, feishu, mimo, imapFactory, parseMessage } = {}) {
    this.config = config;
    this.inbox = inbox;
    this.marketing = marketing;
    this.feishu = feishu;
    this.mimo = mimo;
    this.imapFactory = imapFactory || ((options) => new ImapFlow(options));
    this.parseMessage = parseMessage || simpleParser;
    this.pollPromise = null;
  }

  async classify(parsed, fromEmail, match) {
    const matched = Boolean(match);
    const fallback = deterministicClassification(parsed, fromEmail, matched);
    if (fallback.source === 'rule') return fallback;
    if (!this.mimo?.configured) return fallback;
    try {
      return await this.mimo.classifyInboundEmail({
        subject: parsed.subject,
        newestText: extractNewestReply(parsed.text),
        matched,
        companyName: match?.job?.companyName,
        contactName: match?.job?.contactName,
        outboundSubject: match?.job?.subject,
      });
    } catch (error) {
      return {
        ...fallback,
        source: 'fallback',
        error: clean(error.message).slice(0, 1000),
      };
    }
  }

  assertConfigured({ requireEnabled = true } = {}) {
    const mailbox = this.config.mailbox || {};
    if (requireEnabled && mailbox.enabled !== true) {
      throw new AppError('阿里邮箱收件监控尚未开启', { status: 409, code: 'MAILBOX_MONITORING_DISABLED' });
    }
    if (!mailbox.host || !mailbox.port || !mailbox.username || !mailbox.password) {
      throw new AppError('阿里邮箱 IMAP 尚未配置完整', { status: 503, code: 'MAILBOX_CONFIG_INCOMPLETE' });
    }
    return mailbox;
  }

  async testConnection() {
    const mailbox = this.assertConfigured({ requireEnabled: false });
    const client = this.imapFactory(connectionOptions(mailbox));
    try {
      await client.connect();
      const opened = await client.mailboxOpen(mailbox.folder || 'INBOX', { readOnly: true });
      return {
        ok: true,
        mailbox: mailbox.username,
        folder: mailbox.folder || 'INBOX',
        messages: Number(opened?.exists || client.mailbox?.exists || 0),
      };
    } catch (error) {
      throw new AppError(`阿里邮箱 IMAP 连接失败：${error.message}`, {
        status: 502, code: 'MAILBOX_CONNECTION_FAILED',
      });
    } finally {
      try { await client.logout(); } catch { try { client.close(); } catch {} }
    }
  }

  async reclassifyPending({ limit = 50, includeFallback = false } = {}) {
    const result = { checked: 0, updated: 0, aiClassified: 0, failed: 0 };
    if (!this.mimo?.configured || !this.inbox?.listPendingClassification) return result;
    const retryBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    for (const item of this.inbox.listPendingClassification({ limit, includeFallback, retryBefore })) {
      const match = item.matched ? { job: {
        id: item.marketingJobId,
        companyName: item.companyName,
        contactName: item.contactName,
        subject: '',
      } } : null;
      const parsed = { subject: item.subject, text: item.textBody, headers: new Map() };
      const analysis = await this.classify(parsed, item.fromEmail, match);
      result.checked += 1;
      const updated = this.inbox.updateClassification(item.id, {
        classification: analysis.classification,
        classificationSource: analysis.source,
        classificationConfidence: analysis.confidence,
        classificationReason: analysis.reason,
        classificationSummary: analysis.summary,
        classificationDetails: analysis.details,
        classifierModel: analysis.model,
        classificationError: analysis.error,
        syncToFeishu: Boolean(item.feishuRecordId && HUMAN_CLASSIFICATIONS.has(analysis.classification)),
      });
      if (updated) result.updated += 1;
      if (analysis.source === 'mimo') result.aiClassified += 1;
      else if (analysis.error && analysis.error !== 'mimo_not_used') {
        result.failed += 1;
        break;
      }
    }
    return result;
  }

  async syncPendingFeishu({ limit = 100 } = {}) {
    const result = { synced: 0, failed: 0 };
    if (!this.inbox?.listPendingFeishu) return result;
    for (const pending of this.inbox.listPendingFeishu({ limit })) {
      if (await this.syncReplyToFeishu(pending)) result.synced += 1;
      else result.failed += 1;
    }
    return result;
  }

  async poll() {
    if (this.pollPromise) return this.pollPromise;
    this.pollPromise = this.runPoll().finally(() => { this.pollPromise = null; });
    return this.pollPromise;
  }

  async runPoll() {
    const mailbox = this.assertConfigured();
    const client = this.imapFactory(connectionOptions(mailbox));
    const mailboxKey = normalizeEmail(mailbox.username);
    let state = this.inbox.getState(mailboxKey);
    let lastUid = Number(state?.lastUid || 0);
    let uidValidity = clean(state?.uidValidity);
    const result = {
      checked: 0, created: 0, inquiries: 0, potentialInterests: 0, ordinaryReplies: 0,
      optOuts: 0, autoReplies: 0, bounces: 0, unmatched: 0, aiClassified: 0,
      reclassified: 0, synced: 0, failed: 0,
    };
    try {
      const historical = await this.reclassifyPending({ limit: 50, includeFallback: true });
      result.aiClassified += historical.aiClassified;
      result.reclassified += historical.updated;
      result.failed += historical.failed;
      const feishuSync = await this.syncPendingFeishu({ limit: 100 });
      result.synced += feishuSync.synced;
      result.failed += feishuSync.failed;
      await client.connect();
      const opened = await client.mailboxOpen(mailbox.folder || 'INBOX', { readOnly: true });
      const currentUidValidity = clean(opened?.uidValidity || client.mailbox?.uidValidity);
      const highestUid = Math.max(Number(opened?.uidNext || client.mailbox?.uidNext || 1) - 1, 0);
      if (uidValidity && currentUidValidity && uidValidity !== currentUidValidity) lastUid = 0;
      uidValidity = currentUidValidity;
      let uids = [];
      if (lastUid > 0) {
        if (lastUid < highestUid) uids = await client.search({ uid: `${lastUid + 1}:${highestUid}` }, { uid: true });
      } else {
        const since = new Date(Date.now() - Number(mailbox.initialLookbackDays || 30) * 86_400_000);
        uids = await client.search({ since }, { uid: true });
      }
      const maxMessages = Number(mailbox.maxMessagesPerPoll || 200);
      const newUids = [...new Set((uids || []).map(Number).filter((uid) => uid > lastUid))]
        .sort((left, right) => left - right);
      const missingHtml = this.inbox.listMissingHtml({ mailbox: mailboxKey, uidValidity, limit: maxMessages });
      uids = [...new Set([...newUids, ...missingHtml.map((item) => item.uid)])].slice(0, maxMessages);
      if (!uids.length) {
        this.inbox.updateState(mailboxKey, { uidValidity, lastUid: Math.max(lastUid, highestUid), success: true });
        return result;
      }

      for await (const message of client.fetch(uids.join(','), {
        uid: true, envelope: true, source: { start: 0, maxLength: 5_000_000 },
      }, { uid: true })) {
        const uid = Number(message.uid);
        try {
          const parsed = await this.parseMessage(message.source, {
            skipHtmlToText: false, skipTextToHtml: true, skipImageLinks: true,
          });
          const from = parsed.from?.value?.[0] || {};
          const fromEmail = normalizeEmail(from.address);
          const references = messageIds(parsed);
          const match = this.marketing.findSentJobForInbound({ messageIds: references, senderEmail: fromEmail });
          const analysis = await this.classify(parsed, fromEmail, match);
          const classification = analysis.classification;
          const textBody = clean(parsed.text).slice(0, 20_000);
          const htmlBody = prepareInboundEmailHtml(parsed);
          const preview = textBody.replace(/\s+/g, ' ').slice(0, 600);
          const receivedAt = isoDate(parsed.date || message.envelope?.date);
          const stored = this.inbox.ingest({
            mailbox: mailboxKey, uidValidity, uid, messageId: parsed.messageId,
            inReplyTo: parsed.inReplyTo, references, fromEmail, fromName: from.name,
            subject: parsed.subject, receivedAt, textBody, htmlBody, htmlChecked: true, preview, classification,
            classificationSource: analysis.source, classificationConfidence: analysis.confidence,
            classificationReason: analysis.reason, classificationSummary: analysis.summary,
            classificationDetails: analysis.details, classifierModel: analysis.model,
            classificationError: analysis.error,
            matchMethod: match?.method, marketingJobId: match?.job.id,
            customerId: match?.job.customerId, companyName: match?.job.companyName,
            contactName: match?.job.contactName, feishuRecordId: match?.job.feishuRecordId,
            feishuSyncStatus: HUMAN_CLASSIFICATIONS.has(classification) && match?.job.feishuRecordId ? 'pending' : '',
          });
          if (HUMAN_CLASSIFICATIONS.has(classification) && match?.job) {
            this.marketing.suppress(fromEmail, classification === 'opt_out' ? 'recipient_opt_out' : 'recipient_replied', 'mailbox_monitor');
            if (stored.created) this.marketing.addEvent(match.job.id, 'inbound_reply_received', clean(parsed.subject));
            if (stored.item.feishuRecordId && stored.item.feishuSyncStatus !== 'synced') {
              if (await this.syncReplyToFeishu(stored.item)) result.synced += 1;
              else result.failed += 1;
            }
          }
          if (stored.created) {
            result.created += 1;
            if (classification === 'inquiry') result.inquiries += 1;
            else if (classification === 'potential_interest') result.potentialInterests += 1;
            else if (classification === 'ordinary_reply') result.ordinaryReplies += 1;
            else if (classification === 'opt_out') result.optOuts += 1;
            else if (classification === 'auto_reply') result.autoReplies += 1;
            else if (classification === 'bounce') result.bounces += 1;
            else result.unmatched += 1;
            if (analysis.source === 'mimo') result.aiClassified += 1;
          }
          result.checked += 1;
          lastUid = Math.max(lastUid, uid);
          this.inbox.updateState(mailboxKey, { uidValidity, lastUid, success: true });
        } catch (error) {
          result.failed += 1;
          lastUid = Math.max(lastUid, uid);
          this.inbox.updateState(mailboxKey, { uidValidity, lastUid, success: false, error: error.message });
          continue;
        }
      }
      return result;
    } catch (error) {
      this.inbox.updateState(mailboxKey, { uidValidity, lastUid, success: false, error: error.message });
      if (error instanceof AppError) throw error;
      throw new AppError(`阿里邮箱收件失败：${error.message}`, { status: 502, code: 'MAILBOX_POLL_FAILED' });
    } finally {
      try { await client.logout(); } catch { try { client.close(); } catch {} }
    }
  }

  async syncReplyToFeishu(item) {
    if (!item.feishuRecordId || !this.feishu?.updateInboundReply) return true;
    try {
      const statuses = {
        inquiry: ['明确询盘·待跟进', '尽快人工查看并回复询价'],
        potential_interest: ['潜在意向·待确认', '人工确认需求并回复'],
        ordinary_reply: ['普通回复·无需询盘跟进', '记录回复，必要时人工查看'],
        opt_out: ['明确拒绝或要求退订', '停止营销并人工确认'],
      };
      const [status, nextAction] = statuses[item.classification] || ['已回复·待人工查看', '人工查看客户回复'];
      const aiNote = [item.classificationSummary, item.classificationReason].filter(Boolean).join('；');
      await this.feishu.updateInboundReply(item.feishuRecordId, {
        status,
        receivedAt: item.receivedAt,
        subject: item.subject,
        preview: aiNote || item.preview,
        nextAction,
      });
      this.inbox.markFeishuSync(item.id, { status: 'synced' });
      return true;
    } catch (error) {
      this.inbox.markFeishuSync(item.id, { status: 'failed', error: error.message });
      return false;
    }
  }
}
