import assert from 'node:assert/strict';
import test from 'node:test';
import { FumengClient } from '../src/lib/fumeng-client.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Fumeng client caches token and maps customer/contact records', async () => {
  let authCalls = 0;
  let customerListBody;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/auth-server/open/acquire_token')) {
      authCalls += 1;
      return jsonResponse({ code: '0', data: [{ accessToken: 'token', companyId: 930261 }] });
    }
    if (url.endsWith('/bill-server/pure/getControlValue')) {
      return jsonResponse({ code: '0', data: [{ countryid: 155, cnname: '印度', enname: 'INDIA', shortname: 'IN' }] });
    }
    if (url.endsWith('/bill-server/pure/getControlData')) {
      return jsonResponse({
        code: '0',
        data:
          body.dictCode === 38
            ? [{ dictionary_value_id: 60, cn_name: '电子电气' }]
            : body.dictCode === 915
              ? [{ dictionary_value_id: 7, cn_name: '电子产品' }]
              : [{ dictionary_value_id: 2, cn_name: '意向' }],
      });
    }
    if (url.endsWith('/open-platform-server/pure/get_detail_info')) {
      return jsonResponse({
        code: '0',
        data: [{ key_id: body.masterKeyId, billCode: 'IN001', custName: 'Test Power', countryId: 155, industry: 60, productRange: 7, custState: 2 }],
      });
    }
    if (body.moduleCode === 'NewBF003') {
      assert.equal(body.optCode, 'otview');
      return jsonResponse({
        code: '0',
        data: { list: [{ key_id: 'c1', contName: 'Anika', mailAddress: 'anika@example.com' }] },
      });
    }
    customerListBody = body;
    return jsonResponse({
      code: '0',
      data: {
        totalNum: 1,
        list: [{ key_id: '1', billCode: 'IN001', custName: 'Test Power', countryId: 155, industry: 60, productRange: 7, custState: 2, seasFlag: 0, seasGroup: 1, ownerCtId: 12345678, _convert: { ownerCtId: '公海客户' } }],
      },
    });
  };
  const client = new FumengClient(
    { baseUrl: 'https://fumeng.example', appId: 'app', appSecret: 'secret', publicSeaOwnerId: '12345678' },
    { fetchImpl },
  );

  const customers = await client.listCustomers();
  const customer = await client.getCustomer('1');
  const contacts = await client.listContacts('1');

  assert.equal(customers.items[0].country, '印度');
  assert.equal(customers.items[0].countryEnglish, 'INDIA');
  assert.equal(customers.items[0].countryCode, 'IN');
  assert.equal(customers.items[0].industry, '电子电气');
  assert.equal(customers.items[0].productRange, '电子产品');
  assert.equal(customers.items[0].customerStateId, '2');
  assert.equal(customers.items[0].customerState, '意向');
  assert.equal(customers.items[0].isPublicSea, false);
  assert.equal(customers.items[0].publicSeaGroupId, '1');
  assert.equal(customers.items[0].ownerName, '公海客户');
  assert.deepEqual(customerListBody.seniorSelection.selectionItemList[0], {
    fieldId: '1110018',
    operatorId: '73',
    itemValue: ['12345678'],
  });
  assert.deepEqual(customerListBody.orderBy, {
    desc: 'desc',
    realFieldName: 'modify_date',
    tableCode: '1',
  });
  assert.equal(customer.companyName, 'Test Power');
  assert.equal(contacts[0].email, 'anika@example.com');
  assert.equal(contacts[0].emailSource, 'fumeng_contact');
  assert.equal(authCalls, 1);
});

test('Fumeng client refreshes a cached token once after an upstream 401', async () => {
  let authCalls = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/auth-server/open/acquire_token')) {
      authCalls += 1;
      return jsonResponse({ code: '0', data: [{ accessToken: `token-${authCalls}`, companyId: 930261 }] });
    }
    const body = JSON.parse(options.body);
    if (url.endsWith('/bill-server/pure/get_page_list') && options.headers.accessToken === 'token-1') {
      return jsonResponse({}, 401);
    }
    if (url.endsWith('/bill-server/pure/getControlValue') || url.endsWith('/bill-server/pure/getControlData')) {
      return jsonResponse({ code: '0', data: [] });
    }
    assert.equal(body.moduleCode, 'NewBF001');
    return jsonResponse({ code: '0', data: { totalNum: 0, list: [] } });
  };
  const client = new FumengClient(
    { baseUrl: 'https://fumeng.example', appId: 'app', appSecret: 'secret', publicSeaOwnerId: 'owner' },
    { fetchImpl },
  );

  const result = await client.listCustomers({ scope: 'all' });

  assert.equal(result.total, 0);
  assert.equal(authCalls, 2);
});

test('Fumeng customer list can query and sort the public sea scope server-side', async () => {
  let selection;
  let orderBy;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/auth-server/open/acquire_token')) {
      return jsonResponse({ code: '0', data: [{ accessToken: 'token', companyId: 930261 }] });
    }
    if (url.endsWith('/bill-server/pure/getControlValue') || url.endsWith('/bill-server/pure/getControlData')) {
      return jsonResponse({ code: '0', data: [] });
    }
    selection = body.seniorSelection;
    orderBy = body.orderBy;
    return jsonResponse({ code: '0', data: { totalNum: 0, list: [] } });
  };
  const client = new FumengClient(
    { baseUrl: 'https://fumeng.example', appId: 'app', appSecret: 'secret', publicSeaOwnerId: '12345678' },
    { fetchImpl },
  );

  const result = await client.listCustomers({ scope: 'public', sortBy: 'country', sortDirection: 'asc' });

  assert.equal(result.scope, 'public');
  assert.deepEqual(selection.selectionItemList[0], {
    fieldId: '1110018',
    operatorId: '72',
    itemValue: ['12345678'],
  });
  assert.equal(result.sortBy, 'country');
  assert.equal(result.sortDirection, 'asc');
  assert.deepEqual(orderBy, {
    desc: 'asc',
    realFieldName: 'country_id',
    tableCode: '1',
  });
});

test('Fumeng customer list can exclude the public sea owner server-side', async () => {
  let selection;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/auth-server/open/acquire_token')) {
      return jsonResponse({ code: '0', data: [{ accessToken: 'token', companyId: 930261 }] });
    }
    if (url.endsWith('/bill-server/pure/getControlValue') || url.endsWith('/bill-server/pure/getControlData')) {
      return jsonResponse({ code: '0', data: [] });
    }
    selection = body.seniorSelection;
    return jsonResponse({ code: '0', data: { totalNum: 0, list: [] } });
  };
  const client = new FumengClient(
    { baseUrl: 'https://fumeng.example', appId: 'app', appSecret: 'secret', publicSeaOwnerId: '12345678' },
    { fetchImpl },
  );

  await client.listCustomers({ scope: 'private' });

  assert.deepEqual(selection.selectionItemList[0], {
    fieldId: '1110018',
    operatorId: '73',
    itemValue: ['12345678'],
  });
});

test('Fumeng write-back only sends allowed fields and creates an attached contact', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/auth-server/open/acquire_token')) {
      return jsonResponse({ code: '0', data: [{ accessToken: 'token', companyId: 1 }] });
    }
    requests.push({ url, body });
    return jsonResponse({ code: '0', data: url.endsWith('/add_one') ? 'contact-new' : true });
  };
  const client = new FumengClient({
    baseUrl: 'https://fumeng.example', appId: 'app', appSecret: 'secret',
    publicSeaOwnerId: 'owner', writebackEnabled: true,
  }, { fetchImpl });

  await client.updateCustomerFields('customer-1', { web: 'https://example.com', custName: 'blocked' });
  const contact = await client.addContact({
    id: 'customer-1', companyName: 'Example', ownerContactId: 'owner-1', ownerDepartmentKey: 'dept-1',
  }, {
    name: 'Alex Buyer', email: 'Alex@Example.com', jobRole: 'Purchasing Manager',
    linkedin: 'https://linkedin.example/alex', remarks: 'Data source: Apollo',
  });

  assert.deepEqual(requests[0].body.modify, { web: 'https://example.com' });
  assert.equal(requests[0].body.moduleCode, 'NewBF001');
  await client.updateContactFields('contact-1', { jobs: 'Purchasing Manager', customint2: 'blocked' });
  assert.deepEqual(requests[2].body.modify, { jobs: 'Purchasing Manager' });
  const added = requests[1].body.bill['1'][0];
  assert.equal(added.custId, 'customer-1');
  assert.equal(added.ownerCtId, 'owner-1');
  assert.equal(added.ownerDeptKey, 'dept-1');
  assert.equal(added.mailAddress, 'alex@example.com');
  assert.equal(added.nickName, 'Alex Buyer');
  assert.equal(added.jobs, 'Purchasing Manager');
  assert.equal(contact.id, 'contact-new');
});

test('Fumeng client exposes structured upstream error messages', async () => {
  const client = new FumengClient(
    { baseUrl: 'https://fumeng.example', appId: 'app', appSecret: 'secret' },
    {
      fetchImpl: async () => jsonResponse({
        code: '1007',
        msg: { errorMessage: '数据校验错误 %s', data: 'trackMode' },
      }),
    },
  );

  await assert.rejects(
    client.getAccessToken(),
    (error) => error.code === 'FUMENG_API_ERROR' && error.message.includes('数据校验错误 %s trackMode'),
  );
});
