import fs from 'node:fs';

export function loadEnv(path = '.env') {
  if (!fs.existsSync(path)) return {};

  const values = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function createConfig({ envFile = '.env', processEnv = process.env } = {}) {
  const fileEnv = loadEnv(envFile);
  const env = { ...fileEnv, ...processEnv };

  return {
    server: {
      host: env.HOST || '127.0.0.1',
      port: Number(env.PORT || 8787),
    },
    auth: {
      passwordHash: env.WEB_LOGIN_PASSWORD_HASH || '',
      sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
    },
    fumeng: {
      baseUrl: (env.FUMENG_BASE_URL || 'https://opengw.fumamx.com').replace(/\/$/, ''),
      appId: env.FUMENG_APP_ID || '',
      appSecret: env.FUMENG_APP_SECRET || '',
      publicSeaOwnerId: env.FUMENG_PUBLIC_SEA_OWNER_ID || '',
      writebackEnabled: parseBoolean(env.FUMENG_WRITEBACK_ENABLED, false),
      emailTrackModeId: env.FUMENG_EMAIL_TRACK_MODE_ID || '',
    },
    apollo: {
      baseUrl: (env.APOLLO_BASE_URL || 'https://api.apollo.io').replace(/\/$/, ''),
      apiKey: env.APOLLO_API_KEY || '',
      maxPeoplePerCompany: Math.min(Math.max(Number(env.APOLLO_MAX_PEOPLE_PER_COMPANY || 5), 1), 10),
      minimumCompanyScore: Math.min(Math.max(Number(env.APOLLO_MINIMUM_COMPANY_SCORE || 75), 0), 100),
    },
    openai: {
      baseUrl: (env.OPENAI_BASE_URL || '').replace(/\/$/, ''),
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-5.6-terra',
      apiStyle: env.OPENAI_API_STYLE || 'chat_completions',
      reasoningEffort: env.OPENAI_REASONING_EFFORT || 'low',
      webSearchEnabled: parseBoolean(env.OPENAI_WEB_SEARCH_ENABLED, false),
    },
    mimo: {
      enabled: parseBoolean(env.MIMO_INBOX_CLASSIFICATION_ENABLED, false),
      baseUrl: (env.MIMO_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1').replace(/\/$/, ''),
      apiKey: env.MIMO_API_KEY || '',
      model: env.MIMO_MODEL || 'mimo-v2.5-pro',
      timeoutMs: Math.min(Math.max(Number(env.MIMO_TIMEOUT_MS || 45_000), 5_000), 120_000),
    },
    feishu: {
      baseUrl: (env.FEISHU_BASE_URL || 'https://open.feishu.cn').replace(/\/$/, ''),
      appId: env.FEISHU_APP_ID || '',
      appSecret: env.FEISHU_APP_SECRET || '',
      appToken: env.FEISHU_APP_TOKEN || '',
      tableId: env.FEISHU_TABLE_ID || '',
    },
    brevo: {
      apiKey: env.BREVO_API_KEY || '',
      senderEmail: env.BREVO_SENDER_EMAIL || env.FROM_EMAIL || 'marketing@kulon.com',
      senderName: env.BREVO_SENDER_NAME || 'MEAN WELL KULON TEAM',
      replyToEmail: env.BREVO_REPLY_TO_EMAIL || 'marketing@kulon.com',
      webhookToken: env.BREVO_WEBHOOK_TOKEN || '',
      webhookPublicUrl: env.BREVO_WEBHOOK_PUBLIC_URL || '',
      databasePath: env.DELIVERY_DATABASE_PATH || '.data/delivery.sqlite',
      sendingEnabled: parseBoolean(env.EMAIL_SENDING_ENABLED, false),
    },
    mailbox: {
      enabled: parseBoolean(env.MAILBOX_MONITORING_ENABLED, false),
      host: env.MAILBOX_IMAP_HOST || 'imap.qiye.aliyun.com',
      port: Number(env.MAILBOX_IMAP_PORT || 993),
      secure: parseBoolean(env.MAILBOX_IMAP_SECURE, true),
      username: env.MAILBOX_IMAP_USERNAME || 'marketing@kulon.com',
      password: env.MAILBOX_IMAP_PASSWORD || '',
      folder: env.MAILBOX_IMAP_FOLDER || 'INBOX',
      initialLookbackDays: Math.min(Math.max(Number(env.MAILBOX_INITIAL_LOOKBACK_DAYS || 30), 1), 90),
      maxMessagesPerPoll: Math.min(Math.max(Number(env.MAILBOX_MAX_MESSAGES_PER_POLL || 200), 1), 500),
      databasePath: env.MAILBOX_DATABASE_PATH || '.data/inbox.sqlite',
      settingsPath: env.MAILBOX_SETTINGS_PATH || '.data/mailbox-settings.enc',
      settingsKeyPath: env.MAILBOX_SETTINGS_KEY_PATH || '.data/mailbox-settings.key',
    },
    emailAssets: {
      publicBaseUrl: (env.EMAIL_ASSET_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
      productImageDirectory: env.EMAIL_PRODUCT_IMAGE_DIRECTORY || 'public/assets/product-images',
      productImageManifestPath: env.EMAIL_PRODUCT_IMAGE_MANIFEST_PATH || 'public/assets/product-images/index.json',
      productImagePublicPath: env.EMAIL_PRODUCT_IMAGE_PUBLIC_PATH || '/product-images',
      allowBaseModelFallback: parseBoolean(env.EMAIL_PRODUCT_IMAGE_ALLOW_BASE_MODEL_FALLBACK, true),
    },
    marketing: {
      databasePath: env.MARKETING_DATABASE_PATH || '.data/marketing.sqlite',
      automationToken: env.AUTOMATION_TOKEN || '',
      settingsAdminToken: env.SETTINGS_ADMIN_TOKEN || '',
      enabled: parseBoolean(env.MARKETING_AUTOMATION_ENABLED, false),
      dailyCompanyLimit: Math.min(Math.max(Number(env.DAILY_COMPANY_LIMIT || 300), 1), 300),
      dailyResearchLimit: Math.min(Math.max(Number(env.DAILY_RESEARCH_LIMIT || 1000), 10), 1000),
      researchEnabled: parseBoolean(env.APOLLO_RESEARCH_ENABLED, true),
      researchPauseReason: env.APOLLO_RESEARCH_PAUSE_REASON || '',
      dailySendLimit: Math.min(Math.max(Number(env.DAILY_SEND_LIMIT || 300), 1), 300),
      companyCooldownDays: Math.min(Math.max(Number(env.COMPANY_COOLDOWN_DAYS || 7), 1), 90),
      sendWindowStartHour: Math.min(Math.max(Number(env.SEND_WINDOW_START_HOUR || 9), 0), 23),
      sendWindowEndHour: Math.min(Math.max(Number(env.SEND_WINDOW_END_HOUR || 16), 1), 24),
      autoApproveScore: Math.min(Math.max(Number(env.AUTO_APPROVE_SCORE || 85), 0), 100),
      secondTouchEnabled: parseBoolean(env.SECOND_TOUCH_ENABLED, false),
      secondTouchPilotLimit: Math.min(Math.max(Number(env.SECOND_TOUCH_PILOT_LIMIT || 50), 1), 300),
      secondTouchMaxContactsPerCompany: Math.min(Math.max(Number(env.SECOND_TOUCH_MAX_CONTACTS_PER_COMPANY || 2), 1), 2),
      secondTouchMultiOpenDelayDays: Math.min(Math.max(Number(env.SECOND_TOUCH_MULTI_OPEN_DELAY_DAYS || 2), 1), 10),
      secondTouchSingleOpenDelayDays: Math.min(Math.max(Number(env.SECOND_TOUCH_SINGLE_OPEN_DELAY_DAYS || 5), 1), 14),
    },
    sales: {
      teamName: env.SALES_TEAM_NAME || 'MEAN WELL KULON TEAM',
      email: env.SALES_EMAIL || 'marketing@kulon.com',
      companyName: env.YOUR_COMPANY_NAME || 'Hangzhou Kulon Electronics Co.,Ltd.',
      website: env.YOUR_WEBSITE || 'https://meanwell-led.com/',
      logoUrl: env.SALES_LOGO_URL || 'https://cdn.shopify.com/s/files/1/0996/9549/3484/files/kulon-header-logo.png?v=1785212581&width=380',
      signatureBackgroundUrl:
        env.SIGNATURE_BACKGROUND_URL || 'https://meanwell.business/sign_images/bgc.png',
    },
    pricing: {
      catalogPath: env.PRICE_CATALOG_PATH || '.local_docs/pricing/Kulon最新报价_20260829.md',
      cutoverDate: env.PRICE_COST_CUTOVER_DATE || '2026-07-01',
      legacyCostMarkup: Number(env.PRICE_LEGACY_COST_MARKUP || 0.05),
      marketingMarkup: Number(env.PRICE_MARKETING_MARKUP || 0.05),
      defaultCurrency: env.PRICE_CURRENCY || 'CNY',
      emailCurrency: env.PRICE_EMAIL_CURRENCY || 'USD',
      cnyPerUsd: Number(env.PRICE_CNY_PER_USD || 7.2),
      maxEmailModels: Math.min(Math.max(Number(env.PRICE_MAX_EMAIL_MODELS || 8), 6), 8),
    },
  };
}

export function getCapabilityStatus(config, priceCatalog = null) {
  return {
    fumeng: Boolean(config.fumeng.appId && config.fumeng.appSecret),
    fumengWriteback: Boolean(
      config.fumeng.appId && config.fumeng.appSecret && config.fumeng.writebackEnabled,
    ),
    apolloConfigured: Boolean(config.apollo.apiKey),
    apollo: Boolean(config.apollo.apiKey && config.marketing.researchEnabled !== false),
    openai: Boolean(config.openai.baseUrl && config.openai.apiKey && config.openai.model),
    inboxAi: Boolean(
      config.mimo?.enabled && config.mimo.baseUrl && config.mimo.apiKey && config.mimo.model,
    ),
    feishu: Boolean(
      config.feishu.appId &&
        config.feishu.appSecret &&
        config.feishu.appToken &&
        config.feishu.tableId,
    ),
    webSearch: Boolean(
      config.openai.apiKey &&
        config.openai.webSearchEnabled &&
        config.openai.apiStyle === 'responses',
    ),
    brevo: Boolean(config.brevo.apiKey),
    deliveryTracking: Boolean(config.brevo.webhookToken),
    mailbox: Boolean(
      config.mailbox?.enabled && config.mailbox.host && config.mailbox.port &&
      config.mailbox.username && config.mailbox.password,
    ),
    signature: Boolean(
      config.sales.teamName &&
        config.sales.email &&
        config.sales.companyName &&
        config.sales.website &&
        config.sales.signatureBackgroundUrl,
    ),
    sending: Boolean(config.brevo.apiKey && config.brevo.sendingEnabled && config.marketing.enabled !== false),
    automation: Boolean(config.marketing.automationToken),
    marketingAutomation: Boolean(config.marketing.automationToken && config.marketing.enabled !== false),
    pricing: Boolean(priceCatalog?.entries?.length),
  };
}
