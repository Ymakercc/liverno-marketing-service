import fs from 'fs';
import path from 'path';

const inputPath = process.argv[2] || 'n8n.json';
const outputPath = process.argv[3] || path.join('workflows', 'n8n.sanitized.json');

const sensitiveCredentialTypes = new Set([
  'feishuCredentialsApi',
  'googlePalmApi',
  'firecrawlApi',
  'sendInBlueApi',
]);

const sanitizeString = (value) =>
  value
    .replace(/expectedToken = '[^']+';/g, "expectedToken = '{{BREVO_WEBHOOK_TOKEN}}';")
    .replace(/\$vars\.FROM_EMAIL \|\| "[^"]+"/g, '$vars.FROM_EMAIL || "{{FROM_EMAIL}}"')
    .replace(/mailto:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, 'mailto:{{EMAIL}}');

const sanitize = (value) => {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'app_toke') {
      out[key] = '{{FEISHU_APP_TOKEN}}';
      continue;
    }
    if (key === 'table_id') {
      out[key] = '{{FEISHU_TABLE_ID}}';
      continue;
    }
    if (key === 'credentials' && child && typeof child === 'object') {
      out[key] = {};
      for (const [credType, credValue] of Object.entries(child)) {
        out[key][credType] = sensitiveCredentialTypes.has(credType)
          ? { id: '{{N8N_CREDENTIAL_ID}}', name: `{{${credType.toUpperCase()}_NAME}}` }
          : sanitize(credValue);
      }
      continue;
    }
    out[key] = sanitize(child);
  }
  return out;
};

if (!fs.existsSync(inputPath)) {
  throw new Error(`Input workflow not found: ${inputPath}`);
}

const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const sanitized = sanitize(workflow);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(sanitized, null, 2) + '\n');
console.log(`Wrote ${outputPath}`);
