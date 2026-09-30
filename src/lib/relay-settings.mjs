import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.mjs';

const ALLOWED_STYLES = new Set(['chat_completions', 'responses']);

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function validateBaseUrl(value) {
  const normalized = clean(value).replace(/\/$/, '');
  if (!normalized) return '';
  let url;
  try { url = new URL(normalized); } catch { throw new AppError('中转站地址不是有效 URL', { status: 400, code: 'RELAY_CONFIG_INVALID' }); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new AppError('中转站地址必须使用 HTTP 或 HTTPS', { status: 400, code: 'RELAY_CONFIG_INVALID' });
  }
  return normalized;
}

function maskKey(value) {
  const key = clean(value);
  return key ? `已配置 · 末尾 ${key.slice(-4)}` : '未配置';
}

function envLine(key, value) {
  return `${key}=${String(value ?? '').replace(/\r?\n/g, '')}`;
}

export function getRelaySettings(config) {
  return {
    baseUrl: config.openai.baseUrl,
    model: config.openai.model,
    apiStyle: config.openai.apiStyle,
    reasoningEffort: config.openai.reasoningEffort,
    webSearchEnabled: Boolean(config.openai.webSearchEnabled),
    apiKey: maskKey(config.openai.apiKey),
    apiKeyConfigured: Boolean(config.openai.apiKey),
  };
}

export async function updateRelaySettings(config, input, { envPath = '.env' } = {}) {
  const body = input || {};
  const baseUrl = body.baseUrl === undefined ? config.openai.baseUrl : validateBaseUrl(body.baseUrl);
  const model = body.model === undefined ? config.openai.model : clean(body.model);
  const apiStyle = body.apiStyle === undefined ? config.openai.apiStyle : clean(body.apiStyle);
  const reasoningEffort = body.reasoningEffort === undefined ? config.openai.reasoningEffort : clean(body.reasoningEffort);
  const webSearchEnabled = body.webSearchEnabled === undefined
    ? config.openai.webSearchEnabled
    : Boolean(body.webSearchEnabled);
  const apiKey = body.apiKey === undefined ? config.openai.apiKey : clean(body.apiKey);

  if (!baseUrl || !model || !apiKey) {
    throw new AppError('中转站地址、模型名称和 API Key 都不能为空', { status: 400, code: 'RELAY_CONFIG_INVALID' });
  }
  if (!ALLOWED_STYLES.has(apiStyle)) {
    throw new AppError('API 风格只支持 chat_completions 或 responses', { status: 400, code: 'RELAY_CONFIG_INVALID' });
  }

  Object.assign(config.openai, { baseUrl, model, apiStyle, reasoningEffort, webSearchEnabled, apiKey });

  const absoluteEnvPath = path.resolve(envPath);
  let source = '';
  try { source = await fs.readFile(absoluteEnvPath, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const values = {
    OPENAI_BASE_URL: baseUrl,
    OPENAI_MODEL: model,
    OPENAI_API_STYLE: apiStyle,
    OPENAI_REASONING_EFFORT: reasoningEffort,
    OPENAI_WEB_SEARCH_ENABLED: webSearchEnabled ? 'true' : 'false',
    OPENAI_API_KEY: apiKey,
  };
  let output = source;
  for (const [key, value] of Object.entries(values)) {
    const line = envLine(key, value);
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    output = pattern.test(output) ? output.replace(pattern, line) : `${output}${output && !output.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  await fs.writeFile(absoluteEnvPath, output, { mode: 0o600 });
  return getRelaySettings(config);
}
