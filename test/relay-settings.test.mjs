import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getRelaySettings, updateRelaySettings } from '../src/lib/relay-settings.mjs';

test('relay settings mask keys, update runtime config, and persist to env', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-relay-'));
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, 'OTHER=value\nOPENAI_API_KEY=old-key\n', { mode: 0o600 });
  const config = {
    openai: {
      baseUrl: 'https://old.example/v1', apiKey: 'old-key', model: 'old-model',
      apiStyle: 'chat_completions', reasoningEffort: 'low', webSearchEnabled: false,
    },
  };

  const result = await updateRelaySettings(config, {
    baseUrl: 'https://new.example/v1/', model: 'new-model', apiStyle: 'responses',
    reasoningEffort: 'medium', webSearchEnabled: true, apiKey: 'new-secret-key',
  }, { envPath });

  assert.equal(result.baseUrl, 'https://new.example/v1');
  assert.equal(result.apiKey, '已配置 · 末尾 -key');
  assert.equal(result.apiKeyConfigured, true);
  assert.equal(config.openai.model, 'new-model');
  const saved = fs.readFileSync(envPath, 'utf8');
  assert.match(saved, /OTHER=value/);
  assert.match(saved, /OPENAI_API_KEY=new-secret-key/);
  assert.match(saved, /OPENAI_API_STYLE=responses/);
  assert.equal(saved.includes('old-key'), false);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('relay settings reject unsupported URLs and API styles', async () => {
  const config = { openai: { baseUrl: '', apiKey: 'key', model: 'model', apiStyle: 'chat_completions', reasoningEffort: 'low', webSearchEnabled: false } };
  await assert.rejects(
    updateRelaySettings(config, { baseUrl: 'file:///tmp/relay', apiKey: 'key' }, { envPath: path.join(os.tmpdir(), `relay-${Date.now()}.env`) }),
    /HTTP 或 HTTPS/,
  );
  await assert.rejects(
    updateRelaySettings(config, { baseUrl: 'https://relay.example', apiStyle: 'legacy', apiKey: 'key' }, { envPath: path.join(os.tmpdir(), `relay-${Date.now()}-2.env`) }),
    /API 风格/,
  );
});
