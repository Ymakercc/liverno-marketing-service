import { getDomain } from 'tldts';
import { AppError } from '../lib/errors.mjs';
import { researchWebsite } from '../lib/website-research.mjs';

function registrableDomain(value) {
  return getDomain(value || '', { allowPrivateDomains: true });
}

function redactEmails(value) {
  return String(value || '').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]');
}

function safeEvidence(evidence) {
  return {
    ...evidence,
    title: redactEmails(evidence.title),
    description: redactEmails(evidence.description),
    keywords: redactEmails(evidence.keywords),
    text: redactEmails(evidence.text),
    error: redactEmails(evidence.error),
  };
}

function qualificationInput(record, evidence) {
  return JSON.stringify({
    company: {
      candidateName: {
        value: record.candidate_name,
        meaning: 'unverified discovery label from a search result; informational only',
      },
      livernoDomain: record.domain,
      apolloName: record.company?.apollo_name || '',
      apolloDomain: record.company?.domain || '',
      domainIdentity: record.company?.domain ? 'registrable_domain_match' : 'apollo_domain_missing',
      apolloCountry: record.company?.country || '',
      apolloIndustry: record.company?.industry || '',
      employeeCount: record.company?.employee_count ?? null,
    },
    websiteEvidence: {
      status: evidence.status,
      finalUrl: evidence.finalUrl,
      title: evidence.title,
      description: evidence.description,
      keywords: evidence.keywords,
      text: evidence.text,
      signals: evidence.signals,
    },
    contacts: {
      hasTargetContact: record.contacts.some((contact) => Boolean(contact.title)),
      titles: [...new Set(record.contacts.map((contact) => contact.title).filter(Boolean))],
    },
  });
}

export class QualificationService {
  constructor({ store, openai, websiteResearch = researchWebsite }) {
    this.store = store;
    this.openai = openai;
    this.websiteResearch = websiteResearch;
  }

  async qualify(id) {
    const record = this.store.get(id);
    if (!record) throw new AppError('Research record not found', { status: 404, code: 'NOT_FOUND' });
    if (!['completed', 'no_contact'].includes(record.status)) {
      throw new AppError('Research is not ready for qualification', {
        status: 409, code: 'RESEARCH_NOT_READY',
      });
    }
    if (record.qualification.status !== 'not_started') return record;
    if (!this.store.claimQualification(id)) return this.store.get(id);

    const livernoDomain = registrableDomain(record.domain);
    const apolloDomain = record.company?.domain ? registrableDomain(record.company.domain) : null;
    if (!livernoDomain || (record.company?.domain && !apolloDomain) ||
        (apolloDomain && livernoDomain !== apolloDomain)) {
      return this.store.finishQualification(id, {
        status: 'review_required', qualified: null, reviewRequired: true,
        reason: 'Liverno 与 Apollo 企业域名不一致或无法可靠核对。',
        reasonCode: 'identity_domain_mismatch',
      });
    }

    const website = record.company?.domain || record.domain;
    try {
      const evidence = safeEvidence(await this.websiteResearch(website));
      this.store.saveWebsiteEvidence(id, evidence);
      if (evidence.status === 'failed') {
        return this.store.failQualification(id, 'WEBSITE_RESEARCH_FAILED');
      }
      if (evidence.status === 'fetched' &&
          registrableDomain(evidence.finalUrl) !== livernoDomain) {
        return this.store.finishQualification(id, {
          status: 'review_required', qualified: null, reviewRequired: true,
          reason: '官网最终地址与企业主域名不一致，需要人工核对。',
          reasonCode: 'website_redirect_domain_mismatch',
        });
      }
      if (evidence.status !== 'fetched' || String(evidence.text || '').trim().length < 120) {
        return this.store.finishQualification(id, {
          status: 'review_required', qualified: null, reviewRequired: true,
          reason: '官网证据不足，无法可靠判断企业业务。',
          reasonCode: 'website_evidence_insufficient',
        });
      }
      this.store.markQualifying(id);
      const result = await this.openai.qualifyCompany({
        input: qualificationInput(record, evidence), researchId: record.id,
      });
      const reviewRequired = result.reviewRequired || result.qualified === null;
      return this.store.finishQualification(id, {
        status: reviewRequired ? 'review_required' : result.qualified ? 'qualified' : 'not_qualified',
        qualified: reviewRequired ? null : result.qualified,
        reviewRequired,
        reason: redactEmails(result.qualificationReason),
        reasonCode: reviewRequired ? 'ai_review_required' : '',
        country: result.country, region: result.region, industry: result.industry,
        customerType: redactEmails(result.customerType),
        customerProfile: redactEmails(result.customerProfile),
        painPoints: result.painPoints.map(redactEmails),
        recommendedProducts: result.recommendedProducts.map((item) => ({
          name: redactEmails(item.name), reason: redactEmails(item.reason),
        })),
        riskFlags: result.riskFlags.map(redactEmails),
      });
    } catch (error) {
      return this.store.failQualification(id, error?.code || 'QUALIFICATION_ERROR');
    }
  }
}
