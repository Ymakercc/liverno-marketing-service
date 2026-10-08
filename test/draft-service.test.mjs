import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftService } from '../src/services/draft-service.mjs';

test('draft service selects an emailed contact and excludes email from model input', async () => {
  let modelRequest;
  const service = new DraftService({
    fumeng: {
      getCustomer: async () => ({
        id: 'cust-1',
        companyName: 'India Power Trade',
        mainContactId: 'c1',
        website: 'example.com',
      }),
      listContacts: async () => [
        { id: 'c1', name: 'Aarav', email: 'aarav@example.com', jobRole: 'Director' },
      ],
    },
    openai: {
      createOutboundDraft: async (request) => {
        modelRequest = request;
        return { emailSubject: 'Draft' };
      },
    },
    sales: {
      teamName: 'MEAN WELL KULON TEAM',
      email: 'Sales@kulon.com',
      companyName: 'Seller',
      website: 'https://meanwell-led.com/',
    },
    websiteResearch: async () => ({
      status: 'fetched', finalUrl: 'https://example.com/', title: 'India Power Trade',
      description: 'Industrial power supply distributor', keywords: 'mean well',
      text: 'MEAN WELL industrial power supplies',
      signals: { meanWellMentioned: true, matchedTerms: ['mean well'], directFit: true },
    }),
  });

  const result = await service.generate({ customerId: 'cust-1' });
  assert.equal(result.contact.email, 'aarav@example.com');
  assert.match(modelRequest.input, /Aarav/);
  assert.doesNotMatch(modelRequest.input, /aarav@example\.com/);
  assert.match(modelRequest.instructions, /MEAN WELL KULON TEAM/);
  assert.equal(modelRequest.reuseQualification, false);
  assert.match(modelRequest.instructions, /Do not add a sender name/);
  assert.match(modelRequest.instructions, /Do not require proof of an active sourcing project/);
  assert.doesNotMatch(modelRequest.instructions, /WhatsApp:/);
});

test('draft service includes fetched website evidence without exposing recipient email', async () => {
  let modelRequest;
  const service = new DraftService({
    fumeng: {},
    openai: { createOutboundDraft: async (request) => { modelRequest = request; return { qualified: true }; } },
    sales: { teamName: 'KULON', email: 'sales@kulon.com', companyName: 'Seller', website: 'https://seller.example' },
    websiteResearch: async () => ({
      status: 'fetched', finalUrl: 'https://industrial.example/', title: 'Industrial Controls',
      description: 'Industrial automation', keywords: 'mean well', text: 'MEAN WELL switching power supplies',
      signals: { meanWellMentioned: true, matchedTerms: ['mean well'], directFit: true },
    }),
  });

  const result = await service.generateFromData({
    customer: { id: 'cust-2', companyName: 'Industrial Controls', website: 'industrial.example' },
    contact: { id: 'contact-2', name: 'Sales', email: 'sales@industrial.example' },
    researchWebsite: true,
  });

  assert.equal(result.websiteEvidence.signals.directFit, true);
  assert.match(modelRequest.input, /MEAN WELL switching power supplies/);
  assert.doesNotMatch(modelRequest.input, /sales@industrial\.example/);
});

test('company analysis does not require an email recipient', async () => {
  let modelRequest;
  const service = new DraftService({
    fumeng: {},
    openai: { createOutboundDraft: async (request) => { modelRequest = request; return { qualified: false, reviewRequired: true }; } },
    sales: { teamName: 'KULON', email: 'sales@kulon.com', companyName: 'Seller', website: 'https://seller.example' },
  });

  await service.analyzeCompanyFromData({
    customer: { id: 'cust-3', companyName: 'Unknown Company', website: '' },
    contact: { name: '', jobRole: '' },
    websiteEvidence: { status: 'missing', text: '', signals: { directFit: false } },
  });

  assert.match(modelRequest.input, /Unknown Company/);
  assert.doesNotMatch(modelRequest.input, /"email"/);
});

test('prequalified Liverno draft reuses C1 evidence without website fetch or another fit judgment', async () => {
  let modelRequest;
  const service = new DraftService({
    fumeng: {},
    openai: { createOutboundDraft: async (request) => {
      modelRequest = request;
      return { qualified: false, emailSubject: 'Industrial support' };
    } },
    sales: { teamName: 'KULON', email: 'sales@kulon.com', companyName: 'Seller', website: 'https://seller.example' },
    websiteResearch: async () => { throw new Error('Website must not be fetched again'); },
  });
  const result = await service.generateFromData({
    customer: { id: 'local-1', companyName: 'Verified Co', website: 'https://verified.example' },
    contact: { id: 'person-1', name: 'Buyer', email: 'buyer@verified.example' },
    researchWebsite: true, reuseQualification: true,
    websiteEvidence: { status: 'fetched', text: 'Verified industrial controls' },
    qualificationDecision: { qualified: true, reason: 'Completed C1 decision' },
  });
  assert.equal(result.draft.qualified, true);
  assert.equal(result.draft.qualificationReason, 'Completed C1 decision');
  assert.match(modelRequest.instructions, /Do not reassess company fit/);
  assert.equal(modelRequest.reuseQualification, true);
  assert.match(modelRequest.input, /without reassessing it/);
  assert.doesNotMatch(modelRequest.input, /buyer@verified\.example/);
});
