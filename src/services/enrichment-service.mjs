import { AppError } from '../lib/errors.mjs';
import { normalizeDomain } from '../lib/apollo-client.mjs';
import { isMarketableCustomerState } from '../lib/customer-eligibility.mjs';

const TARGET_TITLES = [
  'procurement manager', 'purchasing manager', 'sourcing manager', 'buyer',
  'engineering manager', 'technical manager', 'product manager',
  'managing director', 'owner', 'founder', 'general manager', 'sales director',
];

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function splitEmails(value) {
  return [...new Set(clean(value).toLowerCase().split(/[\s,;|]+/).filter((item) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))];
}

function normalizedName(value) {
  return clean(value).toLowerCase()
    .replace(/\b(limited|ltd|llc|incorporated|inc|corp|corporation|company|co|gmbh|pvt|private|sarl|spa)\b/g, ' ')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim();
}

function tokenSimilarity(left, right) {
  const a = new Set(normalizedName(left).split(/\s+/).filter(Boolean));
  const b = new Set(normalizedName(right).split(/\s+/).filter(Boolean));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / new Set([...a, ...b]).size;
}

export function scoreOrganization(customer, organization) {
  if (!organization) return 0;
  let score = 5;
  const customerDomain = normalizeDomain(customer.website);
  if (customerDomain && normalizeDomain(organization.domain) === customerDomain) score += 80;
  const leftName = normalizedName(customer.companyName);
  const rightName = normalizedName(organization.name);
  if (leftName && rightName && leftName === rightName) score += 75;
  else score += Math.round(tokenSimilarity(customer.companyName, organization.name) * 40);
  const customerCountry = clean(customer.countryEnglish || customer.country).toLowerCase();
  const customerCountryCode = clean(customer.countryCode).toLowerCase();
  const organizationCountry = clean(organization.country).toLowerCase();
  const organizationCountryCode = clean(organization.countryCode).toLowerCase();
  if ((customerCountry && organizationCountry && customerCountry === organizationCountry) ||
      (customerCountryCode && organizationCountryCode && customerCountryCode === organizationCountryCode)) {
    score += 15;
  }
  if (customer.industry && organization.industry && tokenSimilarity(customer.industry, organization.industry) > 0) score += 5;
  return Math.min(score, 100);
}

export function scorePerson(person) {
  const title = clean(person?.title).toLowerCase();
  let score = 0;
  if (/procurement|purchasing|sourcing|buyer/.test(title)) score += 50;
  if (/engineering|technical|product/.test(title)) score += 40;
  if (/owner|founder|managing director|general manager|chief executive|ceo/.test(title)) score += 35;
  if (/director|head|manager/.test(title)) score += 15;
  if (person?.emailStatus === 'verified') score += 30;
  if (person?.linkedinUrl) score += 5;
  return score;
}

function isVerified(person) {
  return ['verified', 'valid'].includes(clean(person?.emailStatus).toLowerCase());
}

function ignoreOptionalApolloLookup(error) {
  if (error?.code === 'APOLLO_CREDITS_EXHAUSTED') throw error;
  return null;
}

function findExistingContact(contacts, person) {
  const personEmail = clean(person.email).toLowerCase();
  if (personEmail) {
    const byEmail = contacts.find((contact) => clean(contact.email).toLowerCase() === personEmail);
    if (byEmail) return byEmail;
  }
  const personName = normalizedName(person.name);
  return contacts.find((contact) => personName && normalizedName(contact.name) === personName) || null;
}

export class EnrichmentService {
  constructor({ apollo, fumeng, marketing, config }) {
    this.apollo = apollo;
    this.fumeng = fumeng;
    this.marketing = marketing;
    this.config = config;
  }

  async findOrganization(customer) {
    const domain = normalizeDomain(customer.website);
    if (domain) {
      const organization = await this.apollo.enrichOrganization(domain).catch(ignoreOptionalApolloLookup);
      const confidence = scoreOrganization(customer, organization);
      if (organization && confidence >= this.config.apollo.minimumCompanyScore) {
        return { organization, confidence };
      }
    }
    const country = customer.countryEnglish || customer.country;
    let candidates = await this.apollo.searchOrganizations({
      name: customer.companyName, country, limit: 5,
    });
    if (!candidates.length && country) {
      candidates = await this.apollo.searchOrganizations({
        name: customer.companyName, limit: 5,
      });
    }
    return candidates.map((organization) => ({
      organization,
      confidence: scoreOrganization(customer, organization),
    })).sort((left, right) => right.confidence - left.confidence)[0] || { organization: null, confidence: 0 };
  }

  async findContacts(customer, contacts, organization) {
    const max = Math.min(this.config.apollo.maxPeoplePerCompany, 5);
    const results = [];
    const seenEmails = new Set();
    const addResult = (person, existingContact, source) => {
      const normalizedEmail = clean(person?.email).toLowerCase();
      if (!normalizedEmail || seenEmails.has(normalizedEmail) || results.length >= max) return;
      seenEmails.add(normalizedEmail);
      results.push({ person, existingContact, source });
    };

    const existingContacts = contacts
      .flatMap((contact) => splitEmails(contact.email).map((email) => ({ ...contact, email })))
      .sort((left, right) => (Number(right.primary) - Number(left.primary)) ||
        (scorePerson({ title: right.jobRole }) - scorePerson({ title: left.jobRole })));
    for (const existing of existingContacts) {
      const matched = await this.apollo.matchPerson({
        email: existing.email,
        domain: organization?.domain || customer.website,
      }).catch(ignoreOptionalApolloLookup);
      if (matched?.email) {
        addResult(matched, existing, 'apollo_match');
      } else {
        addResult({
          id: '', name: existing.name, title: existing.jobRole, email: existing.email,
          emailStatus: 'crm', linkedinUrl: existing.linkedin,
        }, existing, 'fumeng');
      }
      if (results.length >= max) return results;
    }

    const people = await this.apollo.searchPeople({
      domain: organization?.domain || customer.website,
      organizationId: organization?.id,
      titles: TARGET_TITLES,
      limit: Math.min(Math.max(max * 4, 10), 25),
    });
    const ranked = [...people].sort((left, right) => scorePerson(right) - scorePerson(left));
    for (const candidate of ranked) {
      if (results.length >= max) break;
      const matched = await this.apollo.matchPerson({
        id: candidate.id,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        domain: organization?.domain,
      }).catch(ignoreOptionalApolloLookup);
      if (matched?.email && isVerified(matched)) {
        addResult(matched, findExistingContact(contacts, matched), 'apollo_search');
      }
    }
    return results;
  }

  async findContact(customer, contacts, organization) {
    return (await this.findContacts(customer, contacts, organization))[0] || {
      person: null, existingContact: null, source: 'apollo_search',
    };
  }

  async writeback(customer, contacts, organization, contactResult) {
    const changes = [];
    if (!customer.website && organization?.website) {
      changes.push({ entity: 'customer', id: customer.id, field: 'web', value: organization.website });
    }
    const person = contactResult.person;
    const existing = contactResult.existingContact;
    if (person?.email && existing) {
      if (!clean(existing.name)) {
        changes.push({
          entity: 'contact', id: existing.id, field: 'contName',
          value: clean(person.name) || clean(person.title) || 'Apollo Contact',
        });
      }
      if (!existing.email) changes.push({ entity: 'contact', id: existing.id, field: 'mailAddress', value: person.email });
      if (!existing.linkedin && person.linkedinUrl) changes.push({ entity: 'contact', id: existing.id, field: 'linkedin', value: person.linkedinUrl });
      const alreadyRecorded = person.id && clean(existing.remarks).includes(person.id);
      if (((!existing.jobRole && person.title) || person.id) && !alreadyRecorded) {
        const apolloNote = [
          person.title ? `Apollo title: ${person.title}` : '',
          person.id ? `Apollo Person ID: ${person.id}` : '',
          `Enriched: ${new Date().toISOString()}`,
        ].filter(Boolean).join('; ');
        changes.push({
          entity: 'contact', id: existing.id, field: 'remarks',
          value: [clean(existing.remarks), apolloNote].filter(Boolean).join('\n'),
        });
      }
    } else if (person?.email) {
      changes.push({ entity: 'contact', id: '', field: 'create', value: person.email });
    }

    if (!this.config.fumeng.writebackEnabled || !changes.length) {
      return { applied: false, changes, contact: existing || (person ? {
        id: '', name: person.name, email: person.email, jobRole: person.title,
        linkedin: person.linkedinUrl, emailSource: 'apollo',
      } : null) };
    }

    const customerFields = Object.fromEntries(
      changes.filter((item) => item.entity === 'customer').map((item) => [item.field, item.value]),
    );
    if (Object.keys(customerFields).length) await this.fumeng.updateCustomerFields(customer.id, customerFields);

    let resolvedContact = existing;
    const contactFields = Object.fromEntries(
      changes.filter((item) => item.entity === 'contact' && item.field !== 'create')
        .map((item) => [item.field, item.value]),
    );
    if (existing && Object.keys(contactFields).length) {
      await this.fumeng.updateContactFields(existing.id, contactFields);
      resolvedContact = { ...existing, ...{
        name: contactFields.contName || existing.name,
        email: contactFields.mailAddress || existing.email,
        jobRole: person.title || existing.jobRole,
        linkedin: contactFields.linkedin || existing.linkedin,
        remarks: contactFields.remarks || existing.remarks,
      } };
    } else if (!existing && person?.email) {
      const contactName = clean(person.name) || clean(person.title) || 'Apollo Contact';
      const remarks = [
        'Data source: Apollo',
        person.title ? `Title: ${person.title}` : '',
        person.id ? `Person ID: ${person.id}` : '',
        `Verified: ${person.emailStatus || 'unknown'}`,
        `Enriched: ${new Date().toISOString()}`,
      ].filter(Boolean).join('; ');
      try {
        resolvedContact = await this.fumeng.addContact(customer, {
          name: contactName, email: person.email, jobRole: person.title,
          linkedin: person.linkedinUrl, remarks,
        });
      } catch (error) {
        if (!person.title || !/integer value|customint2|jobs/i.test(error.message)) throw error;
        resolvedContact = await this.fumeng.addContact(customer, {
          name: contactName, email: person.email, jobRole: '',
          linkedin: person.linkedinUrl, remarks,
        });
      }
      resolvedContact = { ...resolvedContact, jobRole: resolvedContact?.jobRole || person.title };
    }
    return { applied: true, changes, contact: resolvedContact };
  }

  async enrich(customer, contacts = []) {
    if (!isMarketableCustomerState(customer.customerStateId)) {
      throw new AppError('客户不是可营销的未成交状态', {
        status: 409,
        code: 'CUSTOMER_NOT_ELIGIBLE',
      });
    }
    try {
      const { organization, confidence } = await this.findOrganization(customer);
      if (!organization || confidence < this.config.apollo.minimumCompanyScore) {
        const result = { status: 'company_mismatch', customer, organization, confidence, contact: null, changes: [] };
        const run = this.marketing.recordEnrichment({
          customerId: customer.id, companyName: customer.companyName, status: result.status,
          confidence, apolloOrgId: organization?.id, details: { organization },
        });
        return { ...result, runId: run?.id || '' };
      }
      const contactResults = await this.findContacts(customer, contacts, organization);
      if (!contactResults.length) {
        const result = { status: 'contact_not_found', customer, organization, confidence, contact: null, changes: [] };
        const run = this.marketing.recordEnrichment({
          customerId: customer.id, companyName: customer.companyName, status: result.status,
          confidence, apolloOrgId: organization.id, details: { organization },
        });
        return { ...result, runId: run?.id || '' };
      }
      const enrichedContacts = [];
      for (const contactResult of contactResults) {
        try {
          const writeback = await this.writeback(customer, contacts, organization, contactResult);
          const contact = writeback.contact || {
            id: '',
            name: clean(contactResult.person.name) || clean(contactResult.person.title) || 'Apollo Contact',
            email: contactResult.person.email,
            jobRole: contactResult.person.title,
            linkedin: contactResult.person.linkedinUrl,
            emailSource: contactResult.source,
          };
          enrichedContacts.push({
            contact,
            person: contactResult.person,
            source: contactResult.source,
            emailVerified: isVerified(contactResult.person),
            changes: writeback.changes,
            writebackApplied: writeback.applied,
            writebackError: '',
          });
        } catch (error) {
          const existing = contactResult.existingContact;
          enrichedContacts.push({
            contact: {
              id: existing?.id || '',
              name: clean(existing?.name) || clean(contactResult.person.name) ||
                clean(contactResult.person.title) || 'Apollo Contact',
              email: contactResult.person.email,
              jobRole: contactResult.person.title || existing?.jobRole || '',
              linkedin: contactResult.person.linkedinUrl || existing?.linkedin || '',
              emailSource: contactResult.source,
            },
            person: contactResult.person,
            source: contactResult.source,
            emailVerified: isVerified(contactResult.person),
            changes: [],
            writebackApplied: false,
            writebackError: error.message,
          });
        }
      }
      const first = enrichedContacts[0];
      const result = {
        status: 'enriched', customer: {
          ...customer,
          website: customer.website || organization.website,
          industry: customer.industry || organization.industry,
        },
        organization, confidence, contact: first.contact, person: first.person,
        contacts: enrichedContacts.map((item) => item.contact),
        contactCandidates: enrichedContacts,
        emailVerified: first.emailVerified,
        changes: enrichedContacts.flatMap((item) => item.changes),
        writebackApplied: enrichedContacts.every((item) =>
          !item.writebackError && (item.writebackApplied || !item.changes.length)),
      };
      const run = this.marketing.recordEnrichment({
        customerId: customer.id, companyName: customer.companyName, status: result.status,
        confidence, contactEmail: first.contact.email, contactName: first.contact.name,
        apolloOrgId: organization.id, apolloPersonId: first.person.id,
        changes: result.changes, details: {
          emailVerified: result.emailVerified,
          contactCount: enrichedContacts.length,
          sources: enrichedContacts.map((item) => item.source),
          writebackErrors: enrichedContacts.map((item) => item.writebackError).filter(Boolean),
          organization,
        },
      });
      return { ...result, runId: run?.id || '' };
    } catch (error) {
      const run = this.marketing.recordEnrichment({
        customerId: customer.id, companyName: customer.companyName, status: 'failed', error: error.message,
      });
      error.enrichmentRunId = run?.id || '';
      throw error;
    }
  }
}
