import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createConfig } from '../src/config.mjs';
import { FeishuClient, normalizeDraftRecord } from '../src/lib/feishu-client.mjs';
import { MarketingStore } from '../src/lib/marketing-store.mjs';
import { loadPriceCatalog } from '../src/lib/price-catalog.mjs';
import { resolveTimeZone } from '../src/lib/scheduling.mjs';
import { MarketingService, selectEmailProducts } from '../src/services/marketing-service.mjs';

const apply = process.argv.includes('--apply');
const config = createConfig();
const databasePath = path.resolve(config.marketing.databasePath);
const readDb = new DatabaseSync(databasePath, { readOnly: true });
const targets = readDb.prepare(`
  WITH latest_runs AS (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY customer_id ORDER BY created_at DESC, rowid DESC
    ) AS rn
    FROM enrichment_runs
  ), no_jobs AS (
    SELECT run.*
    FROM latest_runs run
    LEFT JOIN marketing_jobs job ON job.customer_id = run.customer_id
    WHERE run.rn = 1 AND run.status = 'enriched' AND job.customer_id IS NULL
  ), latest_exclusions AS (
    SELECT *, ROW_NUMBER() OVER (
      PARTITION BY customer_id ORDER BY created_at DESC, rowid DESC
    ) AS rn
    FROM marketing_exclusions
    WHERE resolved_at = ''
  )
  SELECT run.customer_id AS customerId, run.company_name AS companyName,
    run.feishu_record_id AS recordId,
    json_extract(run.details_json, '$.organization.country') AS organizationCountry
  FROM no_jobs run
  JOIN latest_exclusions exclusion
    ON exclusion.customer_id = run.customer_id AND exclusion.rn = 1
  WHERE exclusion.reason_code = 'product_images_missing'
  ORDER BY run.company_name
`).all();
readDb.close();

function splitList(value) {
  return String(value || '').split(/[;；\n]+/).map((item) => item.trim()).filter(Boolean);
}

function parseRecommendations(value) {
  return String(value || '').split(/\n+/).map((line) => {
    const separator = line.indexOf(':');
    return {
      name: (separator < 0 ? line : line.slice(0, separator)).trim(),
      reason: (separator < 0 ? '' : line.slice(separator + 1)).trim(),
    };
  }).filter((item) => item.name);
}

const feishu = new FeishuClient(config.feishu);
const rawRecords = await feishu.listRawRecords();
const records = new Map(rawRecords.map((record) => [
  record.record_id || record.id,
  normalizeDraftRecord(record),
]));
const priceCatalog = await loadPriceCatalog(config.pricing);
const prepared = [];
const rejected = [];

for (const target of targets) {
  const record = records.get(target.recordId);
  const contactIds = splitList(record?.contactId);
  const contactNames = splitList(record?.contactName);
  const contactEmails = splitList(record?.contactEmail);
  const recommendedProducts = parseRecommendations(record?.recommendedProducts);
  const organizationCountry = /\bPHILIPPINES\b/i.test(target.companyName)
    ? 'Philippines'
    : target.organizationCountry;
  const country = resolveTimeZone(record?.country)
    ? record.country
    : organizationCountry;
  const timeZone = resolveTimeZone(country);
  const products = selectEmailProducts({
    recommendedProducts,
    catalog: priceCatalog,
    limit: config.pricing.maxEmailModels || 8,
    emailAssets: config.emailAssets,
  });
  const missingImages = products.filter((product) => !product.imageAvailable);
  if (!record?.emailSubject || !record?.emailBody || !contactEmails[0] || !timeZone ||
      products.length < 6 || missingImages.length) {
    rejected.push({
      customerId: target.customerId,
      companyName: target.companyName,
      reason: !record ? 'feishu_record_missing'
        : !contactEmails[0] ? 'contact_email_missing'
          : !record.emailSubject || !record.emailBody ? 'draft_missing'
            : !timeZone ? 'timezone_missing'
            : products.length < 6 ? 'fewer_than_six_products'
              : 'product_images_missing',
      productCount: products.length,
      missingModels: missingImages.map((product) => product.model),
    });
    continue;
  }
  prepared.push({
    target,
    record,
    customer: {
      id: target.customerId,
      companyName: record.companyName || target.companyName,
      country,
      website: record.website,
      customerType: record.customerType,
    },
    contact: {
      id: contactIds[0] || '',
      name: contactNames[0] || 'Customer',
      email: contactEmails[0],
    },
    draft: {
      qualified: true,
      customerType: record.customerType,
      customerProfile: record.customerProfile,
      recommendedProducts,
      emailSubject: record.emailSubject,
      emailBody: record.emailBody,
    },
  });
}

if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', found: targets.length, ready: prepared.length, rejected }, null, 2));
  process.exit(rejected.length ? 1 : 0);
}

const store = new MarketingStore({ databasePath });
const marketing = new MarketingService({
  fumeng: null,
  enrichment: null,
  drafts: null,
  marketing: store,
  brevo: null,
  feishu,
  config,
  priceCatalog,
});
const queued = [];
const failures = [];
for (const item of prepared) {
  try {
    const result = await marketing.queueManualDraft({
      customer: item.customer,
      contact: item.contact,
      draft: item.draft,
      feishuRecordId: item.target.recordId,
    });
    store.resolveCompanyExclusions(item.target.customerId, '产品图片已就绪，历史邮件已恢复排队');
    await feishu.updateScreeningOutcome(item.target.recordId, {
      screeningResult: '已进入营销队列',
      exclusionReason: '',
      nextAction: '等待按客户时区发送',
    });
    queued.push({
      customerId: item.target.customerId,
      companyName: item.target.companyName,
      jobId: result.job?.id || '',
      scheduledAt: result.job?.scheduledAt || '',
    });
  } catch (error) {
    failures.push({
      customerId: item.target.customerId,
      companyName: item.target.companyName,
      error: error.message,
    });
  }
}
store.close();

console.log(JSON.stringify({
  mode: 'apply',
  found: targets.length,
  queued: queued.length,
  failed: failures.length,
  failures,
}, null, 2));
process.exitCode = failures.length ? 1 : 0;
