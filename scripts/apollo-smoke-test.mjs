import { ApolloClient } from '../src/lib/apollo-client.mjs';
import { createConfig } from '../src/config.mjs';

const config = createConfig();
if (!config.apollo.apiKey) throw new Error('APOLLO_API_KEY 未配置');
const apollo = new ApolloClient(config.apollo);

const checks = [];
async function check(name, action) {
  try {
    const result = await action();
    checks.push({ name, ok: true });
    return result;
  } catch (error) {
    checks.push({ name, ok: false, code: error.code || 'ERROR', message: error.message });
    return null;
  }
}

const organization = await check('公司补全 Organization Enrichment', () =>
  apollo.enrichOrganization('apollo.io'));
const organizations = await check('公司搜索 Organization Search', () =>
  apollo.searchOrganizations({ name: 'Apollo.io', country: 'United States', limit: 3 }));
const people = await check('联系人搜索 People Search', () =>
  apollo.searchPeople({
    domain: organization?.domain || organizations?.[0]?.domain || 'apollo.io',
    organizationId: organization?.id || organizations?.[0]?.id || '',
    titles: ['sales manager'],
    limit: 3,
  }));
const firstPerson = people?.[0];
const person = firstPerson
  ? await check('联系人补全 People Match', () => apollo.matchPerson({
      id: firstPerson.id,
      firstName: firstPerson.firstName,
      lastName: firstPerson.lastName,
      domain: organization?.domain || 'apollo.io',
    }))
  : null;
if (!firstPerson) checks.push({
  name: '联系人补全 People Match',
  ok: false,
  code: 'NO_TEST_PERSON',
  message: 'People Search 未返回可用的测试联系人',
});

const ok = checks.every((item) => item.ok);
console.log(JSON.stringify({
  ok,
  checks,
  sample: {
    organizationMatched: Boolean(organization?.id || organizations?.[0]?.id),
    peopleFound: people?.length || 0,
    personMatched: Boolean(person?.id),
    verifiedEmailReturned: ['verified', 'valid'].includes(person?.emailStatus),
  },
  note: 'People Match 最多消耗 1 个 Apollo 邮箱 Credit；输出不包含邮箱或 API Key。',
}, null, 2));
if (!ok) process.exitCode = 1;
