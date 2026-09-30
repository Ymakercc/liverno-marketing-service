import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getMiMoSettings, updateMiMoSettings } from '../src/lib/mimo-settings.mjs';

test('MiMo settings mask the key and persist independent inbox AI configuration', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-mimo-settings-'));
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, 'OPENAI_API_KEY=keep-existing\n');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { mimo: {
    enabled: false, baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: '', model: 'mimo-v2.5-pro', timeoutMs: 45_000,
  } };
  const settings = await updateMiMoSettings(config, {
    enabled: true, apiKey: 'secret-1234', model: 'mimo-v2.5-pro', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1/',
  }, { envPath });
  assert.equal(settings.enabled, true);
  assert.equal(settings.apiKey, '已配置 · 末尾 1234');
  assert.equal(JSON.stringify(settings).includes('secret-1234'), false);
  const source = fs.readFileSync(envPath, 'utf8');
  assert.match(source, /MIMO_INBOX_CLASSIFICATION_ENABLED=true/);
  assert.match(source, /MIMO_API_KEY=secret-1234/);
  assert.match(source, /OPENAI_API_KEY=keep-existing/);
  assert.equal(getMiMoSettings(config).configured, true);
});

test('MiMo settings require a key before enabling', async () => {
  const config = { mimo: {
    enabled: false, baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', apiKey: '', model: 'mimo-v2.5-pro',
  } };
  await assert.rejects(
    updateMiMoSettings(config, { enabled: true }, { envPath: '/tmp/not-written-mimo.env' }),
    (error) => error.code === 'MIMO_CONFIG_INVALID',
  );
});
