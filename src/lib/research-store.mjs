import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    domain: row.domain,
    candidate_name: row.candidate_name,
    evidence_url: row.evidence_url,
    discovered_at: row.discovered_at,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    failure_reason: row.failure_reason,
    company: row.apollo_organization_id ? {
      candidate_name: row.candidate_name,
      apollo_organization_id: row.apollo_organization_id,
      apollo_name: row.apollo_name,
      domain: row.apollo_domain,
      match_score: row.match_score,
      match_evidence: parseJson(row.match_evidence_json, {}),
      country: row.country,
      industry: row.industry,
      employee_count: row.employee_count,
      linkedin_url: row.linkedin_url,
    } : null,
    contacts: parseJson(row.contacts_json, []),
    apollo_calls: parseJson(row.apollo_calls_json, {}),
    website_research: {
      status: row.website_status || 'not_started',
      final_url: row.website_final_url || '',
      title: row.website_title || '',
      description: row.website_description || '',
      keywords: row.website_keywords || '',
      text: row.website_text || '',
      signals: parseJson(row.website_signals_json, {}),
      error: row.website_error || '',
    },
    qualification: {
      status: row.qualification_status || 'not_started',
      qualified: row.qualification_qualified === null ? null : Boolean(row.qualification_qualified),
      review_required: row.qualification_review_required === null ? null : Boolean(row.qualification_review_required),
      reason: row.qualification_reason || '',
      reason_code: row.qualification_reason_code || '',
      country: row.qualification_country || '',
      region: row.qualification_region || '',
      industry: row.qualification_industry || '',
      customer_type: row.qualification_customer_type || '',
      customer_profile: row.qualification_customer_profile || '',
      pain_points: parseJson(row.qualification_pain_points_json, []),
      recommended_products: parseJson(row.qualification_recommended_products_json, []),
      risk_flags: parseJson(row.qualification_risk_flags_json, []),
      started_at: row.qualification_started_at || null,
      finished_at: row.qualification_finished_at || null,
      failure_reason: row.qualification_failure_reason || '',
    },
  };
}

const C1_COLUMNS = {
  website_status: "TEXT NOT NULL DEFAULT 'not_started'",
  website_final_url: 'TEXT', website_title: 'TEXT', website_description: 'TEXT',
  website_keywords: 'TEXT', website_text: 'TEXT', website_signals_json: 'TEXT',
  website_error: 'TEXT',
  qualification_status: "TEXT NOT NULL DEFAULT 'not_started'",
  qualification_qualified: 'INTEGER', qualification_review_required: 'INTEGER',
  qualification_reason: 'TEXT', qualification_reason_code: 'TEXT',
  qualification_country: 'TEXT', qualification_region: 'TEXT',
  qualification_industry: 'TEXT', qualification_customer_type: 'TEXT',
  qualification_customer_profile: 'TEXT', qualification_pain_points_json: 'TEXT',
  qualification_recommended_products_json: 'TEXT', qualification_risk_flags_json: 'TEXT',
  qualification_started_at: 'TEXT', qualification_finished_at: 'TEXT',
  qualification_failure_reason: 'TEXT',
};

export class ResearchStore {
  constructor({ databasePath }) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_records (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        domain TEXT NOT NULL,
        candidate_name TEXT NOT NULL,
        evidence_url TEXT NOT NULL,
        discovered_at TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        failure_reason TEXT,
        apollo_organization_id TEXT,
        apollo_name TEXT,
        apollo_domain TEXT,
        match_score INTEGER,
        match_evidence_json TEXT NOT NULL DEFAULT '{}',
        country TEXT,
        industry TEXT,
        employee_count INTEGER,
        linkedin_url TEXT,
        contacts_json TEXT NOT NULL DEFAULT '[]',
        apollo_calls_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source, source_id)
      );
    `);
    const existing = new Set(this.db.prepare('PRAGMA table_info(research_records)').all().map((column) => column.name));
    for (const [name, definition] of Object.entries(C1_COLUMNS)) {
      if (!existing.has(name)) this.db.exec(`ALTER TABLE research_records ADD COLUMN ${name} ${definition}`);
    }
  }

  create(input) {
    const id = crypto.randomUUID();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO research_records
        (id, source, source_id, domain, candidate_name, evidence_url, discovered_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'received')
    `).run(id, input.source, input.source_id, input.domain, input.candidate_name,
      input.evidence_url, input.discovered_at);
    return {
      created: result.changes === 1,
      record: result.changes === 1 ? this.get(id) : this.getBySource(input.source, input.source_id),
    };
  }

  get(id) {
    return mapRecord(this.db.prepare('SELECT * FROM research_records WHERE id = ?').get(id));
  }

  getBySource(source, sourceId) {
    return mapRecord(this.db.prepare(
      'SELECT * FROM research_records WHERE source = ? AND source_id = ?'
    ).get(source, sourceId));
  }

  claimQualification(id) {
    return this.db.prepare(`
      UPDATE research_records SET qualification_status = 'researching_website',
        qualification_started_at = ?
      WHERE id = ? AND status IN ('completed', 'no_contact')
        AND qualification_status = 'not_started'
    `).run(new Date().toISOString(), id).changes === 1;
  }

  saveWebsiteEvidence(id, evidence) {
    this.db.prepare(`
      UPDATE research_records SET website_status = ?, website_final_url = ?,
        website_title = ?, website_description = ?, website_keywords = ?,
        website_text = ?, website_signals_json = ?, website_error = ?
      WHERE id = ? AND qualification_status = 'researching_website'
    `).run(evidence.status, evidence.finalUrl || '', evidence.title || '',
      evidence.description || '', evidence.keywords || '', evidence.text || '',
      JSON.stringify(evidence.signals || {}), evidence.error || '', id);
  }

  markQualifying(id) {
    this.db.prepare(`
      UPDATE research_records SET qualification_status = 'qualifying'
      WHERE id = ? AND qualification_status = 'researching_website'
    `).run(id);
  }

  finishQualification(id, result) {
    this.db.prepare(`
      UPDATE research_records SET qualification_status = ?, qualification_qualified = ?,
        qualification_review_required = ?, qualification_reason = ?, qualification_reason_code = ?,
        qualification_country = ?, qualification_region = ?, qualification_industry = ?,
        qualification_customer_type = ?, qualification_customer_profile = ?,
        qualification_pain_points_json = ?, qualification_recommended_products_json = ?,
        qualification_risk_flags_json = ?, qualification_finished_at = ?
      WHERE id = ? AND qualification_status IN ('researching_website', 'qualifying')
    `).run(result.status, result.qualified === null ? null : Number(result.qualified),
      Number(result.reviewRequired), result.reason || '', result.reasonCode || '',
      result.country || '', result.region || '', result.industry || '',
      result.customerType || '', result.customerProfile || '',
      JSON.stringify(result.painPoints || []), JSON.stringify(result.recommendedProducts || []),
      JSON.stringify(result.riskFlags || []), new Date().toISOString(), id);
    return this.get(id);
  }

  failQualification(id, reason) {
    this.db.prepare(`
      UPDATE research_records SET qualification_status = 'failed',
        qualification_failure_reason = ?, qualification_finished_at = ?
      WHERE id = ? AND qualification_status IN ('researching_website', 'qualifying')
    `).run(reason, new Date().toISOString(), id);
    return this.get(id);
  }

  start(id) {
    this.db.prepare(`
      UPDATE research_records SET status = 'researching', started_at = ?
      WHERE id = ? AND status = 'received'
    `).run(new Date().toISOString(), id);
  }

  markCompanyMatched(id, organization, matchScore, matchEvidence, calls) {
    this.db.prepare(`
      UPDATE research_records SET
        status = 'company_matched', apollo_organization_id = ?, apollo_name = ?,
        apollo_domain = ?, match_score = ?, match_evidence_json = ?,
        country = ?, industry = ?, employee_count = ?, linkedin_url = ?,
        apollo_calls_json = ?
      WHERE id = ? AND status = 'researching'
    `).run(organization.id, organization.name, organization.domain, matchScore,
      JSON.stringify(matchEvidence), organization.country || null, organization.industry || null,
      organization.employeeCount || null, organization.linkedinUrl || null, JSON.stringify(calls), id);
    return this.get(id);
  }

  finish(id, { status, organization = null, matchScore = null, matchEvidence = null,
    contacts = [], calls = {}, failureReason = null }) {
    const statement = this.db.prepare(`
      UPDATE research_records SET
        status = ?, finished_at = ?, failure_reason = ?,
        apollo_organization_id = COALESCE(?, apollo_organization_id),
        apollo_name = COALESCE(?, apollo_name), apollo_domain = COALESCE(?, apollo_domain),
        match_score = COALESCE(?, match_score),
        match_evidence_json = COALESCE(?, match_evidence_json),
        country = COALESCE(?, country), industry = COALESCE(?, industry),
        employee_count = COALESCE(?, employee_count),
        linkedin_url = COALESCE(?, linkedin_url),
        contacts_json = ?, apollo_calls_json = ?
      WHERE id = ? AND status IN ('researching', 'company_matched')
    `);
    statement.run(status, new Date().toISOString(), failureReason,
      organization?.id || null, organization?.name || null, organization?.domain || null,
      matchScore, matchEvidence === null ? null : JSON.stringify(matchEvidence),
      organization?.country || null,
      organization?.industry || null, organization?.employeeCount || null,
      organization?.linkedinUrl || null, JSON.stringify(contacts), JSON.stringify(calls), id);
    return this.get(id);
  }

  close() {
    this.db.close();
  }
}
