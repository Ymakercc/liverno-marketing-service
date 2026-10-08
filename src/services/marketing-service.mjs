import {
  buildFirstTouchEmailHtml,
  buildFirstTouchEmailText,
  buildSecondTouchEmailHtml,
  buildSecondTouchEmailText,
  buildSecondTouchSubject,
} from '../lib/email-composer.mjs';
import { isMarketableCustomerState } from '../lib/customer-eligibility.mjs';
import { AppError } from '../lib/errors.mjs';
import {
  isInsideSendWindow,
  nextSendTime,
  resolveCountryCode,
  resolveTimeZone,
} from '../lib/scheduling.mjs';
import { selectPricedModels } from '../lib/price-catalog.mjs';
import { getProductImage, listProductImageModels } from '../lib/product-images.mjs';
import { scorePerson } from './enrichment-service.mjs';
import { normalizeDomain } from '../lib/apollo-client.mjs';
import { getDomain } from 'tldts';

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function summarizeScreeningBatch(results = []) {
  const summary = {
    qualified: 0,
    excluded: 0,
    pending: 0,
    enriched: 0,
    companyMismatch: 0,
    contactNotFound: 0,
    failed: 0,
    queuedCompanies: 0,
    queuedEmails: 0,
    contactsFound: 0,
    contactsCreated: 0,
  };
  for (const result of results) {
    const enrichmentStatus = clean(result?.enrichment?.status || (
      result?.reason === 'prepare_failed' ? 'failed' : ''
    ));
    if (enrichmentStatus === 'enriched') summary.enriched += 1;
    if (enrichmentStatus === 'company_mismatch') summary.companyMismatch += 1;
    if (enrichmentStatus === 'contact_not_found') summary.contactNotFound += 1;
    if (enrichmentStatus === 'failed') summary.failed += 1;

    if (result?.decision?.qualified === true) summary.qualified += 1;
    else if (result?.decision?.qualified === false || result?.reason === 'not_precise') summary.excluded += 1;
    else summary.pending += 1;

    const contactCandidates = result?.enrichment?.contactCandidates;
    const contacts = result?.enrichment?.contacts;
    summary.contactsFound += Array.isArray(contactCandidates)
      ? contactCandidates.length
      : Array.isArray(contacts)
        ? contacts.length
        : result?.enrichment?.contact?.email ? 1 : 0;
    summary.contactsCreated += (result?.enrichment?.changes || []).filter((change) => (
      change?.entity === 'contact' && change?.field === 'create'
    )).length;
    if (result?.queued) summary.queuedCompanies += 1;
    summary.queuedEmails += Array.isArray(result?.jobs)
      ? result.jobs.filter((job) => job?.created !== false).length
      : Number(result?.queuedCount || 0);
  }
  return summary;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value).toLowerCase());
}

const COMPANY_EMAIL_LIMIT = 5;
const MIN_EMAIL_MODELS = 6;
const ACCEPTED_PRODUCT_IMAGE_SOURCES = new Set([
  'exact_model_asset',
  'exact_model_manifest',
  'base_model_asset',
]);
const SECOND_TOUCH_CAMPAIGN = 'second_touch_v1';
const imageReadyCatalogCache = new WeakMap();

function withProductImages(products, emailAssets) {
  return products.map((product) => ({
    ...product,
    ...getProductImage(product.model, emailAssets),
  }));
}

function imageReadyCatalog(catalog, emailAssets) {
  if (catalog && typeof catalog === 'object' && imageReadyCatalogCache.has(catalog)) {
    return imageReadyCatalogCache.get(catalog);
  }
  const ready = {
    ...catalog,
    entries: (catalog?.entries || []).filter((entry) => {
      const image = getProductImage(entry.model, emailAssets);
      return image.imageAvailable && ACCEPTED_PRODUCT_IMAGE_SOURCES.has(image.imageSource);
    }),
  };
  if (catalog && typeof catalog === 'object') imageReadyCatalogCache.set(catalog, ready);
  return ready;
}

export function selectEmailProducts({ recommendedProducts, catalog, limit, emailAssets }) {
  const selected = withProductImages(selectPricedModels({
    recommendedProducts,
    catalog,
    limit,
  }), emailAssets);
  if (selected.every((product) => (
    product.imageAvailable && ACCEPTED_PRODUCT_IMAGE_SOURCES.has(product.imageSource)
  ))) return selected;

  const alternatives = withProductImages(selectPricedModels({
    recommendedProducts,
    catalog: imageReadyCatalog(catalog, emailAssets),
    limit,
  }), emailAssets);
  return alternatives.length >= MIN_EMAIL_MODELS ? alternatives : selected;
}

export function addBusinessDays(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  let remaining = Math.max(Math.floor(Number(days) || 0), 0);
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) remaining -= 1;
  }
  return date;
}

export function secondTouchEligibleAt(sentAt, openCount, config = {}) {
  const delayDays = Number(openCount) >= 2
    ? Number(config.secondTouchMultiOpenDelayDays || 2)
    : Number(config.secondTouchSingleOpenDelayDays || 5);
  return addBusinessDays(sentAt, delayDays);
}

function recordExclusion(marketing, customer, candidate, reasonCode, reason, details = {}) {
  marketing.recordExclusion?.({
    customerId: customer.id,
    companyName: customer.companyName,
    country: customer.country,
    contactEmail: candidate?.contact?.email,
    reasonCode,
    reason,
    details,
  });
}

function decisionReason(decision) {
  return clean(decision?.reason) || '未提供具体判断依据';
}

export function screeningOutcome({ enrichment, decision }) {
  if (enrichment?.status === 'failed') {
    return {
      result: '待补全·背调失败',
      code: 'research_failed',
      reason: `未排除：Apollo 背调失败，等待重试。${clean(enrichment.error) || '未知错误'}`,
    };
  }
  if (decision?.qualified === false) {
    return {
      result: '明确排除·非精准',
      code: 'not_precise',
      reason: `非精准客户：${decisionReason(decision)}`,
    };
  }
  if (decision?.qualified !== true) {
    const analysisFailed = decision?.source === 'analysis_error';
    return {
      result: analysisFailed ? '待补全·AI分析失败' : '待核验',
      code: analysisFailed ? 'analysis_failed' : 'qualification_uncertain',
      reason: analysisFailed
        ? `未排除：AI 公司判断失败，等待重试。${decisionReason(decision)}`
        : `未排除：当前证据不足，等待补充公司资料。${decisionReason(decision)}`,
    };
  }
  if (enrichment?.status === 'company_mismatch') {
    return {
      result: '营销目标·待补全',
      code: 'company_mismatch',
      reason: `未排除：客户业务精准，但 Apollo 尚未匹配到正确公司及已验证关键联系人，继续补全。${decisionReason(decision)}`,
    };
  }
  if (enrichment?.status !== 'enriched') {
    return {
      result: '营销目标·待补全',
      code: clean(enrichment?.status) || 'contact_not_found',
      reason: `未排除：客户业务精准，但 Apollo 尚未找到可用关键联系人，继续补全。${decisionReason(decision)}`,
    };
  }
  return { result: '联系人与邮件质检中', code: '', reason: '' };
}

function reconstructInterruptedEnrichment(run, contacts = []) {
  const sources = run.details?.sources || [];
  const fallbackContact = run.contactEmail ? [{
    id: '', name: run.contactName || 'Apollo Contact', email: run.contactEmail,
    jobRole: '', linkedin: '',
  }] : [];
  const seenEmails = new Set();
  const availableContacts = [...contacts, ...fallbackContact].filter((item) => {
    const address = clean(item.email).toLowerCase();
    if (!address || seenEmails.has(address)) return false;
    seenEmails.add(address);
    return true;
  }).slice(0, COMPANY_EMAIL_LIMIT);
  const contactCandidates = availableContacts.map((contact, index) => ({
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
    contact: contactCandidates[0]?.contact || null,
    changes: run.changes,
    error: run.error,
    apolloOrgId: run.apolloOrgId,
  };
}

function recordId(record) {
  return record?.record_id || record?.recordId || record?.id || '';
}

export function websiteDecision(evidence, modelDraft) {
  if (evidence?.signals?.directFit) {
    return {
      qualified: true,
      reason: '客户官网直接展示 MEAN WELL，并包含工业自动化或电源产品证据。',
      source: 'official_website_direct_evidence',
    };
  }
  const reason = clean(modelDraft?.qualificationReason) || 'AI 未提供公司判断依据';
  if (modelDraft?.qualified === true) {
    return { qualified: true, reason, source: 'ai_with_website_evidence' };
  }
  if (modelDraft?.reviewRequired) {
    return {
      qualified: null,
      reason,
      source: 'insufficient_evidence',
    };
  }
  if (evidence?.status !== 'fetched' || clean(evidence?.text).length < 200) {
    return {
      qualified: null,
      reason: reason || '官网证据不足，暂不能判断是否为精准客户。',
      source: 'insufficient_evidence',
    };
  }
  return {
    qualified: false,
    reason,
    source: 'ai_with_website_evidence',
  };
}

function draftQuality({ enrichment, draft, autoApproveScore }) {
  const issues = [];
  const warnings = [];
  const subject = clean(draft.emailSubject);
  const body = clean(draft.emailBody);
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  if (!draft.qualified) issues.push('客户被 AI 判定为不适合营销');
  if (!draft.compliance?.approved) issues.push(...(draft.compliance?.issues || ['AI 合规检查未通过']));
  if (draft.reviewRequired && !draft.qualified) issues.push('AI 标记为需要核对');
  if (draft.reviewRequired && draft.qualified) warnings.push('AI 建议核对，但公司已判定为精准客户');
  if (!subject || subject.length > 100) issues.push('邮件主题为空或过长');
  if (wordCount < 70 || wordCount > 230) issues.push('邮件正文长度不在 70-230 词范围');
  if (/\{\{|\[\s*(name|company|email)\s*\]|<\s*(name|company|email)\s*>/i.test(`${subject}\n${body}`)) {
    issues.push('邮件仍包含未替换占位符');
  }
  const bodyWithoutGreeting = body.replace(/^dear\s+[^,\n]{1,120},?\s*/i, '').trim();
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(`${subject}\n${bodyWithoutGreeting}`)) {
    issues.push('英文邮件正文仍包含中文字符');
  }
  if (!validEmail(enrichment.contact?.email)) issues.push('收件邮箱格式无效');
  if (!enrichment.emailVerified) warnings.push('收件邮箱未标记为已验证，已通过格式和来源检查');
  if (enrichment.writebackError) issues.push(`Apollo 新信息回填孚盟失败：${enrichment.writebackError}`);
  if (enrichment.changes?.length && !enrichment.writebackApplied) issues.push('Apollo 新信息尚未回填孚盟');

  let score = Math.round(enrichment.confidence * 0.6);
  if (enrichment.emailVerified) score += 20;
  score += Math.min(scorePerson({
    title: enrichment.contact?.jobRole,
    linkedinUrl: enrichment.contact?.linkedin,
  }), 10);
  if (validEmail(enrichment.contact?.email)) score += 10;
  if (draft.qualified && draft.compliance?.approved) score += 10;
  score = Math.min(Math.max(score - Math.max(issues.length - 1, 0) * 5, 0), 100);
  const trustedContactSource = ['apollo_match', 'apollo_search', 'fumeng'].includes(clean(enrichment.source));
  const approved = issues.length === 0 && (
    score >= autoApproveScore ||
    (draft.qualified && trustedContactSource && validEmail(enrichment.contact?.email))
  );
  return { approved, score, issues, warnings, wordCount };
}

export class MarketingService {
  constructor({
    fumeng, enrichment, drafts, marketing, brevo, delivery = null, feishu = null,
    config, priceCatalog = null, onResearchPaused = null,
  }) {
    this.fumeng = fumeng;
    this.enrichment = enrichment;
    this.drafts = drafts;
    this.marketing = marketing;
    this.brevo = brevo;
    this.delivery = delivery;
    this.feishu = feishu;
    this.config = config;
    this.priceCatalog = priceCatalog;
    this.onResearchPaused = onResearchPaused;
  }

  async recoverIncompleteFeishuResearchAudits({ limit = 100 } = {}) {
    if (!this.feishu?.updateResearchRecord || !this.marketing.listIncompleteEnrichmentAudits) {
      return { found: 0, recovered: 0, failed: 0, failures: [] };
    }
    const runs = this.marketing.listIncompleteEnrichmentAudits({ limit });
    const summary = { found: runs.length, recovered: 0, failed: 0, failures: [] };
    for (const run of runs) {
      let customer = {
        id: run.customerId,
        companyName: run.companyName,
        country: '',
        website: run.details?.organization?.website || run.details?.organization?.domain || '',
      };
      let contacts = [];
      try {
        const [customerResult, contactsResult] = await Promise.allSettled([
          this.fumeng.getCustomer(run.customerId),
          this.fumeng.listContacts(run.customerId),
        ]);
        if (customerResult.status === 'fulfilled') customer = customerResult.value;
        if (contactsResult.status === 'fulfilled') contacts = contactsResult.value;
        const enrichment = reconstructInterruptedEnrichment(run, contacts);
        await this.feishu.updateResearchRecord(run.feishuRecordId, {
          customer,
          contacts,
          enrichment,
          screeningResult: '待补全·流程恢复',
          exclusionReason: '未排除：Apollo 背调已完成，但服务在 AI 筛选前中断；背调信息已自动补写，等待后续重新分析。',
        });
        this.marketing.attachEnrichmentFeishuRecord(run.id, {
          recordId: run.feishuRecordId,
          status: 'synced',
        });
        summary.recovered += 1;
      } catch (error) {
        this.marketing.attachEnrichmentFeishuRecord(run.id, {
          recordId: run.feishuRecordId,
          status: 'failed',
          error: error.message,
        });
        summary.failed += 1;
        summary.failures.push({
          customerId: run.customerId,
          companyName: run.companyName,
          error: error.message,
        });
      }
    }
    return summary;
  }

  async listCandidates({ limit = 10 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const items = [];
    let from = 0;
    let total = Number.POSITIVE_INFINITY;
    let scanned = 0;
    while (items.length < safeLimit && from < total) {
      const result = await this.fumeng.listCustomers({
        from, size: 50, scope: 'public', sortBy: 'lastTrack', sortDirection: 'asc',
      });
      total = Number(result.total || 0);
      scanned += result.items.length;
      for (const customer of result.items) {
        if (!isMarketableCustomerState(customer.customerStateId)) continue;
        if (this.marketing.hasRecentCustomerActivity(
          customer.id,
          this.config.marketing.companyCooldownDays,
        )) continue;
        items.push(customer);
        if (items.length >= safeLimit) break;
      }
      from += result.items.length;
      if (!result.items.length) break;
    }
    return { total: items.length, scanned, sourceTotal: Number.isFinite(total) ? total : 0, items };
  }

  async runDailyMarketing({
    companyLimit = this.config.marketing.dailyCompanyLimit || 300,
    researchLimit = this.config.marketing.dailyResearchLimit || 1000,
    allowWhenPaused = false,
  } = {}) {
    const batchStartedAt = new Date().toISOString();
    const targetCompanies = Math.min(Math.max(Number(companyLimit) || 300, 1), 300);
    const requestedResearch = Math.min(Math.max(Number(researchLimit) || 1000, 1), 1000);
    const dailySendLimit = this.config.marketing.dailySendLimit;
    const initialStats = this.marketing.getDailyMarketingStats?.() || {};
    const remainingDailyResearch = Math.max(
      Number(this.config.marketing.dailyResearchLimit || 1000) -
        Number(initialStats.apolloResearchToday || 0),
      0,
    );
    const maxResearch = Math.min(requestedResearch, remainingDailyResearch);
    if (this.config.marketing.enabled === false && !allowWhenPaused) {
      const stats = initialStats;
      return {
        paused: true,
        reason: 'marketing_disabled',
        targetCompanies,
        researchLimit: maxResearch,
        dailySendLimit,
        companiesMarketedToday: Number(stats.companiesMarketedToday || 0),
        emailsAllocatedToday: Number(stats.emailsAllocatedToday || 0),
        remainingEmailsToday: Math.max(dailySendLimit - Number(stats.emailsSentToday || 0), 0),
        researched: 0,
        scanned: 0,
        sourceTotal: 0,
        results: [],
      };
    }
    if (this.config.marketing.researchEnabled === false) {
      const stats = initialStats;
      return {
        paused: true,
        reason: this.config.marketing.researchPauseReason || 'apollo_research_paused',
        message: 'Apollo 背调已暂停；已有邮件队列仍可继续发送。',
        targetCompanies,
        researchLimit: 0,
        dailySendLimit,
        companiesMarketedToday: Number(stats.companiesMarketedToday || 0),
        emailsAllocatedToday: Number(stats.emailsAllocatedToday || 0),
        remainingEmailsToday: Math.max(dailySendLimit - Number(stats.emailsSentToday || 0), 0),
        researched: 0,
        scanned: 0,
        sourceTotal: 0,
        results: [],
      };
    }
    if (this.priceCatalog && !listProductImageModels(this.config.emailAssets).length) {
      const stats = initialStats;
      return {
        paused: true,
        reason: 'product_images_not_ready',
        message: '尚未上传任何具体型号产品图，暂不继续背调或排队。',
        targetCompanies,
        researchLimit: maxResearch,
        dailySendLimit,
        companiesMarketedToday: Number(stats.companiesMarketedToday || 0),
        emailsAllocatedToday: Number(stats.emailsAllocatedToday || 0),
        remainingEmailsToday: Math.max(dailySendLimit - Number(stats.emailsSentToday || 0), 0),
        researched: 0,
        scanned: 0,
        sourceTotal: 0,
        results: [],
      };
    }
    const results = [];
    let researched = 0;
    let scanned = 0;
    let sourceTotal = 0;
    let researchPauseReason = '';
    let researchPausePersistenceError = '';
    researchLoop: while (researched < maxResearch) {
      const stats = this.marketing.getDailyMarketingStats?.() || { companiesMarketedToday: 0 };
      if (Number(stats.companiesMarketedToday || 0) >= targetCompanies) break;
      const batchSize = Math.min(50, maxResearch - researched);
      const candidates = await this.listCandidates({ limit: batchSize });
      scanned += candidates.scanned;
      sourceTotal = candidates.sourceTotal;
      if (!candidates.items.length) break;
      for (const customer of candidates.items) {
        if (researched >= maxResearch) break;
        const current = this.marketing.getDailyMarketingStats?.() || { companiesMarketedToday: 0 };
        if (Number(current.companiesMarketedToday || 0) >= targetCompanies) break;
        researched += 1;
        try {
          results.push(await this.prepareCustomer({
            customerId: customer.id,
            researchWebsite: true,
            allowWhenPaused,
          }));
        } catch (error) {
          results.push({ queued: false, reason: 'prepare_failed', customerId: customer.id, error: error.message });
          if (error?.code === 'APOLLO_CREDITS_EXHAUSTED') {
            researchPauseReason = 'apollo_credits_exhausted';
            this.config.marketing.researchEnabled = false;
            this.config.marketing.researchPauseReason = researchPauseReason;
            try {
              await this.onResearchPaused?.({ reason: researchPauseReason, error });
            } catch (pauseError) {
              researchPausePersistenceError = pauseError.message;
            }
            break researchLoop;
          }
        }
      }
    }
    const finalStats = this.marketing.getDailyMarketingStats?.() || { companiesMarketedToday: 0 };
    const response = {
      targetCompanies,
      researchLimit: maxResearch,
      dailySendLimit,
      companiesMarketedToday: Number(finalStats.companiesMarketedToday || 0),
      emailsAllocatedToday: Number(finalStats.emailsAllocatedToday || 0),
      emailsSentToday: Number(finalStats.emailsSentToday || 0),
      remainingEmailsToday: Math.max(dailySendLimit - Number(finalStats.emailsSentToday || 0), 0),
      excludedToday: Number(finalStats.excludedToday || 0),
      remainingResearchToday: Math.max(
        Number(this.config.marketing.dailyResearchLimit || 1000) -
          Number(finalStats.apolloResearchToday || 0),
        0,
      ),
      researched,
      scanned,
      sourceTotal,
      results,
      researchPaused: Boolean(researchPauseReason),
      researchPauseReason,
      researchPausePersistenceError,
    };
    const screeningBatch = this.marketing.recordScreeningBatch?.({
      source: allowWhenPaused ? 'validation' : 'automatic',
      startedAt: batchStartedAt,
      completedAt: new Date().toISOString(),
      researched,
      scanned,
      ...summarizeScreeningBatch(results),
    }) || null;
    return { ...response, screeningBatch };
  }

  async prepareCustomer({ customerId, researchWebsite = true, allowWhenPaused = false } = {}) {
    if (!clean(customerId)) {
      throw new AppError('customerId 不能为空', { status: 400, code: 'VALIDATION_ERROR' });
    }
    if (this.config.marketing.enabled === false && !allowWhenPaused) {
      return { queued: false, reason: 'marketing_disabled' };
    }
    if (this.config.marketing.researchEnabled === false) {
      return {
        queued: false,
        reason: this.config.marketing.researchPauseReason || 'apollo_research_paused',
      };
    }
    if (!this.feishu?.createResearchRecord || !this.feishu?.updateResearchRecord) {
      throw new AppError('飞书背调审计未配置，禁止调用 Apollo', {
        status: 503,
        code: 'FEISHU_RESEARCH_AUDIT_REQUIRED',
      });
    }

    const [customer, contacts] = await Promise.all([
      this.fumeng.getCustomer(customerId),
      this.fumeng.listContacts(customerId),
    ]);
    let researchRecord;
    try {
      researchRecord = await this.feishu.createResearchRecord({ customer, contacts });
    } catch (error) {
      recordExclusion(this.marketing, customer, null, 'feishu_create_failed', `飞书背调建档失败，未调用 Apollo：${error.message}`);
      throw new AppError(`飞书背调建档失败，未调用 Apollo：${error.message}`, {
        status: 502,
        code: 'FEISHU_RESEARCH_CREATE_FAILED',
      });
    }
    const researchRecordId = recordId(researchRecord);
    if (!researchRecordId) {
      recordExclusion(this.marketing, customer, null, 'feishu_record_missing', '飞书背调建档未返回记录 ID，未调用 Apollo。');
      throw new AppError('飞书背调建档未返回记录 ID，未调用 Apollo', {
        status: 502,
        code: 'FEISHU_RESEARCH_RECORD_ID_MISSING',
      });
    }

    let enrichment;
    try {
      enrichment = await this.enrichment.enrich(customer, contacts);
    } catch (error) {
      const failed = { status: 'failed', customer, confidence: 0, changes: [], error: error.message };
      const outcome = screeningOutcome({ enrichment: failed });
      try {
        await this.feishu.updateResearchRecord(researchRecordId, {
          customer,
          contacts,
          enrichment: failed,
          screeningResult: outcome.result,
          exclusionReason: outcome.reason,
        });
        this.marketing.attachEnrichmentFeishuRecord?.(error.enrichmentRunId, {
          recordId: researchRecordId, status: 'synced',
        });
      } catch (syncError) {
        this.marketing.attachEnrichmentFeishuRecord?.(error.enrichmentRunId, {
          recordId: researchRecordId, status: 'failed', error: syncError.message,
        });
      }
      recordExclusion(this.marketing, customer, null, outcome.code, outcome.reason, { error: error.message });
      throw error;
    }
    this.marketing.attachEnrichmentFeishuRecord?.(enrichment.runId, {
      recordId: researchRecordId, status: 'created',
    });

    const minimumCompanyScore = Number(this.config.apollo?.minimumCompanyScore || 75);
    const trustedApolloWebsite = Number(enrichment.confidence || 0) >= minimumCompanyScore
      ? enrichment.organization?.website || enrichment.organization?.domain
      : '';
    const assessedCustomer = {
      ...(enrichment.customer || customer),
      website: (enrichment.customer || customer).website || trustedApolloWebsite || '',
      industry: (enrichment.customer || customer).industry || enrichment.organization?.industry || '',
    };
    const websiteEvidence = researchWebsite && this.drafts.researchCompany
      ? await this.drafts.researchCompany(assessedCustomer)
      : undefined;
    const candidates = (enrichment.contactCandidates || (enrichment.contact?.email ? [{
      contact: enrichment.contact,
      person: enrichment.person,
      emailVerified: enrichment.emailVerified,
      changes: enrichment.changes,
      writebackApplied: enrichment.writebackApplied,
    }] : [])).filter((item) => item.contact?.email).slice(0, COMPANY_EMAIL_LIMIT);
    const analysisContact = candidates[0]?.contact || contacts.find((item) => item.email) || {
      id: '', name: '', email: '', jobRole: '',
    };
    let firstBundle;
    let decision;
    try {
      firstBundle = await this.drafts.analyzeCompanyFromData({
        customer: assessedCustomer,
        contact: analysisContact,
        researchWebsite,
        websiteEvidence,
        organizationEvidence: enrichment.organization,
      });
      decision = websiteDecision(websiteEvidence, firstBundle.draft);
    } catch (error) {
      decision = {
        qualified: null,
        reason: `AI 公司判断失败：${error.message}`,
        source: 'analysis_error',
      };
    }
    const firstDraft = firstBundle?.draft
      ? decision.qualified === true
        ? { ...firstBundle.draft, qualified: true, qualificationReason: decision.reason }
        : firstBundle.draft
      : undefined;
    const preliminaryOutcome = screeningOutcome({ enrichment, decision });
    try {
      await this.feishu.updateResearchRecord(researchRecordId, {
        customer: assessedCustomer,
        contacts,
        enrichment,
        websiteEvidence,
        decision,
        draft: firstDraft,
        screeningResult: preliminaryOutcome.result,
        exclusionReason: preliminaryOutcome.reason,
      });
      this.marketing.attachEnrichmentFeishuRecord?.(enrichment.runId, {
        recordId: researchRecordId, status: 'synced',
      });
    } catch (error) {
      this.marketing.attachEnrichmentFeishuRecord?.(enrichment.runId, {
        recordId: researchRecordId, status: 'failed', error: error.message,
      });
      recordExclusion(
        this.marketing,
        customer,
        null,
        'feishu_update_failed',
        `Apollo 已完成，但飞书背调更新失败：${error.message}`,
      );
      throw new AppError(`Apollo 已完成，但飞书背调更新失败：${error.message}`, {
        status: 502,
        code: 'FEISHU_RESEARCH_UPDATE_FAILED',
      });
    }

    if (decision.qualified === false) {
      recordExclusion(this.marketing, customer, null, preliminaryOutcome.code, preliminaryOutcome.reason, {
        qualificationReason: decision.reason,
        website: websiteEvidence?.finalUrl || assessedCustomer.website,
        matchedTerms: websiteEvidence?.signals?.matchedTerms || [],
      });
      return {
        queued: false,
        reason: 'not_precise',
        enrichment,
        decision,
        researchRecordId,
        websiteEvidence,
      };
    }
    if (decision.qualified !== true) {
      recordExclusion(this.marketing, customer, null, preliminaryOutcome.code, preliminaryOutcome.reason, {
        qualificationReason: decision.reason,
        website: websiteEvidence?.finalUrl || assessedCustomer.website,
      });
      return {
        queued: false,
        reason: decision.source === 'analysis_error' ? 'analysis_failed' : 'qualification_uncertain',
        enrichment,
        decision,
        researchRecordId,
        websiteEvidence,
      };
    }

    this.marketing.resolveCompanyExclusions?.(customer.id, decision.reason);
    if (enrichment.status !== 'enriched' || !candidates.length) {
      const outcome = enrichment.status !== 'enriched'
        ? preliminaryOutcome
        : {
            result: '营销目标·待补全',
            code: 'contact_not_found',
            reason: '未排除：客户业务精准，但尚未找到可用联系人邮箱，继续补全。',
          };
      recordExclusion(this.marketing, customer, null, outcome.code, outcome.reason, {
        qualificationReason: decision.reason,
      });
      if (outcome.reason !== preliminaryOutcome.reason) {
        await this.feishu.updateResearchRecord(researchRecordId, {
          customer: assessedCustomer,
          contacts,
          enrichment,
          websiteEvidence,
          decision,
          draft: firstDraft,
          screeningResult: outcome.result,
          exclusionReason: outcome.reason,
        });
      }
      return {
        queued: false,
        reason: enrichment.status,
        enrichment,
        decision,
        researchRecordId,
        websiteEvidence,
      };
    }

    const productsWithImages = this.priceCatalog
      ? selectEmailProducts({
          recommendedProducts: firstDraft?.recommendedProducts || [],
          catalog: this.priceCatalog,
          limit: this.config.pricing?.maxEmailModels || 8,
          emailAssets: this.config.emailAssets,
        })
      : [];
    if (this.priceCatalog && !this.priceCatalog.entries?.length) {
      const reason = `未排除：客户业务精准且联系人可用，但报价目录不可用，暂不发送。${this.priceCatalog.error || '报价目录没有有效型号。'}`;
      recordExclusion(this.marketing, customer, null, 'price_catalog_unavailable', reason, {
        qualificationReason: decision.reason,
        priceCatalogError: this.priceCatalog.error || 'empty',
      });
      await this.feishu.updateResearchRecord(researchRecordId, {
        customer: assessedCustomer, contacts, enrichment, websiteEvidence, decision, draft: firstDraft,
        screeningResult: '营销目标·待补全', exclusionReason: reason,
      });
      return { queued: false, reason: 'price_catalog_unavailable', enrichment, decision, researchRecordId, websiteEvidence };
    }
    const missingProductImages = productsWithImages.filter((product) => !product.imageAvailable);
    if (this.priceCatalog && missingProductImages.length) {
      const missingModels = missingProductImages.map((product) => product.model).join(', ');
      const reason = `未排除：客户业务精准且联系人可用，但报价型号缺少对应的具体产品图，暂不发送。待补充型号：${missingModels}。图片不能用系列横幅或分类代表图代替。`;
      recordExclusion(this.marketing, customer, null, 'product_images_missing', reason, {
        qualificationReason: decision.reason,
        missingModels: missingProductImages.map((product) => product.model),
        matchedModels: productsWithImages.filter((product) => product.imageAvailable).map((product) => product.model),
      });
      await this.feishu.updateResearchRecord(researchRecordId, {
        customer: assessedCustomer, contacts, enrichment, websiteEvidence, decision, draft: firstDraft,
        screeningResult: '营销目标·待补全', exclusionReason: reason,
      });
      return {
        queued: false,
        reason: 'product_images_missing',
        missingModels: missingProductImages.map((product) => product.model),
        pricedProducts: productsWithImages,
        enrichment,
        decision,
        researchRecordId,
        websiteEvidence,
      };
    }
    if (this.priceCatalog && productsWithImages.length < MIN_EMAIL_MODELS) {
      const reason = `未排除：客户业务精准且联系人可用，但 AI 推荐只匹配到 ${productsWithImages.length} 个型号，少于首封邮件要求的 ${MIN_EMAIL_MODELS}-${this.config.pricing?.maxEmailModels || 8} 个型号，暂不发送。`;
      recordExclusion(this.marketing, customer, null, 'price_models_insufficient', reason, {
        recommendedProducts: firstDraft?.recommendedProducts || [],
        matchedModels: productsWithImages.map((product) => product.model),
      });
      await this.feishu.updateResearchRecord(researchRecordId, {
        customer: assessedCustomer, contacts, enrichment, websiteEvidence, decision, draft: firstDraft,
        screeningResult: '营销目标·待补全', exclusionReason: reason,
      });
      return {
        queued: false,
        reason: 'price_models_insufficient',
        enrichment,
        decision,
        researchRecordId,
        websiteEvidence,
        pricedProducts: productsWithImages,
      };
    }
    const queuedJobs = [];
    const excluded = [];
    const contactOutcomes = [];
    const customerDomain = getDomain(normalizeDomain(
      assessedCustomer.website || enrichment.organization?.domain,
    )) || '';
    for (const [index, candidate] of candidates.entries()) {
      if (!this.marketing.canContact({
        customerId: customer.id,
        recipient: candidate.contact.email,
        domain: customerDomain,
        cooldownDays: this.config.marketing.companyCooldownDays,
        companyEmailLimit: COMPANY_EMAIL_LIMIT,
      })) {
        excluded.push({ candidate, reason: 'duplicate_or_company_limit' });
        contactOutcomes.push({ email: candidate.contact.email, status: '未入队', reason: '邮箱已营销过或公司已达到 5 个联系人上限' });
        continue;
      }

      const candidateEnrichment = {
        ...enrichment,
        contact: candidate.contact,
        person: candidate.person,
        emailVerified: candidate.emailVerified,
        source: candidate.source,
        changes: candidate.changes,
        writebackApplied: candidate.writebackApplied,
      };
      let bundle;
      try {
        bundle = index === 0
          ? { ...(firstBundle || {}), draft: firstDraft }
          : await this.drafts.generateFromData({
              customer: assessedCustomer,
              contact: candidate.contact,
              researchWebsite,
              websiteEvidence,
              qualificationDecision: decision,
              organizationEvidence: enrichment.organization,
            });
      } catch (error) {
        const reason = `AI 邮件生成失败：${error.message}`;
        excluded.push({ candidate, reason: 'draft_generation_failed' });
        contactOutcomes.push({ email: candidate.contact.email, status: '未入队', reason });
        continue;
      }
      const quality = draftQuality({
        enrichment: candidateEnrichment,
        draft: bundle.draft,
        autoApproveScore: this.config.marketing.autoApproveScore,
      });
      if (!quality.approved) {
        const reason = `联系人或邮件质检未通过：${quality.issues.join('；')}`;
        excluded.push({ candidate, reason: 'contact_quality_failed', quality });
        contactOutcomes.push({ email: candidate.contact.email, status: '未入队', reason });
        continue;
      }
      const feishuRecordId = researchRecordId;
      const customerCountryCode = resolveCountryCode(
        assessedCustomer.country,
        assessedCustomer.countryCode || enrichment.organization?.countryCode,
      );
      const organizationCountryCode = resolveCountryCode(
        enrichment.organization?.country,
        enrichment.organization?.countryCode,
      );
      const organizationLocation = !organizationCountryCode || organizationCountryCode === customerCountryCode
        ? { state: enrichment.organization?.state, city: enrichment.organization?.city }
        : {};
      const timeZone = resolveTimeZone(
        assessedCustomer.country,
        customerCountryCode,
        organizationLocation,
      );
      if (!timeZone) {
        const reason = '客户国家无法匹配可靠时区，暂不发送，等待补充国家信息。';
        excluded.push({ candidate, reason: 'timezone_missing' });
        contactOutcomes.push({ email: candidate.contact.email, status: '未入队', reason });
        continue;
      }
      const jitterMinutes = [...String(customer.id + candidate.contact.email)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 45;
      const scheduledAt = nextSendTime({
        timeZone,
        startHour: this.config.marketing.sendWindowStartHour,
        endHour: this.config.marketing.sendWindowEndHour,
        jitterMinutes,
      });
      const htmlContent = buildFirstTouchEmailHtml({
        body: bundle.draft.emailBody,
        sales: this.config.sales,
        customer: assessedCustomer,
        contact: candidate.contact,
        pricedProducts: productsWithImages,
        priceListDate: this.priceCatalog?.generatedDate || '',
      });
      const textContent = buildFirstTouchEmailText({
        body: bundle.draft.emailBody,
        sales: this.config.sales,
        customer: assessedCustomer,
        contact: candidate.contact,
        pricedProducts: productsWithImages,
        priceListDate: this.priceCatalog?.generatedDate || '',
      });
      const result = this.marketing.enqueue({
        source: 'fumeng',
        sourceId: customer.id,
        domain: customerDomain,
        customerId: customer.id,
        contactId: candidate.contact.id,
        companyName: customer.companyName,
        contactName: candidate.contact.name,
        email: candidate.contact.email,
        country: assessedCustomer.country,
        timeZone,
        subject: bundle.draft.emailSubject,
        htmlContent,
        textContent,
        status: 'queued',
        score: quality.score,
        scheduledAt,
        apollo: {
          organizationId: enrichment.organization?.id,
          personId: candidate.person?.id,
          confidence: enrichment.confidence,
          emailVerified: candidate.emailVerified,
        },
        draft: { ...bundle.draft, pricing: { priceListDate: this.priceCatalog?.generatedDate || '', products: productsWithImages } },
        writeback: { applied: candidate.writebackApplied, changes: candidate.changes },
        feishuRecordId,
      });
      queuedJobs.push({ ...result, quality, feishuRecordId, contact: candidate.contact });
      contactOutcomes.push({ email: candidate.contact.email, status: '已排队', reason: `关联公司记录 ${feishuRecordId}` });
    }

    const queued = queuedJobs.length > 0;
    const finalExclusionReason = queued
      ? ''
      : `未排除：客户业务精准，但尚未找到通过联系人、邮箱和邮件质检的收件人，系统继续补全。当前问题：${[
          ...new Set(contactOutcomes.map((item) => item.reason).filter(Boolean)),
        ].join('；') || '无可用联系人'}`;
    if (!queued) {
      recordExclusion(this.marketing, customer, null, 'contact_quality_failed', finalExclusionReason, {
        contactOutcomes,
        qualificationReason: decision.reason,
      });
    }
    await this.feishu.updateResearchRecord(researchRecordId, {
      customer: assessedCustomer,
      contacts,
      enrichment,
      websiteEvidence,
      decision,
      draft: firstDraft,
      contactOutcomes,
      screeningResult: queued ? '已进入营销队列' : '营销目标·待补全',
      exclusionReason: finalExclusionReason,
    });
    return {
      queued: queuedJobs.length > 0,
      queuedCount: queuedJobs.length,
      excludedCount: excluded.length,
      quality: queuedJobs[0]?.quality || excluded[0]?.quality,
      enrichment,
      decision,
      researchRecordId,
      feishuRecordId: queuedJobs[0]?.feishuRecordId || '',
      jobs: queuedJobs,
      excluded,
      ...(queuedJobs[0] || {}),
    };
  }

  async queueManualDraft({ customer, contact, draft, feishuRecordId }) {
    const timeZone = resolveTimeZone(customer.country, customer.countryCode);
    if (!timeZone) {
      throw new AppError('邮件暂未排队：客户国家无法匹配可靠时区，请先补充国家信息', {
        status: 422,
        code: 'TIMEZONE_MISSING',
      });
    }
    const jitterMinutes = [...String(customer.id)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 45;
    const scheduledAt = nextSendTime({
      timeZone,
      startHour: this.config.marketing.sendWindowStartHour,
      endHour: this.config.marketing.sendWindowEndHour,
      jitterMinutes,
    });
    const productsWithImages = this.priceCatalog
      ? selectEmailProducts({
          recommendedProducts: draft.recommendedProducts || [],
          catalog: this.priceCatalog,
          limit: this.config.pricing?.maxEmailModels || 8,
          emailAssets: this.config.emailAssets,
        })
      : [];
    if (this.priceCatalog && productsWithImages.some((product) => !product.imageAvailable)) {
      throw new AppError('邮件暂未排队：报价型号缺少对应的具体产品图，请先补充型号图片', {
        status: 422,
        code: 'PRODUCT_IMAGES_MISSING',
        details: { missingModels: productsWithImages.filter((product) => !product.imageAvailable).map((product) => product.model) },
      });
    }
    const htmlContent = buildFirstTouchEmailHtml({
      body: draft.emailBody,
      sales: this.config.sales,
      customer,
      contact,
      pricedProducts: productsWithImages,
      priceListDate: this.priceCatalog?.generatedDate || '',
    });
    const textContent = buildFirstTouchEmailText({
      body: draft.emailBody,
      sales: this.config.sales,
      customer,
      contact,
      pricedProducts: productsWithImages,
      priceListDate: this.priceCatalog?.generatedDate || '',
    });
    const existing = this.marketing.findLatestJob?.({ customerId: customer.id, recipient: contact.email });
    if (existing) {
      return {
        created: false,
        job: this.marketing.attachFeishuRecord(existing.id, {
          recordId: feishuRecordId,
          subject: draft.emailSubject,
          htmlContent,
          textContent,
          scheduledAt,
          status: 'queued',
        }),
      };
    }
    return this.marketing.enqueue({
      customerId: customer.id,
      contactId: contact.id,
      companyName: customer.companyName,
      contactName: contact.name,
      email: contact.email,
      country: customer.country,
      timeZone,
      subject: draft.emailSubject,
      htmlContent,
      textContent,
      status: 'queued',
      score: 0,
      scheduledAt,
      draft: { ...draft, pricing: { priceListDate: this.priceCatalog?.generatedDate || '', products: productsWithImages } },
      feishuRecordId,
    });
  }

  getSecondTouchCandidates({ now = new Date() } = {}) {
    if (!this.delivery?.listOpenedRecipients || !this.marketing?.findJobByMessageId) return [];
    const current = new Date(now);
    const candidates = [];
    for (const engagement of this.delivery.listOpenedRecipients({ limit: 10_000 })) {
      const firstJob = this.marketing.findJobByMessageId(engagement.messageId);
      if (!firstJob || firstJob.source === 'liverno' ||
          firstJob.campaign !== 'initial_outreach_v1' || firstJob.status !== 'sent') continue;
      if (this.marketing.isSuppressed?.(firstJob.email)) continue;
      const eligibleAt = secondTouchEligibleAt(firstJob.sentAt, engagement.openCount, this.config.marketing);
      if (!eligibleAt || eligibleAt > current) continue;
      const existing = this.marketing.findCampaignJob?.({
        campaign: SECOND_TOUCH_CAMPAIGN,
        customerId: firstJob.customerId,
        recipient: firstJob.email,
      }) || null;
      candidates.push({ engagement, firstJob, eligibleAt: eligibleAt.toISOString(), existing });
    }
    candidates.sort((left, right) => (
      right.engagement.openCount - left.engagement.openCount ||
      left.eligibleAt.localeCompare(right.eligibleAt) ||
      right.engagement.lastOpenAt.localeCompare(left.engagement.lastOpenAt)
    ));
    const selected = [];
    const companyCounts = new Map();
    const maxPerCompany = Number(this.config.marketing.secondTouchMaxContactsPerCompany || 2);
    for (const candidate of candidates) {
      const companyKey = candidate.firstJob.customerId || candidate.firstJob.companyName;
      const count = companyCounts.get(companyKey) || 0;
      if (count >= maxPerCompany) continue;
      companyCounts.set(companyKey, count + 1);
      selected.push(candidate);
    }
    return selected;
  }

  getSecondTouchDashboard({ now = new Date() } = {}) {
    const summary = this.marketing.getCampaignSummary?.(SECOND_TOUCH_CAMPAIGN) || {
      total: 0, queued: 0, sent: 0, failed: 0, byStatus: {},
    };
    const candidates = this.getSecondTouchCandidates({ now });
    const pilotLimit = Number(this.config.marketing.secondTouchPilotLimit || 50);
    return {
      enabled: this.config.marketing.secondTouchEnabled === true,
      campaign: SECOND_TOUCH_CAMPAIGN,
      pilotLimit,
      eligible: candidates.length,
      readyToQueue: candidates.filter((candidate) => !candidate.existing).length,
      queued: summary.queued,
      sent: summary.sent,
      failed: summary.failed,
      total: summary.total,
      remainingPilot: Math.max(pilotLimit - summary.total, 0),
    };
  }

  getSecondTouchProducts(firstJob) {
    const storedProducts = (firstJob.draft?.pricing?.products || []).slice(0, 4);
    let products = storedProducts;
    if (this.priceCatalog?.entries?.length) {
      const imageByModel = new Map(storedProducts.map((product) => [clean(product.model).toUpperCase(), product]));
      products = selectPricedModels({
        recommendedProducts: storedProducts.map((product) => ({
          name: product.model,
          reason: product.recommendation || '',
        })),
        catalog: this.priceCatalog,
        limit: 4,
      }).map((product) => {
        const stored = imageByModel.get(clean(product.model).toUpperCase()) || {};
        return {
          ...product,
          imageUrl: stored.imageUrl || '',
          imageLabel: stored.imageLabel || '',
          imagePath: stored.imagePath || '',
          imageAvailable: Boolean(stored.imageAvailable),
          imageSource: stored.imageSource || '',
          missingReason: stored.missingReason || '',
        };
      });
    }
    return products.filter((product) => (
      clean(product.currency).toUpperCase() === 'USD' &&
      product.imageAvailable &&
      ACCEPTED_PRODUCT_IMAGE_SOURCES.has(product.imageSource)
    )).slice(0, 4);
  }

  queueSecondTouch({ now = new Date(), limit } = {}) {
    const dashboard = this.getSecondTouchDashboard({ now });
    if (!dashboard.enabled) return { ...dashboard, created: 0, skipped: 'second_touch_disabled', jobs: [] };
    const safeLimit = Math.min(
      Math.max(Number(limit) || dashboard.pilotLimit, 1),
      dashboard.remainingPilot,
    );
    const jobs = [];
    const skipped = [];
    let refreshed = 0;
    const candidates = this.getSecondTouchCandidates({ now });
    for (const candidate of candidates) {
      const { engagement, firstJob } = candidate;
      const products = this.getSecondTouchProducts(firstJob);
      if (products.length < 4) {
        skipped.push({ firstJobId: firstJob.id, reason: 'four_product_images_required' });
        continue;
      }
      const customer = {
        companyName: firstJob.companyName,
        country: firstJob.country,
        countryEnglish: firstJob.draft?.country,
        industry: firstJob.draft?.industry,
      };
      const contact = { name: firstJob.contactName, email: firstJob.email };
      const jitterMinutes = [...String(firstJob.customerId + firstJob.email)]
        .reduce((sum, character) => sum + character.charCodeAt(0), 0) % 45;
      const scheduledAt = nextSendTime({
        from: new Date(Math.max(new Date(now).getTime(), new Date(candidate.eligibleAt).getTime())),
        timeZone: firstJob.timeZone,
        startHour: this.config.marketing.sendWindowStartHour,
        endHour: this.config.marketing.sendWindowEndHour,
        jitterMinutes,
      });
      if (!scheduledAt) {
        skipped.push({ firstJobId: firstJob.id, reason: 'timezone_missing' });
        continue;
      }
      const subject = buildSecondTouchSubject({ customer });
      const templateInput = {
        sales: this.config.sales,
        customer,
        contact,
        draft: firstJob.draft,
        pricedProducts: products,
        priceListDate: this.priceCatalog?.generatedDate || firstJob.draft?.pricing?.priceListDate || '',
      };
      const secondTouchDraft = {
        ...firstJob.draft,
        touchNumber: 2,
        sourceJobId: firstJob.id,
        sourceOpenCount: engagement.openCount,
        pricing: {
          ...(firstJob.draft?.pricing || {}),
          priceListDate: this.priceCatalog?.generatedDate || firstJob.draft?.pricing?.priceListDate || '',
          products,
        },
      };
      if (candidate.existing) {
        const htmlContent = buildSecondTouchEmailHtml(templateInput);
        const textContent = buildSecondTouchEmailText(templateInput);
        const contentChanged = candidate.existing.subject !== subject ||
          candidate.existing.htmlContent !== htmlContent ||
          candidate.existing.textContent !== textContent ||
          JSON.stringify(candidate.existing.draft) !== JSON.stringify(secondTouchDraft);
        const updated = contentChanged
          ? this.marketing.updateQueuedContent?.(candidate.existing.id, {
              subject, htmlContent, textContent, draft: secondTouchDraft,
            })
          : null;
        if (updated) refreshed += 1;
        continue;
      }
      if (jobs.length >= safeLimit) continue;
      const result = this.marketing.enqueue({
        campaign: SECOND_TOUCH_CAMPAIGN,
        customerId: firstJob.customerId,
        contactId: firstJob.contactId,
        companyName: firstJob.companyName,
        contactName: firstJob.contactName,
        email: firstJob.email,
        country: firstJob.country,
        timeZone: firstJob.timeZone,
        subject,
        htmlContent: buildSecondTouchEmailHtml(templateInput),
        textContent: buildSecondTouchEmailText(templateInput),
        status: 'queued',
        score: firstJob.score,
        scheduledAt,
        apollo: firstJob.apollo,
        draft: secondTouchDraft,
        writeback: firstJob.writeback,
        feishuRecordId: firstJob.feishuRecordId,
      });
      if (result.created) jobs.push({
        id: result.job.id,
        campaign: result.job.campaign,
        customerId: result.job.customerId,
        scheduledAt: result.job.scheduledAt,
      });
    }
    const updated = this.getSecondTouchDashboard({ now });
    return {
      ...updated,
      created: jobs.length,
      refreshed,
      jobs,
      skipped,
      ...(!safeLimit && !refreshed ? { skippedReason: 'pilot_limit_reached' } : {}),
    };
  }

  async sendDue({ limit = 10, now = new Date() } = {}) {
    if (this.config.marketing.enabled === false) {
      return { reserved: 0, sent: 0, failed: 0, cancelled: 0, skipped: 'marketing_disabled', results: [] };
    }
    if (!this.config.brevo.sendingEnabled) {
      return { reserved: 0, sent: 0, failed: 0, cancelled: 0, skipped: 'sending_disabled', results: [] };
    }
    let secondTouch;
    try {
      secondTouch = this.queueSecondTouch({ now });
    } catch (error) {
      secondTouch = { created: 0, error: error.message };
    }
    try {
      await this.brevo.checkAccess?.();
    } catch (error) {
      return {
        reserved: 0,
        sent: 0,
        failed: 0,
        cancelled: 0,
        skipped: 'brevo_access_blocked',
        error: error.message,
        results: [],
      };
    }
    const recovered = this.marketing.recoverBrevoAuthFailures?.() || 0;
    const jobs = this.marketing.reserveDue({
      limit,
      dailyLimit: this.config.marketing.dailySendLimit,
      now,
      isEligible: (job) => job.source !== 'liverno' && isInsideSendWindow(now, job.timeZone, {
        startHour: this.config.marketing.sendWindowStartHour,
        endHour: this.config.marketing.sendWindowEndHour,
      }),
    });
    const results = [];
    for (const [index, job] of jobs.entries()) {
      try {
        if (this.marketing.isSuppressed(job.email)) {
          results.push({ id: job.id, status: 'cancelled', reason: 'suppressed' });
          this.marketing.markCancelled(job.id, 'Recipient is suppressed');
          continue;
        }
        if (this.priceCatalog && !job.draft?.pricing?.products?.length) {
          const reason = '旧版邮件任务未使用当前报价模板，已取消，避免发送过期内容。';
          this.marketing.markCancelled(job.id, reason);
          results.push({ id: job.id, status: 'cancelled', reason: 'legacy_template' });
          continue;
        }
        if (this.priceCatalog && job.draft?.pricing?.products?.some((product) => (
          !product.imageAvailable || !ACCEPTED_PRODUCT_IMAGE_SOURCES.has(product.imageSource)
        ))) {
          const reason = '邮件任务缺少具体型号产品图，已取消，避免把系列横幅或分类图当作型号实物图发送。';
          this.marketing.markCancelled(job.id, reason);
          results.push({ id: job.id, status: 'cancelled', reason: 'product_images_missing' });
          continue;
        }
        if (this.feishu?.getDraftRecord && !job.feishuRecordId) {
          this.marketing.deferJob(job.id, '等待绑定飞书记录', new Date(Date.now() + 15 * 60_000).toISOString());
          results.push({ id: job.id, status: 'deferred', reason: 'feishu_record_missing' });
          continue;
        }
        const [customer, contacts] = await Promise.all([
          this.fumeng.getCustomer(job.customerId),
          this.fumeng.listContacts(job.customerId),
        ]);
        if (!isMarketableCustomerState(customer.customerStateId)) {
          this.marketing.markCancelled(job.id, `Customer state changed to ${customer.customerState || customer.customerStateId}`);
          results.push({ id: job.id, status: 'cancelled', reason: 'customer_not_eligible' });
          continue;
        }
        const contact = contacts.find((item) => item.id === job.contactId) ||
          contacts.find((item) => clean(item.email).toLowerCase() === job.email);
        if (!contact) {
          this.marketing.markCancelled(job.id, 'Recipient no longer exists in Fumeng');
          results.push({ id: job.id, status: 'cancelled', reason: 'contact_missing' });
          continue;
        }
        const sent = await this.brevo.send({
          to: job.email,
          toName: job.contactName,
          subject: job.subject,
          htmlContent: job.htmlContent,
          textContent: job.textContent,
          customerId: job.customerId,
          jobId: job.id,
          campaign: job.campaign,
        });
        const sentAt = new Date();
        this.marketing.markSent(job.id, sent.messageId, sentAt.toISOString());
        if (this.delivery?.recordSent) {
          try {
            this.delivery.recordSent({
              messageId: sent.messageId,
              email: job.email,
              subject: job.subject,
              occurredAt: sentAt.toISOString(),
              recordId: job.feishuRecordId,
              customerId: job.customerId,
              campaign: job.campaign,
            });
            this.marketing.addEvent(job.id, 'delivery_status_recorded');
          } catch (error) {
            this.marketing.addEvent(job.id, 'delivery_status_record_failed', error.message);
          }
        }
        if (this.feishu?.updateSendStatus && job.feishuRecordId) {
          try {
            await this.feishu.updateSendStatus(job.feishuRecordId, {
              status: '已发送', sentAt,
            });
            this.marketing.addEvent(job.id, 'feishu_send_status_updated');
          } catch (error) {
            this.marketing.addEvent(job.id, 'feishu_send_status_update_failed', error.message);
          }
        }
        if (this.config.fumeng.writebackEnabled) {
          try {
            await this.fumeng.addEmailFollowup({
              customer, contact, subject: job.subject, sentAt: new Date(), messageId: sent.messageId,
            });
            this.marketing.addEvent(job.id, 'fumeng_followup_created');
          } catch (error) {
            this.marketing.addEvent(job.id, 'fumeng_followup_failed', error.message);
          }
        }
        results.push({ id: job.id, status: 'sent', messageId: sent.messageId });
      } catch (error) {
        const upstreamStatus = Number(error?.details?.httpStatus || 0);
        if (error?.code === 'BREVO_ACCESS_BLOCKED' || [401, 403].includes(upstreamStatus)) {
          const retryAt = new Date(Date.now() + 15 * 60_000).toISOString();
          for (const reservedJob of jobs.slice(index)) {
            this.marketing.deferJob(
              reservedJob.id,
              `Brevo 账户级授权异常：${error.message}`,
              retryAt,
              { restoreAttempt: true },
            );
            results.push({ id: reservedJob.id, status: 'deferred', error: error.message });
          }
          break;
        }
        const updated = this.marketing.markFailed(job.id, error);
        results.push({ id: job.id, status: updated?.status || 'failed', error: error.message });
      }
    }
    return {
      reserved: jobs.length,
      sent: results.filter((item) => item.status === 'sent').length,
      failed: results.filter((item) => ['failed', 'retry'].includes(item.status)).length,
      cancelled: results.filter((item) => item.status === 'cancelled').length,
      recovered,
      secondTouch,
      results,
    };
  }
}

export { draftQuality };
