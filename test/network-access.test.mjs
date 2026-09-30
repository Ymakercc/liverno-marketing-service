import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateNetworkAddress } from '../src/lib/network-access.mjs';

test('private network access accepts loopback and LAN addresses', () => {
  for (const address of [
    '127.0.0.1',
    '::1',
    '::ffff:192.168.2.109',
    '10.0.0.8',
    '172.16.0.1',
    '172.31.255.254',
    'fd12:3456::1',
    'fe80::1%en0',
  ]) {
    assert.equal(isPrivateNetworkAddress(address), true, address);
  }
});

test('private network access rejects public and malformed addresses', () => {
  for (const address of [
    '8.8.8.8',
    '172.15.0.1',
    '172.32.0.1',
    '2001:4860:4860::8888',
    '',
    'not-an-ip',
  ]) {
    assert.equal(isPrivateNetworkAddress(address), false, address);
  }
});
