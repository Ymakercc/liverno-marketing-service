import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const EVENT_ALIASES = new Map([
  ['request', 'accepted'], ['accepted', 'accepted'], ['sent', 'sent'], ['delivered', 'delivered'],
  ['first_opening', 'opened'], ['firstopening', 'opened'], ['open', 'opened'], ['opened', 'opened'],
  ['unique_opened', 'opened'], ['uniqueopened', 'opened'], ['proxy_open', 'opened'], ['proxyopen', 'opened'],
  ['unique_proxy_open', 'opened'], ['uniqueproxyopen', 'opened'], ['click', 'clicked'], ['clicked', 'clicked'],
  ['deferred', 'deferred'], ['soft_bounce', 'soft_bounce'], ['soft_bounced', 'soft_bounce'],
  ['softbounce', 'soft_bounce'], ['hard_bounce', 'hard_bounce'], ['hard_bounced', 'hard_bounce'],
  ['hardbounce', 'hard_bounce'], ['invalid', 'invalid_email'], ['invalid_email', 'invalid_email'],
  ['invalidemail', 'invalid_email'], ['blocked', 'blocked'], ['spam', 'spam'], ['complaint', 'spam'],
  ['unsubscribed', 'unsubscribed'], ['unsubscribe', 'unsubscribed'], ['error', 'error'],
]);

export const DELIVERY_STATUS = {
  accepted: { label: 'Brevo 已接收', tone: 'info', rank: 10 },
  sent: { label: '已发送', tone: 'info', rank: 20 },
  deferred: { label: '延迟投递', tone: 'warning', rank: 25 },
  soft_bounce: { label: '软退信', tone: 'warning', rank: 25 },
  delivered: { label: '已送达', tone: 'success', rank: 30 },
  opened: { label: '已打开', tone: 'success', rank: 40 },
  clicked: { label: '已点击', tone: 'success', rank: 50 },
  error: { label: '发送错误', tone: 'danger', rank: 60 },
  invalid_email: { label: '无效邮箱', tone: 'danger', rank: 90, stop: true },
  hard_bounce: { label: '硬退信', tone: 'danger', rank: 90, stop: true },
  blocked: { label: '被拦截', tone: 'danger', rank: 90, stop: true },
  spam: { label: '垃圾邮件投诉', tone: 'danger', rank: 100, stop: true },
  unsubscribed: { label: '已退订', tone: 'danger', rank: 100, stop: true },
};

function clean(value) { return value === undefined || value === null ? '' : String(value).trim(); }
function normalizeEmail(value) { return clean(value).replace(/^mailto:/i, '').toLowerCase(); }

function normalizeTimestamp(payload) {
  const value = payload.ts_event ?? payload.ts_epoch ?? payload.ts ?? payload.timestamp ?? payload.date;
  if (typeof value === 'number' || /^\d+$/.test(clean(value))) {
    const numeric = Number(value);
    const date = new Date(numeric > 1e12 ? numeric : numeric * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function parseCustomData(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  const source = clean(value);
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  const result = {};
  for (const part of source.split(/[;&]/)) {
    const match = part.match(/^\s*([^:=]+)\s*[:=]\s*(.+)\s*$/);
    if (match) result[match[1].trim()] = match[2].trim();
  }
  return result;
}

function findTaggedValue(tags, prefix) {
  const tag = tags.find((item) => item.startsWith(prefix));
  return tag ? tag.slice(prefix.length) : '';
}

export function normalizeBrevoEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const rawEvent = clean(payload.event || payload.Event || payload.type).toLowerCase().replace(/[\s-]+/g, '_');
  const eventType = EVENT_ALIASES.get(rawEvent) || EVENT_ALIASES.get(rawEvent.replace(/_/g, ''));
  if (!eventType) return null;
  const email = normalizeEmail(payload.email || payload.to || payload.recipient);
  const subject = clean(payload.subject);
  const messageId = clean(payload['message-id'] || payload.messageId || payload.message_id);
  const occurredAt = normalizeTimestamp(payload);
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(clean).filter(Boolean)
    : clean(payload.tag).replace(/^\[|\]$/g, '').split(',').map((tag) => tag.replace(/["']/g, '').trim()).filter(Boolean);
  const custom = parseCustomData(payload['X-Mailin-custom'] || payload['x-mailin-custom']);
  const recordId = clean(custom.recordId || custom.record_id || custom.feishuRecordId || findTaggedValue(tags, 'record_'));
  const customerId = clean(custom.customerId || custom.customer_id || custom.fumengCustomerId || findTaggedValue(tags, 'customer_'));
  const campaign = clean(custom.campaign || findTaggedValue(tags, 'campaign_'));
  const fallbackSeed = [email, subject, tags.join(','), occurredAt.slice(0, 16)].join('|');
  const messageKey = messageId || `unmatched:${crypto.createHash('sha256').update(fallbackSeed).digest('hex').slice(0, 24)}`;
  const eventKey = crypto.createHash('sha256')
    .update([messageKey, eventType, occurredAt, clean(payload.link || payload.url)].join('|')).digest('hex');
  return {
    eventKey, eventType, rawEvent, email, messageId, messageKey, subject, occurredAt,
    reason: clean(payload.reason || payload.error || payload.description),
    link: clean(payload.link || payload.url || payload.clickedUrl || payload.clicked_url),
    tags, recordId, customerId, campaign,
    senderEmail: normalizeEmail(payload.sender_email || payload.sender),
    payload,
  };
}

function eventStatus(events) {
  let status = 'accepted';
  let rank = 0;
  let stopped = false;
  for (const event of events) {
    const meta = DELIVERY_STATUS[event.event_type] || DELIVERY_STATUS.accepted;
    if (meta.stop) { status = event.event_type; rank = meta.rank; stopped = true; continue; }
    if (!stopped && meta.rank >= rank) { status = event.event_type; rank = meta.rank; }
  }
  return { status, stopped };
}

function mapEvent(row) {
  const meta = DELIVERY_STATUS[row.event_type] || DELIVERY_STATUS.accepted;
  return {
    id: row.event_key, event: row.event_type, rawEvent: row.raw_event, label: meta.label, tone: meta.tone,
    email: row.email, messageId: row.message_id, subject: row.subject, occurredAt: row.occurred_at,
    reason: row.reason, link: row.link, recordId: row.record_id, customerId: row.customer_id,
  };
}

const FAILURE_EVENTS = new Set([
  'error', 'invalid_email', 'hard_bounce', 'blocked', 'spam', 'unsubscribed',
]);

function latestEvent(events, predicate) {
  return [...events].reverse().find(predicate) || null;
}

function companyTrackingStatus(messages, events) {
  const openCount = events.filter((event) => event.event_type === 'opened').length;
  const clickCount = events.filter((event) => event.event_type === 'clicked').length;
  const delivered = events.some((event) => event.event_type === 'delivered');
  const stoppedMessages = messages.filter((message) => message.stopped).length;
  const latestFailure = latestEvent(events, (event) => FAILURE_EVENTS.has(event.event_type));
  const latestTransient = latestEvent(events, (event) => ['deferred', 'soft_bounce'].includes(event.event_type));
  const sent = events.some((event) => event.event_type === 'sent');
  let status = clickCount ? 'clicked' : openCount ? 'opened' : delivered ? 'delivered' : sent ? 'sent' : 'accepted';
  if (!clickCount && !openCount && !delivered && latestFailure) status = latestFailure.event_type;
  else if (!clickCount && !openCount && !delivered && latestTransient) status = latestTransient.event_type;
  const baseLabel = DELIVERY_STATUS[status]?.label || DELIVERY_STATUS.sent.label;
  const statusLabel = stoppedMessages && !FAILURE_EVENTS.has(status)
    ? `${baseLabel} · ${stoppedMessages} 封异常`
    : baseLabel;
  const nextAction = clickCount || openCount
    ? stoppedMessages ? '关注客户回复，并检查异常邮箱' : '关注客户回复'
    : stoppedMessages
      ? stoppedMessages >= messages.length ? '检查无效邮箱并补充联系人' : '检查异常邮箱，其他联系人继续等待回复'
      : delivered ? '等待客户查看或回复' : '等待邮件送达';
  return { status, statusLabel, openCount, clickCount, stoppedMessages, nextAction };
}

export class DeliveryStore {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delivery_events (
        event_key TEXT PRIMARY KEY, message_key TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL, raw_event TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '', occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
        record_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL DEFAULT '',
        sender_email TEXT NOT NULL DEFAULT '', payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS delivery_events_message_idx ON delivery_events(message_key, occurred_at);
      CREATE INDEX IF NOT EXISTS delivery_events_email_idx ON delivery_events(email, occurred_at);
      CREATE TABLE IF NOT EXISTS delivery_messages (
        message_key TEXT PRIMARY KEY, message_id TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, stopped INTEGER NOT NULL DEFAULT 0,
        record_id TEXT NOT NULL DEFAULT '', customer_id TEXT NOT NULL DEFAULT '', campaign TEXT NOT NULL DEFAULT '',
        first_event_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL, failure_reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS delivery_messages_status_idx ON delivery_messages(status, last_event_at);
    `);
    const messageColumns = this.db.prepare('PRAGMA table_info(delivery_messages)').all();
    if (!messageColumns.some((column) => column.name === 'campaign')) {
      this.db.exec("ALTER TABLE delivery_messages ADD COLUMN campaign TEXT NOT NULL DEFAULT ''");
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS delivery_messages_campaign_idx ON delivery_messages(campaign, first_event_at)');
    this.insertEvent = this.db.prepare(`
      INSERT OR IGNORE INTO delivery_events (
        event_key, message_key, message_id, event_type, raw_event, email, subject, occurred_at,
        received_at, reason, link, tags_json, record_id, customer_id, sender_email, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  ingest(payload) {
    const incoming = Array.isArray(payload) ? payload : [payload];
    const normalized = incoming.map(normalizeBrevoEvent).filter(Boolean);
    const accepted = [];
    let duplicates = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const event of normalized) {
        const result = this.insertEvent.run(
          event.eventKey, event.messageKey, event.messageId, event.eventType, event.rawEvent, event.email,
          event.subject, event.occurredAt, new Date().toISOString(), event.reason, event.link,
          JSON.stringify(event.tags), event.recordId, event.customerId, event.senderEmail, JSON.stringify(event.payload),
        );
        if (Number(result.changes) > 0) accepted.push(event); else duplicates += 1;
      }
      for (const messageKey of new Set(accepted.map((event) => event.messageKey))) this.rebuildMessage(messageKey);
      const campaigns = new Map(normalized.filter((event) => event.campaign)
        .map((event) => [event.messageKey, event.campaign]));
      const updateCampaign = this.db.prepare(`
        UPDATE delivery_messages SET campaign = ?, updated_at = ?
        WHERE message_key = ? AND campaign = ''
      `);
      for (const [messageKey, campaign] of campaigns) {
        const existing = this.db.prepare('SELECT 1 FROM delivery_messages WHERE message_key = ?').get(messageKey);
        if (!existing) this.rebuildMessage(messageKey);
        updateCampaign.run(campaign, new Date().toISOString(), messageKey);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { received: incoming.length, accepted: accepted.length, ignored: incoming.length - normalized.length, duplicates };
  }

  recordSent({ messageId, email, subject, occurredAt, recordId = '', customerId = '', campaign = '' } = {}) {
    return this.ingest({
      event: 'sent',
      email,
      subject,
      'message-id': messageId,
      timestamp: occurredAt,
      'X-Mailin-custom': { recordId, customerId, campaign },
    });
  }

  recordSentJobs(jobs = []) {
    const payloads = jobs.map((job) => ({
      event: 'sent',
      email: job.email,
      subject: job.subject,
      'message-id': job.messageId,
      timestamp: job.sentAt || job.occurredAt,
      'X-Mailin-custom': {
        recordId: job.feishuRecordId || job.recordId,
        customerId: job.customerId,
        campaign: job.campaign,
      },
    }));
    return this.ingest(payloads);
  }

  rebuildMessage(messageKey) {
    const events = this.db.prepare('SELECT * FROM delivery_events WHERE message_key = ? ORDER BY occurred_at ASC, received_at ASC').all(messageKey);
    if (!events.length) return;
    const first = events[0];
    const last = events.at(-1);
    const latestValue = (field) => [...events].reverse().find((event) => event[field])?.[field] || '';
    const { status, stopped } = eventStatus(events);
    const failureReason = [...events].reverse().find((event) => event.reason)?.reason || '';
    const knownCampaign = clean(this.db.prepare(
      'SELECT campaign FROM delivery_messages WHERE message_key = ?',
    ).get(messageKey)?.campaign);
    this.db.prepare(`
      INSERT INTO delivery_messages (
        message_key, message_id, email, subject, status, stopped, record_id, customer_id, campaign,
        first_event_at, last_event_at, failure_reason, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_key) DO UPDATE SET
        message_id = excluded.message_id, email = excluded.email, subject = excluded.subject,
        status = excluded.status, stopped = excluded.stopped, record_id = excluded.record_id,
        customer_id = excluded.customer_id,
        campaign = CASE WHEN delivery_messages.campaign <> '' THEN delivery_messages.campaign ELSE excluded.campaign END,
        first_event_at = excluded.first_event_at,
        last_event_at = excluded.last_event_at, failure_reason = excluded.failure_reason, updated_at = excluded.updated_at
    `).run(
      messageKey, latestValue('message_id'), latestValue('email'), latestValue('subject'), status, stopped ? 1 : 0,
      latestValue('record_id'), latestValue('customer_id'), knownCampaign, first.occurred_at, last.occurred_at,
      failureReason, new Date().toISOString(),
    );
  }

  getDashboard({ limit = 100, status = '', from = '', to = '', campaign = '', sort = 'sent_desc' } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const validStatus = DELIVERY_STATUS[status] ? status : '';
    const selectedCampaign = clean(campaign);
    const orderBy = {
      sent_desc: 'first_event_at DESC, last_event_at DESC',
      opens_desc: 'open_count DESC, click_count DESC, last_event_at DESC',
      clicks_desc: 'click_count DESC, open_count DESC, last_event_at DESC',
    }[clean(sort)] || 'first_event_at DESC, last_event_at DESC';
    const filters = [];
    const values = [];
    if (validStatus) {
      filters.push('status = ?');
      values.push(validStatus);
    }
    if (selectedCampaign && selectedCampaign !== 'all') {
      filters.push('campaign = ?');
      values.push(selectedCampaign);
    }
    if (String(from || '').trim()) {
      filters.push('first_event_at >= ?');
      values.push(String(from).trim());
    }
    if (String(to || '').trim()) {
      filters.push('first_event_at < ?');
      values.push(String(to).trim());
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const messages = this.db.prepare(`
      SELECT delivery_messages.*,
        (SELECT COUNT(*) FROM delivery_events event
          WHERE event.message_key = delivery_messages.message_key AND event.event_type = 'opened') AS open_count,
        (SELECT COUNT(*) FROM delivery_events event
          WHERE event.message_key = delivery_messages.message_key AND event.event_type = 'clicked') AS click_count
      FROM delivery_messages ${where}
      ORDER BY ${orderBy} LIMIT ?
    `).all(...values, safeLimit);
    const messageKeys = messages.map((message) => message.message_key);
    const eventsByMessage = new Map(messageKeys.map((key) => [key, []]));
    if (messageKeys.length) {
      const placeholders = messageKeys.map(() => '?').join(',');
      const events = this.db.prepare(`SELECT * FROM delivery_events WHERE message_key IN (${placeholders}) ORDER BY occurred_at DESC, received_at DESC`).all(...messageKeys);
      for (const event of events) eventsByMessage.get(event.message_key)?.push(mapEvent(event));
    }
    const byStatus = Object.fromEntries(this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM delivery_messages ${where} GROUP BY status
    `).all(...values).map((row) => [row.status, Number(row.count)]));
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM delivery_messages ${where}`).get(...values).count);
    const eventTotal = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM delivery_events
      WHERE message_key IN (SELECT message_key FROM delivery_messages ${where})
    `).get(...values).count);
    const stoppedWhere = filters.length ? `${where} AND stopped = 1` : 'WHERE stopped = 1';
    const stopped = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM delivery_messages ${stoppedWhere}`).get(...values).count);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayWhere = filters.length ? `${where} AND first_event_at >= ?` : 'WHERE first_event_at >= ?';
    const sentToday = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM delivery_messages ${todayWhere}`)
      .get(...values, startOfToday.toISOString()).count);
    const delivered = ['delivered', 'opened', 'clicked'].reduce((sum, key) => sum + (byStatus[key] || 0), 0);
    const opened = ['opened', 'clicked'].reduce((sum, key) => sum + (byStatus[key] || 0), 0);
    const failed = ['error', 'invalid_email', 'hard_bounce', 'blocked', 'spam', 'unsubscribed']
      .reduce((sum, key) => sum + (byStatus[key] || 0), 0);
    return {
      summary: { total, sentToday, eventTotal, delivered, opened, clicked: byStatus.clicked || 0, failed, stopped, byStatus },
      items: messages.map((message) => {
        const meta = DELIVERY_STATUS[message.status] || DELIVERY_STATUS.accepted;
        return {
          messageKey: message.message_key, messageId: message.message_id, email: message.email,
          subject: message.subject, status: message.status, statusLabel: meta.label, tone: meta.tone,
          stopped: Boolean(message.stopped), recordId: message.record_id, customerId: message.customer_id,
          campaign: message.campaign,
          openCount: Number(message.open_count || 0), clickCount: Number(message.click_count || 0),
          firstEventAt: message.first_event_at, lastEventAt: message.last_event_at,
          failureReason: message.failure_reason, events: eventsByMessage.get(message.message_key) || [],
        };
      }),
    };
  }

  getFeishuTrackingSummary(recordId) {
    const id = clean(recordId);
    if (!id) return null;
    const messages = this.db.prepare(`
      SELECT * FROM delivery_messages WHERE record_id = ? ORDER BY last_event_at ASC
    `).all(id);
    if (!messages.length) return null;
    const events = this.db.prepare(`
      SELECT event.* FROM delivery_events event
      INNER JOIN delivery_messages message ON message.message_key = event.message_key
      WHERE message.record_id = ?
      ORDER BY event.occurred_at ASC, event.received_at ASC
    `).all(id);
    const latestSent = latestEvent(events, (event) => ['sent', 'accepted'].includes(event.event_type));
    const latestOpened = latestEvent(events, (event) => event.event_type === 'opened');
    const latestClicked = latestEvent(events, (event) => event.event_type === 'clicked');
    const latestFailure = latestEvent(events, (event) => FAILURE_EVENTS.has(event.event_type) && event.reason);
    return {
      recordId: id,
      customerId: latestEvent(messages, (message) => message.customer_id)?.customer_id || '',
      messageCount: messages.length,
      ...companyTrackingStatus(messages, events),
      lastSentAt: latestSent?.occurred_at || messages.at(-1)?.first_event_at || '',
      lastOpenedAt: latestOpened?.occurred_at || '',
      lastClickedAt: latestClicked?.occurred_at || '',
      lastClickedLink: latestClicked?.link || '',
      failureReason: latestFailure?.reason || '',
      lastEventAt: events.at(-1)?.occurred_at || messages.at(-1)?.last_event_at || '',
    };
  }

  listFeishuTrackingSummaries({ recordIds = [], limit = 1000 } = {}) {
    const requested = [...new Set(recordIds.map(clean).filter(Boolean))];
    const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 5000);
    let ids = requested;
    if (!ids.length) {
      ids = this.db.prepare(`
        SELECT record_id FROM delivery_messages
        WHERE record_id <> ''
        GROUP BY record_id
        ORDER BY MAX(last_event_at) DESC
        LIMIT ?
      `).all(safeLimit).map((row) => row.record_id);
    }
    return ids.slice(0, safeLimit).map((id) => this.getFeishuTrackingSummary(id)).filter(Boolean);
  }

  getFeishuTrackingSummariesForMessages(messageKeys = []) {
    const keys = [...new Set(messageKeys.map(clean).filter(Boolean))];
    if (!keys.length) return [];
    const placeholders = keys.map(() => '?').join(',');
    const recordIds = this.db.prepare(`
      SELECT DISTINCT record_id FROM delivery_messages
      WHERE message_key IN (${placeholders}) AND record_id <> ''
    `).all(...keys).map((row) => row.record_id);
    return this.listFeishuTrackingSummaries({ recordIds });
  }

  listOpenedRecipients({ limit = 5000 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 5000, 1), 10_000);
    const negativeEvents = ['unsubscribed', 'spam', 'hard_bounce', 'invalid_email', 'blocked'];
    const negativePlaceholders = negativeEvents.map(() => '?').join(',');
    return this.db.prepare(`
      SELECT
        source.message_key,
        MAX(source.message_id) AS message_id,
        MAX(source.email) AS email,
        MAX(source.customer_id) AS customer_id,
        SUM(CASE WHEN source.event_type = 'opened' THEN 1 ELSE 0 END) AS open_count,
        MIN(CASE WHEN source.event_type = 'opened' THEN source.occurred_at ELSE NULL END) AS first_open_at,
        MAX(CASE WHEN source.event_type = 'opened' THEN source.occurred_at ELSE NULL END) AS last_open_at,
        MIN(CASE WHEN source.event_type = 'sent' THEN source.occurred_at ELSE NULL END) AS first_sent_at,
        SUM(CASE WHEN source.event_type IN ('delivered', 'opened', 'clicked') THEN 1 ELSE 0 END) AS delivery_evidence
      FROM delivery_events source
      WHERE source.email <> ''
        AND NOT EXISTS (
          SELECT 1 FROM delivery_events negative
          WHERE negative.email = source.email
            AND negative.event_type IN (${negativePlaceholders})
        )
      GROUP BY source.message_key
      HAVING open_count >= 1 AND delivery_evidence >= 1 AND first_sent_at IS NOT NULL
      ORDER BY open_count DESC, last_open_at DESC
      LIMIT ?
    `).all(...negativeEvents, safeLimit).map((row) => ({
      messageKey: row.message_key,
      messageId: row.message_id,
      email: row.email,
      customerId: row.customer_id,
      openCount: Number(row.open_count || 0),
      firstOpenAt: row.first_open_at || '',
      lastOpenAt: row.last_open_at || '',
      firstSentAt: row.first_sent_at || '',
    }));
  }

  close() { this.db.close(); }
}
