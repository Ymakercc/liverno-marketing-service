import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('Brevo tunnel dry-run validates local configuration without exposing a token', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/run-brevo-tunnel.mjs', '--dry-run'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        BREVO_TUNNEL_ID: '00000000-0000-4000-8000-000000000001',
        CLOUDFLARED_BIN: process.execPath,
        CLOUDFLARED_ORIGIN_CERT: fileURLToPath(import.meta.url),
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.tokenStored, false);
  assert.match(output.tunnelId, /^[0-9a-f-]{36}$/);
  assert.equal(result.stdout.includes('eyJ'), false);
});
