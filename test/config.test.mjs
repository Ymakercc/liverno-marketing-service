import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfig, getCapabilityStatus } from '../src/config.mjs';

test('relay configuration defaults to chat completions', () => {
  const config = createConfig({
    envFile: '/file/that/does/not/exist',
    processEnv: {
      FUMENG_APP_ID: 'app',
      FUMENG_APP_SECRET: 'secret',
      OPENAI_BASE_URL: 'https://relay.example/v1/',
      OPENAI_API_KEY: 'key',
      OPENAI_MODEL: 'relay-model',
      BREVO_API_KEY: 'brevo-key',
      BREVO_WEBHOOK_TOKEN: 'webhook-token',
      APOLLO_API_KEY: 'apollo-key',
      AUTOMATION_TOKEN: 'automation-token',
      FUMENG_WRITEBACK_ENABLED: 'true',
      MARKETING_AUTOMATION_ENABLED: 'true',
      EMAIL_SENDING_ENABLED: 'true',
      MAILBOX_MONITORING_ENABLED: 'true',
      MAILBOX_IMAP_USERNAME: 'marketing@kulon.com',
      MAILBOX_IMAP_PASSWORD: 'client-authorization-code',
      MIMO_INBOX_CLASSIFICATION_ENABLED: 'true',
      MIMO_API_KEY: 'mimo-key',
    },
  });

  assert.equal(config.openai.baseUrl, 'https://relay.example/v1');
  assert.equal(config.openai.apiStyle, 'chat_completions');
  assert.equal(getCapabilityStatus(config).fumeng, true);
  assert.equal(getCapabilityStatus(config).openai, true);
  assert.equal(getCapabilityStatus(config).signature, true);
  assert.equal(getCapabilityStatus(config).brevo, true);
  assert.equal(getCapabilityStatus(config).deliveryTracking, true);
  assert.equal(getCapabilityStatus(config).apollo, true);
  assert.equal(getCapabilityStatus(config).fumengWriteback, true);
  assert.equal(getCapabilityStatus(config).automation, true);
  assert.equal(getCapabilityStatus(config).sending, true);
  assert.equal(getCapabilityStatus(config).mailbox, true);
  assert.equal(getCapabilityStatus(config).inboxAi, true);
  assert.equal(config.mimo.model, 'mimo-v2.5-pro');
  assert.equal(config.mimo.baseUrl, 'https://token-plan-cn.xiaomimimo.com/v1');
  assert.equal(config.marketing.dailySendLimit, 300);
});

test('signature configuration uses the approved team identity and supports overrides', () => {
  const config = createConfig({
    envFile: '/file/that/does/not/exist',
    processEnv: {
      SALES_TEAM_NAME: 'KULON EXPORT TEAM',
      SALES_EMAIL: 'export@kulon.com',
      YOUR_COMPANY_NAME: 'Kulon Electronics',
      YOUR_WEBSITE: 'https://kulon.com',
    },
  });

  assert.equal(getCapabilityStatus(config).signature, true);
  assert.equal(config.sales.teamName, 'KULON EXPORT TEAM');
  assert.equal(config.sales.email, 'export@kulon.com');
  assert.equal(config.sales.companyName, 'Kulon Electronics');
});

test('paused Apollo research remains configured but is unavailable to research workflows', () => {
  const config = createConfig({
    envFile: '/file/that/does/not/exist',
    processEnv: {
      APOLLO_API_KEY: 'apollo-key',
      APOLLO_RESEARCH_ENABLED: 'false',
      APOLLO_RESEARCH_PAUSE_REASON: 'apollo_credits_exhausted',
    },
  });
  const capabilities = getCapabilityStatus(config);

  assert.equal(capabilities.apolloConfigured, true);
  assert.equal(capabilities.apollo, false);
  assert.equal(config.marketing.researchEnabled, false);
  assert.equal(config.marketing.researchPauseReason, 'apollo_credits_exhausted');
});

test('web authentication loads only the password hash and uses a seven day session', () => {
  const config = createConfig({
    envFile: '/file/that/does/not/exist',
    processEnv: { WEB_LOGIN_PASSWORD_HASH: 'scrypt$fixture' },
  });

  assert.equal(config.auth.passwordHash, 'scrypt$fixture');
  assert.equal(config.auth.sessionTtlMs, 7 * 24 * 60 * 60 * 1000);
  assert.equal('password' in config.auth, false);
});
