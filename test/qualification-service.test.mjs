import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ResearchStore } from '../src/lib/research-store.mjs';
import { QualificationService } from '../src/services/qualification-service.mjs';

const goodEvidence = {
  status: 'fetched', finalUrl: 'https://example.co.uk/', title: 'Industrial controls',
  description: 'Industrial power systems', keywords: 'automation',
  text: 'Industrial controls, power supply integration and automation equipment. '.repeat(4),
  signals: { meanWellMentioned: true, matchedTerms: ['power supply'], directFit: true },
};
const goodDecision = {
  qualified: true, reviewRequired: false, qualificationReason: 'Industrial power systems fit.',
  country: 'United Kingdom', region: 'Europe', industry: 'Automation',
  customerType: 'distributor', customerProfile: 'Industrial controls supplier',
  painPoints: ['lead time'], recommendedProducts: [{ name: 'HDR', reason: 'DIN rail' }], riskFlags: [],
};

function fixture(t, { researchStatus = 'completed', livernoDomain = 'shop.example.co.uk',
  apolloDomain = 'example.co.uk', candidateName = 'Candidate catalog title',
  apolloName = 'Example Controls', evidence = goodEvidence, decision = goodDecision } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualification-'));
  const store = new ResearchStore({ databasePath: path.join(dir, 'research.sqlite') });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const created = store.create({
    source: 'liverno', source_id: '11111111-1111-4111-8111-111111111111',
    domain: livernoDomain, candidate_name: candidateName,
    evidence_url: `https://${livernoDomain}/products`, discovered_at: '2026-09-29T12:00:00Z',
  }).record;
  store.start(created.id);
  if (researchStatus === 'failed' || researchStatus === 'company_not_found') {
    store.finish(created.id, { status: researchStatus });
  } else {
    store.markCompanyMatched(created.id, {
      id: 'org-1', name: apolloName, domain: apolloDomain,
      country: 'United Kingdom', industry: 'Automation', employeeCount: 40,
    }, 95, { domain_exact: true }, {});
    store.finish(created.id, {
      status: researchStatus, contacts: [{ person_id: 'person-1', title: 'Buyer',
        email_status: 'verified', has_email: true }],
    });
  }
  const calls = { website: [], ai: [] };
  const service = new QualificationService({
    store,
    websiteResearch: async (domain) => { calls.website.push(domain); return evidence; },
    openai: { qualifyCompany: async (request) => { calls.ai.push(request); return decision; },
      createOutboundDraft: () => { throw new Error('Outbound draft must never run'); } },
  });
  return { service, store, id: created.id, calls };
}

test('completed Research qualifies via the Apollo root domain and persists minimal result', async (t) => {
  const { service, store, id, calls } = fixture(t);
  const record = await service.qualify(id);
  assert.equal(record.status, 'completed');
  assert.equal(record.qualification.status, 'qualified');
  assert.equal(record.qualification.qualified, true);
  assert.equal(record.website_research.text, goodEvidence.text);
  assert.deepEqual(calls.website, ['example.co.uk']);
  assert.equal(calls.ai.length, 1);
  assert.equal(calls.ai[0].researchId, id);
  assert.deepEqual(JSON.parse(calls.ai[0].input).contacts, {
    hasTargetContact: true, titles: ['Buyer'],
  });
  assert.equal(JSON.stringify(calls.ai[0]).includes('person-1'), false);
  assert.equal(JSON.stringify(record).includes('emailBody'), false);
  assert.equal(JSON.stringify(record).includes('emailSubject'), false);
  assert.equal(store.get(id).qualification.status, 'qualified');
  const repeated = await service.qualify(id);
  assert.deepEqual(repeated, record);
  assert.equal(calls.website.length, 1);
  assert.equal(calls.ai.length, 1);
});

test('no_contact may qualify, but company_not_found and failed C0 records cannot', async (t) => {
  const noContact = fixture(t, { researchStatus: 'no_contact' });
  assert.equal((await noContact.service.qualify(noContact.id)).qualification.status, 'qualified');
  for (const researchStatus of ['company_not_found', 'failed']) {
    const item = fixture(t, { researchStatus });
    await assert.rejects(item.service.qualify(item.id), { code: 'RESEARCH_NOT_READY' });
    assert.equal(item.calls.website.length, 0);
    assert.equal(item.calls.ai.length, 0);
  }
});

test('missing Apollo domain falls back to Liverno and exact registrable match allows a subdomain', async (t) => {
  const missing = fixture(t, { apolloDomain: '' });
  assert.equal((await missing.service.qualify(missing.id)).qualification.status, 'qualified');
  assert.deepEqual(missing.calls.website, ['shop.example.co.uk']);
  const exact = fixture(t, { livernoDomain: 'example.co.uk', apolloDomain: 'example.co.uk' });
  assert.equal((await exact.service.qualify(exact.id)).qualification.status, 'qualified');
});

test('public suffix comparisons cover Australian and Japanese company domains', async (t) => {
  for (const [livernoDomain, apolloDomain] of [
    ['shop.example.com.au', 'example.com.au'],
    ['abc.example.co.jp', 'example.co.jp'],
  ]) {
    const item = fixture(t, { livernoDomain, apolloDomain,
      evidence: { ...goodEvidence, finalUrl: `https://${apolloDomain}/` } });
    assert.equal((await item.service.qualify(item.id)).qualification.status, 'qualified');
    assert.deepEqual(item.calls.website, [apolloDomain]);
  }
});

test('different registrable domains require review without website or AI calls', async (t) => {
  const { service, id, calls } = fixture(t, {
    candidateName: 'Terminal Blocks', apolloName: 'Example Electronics GmbH',
    apolloDomain: 'other.co.uk',
  });
  const record = await service.qualify(id);
  assert.equal(record.qualification.status, 'review_required');
  assert.equal(record.qualification.reason_code, 'identity_domain_mismatch');
  assert.equal(record.qualification.qualified, null);
  assert.equal(record.website_research.status, 'not_started');
  assert.deepEqual(calls, { website: [], ai: [] });
  assert.equal((await service.qualify(id)).qualification.status, 'review_required');
  assert.deepEqual(calls, { website: [], ai: [] });
});

test('a product-title candidate name does not override exact-domain company identity', async (t) => {
  const item = fixture(t, {
    candidateName: 'Terminal Blocks', apolloName: 'Example Electronics GmbH',
    livernoDomain: 'example.com', apolloDomain: 'example.com',
    evidence: { ...goodEvidence, finalUrl: 'https://www.example.com/' },
  });
  const record = await item.service.qualify(item.id);
  assert.equal(record.qualification.status, 'qualified');
  assert.equal(item.calls.website.length, 1);
  assert.equal(item.calls.ai.length, 1);
  const input = JSON.parse(item.calls.ai[0].input);
  assert.equal(input.company.candidateName.value, 'Terminal Blocks');
  assert.match(input.company.candidateName.meaning, /unverified discovery label/);
  assert.equal(input.company.apolloName, 'Example Electronics GmbH');
  assert.equal(input.company.domainIdentity, 'registrable_domain_match');
});

test('a completely unrelated discovery label still reaches AI when domains match', async (t) => {
  const item = fixture(t, {
    candidateName: 'Catalog fragment about copper connectors',
    apolloName: 'Example Electronics GmbH',
  });
  const record = await item.service.qualify(item.id);
  assert.equal(record.qualification.status, 'qualified');
  assert.equal(item.calls.ai.length, 1);
});

test('website redirect to a different registrable domain requires review before AI', async (t) => {
  const item = fixture(t, { evidence: { ...goodEvidence, finalUrl: 'https://unrelated.example/' } });
  const record = await item.service.qualify(item.id);
  assert.equal(record.qualification.status, 'review_required');
  assert.equal(record.qualification.reason_code, 'website_redirect_domain_mismatch');
  assert.equal(item.calls.website.length, 1);
  assert.equal(item.calls.ai.length, 0);
});

test('empty and sparse website evidence require review; technical website failure is failed', async (t) => {
  for (const evidence of [{ ...goodEvidence, status: 'empty', text: '' },
    { ...goodEvidence, text: 'Short page.' }]) {
    const item = fixture(t, { evidence });
    const record = await item.service.qualify(item.id);
    assert.equal(record.qualification.status, 'review_required');
    assert.equal(record.qualification.reason_code, 'website_evidence_insufficient');
    assert.equal(item.calls.ai.length, 0);
  }
  const failed = fixture(t, { evidence: { ...goodEvidence, status: 'failed', error: 'HTTP 503' } });
  const result = await failed.service.qualify(failed.id);
  assert.equal(result.qualification.status, 'failed');
  assert.equal(result.qualification.failure_reason, 'WEBSITE_RESEARCH_FAILED');
  assert.equal(failed.calls.ai.length, 0);
  assert.equal((await failed.service.qualify(failed.id)).qualification.status, 'failed');
  assert.equal(failed.calls.website.length, 1);
});

test('AI rejection, requested review, and null judgment have distinct states', async (t) => {
  const rejected = fixture(t, { decision: { ...goodDecision, qualified: false } });
  assert.equal((await rejected.service.qualify(rejected.id)).qualification.status, 'not_qualified');
  const review = fixture(t, { decision: { ...goodDecision, reviewRequired: true } });
  const reviewed = await review.service.qualify(review.id);
  assert.equal(reviewed.qualification.status, 'review_required');
  assert.equal(reviewed.qualification.qualified, null);
  const uncertain = fixture(t, { decision: { ...goodDecision, qualified: null } });
  assert.equal((await uncertain.service.qualify(uncertain.id)).qualification.status, 'review_required');
});

test('AI transport failure is persisted as failed and never retries automatically', async (t) => {
  const item = fixture(t);
  item.service.openai.qualifyCompany = async () => {
    item.calls.ai.push({});
    throw Object.assign(new Error('private upstream detail'), { code: 'UPSTREAM_HTTP_ERROR' });
  };
  const record = await item.service.qualify(item.id);
  assert.equal(record.qualification.status, 'failed');
  assert.equal(record.qualification.failure_reason, 'UPSTREAM_HTTP_ERROR');
  assert.equal(JSON.stringify(record).includes('private upstream detail'), false);
  await item.service.qualify(item.id);
  assert.equal(item.calls.website.length, 1);
  assert.equal(item.calls.ai.length, 1);
});

test('website and AI emails are redacted before model input and storage', async (t) => {
  const item = fixture(t, {
    evidence: { ...goodEvidence, text: `${goodEvidence.text} contact@company.example` },
    decision: { ...goodDecision, qualificationReason: 'Ask person@company.example first.' },
  });
  const record = await item.service.qualify(item.id);
  assert.equal(item.calls.ai.length, 1);
  assert.doesNotMatch(item.calls.ai[0].input, /contact@company\.example/);
  assert.doesNotMatch(JSON.stringify(record), /(?:contact|person)@company\.example/);
  assert.match(record.website_research.text, /\[redacted\]/);
});
