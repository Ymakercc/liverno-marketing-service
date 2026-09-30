import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve('.env');
const outputDirectory = path.resolve('.data/n8n-import');
const workflowDirectory = path.resolve('workflows');
const workflowFiles = [
  'kulon-candidate-preparation.json',
  'kulon-send-dispatch.json',
  'kulon-inbox-monitoring.json',
];

function readValue(source, key) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function setValue(source, key, value) {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^${key}=.*$`, 'm');
  if (expression.test(source)) return source.replace(expression, line);
  return `${source.trimEnd()}\n${line}\n`;
}

let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
let token = readValue(env, 'AUTOMATION_TOKEN');
if (!token) {
  token = crypto.randomBytes(32).toString('hex');
  env = setValue(env, 'AUTOMATION_TOKEN', token);
  fs.writeFileSync(envPath, env, { mode: 0o600 });
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const file of workflowFiles) {
  const workflow = JSON.parse(fs.readFileSync(path.join(workflowDirectory, file), 'utf8'));
  for (const node of workflow.nodes) {
    const headers = node.parameters?.headerParameters?.parameters || [];
    for (const header of headers) {
      if (header.name === 'Authorization' && String(header.value).includes('AUTOMATION_TOKEN')) {
        header.value = `Bearer ${token}`;
      }
    }
  }
  fs.writeFileSync(path.join(outputDirectory, file), `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o600 });
}

console.log(`Prepared ${workflowFiles.length} workflows in ${outputDirectory}`);
console.log('AUTOMATION_TOKEN is configured locally and was not printed.');
