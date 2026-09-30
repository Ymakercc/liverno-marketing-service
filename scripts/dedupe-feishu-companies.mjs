import path from 'node:path';
import { createConfig } from '../src/config.mjs';
import { chooseCanonicalCompanyRecord, FeishuClient } from '../src/lib/feishu-client.mjs';
import { MarketingStore } from '../src/lib/marketing-store.mjs';

const LIST_FIELDS = ['孚盟联系人ID', '联系人姓名', '联系人邮箱'];
const FILL_FIELDS = [
  '公司名', '国家', '客户类型', '官网', '客户画像', 'AI推荐产品', 'AI邮件主题', 'AI邮件正文',
  '人工审核状态', '筛选结果', '排除原因', '下一步动作', '备注',
];

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function text(value) {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') return text(value.text ?? value.name ?? value.value ?? value.link ?? '');
  return '';
}

function recordId(record) {
  return String(record?.record_id || record?.id || '').trim();
}

function timestamp(record) {
  return Number(record?.last_modified_time || record?.created_time || 0);
}

function compact(values) {
  const items = values.flatMap((value) =>
    text(value).split(/[;；\n]+/).map((item) => item.trim()).filter(Boolean));
  return [...new Set(items)].join('; ');
}

function firstValue(records, fieldName) {
  return records.map((record) => record.fields?.[fieldName]).find((value) => text(value).trim()) ?? '';
}

function mergeCompanyRecords(records, canonical) {
  const newestFirst = [...records].sort((left, right) => timestamp(right) - timestamp(left));
  const preferred = [canonical, ...newestFirst.filter((record) => recordId(record) !== recordId(canonical))];
  const fields = { '孚盟客户ID': text(canonical.fields?.['孚盟客户ID']).trim() };
  for (const fieldName of LIST_FIELDS) {
    const merged = compact(preferred.map((record) => record.fields?.[fieldName]));
    if (merged) fields[fieldName] = merged;
  }
  for (const fieldName of FILL_FIELDS) {
    const value = firstValue(preferred, fieldName);
    if (text(value).trim()) fields[fieldName] = value;
  }
  return fields;
}

const apply = hasFlag('apply');
const removeDuplicates = hasFlag('delete');
if (removeDuplicates && !apply) throw new Error('`--delete` 必须与 `--apply` 一起使用。');
if (removeDuplicates && argument('confirm') !== 'DELETE_DUPLICATES') {
  throw new Error('删除真实飞书记录需要 `--confirm=DELETE_DUPLICATES`。');
}

const config = createConfig();
const feishu = new FeishuClient(config.feishu);
const store = new MarketingStore({ databasePath: path.resolve(config.marketing.databasePath) });
const records = await feishu.listRawRecords();
const byCustomer = new Map();
for (const record of records) {
  const customerId = text(record.fields?.['孚盟客户ID']).trim();
  if (!customerId) continue;
  if (!byCustomer.has(customerId)) byCustomer.set(customerId, []);
  byCustomer.get(customerId).push(record);
}

const groups = [...byCustomer.entries()]
  .filter(([, items]) => items.length > 1)
  .map(([customerId, items]) => {
    const canonical = chooseCanonicalCompanyRecord(items);
    const duplicateIds = items.map(recordId).filter((id) => id && id !== recordId(canonical));
    return {
      customerId,
      companyName: text(canonical.fields?.['公司名']),
      canonical,
      duplicateIds,
      mergedFields: mergeCompanyRecords(items, canonical),
    };
  });

const summary = {
  mode: apply ? (removeDuplicates ? 'apply-and-delete' : 'apply-merge-only') : 'dry-run',
  records: records.length,
  companies: byCustomer.size,
  duplicateCompanies: groups.length,
  extraRecords: groups.reduce((sum, group) => sum + group.duplicateIds.length, 0),
  updated: 0,
  relinkedJobs: 0,
  relinkedEnrichments: 0,
  deleted: 0,
  items: groups.map((group) => ({
    customerId: group.customerId,
    companyName: group.companyName,
    keep: recordId(group.canonical),
    remove: group.duplicateIds,
    contactIds: group.mergedFields['孚盟联系人ID'] || '',
    contactNames: group.mergedFields['联系人姓名'] || '',
    contactEmails: group.mergedFields['联系人邮箱'] || '',
  })),
};

try {
  if (apply) {
    for (const group of groups) {
      await feishu.updateDraftRecord(recordId(group.canonical), group.mergedFields);
      summary.updated += 1;
      const relinked = store.relinkCompanyFeishuRecord(group.customerId, recordId(group.canonical));
      summary.relinkedJobs += relinked.jobs;
      summary.relinkedEnrichments += relinked.enrichments;
      if (removeDuplicates) {
        for (const duplicateId of group.duplicateIds) {
          await feishu.deleteRecord(duplicateId);
          summary.deleted += 1;
        }
      }
    }
  }
} finally {
  store.close();
}

console.log(JSON.stringify(summary, null, 2));
