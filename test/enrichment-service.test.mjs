import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/lib/errors.mjs';
import { EnrichmentService, scoreOrganization, scorePerson } from '../src/services/enrichment-service.mjs';

const customer = {
  id: 'customer-1', companyName: 'Apex Industrial Controls Pvt. Ltd.', website: 'https://apex.example',
  country: 'India', industry: 'Industrial Automation', customerStateId: '2',
  ownerContactId: 'owner-1', ownerDepartmentKey: 'dept-1',
};

test('enrichment scores exact domains and purchasing contacts above unrelated records', () => {
  assert.ok(scoreOrganization(customer, { name: 'Apex Industrial Controls', domain: 'apex.example', country: 'India' }) >= 90);
  assert.ok(scoreOrganization(customer, { name: 'Different Legal Name', domain: 'https://www.apex.example/' }) >= 75);
  assert.ok(scorePerson({ title: 'Procurement Manager', emailStatus: 'verified' }) > scorePerson({ title: 'Intern', emailStatus: '' }));
});

test('enrichment splits multiple CRM emails and does not treat unmatched CRM addresses as verified', async () => {
  const service = new EnrichmentService({
    apollo: {
      enrichOrganization: async () => ({ id: 'org-1', name: 'Apex Industrial Controls', domain: 'apex.example', country: 'India' }),
      matchPerson: async () => null,
      searchPeople: async () => [],
    },
    fumeng: {}, marketing: { recordEnrichment: () => ({ id: 'run-1' }) },
    config: { apollo: { minimumCompanyScore: 75, maxPeoplePerCompany: 5 }, fumeng: { writebackEnabled: false } },
  });

  const result = await service.enrich(customer, [{
    id: 'contact-1', name: 'Sales', email: 'sales@apex.example; info@apex.example', primary: true,
  }]);

  assert.deepEqual(result.contacts.map((item) => item.email), ['sales@apex.example', 'info@apex.example']);
  assert.ok(result.contactCandidates.every((item) => item.emailVerified === false));
});

test('enrichment never swallows an Apollo exhausted-credits signal from an optional lookup', async () => {
  const runs = [];
  let organizationSearchCalled = false;
  const service = new EnrichmentService({
    apollo: {
      enrichOrganization: async () => {
        throw new AppError('Apollo credits exhausted', {
          status: 429,
          code: 'APOLLO_CREDITS_EXHAUSTED',
        });
      },
      searchOrganizations: async () => { organizationSearchCalled = true; return []; },
    },
    fumeng: {},
    marketing: { recordEnrichment: (run) => { runs.push(run); return { id: 'run-failed' }; } },
    config: { apollo: { minimumCompanyScore: 75, maxPeoplePerCompany: 5 }, fumeng: { writebackEnabled: false } },
  });

  await assert.rejects(
    service.enrich(customer, []),
    (error) => error.code === 'APOLLO_CREDITS_EXHAUSTED' && error.enrichmentRunId === 'run-failed',
  );
  assert.equal(organizationSearchCalled, false);
  assert.equal(runs[0].status, 'failed');
});

test('enrichment selects verified contact and plans safe Fumeng write-back', async () => {
  const runs = [];
  const service = new EnrichmentService({
    apollo: {
      enrichOrganization: async () => ({ id: 'org-1', name: 'Apex Industrial Controls', domain: 'apex.example', website: 'https://apex.example', country: 'India' }),
      searchPeople: async () => [{ id: 'person-1', firstName: 'Asha', lastName: 'Rao', name: 'Asha Rao', title: 'Procurement Manager' }],
      matchPerson: async () => ({ id: 'person-1', name: 'Asha Rao', title: 'Procurement Manager', email: 'asha@apex.example', emailStatus: 'verified', linkedinUrl: 'https://linkedin.example/asha' }),
    },
    fumeng: {},
    marketing: { recordEnrichment: (run) => runs.push(run) },
    config: { apollo: { minimumCompanyScore: 75, maxPeoplePerCompany: 3 }, fumeng: { writebackEnabled: false } },
  });
  const result = await service.enrich(customer, []);
  assert.equal(result.status, 'enriched');
  assert.equal(result.contact.email, 'asha@apex.example');
  assert.equal(result.emailVerified, true);
  assert.equal(result.writebackApplied, false);
  assert.deepEqual(result.changes.map((item) => item.field), ['create']);
  assert.equal(runs[0].status, 'enriched');
});

test('enrichment returns multiple ranked contacts up to the company limit', async () => {
  const service = new EnrichmentService({
    apollo: {
      enrichOrganization: async () => ({ id: 'org-1', name: 'Apex Industrial Controls', domain: 'apex.example', country: 'India' }),
      searchPeople: async () => [
        { id: 'person-1', firstName: 'Asha', lastName: 'Rao', name: 'Asha Rao', title: 'Procurement Manager' },
        { id: 'person-2', firstName: 'Raj', lastName: 'Shah', name: 'Raj Shah', title: 'Engineering Manager' },
      ],
      matchPerson: async ({ id }) => id === 'person-1'
        ? { id, name: 'Asha Rao', title: 'Procurement Manager', email: 'asha@apex.example', emailStatus: 'verified' }
        : { id, name: 'Raj Shah', title: 'Engineering Manager', email: 'raj@apex.example', emailStatus: 'verified' },
    },
    fumeng: {},
    marketing: { recordEnrichment: () => {} },
    config: { apollo: { minimumCompanyScore: 75, maxPeoplePerCompany: 5 }, fumeng: { writebackEnabled: false } },
  });

  const result = await service.enrich(customer, []);

  assert.deepEqual(result.contacts.map((item) => item.email), ['asha@apex.example', 'raj@apex.example']);
  assert.equal(result.contactCandidates.length, 2);
});

test('write-back fills a missing Fumeng contact name from Apollo evidence', async () => {
  let updatedFields;
  const service = new EnrichmentService({
    apollo: {},
    fumeng: {
      updateContactFields: async (_id, fields) => { updatedFields = fields; },
    },
    marketing: {},
    config: { apollo: {}, fumeng: { writebackEnabled: true } },
  });

  const result = await service.writeback(customer, [], null, {
    existingContact: { id: 'contact-1', name: '', email: 'asha@apex.example', remarks: '' },
    person: {
      id: 'person-1', name: '', title: 'Procurement Manager', email: 'asha@apex.example',
      emailStatus: 'verified',
    },
  });

  assert.equal(updatedFields.contName, 'Procurement Manager');
  assert.equal(result.contact.name, 'Procurement Manager');
});

test('one Fumeng contact write-back failure does not discard company research', async () => {
  const service = new EnrichmentService({
    apollo: {
      enrichOrganization: async () => ({
        id: 'org-1', name: 'Apex Industrial Controls', domain: 'apex.example', country: 'India',
      }),
      matchPerson: async ({ email }) => ({
        id: `person-${email}`,
        name: email.startsWith('first') ? '' : 'Raj Shah',
        title: 'Engineering Manager',
        email,
        emailStatus: 'verified',
      }),
      searchPeople: async () => [],
    },
    fumeng: {
      updateContactFields: async (id) => {
        if (id === 'contact-1') throw new Error('联系人昵称字段不能为空');
      },
    },
    marketing: { recordEnrichment: () => ({ id: 'run-1' }) },
    config: { apollo: { minimumCompanyScore: 75, maxPeoplePerCompany: 5 }, fumeng: { writebackEnabled: true } },
  });

  const result = await service.enrich(customer, [
    { id: 'contact-1', name: '', email: 'first@apex.example', remarks: '' },
    { id: 'contact-2', name: 'Raj Shah', email: 'second@apex.example', remarks: '' },
  ]);

  assert.equal(result.status, 'enriched');
  assert.equal(result.contactCandidates[0].writebackApplied, false);
  assert.match(result.contactCandidates[0].writebackError, /昵称/);
  assert.equal(result.contactCandidates[1].writebackApplied, true);
});

test('organization search uses the English country and retries without a location filter', async () => {
  const calls = [];
  const service = new EnrichmentService({
    apollo: {
      searchOrganizations: async (input) => {
        calls.push(input);
        return input.country ? [] : [{
          id: 'org-2', name: 'Power On Australia', domain: 'poweronaustralia.com.au',
          country: '', countryCode: '',
        }];
      },
    },
    fumeng: {},
    marketing: {},
    config: { apollo: { minimumCompanyScore: 75, maxPeoplePerCompany: 3 }, fumeng: { writebackEnabled: false } },
  });
  const input = {
    companyName: 'Power On Australia', country: '澳大利亚',
    countryEnglish: 'AUSTRALIA', countryCode: 'AU', website: '',
  };

  const result = await service.findOrganization(input);

  assert.equal(calls[0].country, 'AUSTRALIA');
  assert.equal(calls[1].country, undefined);
  assert.equal(result.organization.name, 'Power On Australia');
  assert.ok(result.confidence >= 75);
});
