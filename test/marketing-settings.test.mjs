import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getMarketingSettings, updateMarketingSettings } from '../src/lib/marketing-settings.mjs';

test('marketing company target updates runtime config and env without changing send cap', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-marketing-settings-'));
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, 'DAILY_COMPANY_LIMIT=10\nDAILY_SEND_LIMIT=30\n');
  const config = {
    marketing: { enabled: false, dailyCompanyLimit: 10, dailyResearchLimit: 100, dailySendLimit: 30 },
    brevo: { sendingEnabled: false },
  };
  const result = await updateMarketingSettings(config, { dailyCompanyLimit: 24 }, { envPath });
  assert.equal(result.dailyCompanyLimit, 24);
  assert.equal(result.dailySendLimit, 30);
  assert.equal(config.marketing.dailyCompanyLimit, 24);
  assert.equal(config.marketing.enabled, false);
  assert.match(fs.readFileSync(envPath, 'utf8'), /DAILY_COMPANY_LIMIT=24/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('marketing company target rejects values outside the control range', async () => {
  const config = {
    marketing: { enabled: false, dailyCompanyLimit: 10, dailyResearchLimit: 100, dailySendLimit: 30 },
    brevo: { sendingEnabled: false },
  };
  await assert.rejects(
    updateMarketingSettings(config, { dailyCompanyLimit: 301 }, { envPath: path.join(os.tmpdir(), `marketing-${Date.now()}.env`) }),
    /1-300/,
  );
});

test('marketing settings expose Apollo to Feishu audit completeness', () => {
  const config = {
    marketing: { enabled: false, dailyCompanyLimit: 10, dailyResearchLimit: 100, dailySendLimit: 30 },
    brevo: { sendingEnabled: false },
  };
  const settings = getMarketingSettings(config, {
    apolloResearchToday: 44,
    feishuResearchRecordedToday: 43,
    companiesResearchedTotal: 856,
    companiesMarketedTotal: 103,
  });
  assert.equal(settings.apolloResearchToday, 44);
  assert.equal(settings.feishuResearchRecordedToday, 43);
  assert.equal(settings.feishuResearchMissingToday, 1);
  assert.equal(settings.companiesResearchedTotal, 856);
  assert.equal(settings.companiesMarketedTotal, 103);
  assert.equal(settings.remainingResearchToday, 56);
});

test('marketing toggle persists and controls sending together', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-marketing-toggle-'));
  const envPath = path.join(directory, '.env');
  const config = {
    marketing: { enabled: false, dailyCompanyLimit: 10, dailyResearchLimit: 100, dailySendLimit: 30 },
    brevo: { sendingEnabled: false },
  };
  const enabled = await updateMarketingSettings(config, { enabled: true }, { envPath });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.sendingEnabled, true);
  assert.match(fs.readFileSync(envPath, 'utf8'), /MARKETING_AUTOMATION_ENABLED=true/);
  assert.match(fs.readFileSync(envPath, 'utf8'), /EMAIL_SENDING_ENABLED=true/);
  const paused = await updateMarketingSettings(config, { enabled: false }, { envPath });
  assert.equal(paused.enabled, false);
  assert.equal(paused.sendingEnabled, false);
  assert.match(fs.readFileSync(envPath, 'utf8'), /EMAIL_SENDING_ENABLED=false/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('email sending toggle can be changed independently from the marketing toggle', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-email-toggle-'));
  const envPath = path.join(directory, '.env');
  const config = {
    marketing: { enabled: false, dailyCompanyLimit: 10, dailyResearchLimit: 100, dailySendLimit: 30 },
    brevo: { sendingEnabled: false },
  };

  const enabled = await updateMarketingSettings(config, { sendingEnabled: true }, { envPath });
  assert.equal(enabled.enabled, false);
  assert.equal(enabled.sendingEnabled, true);
  assert.equal(enabled.sendingReady, false);
  assert.match(fs.readFileSync(envPath, 'utf8'), /EMAIL_SENDING_ENABLED=true/);
  assert.match(fs.readFileSync(envPath, 'utf8'), /MARKETING_AUTOMATION_ENABLED=false/);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('Apollo research can pause independently while total marketing and email sending stay enabled', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-research-toggle-'));
  const envPath = path.join(directory, '.env');
  const config = {
    marketing: {
      enabled: true,
      researchEnabled: true,
      researchPauseReason: '',
      dailyCompanyLimit: 100,
      dailyResearchLimit: 1000,
      dailySendLimit: 300,
    },
    brevo: { sendingEnabled: true },
  };

  const settings = await updateMarketingSettings(config, {
    researchEnabled: false,
    researchPauseReason: 'apollo_credits_exhausted',
  }, { envPath });

  assert.equal(settings.enabled, true);
  assert.equal(settings.researchEnabled, false);
  assert.equal(settings.researchPauseReason, 'apollo_credits_exhausted');
  assert.equal(settings.sendingEnabled, true);
  assert.equal(settings.researchReady, false);
  assert.equal(settings.sendingReady, true);
  const source = fs.readFileSync(envPath, 'utf8');
  assert.match(source, /APOLLO_RESEARCH_ENABLED=false/);
  assert.match(source, /APOLLO_RESEARCH_PAUSE_REASON=apollo_credits_exhausted/);
  assert.doesNotMatch(source, /EMAIL_SENDING_ENABLED=false/);

  fs.rmSync(directory, { recursive: true, force: true });
});
