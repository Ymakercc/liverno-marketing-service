import fs from 'node:fs';

function loadEnv(path = '.env') {
  const env = {};
  for (const raw of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[line.slice(0, index).trim()] = value;
  }
  return env;
}

function requireEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}

function maskEmail(email) {
  if (!email) return '';
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  const prefix = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${prefix}***@${domain}`;
}

async function postJson(baseUrl, path, body, accessToken) {
  const headers = { 'content-type': 'application/json' };
  if (accessToken) headers.accessToken = accessToken;

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();

  try {
    return { httpStatus: response.status, body: JSON.parse(text) };
  } catch {
    return {
      httpStatus: response.status,
      body: { parseError: true, bodyPreview: text.slice(0, 200) },
    };
  }
}

async function main() {
  const env = loadEnv();
  requireEnv(env, ['FUMENG_APP_ID', 'FUMENG_APP_SECRET']);

  const baseUrl = (env.FUMENG_BASE_URL || 'https://opengw.fumamx.com').replace(/\/$/, '');

  const auth = await postJson(baseUrl, '/auth-server/open/acquire_token', {
    appId: env.FUMENG_APP_ID,
    appSecret: env.FUMENG_APP_SECRET,
  });
  const authData = Array.isArray(auth.body.data) ? auth.body.data[0] : auth.body.data;
  const accessToken = authData?.accessToken;

  console.log(
    JSON.stringify(
      {
        auth: {
          httpStatus: auth.httpStatus,
          code: auth.body.code,
          hasAccessToken: Boolean(accessToken),
          expireTime: authData?.expireTime,
          companyId: authData?.companyId,
          ownerId: authData?.ownerId,
        },
      },
      null,
      2,
    ),
  );

  if (!accessToken) {
    process.exitCode = 1;
    return;
  }

  const customers = await postJson(
    baseUrl,
    '/bill-server/pure/get_page_list',
    {
      moduleCode: 'NewBF001',
      optCode: 'otview',
      page: { from: 0, size: 10 },
      withoutRight: true,
      orderBy: { desc: 'desc', realFieldName: 'modify_date', tableCode: '1' },
    },
    accessToken,
  );

  const customerList = customers.body.data?.list || [];
  console.log(
    JSON.stringify(
      {
        customers: {
          httpStatus: customers.httpStatus,
          code: customers.body.code,
          totalNum: customers.body.data?.totalNum,
          count: customerList.length,
          sample: customerList.slice(0, 3).map((customer) => ({
            key_id: customer.key_id,
            billCode: customer.billCode,
            custName: customer.custName,
            countryId: customer.countryId,
            contId: customer.contId,
            contName: customer.contName,
            hasMail: Boolean(customer.mailAddress),
            web: customer.web,
            industry: customer.industry,
            productRange: customer.productRange,
            modifyDate: customer.modifyDate,
            lastTrackDate: customer.lastTrackDate,
          })),
        },
      },
      null,
      2,
    ),
  );

  const firstCustomer = customerList[0];
  if (!firstCustomer?.key_id) return;

  const contacts = await postJson(
    baseUrl,
    '/bill-server/pure/get_page_list',
    {
      moduleCode: 'NewBF003',
      optCode: 'otview',
      page: { from: 0, size: 20 },
      withoutRight: true,
      subBill: {
        keyId: firstCustomer.key_id,
        originModuleCode: 'NewBF001',
        targetModuleCode: 'NewBF003',
      },
    },
    accessToken,
  );

  const contactList = contacts.body.data?.list || [];
  console.log(
    JSON.stringify(
      {
        contacts: {
          httpStatus: contacts.httpStatus,
          code: contacts.body.code,
          customer: {
            key_id: firstCustomer.key_id,
            billCode: firstCustomer.billCode,
            custName: firstCustomer.custName,
          },
          totalNum: contacts.body.data?.totalNum,
          count: contactList.length,
          sample: contactList.slice(0, 5).map((contact) => ({
            key_id: contact.key_id,
            contName: contact.contName,
            jobOrRole: contact.jobs || contact._convert?.customint2 || '',
            hasMail: Boolean(contact.mailAddress),
            mailMasked: maskEmail(contact.mailAddress),
            hasWhatsapp: Boolean(contact.whatsapp),
            hasLinkedIn: Boolean(contact.linkedin),
            primaryContact: contact.primaryContact,
            modifyDate: contact.modifyDate,
          })),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
