import { AppError } from '../lib/errors.mjs';
import { normalizeDomain } from '../lib/apollo-client.mjs';
import { EnrichmentService, scorePerson } from './enrichment-service.mjs';

const SOURCE = 'liverno';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;

function requiredString(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new AppError(`Invalid ${field}`, { status: 400, code: 'INVALID_RESEARCH_INPUT' });
  }
  return value.trim();
}

export function validateResearchInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Invalid research request', { status: 400, code: 'INVALID_RESEARCH_INPUT' });
  }
  const source = requiredString(body.source, 'source', 30);
  if (source !== SOURCE) {
    throw new AppError('Unsupported research source', { status: 400, code: 'INVALID_RESEARCH_SOURCE' });
  }
  const source_id = requiredString(body.source_id, 'source_id', 64);
  if (!UUID.test(source_id)) {
    throw new AppError('Invalid source_id', { status: 400, code: 'INVALID_RESEARCH_INPUT' });
  }
  const rawDomain = requiredString(body.domain, 'domain', 253);
  const domain = normalizeDomain(rawDomain);
  if (!DOMAIN.test(domain) || domain.includes('..')) {
    throw new AppError('Invalid domain', { status: 400, code: 'INVALID_RESEARCH_INPUT' });
  }
  const candidate_name = requiredString(body.candidate_name, 'candidate_name', 500);
  const evidence_url = requiredString(body.evidence_url, 'evidence_url', 2048);
  try {
    const url = new URL(evidence_url);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw new AppError('Invalid evidence_url', { status: 400, code: 'INVALID_RESEARCH_INPUT' });
  }
  const discovered_at = requiredString(body.discovered_at, 'discovered_at', 50);
  if (!Number.isFinite(Date.parse(discovered_at))) {
    throw new AppError('Invalid discovered_at', { status: 400, code: 'INVALID_RESEARCH_INPUT' });
  }
  for (const field of ['country', 'industry']) {
    if (body[field] !== undefined && body[field] !== null &&
        (typeof body[field] !== 'string' || body[field].length > 200)) {
      throw new AppError(`Invalid ${field}`, { status: 400, code: 'INVALID_RESEARCH_INPUT' });
    }
  }
  return { source, source_id, domain, candidate_name, evidence_url, discovered_at,
    country: body.country?.trim() || '', industry: body.industry?.trim() || '' };
}

export class ResearchService {
  constructor({ store, apollo, config, maxMatches = 3 }) {
    this.store = store;
    this.apollo = apollo;
    this.config = config;
    this.maxMatches = Math.min(Math.max(Number(maxMatches) || 3, 1), 3);
  }

  get(id) {
    return this.store.get(id);
  }

  getBySource(source, sourceId) {
    return this.store.getBySource(source, sourceId);
  }

  async intake(body) {
    const input = validateResearchInput(body);
    const existing = this.store.getBySource(input.source, input.source_id);
    if (existing) return { created: false, record: existing };
    if (this.config.marketing?.researchEnabled === false) {
      throw new AppError('Apollo research is paused', {
        status: 503, code: 'APOLLO_RESEARCH_PAUSED',
      });
    }
    const { created, record } = this.store.create(input);
    if (!created) return { created: false, record };

    const calls = { organization_enrichment: 0, organization_search: 0,
      people_search: 0, people_match: 0 };
    const limitedCall = (kind, limit, method) => async (...args) => {
      if (calls[kind] >= limit) {
        throw new AppError('Research Apollo call limit reached', {
          status: 500, code: 'RESEARCH_APOLLO_LIMIT',
        });
      }
      calls[kind] += 1;
      return this.apollo[method](...args);
    };
    const apollo = {
      enrichOrganization: limitedCall('organization_enrichment', 1, 'enrichOrganization'),
      searchOrganizations: limitedCall('organization_search', 1, 'searchOrganizations'),
      searchPeople: limitedCall('people_search', 1, 'searchPeople'),
      matchPerson: limitedCall('people_match', this.maxMatches, 'matchPerson'),
    };
    const enrichment = new EnrichmentService({ apollo, config: this.config });
    this.store.start(record.id);
    try {
      const customer = {
        website: input.domain,
        companyName: input.candidate_name,
        country: input.country,
        industry: input.industry,
      };
      const { organization, confidence } = await enrichment.findOrganization(customer, {
        maxSearches: 1, strictErrors: true,
      });
      if (!organization || confidence < this.config.apollo.minimumCompanyScore) {
        return { created: true, record: this.store.finish(record.id, {
          status: 'company_not_found', calls,
          organization, matchScore: organization ? confidence : null,
          matchEvidence: { domain_exact: Boolean(organization &&
            normalizeDomain(organization.domain) === input.domain) },
        }) };
      }
      const matchEvidence = {
        domain_exact: normalizeDomain(organization.domain) === input.domain,
        candidate_name_is_official: false,
      };
      this.store.markCompanyMatched(record.id, organization, confidence, matchEvidence, calls);
      const found = await enrichment.findContacts(customer, [], organization, {
        maxResults: 3, searchLimit: 3, matchLimit: this.maxMatches,
        includeUnverified: true, strictErrors: true,
      });
      const contacts = found.map(({ person }) => ({
        person_id: person.id,
        title: person.title,
        email_status: person.emailStatus,
        has_email: Boolean(person.email),
      }));
      const usable = found.some(({ person }) => person.email &&
        ['verified', 'valid'].includes(person.emailStatus) && scorePerson({ title: person.title }) > 0);
      return { created: true, record: this.store.finish(record.id, {
        status: usable ? 'completed' : 'no_contact',
        organization, matchScore: confidence, matchEvidence, contacts, calls,
      }) };
    } catch (error) {
      const reason = error?.code || 'RESEARCH_ERROR';
      return { created: true, record: this.store.finish(record.id, {
        status: 'failed', failureReason: reason, calls,
      }) };
    }
  }
}
