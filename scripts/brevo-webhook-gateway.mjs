import http from 'node:http';
import { loadEnv } from '../src/config.mjs';

const env = { ...loadEnv(), ...process.env };
const host = '127.0.0.1';
const port = Number(env.BREVO_GATEWAY_PORT || 8790);
const target = new URL(env.BREVO_GATEWAY_TARGET || 'http://127.0.0.1:8787/api/webhooks/brevo');

const server = http.createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/api/webhooks/brevo') {
    response.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end('{"error":"not_found"}');
    return;
  }

  const upstream = http.request({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    method: 'POST',
    headers: {
      'content-type': request.headers['content-type'] || 'application/json',
      authorization: request.headers.authorization || '',
      'x-brevo-webhook-token': request.headers['x-brevo-webhook-token'] || '',
    },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, {
      'content-type': upstreamResponse.headers['content-type'] || 'application/json',
      'cache-control': 'no-store',
    });
    upstreamResponse.pipe(response);
  });
  upstream.on('error', () => {
    response.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end('{"error":"upstream_unavailable"}');
  });
  request.pipe(upstream);
});

server.listen(port, host, () => {
  console.log(`Brevo-only gateway: http://${host}:${port}/api/webhooks/brevo`);
});
