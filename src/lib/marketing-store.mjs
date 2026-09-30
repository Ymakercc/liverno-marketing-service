import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ACTIVE_STATUSES = ['queued', 'retry', 'processing', 'needs_attention', 'sent'];
const EMAIL_STATUSES = ['queued', 'retry', 'processing', 'sent'];
const EXPLICIT_EXCLUSION_CODE = 'not_precise';
const ACCEPTED_PRODUCT_IMAGE_SOURCES = new Set([
  'exact_model_asset',
  'exact_model_manifest',
  'base_model_asset',
]);

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function email(value) {
  return clean(value).replace(/^mailto:/i, '').toLowerCase();
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function mapJob(row) {
  return {
    id: row.id,
    campaign: row.campaign,
    customerId: row.customer_id,
    contactId: row.contact_id,
    companyName: row.company_name,
    contactName: row.contact_name,
    email: row.email,
    country: row.country,
    timeZone: row.time_zone,
    subject: row.subject,
    htmlContent: row.html_content,
    textContent: row.text_content,
    status: row.status,
    score: Number(row.score),
    scheduledAt: row.scheduled_at,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    messageId: row.message_id,
    failureReason: row.failure_reason,
    apollo: parseJson(row.apollo_json, {}),
    draft: parseJson(row.draft_json, {}),
    writeback: parseJson(row.writeback_json, {}),
    feishuRecordId: row.feishu_record_id || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

function mapPublicJob(row) {
  const job = mapJob(row);
  return {
    id: job.id,
    campaign: job.campaign,
    customerId: job.customerId,
    contactId: job.contactId,
    companyName: job.companyName,
    contactName: job.contactName,
    email: job.email,
    country: job.country,
    timeZone: job.timeZone,
    subject: job.subject,
    status: job.status,
    score: job.score,
    scheduledAt: job.scheduledAt,
    attempts: job.attempts,
    messageId: job.messageId,
    failureReason: job.failureReason,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    sentAt: job.sentAt,
    feishuRecordId: job.feishuRecordId,
  };
}

function mapScreeningRecord(row) {
  return {
    customerId: row.customer_id,
    companyName: row.company_name,
    country: row.country,
    contactEmail: row.contact_email,
    reasonCode: row.reason_code,
    reason: row.reason,
    details: parseJson(row.details_json, {}),
    createdAt: row.created_at,
  };
}

function mapScreeningBatch(row) {
  return {
    id: row.id,
    source: row.source,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    researched: Number(row.researched),
    scanned: Number(row.scanned),
    qualified: Number(row.qualified),
    excluded: Number(row.excluded),
    pending: Number(row.pending),
    enriched: Number(row.enriched),
    companyMismatch: Number(row.company_mismatch),
    contactNotFound: Number(row.contact_not_found),
    failed: Number(row.failed),
    queuedCompanies: Number(row.queued_companies),
    queuedEmails: Number(row.queued_emails),
    contactsFound: Number(row.contacts_found),
    contactsCreated: Number(row.contacts_created),
  };
}

export class MarketingStore {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS marketing_jobs (
        id TEXT PRIMARY KEY, campaign TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
        customer_id TEXT NOT NULL, contact_id TEXT NOT NULL DEFAULT '', company_name TEXT NOT NULL,
        contact_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL, country TEXT NOT NULL DEFAULT '',
        time_zone TEXT NOT NULL DEFAULT 'UTC', subject TEXT NOT NULL, html_content TEXT NOT NULL,
        text_content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
        scheduled_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
        message_id TEXT NOT NULL DEFAULT '', failure_reason TEXT NOT NULL DEFAULT '',
        apollo_json TEXT NOT NULL DEFAULT '{}', draft_json TEXT NOT NULL DEFAULT '{}',
        writeback_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        sent_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS marketing_jobs_due_idx ON marketing_jobs(status, scheduled_at);
      CREATE INDEX IF NOT EXISTS marketing_jobs_customer_idx ON marketing_jobs(customer_id, created_at);
      CREATE INDEX IF NOT EXISTS marketing_jobs_email_idx ON marketing_jobs(email, created_at);
      CREATE INDEX IF NOT EXISTS marketing_jobs_message_idx ON marketing_jobs(message_id);
      CREATE TABLE IF NOT EXISTS marketing_suppressions (
        email TEXT PRIMARY KEY, reason TEXT NOT NULL, source TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS enrichment_runs (
        id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, company_name TEXT NOT NULL,
        status TEXT NOT NULL, confidence INTEGER NOT NULL DEFAULT 0, contact_email TEXT NOT NULL DEFAULT '',
        contact_name TEXT NOT NULL DEFAULT '', apollo_org_id TEXT NOT NULL DEFAULT '',
        apollo_person_id TEXT NOT NULL DEFAULT '', changes_json TEXT NOT NULL DEFAULT '[]',
        details_json TEXT NOT NULL DEFAULT '{}', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        feishu_record_id TEXT NOT NULL DEFAULT '', feishu_sync_status TEXT NOT NULL DEFAULT '',
        feishu_sync_error TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS enrichment_customer_idx ON enrichment_runs(customer_id, created_at);
      CREATE TABLE IF NOT EXISTS marketing_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, event TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES marketing_jobs(id)
      );
      CREATE TABLE IF NOT EXISTS marketing_exclusions (
        id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL,
        company_name TEXT NOT NULL, country TEXT NOT NULL DEFAULT '', contact_email TEXT NOT NULL DEFAULT '',
        reason_code TEXT NOT NULL, reason TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, resolved_at TEXT NOT NULL DEFAULT '', resolution TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS marketing_exclusions_created_idx ON marketing_exclusions(created_at);
      CREATE TABLE IF NOT EXISTS screening_batches (
        id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'automatic',
        started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
        researched INTEGER NOT NULL DEFAULT 0, scanned INTEGER NOT NULL DEFAULT 0,
        qualified INTEGER NOT NULL DEFAULT 0, excluded INTEGER NOT NULL DEFAULT 0,
        pending INTEGER NOT NULL DEFAULT 0, enriched INTEGER NOT NULL DEFAULT 0,
        company_mismatch INTEGER NOT NULL DEFAULT 0, contact_not_found INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0, queued_companies INTEGER NOT NULL DEFAULT 0,
        queued_emails INTEGER NOT NULL DEFAULT 0, contacts_found INTEGER NOT NULL DEFAULT 0,
        contacts_created INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS screening_batches_completed_idx ON screening_batches(completed_at);
    `);
    try {
      this.db.exec("ALTER TABLE marketing_jobs ADD COLUMN feishu_record_id TEXT NOT NULL DEFAULT ''");
    } catch (error) {
      if (!String(error.message).toLowerCase().includes('duplicate column')) throw error;
    }
    const migrations = [
      "ALTER TABLE enrichment_runs ADD COLUMN feishu_record_id TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE enrichment_runs ADD COLUMN feishu_sync_status TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE enrichment_runs ADD COLUMN feishu_sync_error TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE marketing_exclusions ADD COLUMN resolved_at TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE marketing_exclusions ADD COLUMN resolution TEXT NOT NULL DEFAULT ''",
    ];
    for (const statement of migrations) {
      try { this.db.exec(statement); }
      catch (error) {
        if (!String(error.message).toLowerCase().includes('duplicate column')) throw error;
      }
    }
    this.backfillTodayScreeningBatch();
  }

  backfillTodayScreeningBatch(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const startAt = start.toISOString();
    const existing = this.db.prepare(
      'SELECT 1 FROM screening_batches WHERE completed_at >= ? LIMIT 1',
    ).get(startAt);
    if (existing) return null;

    const runs = this.db.prepare(
      'SELECT * FROM enrichment_runs WHERE created_at >= ? ORDER BY created_at ASC',
    ).all(startAt);
    if (!runs.length) return null;

    const latestByCustomer = new Map();
    for (const run of runs) latestByCustomer.set(run.customer_id, run);
    const latestRuns = [...latestByCustomer.values()];
    const queuedRows = this.db.prepare(`
      SELECT customer_id, COUNT(*) AS emails FROM marketing_jobs
      WHERE created_at >= ? AND status IN ('queued', 'retry', 'processing', 'sent')
      GROUP BY customer_id
    `).all(startAt);
    const queuedCustomers = new Set(queuedRows.map((row) => row.customer_id));
    const precisePending = new Set(this.db.prepare(`
      SELECT DISTINCT customer_id FROM marketing_exclusions
      WHERE created_at >= ? AND reason LIKE '未排除：客户业务精准%'
    `).all(startAt).map((row) => row.customer_id));
    const excludedCustomers = new Set(this.db.prepare(`
      SELECT DISTINCT customer_id FROM marketing_exclusions
      WHERE created_at >= ? AND reason_code = ?
    `).all(startAt, EXPLICIT_EXCLUSION_CODE).map((row) => row.customer_id));
    const qualifiedCustomers = new Set([...queuedCustomers, ...precisePending]);
    let contactsFound = 0;
    let contactsCreated = 0;
    for (const run of latestRuns) {
      const details = parseJson(run.details_json, {});
      const changes = parseJson(run.changes_json, []);
      contactsFound += Number(details.contactCount || 0);
      contactsCreated += changes.filter((change) => (
        change?.entity === 'contact' && change?.field === 'create'
      )).length;
    }
    const pending = latestRuns.filter((run) => (
      !qualifiedCustomers.has(run.customer_id) && !excludedCustomers.has(run.customer_id)
    )).length;
    return this.recordScreeningBatch({
      source: 'today_backfill',
      startedAt: runs[0].created_at,
      completedAt: runs.at(-1).created_at,
      researched: latestRuns.length,
      scanned: latestRuns.length,
      qualified: [...qualifiedCustomers].filter((id) => latestByCustomer.has(id)).length,
      excluded: [...excludedCustomers].filter((id) => latestByCustomer.has(id)).length,
      pending,
      enriched: latestRuns.filter((run) => run.status === 'enriched').length,
      companyMismatch: latestRuns.filter((run) => run.status === 'company_mismatch').length,
      contactNotFound: latestRuns.filter((run) => run.status === 'contact_not_found').length,
      failed: latestRuns.filter((run) => run.status === 'failed').length,
      queuedCompanies: queuedCustomers.size,
      queuedEmails: queuedRows.reduce((sum, row) => sum + Number(row.emails || 0), 0),
      contactsFound,
      contactsCreated,
    });
  }

  recordScreeningBatch(input = {}) {
    if (Number(input.researched || 0) < 1) return null;
    const id = crypto.randomUUID();
    const completedAt = clean(input.completedAt) || new Date().toISOString();
    const startedAt = clean(input.startedAt) || completedAt;
    this.db.prepare(`
      INSERT INTO screening_batches (
        id, source, started_at, completed_at, researched, scanned, qualified, excluded,
        pending, enriched, company_mismatch, contact_not_found, failed, queued_companies,
        queued_emails, contacts_found, contacts_created
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, clean(input.source) || 'automatic', startedAt, completedAt,
      Number(input.researched) || 0, Number(input.scanned) || 0,
      Number(input.qualified) || 0, Number(input.excluded) || 0,
      Number(input.pending) || 0, Number(input.enriched) || 0,
      Number(input.companyMismatch) || 0, Number(input.contactNotFound) || 0,
      Number(input.failed) || 0, Number(input.queuedCompanies) || 0,
      Number(input.queuedEmails) || 0, Number(input.contactsFound) || 0,
      Number(input.contactsCreated) || 0,
    );
    return mapScreeningBatch(this.db.prepare('SELECT * FROM screening_batches WHERE id = ?').get(id));
  }

  getScreeningDashboard({ limit = 20, now = new Date() } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const batches = this.db.prepare(
      'SELECT * FROM screening_batches ORDER BY completed_at DESC LIMIT ?',
    ).all(safeLimit).map(mapScreeningBatch);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const todayRows = this.db.prepare(
      'SELECT * FROM screening_batches WHERE completed_at >= ? ORDER BY completed_at ASC',
    ).all(start.toISOString()).map(mapScreeningBatch);
    const fields = [
      'researched', 'scanned', 'qualified', 'excluded', 'pending', 'enriched',
      'companyMismatch', 'contactNotFound', 'failed', 'queuedCompanies',
      'queuedEmails', 'contactsFound', 'contactsCreated',
    ];
    const today = Object.fromEntries(fields.map((field) => [
      field,
      todayRows.reduce((sum, batch) => sum + Number(batch[field] || 0), 0),
    ]));
    return { today: { id: 'today', source: 'today', ...today }, batches };
  }

  suppress(recipient, reason, source = 'system') {
    const normalized = email(recipient);
    if (!normalized) return;
    this.db.prepare(`
      INSERT INTO marketing_suppressions(email, reason, source, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET reason = excluded.reason, source = excluded.source,
        created_at = excluded.created_at
    `).run(normalized, clean(reason) || 'stopped', clean(source), new Date().toISOString());
    this.db.prepare(`
      UPDATE marketing_jobs SET status = 'cancelled', failure_reason = ?, updated_at = ?
      WHERE email = ? AND status IN ('queued', 'retry')
    `).run(`Suppressed: ${clean(reason) || 'stopped'}`, new Date().toISOString(), normalized);
  }

  isSuppressed(recipient) {
    return Boolean(this.db.prepare('SELECT 1 FROM marketing_suppressions WHERE email = ?').get(email(recipient)));
  }

  canContact({ customerId, recipient, cooldownDays = 7, companyEmailLimit = 5 }) {
    const normalized = email(recipient);
    if (!normalized || this.isSuppressed(normalized)) return false;
    const cutoff = new Date(Date.now() - Number(cooldownDays) * 86_400_000).toISOString();
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
    const recentEmail = this.db.prepare(`
      SELECT 1 FROM marketing_jobs
      WHERE email = ? AND status IN (${placeholders}) AND created_at >= ? LIMIT 1
    `).get(normalized, ...ACTIVE_STATUSES, cutoff);
    if (recentEmail) return false;
    const safeCompanyEmailLimit = Math.min(Math.max(Number(companyEmailLimit) || 5, 1), 5);
    const emailPlaceholders = EMAIL_STATUSES.map(() => '?').join(',');
    const companyEmails = this.db.prepare(`
      SELECT COUNT(*) AS count FROM marketing_jobs
      WHERE customer_id = ? AND status IN (${emailPlaceholders})
    `).get(clean(customerId), ...EMAIL_STATUSES);
    return Number(companyEmails.count || 0) < safeCompanyEmailLimit;
  }

  hasRecentCustomerJob(customerId, cooldownDays = 7) {
    const cutoff = new Date(Date.now() - Number(cooldownDays) * 86_400_000).toISOString();
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
    return Boolean(this.db.prepare(`
      SELECT 1 FROM marketing_jobs WHERE customer_id = ? AND status IN (${placeholders})
      AND created_at >= ? LIMIT 1
    `).get(clean(customerId), ...ACTIVE_STATUSES, cutoff));
  }

  hasRecentCustomerActivity(customerId, cooldownDays = 7) {
    const normalizedCustomerId = clean(customerId);
    if (!normalizedCustomerId) return false;
    const cutoff = new Date(Date.now() - Number(cooldownDays) * 86_400_000).toISOString();
    const job = this.db.prepare(`
      SELECT 1 FROM marketing_jobs
      WHERE customer_id = ? AND created_at >= ? LIMIT 1
    `).get(normalizedCustomerId, cutoff);
    if (job) return true;
    return Boolean(this.db.prepare(`
      SELECT 1 FROM enrichment_runs
      WHERE customer_id = ? AND created_at >= ? LIMIT 1
    `).get(normalizedCustomerId, cutoff));
  }

  getDailyMarketingStats(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const researched = this.db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT customer_id FROM enrichment_runs WHERE created_at >= ?
        UNION
        SELECT customer_id FROM marketing_jobs WHERE created_at >= ?
      )
    `).get(start.toISOString(), start.toISOString());
    const researchedTotal = this.db.prepare(
      "SELECT COUNT(DISTINCT customer_id) AS count FROM enrichment_runs WHERE status <> 'failed'",
    ).get();
    const marketedTotal = this.db.prepare(
      "SELECT COUNT(DISTINCT customer_id) AS count FROM marketing_jobs WHERE status = 'sent'",
    ).get();
    const apolloAudit = this.db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(CASE
          WHEN feishu_sync_status = 'synced' AND feishu_record_id <> '' THEN 1
          ELSE 0
        END) AS synced
      FROM enrichment_runs WHERE created_at >= ?
    `).get(start.toISOString());
    const marketed = this.db.prepare(`
      SELECT COUNT(*) AS count FROM (
        SELECT customer_id FROM marketing_jobs
        WHERE created_at >= ? AND status IN ('queued', 'retry', 'processing', 'sent')
        GROUP BY customer_id
      )
    `).get(start.toISOString());
    const emailsAllocated = this.db.prepare(`
      SELECT COUNT(*) AS count FROM marketing_jobs
      WHERE created_at >= ? AND status IN ('queued', 'retry', 'processing', 'sent')
    `).get(start.toISOString());
    const emailsSent = this.db.prepare(`
      SELECT COUNT(*) AS count FROM marketing_jobs
      WHERE sent_at >= ? AND status = 'sent'
    `).get(start.toISOString());
    const excluded = this.db.prepare(`
      SELECT COUNT(DISTINCT customer_id) AS companies, COUNT(*) AS records
      FROM marketing_exclusions
      WHERE created_at >= ? AND resolved_at = '' AND reason_code = ?
    `).get(start.toISOString(), EXPLICIT_EXCLUSION_CODE);
    const pending = this.db.prepare(`
      SELECT COUNT(DISTINCT customer_id) AS companies, COUNT(*) AS records
      FROM marketing_exclusions
      WHERE created_at >= ? AND resolved_at = '' AND reason_code <> ?
    `).get(start.toISOString(), EXPLICIT_EXCLUSION_CODE);
    return {
      companiesPreparedToday: Number(researched.count || 0),
      companiesResearchedTotal: Number(researchedTotal.count || 0),
      companiesMarketedTotal: Number(marketedTotal.count || 0),
      apolloResearchToday: Number(apolloAudit.total || 0),
      feishuResearchRecordedToday: Number(apolloAudit.synced || 0),
      companiesMarketedToday: Number(marketed.count || 0),
      emailsAllocatedToday: Number(emailsAllocated.count || 0),
      emailsSentToday: Number(emailsSent.count || 0),
      excludedCompaniesToday: Number(excluded.companies || 0),
      excludedToday: Number(excluded.records || 0),
      pendingCompaniesToday: Number(pending.companies || 0),
      pendingToday: Number(pending.records || 0),
    };
  }

  getSentSummary({ from = '', to = '', campaign = '' } = {}) {
    const filters = ["status = 'sent'", "sent_at <> ''"];
    const values = [];
    const selectedCampaign = clean(campaign);
    if (selectedCampaign && selectedCampaign !== 'all') {
      filters.push('campaign = ?');
      values.push(selectedCampaign);
    }
    if (clean(from)) {
      filters.push('sent_at >= ?');
      values.push(clean(from));
    }
    if (clean(to)) {
      filters.push('sent_at < ?');
      values.push(clean(to));
    }
    const row = this.db.prepare(`
      SELECT COUNT(*) AS emails, COUNT(DISTINCT customer_id) AS companies,
        MIN(sent_at) AS first_sent_at, MAX(sent_at) AS last_sent_at
      FROM marketing_jobs WHERE ${filters.join(' AND ')}
    `).get(...values);
    return {
      emails: Number(row.emails || 0),
      companies: Number(row.companies || 0),
      firstSentAt: row.first_sent_at || '',
      lastSentAt: row.last_sent_at || '',
    };
  }

  recordExclusion({
    customerId,
    companyName,
    country = '',
    contactEmail = '',
    reasonCode,
    reason,
    details = {},
    createdAt = new Date().toISOString(),
  }) {
    const normalizedCreatedAt = new Date(createdAt).toISOString();
    const date = normalizedCreatedAt.slice(0, 10);
    const dedupeKey = crypto.createHash('sha256')
      .update([date, clean(customerId), clean(contactEmail).toLowerCase(), clean(reasonCode)].join('|'))
      .digest('hex');
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO marketing_exclusions (
        id, dedupe_key, customer_id, company_name, country, contact_email,
        reason_code, reason, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        company_name = excluded.company_name,
        country = excluded.country,
        reason = excluded.reason,
        details_json = excluded.details_json,
        resolved_at = '',
        resolution = ''
    `).run(
      id, dedupeKey, clean(customerId), clean(companyName), clean(country), email(contactEmail),
      clean(reasonCode), clean(reason), JSON.stringify(details || {}), normalizedCreatedAt,
    );
    return { id, createdAt: normalizedCreatedAt, dedupeKey };
  }

  getCustomerJobSummary(customerId) {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status IN ('queued', 'retry', 'processing', 'sent') THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent
      FROM marketing_jobs WHERE customer_id = ?
    `).get(clean(customerId));
    return {
      total: Number(row.total || 0),
      active: Number(row.active || 0),
      sent: Number(row.sent || 0),
    };
  }

  resolveCompanyExclusions(customerId, resolution = '公司重新核验为精准客户') {
    const resolvedAt = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE marketing_exclusions SET resolved_at = ?, resolution = ?
      WHERE customer_id = ? AND resolved_at = ''
    `).run(resolvedAt, clean(resolution), clean(customerId));
    return { resolved: Number(result.changes || 0), resolvedAt };
  }

  enqueue(input) {
    const now = new Date().toISOString();
    const campaign = clean(input.campaign) || 'initial_outreach_v1';
    const normalizedEmail = email(input.email);
    const dedupeKey = crypto.createHash('sha256')
      .update([campaign, clean(input.customerId), normalizedEmail].join('|')).digest('hex');
    const existing = this.db.prepare('SELECT * FROM marketing_jobs WHERE dedupe_key = ?').get(dedupeKey);
    if (existing) return { created: false, job: mapJob(existing) };
    const id = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO marketing_jobs (
        id, campaign, dedupe_key, customer_id, contact_id, company_name, contact_name, email,
        country, time_zone, subject, html_content, text_content, status, score, scheduled_at,
        max_attempts, apollo_json, draft_json, writeback_json, feishu_record_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, campaign, dedupeKey, clean(input.customerId), clean(input.contactId), clean(input.companyName),
      clean(input.contactName), normalizedEmail, clean(input.country), clean(input.timeZone) || 'UTC',
      clean(input.subject), clean(input.htmlContent), clean(input.textContent), clean(input.status) || 'queued',
      Number(input.score) || 0, clean(input.scheduledAt) || now, Number(input.maxAttempts) || 3,
      JSON.stringify(input.apollo || {}), JSON.stringify(input.draft || {}),
      JSON.stringify(input.writeback || {}), clean(input.feishuRecordId), now, now,
    );
    this.addEvent(id, 'queued', `Scheduled for ${clean(input.scheduledAt) || now}`);
    return { created: true, job: this.getJob(id) };
  }

  getJob(id) {
    const row = this.db.prepare('SELECT * FROM marketing_jobs WHERE id = ?').get(clean(id));
    return row ? mapJob(row) : null;
  }

  findJobByMessageId(messageId) {
    const normalizedMessageId = clean(messageId);
    if (!normalizedMessageId) return null;
    const row = this.db.prepare(`
      SELECT * FROM marketing_jobs
      WHERE message_id = ?
      ORDER BY sent_at DESC LIMIT 1
    `).get(normalizedMessageId);
    return row ? mapJob(row) : null;
  }

  findSentJobForInbound({ messageIds = [], senderEmail = '' } = {}) {
    const references = [...new Set(messageIds.map(clean).filter(Boolean))];
    if (references.length) {
      const placeholders = references.map(() => '?').join(',');
      const row = this.db.prepare(`
        SELECT * FROM marketing_jobs
        WHERE message_id IN (${placeholders}) AND status = 'sent'
        ORDER BY sent_at DESC LIMIT 1
      `).get(...references);
      if (row) return { job: mapJob(row), method: 'reply_header' };
    }
    const normalizedEmail = email(senderEmail);
    if (!normalizedEmail) return null;
    const row = this.db.prepare(`
      SELECT * FROM marketing_jobs
      WHERE email = ? AND status = 'sent'
      ORDER BY sent_at DESC LIMIT 1
    `).get(normalizedEmail);
    return row ? { job: mapJob(row), method: 'sender_email' } : null;
  }

  findLatestJob({ customerId, recipient }) {
    const normalizedEmail = email(recipient);
    const row = this.db.prepare(`
      SELECT * FROM marketing_jobs
      WHERE customer_id = ? AND email = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(clean(customerId), normalizedEmail);
    return row ? mapJob(row) : null;
  }

  findCampaignJob({ campaign, customerId, recipient }) {
    const normalizedEmail = email(recipient);
    const row = this.db.prepare(`
      SELECT * FROM marketing_jobs
      WHERE campaign = ? AND customer_id = ? AND email = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(clean(campaign), clean(customerId), normalizedEmail);
    return row ? mapJob(row) : null;
  }

  getCampaignSummary(campaign) {
    const byStatus = Object.fromEntries(this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM marketing_jobs
      WHERE campaign = ? GROUP BY status
    `).all(clean(campaign)).map((row) => [row.status, Number(row.count)]));
    return {
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      queued: (byStatus.queued || 0) + (byStatus.retry || 0) + (byStatus.processing || 0),
      sent: byStatus.sent || 0,
      failed: (byStatus.failed || 0) + (byStatus.cancelled || 0) + (byStatus.needs_attention || 0),
      byStatus,
    };
  }

  attachFeishuRecord(id, { recordId, subject, htmlContent, textContent, scheduledAt, status = 'queued' } = {}) {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE marketing_jobs SET feishu_record_id = ?, subject = ?, html_content = ?, text_content = ?,
        status = ?, scheduled_at = ?, failure_reason = '', updated_at = ?
      WHERE id = ?
    `).run(
      clean(recordId), clean(subject), clean(htmlContent), clean(textContent), clean(status) || 'queued',
      clean(scheduledAt) || now, now, clean(id),
    );
    this.addEvent(id, 'feishu_record_attached', clean(recordId));
    return this.getJob(id);
  }

  updateQueuedContent(id, { subject, htmlContent, textContent, draft } = {}) {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE marketing_jobs SET subject = ?, html_content = ?, text_content = ?, draft_json = ?, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'retry')
    `).run(
      clean(subject), clean(htmlContent), clean(textContent), JSON.stringify(draft || {}), now, clean(id),
    );
    if (Number(result.changes) > 0) this.addEvent(id, 'content_refreshed', 'Queued email rebuilt from current pricing');
    return Number(result.changes) > 0 ? this.getJob(id) : null;
  }

  relinkCompanyFeishuRecord(customerId, recordId) {
    const id = clean(customerId);
    const target = clean(recordId);
    if (!id || !target) return { jobs: 0, enrichments: 0 };
    const jobs = this.db.prepare(`
      UPDATE marketing_jobs SET feishu_record_id = ?, updated_at = ? WHERE customer_id = ?
    `).run(target, new Date().toISOString(), id);
    const enrichments = this.db.prepare(`
      UPDATE enrichment_runs SET feishu_record_id = ?, feishu_sync_status = 'synced', feishu_sync_error = ''
      WHERE customer_id = ?
    `).run(target, id);
    return { jobs: Number(jobs.changes || 0), enrichments: Number(enrichments.changes || 0) };
  }

  addEvent(jobId, event, detail = '') {
    this.db.prepare('INSERT INTO marketing_events(job_id, event, detail, created_at) VALUES (?, ?, ?, ?)')
      .run(clean(jobId), clean(event), clean(detail), new Date().toISOString());
  }

  reserveDue({ limit = 10, dailyLimit = 10, now = new Date(), isEligible = () => true } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const sentToday = Number(this.db.prepare(
      "SELECT COUNT(*) AS count FROM marketing_jobs WHERE status = 'sent' AND sent_at >= ?",
    ).get(start.toISOString()).count);
    const available = Math.max(Math.min(safeLimit, Number(dailyLimit) - sentToday), 0);
    if (!available) return [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const candidates = this.db.prepare(`
        SELECT j.* FROM marketing_jobs j
        LEFT JOIN marketing_suppressions s ON s.email = j.email
        WHERE j.status IN ('queued', 'retry') AND j.scheduled_at <= ? AND s.email IS NULL
        ORDER BY
          CASE WHEN j.campaign = 'second_touch_v1' THEN 0 ELSE 1 END ASC,
          j.scheduled_at ASC,
          j.created_at ASC
        LIMIT 10000
      `).all(now.toISOString());
      const rows = candidates.filter((row) => isEligible(mapJob(row))).slice(0, available);
      const update = this.db.prepare(
        "UPDATE marketing_jobs SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?",
      );
      for (const row of rows) update.run(new Date().toISOString(), row.id);
      this.db.exec('COMMIT');
      return rows.map((row) => mapJob({ ...row, status: 'processing', attempts: Number(row.attempts) + 1 }));
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  markSent(id, messageId, sentAt = new Date().toISOString()) {
    this.db.prepare(`
      UPDATE marketing_jobs SET status = 'sent', message_id = ?, sent_at = ?, failure_reason = '', updated_at = ?
      WHERE id = ?
    `).run(clean(messageId), sentAt, sentAt, clean(id));
    this.addEvent(id, 'sent', messageId);
    return this.getJob(id);
  }

  deferJob(
    id,
    reason,
    scheduledAt = new Date(Date.now() + 15 * 60_000).toISOString(),
    { restoreAttempt = false } = {},
  ) {
    this.db.prepare(`
      UPDATE marketing_jobs SET status = 'queued', failure_reason = ?, scheduled_at = ?,
        attempts = CASE WHEN ? = 1 AND attempts > 0 THEN attempts - 1 ELSE attempts END,
        updated_at = ?
      WHERE id = ?
    `).run(clean(reason), scheduledAt, restoreAttempt ? 1 : 0, new Date().toISOString(), clean(id));
    this.addEvent(id, 'deferred', clean(reason));
    return this.getJob(id);
  }

  recoverBrevoAuthFailures(now = new Date()) {
    const scheduledAt = now.toISOString();
    const rows = this.db.prepare(`
      SELECT id FROM marketing_jobs
      WHERE status IN ('failed', 'retry')
        AND (failure_reason LIKE '%Brevo%HTTP 401%' OR failure_reason LIKE '%Brevo%HTTP 403%')
    `).all();
    if (!rows.length) return 0;
    const update = this.db.prepare(`
      UPDATE marketing_jobs SET status = 'queued', attempts = 0, failure_reason = '',
        scheduled_at = ?, updated_at = ? WHERE id = ?
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) update.run(scheduledAt, scheduledAt, row.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    for (const row of rows) this.addEvent(row.id, 'provider_access_recovered', 'Brevo authorization restored');
    return rows.length;
  }

  markFailed(id, error, { retryDelayMinutes = 30 } = {}) {
    const job = this.getJob(id);
    if (!job) return null;
    const retry = job.attempts < job.maxAttempts;
    const scheduledAt = retry
      ? new Date(Date.now() + Number(retryDelayMinutes) * 60_000).toISOString()
      : job.scheduledAt;
    this.db.prepare(`
      UPDATE marketing_jobs SET status = ?, failure_reason = ?, scheduled_at = ?, updated_at = ? WHERE id = ?
    `).run(retry ? 'retry' : 'failed', clean(error?.message || error), scheduledAt, new Date().toISOString(), clean(id));
    this.addEvent(id, retry ? 'retry' : 'failed', clean(error?.message || error));
    return this.getJob(id);
  }

  markCancelled(id, reason) {
    this.db.prepare(`
      UPDATE marketing_jobs SET status = 'cancelled', failure_reason = ?, updated_at = ? WHERE id = ?
    `).run(clean(reason), new Date().toISOString(), clean(id));
    this.addEvent(id, 'cancelled', clean(reason));
    return this.getJob(id);
  }

  cancelJobsMissingExactProductImages(reason = '邮件任务缺少具体型号产品图，已取消。') {
    const rows = this.db.prepare(
      "SELECT id, draft_json FROM marketing_jobs WHERE status IN ('queued', 'retry')",
    ).all();
    const invalidIds = rows.filter((row) => {
      const draft = parseJson(row.draft_json, {});
      const products = draft?.pricing?.products;
      return !Array.isArray(products) || !products.length || products.some((product) => (
        !product.imageAvailable || !ACCEPTED_PRODUCT_IMAGE_SOURCES.has(product.imageSource)
      ));
    }).map((row) => row.id);
    const now = new Date().toISOString();
    for (const id of invalidIds) {
      this.db.prepare(
        "UPDATE marketing_jobs SET status = 'cancelled', failure_reason = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'retry')",
      ).run(clean(reason), now, id);
      this.addEvent(id, 'cancelled', clean(reason));
    }
    return invalidIds.length;
  }

  recoverImageReadyCancelledJobs(reason = '邮件任务缺少具体型号产品图，已取消。') {
    const rows = this.db.prepare(`
      SELECT id, draft_json FROM marketing_jobs
      WHERE status = 'cancelled' AND failure_reason = ?
    `).all(clean(reason));
    const validIds = rows.filter((row) => {
      const products = parseJson(row.draft_json, {})?.pricing?.products;
      return Array.isArray(products) && products.length && products.every((product) => (
        product.imageAvailable && ACCEPTED_PRODUCT_IMAGE_SOURCES.has(product.imageSource)
      ));
    }).map((row) => row.id);
    const now = new Date().toISOString();
    for (const id of validIds) {
      this.db.prepare(`
        UPDATE marketing_jobs SET status = 'queued', failure_reason = '', updated_at = ?
        WHERE id = ? AND status = 'cancelled'
      `).run(now, id);
      this.addEvent(id, 'restored', '产品图片来源已通过新版校验，恢复排队');
    }
    return validIds.length;
  }

  recordEnrichment(input) {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO enrichment_runs (
        id, customer_id, company_name, status, confidence, contact_email, contact_name,
        apollo_org_id, apollo_person_id, changes_json, details_json, error, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, clean(input.customerId), clean(input.companyName), clean(input.status), Number(input.confidence) || 0,
      email(input.contactEmail), clean(input.contactName), clean(input.apolloOrgId), clean(input.apolloPersonId),
      JSON.stringify(input.changes || []), JSON.stringify(input.details || {}), clean(input.error), createdAt,
    );
    return { id, createdAt };
  }

  attachEnrichmentFeishuRecord(runId, { recordId = '', status = 'synced', error = '' } = {}) {
    this.db.prepare(`
      UPDATE enrichment_runs
      SET feishu_record_id = ?, feishu_sync_status = ?, feishu_sync_error = ?
      WHERE id = ?
    `).run(clean(recordId), clean(status), clean(error), clean(runId));
  }

  listEnrichmentRunsSince(since) {
    return this.db.prepare(`
      SELECT * FROM enrichment_runs WHERE created_at >= ? ORDER BY created_at DESC
    `).all(clean(since)).map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      companyName: row.company_name,
      status: row.status,
      confidence: Number(row.confidence),
      contactEmail: row.contact_email,
      contactName: row.contact_name,
      apolloOrgId: row.apollo_org_id,
      apolloPersonId: row.apollo_person_id,
      changes: parseJson(row.changes_json, []),
      details: parseJson(row.details_json, {}),
      error: row.error,
      createdAt: row.created_at,
      feishuRecordId: row.feishu_record_id || '',
      feishuSyncStatus: row.feishu_sync_status || '',
      feishuSyncError: row.feishu_sync_error || '',
    }));
  }

  listIncompleteEnrichmentAudits({ limit = 100 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.db.prepare(`
      SELECT * FROM enrichment_runs
      WHERE feishu_record_id <> '' AND feishu_sync_status <> 'synced'
      ORDER BY created_at ASC LIMIT ?
    `).all(safeLimit).map((row) => ({
      id: row.id,
      customerId: row.customer_id,
      companyName: row.company_name,
      status: row.status,
      confidence: Number(row.confidence),
      contactEmail: row.contact_email,
      contactName: row.contact_name,
      apolloOrgId: row.apollo_org_id,
      apolloPersonId: row.apollo_person_id,
      changes: parseJson(row.changes_json, []),
      details: parseJson(row.details_json, {}),
      error: row.error,
      createdAt: row.created_at,
      feishuRecordId: row.feishu_record_id || '',
      feishuSyncStatus: row.feishu_sync_status || '',
      feishuSyncError: row.feishu_sync_error || '',
    }));
  }

  getDashboard({ limit = 100, status = '' } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const rows = status
      ? this.db.prepare('SELECT * FROM marketing_jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?').all(clean(status), safeLimit)
      : this.db.prepare('SELECT * FROM marketing_jobs ORDER BY updated_at DESC LIMIT ?').all(safeLimit);
    const byStatus = Object.fromEntries(this.db.prepare(
      'SELECT status, COUNT(*) AS count FROM marketing_jobs GROUP BY status',
    ).all().map((row) => [row.status, Number(row.count)]));
    const enrichments = this.db.prepare(
      'SELECT * FROM enrichment_runs ORDER BY created_at DESC LIMIT ?',
    ).all(Math.min(safeLimit, 100)).map((row) => ({
      id: row.id, customerId: row.customer_id, companyName: row.company_name, status: row.status,
      confidence: Number(row.confidence), contactEmail: row.contact_email, contactName: row.contact_name,
      changes: parseJson(row.changes_json, []), error: row.error, createdAt: row.created_at,
    }));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const exclusions = this.db.prepare(`
      SELECT customer_id, company_name, country, contact_email, reason_code, reason, details_json, created_at
      FROM marketing_exclusions
      WHERE created_at >= ? AND resolved_at = '' AND reason_code = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(start.toISOString(), EXPLICIT_EXCLUSION_CODE, Math.min(safeLimit, 200)).map(mapScreeningRecord);
    const pending = this.db.prepare(`
      SELECT customer_id, company_name, country, contact_email, reason_code, reason, details_json, created_at
      FROM marketing_exclusions
      WHERE created_at >= ? AND resolved_at = '' AND reason_code <> ?
      ORDER BY created_at DESC LIMIT ?
    `).all(start.toISOString(), EXPLICIT_EXCLUSION_CODE, Math.min(safeLimit, 200)).map(mapScreeningRecord);
    const excludedToday = this.db.prepare(
      "SELECT COUNT(DISTINCT customer_id) AS count FROM marketing_exclusions WHERE created_at >= ? AND resolved_at = '' AND reason_code = ?",
    ).get(start.toISOString(), EXPLICIT_EXCLUSION_CODE);
    const pendingToday = this.db.prepare(
      "SELECT COUNT(DISTINCT customer_id) AS count FROM marketing_exclusions WHERE created_at >= ? AND resolved_at = '' AND reason_code <> ?",
    ).get(start.toISOString(), EXPLICIT_EXCLUSION_CODE);
    return {
      summary: {
        total: Number(this.db.prepare('SELECT COUNT(*) AS count FROM marketing_jobs').get().count),
        queued: (byStatus.queued || 0) + (byStatus.retry || 0),
        sent: byStatus.sent || 0,
        failed: byStatus.failed || 0,
        suppressed: Number(this.db.prepare('SELECT COUNT(*) AS count FROM marketing_suppressions').get().count),
        enriched: Number(this.db.prepare("SELECT COUNT(*) AS count FROM enrichment_runs WHERE status = 'enriched'").get().count),
        excludedToday: Number(excludedToday.count || 0),
        pendingToday: Number(pendingToday.count || 0),
        byStatus,
      },
      items: rows.map(mapPublicJob),
      enrichments,
      exclusions,
      pending,
    };
  }

  listSentJobs({ limit = 50_000 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50_000, 1), 50_000);
    return this.db.prepare(`
      SELECT * FROM marketing_jobs
      WHERE status = 'sent' AND message_id <> '' AND sent_at <> ''
      ORDER BY sent_at DESC LIMIT ?
    `).all(safeLimit).map(mapPublicJob);
  }

  close() { this.db.close(); }
}
