import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getMailboxSettings, loadMailboxSettings, updateMailboxSettings } from '../src/lib/mailbox-settings.mjs';

function mailboxConfig(directory) {
  return {
    mailbox: {
      enabled: false, host: 'imap.qiye.aliyun.com', port: 993, secure: true,
      username: 'marketing@kulon.com', password: '', folder: 'INBOX',
      settingsPath: path.join(directory, 'settings.enc'),
      settingsKeyPath: path.join(directory, 'settings.key'),
    },
  };
}

test('mailbox settings encrypt credentials and never return the password', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-mailbox-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = mailboxConfig(directory);
  const saved = await updateMailboxSettings(config, {
    enabled: true, host: 'imap.qiye.aliyun.com', port: 993, secure: true,
    username: 'marketing@kulon.com', password: 'client-authorisation-code', folder: 'INBOX',
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.passwordConfigured, true);
  assert.equal(JSON.stringify(saved).includes('client-authorisation-code'), false);
  const encrypted = fs.readFileSync(config.mailbox.settingsPath, 'utf8');
  assert.equal(encrypted.includes('client-authorisation-code'), false);
  assert.equal(fs.statSync(config.mailbox.settingsPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(config.mailbox.settingsKeyPath).mode & 0o777, 0o600);

  const reloaded = mailboxConfig(directory);
  await loadMailboxSettings(reloaded);
  assert.equal(reloaded.mailbox.password, 'client-authorisation-code');
  assert.equal(getMailboxSettings(reloaded).passwordConfigured, true);
});

test('mailbox settings require an account and authorization code before enabling', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kulon-mailbox-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = mailboxConfig(directory);
  await assert.rejects(
    updateMailboxSettings(config, { enabled: true, username: '', password: '' }),
    /邮箱账号和客户端授权码/,
  );
  await assert.rejects(updateMailboxSettings(config, { host: 'https://imap.example.com' }), /服务器地址格式/);
});
