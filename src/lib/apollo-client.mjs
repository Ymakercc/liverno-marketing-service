import { AppError, readJsonResponse, requireConfiguration } from './errors.mjs';

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function isApolloCreditsError(error) {
  const status = Number(error?.details?.httpStatus || 0);
  const message = [error?.message, error?.details?.message].map(clean).join(' ');
  return status === 402 || (
    [422, 429].includes(status) &&
    /(credit|quota|usage limit|plan limit|insufficient|not enough|exhausted|billing)/i.test(message)
  );
}

export function normalizeDomain(value) {
  const source = clean(value).toLowerCase();
  if (!source) return '';
  const candidates = source.split(/[,;|\s]+/).filter(Boolean);
  const nonSocial = candidates.filter((candidate) =>
    !/(linkedin\.com|youtube\.com|facebook\.com|instagram\.com|twitter\.com|x\.com)/.test(candidate));
  for (const candidate of [...nonSocial, ...candidates]) {
    try {
      const url = new URL(/^https?:\/\//.test(candidate) ? candidate : `https://${candidate}`);
      if (/^(?:www\.)?google\./.test(url.hostname) && url.pathname === '/url') {
        const target = url.searchParams.get('url') || url.searchParams.get('q');
        if (target) {
          const targetUrl = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`);
          const targetHostname = targetUrl.hostname.replace(/^www\./, '');
          if (targetHostname && targetHostname.includes('.')) return targetHostname;
        }
      }
      const hostname = url.hostname.replace(/^www\./, '');
      if (hostname && hostname.includes('.')) return hostname;
    } catch {
      // Try the next website-like value from the CRM field.
    }
  }
  return '';
}

function mapOrganization(raw = {}) {
  return {
    id: clean(raw.id),
    name: clean(raw.name),
    domain: normalizeDomain(raw.primary_domain || raw.website_url || raw.domain),
    website: clean(raw.website_url || raw.primary_domain),
    country: clean(raw.country || raw.country_name),
    countryCode: clean(raw.country_code),
    city: clean(raw.city),
    state: clean(raw.state || raw.state_name),
    industry: clean(raw.industry),
    description: clean(raw.short_description || raw.seo_description || raw.description),
    keywords: Array.isArray(raw.keywords) ? raw.keywords.map(clean).filter(Boolean) : [],
    employeeCount: Number(raw.estimated_num_employees || raw.employee_count || 0),
    linkedinUrl: clean(raw.linkedin_url),
    raw,
  };
}

function mapPerson(raw = {}) {
  const organization = raw.organization || {};
  return {
    id: clean(raw.id),
    firstName: clean(raw.first_name),
    lastName: clean(raw.last_name),
    name: clean(raw.name || [raw.first_name, raw.last_name].filter(Boolean).join(' ')),
    title: clean(raw.title),
    email: clean(raw.email).toLowerCase(),
    emailStatus: clean(raw.email_status || raw.email_status_cd).toLowerCase(),
    linkedinUrl: clean(raw.linkedin_url),
    organizationId: clean(raw.organization_id || organization.id),
    organizationName: clean(organization.name),
    raw,
  };
}

export class ApolloClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
  }

  async post(path, body) {
    requireConfiguration({ APOLLO_API_KEY: this.config.apiKey }, 'Apollo');
    const response = await this.fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    try {
      return await readJsonResponse(response, 'Apollo');
    } catch (error) {
      if (!isApolloCreditsError(error)) throw error;
      throw new AppError('Apollo 额度已耗尽，已自动暂停新增背调', {
        status: 429,
        code: 'APOLLO_CREDITS_EXHAUSTED',
        details: error.details,
      });
    }
  }

  async enrichOrganization(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) return null;
    const result = await this.post('/api/v1/organizations/enrich', { domain: normalized });
    return result.organization ? mapOrganization(result.organization) : null;
  }

  async searchOrganizations({ name, country = '', limit = 5 } = {}) {
    if (!clean(name)) {
      throw new AppError('Apollo 公司搜索缺少公司名称', { status: 400, code: 'VALIDATION_ERROR' });
    }
    const result = await this.post('/api/v1/mixed_companies/search', {
      q_organization_name: clean(name),
      organization_locations: country ? [clean(country)] : undefined,
      page: 1,
      per_page: Math.min(Math.max(Number(limit) || 5, 1), 10),
    });
    return (result.organizations || result.accounts || []).map(mapOrganization);
  }

  async searchPeople({ domain, organizationId = '', titles = [], limit = 10 } = {}) {
    const normalized = normalizeDomain(domain);
    if (!normalized && !organizationId) {
      throw new AppError('Apollo 联系人搜索缺少公司域名或 organizationId', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    const result = await this.post('/api/v1/mixed_people/api_search', {
      q_organization_domains_list: normalized ? [normalized] : undefined,
      organization_ids: organizationId ? [organizationId] : undefined,
      person_titles: titles.length ? titles : undefined,
      contact_email_status: ['verified', 'likely to engage'],
      page: 1,
      per_page: Math.min(Math.max(Number(limit) || 10, 1), 25),
    });
    return (result.people || result.contacts || []).map(mapPerson);
  }

  async matchPerson({ id = '', email = '', firstName = '', lastName = '', domain = '' } = {}) {
    if (!id && !email && !(firstName && lastName && domain)) {
      throw new AppError('Apollo 联系人补全缺少可匹配字段', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    const result = await this.post('/api/v1/people/match', {
      id: clean(id) || undefined,
      email: clean(email) || undefined,
      first_name: clean(firstName) || undefined,
      last_name: clean(lastName) || undefined,
      domain: normalizeDomain(domain) || undefined,
      reveal_personal_emails: false,
      reveal_phone_number: false,
    });
    return result.person ? mapPerson(result.person) : null;
  }
}
