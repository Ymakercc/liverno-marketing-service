import assert from 'node:assert/strict';
import test from 'node:test';
import { ApolloClient, normalizeDomain } from '../src/lib/apollo-client.mjs';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('Apollo client uses header authentication and maps company and people results', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (url.endsWith('/organizations/enrich')) {
      return response({ organization: { id: 'org-1', name: 'Example Ltd', primary_domain: 'www.example.com', country: 'India' } });
    }
    if (url.endsWith('/mixed_people/api_search')) {
      return response({ people: [{ id: 'person-1', first_name: 'Asha', last_name: 'Rao', title: 'Procurement Manager' }] });
    }
    return response({ person: { id: 'person-1', name: 'Asha Rao', title: 'Procurement Manager', email: 'asha@example.com', email_status: 'verified' } });
  };
  const client = new ApolloClient({ baseUrl: 'https://api.apollo.test', apiKey: 'secret' }, { fetchImpl });

  const organization = await client.enrichOrganization('https://www.example.com/about');
  const people = await client.searchPeople({ domain: organization.domain });
  const person = await client.matchPerson({ id: people[0].id });

  assert.equal(normalizeDomain('https://www.example.com/about'), 'example.com');
  assert.equal(organization.domain, 'example.com');
  assert.equal(person.emailStatus, 'verified');
  assert.equal(calls[0].options.headers['x-api-key'], 'secret');
  assert.equal(calls[1].body.q_organization_domains_list[0], 'example.com');
  assert.equal(calls[2].body.reveal_personal_emails, false);
});

test('Apollo domain normalization selects the company website from mixed CRM links', () => {
  assert.equal(
    normalizeDomain('poweronaustralia.com.au,https://linkedin.com/company/power-on,https://youtube.com/example'),
    'poweronaustralia.com.au',
  );
  assert.equal(normalizeDomain('https://www.example.com/products'), 'example.com');
  assert.equal(
    normalizeDomain('https://www.google.com.hk/url?url=http%3A%2F%2Fwww.tamakicontrol.com%2F&sa=t'),
    'tamakicontrol.com',
  );
});

test('Apollo client exposes exhausted credits as a permanent research pause signal', async () => {
  const client = new ApolloClient(
    { baseUrl: 'https://api.apollo.test', apiKey: 'secret' },
    { fetchImpl: async () => response({ error: 'Insufficient Apollo credits for this request' }, 422) },
  );

  await assert.rejects(
    client.enrichOrganization('example.com'),
    (error) => error.code === 'APOLLO_CREDITS_EXHAUSTED' && error.status === 429,
  );
});

test('Apollo client does not mistake temporary rate limiting for exhausted credits', async () => {
  const client = new ApolloClient(
    { baseUrl: 'https://api.apollo.test', apiKey: 'secret' },
    { fetchImpl: async () => response({ error: 'Too many requests, retry later' }, 429) },
  );

  await assert.rejects(
    client.enrichOrganization('example.com'),
    (error) => error.code === 'UPSTREAM_HTTP_ERROR',
  );
});
