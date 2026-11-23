import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { App, List } from '../src/index';
import { fakeApi, ORG, testClient } from './helpers';

// A real `GET /apps/` answer in an account (the API's own test suite writes it).
const real = JSON.parse(
  readFileSync(new URL('fixtures/list-apps.json', import.meta.url), 'utf8'),
) as { status: number; body: List<App> };

describe('apps', () => {
  it('lists the apps of a real answer, typed, in the account', async () => {
    const api = await fakeApi([{ status: real.status, body: real.body }]);
    const page = await testClient(api, { account: ORG }).client.apps.list({ limit: 10 });
    expect(page.hasMore).toBe(false);
    const [app] = page.data;
    expect(app?.object).toBe('app');
    expect(app?.access).toBe('shared');
    expect(typeof app?.id).toBe('string');
    expect(typeof app?.platform).toBe('string');
    expect(JSON.parse(JSON.stringify(page))).toEqual(real.body);
    expect(api.seen[0]?.method).toBe('GET');
    expect(api.seen[0]?.url.pathname).toBe('/api/v1/apps/');
    expect(api.seen[0]?.url.searchParams.get('limit')).toBe('10');
  });

  it('retrieves one app by its id', async () => {
    const one = real.body.data[0];
    const api = await fakeApi([{ status: 200, body: one }]);
    const got = await testClient(api, { account: ORG }).client.apps.retrieve(one!.id);
    expect(got.id).toBe(one!.id);
    expect(api.seen[0]?.url.pathname).toBe(`/api/v1/apps/${one!.id}`);
  });
});
