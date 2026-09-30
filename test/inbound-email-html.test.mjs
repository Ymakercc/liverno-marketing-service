import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInboundEmailDocument, prepareInboundEmailHtml } from '../src/lib/inbound-email-html.mjs';

test('inbound HTML keeps email layout and inline images while removing active content and trackers', () => {
  const html = prepareInboundEmailHtml({
    html: `
      <html><head><style>.card { color: #063; }</style><script>alert('x')</script></head>
      <body><table class="card" style="color:#063"><tr><td><a href="https://example.com/quote">Request quote</a></td></tr></table>
      <img src="cid:logo@example"><img width="1" height="1" src="https://x.sendibt2.com/tr/op/abc"></body></html>
    `,
    attachments: [{ contentId: '<logo@example>', contentType: 'image/png', content: Buffer.from('image') }],
  });
  assert.doesNotMatch(html, /<style>/);
  assert.match(html, /<table class="card" style="color:#063">/);
  assert.match(html, /data:image\/png;base64,/);
  assert.doesNotMatch(html, /<script|alert\(/);
  assert.doesNotMatch(html, /href=/);
  assert.doesNotMatch(html, /sendibt2/);
});

test('inbound HTML document adds a responsive isolated preview shell', () => {
  const document = buildInboundEmailDocument('<p>Quotation requested</p>');
  assert.match(document, /^<!doctype html>/);
  assert.match(document, /name="viewport"/);
  assert.match(document, /Quotation requested/);
});
