import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig, getCapabilityStatus } from './config.mjs';
import { AppError } from './lib/errors.mjs';
import { buildEmailHtml, getPublicSignature } from './lib/email-composer.mjs';
import { DELIVERY_STATUS, DeliveryStore, normalizeBrevoEvent } from './lib/delivery-store.mjs';
import { ApolloClient } from './lib/apollo-client.mjs';
import { BrevoClient } from './lib/brevo-client.mjs';
import { FeishuClient } from './lib/feishu-client.mjs';
import { FumengClient } from './lib/fumeng-client.mjs';
import { InboxStore } from './lib/inbox-store.mjs';
import { buildInboundEmailDocument } from './lib/inbound-email-html.mjs';
import {
  getMailboxSettings,
  loadMailboxSettings,
  updateMailboxSettings,
} from './lib/mailbox-settings.mjs';
import { MarketingStore } from './lib/marketing-store.mjs';
import { MiMoClient } from './lib/mimo-client.mjs';
import { getMiMoSettings, updateMiMoSettings } from './lib/mimo-settings.mjs';
import { OpenAIClient } from './lib/openai-client.mjs';
import { DraftService } from './services/draft-service.mjs';
import { EnrichmentService } from './services/enrichment-service.mjs';
import { MarketingService } from './services/marketing-service.mjs';
import { MailboxMonitor } from './services/mailbox-monitor.mjs';
import { getRelaySettings, updateRelaySettings } from './lib/relay-settings.mjs';
import { getMarketingSettings, updateMarketingSettings } from './lib/marketing-settings.mjs';
import { isPrivateNetworkAddress } from './lib/network-access.mjs';
import { loadPriceCatalog } from './lib/price-catalog.mjs';
import { getProductImage, listProductImageModels } from './lib/product-images.mjs';
import { WebAuth, isLoopbackAddress } from './lib/web-auth.mjs';

const config = createConfig();
await loadMailboxSettings(config);
const webAuth = new WebAuth(config);
const priceCatalog = await loadPriceCatalog(config.pricing);
const fumeng = new FumengClient(config.fumeng);
const apollo = new ApolloClient(config.apollo);
const openai = new OpenAIClient(config.openai);
const mimo = new MiMoClient(config.mimo);
const feishu = new FeishuClient(config.feishu);
const brevo = new BrevoClient(config.brevo);
const drafts = new DraftService({ fumeng, openai, sales: config.sales });
const delivery = new DeliveryStore({ databasePath: path.resolve(config.brevo.databasePath) });
const marketingStore = new MarketingStore({ databasePath: path.resolve(config.marketing.databasePath) });
const inbox = new InboxStore({ databasePath: path.resolve(config.mailbox.databasePath) });
const mailboxMonitor = new MailboxMonitor({
  config, inbox, marketing: marketingStore, feishu, mimo,
});
const deliveryBackfill = delivery.recordSentJobs(marketingStore.listSentJobs());
if (deliveryBackfill.accepted) {
  console.log(`Added ${deliveryBackfill.accepted} sent marketing emails to delivery tracking.`);
}
const cancelledLegacyMarketingJobs = priceCatalog.entries.length
  ? marketingStore.cancelJobsMissingExactProductImages()
  : 0;
if (cancelledLegacyMarketingJobs) {
  console.warn(`Cancelled ${cancelledLegacyMarketingJobs} legacy marketing jobs without exact model images.`);
}
const recoveredImageReadyJobs = marketingStore.recoverImageReadyCancelledJobs();
if (recoveredImageReadyJobs) {
  console.log(`Restored ${recoveredImageReadyJobs} marketing jobs with valid product images.`);
}
const enrichment = new EnrichmentService({ apollo, fumeng, marketing: marketingStore, config });
const marketing = new MarketingService({
  fumeng, enrichment, drafts, marketing: marketingStore, brevo, delivery, feishu, config, priceCatalog,
  onResearchPaused: ({ reason }) => updateMarketingSettings(config, {
    researchEnabled: false,
    researchPauseReason: reason,
  }),
});
let dailyMarketingRun = null;
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const loginAttempts = new Map();
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new AppError('请求内容过大', { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('请求不是有效 JSON', { status: 400, code: 'INVALID_JSON' });
  }
}

function tokenMatches(candidate, expected) {
  if (!candidate || !expected) return false;
  const left = Buffer.from(String(candidate));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requestAddress(request) {
  return String(request.socket.remoteAddress || '').trim();
}

function requireWebSession(request) {
  const session = webAuth.readSession(request.headers.cookie);
  if (!session) {
    throw new AppError('请先登录营销控制台', {
      status: 401,
      code: 'WEB_LOGIN_REQUIRED',
    });
  }
  return session;
}

function loginRateKey(request) {
  return requestAddress(request) || 'unknown';
}

function assertLoginRateAvailable(request) {
  const key = loginRateKey(request);
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < LOGIN_ATTEMPT_WINDOW_MS);
  if (attempts.length >= LOGIN_ATTEMPT_LIMIT) {
    throw new AppError('登录失败次数过多，请 15 分钟后再试', {
      status: 429,
      code: 'WEB_LOGIN_RATE_LIMITED',
    });
  }
  loginAttempts.set(key, attempts);
}

function recordFailedLogin(request) {
  const key = loginRateKey(request);
  const attempts = loginAttempts.get(key) || [];
  attempts.push(Date.now());
  loginAttempts.set(key, attempts);
}

function clearFailedLogins(request) {
  loginAttempts.delete(loginRateKey(request));
}

function requireAutomationAccess(request) {
  if (!config.marketing.automationToken) {
    throw new AppError('n8n 自动化 Token 尚未配置', {
      status: 503,
      code: 'AUTOMATION_NOT_CONFIGURED',
    });
  }
  const authorization = String(request.headers.authorization || '');
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!tokenMatches(bearer, config.marketing.automationToken)) {
    throw new AppError('n8n 自动化请求未授权', { status: 401, code: 'UNAUTHORIZED' });
  }
}

function requireSettingsAccess(request) {
  const expected = config.marketing.settingsAdminToken;
  if (!expected) {
    if (!isPrivateNetworkAddress(request.socket.remoteAddress)) {
      throw new AppError('网页配置接口仅允许本机或私有局域网访问', {
        status: 403,
        code: 'SETTINGS_LOCAL_ONLY',
      });
    }
    return;
  }
  const authorization = String(request.headers.authorization || '');
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : String(request.headers['x-settings-token'] || '').trim();
  if (!tokenMatches(bearer, expected)) {
    throw new AppError('网页配置接口未授权', { status: 401, code: 'UNAUTHORIZED' });
  }
}

function requireMarketingSettingsAccess(request) {
  requireSettingsAccess(request);
}

function runDailyMarketingSafely(options = {}) {
  if (dailyMarketingRun) return dailyMarketingRun;
  dailyMarketingRun = marketing.runDailyMarketing(options)
    .finally(() => { dailyMarketingRun = null; });
  return dailyMarketingRun;
}

function runMarketingBatchSafely() {
  return runDailyMarketingSafely({
    researchLimit: Math.min(config.marketing.dailyResearchLimit, 10),
  });
}

function clean(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function productFamilyLabel(model, family) {
  const text = `${clean(model)} ${clean(family)}`.toUpperCase();
  if (/\b(?:HDR|NDR|EDR|SDR|MDR|DDR|DRP|DRS|DRC|DRDN|DRH)\b/.test(text)) return 'DIN-rail / DC cabinet';
  if (/\b(?:LRS|RSP|HRP|MSP|CSP|ERP|ERPF|SE)\b/.test(text)) return 'Enclosed AC/DC';
  if (/\b(?:ELG|HLG|XLG|HBG|NPF|LPF|LPV|LCM|PLC|PLN)\b/.test(text)) return 'LED driver';
  if (/\b(?:GST|GSM|AD|APC|APV|GS)\b/.test(text)) return 'Adapter';
  if (/\b(?:IRM|MPM|MFM|EPP|EPS|MPS|PMP)\b/.test(text)) return 'PCB / open-frame';
  if (/\b(?:DUPS|DR-UPS|DBU|DBUF|DPU)\b/.test(text)) return 'UPS / backup';
  return 'Power supply';
}

function publicProductEntry(entry) {
  const image = getProductImage(entry.model, config.emailAssets);
  return {
    model: entry.model,
    family: entry.family,
    category: productFamilyLabel(entry.model, entry.family),
    price: Number.isFinite(entry.emailPrice) ? entry.emailPrice : entry.marketingPrice,
    currency: entry.emailCurrency || entry.currency || priceCatalog.emailCurrency || 'USD',
    availability: entry.availability || 'In Stock',
    quoteDate: entry.quoteDate,
    imageUrl: image.imageUrl,
    imageAvailable: image.imageAvailable,
    imageSource: image.imageSource,
  };
}

function handlePublicProducts(request, response, url) {
  const query = clean(url.searchParams.get('q')).toUpperCase();
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 80), 1), 200);
  const imageOnly = url.searchParams.get('imageOnly') !== 'false';
  const terms = query.split(/\s+/).filter(Boolean);
  const entries = (priceCatalog.entries || [])
    .map(publicProductEntry)
    .filter((entry) => !imageOnly || entry.imageAvailable)
    .filter((entry) => {
      if (!terms.length) return true;
      const haystack = `${entry.model} ${entry.family} ${entry.category}`.toUpperCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((left, right) => {
      const leftExact = query && left.model.toUpperCase() === query ? 0 : 1;
      const rightExact = query && right.model.toUpperCase() === query ? 0 : 1;
      return leftExact - rightExact
        || right.quoteDate.localeCompare(left.quoteDate)
        || left.model.localeCompare(right.model);
    })
    .slice(0, limit);

  return sendJson(response, 200, {
    products: entries,
    pricing: {
      available: Boolean(priceCatalog.entries.length),
      entryCount: priceCatalog.entries.length,
      generatedDate: priceCatalog.generatedDate,
      emailCurrency: priceCatalog.emailCurrency,
      error: priceCatalog.error,
    },
  });
}

function deliveryPeriod(period = 'today', now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'yesterday') {
    const end = new Date(start);
    start.setDate(start.getDate() - 1);
    return { key: period, label: '昨天已发送', from: start.toISOString(), to: end.toISOString() };
  }
  if (period === 'last24h') {
    return { key: period, label: '最近24小时', from: new Date(now.getTime() - 86_400_000).toISOString(), to: now.toISOString() };
  }
  if (period === 'last7d') {
    start.setDate(start.getDate() - 7);
    return { key: period, label: '最近7天', from: start.toISOString(), to: now.toISOString() };
  }
  if (period === 'all') return { key: period, label: '全部已发送', from: '', to: '' };
  return { key: 'today', label: '今天已发送', from: start.toISOString(), to: now.toISOString() };
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/auth/status') {
    return sendJson(response, 200, {
      configured: webAuth.configured,
      authenticated: Boolean(webAuth.readSession(request.headers.cookie)),
      setupAllowed: !webAuth.configured && isLoopbackAddress(requestAddress(request)),
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/setup') {
    if (!isLoopbackAddress(requestAddress(request))) {
      throw new AppError('首次设置密码只能在运行服务的电脑上完成', {
        status: 403,
        code: 'WEB_AUTH_SETUP_LOCAL_ONLY',
      });
    }
    const body = await readBody(request);
    await webAuth.setupPassword(body.password);
    const session = webAuth.issueSession();
    return sendJson(response, 201, { ok: true, expiresAt: session.expiresAt }, { 'set-cookie': session.cookie });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!webAuth.configured) {
      throw new AppError('请先在运行服务的电脑上设置网页登录密码', {
        status: 409,
        code: 'WEB_AUTH_NOT_CONFIGURED',
      });
    }
    assertLoginRateAvailable(request);
    const body = await readBody(request);
    if (!await webAuth.authenticate(body.password)) {
      recordFailedLogin(request);
      throw new AppError('登录密码不正确', {
        status: 401,
        code: 'WEB_AUTH_INVALID_CREDENTIALS',
      });
    }
    clearFailedLogins(request);
    const session = webAuth.issueSession();
    return sendJson(response, 200, { ok: true, expiresAt: session.expiresAt }, { 'set-cookie': session.cookie });
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    return sendJson(response, 200, { ok: true }, { 'set-cookie': webAuth.clearSessionCookie() });
  }

  if (request.method === 'PUT' && url.pathname === '/api/auth/password') {
    requireWebSession(request);
    const body = await readBody(request);
    await webAuth.changePassword(body.currentPassword, body.newPassword);
    const session = webAuth.issueSession();
    return sendJson(response, 200, { ok: true, expiresAt: session.expiresAt }, { 'set-cookie': session.cookie });
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    const dailyStats = marketingStore.getDailyMarketingStats();
    const productImageModels = listProductImageModels(config.emailAssets);
    return sendJson(response, 200, {
      ok: true,
      capabilities: {
        ...getCapabilityStatus(config, priceCatalog),
        productImages: productImageModels.length > 0,
      },
      model: config.openai.model,
      dailySendLimit: config.marketing.dailySendLimit,
      marketing: getMarketingSettings(config, dailyStats),
      pricing: {
        available: Boolean(priceCatalog.entries.length),
        entryCount: priceCatalog.entries.length,
        generatedDate: priceCatalog.generatedDate,
        emailCurrency: priceCatalog.emailCurrency,
        cnyPerUsd: priceCatalog.cnyPerUsd,
        error: priceCatalog.error,
      },
      productImages: {
        ready: productImageModels.length > 0,
        availableCount: productImageModels.length,
      },
      brevo: brevo.getAccessStatus(),
      mailbox: {
        ...getMailboxSettings(config),
        state: inbox.getState(config.mailbox.username),
      },
      bind: `${config.server.host}:${config.server.port}`,
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/public/email-products') {
    return handlePublicProducts(request, response, url);
  }

  if (request.method === 'GET' && url.pathname === '/api/settings/relay') {
    requireSettingsAccess(request);
    return sendJson(response, 200, getRelaySettings(config));
  }

  if (request.method === 'PUT' && url.pathname === '/api/settings/relay') {
    requireSettingsAccess(request);
    const body = await readBody(request);
    const settings = await updateRelaySettings(config, body);
    return sendJson(response, 200, settings);
  }

  if (request.method === 'GET' && url.pathname === '/api/settings/mimo') {
    requireSettingsAccess(request);
    return sendJson(response, 200, getMiMoSettings(config));
  }

  if (request.method === 'PUT' && url.pathname === '/api/settings/mimo') {
    requireSettingsAccess(request);
    const body = await readBody(request);
    const wasEnabled = config.mimo.enabled;
    const settings = await updateMiMoSettings(config, body);
    if (settings.enabled && !wasEnabled) {
      void mailboxMonitor.reclassifyPending({ limit: 200, includeFallback: true })
        .then(() => mailboxMonitor.syncPendingFeishu({ limit: 200 }))
        .catch((error) => console.error('Historical inbox classification failed:', error));
    }
    return sendJson(response, 200, settings);
  }

  if (request.method === 'POST' && url.pathname === '/api/settings/mimo/test') {
    requireSettingsAccess(request);
    return sendJson(response, 200, await mimo.testConnection());
  }

  if (request.method === 'GET' && url.pathname === '/api/settings/mailbox') {
    requireSettingsAccess(request);
    return sendJson(response, 200, getMailboxSettings(config));
  }

  if (request.method === 'PUT' && url.pathname === '/api/settings/mailbox') {
    requireSettingsAccess(request);
    const body = await readBody(request);
    const settings = await updateMailboxSettings(config, body);
    return sendJson(response, 200, settings);
  }

  if (request.method === 'POST' && url.pathname === '/api/settings/mailbox/test') {
    requireSettingsAccess(request);
    return sendJson(response, 200, await mailboxMonitor.testConnection());
  }

  if (request.method === 'GET' && url.pathname === '/api/settings/marketing') {
    requireMarketingSettingsAccess(request);
    return sendJson(response, 200, getMarketingSettings(config, marketingStore.getDailyMarketingStats()));
  }

  if (request.method === 'PUT' && url.pathname === '/api/settings/marketing') {
    requireMarketingSettingsAccess(request);
    const body = await readBody(request);
    const settings = await updateMarketingSettings(config, body);
    const requestedMarketingEnabled = body.enabled === true || ['1', 'true', 'yes', 'on'].includes(String(body.enabled || '').toLowerCase());
    const requestedResearchEnabled = body.researchEnabled === true || ['1', 'true', 'yes', 'on'].includes(String(body.researchEnabled || '').toLowerCase());
    const requestedSendingEnabled = body.sendingEnabled === true || ['1', 'true', 'yes', 'on'].includes(String(body.sendingEnabled || '').toLowerCase());
    const startingResearch = Boolean(
      settings.enabled && settings.researchEnabled && (requestedMarketingEnabled || requestedResearchEnabled),
    );
    const startingSending = Boolean(
      settings.enabled && settings.sendingEnabled && (requestedMarketingEnabled || requestedSendingEnabled),
    );
    const startingTasks = [];
    if (startingResearch) startingTasks.push(runMarketingBatchSafely());
    if (startingSending) startingTasks.push(marketing.sendDue({ limit: config.marketing.dailySendLimit }));
    if (startingTasks.length) {
      void Promise.all(startingTasks).catch((error) => console.error('Marketing start failed:', error));
    }
    return sendJson(response, 200, {
      ...settings,
      starting: startingResearch || startingSending,
      startingResearch,
      startingSending,
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/customers') {
    const result = await fumeng.listCustomers({
      from: url.searchParams.get('from'),
      size: url.searchParams.get('size'),
      scope: url.searchParams.get('scope'),
      sortBy: url.searchParams.get('sortBy'),
      sortDirection: url.searchParams.get('sortDirection'),
    });
    return sendJson(response, 200, result);
  }

  if (request.method === 'GET' && url.pathname === '/api/email/signature') {
    return sendJson(response, 200, { signature: getPublicSignature(config.sales) });
  }

  if (request.method === 'GET' && url.pathname === '/api/delivery') {
    const period = deliveryPeriod(url.searchParams.get('period') || 'today');
    const campaign = url.searchParams.get('campaign') || 'all';
    const result = delivery.getDashboard({
      limit: url.searchParams.get('limit'),
      status: url.searchParams.get('status'),
      campaign,
      sort: url.searchParams.get('sort'),
      from: period.from,
      to: period.to,
    });
    const sentSummary = marketingStore.getSentSummary({ from: period.from, to: period.to, campaign });
    const items = result.items.map((item) => {
      const job = marketingStore.findJobByMessageId(item.messageId);
      return {
        ...item,
        jobId: job?.id || '',
        campaign: job?.campaign || item.campaign || '',
        companyName: job?.companyName || '',
        contactName: job?.contactName || '',
        country: job?.country || '',
        timeZone: job?.timeZone || '',
        scheduledAt: job?.scheduledAt || '',
        sentAt: job?.sentAt || item.firstEventAt || '',
        emailPreviewAvailable: Boolean(job?.htmlContent),
      };
    });
    return sendJson(response, 200, {
      ...result,
      items,
      period,
      sentSummary,
      screening: marketingStore.getScreeningDashboard({ limit: 20 }),
      secondTouch: marketing.getSecondTouchDashboard(),
      webhookConfigured: Boolean(config.brevo.webhookToken),
      publicUrlConfigured: Boolean(config.brevo.webhookPublicUrl),
    });
  }

  if (request.method === 'GET' && url.pathname === '/api/marketing') {
    return sendJson(response, 200, marketingStore.getDashboard({
      limit: url.searchParams.get('limit'),
      status: url.searchParams.get('status'),
    }));
  }

  if (request.method === 'GET' && url.pathname === '/api/inbox') {
    return sendJson(response, 200, {
      ...inbox.getDashboard({
        limit: url.searchParams.get('limit'),
        classification: url.searchParams.get('classification'),
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
      }),
      mailbox: {
        ...getMailboxSettings(config),
        state: inbox.getState(config.mailbox.username),
      },
    });
  }

  const inboxHtmlMatch = url.pathname.match(/^\/api\/inbox\/([^/]+)\/html$/);
  if (request.method === 'GET' && inboxHtmlMatch) {
    const message = inbox.get(decodeURIComponent(inboxHtmlMatch[1]));
    if (!message) throw new AppError('收件记录不存在', { status: 404, code: 'NOT_FOUND' });
    if (!message.htmlBody) throw new AppError('该邮件没有可显示的 HTML 内容', { status: 404, code: 'HTML_NOT_AVAILABLE' });
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'content-security-policy': "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: http: data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; media-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    });
    response.end(buildInboundEmailDocument(message.htmlBody));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/inbox/poll') {
    return sendJson(response, 200, await mailboxMonitor.poll());
  }

  const emailPreviewDocumentMatch = url.pathname.match(/^\/api\/marketing\/jobs\/([^/]+)\/email-preview\/document$/);
  if (request.method === 'GET' && emailPreviewDocumentMatch) {
    const job = marketingStore.getJob(decodeURIComponent(emailPreviewDocumentMatch[1]));
    if (!job) throw new AppError('邮件任务不存在', { status: 404, code: 'NOT_FOUND' });
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    });
    response.end(job.htmlContent);
    return;
  }

  const emailPreviewMatch = url.pathname.match(/^\/api\/marketing\/jobs\/([^/]+)\/email-preview$/);
  if (request.method === 'GET' && emailPreviewMatch) {
    const job = marketingStore.getJob(decodeURIComponent(emailPreviewMatch[1]));
    if (!job) throw new AppError('邮件任务不存在', { status: 404, code: 'NOT_FOUND' });
    return sendJson(response, 200, {
      id: job.id,
      companyName: job.companyName,
      contactName: job.contactName,
      email: job.email,
      subject: job.subject,
      status: job.status,
      scheduledAt: job.scheduledAt,
      sentAt: job.sentAt,
      messageId: job.messageId,
      documentUrl: `/api/marketing/jobs/${encodeURIComponent(job.id)}/email-preview/document`,
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/webhooks/brevo') {
    if (!config.brevo.webhookToken) {
      throw new AppError('Brevo Webhook 尚未配置', {
        status: 503,
        code: 'BREVO_WEBHOOK_NOT_CONFIGURED',
      });
    }
    const authorization = String(request.headers.authorization || '');
    const bearer = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7).trim()
      : '';
    const candidate = bearer || String(request.headers['x-brevo-webhook-token'] || '').trim();
    if (!tokenMatches(candidate, config.brevo.webhookToken)) {
      throw new AppError('Brevo Webhook 鉴权失败', { status: 401, code: 'UNAUTHORIZED' });
    }
    const body = await readBody(request);
    const events = (Array.isArray(body) ? body : [body]).map(normalizeBrevoEvent).filter(Boolean);
    const result = delivery.ingest(body);
    for (const payload of Array.isArray(body) ? body : [body]) {
      const event = normalizeBrevoEvent(payload);
      if (event && DELIVERY_STATUS[event.eventType]?.stop && event.email) {
        marketingStore.suppress(event.email, event.eventType, 'brevo_webhook');
      }
    }
    const trackingSummaries = delivery.getFeishuTrackingSummariesForMessages(
      events.map((event) => event.messageKey),
    );
    if (getCapabilityStatus(config, priceCatalog).feishu) {
      for (const summary of trackingSummaries) {
        await feishu.updateDeliveryTracking(summary.recordId, summary);
      }
    }
    return sendJson(response, 202, { ok: true, ...result });
  }

  if (url.pathname.startsWith('/api/automation/')) {
    requireAutomationAccess(request);
  }

  if (request.method === 'GET' && url.pathname === '/api/automation/candidates') {
    const result = await marketing.listCandidates({ limit: url.searchParams.get('limit') });
    return sendJson(response, 200, result);
  }

  if (request.method === 'POST' && url.pathname === '/api/automation/run-daily') {
    const body = await readBody(request);
    const result = await runDailyMarketingSafely({ companyLimit: body.companyLimit, researchLimit: body.researchLimit });
    return sendJson(response, 200, result);
  }

  if (request.method === 'POST' && url.pathname === '/api/automation/run-validation') {
    const body = await readBody(request);
    const researchLimit = Number(body.researchLimit || 10);
    if (!Number.isInteger(researchLimit) || researchLimit < 1 || researchLimit > 10) {
      throw new AppError('安全试跑客户数必须是 1-10 的整数', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    if (config.brevo.sendingEnabled) {
      throw new AppError('安全试跑要求先关闭邮件发送开关', {
        status: 409,
        code: 'VALIDATION_REQUIRES_SENDING_DISABLED',
      });
    }
    const result = await runDailyMarketingSafely({
      companyLimit: 300,
      researchLimit,
      allowWhenPaused: true,
    });
    return sendJson(response, 200, {
      ...result,
      validationMode: true,
      sendingDisabled: true,
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/automation/validate-customer') {
    const body = await readBody(request);
    if (config.brevo.sendingEnabled) {
      throw new AppError('安全试跑要求先关闭邮件发送开关', {
        status: 409,
        code: 'VALIDATION_REQUIRES_SENDING_DISABLED',
      });
    }
    const result = await marketing.prepareCustomer({
      customerId: body.customerId,
      researchWebsite: true,
      allowWhenPaused: true,
    });
    return sendJson(response, 200, {
      ...result,
      validationMode: true,
      sendingDisabled: true,
    });
  }

  if (request.method === 'POST' && url.pathname === '/api/automation/prepare') {
    const body = await readBody(request);
    const result = await marketing.prepareCustomer({
      customerId: body.customerId,
      researchWebsite: Boolean(body.researchWebsite),
    });
    return sendJson(response, 200, result);
  }

  if (request.method === 'POST' && url.pathname === '/api/automation/queue-second-touch') {
    const body = await readBody(request);
    const result = marketing.queueSecondTouch({ limit: body.limit });
    return sendJson(response, 200, result);
  }

  if (request.method === 'POST' && url.pathname === '/api/automation/send-due') {
    const body = await readBody(request);
    const result = await marketing.sendDue({ limit: body.limit });
    return sendJson(response, 200, result);
  }

  if (request.method === 'POST' && url.pathname === '/api/automation/inbox/poll') {
    return sendJson(response, 200, await mailboxMonitor.poll());
  }

  if (request.method === 'POST' && url.pathname === '/api/email/preview') {
    const body = await readBody(request);
    return sendJson(response, 200, {
      html: buildEmailHtml({ body: body.emailBody || '', sales: config.sales }),
    });
  }

  const contactMatch = url.pathname.match(/^\/api\/customers\/([^/]+)\/contacts$/);
  if (request.method === 'GET' && contactMatch) {
    const items = await fumeng.listContacts(decodeURIComponent(contactMatch[1]));
    return sendJson(response, 200, { items });
  }

  if (request.method === 'POST' && url.pathname === '/api/drafts/generate') {
    const body = await readBody(request);
    const result = await drafts.generate(body);
    return sendJson(response, 200, result);
  }

  if (request.method === 'GET' && url.pathname === '/api/feishu/schema') {
    const result = await feishu.checkDraftFields();
    return sendJson(response, 200, result);
  }

  if (request.method === 'GET' && url.pathname === '/api/feishu/drafts') {
    const result = await feishu.listDraftRecords({ limit: url.searchParams.get('limit') });
    return sendJson(response, 200, result);
  }

  if (request.method === 'POST' && url.pathname === '/api/feishu/drafts') {
    const body = await readBody(request);
    if (!body.customer || !body.contact || !body.draft) {
      throw new AppError('缺少 customer、contact 或 draft', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    const record = await feishu.createDraftRecord(body);
    const recordId = record?.record_id || record?.recordId || record?.id || '';
    const queued = recordId
      ? await marketing.queueManualDraft({
        customer: body.customer,
        contact: body.contact,
        draft: body.draft,
        feishuRecordId: recordId,
      })
      : null;
    return sendJson(response, 201, { record, queued });
  }

  throw new AppError('接口不存在', { status: 404, code: 'NOT_FOUND' });
}

async function serveStatic(response, pathname) {
  const relative = pathname === '/'
    ? 'index.html'
    : pathname.startsWith('/email-assets/')
      ? `assets/${pathname.slice('/email-assets/'.length)}`
      : pathname.replace(/^\//, '');
  const target = path.resolve(publicDir, relative);
  if (!target.startsWith(`${publicDir}${path.sep}`)) {
    throw new AppError('文件不存在', { status: 404, code: 'NOT_FOUND' });
  }
  try {
    const body = await fs.readFile(target);
    const allowsInlineEmailStyles = pathname === '/newlord-meanwell-email.html'
      || pathname === '/marketing-email-builder.html';
    const styleSrc = allowsInlineEmailStyles ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";
    response.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(target)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': `default-src 'self'; ${styleSrc}; script-src 'self'; connect-src 'self'; img-src 'self' data: https:; frame-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
    });
    response.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new AppError('文件不存在', { status: 404, code: 'NOT_FOUND' });
    }
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      const publicApi = url.pathname === '/api/health'
        || url.pathname === '/api/auth/status'
        || url.pathname === '/api/auth/setup'
        || url.pathname === '/api/auth/login'
        || url.pathname === '/api/auth/logout'
        || url.pathname === '/api/webhooks/brevo'
        || url.pathname === '/api/public/email-products'
        || url.pathname.startsWith('/api/automation/');
      if (!publicApi) requireWebSession(request);
      await handleApi(request, response, url);
    } else if (request.method === 'GET') {
      const publicStatic = url.pathname === '/login.html'
        || url.pathname === '/login.js'
        || url.pathname === '/login.css'
        || url.pathname === '/newlord-meanwell-email.html'
        || url.pathname === '/newlord-meanwell-email.js'
        || url.pathname === '/marketing-email-builder.html'
        || url.pathname === '/marketing-email-builder.css'
        || url.pathname === '/marketing-email-builder.js'
        || url.pathname === '/assets/kulon-logo.png';
      if (!publicStatic && !webAuth.readSession(request.headers.cookie)) {
        response.writeHead(302, { location: '/login.html', 'cache-control': 'no-store' });
        response.end();
      } else {
        await serveStatic(response, url.pathname);
      }
    } else {
      throw new AppError('请求方法不支持', { status: 405, code: 'METHOD_NOT_ALLOWED' });
    }
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
    if (status >= 500) console.error(error);
    sendJson(response, status, {
      error: { code, message: error.message || '服务内部错误', details: error.details },
    });
  }
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`KULON marketing service: http://${config.server.host}:${config.server.port}`);
  console.log(`Apollo: ${config.apollo.apiKey ? 'configured' : 'waiting for API key'}`);
  console.log(`Fumeng write-back: ${config.fumeng.writebackEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Email sending: ${config.brevo.sendingEnabled ? 'enabled' : 'disabled'}`);
  console.log(`Mailbox monitoring: ${config.mailbox.enabled ? 'enabled' : 'disabled'}`);
  console.log(`MiMo inbox classification: ${mimo.configured ? 'enabled' : 'disabled'}`);
  setTimeout(() => {
    const ensureInboundFields = getCapabilityStatus(config, priceCatalog).feishu
      ? feishu.ensureInboundTrackingFields()
      : Promise.resolve({ created: [] });
    void Promise.all([
      marketing.recoverIncompleteFeishuResearchAudits(),
      ensureInboundFields,
    ])
      .then(([summary, inboundFields]) => {
        if (summary.recovered || summary.failed) {
          console.log(`Feishu research audit recovery: ${summary.recovered} recovered, ${summary.failed} failed.`);
        }
        if (inboundFields.created.length) {
          console.log(`Created Feishu inbound fields: ${inboundFields.created.join(', ')}`);
        }
        if (config.marketing.enabled && config.marketing.researchEnabled !== false) return runMarketingBatchSafely();
        return null;
      })
      .catch((error) => console.error('Startup recovery or marketing batch failed:', error));
  }, 1000).unref();
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; closing KULON marketing service.`);
  server.close(() => {
    delivery.close();
    marketingStore.close();
    inbox.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
