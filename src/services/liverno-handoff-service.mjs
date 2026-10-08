import { getDomain } from 'tldts';
import { AppError } from '../lib/errors.mjs';
import { buildFirstTouchEmailHtml, buildFirstTouchEmailText } from '../lib/email-composer.mjs';
import { nextSendTime, resolveTimeZone } from '../lib/scheduling.mjs';
import { draftQuality, selectEmailProducts } from './marketing-service.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_SOURCES = new Set(['exact_model_asset', 'exact_model_manifest', 'base_model_asset']);
const FUMENG_SCAN_LIMIT = 100;
const FUMENG_SCAN_DEADLINE_MS = 65_000;

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function summary(customer) {
  return {
    source: customer.source,
    sourceId: customer.sourceId,
    researchId: customer.researchId,
    qualificationStatus: customer.qualificationStatus,
    marketingCustomerId: customer.id,
    fumengCustomerId: customer.fumengCustomerId,
    status: customer.handoffStatus,
    jobId: customer.jobId,
    failureReason: customer.failureReason,
  };
}

export class LivernoHandoffService {
  constructor({ research, marketing, apollo, drafts, config, priceCatalog, fumeng }) {
    this.research = research;
    this.marketing = marketing;
    this.apollo = apollo;
    this.drafts = drafts;
    this.config = config;
    this.priceCatalog = priceCatalog;
    this.fumeng = fumeng;
    this.dedupChecks = new Map();
  }

  async checkCrossSource(sourceId) {
    if (!UUID.test(String(sourceId || ''))) {
      throw new AppError('Invalid Liverno Enterprise ID', { status: 400, code: 'INVALID_SOURCE_ID' });
    }
    const pending = this.dedupChecks.get(sourceId);
    if (pending) return pending;
    const check = this.runCrossSourceCheck(sourceId);
    this.dedupChecks.set(sourceId, check);
    try {
      return await check;
    } finally {
      this.dedupChecks.delete(sourceId);
    }
  }

  async runCrossSourceCheck(sourceId) {
    const record = this.research.getBySource('liverno', sourceId);
    if (!record) throw new AppError('Research record not found', { status: 404, code: 'NOT_FOUND' });
    const domain = getDomain(record.domain);
    if (!domain || domain !== getDomain(record.company?.domain)) {
      return { status: 'unknown', reason: 'identity_domain_mismatch' };
    }
    const customer = this.marketing.getMarketingCustomer('liverno', sourceId);
    const recipient = customer ? this.marketing.findLivernoJob(customer.id)?.email || '' : '';
    if (this.marketing.findLivernoConflict({ sourceId, domain, recipient }) ||
        (recipient && this.marketing.isSuppressed(recipient))) {
      return { status: 'duplicate', reason: 'local_marketing_or_suppression' };
    }
    if (!this.fumeng?.listCustomers) return { status: 'unknown', reason: 'fumeng_unavailable' };

    const name = normalizedName(record.company?.apollo_name);
    let from = 0;
    const deadline = Date.now() + FUMENG_SCAN_DEADLINE_MS;
    try {
      while (from < FUMENG_SCAN_LIMIT) {
        if (Date.now() >= deadline) return { status: 'unknown', reason: 'fumeng_scan_timeout' };
        const page = await this.fumeng.listCustomers({ scope: 'all', from, size: 50 });
        if (!Number.isSafeInteger(page.total) || page.total < 0 ||
            !Array.isArray(page.items) || page.items.length > 50 ||
            (from < page.total && page.items.length === 0)) {
          return { status: 'unknown', reason: 'fumeng_incomplete_page' };
        }
        for (const item of page.items) {
          if ((item.website && getDomain(item.website) === domain) ||
              (name && normalizedName(item.companyName) === name) ||
              (recipient && String(item.mainContactEmail || '').trim().toLowerCase() === recipient)) {
            return { status: 'duplicate', reason: 'fumeng_customer_match' };
          }
        }
        from += page.items.length;
        if (from >= page.total) break;
      }
      // `scope=all` does not prove that this token can see every Fumeng owner or contact.
      return { status: 'unknown', reason: from >= FUMENG_SCAN_LIMIT ? 'fumeng_scan_limit' : 'fumeng_scope_unverified' };
    } catch {
      return { status: 'unknown', reason: 'fumeng_query_failed' };
    }
  }

  async intake(sourceId) {
    if (!UUID.test(String(sourceId || ''))) {
      throw new AppError('Invalid Liverno Enterprise ID', { status: 400, code: 'INVALID_SOURCE_ID' });
    }
    const record = this.research.getBySource('liverno', sourceId);
    if (!record) throw new AppError('Research record not found', { status: 404, code: 'NOT_FOUND' });
    if (!['completed', 'no_contact'].includes(record.status) ||
        record.qualification.status !== 'qualified' || record.qualification.qualified !== true) {
      throw new AppError('Only qualified Research can enter marketing', {
        status: 409, code: 'QUALIFICATION_REQUIRED',
      });
    }
    const domain = getDomain(record.domain);
    if (!domain || domain !== getDomain(record.company?.domain)) {
      throw new AppError('Liverno and Apollo domains do not match', {
        status: 409, code: 'IDENTITY_DOMAIN_MISMATCH',
      });
    }
    const existing = this.marketing.ensureLivernoCustomer(record);
    if (existing.researchId !== record.id) {
      throw new AppError('Research identity changed for this Enterprise', {
        status: 409, code: 'RESEARCH_IDENTITY_CHANGED',
      });
    }
    const priorJob = this.marketing.findLivernoJob(existing.id);
    if (priorJob) {
      this.marketing.finishLivernoHandoff(existing.id, priorJob.id);
      return summary(this.marketing.getMarketingCustomer('liverno', sourceId));
    }
    if (!this.marketing.claimLivernoHandoff(existing.id)) return summary(existing);

    const stop = (status, reason) => {
      this.marketing.failLivernoHandoff(existing.id, status, reason);
      return summary(this.marketing.getMarketingCustomer('liverno', sourceId));
    };
    try {
      if (this.marketing.findLivernoConflict({ sourceId, domain })) {
        return stop('blocked_duplicate', 'domain_already_in_marketing');
      }
      if (!this.priceCatalog?.entries?.length) return stop('failed', 'price_catalog_unavailable');

      const candidates = record.contacts.filter((contact) =>
        contact.person_id && contact.has_email &&
        ['verified', 'valid'].includes(String(contact.email_status || '').toLowerCase()),
      ).slice(0, 3);
      let person;
      for (const candidate of candidates) {
        const matched = await this.apollo.matchPerson({ id: candidate.person_id });
        if (matched && matched.id === candidate.person_id && validEmail(matched.email) &&
            ['verified', 'valid'].includes(String(matched.emailStatus || '').toLowerCase()) &&
            (!matched.organizationId || matched.organizationId === record.company.apollo_organization_id)) {
          person = matched;
          break;
        }
      }
      if (!person) return stop('failed', 'contact_email_unavailable');
      const recipient = person.email.toLowerCase();
      if (this.marketing.isSuppressed(recipient) ||
          this.marketing.findLivernoConflict({ sourceId, domain, recipient }) ||
          !this.marketing.canContact({ customerId: existing.id, recipient })) {
        return stop('blocked_duplicate', 'recipient_or_company_already_marketed');
      }

      const customer = {
        id: existing.id,
        companyName: record.company.apollo_name,
        website: record.website_research.final_url || `https://${domain}`,
        country: record.company.country || record.qualification.country || '',
        industry: record.company.industry || '',
      };
      const contact = {
        id: person.id, name: person.name || '', email: recipient,
        jobRole: person.title || candidates[0]?.title || '',
      };
      const website = record.website_research;
      const bundle = await this.drafts.generateFromData({
        customer, contact, researchWebsite: true, reuseQualification: true,
        websiteEvidence: {
          status: website.status, finalUrl: website.final_url, title: website.title,
          description: website.description, keywords: website.keywords,
          text: website.text, signals: website.signals,
        },
        organizationEvidence: {
          name: record.company.apollo_name, domain: record.company.domain,
          country: record.company.country, industry: record.company.industry,
          employeeCount: record.company.employee_count,
        },
        qualificationDecision: { qualified: true, reason: record.qualification.reason },
      });
      const draft = bundle.draft;
      const quality = draftQuality({
        enrichment: {
          confidence: record.company.match_score || 0, emailVerified: true,
          source: 'apollo_match', contact, changes: [], writebackApplied: false,
        },
        draft, autoApproveScore: this.config.marketing.autoApproveScore,
      });
      if (!quality.approved) return stop('failed', 'draft_quality_failed');

      const products = selectEmailProducts({
        recommendedProducts: draft.recommendedProducts || [],
        catalog: this.priceCatalog,
        limit: this.config.pricing?.maxEmailModels || 8,
        emailAssets: this.config.emailAssets,
      });
      if (products.length < 6 || products.some((product) =>
        !product.imageAvailable || !IMAGE_SOURCES.has(product.imageSource))) {
        return stop('failed', 'price_or_product_images_insufficient');
      }
      const timeZone = resolveTimeZone(customer.country);
      if (!timeZone) return stop('failed', 'timezone_missing');
      const scheduledAt = nextSendTime({
        timeZone,
        startHour: this.config.marketing.sendWindowStartHour,
        endHour: this.config.marketing.sendWindowEndHour,
      });
      const htmlContent = buildFirstTouchEmailHtml({
        body: draft.emailBody, sales: this.config.sales, customer, contact,
        pricedProducts: products, priceListDate: this.priceCatalog.generatedDate || '',
      });
      const textContent = buildFirstTouchEmailText({
        body: draft.emailBody, sales: this.config.sales, customer, contact,
        pricedProducts: products, priceListDate: this.priceCatalog.generatedDate || '',
      });
      if (this.marketing.findLivernoConflict({ sourceId, domain, recipient })) {
        return stop('blocked_duplicate', 'recipient_or_company_already_marketed');
      }
      this.marketing.saveLivernoContact({
        customerId: existing.id, personId: person.id, name: contact.name,
        title: contact.jobRole, recipient, emailStatus: person.emailStatus,
      });
      const result = this.marketing.enqueue({
        source: 'liverno', sourceId, researchId: record.id, domain,
        customerId: existing.id, contactId: person.id,
        companyName: customer.companyName, contactName: contact.name, email: recipient,
        country: customer.country, timeZone, subject: draft.emailSubject,
        htmlContent, textContent, status: 'queued', score: quality.score, scheduledAt,
        apollo: { organizationId: record.company.apollo_organization_id,
          personId: person.id, emailVerified: true },
        draft: { ...draft, pricing: {
          priceListDate: this.priceCatalog.generatedDate || '', products,
        } },
        writeback: { applied: false, source: 'liverno' },
      });
      this.marketing.finishLivernoHandoff(existing.id, result.job.id);
      return summary(this.marketing.getMarketingCustomer('liverno', sourceId));
    } catch (error) {
      this.marketing.failLivernoHandoff(existing.id, 'failed', error.code || 'handoff_failed');
      throw error;
    }
  }
}
