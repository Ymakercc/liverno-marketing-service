import dns from 'node:dns/promises';
import net from 'node:net';
import { normalizeDomain } from './apollo-client.mjs';

const MAX_HTML_LENGTH = 750_000;
const MAX_EVIDENCE_LENGTH = 12_000;
const RELEVANCE_TERMS = [
  'mean well', 'meanwell', 'power supply', 'power supplies', 'switching power',
  'industrial automation', 'automation', 'electrical', 'electronics', 'control cabinet',
  'led driver', 'led lighting', 'fuentes de alimentación', 'fuentes switching',
  'automatización industrial', 'equipamiento industrial', 'electrónica', 'control industrial',
  'alimentation', 'automatisation', 'stromversorgung', 'automatisierung',
];

function decodeEntities(value) {
  const named = new Map([
    ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
  ]);
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const numeric = entity[1].toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
    }
    return named.get(entity.toLowerCase()) ?? match;
  });
}

function compact(value) {
  return decodeEntities(value).replace(/\s+/g, ' ').trim();
}

function tagContent(html, tagName) {
  const match = String(html || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return compact(match?.[1]?.replace(/<[^>]+>/g, ' ') || '');
}

function metaContent(html, name) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    if ((attributes.name || attributes.property || '').toLowerCase() === name.toLowerCase()) {
      return compact(attributes.content);
    }
  }
  return '';
}

export function extractWebsiteEvidence(html, finalUrl = '') {
  const source = String(html || '').slice(0, MAX_HTML_LENGTH);
  const title = tagContent(source, 'title');
  const description = metaContent(source, 'description') || metaContent(source, 'og:description');
  const keywords = metaContent(source, 'keywords');
  const visibleText = compact(source
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
  const combined = compact([title, description, keywords, visibleText].filter(Boolean).join(' '));
  const normalized = combined.toLowerCase();
  const matchedTerms = RELEVANCE_TERMS.filter((term) => normalized.includes(term));
  const meanWellMentioned = /\bmean\s*well\b|\bmeanwell\b/i.test(combined);
  return {
    status: combined ? 'fetched' : 'empty',
    finalUrl,
    title,
    description,
    keywords,
    text: combined.slice(0, MAX_EVIDENCE_LENGTH),
    signals: {
      meanWellMentioned,
      matchedTerms,
      directFit: meanWellMentioned,
    },
  };
}

function isPublicIp(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (net.isIP(value) === 4) {
    const parts = value.split('.').map(Number);
    const [a, b] = parts;
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (net.isIP(value) === 6) {
    return !(value === '::' || value === '::1' || value.startsWith('fc') ||
      value.startsWith('fd') || /^fe[89ab]/.test(value));
  }
  return false;
}

async function assertPublicHost(hostname, lookupImpl) {
  if (hostname === 'localhost' || net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error('官网地址指向本地或私有网络');
    return;
  }
  const addresses = await lookupImpl(hostname, { all: true });
  if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) {
    throw new Error('官网域名未解析到公共网络地址');
  }
}

export async function researchWebsite(
  website,
  { fetchImpl = fetch, lookupImpl = dns.lookup, timeoutMs = 20_000 } = {},
) {
  const domain = normalizeDomain(website);
  if (!domain) return { status: 'missing', finalUrl: '', title: '', description: '', keywords: '', text: '', signals: { meanWellMentioned: false, matchedTerms: [], directFit: false } };

  let lastError = '';
  for (const protocol of ['https:', 'http:']) {
    let current = new URL(`${protocol}//${domain}/`);
    try {
      for (let redirect = 0; redirect < 4; redirect += 1) {
        await assertPublicHost(current.hostname, lookupImpl);
        const response = await fetchImpl(current, {
          redirect: 'manual',
          headers: {
            accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8',
            'user-agent': 'KULON-B2B-Research/1.0',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
          current = new URL(response.headers.get('location'), current);
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = response.headers.get('content-type') || '';
        if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
          throw new Error(`不支持的官网内容类型：${contentType}`);
        }
        const html = (await response.text()).slice(0, MAX_HTML_LENGTH);
        return extractWebsiteEvidence(html, current.toString());
      }
      throw new Error('官网重定向次数过多');
    } catch (error) {
      lastError = error.message;
    }
  }
  return {
    status: 'failed', finalUrl: '', title: '', description: '', keywords: '', text: '',
    signals: { meanWellMentioned: false, matchedTerms: [], directFit: false },
    error: lastError || '官网读取失败',
  };
}
