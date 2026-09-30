import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from './errors.mjs';

const scrypt = promisify(crypto.scrypt);

const SCRYPT_VERSION = 1;
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const PASSWORD_HASH_PREFIX = 'scrypt';
const SESSION_VERSION = 1;

export const WEB_SESSION_COOKIE_NAME = 'kulon_web_session';
export const WEB_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WEB_SESSION_TTL_SECONDS = WEB_SESSION_TTL_MS / 1000;

function passwordError(message) {
  return new AppError(message, { status: 400, code: 'WEB_PASSWORD_INVALID' });
}

function requirePasswordHash(passwordHash) {
  if (!parsePasswordHash(passwordHash)) {
    throw new AppError('网页登录密码尚未配置', {
      status: 503,
      code: 'WEB_AUTH_NOT_CONFIGURED',
    });
  }
  return passwordHash;
}

function normalizeNow(now) {
  const value = typeof now === 'function' ? now() : now;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) throw new TypeError('now must be a finite timestamp');
  return Math.trunc(timestamp);
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload, passwordHash) {
  return crypto.createHmac('sha256', passwordHash).update(payload).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function envLine(key, value) {
  return `${key}=${String(value).replace(/\r?\n/g, '')}`;
}

export function validateWebPassword(password) {
  if (typeof password !== 'string') throw passwordError('密码必须是文本');
  const length = Array.from(password).length;
  if (length < 8) throw passwordError('密码至少需要 8 个字符');
  if (length > 256) throw passwordError('密码不能超过 256 个字符');
  if (/\u0000/.test(password)) throw passwordError('密码不能包含空字符');
  return password;
}

export async function hashWebPassword(password, { salt = crypto.randomBytes(16) } = {}) {
  const validated = validateWebPassword(password);
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'base64url');
  if (saltBuffer.length < 16) throw new TypeError('salt must contain at least 16 bytes');

  const derivedKey = await scrypt(validated, saltBuffer, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
  });

  return [
    PASSWORD_HASH_PREFIX,
    SCRYPT_VERSION,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    saltBuffer.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

function parsePasswordHash(passwordHash) {
  if (typeof passwordHash !== 'string') return null;
  const [prefix, versionText, costText, blockSizeText, parallelizationText, saltText, keyText, extra] = passwordHash.split('$');
  if (extra !== undefined || prefix !== PASSWORD_HASH_PREFIX || Number(versionText) !== SCRYPT_VERSION) return null;

  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);
  if (
    cost !== SCRYPT_COST ||
    blockSize !== SCRYPT_BLOCK_SIZE ||
    parallelization !== SCRYPT_PARALLELIZATION
  ) return null;

  try {
    const salt = Buffer.from(saltText, 'base64url');
    const key = Buffer.from(keyText, 'base64url');
    if (salt.length < 16 || key.length !== SCRYPT_KEY_LENGTH) return null;
    return { cost, blockSize, parallelization, salt, key };
  } catch {
    return null;
  }
}

export async function verifyWebPassword(password, passwordHash) {
  if (typeof password !== 'string') return false;
  const parsed = parsePasswordHash(passwordHash);
  if (!parsed) return false;

  const derivedKey = await scrypt(password, parsed.salt, parsed.key.length, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelization,
  });
  return crypto.timingSafeEqual(derivedKey, parsed.key);
}

export function issueWebSession(
  passwordHash,
  { now = Date.now(), ttlMs = WEB_SESSION_TTL_MS, sessionId = crypto.randomBytes(16).toString('base64url') } = {},
) {
  const key = requirePasswordHash(passwordHash);
  const issuedAt = normalizeNow(now);
  const duration = Number(ttlMs);
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError('ttlMs must be positive');

  const payload = encode(JSON.stringify({
    v: SESSION_VERSION,
    iat: issuedAt,
    exp: issuedAt + Math.trunc(duration),
    sid: String(sessionId),
  }));
  return `${payload}.${sign(payload, key)}`;
}

export function verifyWebSession(token, passwordHash, { now = Date.now() } = {}) {
  if (typeof token !== 'string' || typeof passwordHash !== 'string' || !passwordHash) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payloadText, signature] = parts;
  if (!safeEqual(signature, sign(payloadText, passwordHash))) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadText, 'base64url').toString('utf8'));
    const checkedAt = normalizeNow(now);
    if (
      payload?.v !== SESSION_VERSION ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      typeof payload.sid !== 'string' ||
      !payload.sid ||
      payload.iat > checkedAt ||
      payload.exp <= checkedAt ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > WEB_SESSION_TTL_MS
    ) return null;
    return { issuedAt: payload.iat, expiresAt: payload.exp, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export function serializeWebSessionCookie(
  token,
  { secure = false, cookieName = WEB_SESSION_COOKIE_NAME, maxAge = WEB_SESSION_TTL_SECONDS } = {},
) {
  if (typeof token !== 'string' || !token) throw new TypeError('session token is required');
  const attributes = [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.trunc(Number(maxAge)))}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function serializeExpiredWebSessionCookie(
  { secure = false, cookieName = WEB_SESSION_COOKIE_NAME } = {},
) {
  const attributes = [
    `${cookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function readWebSessionCookie(cookieHeader, cookieName = WEB_SESSION_COOKIE_NAME) {
  if (typeof cookieHeader !== 'string' || !cookieHeader) return '';
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== cookieName) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const normalized = address.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (normalized === 'localhost' || normalized === '::1') return true;
  const mappedIpv4 = normalized.startsWith('::ffff:') ? normalized.slice(7) : normalized;
  if (net.isIP(mappedIpv4) !== 4) return false;
  const firstOctet = Number(mappedIpv4.split('.')[0]);
  return firstOctet === 127;
}

export async function persistWebPassword(config, password, { envPath = '.env' } = {}) {
  if (!config?.auth || typeof config.auth !== 'object') {
    throw new TypeError('config.auth is required');
  }

  const passwordHash = await hashWebPassword(password);
  const absoluteEnvPath = path.resolve(envPath);
  let source = '';
  try {
    source = await fs.readFile(absoluteEnvPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const line = envLine('WEB_LOGIN_PASSWORD_HASH', passwordHash);
  const withoutPreviousHash = source.replace(/^WEB_LOGIN_PASSWORD_HASH=.*(?:\r?\n|$)/gm, '');
  const output = `${withoutPreviousHash}${withoutPreviousHash && !withoutPreviousHash.endsWith('\n') ? '\n' : ''}${line}\n`;

  await fs.mkdir(path.dirname(absoluteEnvPath), { recursive: true });
  await fs.writeFile(absoluteEnvPath, output, { mode: 0o600 });
  await fs.chmod(absoluteEnvPath, 0o600);
  config.auth.passwordHash = passwordHash;
  return passwordHash;
}

export class WebAuth {
  constructor(config, { envPath = '.env', now = () => Date.now(), secureCookies = false } = {}) {
    if (!config?.auth || typeof config.auth !== 'object') throw new TypeError('config.auth is required');
    this.config = config;
    this.envPath = envPath;
    this.now = now;
    this.secureCookies = secureCookies;
  }

  get configured() {
    return Boolean(parsePasswordHash(this.config.auth.passwordHash));
  }

  async setPassword(password) {
    return persistWebPassword(this.config, password, { envPath: this.envPath });
  }

  async setupPassword(password) {
    if (this.configured) {
      throw new AppError('网页登录密码已经设置', {
        status: 409,
        code: 'WEB_AUTH_ALREADY_CONFIGURED',
      });
    }
    return this.setPassword(password);
  }

  async changePassword(currentPassword, nextPassword) {
    if (!this.configured) requirePasswordHash(this.config.auth.passwordHash);
    if (!await this.authenticate(currentPassword)) {
      throw new AppError('当前密码不正确', {
        status: 401,
        code: 'WEB_AUTH_INVALID_CREDENTIALS',
      });
    }
    return this.setPassword(nextPassword);
  }

  async authenticate(password) {
    return verifyWebPassword(password, this.config.auth.passwordHash);
  }

  issueSession() {
    const issuedAt = normalizeNow(this.now);
    const token = issueWebSession(this.config.auth.passwordHash, { now: issuedAt });
    return {
      token,
      cookie: serializeWebSessionCookie(token, { secure: this.secureCookies }),
      expiresAt: issuedAt + WEB_SESSION_TTL_MS,
    };
  }

  verifySession(token) {
    return verifyWebSession(token, this.config.auth.passwordHash, { now: this.now });
  }

  readSession(cookieHeader) {
    return this.verifySession(readWebSessionCookie(cookieHeader));
  }

  clearSessionCookie() {
    return serializeExpiredWebSessionCookie({ secure: this.secureCookies });
  }
}
