const state = {
  health: null,
  customers: [],
  total: 0,
  from: 0,
  pageSize: 50,
  sortBy: 'modified',
  sortDirection: 'desc',
  selectedCustomer: null,
  contacts: [],
  draftBundle: null,
  signature: null,
  queue: { items: [], enrichments: [], exclusions: [], pending: [], summary: { total: 0, queued: 0, sent: 0, failed: 0, enriched: 0, suppressed: 0, excludedToday: 0, pendingToday: 0, byStatus: {} } },
  delivery: { summary: { total: 0, sentToday: 0, delivered: 0, opened: 0, failed: 0, stopped: 0 }, secondTouch: { enabled: false, eligible: 0, queued: 0, sent: 0, remainingPilot: 0 }, items: [], webhookConfigured: false, publicUrlConfigured: false },
  demoMode: new URLSearchParams(window.location.search).get('demo') === '1',
  settingsAdminToken: '',
  relaySettings: null,
  marketingSettings: null,
  deliveryExpansion: new Map(),
  inboxExpansion: new Set(),
  inbox: { summary: { total: 0, inquiries: 0, potentialInterests: 0, ordinaryReplies: 0, aiClassified: 0, matched: 0, autoReplies: 0, bounces: 0, unmatched: 0 }, items: [], mailbox: {} },
  mailboxSettings: null,
  mimoSettings: null,
};

const demoCustomers = [
  { id: 'demo-1', billCode: 'IN-26001', companyName: 'Apex Industrial Controls Pvt. Ltd.', website: 'example.invalid', ownerName: '公海客户', country: '印度', industry: '工业自动化', customerStateId: '2', customerState: '意向', mainContactId: 'contact-1', mainContactName: 'Raj Patel', mainContactEmail: 'raj@example.invalid', lastTrackDate: '2026-08-12' },
  { id: 'demo-2', billCode: 'DE-26008', companyName: 'Nordlicht Power Systems GmbH', website: 'example.invalid', ownerName: '公海客户', country: '德国', industry: '电气分销', customerStateId: '1', customerState: '线索', mainContactId: 'contact-2', mainContactName: 'Anna Weber', mainContactEmail: 'anna@example.invalid', lastTrackDate: '2026-08-10' },
  { id: 'demo-3', billCode: 'AE-26012', companyName: 'Orbit Technical Trading LLC', website: '', ownerName: '亚洲D0', country: '阿联酋', industry: '电源贸易', customerStateId: '1', customerState: '线索', mainContactId: '', mainContactName: '', mainContactEmail: '', lastTrackDate: '2026-08-08' },
  { id: 'demo-4', billCode: 'BR-25119', companyName: 'Matriz Engenharia Eletrica', website: 'example.invalid', ownerName: '南美D1', country: '巴西', industry: '系统集成', customerStateId: '3', customerState: '成交', mainContactId: 'contact-4', mainContactName: 'Lucas Silva', mainContactEmail: 'lucas@example.invalid', lastTrackDate: '2026-07-26' },
];

const demoContacts = {
  'demo-1': [{ id: 'contact-1', name: 'Raj Patel', email: 'raj@example.invalid', jobRole: 'Managing Director', primary: true, emailSource: 'fumeng_contact' }],
  'demo-2': [{ id: 'contact-2', name: 'Anna Weber', email: 'anna@example.invalid', jobRole: 'Purchasing Manager', primary: true, emailSource: 'fumeng_contact' }],
  'demo-3': [],
  'demo-4': [{ id: 'contact-4', name: 'Lucas Silva', email: 'lucas@example.invalid', jobRole: 'Project Manager', primary: true, emailSource: 'fumeng_contact' }],
};

const demoDelivery = {
  webhookConfigured: true,
  publicUrlConfigured: true,
  summary: { total: 3, sentToday: 3, eventTotal: 8, delivered: 2, opened: 1, clicked: 0, failed: 1, stopped: 1, byStatus: { delivered: 1, opened: 1, hard_bounce: 1 } },
  secondTouch: { enabled: true, eligible: 1, queued: 0, sent: 0, remainingPilot: 50 },
  screening: {
    today: { id: 'today', researched: 10, qualified: 4, excluded: 2, pending: 4, contactsFound: 13, contactsCreated: 3, queuedCompanies: 4, queuedEmails: 9 },
    batches: [{ id: 'demo-batch', source: 'automatic', completedAt: '2026-08-15T05:35:00.000Z', researched: 10, qualified: 4, excluded: 2, pending: 4, contactsFound: 13, contactsCreated: 3, queuedCompanies: 4, queuedEmails: 9 }],
  },
  items: [
    { messageKey: 'demo-message-1', messageId: '<demo-1@brevo>', campaign: 'initial_outreach_v1', email: 'raj@example.invalid', subject: 'Power supply options for your industrial projects', status: 'opened', statusLabel: '已打开', tone: 'success', stopped: false, lastEventAt: '2026-08-15T05:42:00.000Z', events: [
      { id: 'demo-event-3', label: '已打开', tone: 'success', occurredAt: '2026-08-15T05:42:00.000Z' },
      { id: 'demo-event-2', label: '已送达', tone: 'success', occurredAt: '2026-08-15T05:39:00.000Z' },
      { id: 'demo-event-1', label: '已发送', tone: 'info', occurredAt: '2026-08-15T05:38:00.000Z' },
    ] },
    { messageKey: 'demo-message-2', messageId: '<demo-2@brevo>', campaign: 'second_touch_v1', email: 'anna@example.invalid', subject: 'MEAN WELL supply for your distribution business', status: 'delivered', statusLabel: '已送达', tone: 'success', stopped: false, lastEventAt: '2026-08-15T05:40:00.000Z', events: [
      { id: 'demo-event-5', label: '已送达', tone: 'success', occurredAt: '2026-08-15T05:40:00.000Z' },
      { id: 'demo-event-4', label: '已发送', tone: 'info', occurredAt: '2026-08-15T05:39:00.000Z' },
    ] },
    { messageKey: 'demo-message-3', messageId: '<demo-3@brevo>', campaign: 'initial_outreach_v1', email: 'invalid@example.invalid', subject: 'Industrial power supply introduction', status: 'hard_bounce', statusLabel: '硬退信', tone: 'danger', stopped: true, failureReason: 'Mailbox does not exist', lastEventAt: '2026-08-15T05:41:00.000Z', events: [
      { id: 'demo-event-8', label: '硬退信', tone: 'danger', occurredAt: '2026-08-15T05:41:00.000Z', reason: 'Mailbox does not exist' },
      { id: 'demo-event-7', label: '已发送', tone: 'info', occurredAt: '2026-08-15T05:39:00.000Z' },
    ] },
  ],
};

function makeDemoDraft(customer, contact) {
  return {
    customer,
    contact,
    draft: {
      qualified: true,
      qualificationReason: 'The CRM profile indicates a relevant industrial power and automation business.',
      country: customer.country,
      region: 'Asia',
      industry: customer.industry,
      customerType: 'distributor',
      customerProfile: `${customer.companyName} appears in the CRM as an industrial power prospect. This preview uses synthetic fields only.`,
      painPoints: ['product fit', 'lead-time visibility'],
      recommendedProducts: [
        { name: 'LRS series', reason: 'A practical enclosed power supply category for industrial distribution.' },
        { name: 'HDR series', reason: 'A compact DIN-rail category for automation applications.' },
      ],
      emailSubject: 'Power supply options for your industrial projects',
      emailBody: `Dear ${contact.name || customer.companyName + ' Team'},\n\nI am reaching out from MEAN WELL KULON regarding your industrial power supply business. We support international partners with a broad MEAN WELL portfolio, including enclosed and DIN-rail solutions for automation and control applications.\n\nWould it be useful if I sent a short selection based on the voltage, wattage, and certifications your customers request most often?`,
      personalizationNotes: ['Synthetic preview data only'],
      riskFlags: ['Demo mode: no real customer data or website research was used.'],
      compliance: { approved: true, issues: [] },
      reviewRequired: true,
      debug: { model: 'synthetic-preview' },
    },
  };
}

const ids = [
  'page-breadcrumb','global-search','logout-button','nav-customer-count','metric-customers','metric-customer-note','metric-researched-total','metric-marketed-total','metric-candidates','metric-marketed','metric-review','metric-sent','metric-pending','metric-excluded','process-customers','process-ai','process-review','process-results','priority-list','system-status-list','start-pilot','pending-list','pending-summary','excluded-list','excluded-summary',
  'reload-customers','customer-search','customer-scope-filter','customer-owner-filter','customer-country-filter','customer-industry-filter','customer-state-filter','customer-contact-filter','customer-meta','customer-table-body','customer-empty','load-more',
  'review-model','review-empty','review-workspace','review-customer-name','review-customer-facts','contact-select','generate-draft','research-option','research-website','draft-loading','draft-result','qualification-badge','qualification-title','qualification-reason','profile-facts','customer-profile','recommended-products','draft-warnings','model-name','email-subject','email-body','preview-subject','preview-message','signature-team-name','signature-email','signature-website','sync-status','sync-feishu',
  'queue-pending','queue-approved','queue-sent','queue-list','refresh-queue','nav-delivery-count','delivery-today','delivery-total','delivery-delivered','delivery-opened','delivery-clicked','delivery-failed','delivery-webhook-state','delivery-campaign-filter','delivery-period-filter','delivery-period-label','delivery-period-emails','delivery-period-companies','delivery-period-window','delivery-status-filter','delivery-sort','delivery-list-eyebrow','delivery-list-title','delivery-list-note','delivery-slot-list','delivery-empty','refresh-delivery','toggle-delivery-slots','toggle-delivery-slots-label','second-touch-state','second-touch-eligible','second-touch-queued','second-touch-sent','second-touch-remaining','screening-batch-select','screening-researched','screening-qualified','screening-excluded','screening-pending','screening-contacts-found','screening-contacts-created','screening-queued-companies','screening-queued-emails','integration-list','check-integrations','password-settings-form','current-password','new-password','confirm-password','password-settings-status','relay-settings-form','relay-key-status','relay-base-url','relay-model','relay-api-style','relay-reasoning','relay-api-key','relay-web-search','relay-admin-token','relay-settings-status','mimo-settings-form','mimo-connection-state','mimo-base-url','mimo-model','mimo-api-key','mimo-enabled','mimo-admin-token','mimo-settings-status','mailbox-settings-form','mailbox-connection-state','mailbox-host','mailbox-port','mailbox-username','mailbox-folder','mailbox-password','mailbox-secure','mailbox-enabled','mailbox-admin-token','mailbox-settings-status','daily-company-form','daily-company-limit','daily-company-status','daily-email-limit','emails-queued-today','marketing-toggle','marketing-toggle-label','marketing-toggle-status','apollo-research-toggle','apollo-research-toggle-label','apollo-research-toggle-status','email-sending-toggle','email-sending-toggle-label','email-sending-toggle-status','companies-marketed-today','companies-researched-today','companies-researched-total','feishu-research-audit-card','feishu-research-audit','research-remaining-today','emails-remaining-today','automation-refresh-status','nav-inbox-count','inbox-monitor-state','poll-inbox','inbox-inquiries','inbox-potential','inbox-ordinary','inbox-ai-classified','inbox-matched','inbox-auto-replies','inbox-bounces','inbox-unmatched','inbox-classification-filter','refresh-inbox','inbox-inquiry-count','inbox-inquiry-list','inbox-inquiry-empty','inbox-other-count','inbox-other-list','inbox-other-empty',
  'customer-drawer','drawer-code','drawer-name','drawer-website','drawer-facts','drawer-contacts','drawer-generate',
  'email-detail-drawer','email-detail-subject','email-detail-status','email-detail-company','email-detail-recipient','email-detail-time','email-detail-message-id','email-detail-frame','email-detail-empty','toast',
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const viewNames = { dashboard: '营销总览', customers: '客户池', review: 'AI 草稿预览', queue: '发送队列', delivery: '邮件状态', inbox: '询盘回复', templates: '邮件模板', guide: '使用说明', integrations: '系统连接' };
const sortLabels = { company: '公司', owner: '所属人', country: '国家/地区', state: '客户状态', industry: '行业', contact: '主联系人', lastTrack: '最后跟进' };
const capabilityInfo = [
  { key: 'fumeng', name: '孚盟 CRM', symbol: 'FM', detail: '客户与联系人数据源' },
  { key: 'apollo', name: 'Apollo', symbol: 'AP', detail: '公司、联系人与邮箱补全' },
  { key: 'fumengWriteback', name: '孚盟回填', symbol: '↺', detail: '只回填空字段和新联系人' },
  { key: 'openai', name: 'AI 中转站', symbol: 'AI', detail: 'OpenAI 兼容模型，用于画像和邮件草稿' },
  { key: 'deliveryTracking', name: 'Brevo 状态回传', symbol: 'BR', detail: '送达、打开、点击、退信与停止事件' },
  { key: 'mailbox', name: '阿里邮箱收件监控', symbol: 'IM', detail: '识别客户回复并自动停止后续营销' },
  { key: 'inboxAi', name: '小米 MiMo 询盘识别', symbol: 'MI', detail: '分析回复意图、置信度与客户需求' },
  { key: 'signature', name: '邮件身份', symbol: '@', detail: 'marketing@kulon.com 与团队签名' },
  { key: 'automation', name: 'n8n 调度', symbol: 'N8', detail: '定时选客、补全、排队与触发发送' },
  { key: 'productImages', name: '具体型号产品图', symbol: 'PI', detail: '每个报价型号对应一张实物图' },
  { key: 'sending', name: 'Brevo 发送', symbol: '→', detail: '发送开关和每日限额均已配置时才可执行' },
];

const inboxClassifications = {
  inquiry: { label: '明确询盘', tone: 'success' },
  potential_interest: { label: '潜在意向', tone: 'warning' },
  ordinary_reply: { label: '普通回复', tone: 'info' },
  opt_out: { label: '拒绝 / 退订', tone: 'danger' },
  auto_reply: { label: '自动回复', tone: 'warning' },
  bounce: { label: '退信通知', tone: 'danger' },
  unrelated: { label: '无关邮件', tone: 'info' },
  unmatched: { label: '未匹配', tone: 'info' },
};

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && body.error?.code === 'WEB_LOGIN_REQUIRED') {
      location.replace('/login.html');
      throw new Error('登录已失效，正在跳转');
    }
    const error = new Error(body.error?.message || `请求失败（${response.status}）`);
    error.code = body.error?.code;
    error.details = body.error?.details;
    throw error;
  }
  return body;
}

function settingsHeaders() {
  return state.settingsAdminToken ? { 'x-settings-token': state.settingsAdminToken } : {};
}

function setHidden(element, hidden) { element?.classList.toggle('hidden', hidden); }
function text(value, fallback = '-') { return value === undefined || value === null || value === '' ? fallback : String(value); }
function toast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.dataset.type = type;
  setHidden(elements.toast, false);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => setHidden(elements.toast, true), 4200);
}

function goTo(view, { updateHash = true } = {}) {
  const target = viewNames[view] ? view : 'dashboard';
  document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.viewPanel === target));
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === target;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  elements['page-breadcrumb'].textContent = viewNames[target];
  document.title = `${viewNames[target]} · KULON`;
  if (updateHash) history.replaceState(null, '', `#${target}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function customerIsEligible(customer) { return !['3', '5', '6'].includes(String(customer.customerStateId || '').trim()); }
function customerStateClass(customer) {
  if (customerIsEligible(customer)) return 'eligible';
  if (['5', '6'].includes(String(customer.customerStateId))) return 'blocked';
  return 'closed';
}

function renderDashboard() {
  const eligible = state.customers.filter(customerIsEligible);
  elements['metric-customers'].textContent = state.total ? state.total.toLocaleString() : state.customers.length.toLocaleString();
  elements['metric-customer-note'].textContent = state.demoMode ? '示例数据，不读取孚盟' : `当前已加载 ${state.customers.length} 条`;
  elements['metric-researched-total'].textContent = Number(state.marketingSettings?.companiesResearchedTotal || 0).toLocaleString();
  elements['metric-marketed-total'].textContent = Number(state.marketingSettings?.companiesMarketedTotal || 0).toLocaleString();
  elements['metric-candidates'].textContent = eligible.length.toLocaleString();
  elements['metric-marketed'].textContent = String(state.marketingSettings?.companiesMarketedToday || 0);
  const queued = state.queue.summary?.queued || 0;
  const attention = state.queue.summary?.byStatus?.needs_attention || 0;
  elements['metric-review'].textContent = String(queued);
  elements['process-customers'].textContent = String(eligible.length);
  elements['process-ai'].textContent = String(state.queue.summary?.enriched || 0);
  elements['process-review'].textContent = String(queued + attention);
  elements['metric-sent'].textContent = String(state.marketingSettings?.emailsSentToday ?? state.delivery.summary?.sentToday ?? 0);
  elements['metric-pending'].textContent = String(state.queue.summary?.pendingToday || 0);
  elements['metric-excluded'].textContent = String(state.queue.summary?.excludedToday || 0);
  elements['process-results'].textContent = String(state.delivery.summary?.eventTotal || 0);
  elements['nav-customer-count'].textContent = String(state.customers.length);

  const buildScreeningRow = (item, tone = '') => {
    const row = document.createElement('div'); row.className = `screening-row ${tone}`.trim();
    const company = document.createElement('div'); company.className = 'screening-company';
    const name = document.createElement('strong'); name.textContent = text(item.companyName, '未命名客户');
    const meta = document.createElement('small'); meta.textContent = [item.country, item.contactEmail].filter(Boolean).join(' · ') || text(item.customerId); company.append(name, meta);
    const reason = document.createElement('p'); reason.textContent = text(item.reason, '未说明原因');
    const time = document.createElement('time'); time.textContent = formatEventTime(item.createdAt); time.dateTime = item.createdAt || '';
    row.append(company, reason, time); return row;
  };

  const pending = state.queue.pending || [];
  elements['pending-summary'].textContent = pending.length
    ? `今日待补全 ${state.queue.summary?.pendingToday || pending.length} 家`
    : '暂无待补全记录';
  if (!pending.length) {
    elements['pending-list'].innerHTML = '<div class="empty-inline"><strong>今天没有待补全客户</strong><p>缺少联系人、邮箱未验证或资料待核验的目标客户会显示在这里。</p></div>';
  } else {
    elements['pending-list'].replaceChildren(...pending.map((item) => buildScreeningRow(item, 'pending')));
  }

  const exclusions = state.queue.exclusions || [];
  elements['excluded-summary'].textContent = exclusions.length
    ? `今日排除 ${state.queue.summary?.excludedToday || exclusions.length} 家`
    : '暂无排除记录';
  if (!exclusions.length) {
    elements['excluded-list'].innerHTML = '<div class="empty-inline"><strong>今天还没有明确排除客户</strong><p>只有可靠证据确认业务不相关的客户才会显示在这里。</p></div>';
  } else {
    elements['excluded-list'].replaceChildren(...exclusions.map((item) => buildScreeningRow(item, 'excluded')));
  }

  const priority = eligible.slice(0, 5);
  if (!priority.length) {
    elements['priority-list'].innerHTML = '<div class="empty-inline"><strong>暂无可营销客户</strong><p>同步孚盟或调整客户状态后再试。</p></div>';
  } else {
    elements['priority-list'].replaceChildren(...priority.map((customer, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'priority-item';
      const company = document.createElement('span'); company.className = 'priority-company';
      const name = document.createElement('strong'); name.textContent = text(customer.companyName, '未命名客户');
      const code = document.createElement('small'); code.textContent = [text(customer.billCode, customer.id), customer.ownerName].filter(Boolean).join(' · '); company.append(name, code);
      const location = document.createElement('span'); location.textContent = text(customer.country || customer.countryId);
      const stage = document.createElement('span'); stage.textContent = text(customer.customerState, '未填写状态');
      const rank = document.createElement('b'); rank.textContent = String(index + 1).padStart(2, '0');
      button.append(company, location, stage, rank); button.addEventListener('click', () => openCustomer(customer));
      return button;
    }));
  }
}

function renderSystemStatus() {
  if (!state.health) return;
  const capabilities = state.health.capabilities || {};
  elements['system-status-list'].replaceChildren(...capabilityInfo.slice(0, 4).map((item) => {
    const apolloPaused = item.key === 'apollo' && capabilities.apolloConfigured && state.health.marketing?.researchEnabled === false;
    const row = document.createElement('div'); row.className = 'status-item';
    const dot = document.createElement('span'); dot.className = `status-dot ${capabilities[item.key] ? 'ready' : 'missing'}`;
    const name = document.createElement('span'); name.textContent = item.name;
    const status = document.createElement('small'); status.textContent = capabilities[item.key] ? '已连接' : apolloPaused ? '已暂停' : '待配置';
    row.append(dot, name, status); return row;
  }));
  elements['review-model'].textContent = state.demoMode ? 'synthetic-preview' : state.health.model || '模型待配置';
  elements['integration-list'].replaceChildren(...capabilityInfo.map((item) => {
    const brevoBlocked = item.key === 'sending' && state.health.brevo?.ok === false;
    const apolloPaused = item.key === 'apollo' && capabilities.apolloConfigured && state.health.marketing?.researchEnabled === false;
    const ready = item.key === 'sending'
      ? Boolean(capabilities[item.key] && capabilities.productImages && !brevoBlocked)
      : Boolean(capabilities[item.key]);
    const row = document.createElement('div'); row.className = 'integration-row';
    const symbol = document.createElement('span'); symbol.className = 'integration-symbol'; symbol.textContent = item.symbol;
    const identity = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = item.name;
    const sub = document.createElement('small'); sub.textContent = item.key === 'openai' ? text(state.health.model, item.detail) : item.detail; identity.append(title, sub);
    const description = document.createElement('p');
    description.textContent = ready
      ? item.key === 'productImages'
        ? `已发现 ${state.health.productImages?.availableCount || 0} 个具体型号图片。`
        : '配置完整，服务可调用。'
      : apolloPaused
        ? state.health.marketing?.researchPauseReason === 'apollo_credits_exhausted'
          ? 'Apollo 额度已耗尽，新增背调已自动暂停；邮件发送不受影响。'
          : 'Apollo 背调已暂停；邮件发送不受影响。'
      : brevoBlocked
        ? text(state.health.brevo.message, 'Brevo 账户授权检查失败。')
        : item.key === 'productImages'
        ? '尚未上传具体型号图片，营销会暂停在背调前。'
        : item.key === 'sending' && !capabilities.productImages
          ? '具体型号图片未准备完成，实际发送会被拦截。'
          : item.key === 'sending'
            ? '正式发送开关仍关闭。'
            : '请在本机 .env 中完成配置。';
    const status = document.createElement('span'); status.className = `connection-state ${ready ? 'ready' : 'missing'}`; status.textContent = ready ? '● 已连接' : apolloPaused ? '○ 已暂停' : brevoBlocked ? '○ 授权受阻' : '○ 未连接';
    row.append(symbol, identity, description, status); return row;
  }));
  setHidden(elements['research-option'], !capabilities.webSearch);
  elements['sync-feishu'].disabled = !capabilities.feishu || state.demoMode;
}

function renderRelaySettings(settings) {
  if (!settings || !elements['relay-base-url']) return;
  state.relaySettings = settings;
  elements['relay-base-url'].value = settings.baseUrl || '';
  elements['relay-model'].value = settings.model || '';
  elements['relay-api-style'].value = settings.apiStyle || 'chat_completions';
  elements['relay-reasoning'].value = settings.reasoningEffort || 'low';
  elements['relay-web-search'].checked = Boolean(settings.webSearchEnabled);
  elements['relay-key-status'].textContent = settings.apiKey || '未配置';
  elements['relay-key-status'].className = `connection-state ${settings.apiKeyConfigured ? 'ready' : 'missing'}`;
}

function renderMiMoSettings(settings) {
  if (!settings || !elements['mimo-base-url']) return;
  state.mimoSettings = settings;
  elements['mimo-base-url'].value = settings.baseUrl || 'https://token-plan-cn.xiaomimimo.com/v1';
  elements['mimo-model'].value = settings.model || 'mimo-v2.5-pro';
  elements['mimo-enabled'].checked = settings.enabled === true;
  elements['mimo-api-key'].value = '';
  elements['mimo-api-key'].placeholder = settings.apiKeyConfigured
    ? 'Key 已配置；留空保持不变'
    : '请输入 Xiaomi MiMo API Key';
  const ready = settings.enabled && settings.configured;
  elements['mimo-connection-state'].className = `connection-state ${ready ? 'ready' : 'missing'}`;
  elements['mimo-connection-state'].textContent = ready
    ? `● ${settings.model} 已启用`
    : settings.configured ? '○ 已配置未开启' : '○ 未配置';
}

async function loadMiMoSettings() {
  if (state.demoMode) return;
  try { renderMiMoSettings(await api('/api/settings/mimo', { headers: settingsHeaders() })); }
  catch (error) { elements['mimo-settings-status'].textContent = error.message; }
}

async function saveMiMoSettings(event) {
  event.preventDefault();
  const submit = event.submitter;
  const desiredEnabled = elements['mimo-enabled'].checked;
  const apiKey = elements['mimo-api-key'].value.trim();
  const adminToken = elements['mimo-admin-token'].value.trim();
  const body = {
    baseUrl: elements['mimo-base-url'].value.trim(),
    model: elements['mimo-model'].value,
    ...(apiKey ? { apiKey } : {}),
  };
  if (submit) submit.disabled = true;
  state.settingsAdminToken = adminToken || state.settingsAdminToken;
  elements['mimo-settings-status'].textContent = desiredEnabled ? '正在保存并测试 MiMo...' : '正在关闭智能识别...';
  try {
    let settings = await api('/api/settings/mimo', {
      method: 'PUT', headers: settingsHeaders(), body: JSON.stringify({ ...body, enabled: false }),
    });
    if (desiredEnabled) {
      const tested = await api('/api/settings/mimo/test', { method: 'POST', headers: settingsHeaders(), body: '{}' });
      if (!tested.modelAvailable) {
        throw new Error(`MiMo 连接成功，但账号模型列表中没有 ${body.model}`);
      }
      settings = await api('/api/settings/mimo', {
        method: 'PUT', headers: settingsHeaders(), body: JSON.stringify({ enabled: true }),
      });
      elements['mimo-settings-status'].textContent = '连接成功，自动识别已开启；历史邮件将在后台重新判断';
      toast('小米 MiMo 询盘识别已开启', 'success');
    } else {
      elements['mimo-settings-status'].textContent = '智能识别已关闭，邮件仍会使用保守规则分类';
      toast('小米 MiMo 询盘识别已关闭', 'success');
    }
    renderMiMoSettings(settings);
    await checkHealth();
    await loadInbox();
  } catch (error) {
    elements['mimo-enabled'].checked = false;
    elements['mimo-settings-status'].textContent = `${error.message}；智能识别未开启`;
    toast(error.message, 'error');
    await loadMiMoSettings();
  } finally {
    elements['mimo-api-key'].value = '';
    if (submit) submit.disabled = false;
  }
}

function renderMailboxSettings(settings) {
  if (!settings || !elements['mailbox-host']) return;
  state.mailboxSettings = settings;
  elements['mailbox-host'].value = settings.host || 'imap.qiye.aliyun.com';
  elements['mailbox-port'].value = String(settings.port || 993);
  elements['mailbox-username'].value = settings.username || 'marketing@kulon.com';
  elements['mailbox-folder'].value = settings.folder || 'INBOX';
  elements['mailbox-secure'].checked = settings.secure !== false;
  elements['mailbox-enabled'].checked = settings.enabled === true;
  elements['mailbox-password'].value = '';
  elements['mailbox-password'].placeholder = settings.passwordConfigured
    ? '授权码已加密保存；留空保持不变'
    : '请输入阿里邮箱客户端授权码';
  const ready = settings.configured && settings.enabled;
  elements['mailbox-connection-state'].className = `connection-state ${ready ? 'ready' : 'missing'}`;
  elements['mailbox-connection-state'].textContent = ready ? '● 监控已开启' : settings.configured ? '○ 已配置未开启' : '○ 未配置';
}

async function loadMailboxSettings() {
  if (state.demoMode) return;
  try { renderMailboxSettings(await api('/api/settings/mailbox', { headers: settingsHeaders() })); }
  catch (error) { elements['mailbox-settings-status'].textContent = error.message; }
}

async function saveMailboxSettings(event) {
  event.preventDefault();
  const submit = event.submitter;
  const desiredEnabled = elements['mailbox-enabled'].checked;
  const password = elements['mailbox-password'].value;
  const adminToken = elements['mailbox-admin-token'].value.trim();
  const body = {
    host: elements['mailbox-host'].value.trim(),
    port: Number(elements['mailbox-port'].value),
    username: elements['mailbox-username'].value.trim(),
    folder: elements['mailbox-folder'].value.trim(),
    secure: elements['mailbox-secure'].checked,
    ...(password ? { password } : {}),
  };
  if (submit) submit.disabled = true;
  elements['mailbox-settings-status'].textContent = desiredEnabled ? '正在保存并测试连接...' : '正在保存...';
  try {
    state.settingsAdminToken = adminToken || state.settingsAdminToken;
    let settings = await api('/api/settings/mailbox', {
      method: 'PUT', headers: settingsHeaders(), body: JSON.stringify({ ...body, enabled: false }),
    });
    const tested = await api('/api/settings/mailbox/test', { method: 'POST', headers: settingsHeaders(), body: '{}' });
    if (desiredEnabled) {
      settings = await api('/api/settings/mailbox', {
        method: 'PUT', headers: settingsHeaders(), body: JSON.stringify({ enabled: true }),
      });
      elements['mailbox-settings-status'].textContent = `连接成功，${tested.messages} 封邮件可读取；自动监控已开启`;
      toast('阿里邮箱连接成功，收件监控已开启', 'success');
    } else {
      elements['mailbox-settings-status'].textContent = `连接成功，${tested.messages} 封邮件可读取；自动监控保持关闭`;
      toast('邮箱配置已保存，连接测试成功', 'success');
    }
    renderMailboxSettings(settings);
    await checkHealth();
    await loadInbox();
  } catch (error) {
    elements['mailbox-enabled'].checked = false;
    elements['mailbox-settings-status'].textContent = `${error.message}；监控未开启`;
    toast(error.message, 'error');
  } finally {
    elements['mailbox-password'].value = '';
    if (submit) submit.disabled = false;
  }
}

function renderMarketingSettings(settings) {
  if (!settings) return;
  state.marketingSettings = settings;
  elements['daily-company-limit'].value = String(settings.dailyCompanyLimit || 300);
  elements['daily-email-limit'].textContent = String(settings.dailySendLimit || 300);
  elements['companies-marketed-today'].textContent = String(settings.companiesMarketedToday || 0);
  elements['metric-marketed'].textContent = String(settings.companiesMarketedToday || 0);
  elements['emails-queued-today'].textContent = String(settings.emailsAllocatedToday || 0);
  elements['companies-researched-today'].textContent = String(settings.companiesPreparedToday || 0);
  elements['companies-researched-total'].textContent = String(settings.companiesResearchedTotal || 0);
  elements['metric-researched-total'].textContent = Number(settings.companiesResearchedTotal || 0).toLocaleString();
  elements['metric-marketed-total'].textContent = Number(settings.companiesMarketedTotal || 0).toLocaleString();
  const apolloResearch = Number(settings.apolloResearchToday || 0);
  const feishuRecorded = Number(settings.feishuResearchRecordedToday || 0);
  const missingResearchRecords = Number(settings.feishuResearchMissingToday || 0);
  elements['feishu-research-audit'].textContent = `${feishuRecorded} / ${apolloResearch}`;
  elements['feishu-research-audit-card'].classList.toggle('has-error', missingResearchRecords > 0);
  elements['feishu-research-audit-card'].title = missingResearchRecords > 0
    ? `${missingResearchRecords} 条 Apollo 背调尚未完成飞书留痕，可能正在处理或等待中断恢复`
    : '今天所有 Apollo 背调均已写入飞书';
  elements['research-remaining-today'].textContent = String(settings.remainingResearchToday || 0);
  elements['emails-remaining-today'].textContent = String(settings.remainingEmailsToday || 0);
  const enabled = settings.enabled !== false;
  elements['marketing-toggle'].classList.toggle('is-active', enabled);
  elements['marketing-toggle'].classList.toggle('is-paused', !enabled);
  elements['marketing-toggle'].setAttribute('aria-pressed', String(enabled));
  elements['marketing-toggle'].setAttribute('aria-label', enabled ? '暂停自动营销' : '开启自动营销');
  elements['marketing-toggle-label'].textContent = enabled ? '暂停营销' : '开启营销';
  elements['marketing-toggle-status'].textContent = enabled
    ? settings.researchEnabled === false && settings.sendingEnabled === true
      ? '运行中：背调暂停，只发送现有队列'
      : '当前已开启，后台会继续运行'
    : '当前已暂停，不会新增背调或发送';
  const researchEnabled = settings.researchEnabled !== false;
  const creditsExhausted = settings.researchPauseReason === 'apollo_credits_exhausted';
  elements['apollo-research-toggle'].classList.toggle('is-active', researchEnabled);
  elements['apollo-research-toggle'].classList.toggle('is-paused', !researchEnabled);
  elements['apollo-research-toggle'].setAttribute('aria-pressed', String(researchEnabled));
  elements['apollo-research-toggle'].setAttribute('aria-label', researchEnabled ? '暂停 Apollo 背调' : '开启 Apollo 背调');
  elements['apollo-research-toggle-label'].textContent = researchEnabled ? '暂停背调' : '开启背调';
  elements['apollo-research-toggle-status'].textContent = researchEnabled
    ? enabled ? '已开启，会继续调用 Apollo' : '已开启，但营销总开关关闭'
    : creditsExhausted ? '额度已耗尽，已自动暂停；发信继续' : '已暂停，不会消耗 Apollo 额度';
  const sendingEnabled = settings.sendingEnabled === true;
  const brevoBlocked = state.health?.brevo?.ok === false;
  elements['email-sending-toggle'].classList.toggle('is-active', sendingEnabled);
  elements['email-sending-toggle'].classList.toggle('is-paused', !sendingEnabled);
  elements['email-sending-toggle'].setAttribute('aria-pressed', String(sendingEnabled));
  elements['email-sending-toggle'].setAttribute('aria-label', sendingEnabled ? '暂停邮箱发送' : '开启邮箱发送');
  elements['email-sending-toggle-label'].textContent = sendingEnabled ? '暂停发信' : '开启发信';
  elements['email-sending-toggle-status'].textContent = sendingEnabled
    ? (brevoBlocked
      ? text(state.health.brevo.message, 'Brevo 授权受阻，队列已保留')
      : enabled ? '已开启，排期到期后会调用 Brevo 发送' : '已开启，但营销总开关关闭，暂不会发送')
    : '当前已关闭，不会真正发信';
  document.querySelectorAll('[data-daily-limit]').forEach((element) => {
    element.textContent = String(settings.dailySendLimit || 300);
  });
}

async function saveMarketingSettings(event) {
  event.preventDefault();
  const dailyCompanyLimit = Number(elements['daily-company-limit'].value);
  elements['daily-company-status'].textContent = '保存中...';
  try {
    const settings = await api('/api/settings/marketing', {
      method: 'PUT', headers: settingsHeaders(),
      body: JSON.stringify({ dailyCompanyLimit }),
    });
    renderMarketingSettings(settings);
    elements['daily-company-status'].textContent = '已保存，下一次营销运行立即使用';
    await checkHealth();
    toast('每日营销公司数已更新', 'success');
  } catch (error) {
    elements['daily-company-status'].textContent = error.message;
    toast(error.message, 'error');
  }
}

async function loadMarketingSettings() {
  if (state.demoMode) return;
  try {
    renderMarketingSettings(await api('/api/settings/marketing', { headers: settingsHeaders() }));
    if (elements['daily-company-status']) elements['daily-company-status'].textContent = '';
  }
  catch (error) { if (elements['daily-company-status']) elements['daily-company-status'].textContent = error.message; }
}

async function toggleMarketing() {
  const current = state.marketingSettings?.enabled !== false;
  const next = !current;
  elements['marketing-toggle'].disabled = true;
  elements['marketing-toggle-status'].textContent = next ? '正在开启后台营销...' : '正在暂停后台营销...';
  try {
    const settings = await api('/api/settings/marketing', {
      method: 'PUT', headers: settingsHeaders(),
      body: JSON.stringify({
        dailyCompanyLimit: Number(elements['daily-company-limit'].value),
        enabled: next,
        sendingEnabled: state.marketingSettings?.sendingEnabled === true,
      }),
    });
    renderMarketingSettings(settings);
    if (elements['daily-company-status']) elements['daily-company-status'].textContent = next
      ? '营销已开启，正在准备今天的首封营销'
      : '营销已暂停，现有队列已保留';
    await checkHealth();
    toast(next ? '自动营销已开启' : '自动营销已暂停', 'success');
  } catch (error) {
    elements['marketing-toggle-status'].textContent = error.message;
    toast(error.message, 'error');
  } finally {
    elements['marketing-toggle'].disabled = false;
  }
}

async function toggleEmailSending() {
  const current = state.marketingSettings?.sendingEnabled === true;
  const next = !current;
  elements['email-sending-toggle'].disabled = true;
  elements['email-sending-toggle-status'].textContent = next ? '正在开启 Brevo 发信...' : '正在暂停 Brevo 发信...';
  try {
    const settings = await api('/api/settings/marketing', {
      method: 'PUT', headers: settingsHeaders(),
      body: JSON.stringify({
        dailyCompanyLimit: Number(elements['daily-company-limit'].value),
        enabled: state.marketingSettings?.enabled === true,
        sendingEnabled: next,
      }),
    });
    renderMarketingSettings(settings);
    await checkHealth();
    toast(next ? '邮箱发送已开启' : '邮箱发送已暂停', 'success');
  } catch (error) {
    elements['email-sending-toggle-status'].textContent = error.message;
    toast(error.message, 'error');
  } finally {
    elements['email-sending-toggle'].disabled = false;
  }
}

async function toggleApolloResearch() {
  const current = state.marketingSettings?.researchEnabled !== false;
  const next = !current;
  elements['apollo-research-toggle'].disabled = true;
  elements['apollo-research-toggle-status'].textContent = next ? '正在恢复 Apollo 背调...' : '正在暂停 Apollo 背调...';
  try {
    const settings = await api('/api/settings/marketing', {
      method: 'PUT', headers: settingsHeaders(),
      body: JSON.stringify({
        dailyCompanyLimit: Number(elements['daily-company-limit'].value),
        enabled: state.marketingSettings?.enabled === true,
        researchEnabled: next,
        sendingEnabled: state.marketingSettings?.sendingEnabled === true,
      }),
    });
    renderMarketingSettings(settings);
    await checkHealth();
    toast(next ? 'Apollo 背调已恢复' : 'Apollo 背调已暂停，发送队列继续保留', 'success');
  } catch (error) {
    elements['apollo-research-toggle-status'].textContent = error.message;
    toast(error.message, 'error');
  } finally {
    elements['apollo-research-toggle'].disabled = false;
  }
}

async function loadRelaySettings() {
  if (state.demoMode) return;
  try { renderRelaySettings(await api('/api/settings/relay', { headers: settingsHeaders() })); }
  catch (error) { elements['relay-settings-status'].textContent = error.message; }
}

async function saveRelaySettings(event) {
  event.preventDefault();
  const apiKey = elements['relay-api-key'].value.trim();
  const adminToken = elements['relay-admin-token'].value.trim();
  const body = {
    baseUrl: elements['relay-base-url'].value.trim(),
    model: elements['relay-model'].value.trim(),
    apiStyle: elements['relay-api-style'].value,
    reasoningEffort: elements['relay-reasoning'].value,
    webSearchEnabled: elements['relay-web-search'].checked,
    ...(apiKey ? { apiKey } : {}),
  };
  elements['relay-settings-status'].textContent = '保存中...';
  try {
    state.settingsAdminToken = adminToken;
    const settings = await api('/api/settings/relay', { method: 'PUT', headers: settingsHeaders(), body: JSON.stringify(body) });
    elements['relay-api-key'].value = '';
    elements['relay-settings-status'].textContent = '已保存，立即对新草稿生效';
    renderRelaySettings(settings);
    await checkHealth();
    toast('中转站配置已更新', 'success');
  } catch (error) { elements['relay-settings-status'].textContent = error.message; toast(error.message, 'error'); }
}

async function logout() {
  elements['logout-button'].disabled = true;
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    location.replace('/login.html');
  }
}

async function savePassword(event) {
  event.preventDefault();
  const currentPassword = elements['current-password'].value;
  const newPassword = elements['new-password'].value;
  const confirmPassword = elements['confirm-password'].value;
  if (newPassword !== confirmPassword) {
    elements['password-settings-status'].textContent = '两次输入的新密码不一致';
    elements['confirm-password'].focus();
    return;
  }
  const submit = event.submitter;
  if (submit) submit.disabled = true;
  elements['password-settings-status'].textContent = '正在更新...';
  try {
    await api('/api/auth/password', {
      method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }),
    });
    event.currentTarget.reset();
    elements['password-settings-status'].textContent = '密码已更新，本设备保持登录';
    toast('网页登录密码已更新', 'success');
  } catch (error) {
    elements['password-settings-status'].textContent = error.message;
    toast(error.message, 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
}

function filteredCustomers() {
  const query = elements['customer-search'].value.trim().toLowerCase();
  const scopeFilter = elements['customer-scope-filter'].value;
  const ownerFilter = elements['customer-owner-filter'].value;
  const countryFilter = elements['customer-country-filter'].value;
  const industryFilter = elements['customer-industry-filter'].value;
  const stateFilter = elements['customer-state-filter'].value;
  const contactFilter = elements['customer-contact-filter'].value;
  return state.customers.filter((customer) => {
    const haystack = [customer.companyName, customer.billCode, customer.ownerName, customer.country, customer.industry, customer.mainContactName].filter(Boolean).join(' ').toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (state.demoMode && scopeFilter === 'public' && customer.ownerName !== '公海客户') return false;
    if (state.demoMode && scopeFilter === 'private' && customer.ownerName === '公海客户') return false;
    if (ownerFilter !== 'all' && customer.ownerName !== ownerFilter) return false;
    if (countryFilter !== 'all' && customer.country !== countryFilter) return false;
    if (industryFilter !== 'all' && String(customer.industry) !== industryFilter) return false;
    if (stateFilter === 'eligible' && !customerIsEligible(customer)) return false;
    if (stateFilter === 'missing' && customer.customerStateId) return false;
    if (!['eligible', 'all', 'missing'].includes(stateFilter) && String(customer.customerStateId) !== stateFilter) return false;
    if (contactFilter === 'email' && !customer.mainContactEmail) return false;
    if (contactFilter === 'missing' && customer.mainContactEmail) return false;
    return true;
  });
}

function updateCategoryFilter(id, label, values) {
  const select = elements[id];
  const current = select.value;
  const options = [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  select.replaceChildren(new Option(label, 'all'), ...options.map((value) => new Option(value, value)));
  select.value = options.includes(current) ? current : 'all';
}

function sortDemoCustomers(customers) {
  if (state.sortBy === 'modified') return customers;
  const fields = {
    company: 'companyName', owner: 'ownerName', country: 'country', state: 'customerState',
    industry: 'industry', contact: 'mainContactName', lastTrack: 'lastTrackDate',
  };
  const field = fields[state.sortBy];
  const direction = state.sortDirection === 'asc' ? 1 : -1;
  return [...customers].sort((left, right) => text(left[field], '').localeCompare(text(right[field], ''), 'zh-CN', { numeric: true }) * direction);
}

function updateSortHeaders() {
  document.querySelectorAll('[data-sort-column]').forEach((header) => {
    const key = header.dataset.sortColumn;
    const active = key === state.sortBy;
    header.setAttribute('aria-sort', active ? (state.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    const icon = header.querySelector('.sort-button i');
    if (icon) icon.textContent = active ? (state.sortDirection === 'asc' ? '↑' : '↓') : '↕';
    header.querySelector('.sort-button')?.classList.toggle('is-active', active);
  });
}

function renderCustomers() {
  updateCategoryFilter('customer-owner-filter', '全部所属人', state.customers.map((item) => item.ownerName));
  updateCategoryFilter('customer-country-filter', '全部国家/地区', state.customers.map((item) => item.country));
  updateCategoryFilter('customer-industry-filter', '全部行业', state.customers.map((item) => item.industry));
  const customers = state.demoMode ? sortDemoCustomers(filteredCustomers()) : filteredCustomers();
  const sortSummary = sortLabels[state.sortBy] ? ` · ${sortLabels[state.sortBy]}${state.sortDirection === 'asc' ? '升序' : '降序'}` : '';
  elements['customer-meta'].textContent = `显示 ${customers.length} · 已加载 ${state.customers.length} · 实时总量 ${state.total.toLocaleString()}${sortSummary}`;
  elements['customer-empty'].classList.toggle('hidden', customers.length > 0);
  elements['customer-table-body'].replaceChildren(...customers.map((customer) => {
    const row = document.createElement('tr');
    const company = document.createElement('td'); company.className = 'company-cell';
    const name = document.createElement('strong'); name.textContent = text(customer.companyName, '未命名客户');
    const code = document.createElement('small'); code.textContent = text(customer.billCode, customer.id); company.append(name, code);
    const owner = document.createElement('td'); owner.textContent = text(customer.ownerName);
    const country = document.createElement('td'); country.textContent = text(customer.country || customer.countryId);
    const stateCell = document.createElement('td'); const pill = document.createElement('span'); pill.className = `state-pill ${customerStateClass(customer)}`; pill.textContent = text(customer.customerState || customer.customerStateId, '未填写'); stateCell.append(pill);
    const industry = document.createElement('td'); industry.textContent = text(customer.industry);
    const contact = document.createElement('td'); contact.className = 'contact-cell';
    const contactName = document.createElement('strong'); contactName.textContent = text(customer.mainContactName, '未填写');
    const email = document.createElement('small'); email.textContent = text(customer.mainContactEmail, '主邮箱待补充'); contact.append(contactName, email);
    const lastTrack = document.createElement('td'); lastTrack.textContent = text(customer.lastTrackDate);
    const actionCell = document.createElement('td'); const action = document.createElement('button'); action.type = 'button'; action.className = 'row-action'; action.title = '查看客户'; action.setAttribute('aria-label', `查看 ${customer.companyName}`); action.textContent = '→'; action.addEventListener('click', () => openCustomer(customer)); actionCell.append(action);
    row.append(company, owner, country, stateCell, industry, contact, lastTrack, actionCell); row.addEventListener('dblclick', () => openCustomer(customer)); return row;
  }));
  elements['load-more'].disabled = state.demoMode || state.customers.length >= state.total;
  renderDashboard();
}

async function loadCustomers({ reset = false } = {}) {
  if (state.demoMode) {
    state.customers = demoCustomers; state.total = demoCustomers.length; state.from = demoCustomers.length; renderCustomers(); return;
  }
  if (!state.health?.capabilities?.fumeng) {
    elements['priority-list'].innerHTML = '<div class="empty-inline"><strong>孚盟尚未连接</strong><p>在系统连接中检查本机配置。</p></div>';
    elements['customer-meta'].textContent = '孚盟待配置'; return;
  }
  if (reset) { state.from = 0; state.customers = []; }
  elements['reload-customers'].disabled = true;
  try {
    const scope = elements['customer-scope-filter'].value;
    const result = await api(`/api/customers?from=${state.from}&size=${state.pageSize}&scope=${encodeURIComponent(scope)}&sortBy=${encodeURIComponent(state.sortBy)}&sortDirection=${encodeURIComponent(state.sortDirection)}`);
    state.total = Number(result.total || 0);
    const existing = new Set(state.customers.map((item) => item.id));
    state.customers.push(...(result.items || []).filter((item) => !existing.has(item.id)));
    state.from += (result.items || []).length;
    renderCustomers();
  } catch (error) { toast(error.message, 'error'); }
  finally { elements['reload-customers'].disabled = false; }
}

function makeFact(label, value, className = 'fact') {
  const container = document.createElement('div'); container.className = className;
  const name = document.createElement('span'); name.textContent = label;
  const content = document.createElement('strong'); content.textContent = text(value);
  container.append(name, content); return container;
}

function contactLabel(contact) { return [contact.name || '未命名', contact.jobRole, contact.email || '无邮箱'].filter(Boolean).join(' · '); }

async function openCustomer(customer) {
  state.selectedCustomer = customer; state.contacts = []; state.draftBundle = null;
  elements['drawer-code'].textContent = customer.billCode || customer.id;
  elements['drawer-name'].textContent = text(customer.companyName, '未命名客户');
  elements['drawer-website'].textContent = text(customer.website, '未填写官网'); elements['drawer-website'].removeAttribute('href');
  if (customer.website) elements['drawer-website'].href = /^https?:\/\//i.test(customer.website) ? customer.website : `https://${customer.website}`;
  elements['drawer-facts'].replaceChildren(makeFact('所属人', customer.ownerName, 'drawer-fact'), makeFact('国家/地区', customer.country || customer.countryId, 'drawer-fact'), makeFact('客户状态', customer.customerState || customer.customerStateId || '未填写', 'drawer-fact'), makeFact('行业', customer.industry, 'drawer-fact'), makeFact('最后跟进', customer.lastTrackDate, 'drawer-fact'));
  elements['drawer-contacts'].innerHTML = '<div class="skeleton-row"></div><div class="skeleton-row"></div>';
  setHidden(elements['customer-drawer'], false); document.body.style.overflow = 'hidden';
  try {
    const contacts = state.demoMode ? (demoContacts[customer.id] || []) : (await api(`/api/customers/${encodeURIComponent(customer.id)}/contacts`)).items;
    state.contacts = contacts || [];
    renderDrawerContacts();
  } catch (error) { elements['drawer-contacts'].textContent = error.message; toast(error.message, 'error'); }
}

function renderDrawerContacts() {
  if (!state.contacts.length) { elements['drawer-contacts'].innerHTML = '<div class="empty-inline"><strong>没有可用联系人</strong><p>请先在孚盟补充联系人邮箱。</p></div>'; return; }
  elements['drawer-contacts'].replaceChildren(...state.contacts.map((contact) => {
    const item = document.createElement('div'); item.className = 'drawer-contact';
    const name = document.createElement('strong'); name.textContent = text(contact.name, '未命名联系人');
    const email = document.createElement('span'); email.textContent = text(contact.email, '无邮箱');
    const role = document.createElement('small'); role.textContent = [contact.jobRole, contact.primary ? '主联系人' : '', contact.emailSource === 'fumeng_contact' ? '孚盟邮箱' : ''].filter(Boolean).join(' · '); item.append(name, email, role); return item;
  }));
}

function syncDrawerBodyState() {
  const drawerOpen = !elements['customer-drawer'].classList.contains('hidden')
    || !elements['email-detail-drawer'].classList.contains('hidden');
  document.body.style.overflow = drawerOpen ? 'hidden' : '';
}

function closeDrawer() { setHidden(elements['customer-drawer'], true); syncDrawerBodyState(); }

function openEmailDetail(item) {
  elements['email-detail-subject'].textContent = text(item.subject, '未填写主题');
  elements['email-detail-status'].textContent = item.statusLabel || item.status || '未知状态';
  elements['email-detail-status'].className = `delivery-status ${item.tone || 'info'}`;
  elements['email-detail-company'].textContent = text(item.companyName, '未关联公司');
  elements['email-detail-recipient'].textContent = [item.contactName, item.email].filter(Boolean).join(' · ') || '-';
  elements['email-detail-time'].textContent = formatEventTime(item.lastEventAt);
  elements['email-detail-message-id'].textContent = text(item.messageId, '-');
  elements['email-detail-message-id'].title = item.messageId || '';
  const hasPreview = Boolean(item.emailPreviewAvailable && item.jobId);
  setHidden(elements['email-detail-frame'], !hasPreview);
  setHidden(elements['email-detail-empty'], hasPreview);
  elements['email-detail-frame'].src = hasPreview
    ? `/api/marketing/jobs/${encodeURIComponent(item.jobId)}/email-preview/document`
    : 'about:blank';
  setHidden(elements['email-detail-drawer'], false);
  syncDrawerBodyState();
  elements['email-detail-drawer'].querySelector('.drawer-close')?.focus();
}

function closeEmailDetail() {
  setHidden(elements['email-detail-drawer'], true);
  elements['email-detail-frame'].src = 'about:blank';
  syncDrawerBodyState();
}

function openReviewForCustomer() {
  if (!state.selectedCustomer) return;
  closeDrawer(); goTo('review'); setHidden(elements['review-empty'], true); setHidden(elements['review-workspace'], false); setHidden(elements['draft-result'], true);
  const customer = state.selectedCustomer;
  elements['review-customer-name'].textContent = text(customer.companyName);
  elements['review-customer-facts'].replaceChildren(makeFact('所属人', customer.ownerName), makeFact('国家/地区', customer.country || customer.countryId), makeFact('客户状态', customer.customerState || customer.customerStateId || '未填写'), makeFact('行业', customer.industry), makeFact('官网', customer.website));
  elements['contact-select'].replaceChildren(...state.contacts.map((contact) => new Option(contactLabel(contact), contact.id)));
  const preferred = state.contacts.find((item) => item.id === customer.mainContactId && item.email) || state.contacts.find((item) => item.primary && item.email) || state.contacts.find((item) => item.email);
  if (preferred) elements['contact-select'].value = preferred.id;
  elements['generate-draft'].disabled = !preferred || (!state.demoMode && !state.health?.capabilities?.openai);
  if (!preferred) toast('这个客户没有带邮箱的联系人，请先在孚盟补充', 'error');
}

function addDefinition(list, term, value) { const dt = document.createElement('dt'); const dd = document.createElement('dd'); dt.textContent = term; dd.textContent = text(value); list.append(dt, dd); }
function updateEmailPreview() { elements['preview-subject'].textContent = elements['email-subject'].value.trim() || 'Untitled email'; elements['preview-message'].textContent = elements['email-body'].value.trim(); }

function renderDraft(bundle) {
  const { draft } = bundle;
  elements['qualification-badge'].textContent = draft.qualified ? '建议开发' : '建议暂缓';
  elements['qualification-title'].textContent = draft.qualified ? '可进入自动发送队列' : '暂不进入发送队列';
  elements['qualification-reason'].textContent = text(draft.qualificationReason);
  elements['profile-facts'].replaceChildren(); addDefinition(elements['profile-facts'], '国家 / 区域', `${text(draft.country)} / ${text(draft.region)}`); addDefinition(elements['profile-facts'], '行业', draft.industry); addDefinition(elements['profile-facts'], '客户类型', draft.customerType);
  elements['customer-profile'].textContent = text(draft.customerProfile);
  elements['recommended-products'].replaceChildren(...(draft.recommendedProducts || []).map((product) => { const item = document.createElement('div'); item.className = 'product-item'; const name = document.createElement('strong'); name.textContent = product.name; const reason = document.createElement('p'); reason.textContent = product.reason; item.append(name, reason); return item; }));
  const warnings = [...(draft.riskFlags || []), ...(draft.compliance?.issues || [])];
  if (!warnings.length) elements['draft-warnings'].innerHTML = '<p class="no-warning">自动质检未发现明显风险。</p>';
  else elements['draft-warnings'].replaceChildren(...warnings.map((warning) => { const item = document.createElement('p'); item.textContent = warning; return item; }));
  elements['email-subject'].value = draft.emailSubject || ''; elements['email-body'].value = draft.emailBody || ''; elements['model-name'].textContent = draft.debug?.model || '';
  elements['sync-status'].textContent = state.demoMode ? '示例模式，不写入飞书' : '尚未写入飞书'; elements['sync-feishu'].disabled = state.demoMode || !state.health?.capabilities?.feishu;
  updateEmailPreview(); setHidden(elements['draft-result'], false); renderDashboard();
}

async function generateDraft() {
  if (!state.selectedCustomer) return;
  const contact = state.contacts.find((item) => item.id === elements['contact-select'].value);
  if (!contact?.email) { toast('请选择带邮箱的联系人', 'error'); return; }
  elements['generate-draft'].disabled = true; setHidden(elements['draft-loading'], false); setHidden(elements['draft-result'], true);
  try {
    const bundle = state.demoMode ? makeDemoDraft(state.selectedCustomer, contact) : await api('/api/drafts/generate', { method: 'POST', body: JSON.stringify({ customerId: state.selectedCustomer.id, contactId: contact.id, researchWebsite: elements['research-website'].checked }) });
    state.draftBundle = bundle; renderDraft(bundle);
  } catch (error) { toast(error.message, 'error'); }
  finally { elements['generate-draft'].disabled = false; setHidden(elements['draft-loading'], true); }
}

async function syncFeishu() {
  if (!state.draftBundle || state.demoMode) return;
  state.draftBundle.draft.emailSubject = elements['email-subject'].value.trim(); state.draftBundle.draft.emailBody = elements['email-body'].value.trim();
  elements['sync-feishu'].disabled = true; elements['sync-status'].textContent = '正在写入飞书...';
  try {
    const result = await api('/api/feishu/drafts', { method: 'POST', body: JSON.stringify(state.draftBundle) });
    elements['sync-status'].textContent = `已写入飞书并进入队列 ${result.record?.record_id || ''}`; toast('草稿已写入飞书并进入发送队列', 'success'); await loadQueue();
  } catch (error) { elements['sync-status'].textContent = '写入失败'; toast(error.message, 'error'); }
  finally { elements['sync-feishu'].disabled = false; }
}

function renderSignature() {
  if (!state.signature) return;
  const signature = state.signature; elements['signature-team-name'].textContent = signature.teamName; elements['signature-email'].textContent = signature.email; elements['signature-email'].href = `mailto:${signature.email}`; elements['signature-website'].textContent = signature.websiteLabel; elements['signature-website'].href = signature.website;
}

async function loadQueue() {
  if (state.demoMode) { renderQueue(); return; }
  try { state.queue = await api('/api/marketing?limit=100'); }
  catch (error) { toast(`营销队列读取失败：${error.message}`, 'error'); }
  renderQueue();
}

function renderQueue() {
  const summary = state.queue.summary || {};
  elements['queue-pending'].textContent = String(summary.enriched || 0);
  elements['queue-approved'].textContent = String(summary.queued || 0);
  elements['queue-sent'].textContent = String(summary.sent || 0);
  const jobs = state.queue.items || [];
  const statusLabels = {
    queued: '待发送', retry: '等待重试', processing: '发送中', sent: '已发送',
    needs_attention: '需要检查', failed: '发送失败', cancelled: '已取消',
  };
  if (!jobs.length) elements['queue-list'].innerHTML = '<strong>队列为空</strong><p>n8n 准备完成首个客户后，任务会出现在这里。</p>';
  else elements['queue-list'].replaceChildren(...jobs.map((item) => {
    const row = document.createElement('div'); row.className = 'queue-record';
    const company = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = text(item.companyName);
    const recipient = document.createElement('small'); recipient.textContent = [item.campaign === 'second_touch_v1' ? '第二轮' : '首封', item.contactName, item.email].filter(Boolean).join(' · '); company.append(name, recipient);
    const subject = document.createElement('small');
    const failure = ['failed', 'retry'].includes(item.status) && item.failureReason ? ` · ${item.failureReason}` : '';
    subject.textContent = `${text(item.subject)} · ${text(item.timeZone, 'UTC')} · ${formatEventTime(item.scheduledAt)}${failure}`;
    const status = document.createElement('span');
    const blocked = ['failed', 'cancelled', 'needs_attention'].includes(item.status);
    status.className = `state-pill ${blocked ? 'blocked' : 'eligible'}`;
    status.textContent = statusLabels[item.status] || item.status;
    const preview = document.createElement('a');
    preview.className = 'queue-preview-link';
    preview.href = `/sent-email-preview.html?job=${encodeURIComponent(item.id)}`;
    preview.target = '_blank';
    preview.rel = 'noopener';
    preview.textContent = '查看邮件';
    row.append(company, subject, status, preview); return row;
  }));
  renderDashboard();
}

const DISPLAY_TIME_ZONE = 'Asia/Shanghai';

function formatEventTime(value, { timeZone = DISPLAY_TIME_ZONE } = {}) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function formatSlotClock(value) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function formatDeliverySlot(slotStart) {
  const start = new Date(slotStart);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: DISPLAY_TIME_ZONE, month: '2-digit', day: '2-digit',
  }).format(start);
  return `${date} ${formatSlotClock(start)} - ${formatSlotClock(end)}`;
}

function deliverySlotKey(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? '' : Math.floor(timestamp / (15 * 60 * 1000)) * (15 * 60 * 1000);
}

function deliveryExpansionState() {
  const key = [
    elements['delivery-campaign-filter'].value,
    elements['delivery-period-filter'].value,
    elements['delivery-status-filter'].value,
    elements['delivery-sort'].value,
  ].join('|');
  if (!state.deliveryExpansion.has(key)) {
    state.deliveryExpansion.set(key, {
      initialized: false,
      allSlotsOpen: false,
      openSlots: new Set(),
      openRecords: new Set(),
    });
  }
  return state.deliveryExpansion.get(key);
}

function updateDeliveryExpandButton() {
  const slots = [...elements['delivery-slot-list'].querySelectorAll('.delivery-slot')];
  const allOpen = slots.length > 0 && slots.every((slot) => slot.open);
  elements['toggle-delivery-slots'].disabled = slots.length === 0;
  elements['toggle-delivery-slots'].setAttribute('aria-pressed', String(allOpen));
  elements['toggle-delivery-slots'].setAttribute('aria-label', allOpen ? '收起全部发送时段' : '展开全部发送时段');
  elements['toggle-delivery-slots-label'].textContent = allOpen ? '收起全部' : '展开全部';
}

function toggleAllDeliverySlots() {
  const slots = [...elements['delivery-slot-list'].querySelectorAll('.delivery-slot')];
  if (!slots.length) return;
  const expansion = deliveryExpansionState();
  const shouldOpen = slots.some((slot) => !slot.open);
  expansion.allSlotsOpen = shouldOpen;
  for (const slot of slots) {
    slot.open = shouldOpen;
    if (shouldOpen) expansion.openSlots.add(slot.dataset.slotKey);
    else expansion.openSlots.delete(slot.dataset.slotKey);
  }
  updateDeliveryExpandButton();
}

function makeDeliveryRecord(item, expansion, { rank = 0, metric = '' } = {}) {
  const details = document.createElement('details'); details.className = 'delivery-record';
  const recordKey = item.messageKey || item.messageId || `${item.email}|${item.firstEventAt}`;
  details.dataset.recordKey = recordKey;
  details.open = expansion.openRecords.has(recordKey);
  details.addEventListener('toggle', () => {
    if (details.open) expansion.openRecords.add(recordKey);
    else expansion.openRecords.delete(recordKey);
  });
  const heading = document.createElement('summary');
  const identity = document.createElement('span'); identity.className = 'delivery-identity';
  const company = document.createElement('strong'); company.textContent = text(item.companyName, item.customerId ? `客户 ${item.customerId}` : '未知公司');
  const campaignLabel = item.campaign === 'second_touch_v1' ? '第二轮' : '首封';
  const contact = document.createElement('small'); contact.textContent = `${campaignLabel} · ${text(item.contactName, '未命名联系人')} · ${text(item.email, '未知邮箱')}`;
  const subject = document.createElement('small'); subject.className = 'delivery-subject'; subject.textContent = `主题：${text(item.subject, '未填写')}`;
  identity.append(company, contact, subject);
  const status = document.createElement('span'); status.className = `delivery-status ${item.tone || 'info'}`; status.textContent = item.statusLabel || item.status;
  const sendTime = item.sentAt || item.firstEventAt || item.lastEventAt || '';
  const time = document.createElement('span'); time.className = 'delivery-time-cell';
  const actualTime = document.createElement('strong'); actualTime.textContent = `实际 ${formatEventTime(sendTime)}`;
  const plannedTime = document.createElement('small');
  plannedTime.textContent = item.scheduledAt
    ? `计划 ${formatEventTime(item.scheduledAt, { timeZone: item.timeZone || 'UTC' })} · ${text(item.timeZone, 'UTC')}`
    : '计划时间未记录';
  time.append(actualTime, plannedTime);
  const count = document.createElement('span'); count.className = 'event-count';
  const metricCount = metric === 'clicks' ? Number(item.clickCount || 0) : Number(item.openCount || 0);
  const metricLabel = metric === 'clicks' ? '点击' : '打开';
  count.textContent = `${rank ? `#${rank} · ` : ''}${metricLabel} ${metricCount} 次`;
  count.title = `打开 ${Number(item.openCount || 0)} 次 · 点击 ${Number(item.clickCount || 0)} 次 · ${item.events?.length || 0} 条状态事件`;
  heading.append(identity, status, time, count);
  const timeline = document.createElement('div'); timeline.className = 'delivery-timeline';
  const actions = document.createElement('div'); actions.className = 'delivery-record-actions';
  const preview = document.createElement('button'); preview.className = 'button button-secondary delivery-preview-button'; preview.type = 'button';
  preview.textContent = '查看完整邮件';
  preview.addEventListener('click', () => openEmailDetail(item));
  const availability = document.createElement('span'); availability.className = 'delivery-preview-availability';
  availability.textContent = item.emailPreviewAvailable ? '显示实际发送版本' : '早期记录可能没有正文';
  actions.append(preview, availability); timeline.append(actions);
  for (const event of item.events || []) {
    const row = document.createElement('div'); row.className = 'delivery-event';
    const dot = document.createElement('i'); dot.className = event.tone || 'info';
    const eventBody = document.createElement('span');
    const label = document.createElement('strong'); label.textContent = event.label || event.event;
    const detail = document.createElement('small'); detail.textContent = event.reason || (event.link ? `点击：${event.link}` : 'Brevo 事件');
    eventBody.append(label, detail);
    const eventTime = document.createElement('time'); eventTime.dateTime = event.occurredAt || ''; eventTime.textContent = formatEventTime(event.occurredAt);
    row.append(dot, eventBody, eventTime); timeline.append(row);
  }
  if (item.stopped) {
    const notice = document.createElement('p'); notice.className = 'delivery-stop-notice'; notice.textContent = '已触发停止条件，不应继续向该邮箱发送。'; timeline.prepend(notice);
  }
  details.append(heading, timeline); return details;
}

function renderDeliverySlots(items) {
  const expansion = deliveryExpansionState();
  const sort = elements['delivery-sort'].value;
  const rankingMetric = sort === 'opens_desc' ? 'opens' : sort === 'clicks_desc' ? 'clicks' : '';
  const groups = new Map();
  for (const item of items) {
    const key = deliverySlotKey(item.sentAt || item.firstEventAt || item.lastEventAt);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const slots = rankingMetric
    ? [[`ranking:${sort}`, items]]
    : [...groups.entries()].sort((a, b) => b[0] - a[0]);
  if (!expansion.initialized && slots.length) {
    expansion.openSlots.add(String(slots[0][0]));
    expansion.initialized = true;
  }
  elements['delivery-slot-list'].replaceChildren(...slots.map(([slotStart, slotItems]) => {
    const slotKey = String(slotStart);
    const slot = document.createElement('details'); slot.className = 'delivery-slot';
    slot.dataset.slotKey = slotKey;
    slot.open = expansion.allSlotsOpen || expansion.openSlots.has(slotKey);
    slot.addEventListener('toggle', () => {
      if (slot.open) expansion.openSlots.add(slotKey);
      else {
        expansion.openSlots.delete(slotKey);
        expansion.allSlotsOpen = false;
      }
      updateDeliveryExpandButton();
    });
    const heading = document.createElement('summary');
    const label = document.createElement('span'); label.className = 'delivery-slot-label';
    const title = document.createElement('strong');
    title.textContent = rankingMetric
      ? rankingMetric === 'opens' ? '联系人打开次数排行榜' : '联系人点击次数排行榜'
      : formatDeliverySlot(slotStart);
    const companies = new Set(slotItems.map((item) => item.customerId || item.companyName || item.email));
    const meta = document.createElement('small'); meta.textContent = `${slotItems.length} 封 · ${companies.size} 家公司`;
    label.append(title, meta);
    const actualTimes = slotItems.map((item) => new Date(item.sentAt || item.firstEventAt || item.lastEventAt).getTime()).filter((value) => !Number.isNaN(value));
    const actual = document.createElement('time');
    actual.textContent = rankingMetric
      ? `最高 ${rankingMetric === 'opens' ? Number(slotItems[0]?.openCount || 0) : Number(slotItems[0]?.clickCount || 0)} 次`
      : actualTimes.length ? `${formatEventTime(Math.min(...actualTimes))} - ${formatEventTime(Math.max(...actualTimes))}` : '-';
    const arrow = document.createElement('span'); arrow.className = 'delivery-slot-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '⌄';
    heading.append(label, actual, arrow);
    const list = document.createElement('div'); list.className = 'delivery-slot-items';
    list.append(...slotItems.map((item, itemIndex) => makeDeliveryRecord(item, expansion, {
      rank: rankingMetric ? itemIndex + 1 : 0,
      metric: rankingMetric,
    })));
    slot.append(heading, list); return slot;
  }));
  updateDeliveryExpandButton();
}

function renderScreeningBatch() {
  const screening = state.delivery.screening || { today: {}, batches: [] };
  const batches = screening.batches || [];
  const select = elements['screening-batch-select'];
  const previous = select.value || 'today';
  const options = [new Option('今日累计', 'today')];
  for (const batch of batches) {
    const label = batch.source === 'today_backfill' ? '今日启用前汇总' : '筛选批次';
    options.push(new Option(`${formatEventTime(batch.completedAt)} · ${label}`, batch.id));
  }
  select.replaceChildren(...options);
  select.value = options.some((option) => option.value === previous) ? previous : 'today';
  const selected = select.value === 'today'
    ? screening.today || {}
    : batches.find((batch) => batch.id === select.value) || screening.today || {};
  const values = {
    'screening-researched': selected.researched,
    'screening-qualified': selected.qualified,
    'screening-excluded': selected.excluded,
    'screening-pending': selected.pending,
    'screening-contacts-found': selected.contactsFound,
    'screening-contacts-created': selected.contactsCreated,
    'screening-queued-companies': selected.queuedCompanies,
    'screening-queued-emails': selected.queuedEmails,
  };
  for (const [id, value] of Object.entries(values)) elements[id].textContent = String(Number(value || 0));
}

function renderDelivery() {
  const summary = state.delivery.summary || {};
  const secondTouch = state.delivery.secondTouch || {};
  elements['delivery-today'].textContent = String(Number(state.delivery.sentSummary?.emails ?? summary.total ?? 0));
  elements['delivery-total'].textContent = String(summary.total || 0);
  elements['delivery-delivered'].textContent = String(summary.delivered || 0);
  elements['delivery-opened'].textContent = String(summary.opened || 0);
  elements['delivery-clicked'].textContent = String(summary.clicked || 0);
  elements['delivery-failed'].textContent = String(summary.failed || 0);
  elements['nav-delivery-count'].textContent = String(summary.total || 0);
  elements['second-touch-eligible'].textContent = String(Number(secondTouch.eligible || 0));
  elements['second-touch-queued'].textContent = String(Number(secondTouch.queued || 0));
  elements['second-touch-sent'].textContent = String(Number(secondTouch.sent || 0));
  elements['second-touch-remaining'].textContent = String(Number(secondTouch.remainingPilot || 0));
  elements['second-touch-state'].className = `connection-chip ${secondTouch.enabled ? 'ready' : 'waiting'}`;
  elements['second-touch-state'].textContent = secondTouch.enabled ? '试运行已开启' : '未开启';
  const period = state.delivery.period || { label: '今天已发送' };
  const sentSummary = state.delivery.sentSummary || {};
  const campaignLabels = { all: '全部营销轮次', initial_outreach_v1: '首封营销', second_touch_v1: '第二轮营销' };
  const campaign = elements['delivery-campaign-filter'].value;
  elements['delivery-period-label'].textContent = `${text(period.label, '今天已发送')} · ${campaignLabels[campaign] || campaignLabels.all}`;
  elements['delivery-period-emails'].textContent = String(Number(sentSummary.emails || 0));
  elements['delivery-period-companies'].textContent = String(Number(sentSummary.companies || 0));
  const firstSentAt = sentSummary.firstSentAt ? formatEventTime(sentSummary.firstSentAt) : '-';
  const lastSentAt = sentSummary.lastSentAt ? formatEventTime(sentSummary.lastSentAt) : '-';
  elements['delivery-period-window'].textContent = firstSentAt === lastSentAt ? firstSentAt : `${firstSentAt} - ${lastSentAt}`;
  renderScreeningBatch();
  const configured = state.delivery.webhookConfigured && state.delivery.publicUrlConfigured;
  const receiving = configured && Number(summary.eventTotal || 0) > 0;
  elements['delivery-webhook-state'].className = `connection-chip ${receiving ? 'ready' : 'waiting'}`;
  elements['delivery-webhook-state'].textContent = receiving
    ? '状态回传正常'
    : configured
      ? '等待首个事件'
      : state.delivery.webhookConfigured
        ? '等待公网地址'
        : 'Webhook 待配置';

  const filter = elements['delivery-status-filter'].value;
  const items = (state.delivery.items || []).filter((item) => filter === 'all' || item.status === filter);
  const sort = elements['delivery-sort'].value;
  const ranking = sort === 'opens_desc' || sort === 'clicks_desc';
  elements['delivery-list-eyebrow'].textContent = ranking ? '互动排行' : '发送时段';
  elements['delivery-list-title'].textContent = sort === 'opens_desc'
    ? '打开次数从高到低'
    : sort === 'clicks_desc' ? '点击次数从高到低' : '每 15 分钟一组';
  elements['delivery-list-note'].textContent = ranking
    ? '基于当前筛选范围内的 Brevo 事件'
    : '按实际发送时间 · 北京时间';
  setHidden(elements['delivery-empty'], items.length > 0);
  renderDeliverySlots(items);
  renderDashboard();
}

async function loadDelivery() {
  try {
    const status = elements['delivery-status-filter'].value;
    const period = elements['delivery-period-filter'].value;
    const campaign = elements['delivery-campaign-filter'].value;
    const sort = elements['delivery-sort'].value;
    const query = new URLSearchParams({ limit: '500', period, campaign, sort });
    if (status !== 'all') query.set('status', status);
    if (state.demoMode) {
      const items = demoDelivery.items.filter((item) => campaign === 'all' || item.campaign === campaign);
      state.delivery = { ...demoDelivery, items, sentSummary: { emails: items.length, companies: items.length } };
    } else {
      state.delivery = await api(`/api/delivery?${query}`);
    }
    renderDelivery();
  } catch (error) {
    toast(`邮件状态读取失败：${error.message}`, 'error');
  }
}

function renderInbox() {
  const summary = state.inbox.summary || {};
  const mailbox = state.inbox.mailbox || {};
  elements['inbox-inquiries'].textContent = String(summary.inquiries || 0);
  elements['inbox-potential'].textContent = String(summary.potentialInterests || 0);
  elements['inbox-ordinary'].textContent = String(summary.ordinaryReplies || 0);
  elements['inbox-ai-classified'].textContent = String(summary.aiClassified || 0);
  elements['inbox-matched'].textContent = String(summary.matched || 0);
  elements['inbox-auto-replies'].textContent = String(summary.autoReplies || 0);
  elements['inbox-bounces'].textContent = String(summary.bounces || 0);
  elements['inbox-unmatched'].textContent = String(summary.unmatched || 0);
  elements['nav-inbox-count'].textContent = String(summary.actionable || summary.inquiries || 0);
  const stateError = mailbox.state?.lastError;
  const monitoring = mailbox.enabled && mailbox.configured;
  elements['inbox-monitor-state'].className = `connection-chip ${monitoring && !stateError ? 'ready' : 'waiting'}`;
  elements['inbox-monitor-state'].textContent = !mailbox.configured
    ? '邮箱待配置'
    : !mailbox.enabled
      ? '监控未开启'
      : stateError
        ? '最近检查异常'
        : mailbox.state?.lastSuccessAt
          ? `监控中 · ${formatEventTime(mailbox.state.lastSuccessAt)}`
          : '监控中 · 等待首次检查';
  elements['inbox-monitor-state'].title = stateError || '';
  elements['poll-inbox'].disabled = !monitoring;

  const items = state.inbox.items || [];
  const createRecord = (item) => {
    const classification = inboxClassifications[item.classification] || inboxClassifications.unmatched;
    const details = document.createElement('details'); details.className = 'inbox-message';
    const heading = document.createElement('summary');
    const identity = document.createElement('span'); identity.className = 'inbox-message-identity';
    const company = document.createElement('strong'); company.textContent = text(item.companyName, item.fromName || item.fromEmail || '未知发件人');
    const sender = document.createElement('small'); sender.textContent = [item.contactName, item.fromEmail].filter(Boolean).join(' · ') || '发件人地址未知';
    identity.append(company, sender);
    const subject = document.createElement('span'); subject.className = 'inbox-message-subject'; subject.textContent = text(item.subject, '(无主题)');
    const status = document.createElement('span'); status.className = `delivery-status ${classification.tone}`; status.textContent = classification.label;
    const time = document.createElement('time'); time.dateTime = item.receivedAt || ''; time.textContent = formatEventTime(item.receivedAt);
    const arrow = document.createElement('span'); arrow.className = 'inbox-message-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '⌄';
    heading.append(identity, subject, status, time, arrow);

    const body = document.createElement('div'); body.className = 'inbox-message-body';
    const facts = document.createElement('div'); facts.className = 'inbox-message-facts';
    const matched = document.createElement('span'); matched.textContent = '营销匹配'; const matchedValue = document.createElement('strong'); matchedValue.textContent = item.matched ? '已匹配' : '未匹配'; matched.append(matchedValue);
    const method = document.createElement('span'); method.textContent = '匹配方式'; const methodValue = document.createElement('strong'); methodValue.textContent = item.matchMethod === 'reply_header' ? '邮件回复链' : item.matchMethod === 'sender_email' ? '发件邮箱' : '-'; method.append(methodValue);
    const feishu = document.createElement('span'); feishu.textContent = '飞书回填'; const feishuValue = document.createElement('strong'); feishuValue.textContent = item.feishuSyncStatus === 'synced' ? '已同步' : item.feishuSyncStatus === 'failed' ? '同步失败' : item.feishuRecordId ? '待同步' : '无匹配记录'; feishu.append(feishuValue);
    const source = document.createElement('span'); source.textContent = '判断来源'; const sourceValue = document.createElement('strong'); sourceValue.textContent = item.classificationSource === 'mimo' ? `小米 MiMo · ${item.classifierModel || 'mimo-v2.5-pro'}` : item.classificationSource === 'rule' ? '固定规则' : '保守规则降级'; source.append(sourceValue);
    const confidence = document.createElement('span'); confidence.textContent = '置信度'; const confidenceValue = document.createElement('strong'); confidenceValue.textContent = item.classificationConfidence ? `${Math.round(Number(item.classificationConfidence) * 100)}%` : '-'; confidence.append(confidenceValue);
    facts.append(matched, method, source, confidence, feishu);
    const analysis = document.createElement('div'); analysis.className = 'inbox-ai-analysis';
    const analysisTitle = document.createElement('strong'); analysisTitle.textContent = '判断依据';
    const analysisReason = document.createElement('p'); analysisReason.textContent = text(item.classificationReason, '暂无分析说明');
    analysis.append(analysisTitle, analysisReason);
    if (item.classificationSummary) {
      const summaryTitle = document.createElement('strong'); summaryTitle.textContent = '客户需求摘要';
      const summaryText = document.createElement('p'); summaryText.textContent = item.classificationSummary;
      analysis.append(summaryTitle, summaryText);
    }
    const signals = item.classificationDetails?.purchaseSignals || [];
    if (signals.length) {
      const signalTitle = document.createElement('strong'); signalTitle.textContent = '采购信号';
      const signalText = document.createElement('p'); signalText.textContent = signals.join(' · ');
      analysis.append(signalTitle, signalText);
    }
    const message = document.createElement('pre'); message.textContent = text(item.textBody, item.preview || '邮件正文为空');
    let emailContent = message;
    let loadHtmlPreview = () => {};
    if (item.htmlAvailable) {
      const preview = document.createElement('div'); preview.className = 'inbox-html-preview';
      const loading = document.createElement('span'); loading.className = 'inbox-html-loading'; loading.textContent = '正在加载邮件原始样式...';
      const frame = document.createElement('iframe'); frame.className = 'inbox-html-frame';
      frame.title = `邮件原始样式：${text(item.subject, '无主题')}`;
      frame.loading = 'lazy'; frame.referrerPolicy = 'no-referrer'; frame.setAttribute('sandbox', 'allow-same-origin');
      let loaded = false;
      loadHtmlPreview = () => {
        if (loaded) return;
        loaded = true;
        frame.src = `/api/inbox/${encodeURIComponent(item.id)}/html`;
      };
      frame.addEventListener('load', () => {
        loading.classList.add('hidden');
        try {
          const height = frame.contentDocument?.documentElement?.scrollHeight || 0;
          if (height) frame.style.height = `${Math.min(Math.max(height + 4, 480), 2800)}px`;
        } catch {}
      });
      preview.append(loading, frame);
      emailContent = preview;
    }
    body.append(facts, analysis, emailContent);
    details.append(heading, body);
    details.open = state.inboxExpansion.has(item.id);
    details.addEventListener('toggle', () => {
      if (details.open) {
        state.inboxExpansion.add(item.id);
        loadHtmlPreview();
      } else {
        state.inboxExpansion.delete(item.id);
      }
    });
    if (details.open) loadHtmlPreview();
    return details;
  };
  const inquiries = items.filter((item) => ['inquiry', 'potential_interest'].includes(item.classification));
  const otherItems = items.filter((item) => !['inquiry', 'potential_interest'].includes(item.classification));
  elements['inbox-inquiry-count'].textContent = `${inquiries.length} 封`;
  elements['inbox-other-count'].textContent = `${otherItems.length} 封`;
  setHidden(elements['inbox-inquiry-empty'], inquiries.length > 0);
  setHidden(elements['inbox-other-empty'], otherItems.length > 0);
  elements['inbox-inquiry-list'].replaceChildren(...inquiries.map(createRecord));
  elements['inbox-other-list'].replaceChildren(...otherItems.map(createRecord));
}

async function loadInbox() {
  if (state.demoMode) { renderInbox(); return; }
  const classification = elements['inbox-classification-filter'].value;
  const query = new URLSearchParams({ limit: '200' });
  if (classification !== 'all') query.set('classification', classification);
  try {
    state.inbox = await api(`/api/inbox?${query}`);
    renderInbox();
  } catch (error) {
    toast(`询盘回复读取失败：${error.message}`, 'error');
  }
}

async function pollInbox() {
  elements['poll-inbox'].disabled = true;
  elements['inbox-monitor-state'].textContent = '正在检查收件箱...';
  try {
    const result = await api('/api/inbox/poll', { method: 'POST', body: '{}' });
    await loadInbox();
    toast(`收件箱检查完成：新增 ${result.created || 0} 封，人工回复 ${result.inquiries || 0} 封`, 'success');
  } catch (error) {
    toast(error.message, 'error');
    await loadInbox();
  }
}

async function checkHealth() {
  state.health = state.demoMode ? { capabilities: { fumeng: true, apollo: true, fumengWriteback: true, openai: true, inboxAi: true, feishu: true, deliveryTracking: true, automation: true, signature: true, sending: false, webSearch: false }, model: 'synthetic-preview', dailySendLimit: 10, marketing: { dailyCompanyLimit: 10, companiesMarketedToday: 0, remainingCompaniesToday: 10, enabled: false, sendingEnabled: false } } : await api('/api/health');
  renderSystemStatus();
  document.querySelectorAll('[data-daily-limit]').forEach((element) => {
    element.textContent = String(state.health.dailySendLimit || 10);
  });
  renderMarketingSettings(state.health.marketing);
  if (elements['automation-refresh-status']) {
    elements['automation-refresh-status'].textContent = !state.health.capabilities.automation
      ? '后台调度待配置'
      : !state.health.marketing?.enabled
        ? '自动营销已暂停 · 不会继续背调或发送'
        : state.health.marketing?.researchEnabled === false && state.health.marketing?.sendingEnabled
          ? '仅发送队列运行中 · Apollo 背调已暂停'
        : state.health.capabilities.sending
          ? state.health.brevo?.ok === false
            ? '发信队列已保留 · Brevo 授权受阻'
            : '自动营销运行中 · 每分钟更新结果'
          : '自动筛选运行中 · 邮件发送已关闭';
  }
}

async function refreshResults() {
  if (state.demoMode) return;
  const results = await Promise.allSettled([checkHealth(), loadQueue(), loadDelivery(), loadInbox()]);
  if (results.some((result) => result.status === 'rejected')) {
    elements['automation-refresh-status'].textContent = '结果更新失败 · 请稍后重试';
  }
}

async function init() {
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.title = button.getAttribute('aria-label') || '';
    button.addEventListener('click', () => goTo(button.dataset.view));
  });
  document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => goTo(button.dataset.go)));
  document.querySelectorAll('[data-close-drawer]').forEach((button) => button.addEventListener('click', closeDrawer));
  document.querySelectorAll('[data-close-email-drawer]').forEach((button) => button.addEventListener('click', closeEmailDetail));
  const initialView = location.hash.replace('#', ''); goTo(viewNames[initialView] ? initialView : 'dashboard', { updateHash: false });
  try {
    await checkHealth();
    await loadRelaySettings();
    await loadMiMoSettings();
    await loadMailboxSettings();
    await loadMarketingSettings();
    if (state.demoMode) state.signature = { teamName: 'MEAN WELL KULON TEAM', email: 'marketing@kulon.com', website: 'https://meanwell-led.com/', websiteLabel: 'meanwell-led.com' };
    else state.signature = (await api('/api/email/signature')).signature;
    renderSignature();
    await Promise.allSettled([
      loadCustomers({ reset: true }),
      loadQueue(),
      loadDelivery(),
      loadInbox(),
    ]);
    window.setInterval(refreshResults, 60_000);
  } catch (error) { toast(error.message, 'error'); renderDashboard(); }
}

elements['reload-customers'].addEventListener('click', () => loadCustomers({ reset: true }));
elements['load-more'].addEventListener('click', () => loadCustomers());
elements['customer-search'].addEventListener('input', renderCustomers); elements['customer-owner-filter'].addEventListener('change', renderCustomers); elements['customer-country-filter'].addEventListener('change', renderCustomers); elements['customer-industry-filter'].addEventListener('change', renderCustomers); elements['customer-state-filter'].addEventListener('change', renderCustomers); elements['customer-contact-filter'].addEventListener('change', renderCustomers);
elements['customer-scope-filter'].addEventListener('change', () => loadCustomers({ reset: true }));
document.querySelectorAll('[data-sort]').forEach((button) => button.addEventListener('click', async () => {
  const nextSort = button.dataset.sort;
  if (state.sortBy === nextSort) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
  else { state.sortBy = nextSort; state.sortDirection = nextSort === 'lastTrack' ? 'desc' : 'asc'; }
  updateSortHeaders();
  await loadCustomers({ reset: true });
}));
elements['global-search'].addEventListener('input', (event) => { elements['customer-search'].value = event.target.value; if (event.target.value.trim()) { goTo('customers'); renderCustomers(); } });
elements['start-pilot'].addEventListener('click', () => goTo('delivery'));
elements['drawer-generate'].addEventListener('click', openReviewForCustomer);
elements['generate-draft'].addEventListener('click', generateDraft); elements['email-subject'].addEventListener('input', updateEmailPreview); elements['email-body'].addEventListener('input', updateEmailPreview); elements['sync-feishu'].addEventListener('click', syncFeishu); elements['relay-settings-form'].addEventListener('submit', saveRelaySettings); elements['mimo-settings-form'].addEventListener('submit', saveMiMoSettings); elements['password-settings-form'].addEventListener('submit', savePassword); elements['logout-button'].addEventListener('click', logout); elements['daily-company-form'].addEventListener('submit', saveMarketingSettings); elements['marketing-toggle'].addEventListener('click', toggleMarketing); elements['apollo-research-toggle'].addEventListener('click', toggleApolloResearch); elements['email-sending-toggle'].addEventListener('click', toggleEmailSending);
elements['mailbox-settings-form'].addEventListener('submit', saveMailboxSettings);
elements['refresh-queue'].addEventListener('click', async () => { await loadQueue(); await loadDelivery(); });
elements['refresh-delivery'].addEventListener('click', loadDelivery);
elements['toggle-delivery-slots'].addEventListener('click', toggleAllDeliverySlots);
elements['delivery-campaign-filter'].addEventListener('change', loadDelivery);
elements['delivery-period-filter'].addEventListener('change', loadDelivery);
elements['delivery-status-filter'].addEventListener('change', loadDelivery);
elements['delivery-sort'].addEventListener('change', loadDelivery);
elements['screening-batch-select'].addEventListener('change', renderScreeningBatch);
elements['refresh-inbox'].addEventListener('click', loadInbox);
elements['poll-inbox'].addEventListener('click', pollInbox);
elements['inbox-classification-filter'].addEventListener('change', loadInbox);
elements['check-integrations'].addEventListener('click', async () => { try { await checkHealth(); await loadRelaySettings(); await loadMiMoSettings(); await loadMailboxSettings(); await loadMarketingSettings(); await loadDelivery(); await loadInbox(); toast('连接状态已更新', 'success'); } catch (error) { toast(error.message, 'error'); } });
window.addEventListener('hashchange', () => goTo(location.hash.replace('#', ''), { updateHash: false }));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeEmailDetail();
  closeDrawer();
});

updateSortHeaders();
init();
