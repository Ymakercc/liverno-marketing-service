import path from 'node:path';
import { createConfig } from '../src/config.mjs';
import { FeishuClient } from '../src/lib/feishu-client.mjs';
import { FumengClient } from '../src/lib/fumeng-client.mjs';
import { MarketingStore } from '../src/lib/marketing-store.mjs';

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function localDayStartIso(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function reconstructEnrichment(run, contacts) {
  const sources = run.details?.sources || [];
  const contactCandidates = contacts.filter((item) => item.email).slice(0, 5).map((contact, index) => ({
    source: sources[index] || 'fumeng_after_apollo',
    emailVerified: index === 0 ? Boolean(run.details?.emailVerified) : false,
    contact,
    person: {
      id: index === 0 ? run.apolloPersonId : '',
      name: contact.name,
      title: contact.jobRole,
      email: contact.email,
      emailStatus: index === 0 && run.details?.emailVerified ? 'verified' : 'historical_unknown',
      linkedinUrl: contact.linkedin,
    },
    changes: [],
    writebackApplied: true,
  }));
  return {
    status: run.status,
    confidence: run.confidence,
    organization: run.details?.organization || { id: run.apolloOrgId },
    contactCandidates,
    changes: run.changes,
    error: run.error,
    apolloOrgId: run.apolloOrgId,
  };
}

const config = createConfig();
const since = argument('since', localDayStartIso());
const limit = Math.min(Math.max(Number(argument('limit', '500')) || 500, 1), 1000);
const resolveExclusions = ['1', 'true', 'yes'].includes(argument('resolve-exclusions', 'false').toLowerCase());
const store = new MarketingStore({ databasePath: path.resolve(config.marketing.databasePath) });
const fumeng = new FumengClient(config.fumeng);
const feishu = new FeishuClient(config.feishu);
const latestByCustomer = new Map();
for (const run of store.listEnrichmentRunsSince(since)) {
  if (!latestByCustomer.has(run.customerId)) latestByCustomer.set(run.customerId, run);
}
const runs = [...latestByCustomer.values()].slice(0, limit);
const summary = { since, found: runs.length, created: 0, skipped: 0, failed: 0, resolvedExclusions: 0, failures: [] };

for (const run of runs) {
  if (resolveExclusions) {
    summary.resolvedExclusions += store.resolveCompanyExclusions(
      run.customerId,
      '旧流程未读取官网，原判断已撤销，等待重新核验',
    ).resolved;
  }
  if (run.feishuRecordId && run.feishuSyncStatus === 'synced') {
    summary.skipped += 1;
    continue;
  }
  let customer = { id: run.customerId, companyName: run.companyName, country: '', website: '' };
  let contacts = [];
  try {
    [customer, contacts] = await Promise.all([
      fumeng.getCustomer(run.customerId),
      fumeng.listContacts(run.customerId),
    ]);
  } catch (error) {
    summary.failures.push({ customerId: run.customerId, stage: 'fumeng_read', error: error.message });
  }

  try {
    let recordId = run.feishuRecordId;
    if (!recordId) {
      const created = await feishu.createResearchRecord({ customer, contacts });
      recordId = created?.record_id || created?.recordId || created?.id || '';
    }
    if (!recordId) throw new Error('飞书未返回记录 ID');
    await feishu.updateResearchRecord(recordId, {
      customer,
      contacts,
      enrichment: reconstructEnrichment(run, contacts),
      websiteEvidence: { status: 'historical_not_fetched' },
    });
    store.attachEnrichmentFeishuRecord(run.id, { recordId, status: 'synced' });
    summary.created += 1;
  } catch (error) {
    store.attachEnrichmentFeishuRecord(run.id, { status: 'failed', error: error.message });
    summary.failed += 1;
    summary.failures.push({ customerId: run.customerId, stage: 'feishu_write', error: error.message });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

store.close();
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
