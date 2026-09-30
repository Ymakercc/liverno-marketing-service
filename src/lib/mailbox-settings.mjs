import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.mjs';

const ALGORITHM = 'aes-256-gcm';
const HOST_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function booleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(clean(value).toLowerCase());
}

function paths(config, overrides = {}) {
  return {
    settingsPath: path.resolve(overrides.settingsPath || config.mailbox.settingsPath),
    keyPath: path.resolve(overrides.keyPath || config.mailbox.settingsKeyPath),
  };
}

async function encryptionKey(keyPath) {
  try {
    const key = await fs.readFile(keyPath);
    if (key.length !== 32) throw new Error('invalid key length');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new AppError('邮箱配置加密密钥无法读取', { status: 500, code: 'MAILBOX_SECRET_KEY_INVALID' });
    }
  }
  const key = crypto.randomBytes(32);
  await fs.mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(keyPath, key, { mode: 0o600, flag: 'wx' });
  return key;
}

function validate(input, current) {
  const host = clean(input.host === undefined ? current.host : input.host).toLowerCase();
  const port = Number(input.port === undefined ? current.port : input.port);
  const username = clean(input.username === undefined ? current.username : input.username).toLowerCase();
  const folder = clean(input.folder === undefined ? current.folder : input.folder) || 'INBOX';
  const secure = booleanValue(input.secure, current.secure !== false);
  const enabled = booleanValue(input.enabled, current.enabled === true);
  const password = input.password === undefined || input.password === '' ? current.password : String(input.password);
  if (!HOST_PATTERN.test(host)) {
    throw new AppError('IMAP 服务器地址格式不正确', { status: 400, code: 'MAILBOX_CONFIG_INVALID' });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError('IMAP 端口必须是 1-65535 的整数', { status: 400, code: 'MAILBOX_CONFIG_INVALID' });
  }
  if (username && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) {
    throw new AppError('邮箱账号格式不正确', { status: 400, code: 'MAILBOX_CONFIG_INVALID' });
  }
  if (enabled && (!username || !password)) {
    throw new AppError('开启收件监控前需要填写邮箱账号和客户端授权码', {
      status: 400, code: 'MAILBOX_CONFIG_INCOMPLETE',
    });
  }
  return { enabled, host, port, secure, username, password, folder };
}

async function encryptSettings(settings, config, overrides = {}) {
  const { settingsPath, keyPath } = paths(config, overrides);
  const key = await encryptionKey(keyPath);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()]);
  const payload = JSON.stringify({
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  });
  await fs.mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  await fs.writeFile(settingsPath, `${payload}\n`, { mode: 0o600 });
}

async function decryptSettings(config, overrides = {}) {
  const { settingsPath, keyPath } = paths(config, overrides);
  let payload;
  try {
    payload = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new AppError('加密邮箱配置无法解析', { status: 500, code: 'MAILBOX_SECRET_INVALID' });
  }
  try {
    const key = await encryptionKey(keyPath);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(decrypted);
  } catch {
    throw new AppError('加密邮箱配置无法解密', { status: 500, code: 'MAILBOX_SECRET_INVALID' });
  }
}

export function getMailboxSettings(config) {
  const mailbox = config.mailbox || {};
  return {
    enabled: mailbox.enabled === true,
    host: mailbox.host || 'imap.qiye.aliyun.com',
    port: Number(mailbox.port || 993),
    secure: mailbox.secure !== false,
    username: mailbox.username || '',
    folder: mailbox.folder || 'INBOX',
    passwordConfigured: Boolean(mailbox.password),
    configured: Boolean(mailbox.host && mailbox.port && mailbox.username && mailbox.password),
  };
}

export async function loadMailboxSettings(config, overrides = {}) {
  const saved = await decryptSettings(config, overrides);
  if (saved) Object.assign(config.mailbox, validate(saved, config.mailbox));
  return getMailboxSettings(config);
}

export async function updateMailboxSettings(config, input, overrides = {}) {
  const next = validate(input || {}, config.mailbox || {});
  await encryptSettings(next, config, overrides);
  Object.assign(config.mailbox, next);
  return getMailboxSettings(config);
}
