import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.mjs';

const ALLOWED_MODELS = new Set(['mimo-v2.5', 'mimo-v2.5-pro']);

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function parseBoolean(value) {
  return value === true || ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase());
}

function maskKey(value) {
  const key = clean(value);
  return key ? `已配置 · 末尾 ${key.slice(-4)}` : '未配置';
}

function validateBaseUrl(value) {
  const normalized = clean(value).replace(/\/$/, '');
  let url;
  try { url = new URL(normalized); } catch {
    throw new AppError('小米 MiMo API 地址不是有效 URL', { status: 400, code: 'MIMO_CONFIG_INVALID' });
  }
  if (url.protocol !== 'https:') {
    throw new AppError('小米 MiMo API 地址必须使用 HTTPS', { status: 400, code: 'MIMO_CONFIG_INVALID' });
  }
  return normalized;
}

function envLine(key, value) {
  return `${key}=${String(value ?? '').replace(/\r?\n/g, '')}`;
}

export function getMiMoSettings(config) {
  return {
    enabled: Boolean(config.mimo.enabled),
    configured: Boolean(config.mimo.baseUrl && config.mimo.apiKey && config.mimo.model),
    baseUrl: config.mimo.baseUrl,
    model: config.mimo.model,
    apiKey: maskKey(config.mimo.apiKey),
    apiKeyConfigured: Boolean(config.mimo.apiKey),
  };
}

export async function updateMiMoSettings(config, input, { envPath = '.env' } = {}) {
  const body = input || {};
  const baseUrl = body.baseUrl === undefined ? config.mimo.baseUrl : validateBaseUrl(body.baseUrl);
  const model = body.model === undefined ? config.mimo.model : clean(body.model);
  const apiKey = body.apiKey === undefined ? config.mimo.apiKey : clean(body.apiKey);
  const enabled = body.enabled === undefined ? config.mimo.enabled : parseBoolean(body.enabled);

  if (!ALLOWED_MODELS.has(model)) {
    throw new AppError('小米 MiMo 模型只支持 mimo-v2.5 或 mimo-v2.5-pro', {
      status: 400,
      code: 'MIMO_CONFIG_INVALID',
    });
  }
  if (enabled && !apiKey) {
    throw new AppError('开启小米 MiMo 询盘识别前必须填写 API Key', {
      status: 400,
      code: 'MIMO_CONFIG_INVALID',
    });
  }

  Object.assign(config.mimo, { baseUrl, model, apiKey, enabled });
  const absoluteEnvPath = path.resolve(envPath);
  let source = '';
  try { source = await fs.readFile(absoluteEnvPath, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const values = {
    MIMO_BASE_URL: baseUrl,
    MIMO_MODEL: model,
    MIMO_API_KEY: apiKey,
    MIMO_INBOX_CLASSIFICATION_ENABLED: enabled ? 'true' : 'false',
  };
  let output = source;
  for (const [key, value] of Object.entries(values)) {
    const line = envLine(key, value);
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    output = pattern.test(output)
      ? output.replace(pattern, line)
      : `${output}${output && !output.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  await fs.writeFile(absoluteEnvPath, output, { mode: 0o600 });
  return getMiMoSettings(config);
}
