import { AppError, readJsonResponse, requireConfiguration } from './errors.mjs';

const TOKEN_LIFETIME_MS = 110 * 60 * 1000;
const CUSTOMER_SORT_FIELDS = {
  company: 'cust_name',
  owner: 'owner_ct_id',
  country: 'country_id',
  state: 'cust_state',
  industry: 'industry',
  contact: 'cont_name',
  lastTrack: 'last_track_date',
  modified: 'modify_date',
};

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function normalizeBoolean(value) {
  return value === true || value === 1 || ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function upstreamMessage(data) {
  const value = data?.msg ?? data?.message ?? data?.code;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value?.errorMessage) {
    const detail = value.data === undefined || value.data === null ? '' : ` ${String(value.data)}`;
    return `${value.errorMessage}${detail}`.trim();
  }
  try { return JSON.stringify(value); } catch { return String(data?.code || '未知错误'); }
}

function mapCustomer(
  customer,
  {
    countries = new Map(),
    countryEnglish = new Map(),
    countryCodes = new Map(),
    industries = new Map(),
    productRanges = new Map(),
    customerStates = new Map(),
  } = {},
) {
  const country = countries.get(String(customer.countryId)) || '';
  const industryId = customer.industry ? String(customer.industry) : '';
  const productRangeId = customer.productRange ? String(customer.productRange) : '';
  const customerStateId = customer.custState ? String(customer.custState) : '';
  return {
    id: String(customer.key_id || ''),
    billCode: customer.billCode || '',
    companyName: customer.custName || '',
    website: customer.web || '',
    countryId: customer.countryId ? String(customer.countryId) : '',
    country,
    countryEnglish: countryEnglish.get(String(customer.countryId)) || country,
    countryCode: countryCodes.get(String(customer.countryId)) || '',
    industryId,
    industry: industries.get(industryId) || customer.industry || '',
    productRangeId,
    productRange: productRanges.get(productRangeId) || customer.productRange || '',
    customerStateId,
    customerState: customerStates.get(customerStateId) || customer.custState || '',
    mainContactId: customer.contId ? String(customer.contId) : '',
    mainContactName: customer.contName || '',
    mainContactEmail: customer.mailAddress || '',
    customerStage: customer.custStage || '',
    customerLevel: customer.custLevel || '',
    lastTrackDate: customer.lastTrackDate || '',
    lastTrackInfo: customer.lastTrackInfo || '',
    nextTrackDate: customer.nextTrackDate || '',
    quotationCreateDate: customer.quotationCreateDate || '',
    orderCreateDate: customer.orderCreateDate || '',
    businessCreateDate: customer.businessCreateDate || '',
    isPublicSea: normalizeBoolean(customer.seasFlag),
    publicSeaGroupId: customer.seasGroup ? String(customer.seasGroup) : '',
    inSeaDate: customer.inSeaDate || '',
    willInSeaDate: customer.willInSeaDate || '',
    inSeaReason: customer.inseaReason || '',
    modifyDate: customer.modifyDate || '',
    ownerContactId: customer.ownerCtId ? String(customer.ownerCtId) : '',
    ownerName: customer._convert?.ownerCtId || '',
    ownerDepartmentKey: customer.ownerDeptKey ? String(customer.ownerDeptKey) : '',
    remarks: customer.remarks || '',
  };
}

function mapContact(contact) {
  return {
    id: String(contact.key_id || ''),
    name: contact.contName || '',
    email: contact.mailAddress || '',
    jobRole: contact.jobs || contact._convert?.customint2 || '',
    primary: normalizeBoolean(contact.primaryContact),
    emailSource: contact.mailAddress ? 'fumeng_contact' : '',
    whatsapp: contact.whatsapp || contact.realWp || '',
    linkedin: contact.linkedin || '',
    remarks: contact.remarks || '',
    ownerContactId: contact.ownerCtId ? String(contact.ownerCtId) : '',
    ownerDepartmentKey: contact.ownerDeptKey ? String(contact.ownerDeptKey) : '',
    customerId: contact.custId ? String(contact.custId) : '',
    modifyDate: contact.modifyDate || '',
  };
}

export class FumengClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.tokenRefreshPromise = null;
    this.companyId = '';
    this.countryCache = null;
    this.countryEnglishCache = null;
    this.countryCodeCache = null;
    this.dictionaryCache = new Map();
  }

  async post(path, body, accessToken, allowTokenRefresh = true) {
    const response = await this.fetch(`${this.config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { accessToken } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401 && accessToken && allowTokenRefresh) {
      const refreshedToken = await this.refreshAccessToken(accessToken);
      return this.post(path, body, refreshedToken, false);
    }
    const data = await readJsonResponse(response, '孚盟 API');
    if (String(data.code) !== '0') {
      throw new AppError(`孚盟 API 返回错误：${upstreamMessage(data)}`, {
        status: 502,
        code: 'FUMENG_API_ERROR',
        details: { upstreamCode: data.code },
      });
    }
    return data;
  }

  async refreshAccessToken(invalidatedToken) {
    if (this.token && this.token !== invalidatedToken && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    if (!this.tokenRefreshPromise) {
      this.tokenRefreshPromise = (async () => {
        this.token = null;
        this.tokenExpiresAt = 0;
        this.companyId = '';
        return this.getAccessToken();
      })().finally(() => {
        this.tokenRefreshPromise = null;
      });
    }
    return this.tokenRefreshPromise;
  }

  async getAccessToken() {
    requireConfiguration(
      { FUMENG_APP_ID: this.config.appId, FUMENG_APP_SECRET: this.config.appSecret },
      '孚盟',
    );

    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const result = await this.post('/auth-server/open/acquire_token', {
      appId: this.config.appId,
      appSecret: this.config.appSecret,
    });
    const data = normalizeArray(result.data)[0];
    if (!data?.accessToken) {
      throw new AppError('孚盟鉴权成功但未返回 accessToken', {
        status: 502,
        code: 'FUMENG_TOKEN_MISSING',
      });
    }

    this.token = data.accessToken;
    this.companyId = String(data.companyId || '');
    this.tokenExpiresAt = Date.now() + TOKEN_LIFETIME_MS;
    return this.token;
  }

  async getCountries() {
    if (this.countryCache) return this.countryCache;
    const token = await this.getAccessToken();
    if (!this.companyId) return new Map();

    const result = await this.post(
      '/bill-server/pure/getControlValue',
      { dataCid: this.companyId, controlId: '32', from: 0, size: 1000, pageStatus: 1 },
      token,
    );
    const countries = normalizeArray(result.data);
    this.countryCache = new Map(
      countries.map((country) => [
        String(country.countryid),
        country.cnname || country.enname || country.shortname || '',
      ]),
    );
    this.countryEnglishCache = new Map(
      countries.map((country) => [
        String(country.countryid),
        country.enname || country.cnname || country.shortname || '',
      ]),
    );
    this.countryCodeCache = new Map(
      countries.map((country) => [String(country.countryid), country.shortname || '']),
    );
    return this.countryCache;
  }

  async getDictionary(dictCode) {
    const key = String(dictCode);
    if (this.dictionaryCache.has(key)) return this.dictionaryCache.get(key);
    const token = await this.getAccessToken();
    if (!this.companyId) return new Map();

    const result = await this.post(
      '/bill-server/pure/getControlData',
      { controlId: '102', dictCode: Number(dictCode), dataCid: this.companyId, from: 0, size: 1000 },
      token,
    );
    const dictionary = new Map(
      normalizeArray(result.data).map((item) => {
        const id = item.dictionary_value_id ?? item.id;
        const name = item.cn_name || item.en_name || item.name || '';
        return [String(id), name];
      }),
    );
    this.dictionaryCache.set(key, dictionary);
    return dictionary;
  }

  async getCustomerLookups() {
    const [countries, industries, productRanges, customerStates] = await Promise.all([
      this.getCountries().catch(() => new Map()),
      this.getDictionary(38).catch(() => new Map()),
      this.getDictionary(915).catch(() => new Map()),
      this.getDictionary(7).catch(() => new Map()),
    ]);
    return {
      countries,
      countryEnglish: this.countryEnglishCache || countries,
      countryCodes: this.countryCodeCache || new Map(),
      industries,
      productRanges,
      customerStates,
    };
  }

  assertWritebackEnabled() {
    if (!this.config.writebackEnabled) {
      throw new AppError('孚盟回填开关尚未开启', {
        status: 409,
        code: 'FUMENG_WRITEBACK_DISABLED',
      });
    }
  }

  async updateFields(moduleCode, keyId, fields) {
    this.assertWritebackEnabled();
    const modify = Object.fromEntries(
      Object.entries(fields || {}).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    );
    if (!String(keyId || '').trim() || !Object.keys(modify).length) {
      throw new AppError('孚盟字段更新缺少 keyId 或可写字段', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    const token = await this.getAccessToken();
    const result = await this.post(
      '/bill-server/pure/modifyStructFieldData',
      { keyId: String(keyId), modify, moduleCode, subModifyList: [] },
      token,
    );
    return { keyId: String(keyId), fields: modify, data: result.data };
  }

  async updateCustomerFields(customerId, fields) {
    const allowed = ['web', 'countryId', 'industry', 'productRange'];
    const safe = Object.fromEntries(Object.entries(fields || {}).filter(([key]) => allowed.includes(key)));
    return this.updateFields('NewBF001', customerId, safe);
  }

  async updateContactFields(contactId, fields) {
    const allowed = ['contName', 'mailAddress', 'jobs', 'linkedin', 'remarks'];
    const safe = Object.fromEntries(Object.entries(fields || {}).filter(([key]) => allowed.includes(key)));
    return this.updateFields('NewBF003', contactId, safe);
  }

  async addContact(customer, contact) {
    this.assertWritebackEnabled();
    if (!customer?.id || !customer?.companyName || !customer?.ownerContactId || !customer?.ownerDepartmentKey) {
      throw new AppError('孚盟新增联系人缺少客户主键、公司名、所属人或所属部门', {
        status: 422,
        code: 'FUMENG_CONTACT_OWNER_MISSING',
      });
    }
    if (!contact?.name || !contact?.email) {
      throw new AppError('孚盟新增联系人缺少姓名或邮箱', {
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    }
    const token = await this.getAccessToken();
    const ownerCtId = String(customer.ownerContactId);
    const ownerDeptKey = String(customer.ownerDepartmentKey);
    const record = {
      custId: String(customer.id),
      custOwner: ownerCtId,
      custName: customer.companyName,
      contName: contact.name,
      nickName: contact.name,
      mailAddress: String(contact.email).trim().toLowerCase(),
      jobs: contact.jobRole || '',
      linkedin: contact.linkedin || '',
      remarks: contact.remarks || '',
      primaryContact: 0,
      workStatus: 1,
      ownerCtId,
      ownerDeptKey,
    };
    const result = await this.post(
      '/bill-server/pure/add_one',
      { moduleCode: 'NewBF003', optCode: 'otNew', bill: { 1: [record] } },
      token,
    );
    return { id: String(result.data || ''), ...mapContact({ ...record, key_id: result.data }) };
  }

  async addEmailFollowup({ customer, contact, subject, sentAt, messageId }) {
    this.assertWritebackEnabled();
    if (!customer?.id || !customer?.ownerContactId || !customer?.ownerDepartmentKey || !contact?.id) {
      throw new AppError('孚盟邮件跟进缺少客户、所属人或联系人信息', {
        status: 422,
        code: 'FUMENG_FOLLOWUP_FIELDS_MISSING',
      });
    }
    const token = await this.getAccessToken();
    const timestamp = new Date(sentAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19);
    const record = {
      custId: String(customer.id),
      custName: customer.companyName,
      custOwner: String(customer.ownerContactId),
      contId: String(contact.id),
      contName: contact.name,
      ownerCtId: String(customer.ownerContactId),
      ownerDeptKey: String(customer.ownerDepartmentKey),
      sourceId: String(customer.id),
      sourceCode: customer.billCode || '',
      sourceModule: 'NewBF001',
      trackDate: timestamp,
      trackContent: `AI 营销邮件已发送\n主题：${subject}\nBrevo Message ID：${messageId}`,
      nextTrackDate: '',
      nextTrackDesc: '等待客户回复',
      ...(this.config.emailTrackModeId ? { trackMode: String(this.config.emailTrackModeId) } : {}),
    };
    const result = await this.post(
      '/bill-server/pure/add_one',
      { moduleCode: 'NewBF004', optCode: 'otNew', bill: { 1: [record] } },
      token,
    );
    return { id: String(result.data || '') };
  }

  async listCustomers({ from = 0, size = 10, scope = 'private', sortBy = 'modified', sortDirection = 'desc' } = {}) {
    const token = await this.getAccessToken();
    const pageSize = Math.min(Math.max(Number(size) || 10, 1), 50);
    const offset = Math.max(Number(from) || 0, 0);
    const normalizedScope = ['all', 'private', 'public'].includes(scope) ? scope : 'private';
    const normalizedSortBy = CUSTOMER_SORT_FIELDS[sortBy] ? sortBy : 'modified';
    const normalizedSortDirection = sortDirection === 'asc' ? 'asc' : 'desc';
    if (normalizedScope !== 'all') {
      requireConfiguration(
        { FUMENG_PUBLIC_SEA_OWNER_ID: this.config.publicSeaOwnerId },
        '孚盟公海客户所属人',
      );
    }
    const scopeSelection = normalizedScope === 'all'
      ? {}
      : {
          seniorSelection: {
            link: 0,
            selectionItemList: [
              {
                fieldId: '1110018',
                operatorId: normalizedScope === 'public' ? '72' : '73',
                itemValue: [String(this.config.publicSeaOwnerId)],
              },
            ],
          },
        };
    const [result, lookups] = await Promise.all([
      this.post(
        '/bill-server/pure/get_page_list',
        {
          moduleCode: 'NewBF001',
          optCode: 'otview',
          page: { from: offset, size: pageSize },
          withoutRight: true,
          orderBy: {
            desc: normalizedSortDirection,
            realFieldName: CUSTOMER_SORT_FIELDS[normalizedSortBy],
            tableCode: '1',
          },
          ...scopeSelection,
        },
        token,
      ),
      this.getCustomerLookups(),
    ]);

    return {
      total: Number(result.data?.totalNum || 0),
      from: offset,
      size: pageSize,
      scope: normalizedScope,
      sortBy: normalizedSortBy,
      sortDirection: normalizedSortDirection,
      items: normalizeArray(result.data?.list).map((item) => mapCustomer(item, lookups)),
    };
  }

  async getCustomer(customerId) {
    const token = await this.getAccessToken();
    const [result, lookups] = await Promise.all([
      this.post(
        '/open-platform-server/pure/get_detail_info',
        { moduleCode: 'NewBF001', structId: 1, masterKeyId: String(customerId) },
        token,
      ),
      this.getCustomerLookups(),
    ]);
    const customer = normalizeArray(result.data)[0];
    if (!customer) {
      throw new AppError('没有找到这个孚盟客户', {
        status: 404,
        code: 'CUSTOMER_NOT_FOUND',
      });
    }
    return mapCustomer(customer, lookups);
  }

  async listContacts(customerId, { size = 100, max = 1000 } = {}) {
    const token = await this.getAccessToken();
    const pageSize = Math.min(Math.max(Number(size) || 100, 1), 100);
    const maxItems = Math.max(Number(max) || 1000, pageSize);
    const contacts = [];
    let from = 0;
    let total = null;

    while (contacts.length < maxItems) {
      const result = await this.post(
        '/bill-server/pure/get_page_list',
        {
          moduleCode: 'NewBF003',
          optCode: 'otview',
          page: { from, size: pageSize },
          withoutRight: true,
          subBill: {
            keyId: String(customerId),
            originModuleCode: 'NewBF001',
            targetModuleCode: 'NewBF003',
          },
        },
        token,
      );
      const page = normalizeArray(result.data?.list);
      contacts.push(...page);
      total = Number.isFinite(Number(result.data?.totalNum))
        ? Number(result.data.totalNum)
        : null;
      from += page.length;

      if (!page.length || page.length < pageSize || (total !== null && from >= total)) break;
    }

    return contacts.slice(0, maxItems).map(mapContact);
  }
}
