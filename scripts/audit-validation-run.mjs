import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createConfig } from '../src/config.mjs';
import { FeishuClient } from '../src/lib/feishu-client.mjs';

function noteValue(notes, prefix) {
  const line = String(notes || '').split('\n').find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : '';
}

function noteLines(notes, prefix) {
  return String(notes || '').split('\n').filter((item) => item.startsWith(prefix));
}

const config = createConfig();
const database = new DatabaseSync(path.resolve(config.marketing.databasePath), { readOnly: true });
const start = new Date();
start.setHours(0, 0, 0, 0);
const limit = Math.min(Math.max(Number(process.env.PILOT_AUDIT_LIMIT || 10), 1), 100);
const requestedCustomerIds = [...new Set(process.argv.slice(2).map((item) => item.trim()).filter(Boolean))];
const recentRuns = database.prepare(`
  SELECT id, customer_id, company_name, status, confidence, error, created_at,
    feishu_record_id, feishu_sync_status, feishu_sync_error
  FROM enrichment_runs WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500
`).all(start.toISOString());
database.close();
const latestByCustomer = new Map();
for (const run of recentRuns) {
  if (!latestByCustomer.has(run.customer_id)) latestByCustomer.set(run.customer_id, run);
}
const missingCustomerIds = requestedCustomerIds.filter((id) => !latestByCustomer.has(id));
const runs = requestedCustomerIds.length
  ? requestedCustomerIds.map((id) => latestByCustomer.get(id)).filter(Boolean)
  : recentRuns.slice(0, limit).reverse();

const feishu = new FeishuClient(config.feishu);
const records = await feishu.listDraftRecords({ limit: 200 });
const byId = new Map(records.items.map((item) => [item.recordId, item]));
const items = runs.map((run) => {
  const record = byId.get(run.feishu_record_id);
  return {
    customerId: run.customer_id,
    companyName: run.company_name,
    apolloStatus: run.status,
    apolloMatchScore: Number(run.confidence),
    apolloError: run.error,
    feishuRecordId: run.feishu_record_id,
    feishuSyncStatus: run.feishu_sync_status,
    feishuSyncError: run.feishu_sync_error,
    feishuProcessingStatus: record?.reviewStatus || '未读取到记录',
    website: record?.website || '',
    contacts: record?.contactEmail || '',
    companyDecision: noteValue(record?.notes, 'AI公司判断:'),
    websiteRead: noteValue(record?.notes, '官网读取:'),
    websiteTitle: noteValue(record?.notes, '官网标题:'),
    websiteDescription: noteValue(record?.notes, '官网描述:'),
    websiteMatchedTerms: noteValue(record?.notes, '官网匹配词:'),
    fumengWriteback: noteValue(record?.notes, '孚盟回填:'),
    contactAudit: noteLines(record?.notes, '联系人'),
  };
});

const summary = {
  total: items.length,
  requested: requestedCustomerIds.length || limit,
  missingCustomerIds,
  feishuSynced: items.filter((item) => item.feishuSyncStatus === 'synced' && item.feishuRecordId).length,
  failed: items.filter((item) => item.apolloStatus === 'failed').length,
  byReviewStatus: items.reduce((result, item) => {
    result[item.feishuProcessingStatus] = (result[item.feishuProcessingStatus] || 0) + 1;
    return result;
  }, {}),
};
const report = { generatedAt: new Date().toISOString(), requestedCustomerIds, summary, items };
const outputDirectory = path.resolve('.data/validation');
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ summary, report: outputPath }, null, 2));
console.table(items.map((item) => ({
  company: item.companyName,
  apollo: `${item.apolloStatus}/${item.apolloMatchScore}`,
  feishu: item.feishuProcessingStatus,
  decision: item.companyDecision.slice(0, 80),
})));
