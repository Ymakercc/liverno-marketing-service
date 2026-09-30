import fs from 'node:fs/promises';
import path from 'node:path';

const PRICE_LINE = /^-[ \t]+型号[ \t]+(.+?)[ \t]+的最新报价是[ \t]+(.+?)[，,][ \t]*报价日期为[ \t]+(\d{4}-\d{2}-\d{2})[。.]?$/;
const GENERATED_DATE = /^-[ \t]+数据生成日期：[ \t]*(\d{4}-\d{2}-\d{2})/m;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const FAMILY_RULES = [
  {
    terms: ['DIN RAIL', 'DIN-RAIL', 'DINRAIL', '导轨', 'HDR', 'NDR', 'EDR', 'DDR', 'DRP', 'DRS', 'DRC', 'DRDN', 'DRH'],
    prefixes: ['HDR', 'NDR', 'EDR', 'DDR', 'DRP', 'DRS', 'DRC', 'DRDN', 'DRH'],
  },
  {
    terms: ['LED', 'LIGHTING', '灯', 'LED DRIVER', 'SIGNAGE', '照明'],
    prefixes: ['ELG', 'HLG', 'XLG', 'HBG', 'NPF', 'LPF', 'LPV', 'LCM', 'PLC', 'PLN'],
  },
  {
    terms: ['ADAPTER', 'ADAPTOR', '适配器', '电源适配器'],
    prefixes: ['GST', 'GSM', 'AD', 'APC', 'APV', 'GS'],
  },
  {
    terms: ['OPEN FRAME', 'PCB', 'OPEN-FRAME', '开放式', '裸板'],
    prefixes: ['IRM', 'MPM', 'MFM', 'EPP', 'EPS', 'MPS', 'PMP'],
  },
  {
    terms: ['ENCLOSED', '机壳', '工业电源', 'INDUSTRIAL POWER', 'POWER SUPPLY'],
    prefixes: ['LRS', 'RSP', 'HRP', 'MSP', 'CSP', 'ERP', 'ERPF', 'SE'],
  },
  {
    terms: ['UPS', '不间断', 'BACKUP'],
    prefixes: ['DUPS', 'DR-UPS', 'DBU', 'DBUF', 'DPU'],
  },
];

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function normalize(value) {
  return clean(value)
    .toUpperCase()
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePrice(value) {
  const match = clean(value).replaceAll(',', '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function safeMarkup(value, fallback = 0.05) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function safeExchangeRate(value, fallback = 7.2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeDate(value, fallback) {
  const candidate = clean(value);
  return ISO_DATE.test(candidate) ? candidate : fallback;
}

function parseFamilyFromModel(model) {
  return normalize(model).split('-')[0];
}

function familyRulesForRecommendation(recommendation) {
  const text = normalize(recommendation);
  return FAMILY_RULES.filter((rule) => rule.terms.some((term) => text.includes(term)));
}

function modelMatchesPrefix(model, prefix) {
  const normalizedModel = normalize(model);
  const normalizedPrefix = normalize(prefix);
  return normalizedModel === normalizedPrefix || normalizedModel.startsWith(`${normalizedPrefix}-`);
}

function recommendationScore(entry, recommendation) {
  const text = normalize(recommendation?.name || recommendation);
  if (!text) return 0;
  const model = normalize(entry.model);
  if (model === text || text.includes(model)) return 1000;

  const exactFamily = parseFamilyFromModel(entry.model);
  if (text === exactFamily || text.startsWith(`${exactFamily} `) || text.includes(`${exactFamily} SERIES`)) {
    return 800;
  }

  const rules = familyRulesForRecommendation(text);
  if (rules.some((rule) => rule.prefixes.some((prefix) => modelMatchesPrefix(entry.model, prefix)))) {
    return 400;
  }
  return 0;
}

function entryForEmail(entry, recommendation) {
  return {
    model: entry.model,
    price: Number.isFinite(entry.emailPrice) ? entry.emailPrice : entry.marketingPrice,
    currency: entry.emailCurrency || entry.currency,
    availability: 'In Stock',
    quoteDate: entry.quoteDate,
    recommendation: clean(recommendation?.reason),
  };
}

export function parsePriceCatalog(markdown, options = {}) {
  const cutoverDate = safeDate(options.cutoverDate, '2026-07-01');
  const legacyCostMarkup = safeMarkup(options.legacyCostMarkup, 0.05);
  const marketingMarkup = safeMarkup(options.marketingMarkup, 0.05);
  const defaultCurrency = clean(options.defaultCurrency) || 'CNY';
  const emailCurrency = (clean(options.emailCurrency) || 'USD').toUpperCase();
  const cnyPerUsd = safeExchangeRate(options.cnyPerUsd, 7.2);
  const text = String(markdown || '').replaceAll('\r', '');
  const entries = [];

  for (const line of text.split('\n')) {
    const match = line.match(PRICE_LINE);
    if (!match) continue;
    const model = clean(match[1]);
    const rawPrice = clean(match[2]);
    const quoteDate = match[3];
    const sourcePrice = parsePrice(rawPrice);
    if (!model || sourcePrice === null) continue;
    const sourceIsCost = quoteDate >= cutoverDate;
    const costPrice = roundMoney(sourcePrice * (sourceIsCost ? 1 : 1 + legacyCostMarkup));
    const marketingPrice = roundMoney(costPrice * (1 + marketingMarkup));
    const currency = /元|人民币|CNY/i.test(rawPrice) ? 'CNY' : defaultCurrency;
    const converted = convertPriceForEmail({
      price: marketingPrice,
      currency,
      emailCurrency,
      cnyPerUsd,
    });
    entries.push({
      model,
      family: parseFamilyFromModel(model),
      sourcePrice,
      costPrice,
      marketingPrice,
      currency,
      emailPrice: converted.price,
      emailCurrency: converted.currency,
      currencyExplicit: /元|人民币|CNY/i.test(rawPrice),
      quoteDate,
      sourceIsCost,
      availability: 'In Stock',
    });
  }

  const unique = new Map();
  for (const entry of entries) {
    const key = normalize(entry.model);
    if (!unique.has(key) || entry.quoteDate > unique.get(key).quoteDate) unique.set(key, entry);
  }

  return {
    generatedDate: text.match(GENERATED_DATE)?.[1] || '',
    cutoverDate,
    legacyCostMarkup,
    marketingMarkup,
    defaultCurrency,
    emailCurrency,
    cnyPerUsd,
    entries: [...unique.values()],
  };
}

export function convertPriceForEmail({ price, currency = 'CNY', emailCurrency = 'USD', cnyPerUsd = 7.2 } = {}) {
  const amount = Number(price);
  const source = (clean(currency) || 'CNY').toUpperCase();
  const target = (clean(emailCurrency) || 'USD').toUpperCase();
  const rate = safeExchangeRate(cnyPerUsd, 7.2);
  if (!Number.isFinite(amount)) return { price: null, currency: target };
  if (source === target) return { price: roundMoney(amount), currency: target };
  if (source === 'CNY' && target === 'USD') return { price: roundMoney(amount / rate), currency: target };
  if (source === 'USD' && target === 'CNY') return { price: roundMoney(amount * rate), currency: target };
  return { price: roundMoney(amount), currency: source };
}

export async function loadPriceCatalog(options = {}) {
  const catalogPath = path.resolve(clean(options.catalogPath) || '.local_docs/pricing/Kulon最新报价_20260829.md');
  try {
    const markdown = await fs.readFile(catalogPath, 'utf8');
    return {
      ...parsePriceCatalog(markdown, options),
      sourcePath: catalogPath,
      error: '',
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        ...parsePriceCatalog('', options),
        sourcePath: catalogPath,
        error: '报价文件不存在',
      };
    }
    throw error;
  }
}

export function selectPricedModels({ recommendedProducts = [], catalog, limit = 8 } = {}) {
  const entries = Array.isArray(catalog?.entries) ? catalog.entries : [];
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 8);
  const recommendations = Array.isArray(recommendedProducts) ? recommendedProducts : [];
  const selected = [];
  const selectedKeys = new Set();
  const add = (entry, recommendation) => {
    const key = normalize(entry.model);
    if (selectedKeys.has(key) || selected.length >= safeLimit) return;
    selectedKeys.add(key);
    selected.push(entryForEmail(entry, recommendation));
  };

  const rankedFor = (recommendation) => entries
    .map((entry) => ({ entry, score: recommendationScore(entry, recommendation) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.quoteDate.localeCompare(left.entry.quoteDate) || left.entry.model.localeCompare(right.entry.model));

  const perRecommendation = Math.max(1, Math.floor(safeLimit / Math.max(recommendations.length, 1)));
  for (const recommendation of recommendations) {
    for (const item of rankedFor(recommendation).slice(0, perRecommendation)) add(item.entry, recommendation);
  }

  const allRanked = entries
    .map((entry) => ({
      entry,
      score: Math.max(...recommendations.map((recommendation) => recommendationScore(entry, recommendation)), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.quoteDate.localeCompare(left.entry.quoteDate) || left.entry.model.localeCompare(right.entry.model));
  for (const item of allRanked) add(item.entry, recommendations.find((recommendation) => recommendationScore(item.entry, recommendation) === item.score));

  return selected.slice(0, safeLimit);
}

export function formatPrice(value, currency = 'CNY') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '--';
  return `${clean(currency) || 'CNY'} ${amount.toFixed(2)}`;
}
