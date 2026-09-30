import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.mjs';

function envLine(key, value) {
  return `${key}=${String(value ?? '').replace(/\r?\n/g, '')}`;
}

export function validateCompanyLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 300) {
    throw new AppError('每日营销公司数必须是 1-300 的整数', {
      status: 400,
      code: 'MARKETING_CONFIG_INVALID',
    });
  }
  return parsed;
}

export function validateMarketingEnabled(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new AppError('营销开关必须是布尔值', {
    status: 400,
    code: 'MARKETING_CONFIG_INVALID',
  });
}

export function getMarketingSettings(config, stats = {}) {
  const prepared = Number(stats.companiesPreparedToday || 0);
  const marketed = Number(stats.companiesMarketedToday || 0);
  const apolloResearchToday = Number(stats.apolloResearchToday || 0);
  const feishuResearchRecordedToday = Number(stats.feishuResearchRecordedToday || 0);
  return {
    enabled: config.marketing.enabled !== false,
    researchEnabled: config.marketing.researchEnabled !== false,
    researchPauseReason: config.marketing.researchPauseReason || '',
    dailyCompanyLimit: config.marketing.dailyCompanyLimit,
    dailyResearchLimit: config.marketing.dailyResearchLimit,
    companiesMarketedToday: marketed,
    companiesPreparedToday: prepared,
    companiesResearchedTotal: Number(stats.companiesResearchedTotal || 0),
    companiesMarketedTotal: Number(stats.companiesMarketedTotal || 0),
    apolloResearchToday,
    feishuResearchRecordedToday,
    feishuResearchMissingToday: Math.max(apolloResearchToday - feishuResearchRecordedToday, 0),
    remainingCompaniesToday: Math.max(config.marketing.dailyCompanyLimit - marketed, 0),
    remainingResearchToday: Math.max(config.marketing.dailyResearchLimit - apolloResearchToday, 0),
    dailySendLimit: config.marketing.dailySendLimit,
    emailsAllocatedToday: Number(stats.emailsAllocatedToday || 0),
    emailsSentToday: Number(stats.emailsSentToday || 0),
    remainingEmailsToday: Math.max(config.marketing.dailySendLimit - Number(stats.emailsSentToday || 0), 0),
    excludedToday: Number(stats.excludedCompaniesToday || 0),
    sendingEnabled: Boolean(config.brevo.sendingEnabled),
    researchReady: Boolean(config.marketing.enabled !== false && config.marketing.researchEnabled !== false),
    sendingReady: Boolean(config.marketing.enabled !== false && config.brevo.sendingEnabled),
  };
}

export async function updateMarketingSettings(config, input, { envPath = '.env' } = {}) {
  const body = input || {};
  const dailyCompanyLimit = validateCompanyLimit(
    body.dailyCompanyLimit === undefined ? config.marketing.dailyCompanyLimit : body.dailyCompanyLimit,
  );
  const hasMarketingToggle = body.enabled !== undefined;
  const hasResearchToggle = body.researchEnabled !== undefined;
  const hasSendingToggle = body.sendingEnabled !== undefined;
  const enabled = !hasMarketingToggle
    ? config.marketing.enabled !== false
    : validateMarketingEnabled(body.enabled);
  const sendingEnabled = hasSendingToggle
    ? validateMarketingEnabled(body.sendingEnabled)
    : hasMarketingToggle
      ? enabled
      : Boolean(config.brevo.sendingEnabled);
  const researchEnabled = hasResearchToggle
    ? validateMarketingEnabled(body.researchEnabled)
    : config.marketing.researchEnabled !== false;
  const researchPauseReason = researchEnabled
    ? ''
    : String(body.researchPauseReason || config.marketing.researchPauseReason || 'manual').trim();
  config.marketing.dailyCompanyLimit = dailyCompanyLimit;
  config.marketing.enabled = enabled;
  config.marketing.researchEnabled = researchEnabled;
  config.marketing.researchPauseReason = researchPauseReason;
  config.brevo.sendingEnabled = sendingEnabled;

  const absoluteEnvPath = path.resolve(envPath);
  let source = '';
  try { source = await fs.readFile(absoluteEnvPath, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const values = [
    ['DAILY_COMPANY_LIMIT', dailyCompanyLimit],
    ['MARKETING_AUTOMATION_ENABLED', enabled],
  ];
  if (hasMarketingToggle || hasSendingToggle) values.push(['EMAIL_SENDING_ENABLED', sendingEnabled]);
  if (hasResearchToggle) {
    values.push(['APOLLO_RESEARCH_ENABLED', researchEnabled]);
    values.push(['APOLLO_RESEARCH_PAUSE_REASON', researchPauseReason]);
  }
  let output = source;
  for (const [key, value] of values) {
    const line = envLine(key, value);
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    output = pattern.test(output)
      ? output.replace(pattern, line)
      : `${output}${output && !output.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  await fs.writeFile(absoluteEnvPath, output, { mode: 0o600 });
  return getMarketingSettings(config);
}
