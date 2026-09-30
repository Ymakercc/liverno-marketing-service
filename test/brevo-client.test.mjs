import assert from 'node:assert/strict';
import test from 'node:test';
import { BrevoClient } from '../src/lib/brevo-client.mjs';

test('Brevo client refuses sending while the environment switch is off', async () => {
  const client = new BrevoClient({ apiKey: 'key', sendingEnabled: false });
  await assert.rejects(() => client.send({ to: 'a@example.com', subject: 'Hello', htmlContent: '<p>Hello</p>' }), {
    code: 'SENDING_DISABLED',
  });
});

test('Brevo client sends tagged transactional email with reply-to identity', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ messageId: '<message@brevo>' }), { status: 201 });
  };
  const client = new BrevoClient({
    apiKey: 'key', sendingEnabled: true, senderEmail: 'marketing@kulon.com',
    senderName: 'MEAN WELL KULON TEAM', replyToEmail: 'marketing@kulon.com',
  }, { fetchImpl });
  const result = await client.send({
    to: 'buyer@example.com', toName: 'Buyer', subject: 'Industrial power supplies',
    htmlContent: '<p>Hello</p>', customerId: 'customer-1', jobId: 'job-1',
    campaign: 'second_touch_v1',
  });
  assert.equal(result.messageId, '<message@brevo>');
  assert.equal(request.body.sender.email, 'marketing@kulon.com');
  assert.equal(request.body.replyTo.email, 'marketing@kulon.com');
  assert.match(request.body.headers['X-Mailin-custom'], /customerId=customer-1/);
  assert.match(request.body.headers['X-Mailin-custom'], /campaign=second_touch_v1/);
  assert.deepEqual(request.body.tags, [
    'kulon-automation', 'customer_customer-1', 'job_job-1', 'campaign_second_touch_v1',
  ]);
});

test('Brevo access check exposes an authorised account without returning account data', async () => {
  const client = new BrevoClient({ apiKey: 'key' }, {
    fetchImpl: async () => new Response(JSON.stringify({ email: 'private@example.com' }), { status: 200 }),
  });
  const status = await client.checkAccess();
  assert.equal(status.ok, true);
  assert.equal(status.httpStatus, 200);
  assert.equal('email' in status, false);
  assert.equal(client.getAccessStatus().ok, true);
});

test('Brevo access check reports an IP allowlist block clearly', async () => {
  const client = new BrevoClient({ apiKey: 'key' }, {
    fetchImpl: async () => new Response(JSON.stringify({
      code: 'unauthorized',
      message: 'Unrecognised IP address 203.0.113.10',
    }), { status: 401 }),
  });
  await assert.rejects(() => client.checkAccess(), (error) => {
    assert.equal(error.code, 'BREVO_ACCESS_BLOCKED');
    assert.equal(error.details.httpStatus, 401);
    assert.match(error.message, /203\.0\.113\.10/);
    return true;
  });
  assert.equal(client.getAccessStatus().ok, false);
});
