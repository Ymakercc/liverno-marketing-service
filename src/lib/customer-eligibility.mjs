export function isMarketableCustomerState(value) {
  const state = value === undefined || value === null ? '' : String(value).trim();
  return !['3', '5', '6'].includes(state);
}
