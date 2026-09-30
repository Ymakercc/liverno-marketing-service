import fs from 'node:fs';
import path from 'node:path';
import { createConfig } from '../src/config.mjs';

const config = createConfig();
const baseUrl = `http://127.0.0.1:${config.server.port}`;
if (!config.marketing.automationToken) throw new Error('AUTOMATION_TOKEN 未配置');

const healthResponse = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
const health = await healthResponse.json();
if (!healthResponse.ok || !health.ok) throw new Error('营销后台未就绪');
if (health.capabilities?.sending) throw new Error('安全试跑前必须关闭邮件发送');

const headers = {
  authorization: `Bearer ${config.marketing.automationToken}`,
  'content-type': 'application/json',
};
const requestedCustomerIds = process.argv.slice(2).map((item) => item.trim()).filter(Boolean);
let candidateItems;
if (requestedCustomerIds.length) {
  if (requestedCustomerIds.length > 10) throw new Error('一次最多安全试跑 10 家客户');
  candidateItems = requestedCustomerIds.map((id) => ({ id, companyName: id }));
} else {
  const candidatesResponse = await fetch(`${baseUrl}/api/automation/candidates?limit=10`, {
    headers,
    signal: AbortSignal.timeout(60_000),
  });
  const candidates = await candidatesResponse.json();
  if (!candidatesResponse.ok) throw new Error(candidates.error?.message || '候选客户读取失败');
  candidateItems = candidates.items;
}

const results = [];
for (const [index, customer] of candidateItems.entries()) {
  process.stdout.write(`[${index + 1}/${candidateItems.length}] ${customer.companyName} ... `);
  try {
    const response = await fetch(`${baseUrl}/api/automation/validate-customer`, {
      method: 'POST', headers,
      body: JSON.stringify({ customerId: customer.id }),
      signal: AbortSignal.timeout(4 * 60_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
    results.push(result);
    console.log(result.queued ? `已排队 ${result.queuedCount || 1}` : result.reason || '已完成');
  } catch (error) {
    results.push({ queued: false, reason: 'prepare_failed', customerId: customer.id, error: error.message });
    console.log(`失败：${error.message}`);
  }
}
const result = {
  validationMode: true,
  sendingDisabled: true,
  researched: results.length,
  candidates: candidateItems.map((item) => ({ id: item.id, companyName: item.companyName })),
  results,
};

const outputDirectory = path.resolve('.data/validation');
fs.mkdirSync(outputDirectory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputPath = path.join(outputDirectory, `pilot-10-${timestamp}.json`);
fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

const reasons = results.reduce((summary, item) => {
  summary[item.reason || (item.queued ? 'queued' : 'unknown')] =
    (summary[item.reason || (item.queued ? 'queued' : 'unknown')] || 0) + 1;
  return summary;
}, {});
console.log(JSON.stringify({
  researched: result.researched,
  queuedCompanies: results.filter((item) => item.queued).length,
  reasons,
  report: outputPath,
}, null, 2));
