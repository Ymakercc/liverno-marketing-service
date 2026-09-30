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
  };
}

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
