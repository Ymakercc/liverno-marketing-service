import { spawn } from 'node:child_process';

const services = [
  ['console', ['src/server.mjs']],
  ['gateway', ['scripts/brevo-webhook-gateway.mjs']],
  ['tunnel', ['scripts/run-brevo-tunnel.mjs']],
];
const children = [];
let stopping = false;

function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const { child } of children) {
    if (!child.killed) child.kill(signal);
  }
}

for (const [name, args] of services) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  children.push({ name, child });
  child.on('error', (error) => {
    console.error(`[${name}] ${error.message}`);
    process.exitCode = 1;
    stop();
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[${name}] stopped (${signal || code})`);
    process.exitCode = code || 1;
    stop();
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stop(signal));
}
