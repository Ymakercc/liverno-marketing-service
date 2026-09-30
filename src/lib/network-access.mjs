function normalizeAddress(value) {
  const address = String(value || '').trim().toLowerCase().split('%')[0];
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export function isPrivateNetworkAddress(value) {
  const address = normalizeAddress(value);
  if (!address) return false;
  if (address === '::1') return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true;
  if (/^fe[89ab][0-9a-f]:/.test(address)) return true;

  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
}
