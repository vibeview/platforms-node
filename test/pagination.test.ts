import { describe, expect, it } from 'vitest';
import { account, fakeApi, ORG, PTN, testClient } from './helpers';

const page = (ids: string[], hasMore: boolean) => ({
  object: 'list',
  data: ids.map((id) => account(id)),
  has_more: hasMore,
});

describe('lists', () => {
  it('nextPage sends starting_after = the last id, keeping the other parameters', async () => {
    const api = await fakeApi([
      { status: 200, body: page(['org_a', 'org_b'], true) },
      { status: 200, body: page(['org_c'], false) },
    ]);
    const { client } = testClient(api);
    const first = await client.accounts.list({ limit: 2 });
    expect(first.hasMore).toBe(true);
    expect(first.data.map((a) => a.id)).toEqual(['org_a', 'org_b']);
    const second = await first.nextPage();
    expect(second?.data.map((a) => a.id)).toEqual(['org_c']);
    expect(second?.hasMore).toBe(false);
    expect(second?.nextPage()).toBeNull();
    expect(api.seen[1]?.url.pathname).toBe(`/api/v1/partners/${PTN}/accounts`);
    expect(Object.fromEntries(api.seen[1]?.url.searchParams ?? [])).toEqual({
      limit: '2',
      starting_after: 'org_b',
    });
  });

  it('iterating a list call walks every page and stops at has_more false', async () => {
    const api = await fakeApi([
      { status: 200, body: page(['org_a', 'org_b'], true) },
      { status: 200, body: page(['org_c'], true) },
      { status: 200, body: page(['org_d'], false) },
    ]);
    const ids: string[] = [];
    for await (const item of testClient(api).client.accounts.list({ limit: 2 })) ids.push(item.id);
    expect(ids).toEqual(['org_a', 'org_b', 'org_c', 'org_d']);
    expect(api.seen).toHaveLength(3);
  });

  it('a page is iterable too, and its JSON is exactly the API answer', async () => {
    const body = page(['org_a'], false);
    const api = await fakeApi([{ status: 200, body }]);
    const first = await testClient(api).client.accounts.list();
    const ids: string[] = [];
    for await (const item of first) ids.push(item.id);
    expect(ids).toEqual(['org_a']);
    expect(JSON.parse(JSON.stringify(first))).toEqual(body);
    expect(first.lastResponse.status).toBe(200);
  });

  it('keeps list members other than data (usage current_period)', async () => {
    const body = { object: 'list', data: [], has_more: false, current_period: { start: 1 } };
    const api = await fakeApi([{ status: 200, body }]);
    const usage = await testClient(api, { account: ORG }).client.usage.list();
    expect(usage.current_period).toEqual({ start: 1 });
  });

  it('device offerings do not page', async () => {
    const api = await fakeApi([
      { status: 200, body: { object: 'list', data: [{ id: 'x' }], has_more: true } },
    ]);
    const pools = await testClient(api, { account: ORG }).client.devicePools.list();
    expect(pools.nextPage()).toBeNull();
  });
});

describe('accounts.findByExternalRef', () => {
  it('asks for the external_ref and returns the account', async () => {
    const api = await fakeApi([{ status: 200, body: page([ORG], false) }]);
    const found = await testClient(api).client.accounts.findByExternalRef('cust_1042');
    expect(found?.id).toBe(ORG);
    expect(found?.lastResponse.status).toBe(200);
    expect(Object.fromEntries(api.seen[0]?.url.searchParams ?? [])).toEqual({
      external_ref: 'cust_1042',
      limit: '1',
    });
  });

  it('returns null on an empty list', async () => {
    const api = await fakeApi([{ status: 200, body: page([], false) }]);
    expect(await testClient(api).client.accounts.findByExternalRef('nobody')).toBeNull();
  });
});
