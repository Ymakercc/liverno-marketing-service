import { createConfig } from '../src/config.mjs';

const config = createConfig();
const dryRun = process.argv.includes('--dry-run');
const events = [
  'request', 'sent', 'delivered', 'opened', 'uniqueOpened', 'click', 'deferred',
  'softBounce', 'hardBounce', 'invalid', 'blocked', 'spam', 'unsubscribed', 'error',
  'proxyOpen', 'uniqueProxyOpen',
];

function requireValue(value, name) {
  if (!value) throw new Error(`${name} 未配置，请先填写 .env`);
  return value;
}

const apiKey = requireValue(config.brevo.apiKey, 'BREVO_API_KEY');
const url = requireValue(config.brevo.webhookPublicUrl, 'BREVO_WEBHOOK_PUBLIC_URL');
const token = requireValue(config.brevo.webhookToken, 'BREVO_WEBHOOK_TOKEN');
const body = {
  description: 'KULON marketing console delivery events',
  url,
  events,
  type: 'transactional',
  auth: { type: 'bearer', token },
};

if (dryRun) {
  console.log(JSON.stringify({ ...body, auth: { type: 'bearer', token: '<redacted>' } }, null, 2));
  process.exit(0);
}

const listResponse = await fetch('https://api.brevo.com/v3/webhooks?type=transactional', {
  headers: { accept: 'application/json', 'api-key': apiKey },
});
if (!listResponse.ok) throw new Error(`读取 Brevo Webhook 失败（${listResponse.status}）`);
const list = await listResponse.json();
const existing = (list.webhooks || []).find((webhook) => webhook.url === url);
if (existing) {
  console.log(`Brevo Webhook 已存在：${existing.id} ${url}`);
  process.exit(0);
}

const createResponse = await fetch('https://api.brevo.com/v3/webhooks', {
  method: 'POST',
  headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const result = await createResponse.json().catch(() => ({}));
if (!createResponse.ok) {
  throw new Error(`创建 Brevo Webhook 失败（${createResponse.status}）：${result.message || '未知错误'}`);
}
console.log(`Brevo Webhook 创建成功：${result.id || '已创建'} ${url}`);
