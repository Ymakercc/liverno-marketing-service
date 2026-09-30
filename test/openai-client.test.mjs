import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenAIClient } from '../src/lib/openai-client.mjs';

const draft = {
  qualified: true,
  qualificationReason: 'Relevant industrial buyer',
  country: 'India',
  region: 'Asia',
  industry: 'Industrial automation',
  customerType: 'trader',
  customerProfile: 'Industrial component trader',
  painPoints: ['lead time'],
  recommendedProducts: [{ name: 'LRS series', reason: 'General industrial use' }],
  emailSubject: 'Power supply support',
  emailBody: 'Dear Test Team,\n\nHello',
  personalizationNotes: ['CRM industry field'],
  riskFlags: [],
  compliance: { approved: true, issues: [] },
  reviewRequired: true,
};

test('relay client uses chat completions and parses structured draft', async () => {
  let requestBody;
  const client = new OpenAIClient(
    {
      baseUrl: 'https://relay.example/v1',
      apiKey: 'key',
      model: 'relay-model',
      apiStyle: 'chat_completions',
    },
    {
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://relay.example/v1/chat/completions');
        requestBody = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            id: 'chat-1',
            model: 'relay-model',
            choices: [{ message: { content: JSON.stringify(draft) } }],
          }),
          { status: 200 },
        );
      },
    },
  );

  const result = await client.createOutboundDraft({
    instructions: 'Draft safely',
    input: '{}',
    customerId: 'customer-1',
  });

  assert.equal(requestBody.response_format.type, 'json_schema');
  assert.equal(result.emailSubject, 'Power supply support');
  assert.equal(result.debug.apiStyle, 'chat_completions');
});

test('relay client falls back to json_object when strict schema is unsupported', async () => {
  let calls = 0;
  const client = new OpenAIClient(
    {
      baseUrl: 'https://relay.example/v1',
      apiKey: 'key',
      model: 'relay-model',
      apiStyle: 'chat_completions',
    },
    {
      fetchImpl: async (url, options) => {
        calls += 1;
        const body = JSON.parse(options.body);
        if (calls === 1) return new Response('{"error":{"message":"unsupported"}}', { status: 400 });
        assert.equal(body.response_format.type, 'json_object');
        return new Response(
          JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\`` } }] }),
          { status: 200 },
        );
      },
    },
  );

  const result = await client.createOutboundDraft({ instructions: 'Draft', input: '{}', customerId: '1' });
  assert.equal(calls, 2);
  assert.equal(result.qualified, true);
});

test('relay client retries when structured output contains internal reasoning text', async () => {
  let calls = 0;
  const client = new OpenAIClient(
    { baseUrl: 'https://relay.example/v1', apiKey: 'key', model: 'relay-model', apiStyle: 'chat_completions' },
    { fetchImpl: async () => {
      calls += 1;
      const body = calls === 1
        ? { ...draft, qualificationReason: `${'final answer. '.repeat(120)} analysis channel` }
        : draft;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), { status: 200 });
    } },
  );

  const result = await client.createOutboundDraft({ instructions: 'Draft', input: '{}', customerId: '1' });
  assert.equal(calls, 2);
  assert.equal(result.qualificationReason, draft.qualificationReason);
});

test('qualification-only request uses its own schema and never asks for email content', async () => {
  let calls = 0;
  const client = new OpenAIClient(
    { baseUrl: 'https://relay.example/v1', apiKey: 'fake-key', model: 'relay-model',
      apiStyle: 'chat_completions' },
    { fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://relay.example/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.response_format.type, 'json_object');
      assert.match(body.messages[0].content, /qualificationReason/);
      assert.match(body.messages[0].content, /unverified discovery label derived from a search result/);
      assert.match(body.messages[0].content, /candidateName differing from the Apollo name alone is not an identity conflict/);
      assert.doesNotMatch(body.messages[0].content, /emailSubject|emailBody/);
      assert.doesNotMatch(JSON.stringify(body), /createOutboundDraft|recipient email/i);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        qualified: true, reviewRequired: false, qualificationReason: 'Industrial fit',
        country: '', region: 'Europe', industry: 'Automation', customerType: 'distributor',
        customerProfile: 'Controls supplier', painPoints: [], recommendedProducts: [], riskFlags: [],
      }) } }] }), { status: 200 });
    } },
  );
  const result = await client.qualifyCompany({ input: '{}', researchId: 'research-1' });
  assert.equal(result.qualified, true);
  assert.equal(calls, 1);
  assert.equal('emailBody' in result, false);
});
