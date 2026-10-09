import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { ResearchStore } from '../src/lib/research-store.mjs';
import { ResearchService, validateResearchInput } from '../src/services/research-service.mjs';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const config = { apollo: { minimumCompanyScore: 75, maxPeoplePerCompany: 5 } };
const organization = {
  id: 'org-1', name: 'Example Industries', domain: 'example.com',
  country: 'Germany', industry: 'electronics', employeeCount: 100,
  linkedinUrl: 'https://linkedin.com/company/example',
};

function input(changes = {}) {
  return {
    source: 'liverno', source_id: SOURCE_ID, domain: 'https://www.example.com/products',
    candidate_name: 'Example catalog page', evidence_url: 'https://www.example.com/products',
    discovered_at: '2026-09-29T12:00:00Z', country: null, industry: null,
    ...changes,
  };
}

function fixture(t, overrides = {}, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-intake-'));
  const databasePath = path.join(dir, 'research.sqlite');
  const store = new ResearchStore({ databasePath });
  const calls = { enrich: 0, searchOrganizations: 0, searchPeople: 0, matchPerson: 0 };
  const apollo = {
    async enrichOrganization() { calls.enrich += 1; return organization; },
    async searchOrganizations() { calls.searchOrganizations += 1; return []; },
    async searchPeople() {
      calls.searchPeople += 1;
      return [{ id: 'person-1', title: 'Purchasing Manager', emailStatus: 'verified' }];
    },
    async matchPerson() {
      calls.matchPerson += 1;
      return { id: 'person-1', title: 'Purchasing Manager',
        email: 'buyer@example.invalid', emailStatus: 'verified' };
    },
    ...overrides,
  };
  const service = new ResearchService({ store, apollo, config, ...options });
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { service, store, calls, databasePath };
}

test('research input validates source, UUID, evidence and normalizes domain without Fumeng ID', () => {
  assert.equal(validateResearchInput(input()).domain, 'example.com');
  assert.equal(validateResearchInput(input({ domain: 'shop.example.co.uk/a' })).domain, 'shop.example.co.uk');
  assert.throws(() => validateResearchInput(input({ source: 'fumeng' })), /source/i);
  assert.throws(() => validateResearchInput(input({ source_id: '123' })), /source_id/i);
  assert.throws(() => validateResearchInput(input({ evidence_url: 'not-a-url' })), /evidence_url/i);
});

test('paused Apollo research rejects new intake without spending credit but can return existing records', async (t) => {
  const pausedConfig = { ...config, marketing: { researchEnabled: false } };
  const { service, store, calls } = fixture(t, {}, { config: pausedConfig });
  await assert.rejects(service.intake(input()), { code: 'APOLLO_RESEARCH_PAUSED' });
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM research_records').get().n, 0);
  const existing = store.create(validateResearchInput(input()));
  assert.equal(existing.created, true);
  assert.equal((await service.intake(input())).record.id, existing.record.id);
  assert.equal(calls.enrich, 0);
});

test('website signals remain an object for new, completed, and malformed historical records', async (t) => {
  const { store } = fixture(t);
  const record = store.create(validateResearchInput(input())).record;
  assert.deepEqual(record.website_research.signals, {});
  store.start(record.id);
  store.finish(record.id, { status: 'completed', organization, matchScore: 95 });
  assert.deepEqual(store.getBySource('liverno', SOURCE_ID).website_research.signals, {});
  for (const historical of ['null', '[]', 'not-json']) {
    store.db.prepare('UPDATE research_records SET website_signals_json = ? WHERE id = ?')
      .run(historical, record.id);
    assert.deepEqual(store.get(record.id).website_research.signals, {});
  }
  store.db.prepare('UPDATE research_records SET website_signals_json = ? WHERE id = ?')
    .run('{"directFit":true}', record.id);
  assert.deepEqual(store.get(record.id).website_research.signals, { directFit: true });
});

test('intake persists company and minimal people, then repeats without Apollo or a second record', async (t) => {
  const { service, store, calls, databasePath } = fixture(t);
  const first = await service.intake(input());
  assert.equal(first.created, true);
  assert.equal(first.record.status, 'completed');
  assert.equal(first.record.domain, 'example.com');
  assert.equal(first.record.company.apollo_name, organization.name);
  assert.equal(first.record.company.match_score, 95);
  assert.deepEqual(first.record.contacts, [{
    person_id: 'person-1', title: 'Purchasing Manager',
    email_status: 'verified', has_email: true,
  }]);
  assert.equal(JSON.stringify(first.record).includes('buyer@example.invalid'), false);
  assert.equal(first.record.apollo_calls.people_match, 1);
  assert.deepEqual(calls, { enrich: 1, searchOrganizations: 0, searchPeople: 1, matchPerson: 1 });
  const second = await service.intake(input({ candidate_name: 'changed', domain: 'other.example.com' }));
  assert.equal(second.created, false);
  assert.deepEqual(second.record, first.record);
  assert.deepEqual(calls, { enrich: 1, searchOrganizations: 0, searchPeople: 1, matchPerson: 1 });
  assert.equal(store.get(first.record.id).id, first.record.id);
  assert.equal(store.getBySource('liverno', SOURCE_ID).id, first.record.id);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM research_records').get().n, 1);
  const reopened = new ResearchStore({ databasePath });
  assert.equal(reopened.get(first.record.id).status, 'completed');
  reopened.close();
});

test('concurrent intake calls share one record and one Apollo execution', async (t) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service, store, calls } = fixture(t, {
    async enrichOrganization() {
      calls.enrich += 1;
      await gate;
      return organization;
    },
  });
  const first = service.intake(input());
  const repeated = await service.intake(input());
  assert.equal(repeated.created, false);
  assert.equal(repeated.record.status, 'researching');
  assert.equal(calls.enrich, 1);
  release();
  const completed = await first;
  assert.equal(completed.record.status, 'completed');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM research_records').get().n, 1);
  assert.equal(calls.enrich, 1);
});

test('organization search fallback uses existing score and only one search', async (t) => {
  const { service, calls } = fixture(t, {
    async enrichOrganization() { calls.enrich += 1; return null; },
    async searchOrganizations() { calls.searchOrganizations += 1; return [organization]; },
  });
  const result = await service.intake(input({ country: 'Germany' }));
  assert.equal(result.record.status, 'completed');
  assert.equal(calls.enrich, 1);
  assert.equal(calls.searchOrganizations, 1);
});

test('unmatched company and insufficient score end as company_not_found', async (t) => {
  const missing = fixture(t, {
    async enrichOrganization() { return null; },
    async searchOrganizations() { return []; },
  });
  assert.equal((await missing.service.intake(input())).record.status, 'company_not_found');
  const low = fixture(t, {
    async enrichOrganization() {
      return { ...organization, domain: 'unrelated.test', name: 'Unrelated Business' };
    },
    async searchOrganizations() { return []; },
  });
  assert.equal((await low.service.intake(input({ source_id: cryptoId(2) }))).record.status, 'company_not_found');
});

test('no suitable contact records no_contact, while Apollo errors record failed', async (t) => {
  const noContact = fixture(t, { async searchPeople() { return []; } });
  assert.equal((await noContact.service.intake(input())).record.status, 'no_contact');
  const unverified = fixture(t, {
    async matchPerson() {
      return { id: 'person-1', title: 'Purchasing Manager',
        email: 'buyer@example.invalid', emailStatus: 'unverified' };
    },
  });
  const unverifiedResult = await unverified.service.intake(input({ source_id: cryptoId(4) }));
  assert.equal(unverifiedResult.record.status, 'no_contact');
  assert.equal(unverifiedResult.record.contacts[0].has_email, true);
  const failure = fixture(t, {
    async enrichOrganization() { throw Object.assign(new Error('upstream detail'), { code: 'UPSTREAM_HTTP_ERROR' }); },
  });
  const result = await failure.service.intake(input({ source_id: cryptoId(3) }));
  assert.equal(result.record.status, 'failed');
  assert.equal(result.record.failure_reason, 'UPSTREAM_HTTP_ERROR');
  assert.equal(JSON.stringify(result.record).includes('upstream detail'), false);
});

test('research limits People Match to three candidates and does not depend on Fumeng or marketing', async (t) => {
  const { service, calls } = fixture(t, {
    async searchPeople() {
      calls.searchPeople += 1;
      return Array.from({ length: 10 }, (_, i) => ({
        id: `person-${i}`, title: 'Buyer', emailStatus: 'verified',
      }));
    },
    async matchPerson({ id }) {
      calls.matchPerson += 1;
      return { id, title: 'Buyer', email: `${id}@example.invalid`, emailStatus: 'verified' };
    },
  });
  const result = await service.intake(input());
  assert.equal(result.record.status, 'completed');
  assert.equal(calls.matchPerson, 3);
  assert.equal(result.record.contacts.length, 3);
});

function cryptoId(last) {
  return `11111111-1111-4111-8111-${String(last).padStart(12, '0')}`;
}

test('HTTP intake requires Automation Bearer and never touches marketing jobs or external systems', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-http-'));
  const upstreamCalls = [];
  const upstream = http.createServer(async (req, res) => {
    upstreamCalls.push(req.url);
    const body = req.url === '/api/v1/organizations/enrich'
      ? { organization: { id: 'org-1', name: 'Example Industries', primary_domain: 'example.com' } }
      : req.url === '/api/v1/mixed_people/api_search'
        ? { people: [{ id: 'person-1', title: 'Purchasing Manager' }] }
        : req.url === '/api/v1/people/match'
          ? { person: { id: 'person-1', title: 'Purchasing Manager',
            email: 'buyer@example.invalid', email_status: 'verified' } }
          : {};
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const env = {
    ...process.env,
    HOST: '127.0.0.1', PORT: String(port),
    AUTOMATION_TOKEN: 'research-test-token',
    APOLLO_API_KEY: 'fake-apollo-key',
    APOLLO_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
    RESEARCH_MAX_MATCHES: '2',
    RESEARCH_DATABASE_PATH: path.join(dir, 'research.sqlite'),
    MARKETING_DATABASE_PATH: path.join(dir, 'marketing.sqlite'),
    DELIVERY_DATABASE_PATH: path.join(dir, 'delivery.sqlite'),
    MAILBOX_DATABASE_PATH: path.join(dir, 'inbox.sqlite'),
    MAILBOX_SETTINGS_PATH: path.join(dir, 'mailbox.enc'),
    MAILBOX_SETTINGS_KEY_PATH: path.join(dir, 'mailbox.key'),
    PRICE_CATALOG_PATH: path.join(dir, 'missing-price-catalog.md'),
    MARKETING_AUTOMATION_ENABLED: 'false', APOLLO_RESEARCH_ENABLED: 'true',
    FUMENG_WRITEBACK_ENABLED: 'false', EMAIL_SENDING_ENABLED: 'false',
    MAILBOX_MONITORING_ENABLED: 'false', MIMO_INBOX_CLASSIFICATION_ENABLED: 'false',
    FUMENG_APP_ID: '', FUMENG_APP_SECRET: '', FUMENG_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
    FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', FEISHU_APP_TOKEN: '', FEISHU_TABLE_ID: '',
    BREVO_API_KEY: '', OPENAI_API_KEY: '', MIMO_API_KEY: '', WEB_LOGIN_PASSWORD_HASH: '',
  };
  const child = spawn(process.execPath, ['src/server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'), env, stdio: 'ignore',
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`${base}/api/research/unknown`, {
        headers: { authorization: 'Bearer research-test-token' },
      });
      if (response.status === 404) { ready = true; break; }
    } catch { /* Wait for the child server. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'research server did not start');
  const url = `${base}/api/research/intake`;
  const noToken = await fetch(url, { method: 'POST', body: JSON.stringify(input()) });
  assert.equal(noToken.status, 401);
  const wrong = await fetch(url, {
    method: 'POST', headers: { authorization: 'Bearer wrong' }, body: JSON.stringify(input()),
  });
  assert.equal(wrong.status, 401);
  const qualifyUrl = `${base}/api/research/${SOURCE_ID}/qualify`;
  assert.equal((await fetch(qualifyUrl, { method: 'POST' })).status, 401);
  assert.equal((await fetch(qualifyUrl, {
    method: 'POST', headers: { authorization: 'Bearer wrong' },
  })).status, 401);
  assert.equal((await fetch(`${base}/api/research/${SOURCE_ID}`)).status, 401);
  assert.equal(upstreamCalls.length, 0);
  const headers = { authorization: 'Bearer research-test-token', 'content-type': 'application/json' };
  assert.equal((await fetch(qualifyUrl, { method: 'POST', headers })).status, 404);
  const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input()) });
  assert.equal(first.status, 201);
  const created = await first.json();
  assert.equal(created.status, 'completed');
  assert.equal(created.contacts[0].has_email, true);
  assert.equal(JSON.stringify(created).includes('buyer@example.invalid'), false);
  const repeated = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input()) });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).id, created.id);
  const byId = await fetch(`${base}/api/research/${created.id}`, { headers });
  assert.equal(byId.status, 200);
  const bySource = await fetch(`${base}/api/research/by-source/liverno/${SOURCE_ID}`, { headers });
  assert.equal(bySource.status, 200);
  assert.equal((await bySource.json()).id, created.id);
  const dedupUrl = `${base}/api/research/by-source/liverno/${SOURCE_ID}/cross-source-dedup`;
  assert.equal((await fetch(dedupUrl)).status, 401);
  assert.equal((await fetch(dedupUrl, {
    headers: { authorization: 'Bearer wrong' },
  })).status, 401);
  const dedup = await fetch(dedupUrl, { headers });
  assert.equal(dedup.status, 200);
  const dedupBody = await dedup.json();
  assert.equal(dedupBody.status, 'unknown');
  assert.equal(JSON.stringify(dedupBody).includes('@'), false);
  assert.deepEqual(upstreamCalls, [
    '/api/v1/organizations/enrich', '/api/v1/mixed_people/api_search', '/api/v1/people/match',
  ]);
  const marketingDb = new DatabaseSync(path.join(dir, 'marketing.sqlite'));
  assert.equal(marketingDb.prepare('SELECT COUNT(*) AS n FROM marketing_jobs').get().n, 0);
  marketingDb.close();
});
