import { getAllCountries, getCountry } from 'countries-and-timezones';

const COUNTRY_ALIASES = new Map(Object.entries({
  '中国': 'CN', '印度': 'IN', '日本': 'JP', '韩国': 'KR', '新加坡': 'SG',
  '马来西亚': 'MY', '泰国': 'TH', '越南': 'VN', '印度尼西亚': 'ID', '菲律宾': 'PH',
  '阿联酋': 'AE', '阿拉伯联合酋长国（阿联酋）': 'AE', '沙特阿拉伯': 'SA', '以色列': 'IL',
  '约旦': 'JO', '卡塔尔': 'QA', '科威特': 'KW', '阿曼': 'OM', '巴林': 'BH',
  '伊拉克': 'IQ', '伊朗': 'IR', '巴基斯坦': 'PK', '孟加拉国': 'BD', '斯里兰卡': 'LK',
  '南非': 'ZA', '埃及': 'EG', '摩洛哥': 'MA', '阿尔及利亚': 'DZ', '尼日利亚': 'NG',
  '加纳': 'GH', '肯尼亚': 'KE', '乌干达': 'UG', '坦桑尼亚': 'TZ', '塞内加尔': 'SN',
  '津巴布韦': 'ZW', '赞比亚': 'ZM', '埃塞俄比亚': 'ET',
  '澳大利亚': 'AU', '新西兰': 'NZ',
  '德国': 'DE', '法国': 'FR', '意大利': 'IT', '西班牙': 'ES', '荷兰': 'NL',
  '比利时': 'BE', '瑞士': 'CH', '奥地利': 'AT', '波兰': 'PL', '葡萄牙': 'PT',
  '英国': 'GB', '爱尔兰': 'IE', '瑞典': 'SE', '挪威': 'NO', '丹麦': 'DK',
  '芬兰': 'FI', '冰岛': 'IS', '希腊': 'GR', '罗马尼亚': 'RO', '匈牙利': 'HU',
  '保加利亚': 'BG', '捷克': 'CZ', '斯洛伐克': 'SK', '斯洛文尼亚': 'SI',
  '克罗地亚': 'HR', '塞尔维亚': 'RS', '土耳其': 'TR', '乌克兰': 'UA',
  '俄罗斯': 'RU', '立陶宛': 'LT', '拉脱维亚': 'LV', '爱沙尼亚': 'EE', '白俄罗斯': 'BY',
  '美国': 'US', '加拿大': 'CA', '墨西哥': 'MX', '波多黎各（美）': 'PR',
  '巴西': 'BR', '阿根廷': 'AR', '智利': 'CL', '秘鲁': 'PE', '厄瓜多尔': 'EC',
  '哥伦比亚': 'CO', '委内瑞拉': 'VE', '玻利维亚': 'BO', '巴拉圭': 'PY',
  '乌拉圭': 'UY', '巴拿马': 'PA', '哥斯达黎加': 'CR', '尼加拉瓜': 'NI',
  '危地马拉': 'GT', '洪都拉斯': 'HN', '萨尔瓦多': 'SV', '多米尼加共和国': 'DO',
  UAE: 'AE', USA: 'US', US: 'US', 'United States': 'US', 'United States of America': 'US',
  UK: 'GB', 'South Korea': 'KR', Turkey: 'TR', Türkiye: 'TR', Russia: 'RU',
}));

const PRIMARY_TIMEZONES = new Map(Object.entries({
  AE: 'Asia/Dubai', AR: 'America/Argentina/Buenos_Aires', AU: 'Australia/Sydney',
  BE: 'Europe/Brussels', BR: 'America/Sao_Paulo', CA: 'America/Toronto',
  CH: 'Europe/Zurich', CL: 'America/Santiago', CN: 'Asia/Shanghai', CO: 'America/Bogota',
  DE: 'Europe/Berlin', DK: 'Europe/Copenhagen', DZ: 'Africa/Algiers', EC: 'America/Guayaquil',
  ES: 'Europe/Madrid', FI: 'Europe/Helsinki', FR: 'Europe/Paris', GB: 'Europe/London',
  ID: 'Asia/Jakarta', IN: 'Asia/Kolkata', IT: 'Europe/Rome', JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul', KZ: 'Asia/Almaty', MX: 'America/Mexico_City', MY: 'Asia/Kuala_Lumpur',
  NG: 'Africa/Lagos', NI: 'America/Managua', NL: 'Europe/Amsterdam', NZ: 'Pacific/Auckland',
  PA: 'America/Panama', PE: 'America/Lima', PH: 'Asia/Manila', PL: 'Europe/Warsaw',
  PR: 'America/Puerto_Rico', PT: 'Europe/Lisbon', PY: 'America/Asuncion',
  RO: 'Europe/Bucharest', RU: 'Europe/Moscow', SA: 'Asia/Riyadh', SE: 'Europe/Stockholm',
  SG: 'Asia/Singapore', TH: 'Asia/Bangkok', TR: 'Europe/Istanbul',
  TZ: 'Africa/Dar_es_Salaam', UG: 'Africa/Kampala', US: 'America/New_York',
  VE: 'America/Caracas', VN: 'Asia/Ho_Chi_Minh', ZA: 'Africa/Johannesburg',
}));

const LOCATION_TIMEZONES = new Map(Object.entries({
  US: new Map(Object.entries({
    alabama: 'America/Chicago', alaska: 'America/Anchorage', arizona: 'America/Phoenix',
    arkansas: 'America/Chicago', california: 'America/Los_Angeles', colorado: 'America/Denver',
    connecticut: 'America/New_York', delaware: 'America/New_York', 'district of columbia': 'America/New_York',
    florida: 'America/New_York', georgia: 'America/New_York', hawaii: 'Pacific/Honolulu',
    idaho: 'America/Denver', illinois: 'America/Chicago', indiana: 'America/New_York',
    iowa: 'America/Chicago', kansas: 'America/Chicago', kentucky: 'America/New_York',
    louisiana: 'America/Chicago', maine: 'America/New_York', maryland: 'America/New_York',
    massachusetts: 'America/New_York', michigan: 'America/Detroit', minnesota: 'America/Chicago',
    mississippi: 'America/Chicago', missouri: 'America/Chicago', montana: 'America/Denver',
    nebraska: 'America/Chicago', nevada: 'America/Los_Angeles', 'new hampshire': 'America/New_York',
    'new jersey': 'America/New_York', 'new mexico': 'America/Denver', 'new york': 'America/New_York',
    'north carolina': 'America/New_York', 'north dakota': 'America/Chicago', ohio: 'America/New_York',
    oklahoma: 'America/Chicago', oregon: 'America/Los_Angeles', pennsylvania: 'America/New_York',
    'rhode island': 'America/New_York', 'south carolina': 'America/New_York',
    'south dakota': 'America/Chicago', tennessee: 'America/Chicago', texas: 'America/Chicago',
    utah: 'America/Denver', vermont: 'America/New_York', virginia: 'America/New_York',
    washington: 'America/Los_Angeles', 'west virginia': 'America/New_York',
    wisconsin: 'America/Chicago', wyoming: 'America/Denver',
  })),
  CA: new Map(Object.entries({
    alberta: 'America/Edmonton', 'british columbia': 'America/Vancouver', manitoba: 'America/Winnipeg',
    'new brunswick': 'America/Moncton', 'newfoundland and labrador': 'America/St_Johns',
    'northwest territories': 'America/Yellowknife', 'nova scotia': 'America/Halifax',
    nunavut: 'America/Iqaluit', ontario: 'America/Toronto', 'prince edward island': 'America/Halifax',
    quebec: 'America/Toronto', saskatchewan: 'America/Regina', yukon: 'America/Whitehorse',
  })),
  AU: new Map(Object.entries({
    'australian capital territory': 'Australia/Sydney', 'new south wales': 'Australia/Sydney',
    'northern territory': 'Australia/Darwin', queensland: 'Australia/Brisbane',
    'south australia': 'Australia/Adelaide', tasmania: 'Australia/Hobart',
    victoria: 'Australia/Melbourne', 'western australia': 'Australia/Perth',
  })),
  BR: new Map(Object.entries({
    acre: 'America/Rio_Branco', amazonas: 'America/Manaus', 'mato grosso': 'America/Cuiaba',
    'mato grosso do sul': 'America/Campo_Grande', rondonia: 'America/Porto_Velho',
    roraima: 'America/Boa_Vista',
  })),
  MX: new Map(Object.entries({
    'baja california': 'America/Tijuana', chihuahua: 'America/Chihuahua', quintana: 'America/Cancun',
    'quintana roo': 'America/Cancun', sinaloa: 'America/Mazatlan', sonora: 'America/Hermosillo',
  })),
}));

const countriesByName = new Map(Object.values(getAllCountries()).map((country) => [
  country.name.toLocaleLowerCase('en-US'),
  country.id,
]));
const validTimeZones = new Map();

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalizedName(value) {
  return clean(value).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function normalizedLocation(value) {
  return normalizedName(value).normalize('NFKD').replace(/\p{Diacritic}/gu, '')
    .replace(/^state of /, '').replace(/^province of /, '');
}

export function resolveCountryCode(country, countryCode = '') {
  const suppliedCode = clean(countryCode).toUpperCase();
  if (suppliedCode && getCountry(suppliedCode)) return suppliedCode;
  const rawCountry = clean(country);
  const source = rawCountry.normalize('NFKC');
  const alias = COUNTRY_ALIASES.get(rawCountry) || COUNTRY_ALIASES.get(rawCountry.toUpperCase()) ||
    COUNTRY_ALIASES.get(source) || COUNTRY_ALIASES.get(source.toUpperCase());
  if (alias) return alias;
  return countriesByName.get(normalizedName(source)) || '';
}

export function resolveTimeZone(country, countryCode = '', { state = '', city = '' } = {}) {
  const code = resolveCountryCode(country, countryCode);
  if (!code) return '';
  const record = getCountry(code);
  const locationTimeZones = LOCATION_TIMEZONES.get(code);
  const locationTimeZone = locationTimeZones?.get(normalizedLocation(state)) ||
    locationTimeZones?.get(normalizedLocation(city));
  if (locationTimeZone) return locationTimeZone;
  return PRIMARY_TIMEZONES.get(code) || record?.timezones?.[0] || '';
}

export function isValidTimeZone(timeZone) {
  const value = clean(timeZone);
  if (!value) return false;
  if (validTimeZones.has(value)) return validTimeZones.get(value);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    validTimeZones.set(value, true);
    return true;
  } catch {
    validTimeZones.set(value, false);
    return false;
  }
}

function partsAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function isInsideSendWindow(date, timeZone, { startHour = 9, endHour = 16 } = {}) {
  if (!isValidTimeZone(timeZone)) return false;
  const parts = partsAt(date, timeZone);
  const hour = Number(parts.hour) % 24;
  return !['Sat', 'Sun'].includes(parts.weekday) && hour >= startHour && hour < endHour;
}

export function nextSendTime({
  from = new Date(),
  timeZone = 'UTC',
  startHour = 9,
  endHour = 16,
  jitterMinutes = 0,
} = {}) {
  if (!isValidTimeZone(timeZone)) return '';
  const start = new Date(from);
  start.setUTCSeconds(0, 0);
  const offset = Math.max(Number(jitterMinutes) || 0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + offset);
  if (isInsideSendWindow(start, timeZone, { startHour, endHour })) return start.toISOString();

  const candidate = new Date(start);
  candidate.setUTCMinutes(Math.ceil(candidate.getUTCMinutes() / 15) * 15, 0, 0);
  for (let index = 0; index < 8 * 24 * 4; index += 1) {
    if (isInsideSendWindow(candidate, timeZone, { startHour, endHour })) {
      return candidate.toISOString();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 15);
  }
  return '';
}
