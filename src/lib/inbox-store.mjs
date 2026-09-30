import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const CLASSIFICATIONS = new Set([
  'inquiry',
  'potential_interest',
  'ordinary_reply',
  'opt_out',
  'auto_reply',
  'bounce',
  'unrelated',
  'unmatched',
]);

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizeEmail(value) {
  return clean(value).replace(/^mailto:/i, '').toLowerCase();
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function mapMessage(row, { includeHtml = false } = {}) {
  const message = {
    id: row.id,
    mailbox: row.mailbox,
    uid: Number(row.uid),
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    references: parseJson(row.references_json, []),
    fromEmail: row.from_email,
    fromName: row.from_name,
    subject: row.subject,
    receivedAt: row.received_at,
    textBody: row.text_body,
    htmlAvailable: Boolean(row.html_body),
    preview: row.preview,
    classification: row.classification,
    classificationSource: row.classification_source,
    classificationConfidence: Number(row.classification_confidence || 0),
    classificationReason: row.classification_reason,
    classificationSummary: row.classification_summary,
    classificationDetails: parseJson(row.classification_details_json, {}),
    classifierModel: row.classifier_model,
    classificationError: row.classification_error,
    classifiedAt: row.classified_at,
    matched: Boolean(row.marketing_job_id),
    matchMethod: row.match_method,
    marketingJobId: row.marketing_job_id,
    customerId: row.customer_id,
    companyName: row.company_name,
    contactName: row.contact_name,
    feishuRecordId: row.feishu_record_id,
    feishuSyncStatus: row.feishu_sync_status,
    feishuSyncError: row.feishu_sync_error,
    createdAt: row.created_at,
  };
  if (includeHtml) message.htmlBody = row.html_body || '';
  return message;
}

export class InboxStore {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id TEXT PRIMARY KEY, mailbox TEXT NOT NULL, uid_validity TEXT NOT NULL DEFAULT '', uid INTEGER NOT NULL,
        message_id TEXT NOT NULL DEFAULT '', in_reply_to TEXT NOT NULL DEFAULT '', references_json TEXT NOT NULL DEFAULT '[]',
        from_email TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
        received_at TEXT NOT NULL, text_body TEXT NOT NULL DEFAULT '', html_body TEXT NOT NULL DEFAULT '',
        html_checked INTEGER NOT NULL DEFAULT 0, preview TEXT NOT NULL DEFAULT '',
        classification TEXT NOT NULL, classification_source TEXT NOT NULL DEFAULT '',
        classification_confidence REAL NOT NULL DEFAULT 0, classification_reason TEXT NOT NULL DEFAULT '',
        classification_summary TEXT NOT NULL DEFAULT '', classification_details_json TEXT NOT NULL DEFAULT '{}',
        classifier_model TEXT NOT NULL DEFAULT '', classification_error TEXT NOT NULL DEFAULT '',
        classified_at TEXT NOT NULL DEFAULT '', match_method TEXT NOT NULL DEFAULT '', marketing_job_id TEXT NOT NULL DEFAULT '',
        customer_id TEXT NOT NULL DEFAULT '', company_name TEXT NOT NULL DEFAULT '', contact_name TEXT NOT NULL DEFAULT '',
        feishu_record_id TEXT NOT NULL DEFAULT '', feishu_sync_status TEXT NOT NULL DEFAULT '',
        feishu_sync_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS inbox_uid_idx ON inbox_messages(mailbox, uid_validity, uid);
      CREATE INDEX IF NOT EXISTS inbox_received_idx ON inbox_messages(received_at DESC);
      CREATE INDEX IF NOT EXISTS inbox_classification_idx ON inbox_messages(classification, received_at DESC);
      CREATE TABLE IF NOT EXISTS inbox_state (
        mailbox TEXT PRIMARY KEY, uid_validity TEXT NOT NULL DEFAULT '', last_uid INTEGER NOT NULL DEFAULT 0,
        last_checked_at TEXT NOT NULL DEFAULT '', last_success_at TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT ''
      );
    `);
    const columns = new Set(this.db.prepare('PRAGMA table_info(inbox_messages)').all().map((column) => column.name));
    if (!columns.has('html_body')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN html_body TEXT NOT NULL DEFAULT ''");
    if (!columns.has('html_checked')) this.db.exec('ALTER TABLE inbox_messages ADD COLUMN html_checked INTEGER NOT NULL DEFAULT 0');
    if (!columns.has('classification_source')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN classification_source TEXT NOT NULL DEFAULT ''");
    if (!columns.has('classification_confidence')) this.db.exec('ALTER TABLE inbox_messages ADD COLUMN classification_confidence REAL NOT NULL DEFAULT 0');
    if (!columns.has('classification_reason')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN classification_reason TEXT NOT NULL DEFAULT ''");
    if (!columns.has('classification_summary')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN classification_summary TEXT NOT NULL DEFAULT ''");
    if (!columns.has('classification_details_json')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN classification_details_json TEXT NOT NULL DEFAULT '{}'");
    if (!columns.has('classifier_model')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN classifier_model TEXT NOT NULL DEFAULT ''");
    if (!columns.has('classification_error')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN classification_error TEXT NOT NULL DEFAULT ''");
    if (!columns.has('classified_at')) this.db.exec("ALTER TABLE inbox_messages ADD COLUMN classified_at TEXT NOT NULL DEFAULT ''");
  }

  getState(mailbox) {
    const row = this.db.prepare('SELECT * FROM inbox_state WHERE mailbox = ?').get(clean(mailbox));
    return row ? {
      mailbox: row.mailbox,
      uidValidity: row.uid_validity,
      lastUid: Number(row.last_uid),
      lastCheckedAt: row.last_checked_at,
      lastSuccessAt: row.last_success_at,
      lastError: row.last_error,
    } : null;
  }

  updateState(mailbox, { uidValidity = '', lastUid = 0, success = true, error = '' } = {}) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO inbox_state(mailbox, uid_validity, last_uid, last_checked_at, last_success_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(mailbox) DO UPDATE SET
        uid_validity = excluded.uid_validity, last_uid = excluded.last_uid,
        last_checked_at = excluded.last_checked_at,
        last_success_at = CASE WHEN ? THEN excluded.last_success_at ELSE inbox_state.last_success_at END,
        last_error = excluded.last_error
    `).run(clean(mailbox), clean(uidValidity), Number(lastUid) || 0, now, success ? now : '', clean(error), success ? 1 : 0);
    return this.getState(mailbox);
  }

  ingest(input = {}) {
    const mailbox = normalizeEmail(input.mailbox);
    const uidValidity = clean(input.uidValidity);
    const uid = Number(input.uid) || 0;
    const messageId = clean(input.messageId);
    const id = crypto.createHash('sha256')
      .update([mailbox, uidValidity, uid, messageId].join('|')).digest('hex');
    const now = new Date().toISOString();
    const classification = CLASSIFICATIONS.has(input.classification) ? input.classification : 'unmatched';
    const classifiedAt = clean(input.classifiedAt) || (clean(input.classificationSource) ? now : '');
    const htmlChecked = input.htmlChecked === true ? 1 : 0;
    const htmlBody = htmlChecked ? clean(input.htmlBody) : '';
    const existing = this.db.prepare('SELECT id FROM inbox_messages WHERE id = ?').get(id);
    const result = this.db.prepare(`
      INSERT INTO inbox_messages (
        id, mailbox, uid_validity, uid, message_id, in_reply_to, references_json,
        from_email, from_name, subject, received_at, text_body, html_body, html_checked, preview, classification,
        classification_source, classification_confidence, classification_reason, classification_summary,
        classification_details_json, classifier_model, classification_error, classified_at,
        match_method, marketing_job_id, customer_id, company_name, contact_name,
        feishu_record_id, feishu_sync_status, feishu_sync_error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        html_body = CASE WHEN excluded.html_checked = 1 THEN excluded.html_body ELSE inbox_messages.html_body END,
        html_checked = CASE WHEN excluded.html_checked = 1 THEN 1 ELSE inbox_messages.html_checked END,
        classification = CASE WHEN excluded.classified_at <> '' THEN excluded.classification ELSE inbox_messages.classification END,
        classification_source = CASE WHEN excluded.classified_at <> '' THEN excluded.classification_source ELSE inbox_messages.classification_source END,
        classification_confidence = CASE WHEN excluded.classified_at <> '' THEN excluded.classification_confidence ELSE inbox_messages.classification_confidence END,
        classification_reason = CASE WHEN excluded.classified_at <> '' THEN excluded.classification_reason ELSE inbox_messages.classification_reason END,
        classification_summary = CASE WHEN excluded.classified_at <> '' THEN excluded.classification_summary ELSE inbox_messages.classification_summary END,
        classification_details_json = CASE WHEN excluded.classified_at <> '' THEN excluded.classification_details_json ELSE inbox_messages.classification_details_json END,
        classifier_model = CASE WHEN excluded.classified_at <> '' THEN excluded.classifier_model ELSE inbox_messages.classifier_model END,
        classification_error = CASE WHEN excluded.classified_at <> '' THEN excluded.classification_error ELSE inbox_messages.classification_error END,
        classified_at = CASE WHEN excluded.classified_at <> '' THEN excluded.classified_at ELSE inbox_messages.classified_at END
    `).run(
      id, mailbox, uidValidity, uid, messageId, clean(input.inReplyTo), JSON.stringify(input.references || []),
      normalizeEmail(input.fromEmail), clean(input.fromName), clean(input.subject), clean(input.receivedAt) || now,
      clean(input.textBody).slice(0, 20_000), htmlBody, htmlChecked, clean(input.preview).slice(0, 600), classification,
      clean(input.classificationSource), Number(input.classificationConfidence || 0),
      clean(input.classificationReason).slice(0, 1000), clean(input.classificationSummary).slice(0, 1500),
      JSON.stringify(input.classificationDetails || {}), clean(input.classifierModel),
      clean(input.classificationError).slice(0, 1000), classifiedAt,
      clean(input.matchMethod), clean(input.marketingJobId), clean(input.customerId), clean(input.companyName),
      clean(input.contactName), clean(input.feishuRecordId), clean(input.feishuSyncStatus),
      clean(input.feishuSyncError), now,
    );
    return { created: !existing && Number(result.changes) > 0, item: this.get(id) };
  }

  get(id) {
    const row = this.db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(clean(id));
    return row ? mapMessage(row, { includeHtml: true }) : null;
  }

  listMissingHtml({ mailbox, uidValidity, limit = 100 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.db.prepare(`
      SELECT id, uid FROM inbox_messages
      WHERE mailbox = ? AND uid_validity = ? AND html_checked = 0
      ORDER BY received_at DESC LIMIT ?
    `).all(normalizeEmail(mailbox), clean(uidValidity), safeLimit).map((row) => ({ id: row.id, uid: Number(row.uid) }));
  }

  markFeishuSync(id, { status, error = '' } = {}) {
    this.db.prepare(`
      UPDATE inbox_messages SET feishu_sync_status = ?, feishu_sync_error = ? WHERE id = ?
    `).run(clean(status), clean(error), clean(id));
    return this.get(id);
  }

  updateClassification(id, input = {}) {
    const classification = CLASSIFICATIONS.has(input.classification) ? input.classification : 'unmatched';
    const now = clean(input.classifiedAt) || new Date().toISOString();
    this.db.prepare(`
      UPDATE inbox_messages SET
        classification = ?, classification_source = ?, classification_confidence = ?,
        classification_reason = ?, classification_summary = ?, classification_details_json = ?,
        classifier_model = ?, classification_error = ?, classified_at = ?,
        feishu_sync_status = CASE WHEN feishu_record_id <> '' AND ? THEN 'pending' ELSE feishu_sync_status END,
        feishu_sync_error = CASE WHEN feishu_record_id <> '' AND ? THEN '' ELSE feishu_sync_error END
      WHERE id = ?
    `).run(
      classification, clean(input.classificationSource), Number(input.classificationConfidence || 0),
      clean(input.classificationReason).slice(0, 1000), clean(input.classificationSummary).slice(0, 1500),
      JSON.stringify(input.classificationDetails || {}), clean(input.classifierModel),
      clean(input.classificationError).slice(0, 1000), now,
      input.syncToFeishu === true ? 1 : 0, input.syncToFeishu === true ? 1 : 0, clean(id),
    );
    return this.get(id);
  }

  listPendingClassification({ limit = 100, includeFallback = false, retryBefore = '' } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const fallbackFilter = includeFallback
      ? " OR (classification_source = 'fallback' AND classified_at < ?)"
      : '';
    const values = includeFallback ? [clean(retryBefore) || new Date().toISOString()] : [];
    return this.db.prepare(`
      SELECT * FROM inbox_messages
      WHERE classification_source = ''${fallbackFilter}
      ORDER BY received_at DESC LIMIT ?
    `).all(...values, safeLimit).map((row) => mapMessage(row, { includeHtml: true }));
  }

  listPendingFeishu({ limit = 100 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.db.prepare(`
      SELECT * FROM inbox_messages
      WHERE feishu_record_id <> '' AND classification IN ('inquiry', 'potential_interest', 'ordinary_reply', 'opt_out')
        AND feishu_sync_status <> 'synced'
      ORDER BY received_at ASC LIMIT ?
    `).all(safeLimit).map(mapMessage);
  }

  getDashboard({ limit = 100, classification = '', from = '', to = '' } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const filters = [];
    const values = [];
    if (CLASSIFICATIONS.has(classification)) { filters.push('classification = ?'); values.push(classification); }
    if (clean(from)) { filters.push('received_at >= ?'); values.push(clean(from)); }
    if (clean(to)) { filters.push('received_at < ?'); values.push(clean(to)); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const summaryFilters = filters.filter((filter) => filter !== 'classification = ?');
    const summaryValues = classification && CLASSIFICATIONS.has(classification) ? values.slice(1) : values;
    const summaryWhere = summaryFilters.length ? `WHERE ${summaryFilters.join(' AND ')}` : '';
    const rows = this.db.prepare(`
      SELECT * FROM inbox_messages ${where} ORDER BY received_at DESC, uid DESC LIMIT ?
    `).all(...values, safeLimit);
    const byClassification = Object.fromEntries(this.db.prepare(`
      SELECT classification, COUNT(*) AS count FROM inbox_messages ${summaryWhere} GROUP BY classification
    `).all(...summaryValues).map((row) => [row.classification, Number(row.count)]));
    const total = Object.values(byClassification).reduce((sum, count) => sum + count, 0);
    const matched = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM inbox_messages ${summaryWhere}${summaryWhere ? ' AND' : ' WHERE'} marketing_job_id <> ''
    `).get(...summaryValues).count);
    return {
      summary: {
        total,
        inquiries: byClassification.inquiry || 0,
        potentialInterests: byClassification.potential_interest || 0,
        ordinaryReplies: byClassification.ordinary_reply || 0,
        optOuts: byClassification.opt_out || 0,
        actionable: (byClassification.inquiry || 0) + (byClassification.potential_interest || 0),
        aiClassified: Number(this.db.prepare(`
          SELECT COUNT(*) AS count FROM inbox_messages ${summaryWhere}${summaryWhere ? ' AND' : ' WHERE'} classification_source = 'mimo'
        `).get(...summaryValues).count),
        matched,
        autoReplies: byClassification.auto_reply || 0,
        bounces: byClassification.bounce || 0,
        unmatched: (byClassification.unmatched || 0) + (byClassification.unrelated || 0),
        byClassification,
      },
      items: rows.map(mapMessage),
    };
  }

  close() { this.db.close(); }
}
