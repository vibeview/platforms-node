import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { List, Share } from '../src/index';
import { fakeApi, PTN, testClient } from './helpers';

// A real `GET /partners/{ptn}/shares` answer (the API's own test suite writes it).
const real = JSON.parse(
  readFileSync(new URL('fixtures/list-shares.json', import.meta.url), 'utf8'),
) as { status: number; body: List<Share> };

describe('shares', () => {
  it('lists the shares of a real answer, typed, from the partner tree', async () => {
    const api = await fakeApi([{ status: real.status, body: real.body }]);
    const page = await testClient(api).client.shares.list({ limit: 10 });
    expect(page.hasMore).toBe(false);
    const [share] = page.data;
    expect(share?.object).toBe('share');
    expect(share?.id).toMatch(/^shr_[0-9a-f]{16}$/);
    expect(share?.kind).toBe('app');
    expect(typeof share?.app).toBe('string');
    expect(typeof share?.app_name).toBe('string');
    expect(typeof share?.platform).toBe('string');
    expect(JSON.parse(JSON.stringify(page))).toEqual(real.body);
    expect(api.seen[0]?.method).toBe('GET');
    expect(api.seen[0]?.url.pathname).toBe(`/api/v1/partners/${PTN}/shares`);
    expect(api.seen[0]?.url.searchParams.get('limit')).toBe('10');
  });
});
