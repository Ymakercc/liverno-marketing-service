import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadEnv } from '../src/config.mjs';

const env = { ...loadEnv(), ...process.env };
const tunnelId = env.BREVO_TUNNEL_ID || '';
const binary = path.resolve(env.CLOUDFLARED_BIN || '.tools/cloudflared');
const originCert = path.resolve(
  env.CLOUDFLARED_ORIGIN_CERT || path.join(os.homedir(), '.cloudflared', 'cert.pem'),
);

if (!tunnelId) throw new Error('BREVO_TUNNEL_ID 未配置');
if (!fs.existsSync(binary)) throw new Error(`cloudflared 不存在：${binary}`);
if (!fs.existsSync(originCert)) throw new Error(`Cloudflare 凭证不存在：${originCert}`);

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ tunnelId, binary, originCert, tokenStored: false }, null, 2));
  process.exit(0);
}

const tokenResult = spawnSync(
  binary,
  ['tunnel', '--origincert', originCert, 'token', tunnelId],
  { encoding: 'utf8', timeout: 30_000 },
);

if (tokenResult.error) throw tokenResult.error;
if (tokenResult.status !== 0) {
  throw new Error(`读取 Tunnel token 失败：${tokenResult.stderr.trim() || '未知错误'}`);
}

const token = tokenResult.stdout.trim();
if (!token.startsWith('eyJ') || token.length < 100) {
  throw new Error('Cloudflare 返回了无效的 Tunnel token');
}

console.log(`Starting Brevo Tunnel ${tunnelId} (token is not stored)`);
const child = spawn(binary, ['tunnel', 'run'], {
  stdio: 'inherit',
  env: { ...process.env, TUNNEL_TOKEN: token },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
