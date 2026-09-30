import assert from 'node:assert/strict';
import test from 'node:test';
import { MiMoClient } from '../src/lib/mimo-client.mjs';

test('MiMo client sends a non-thinking structured classification request', async () => {
  const calls = [];
  const client = new MiMoClient({
    enabled: true, baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: 'mimo-secret',
    model: 'mimo-v2.5-pro', timeoutMs: 45_000,
  }, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({
        model: 'mimo-v2.5-pro',
        choices: [{ message: { content: JSON.stringify({
          category: 'inquiry', confidence: 0.97, reason: '客户要求100件产品报价。',
          summary: 'HDR-60-24 100件询价', language: 'English',
          purchaseSignals: ['HDR-60-24', '100 pcs', 'quotation'],
        }) } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await client.classifyInboundEmail({
    subject: 'Re: MEAN WELL', newestText: 'Please quote 100 pcs HDR-60-24.', matched: true,
    companyName: 'Example Industries', contactName: 'Buyer', outboundSubject: 'MEAN WELL products',
  });
  assert.equal(result.classification, 'inquiry');
  assert.equal(result.confidence, 0.97);
  assert.equal(result.source, 'mimo');
  assert.equal(calls[0].url, 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions');
  assert.equal(calls[0].options.headers['api-key'], 'mimo-secret');
  assert.equal(calls[0].body.thinking.type, 'disabled');
  assert.equal(calls[0].body.response_format.type, 'json_object');
  assert.equal(calls[0].body.messages[1].content.includes('buyer@example.com'), false);
  assert.match(calls[0].body.messages[0].content, /changed\/deactivated email address/);
  assert.match(calls[0].body.messages[0].content, /third-party B2B marketplace lead alert/);
  assert.match(calls[0].body.messages[0].content, /test message/);
});

test('MiMo client retries without response_format when the endpoint rejects it', async () => {
  const bodies = [];
  const client = new MiMoClient({
    enabled: true, baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: 'key', model: 'mimo-v2.5-pro',
  }, {
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      if (bodies.length === 1) return new Response('{}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"category":"ordinary_reply","confidence":0.99,"reason":"只是致谢。","summary":"","language":"English","purchaseSignals":[]}' } }] }), { status: 200 });
    },
  });
  const result = await client.classifyInboundEmail({ newestText: 'Thanks.' });
  assert.equal(result.classification, 'ordinary_reply');
  assert.equal(bodies.length, 2);
  assert.equal('response_format' in bodies[1], false);
});

test('MiMo connection test lists the configured model without exposing the key', async () => {
  let headers;
  const client = new MiMoClient({
    enabled: true, baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: 'private-key', model: 'mimo-v2.5-pro',
  }, {
    fetchImpl: async (_url, options) => {
      headers = options.headers;
      return new Response(JSON.stringify({ data: [{ id: 'mimo-v2.5' }, { id: 'mimo-v2.5-pro' }] }), { status: 200 });
    },
  });
  assert.deepEqual(await client.testConnection(), {
    ok: true, model: 'mimo-v2.5-pro', modelAvailable: true,
    availableModels: ['mimo-v2.5', 'mimo-v2.5-pro'],
  });
  assert.deepEqual(headers, { 'api-key': 'private-key' });
});
