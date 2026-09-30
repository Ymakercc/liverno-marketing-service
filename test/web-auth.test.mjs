import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  WEB_SESSION_TTL_MS,
  WebAuth,
  hashWebPassword,
  isLoopbackAddress,
  issueWebSession,
  persistWebPassword,
  readWebSessionCookie,
  serializeWebSessionCookie,
  validateWebPassword,
  verifyWebPassword,
  verifyWebSession,
} from '../src/lib/web-auth.mjs';

test('scrypt hashes and verifies ASCII and Chinese passwords without storing plaintext', async () => {
  const password = '安全密码1234';
  const passwordHash = await hashWebPassword(password, { salt: Buffer.alloc(16, 7) });

  assert.match(passwordHash, /^scrypt\$1\$16384\$8\$1\$/);
  assert.equal(passwordHash.includes(password), false);
  assert.equal(await verifyWebPassword(password, passwordHash), true);
  assert.equal(await verifyWebPassword('错误密码1234', passwordHash), false);
  assert.equal(await verifyWebPassword(password, 'invalid-hash'), false);
});

test('password validation requires at least eight Unicode characters', () => {
  assert.equal(validateWebPassword('中文密码一二三四'), '中文密码一二三四');
  assert.throws(
    () => validateWebPassword('短密码123'),
    (error) => error.code === 'WEB_PASSWORD_INVALID' && error.status === 400,
  );
  assert.throws(() => validateWebPassword('a'.repeat(257)), /不能超过 256 个字符/);
  assert.throws(() => validateWebPassword('abcdefgh\u0000'), /不能包含空字符/);
});

test('seven day sessions verify and reject tampering, expiry, and a changed password hash', async () => {
  const now = Date.UTC(2026, 8, 5, 8);
  const firstHash = await hashWebPassword('第一个安全密码88', { salt: Buffer.alloc(16, 1) });
  const nextHash = await hashWebPassword('第二个安全密码99', { salt: Buffer.alloc(16, 2) });
  const token = issueWebSession(firstHash, { now, sessionId: 'fixed-session-id' });
  const session = verifyWebSession(token, firstHash, { now: now + 1 });
  const [payload, signature] = token.split('.');
  const tamperedSignature = `${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`;

  assert.deepEqual(session, {
    issuedAt: now,
    expiresAt: now + WEB_SESSION_TTL_MS,
    sessionId: 'fixed-session-id',
  });
  assert.equal(verifyWebSession(`${payload}.${tamperedSignature}`, firstHash, { now: now + 1 }), null);
  assert.equal(verifyWebSession(token, firstHash, { now: now + WEB_SESSION_TTL_MS }), null);
  assert.equal(verifyWebSession(token, nextHash, { now: now + 1 }), null);
});

test('session cookie is HttpOnly and can be read from a request cookie header', async () => {
  const passwordHash = await hashWebPassword('cookie安全密码', { salt: Buffer.alloc(16, 3) });
  const token = issueWebSession(passwordHash, { now: 1000, sessionId: 'cookie-id' });
  const cookie = serializeWebSessionCookie(token, { secure: true });

  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=604800/);
  assert.match(cookie, /; Secure$/);
  assert.equal(readWebSessionCookie(`theme=light; ${cookie.split(';')[0]}`), token);
});

test('persistWebPassword updates .env and runtime config with only a hash', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-web-auth-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(
    envPath,
    'WEB_LOGIN_PASSWORD_HASH=stale-hash\nOTHER=value\nWEB_LOGIN_PASSWORD_HASH=old-hash\n',
    { mode: 0o644 },
  );
  const config = { auth: { passwordHash: '' } };
  const plaintext = '我自己设置的密码88';

  const passwordHash = await persistWebPassword(config, plaintext, { envPath });
  const source = fs.readFileSync(envPath, 'utf8');

  assert.equal(config.auth.passwordHash, passwordHash);
  assert.equal(source.includes(plaintext), false);
  assert.equal(source.match(/^WEB_LOGIN_PASSWORD_HASH=/gm)?.length, 1);
  assert.match(source, /^OTHER=value$/m);
  assert.match(source, /^WEB_LOGIN_PASSWORD_HASH=scrypt\$/m);
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
});

test('WebAuth provides a server-ready setup, login, session, and password rotation API', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-web-auth-class-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = { auth: { passwordHash: '' } };
  const auth = new WebAuth(config, {
    envPath: path.join(directory, '.env'),
    now: () => 5000,
  });

  assert.equal(auth.configured, false);
  await auth.setupPassword('首次设置密码88');
  assert.equal(auth.configured, true);
  assert.equal(await auth.authenticate('首次设置密码88'), true);
  assert.equal(await auth.authenticate('错误的登录密码'), false);
  await assert.rejects(
    auth.setupPassword('不能再次设置密码'),
    (error) => error.code === 'WEB_AUTH_ALREADY_CONFIGURED' && error.status === 409,
  );

  const issued = auth.issueSession();
  assert.ok(auth.verifySession(issued.token));
  assert.ok(auth.readSession(issued.cookie.split(';')[0]));
  assert.match(auth.clearSessionCookie(), /Max-Age=0/);

  await assert.rejects(
    auth.changePassword('错误的当前密码', '已经修改密码99'),
    (error) => error.code === 'WEB_AUTH_INVALID_CREDENTIALS' && error.status === 401,
  );
  await auth.changePassword('首次设置密码88', '已经修改密码99');
  assert.equal(auth.verifySession(issued.token), null);
  assert.equal(await auth.authenticate('已经修改密码99'), true);
});

test('loopback helper recognizes IPv4, IPv6, and IPv4-mapped loopback addresses', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.42.1.9'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.20'), false);
  assert.equal(isLoopbackAddress('::ffff:192.168.1.20'), false);
});
