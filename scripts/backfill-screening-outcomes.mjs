import fs from 'node:fs';
import path from 'node:path';
import { createConfig } from '../src/config.mjs';
import { FeishuClient } from '../src/lib/feishu-client.mjs';
import { MarketingStore } from '../src/lib/marketing-store.mjs';

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function latestAuditFile(directory) {
  const files = fs.readdirSync(directory)
    .filter((name) => /^audit-.*\.json$/.test(name))
    .sort();
  if (!files.length) throw new Error(`未在 ${directory} 找到审计文件`);
  return path.join(directory, files.at(-1));
}

function decisionReason(item) {
  return String(item.companyDecision || '')
    .replace(/^(精准|不精准|证据不足)\s*-\s*/u, '')
    .trim();
}

function emailStatuses(item) {
  return (item.contactAudit || [])
    .map((line) => String(line).match(/邮箱状态=([^ |]+)/u)?.[1] || '')
    .filter(Boolean);
}

// These companies were reviewed and confirmed as marketing targets by the business owner.
const OWNER_CONFIRMED_TARGETS = new Set([
  '624024552995192832',
  '624030205813755904',
  '624033030631362560',
  '763517046027882496',
  '765656228045164544',
  '765692681353461760',
]);

const EXPLICIT_EXCLUSION_REASONS = new Map([
  ['794725562372136960', '官网显示其主营数字地图、导航和企业目录服务，没有电源、电气分销、工业控制、LED 照明、系统集成或设备制造证据。'],
  ['775852041377742848', '官网显示其主营企业信息、财务数据、风险分析和 SaaS 服务，与电源产品没有直接商业或应用匹配。'],
]);

const VERIFICATION_REASONS = new Map([
  ['732758933945090048', '未排除：缺少可读取的官网、主营产品和公司介绍，暂时无法确认公司身份及电源产品需求，等待继续核验。'],
]);

function deriveOutcome(item, jobs) {
  const reviewStatus = String(item.feishuProcessingStatus || item.feishuReviewStatus || '');
  const reason = decisionReason(item);
  if (jobs.active > 0) {
    return {
      category: 'queued',
      result: '已进入营销队列',
      code: '',
      reason: `未排除：${jobs.active} 个联系人已进入待发送或已发送队列。`,
      nextAction: '等待定时发送',
    };
  }
  if (OWNER_CONFIRMED_TARGETS.has(String(item.customerId))) {
    return {
      category: 'pending',
      result: '营销目标·待补全',
      code: 'target_needs_enrichment',
      reason: '未排除：经业务确认属于营销目标；当前缺少已验证关键联系人，系统继续补全。',
      nextAction: '继续补全已验证关键联系人',
    };
  }
  if (reviewStatus.includes('不精准')) {
    return {
      category: 'excluded',
      result: '明确排除·非精准',
      code: 'not_precise',
      reason: EXPLICIT_EXCLUSION_REASONS.get(String(item.customerId)) || `可靠业务证据确认其不是精准客户：${reason}`,
      nextAction: '不进入营销队列',
    };
  }
  if (reviewStatus.includes('证据不足')) {
    return {
      category: 'pending',
      result: '待核验',
      code: 'qualification_uncertain',
      reason: VERIFICATION_REASONS.get(String(item.customerId)) || `未排除：当前公司资料证据不足，等待继续核验。${reason}`,
      nextAction: '继续补充公司业务资料',
    };
  }
  if (reviewStatus.includes('Apollo待核对') || item.apolloStatus === 'company_mismatch') {
    return {
      category: 'pending',
      result: '营销目标·待补全',
      code: 'company_mismatch',
      reason: '未排除：客户业务符合营销方向，但 Apollo 尚未匹配到正确公司和已验证关键联系人，系统继续补全。',
      nextAction: '继续核对公司并补全联系人',
    };
  }
  const statuses = emailStatuses(item);
  if (statuses.length && statuses.every((status) => status !== 'verified')) {
    return {
      category: 'pending',
      result: '营销目标·待补全',
      code: 'contact_quality_failed',
      reason: `未排除：客户业务精准，但找到的 ${statuses.length} 个联系人邮箱均未验证，系统继续补全。`,
      nextAction: '继续补全已验证关键联系人',
    };
  }
  return {
    category: 'pending',
    result: '营销目标·待补全',
    code: 'contact_not_found',
    reason: '未排除：客户尚未找到通过联系人和邮箱质检的收件人，系统继续补全。',
    nextAction: '继续补全已验证关键联系人',
  };
}

const config = createConfig();
const auditDirectory = path.resolve('.data/validation');
const auditPath = path.resolve(argument('file', latestAuditFile(auditDirectory)));
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const store = new MarketingStore({ databasePath: path.resolve(config.marketing.databasePath) });
const feishu = new FeishuClient(config.feishu);
const ensured = await feishu.ensureResearchAuditFields();
const summary = {
  auditPath,
  requested: audit.items.length,
  updated: 0,
  verified: 0,
  excluded: 0,
  pending: 0,
  queued: 0,
  failed: 0,
  createdFields: ensured.created,
  items: [],
};

for (const item of audit.items) {
  const outcome = deriveOutcome(item, store.getCustomerJobSummary(item.customerId));
  try {
    await feishu.updateScreeningOutcome(item.feishuRecordId, {
      screeningResult: outcome.result,
      exclusionReason: outcome.reason,
      nextAction: outcome.nextAction,
    });
    const verified = await feishu.getDraftRecord(item.feishuRecordId);
    if (verified.screeningResult !== outcome.result || verified.exclusionReason !== outcome.reason) {
      throw new Error(`飞书读回核验失败：${item.feishuRecordId}`);
    }
    store.resolveCompanyExclusions(item.customerId, `筛选状态纠正为：${outcome.result}`);
    if (outcome.code) {
      store.recordExclusion({
        customerId: item.customerId,
        companyName: item.companyName,
        reasonCode: outcome.code,
        reason: outcome.reason,
        details: { source: 'validation_audit', feishuRecordId: item.feishuRecordId },
        createdAt: audit.generatedAt,
      });
    }
    summary[outcome.category] += 1;
    summary.updated += 1;
    summary.verified += 1;
    summary.items.push({
      customerId: item.customerId,
      companyName: item.companyName,
      recordId: item.feishuRecordId,
      status: outcome.result,
      reason: outcome.reason,
      verified: true,
    });
  } catch (error) {
    summary.failed += 1;
    summary.items.push({ customerId: item.customerId, companyName: item.companyName, status: 'failed', error: error.message });
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

store.close();
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
