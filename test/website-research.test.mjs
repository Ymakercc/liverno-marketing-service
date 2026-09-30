import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWebsiteEvidence, researchWebsite } from '../src/lib/website-research.mjs';

test('website evidence recognizes direct MEAN WELL and industrial automation signals', () => {
  const evidence = extractWebsiteEvidence(`
    <html><head><title>Industrial Controles</title>
    <meta name="description" content="Automatización industrial y fuentes de alimentación">
    <meta name="keywords" content="meanwell sensores control industrial"></head>
    <body><h1>Fuentes Switching</h1><p>Representante MEAN WELL</p></body></html>
  `, 'https://industrial.example/');

  assert.equal(evidence.status, 'fetched');
  assert.equal(evidence.signals.meanWellMentioned, true);
  assert.equal(evidence.signals.directFit, true);
  assert.ok(evidence.signals.matchedTerms.includes('automatización industrial'));
  assert.match(evidence.text, /Fuentes Switching/);
});

test('website research follows public redirects and blocks private destinations', async () => {
  const lookupImpl = async (hostname) => hostname === 'example.com'
    ? [{ address: '93.184.216.34' }]
    : [{ address: '127.0.0.1' }];
  const fetched = await researchWebsite('example.com', {
    lookupImpl,
    fetchImpl: async () => new Response('<title>Power supply distributor</title>', {
      status: 200, headers: { 'content-type': 'text/html' },
    }),
  });
  const blocked = await researchWebsite('localhost', { lookupImpl, fetchImpl: async () => new Response('bad') });

  assert.equal(fetched.status, 'fetched');
  assert.equal(blocked.status, 'missing');
});

test('website research cancels oversized streaming responses before reading the full body', async () => {
  let cancelled = false;
  let chunks = 0;
  const body = new ReadableStream({
    pull(controller) {
      chunks += 1;
      controller.enqueue(new Uint8Array(600_000));
    },
    cancel() { cancelled = true; },
  });
  const result = await researchWebsite('example.com', {
    lookupImpl: async () => [{ address: '93.184.216.34' }],
    fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/html' } }),
  });
  assert.equal(result.status, 'failed');
  assert.match(result.error, /1 MB/);
  assert.equal(cancelled, true);
  assert.ok(chunks < 4);
});
