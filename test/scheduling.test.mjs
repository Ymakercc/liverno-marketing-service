import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isInsideSendWindow,
  isValidTimeZone,
  nextSendTime,
  resolveCountryCode,
  resolveTimeZone,
} from '../src/lib/scheduling.mjs';

test('country scheduling resolves common markets and moves work to local business hours', () => {
  assert.equal(resolveTimeZone('印度'), 'Asia/Kolkata');
  assert.equal(resolveTimeZone('', 'DE'), 'Europe/Berlin');
  const fridayNightUtc = new Date('2026-08-14T23:00:00.000Z');
  const next = new Date(nextSendTime({ from: fridayNightUtc, timeZone: 'Asia/Kolkata', startHour: 9, endHour: 16 }));
  assert.equal(isInsideSendWindow(next, 'Asia/Kolkata', { startHour: 9, endHour: 16 }), true);
  assert.ok(next > fridayNightUtc);
});

test('country scheduling accepts common Apollo English country names', () => {
  assert.equal(resolveCountryCode('United States'), 'US');
  assert.equal(resolveTimeZone('United States'), 'America/New_York');
  assert.equal(resolveCountryCode('Turkey'), 'TR');
  assert.equal(resolveTimeZone('Turkey'), 'Europe/Istanbul');
});

test('country scheduling covers queued international markets without silently falling back to UTC', () => {
  const expected = new Map([
    ['厄瓜多尔', 'America/Guayaquil'], ['秘鲁', 'America/Lima'], ['菲律宾', 'Asia/Manila'],
    ['巴拉圭', 'America/Asuncion'], ['阿拉伯联合酋长国（阿联酋）', 'Asia/Dubai'],
    ['瑞士', 'Europe/Zurich'], ['乌干达', 'Africa/Kampala'], ['坦桑尼亚', 'Africa/Dar_es_Salaam'],
    ['尼日利亚', 'Africa/Lagos'], ['哥伦比亚', 'America/Bogota'],
  ]);
  for (const [country, timeZone] of expected) assert.equal(resolveTimeZone(country), timeZone);
  assert.equal(resolveCountryCode('Ecuador'), 'EC');
  assert.equal(resolveTimeZone('', 'EC'), 'America/Guayaquil');
  assert.equal(resolveTimeZone('未知国家'), '');
  assert.equal(isValidTimeZone('Not/A_Time_Zone'), false);
  assert.equal(isInsideSendWindow(new Date(), '', { startHour: 9, endHour: 16 }), false);
});

test('multi-timezone countries prefer a known state or province over the country default', () => {
  assert.equal(resolveTimeZone('美国', 'US', { state: 'California' }), 'America/Los_Angeles');
  assert.equal(resolveTimeZone('美国', 'US', { state: 'Minnesota' }), 'America/Chicago');
  assert.equal(resolveTimeZone('澳大利亚', 'AU', { state: 'Queensland' }), 'Australia/Brisbane');
  assert.equal(resolveTimeZone('巴西', 'BR', { state: 'Amazonas' }), 'America/Manaus');
  assert.equal(resolveTimeZone('美国', 'US', { state: '' }), 'America/New_York');
});
