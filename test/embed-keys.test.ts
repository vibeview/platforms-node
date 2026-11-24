import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EmbedKey, List } from '../src/index';
import { fakeApi, PTN, testClient } from './helpers';

// A real `GET /partners/{ptn}/embed-keys` answer (the API's own test suite writes it).
const real = JSON.parse(
  readFileSync(new URL('fixtures/list-embed-keys.json', import.meta.url), 'utf8'),
) as { status: number; body: List<EmbedKey> };

describe('embed keys', () => {
  it('lists the embed keys of a real answer, typed, from the partner tree', async () => {
    const api = await fakeApi([{ status: real.status, body: real.body }]);
    const page = await testClient(api).client.embedKeys.list({ limit: 10 });
    expect(page.hasMore).toBe(false);
    const [key] = page.data;
    expect(key?.object).toBe('embed_key');
    expect(key?.id).toMatch(/^ek_test_[a-z0-9]{24}$/);
    expect(typeof key?.app).toBe('string');
    expect(key?.livemode).toBe(false);
    expect(key?.allowed_domains).toEqual(['demo.example.com']);
    expect(key?.limits.sessions_per_visitor).toBe(1);
    expect(key?.device_config.show_picker).toBe(false);
    expect(key && 'secret' in key).toBe(false);
    expect(JSON.parse(JSON.stringify(page))).toEqual(real.body);
    expect(api.seen[0]?.method).toBe('GET');
    expect(api.seen[0]?.url.pathname).toBe(`/api/v1/partners/${PTN}/embed-keys`);
    expect(api.seen[0]?.url.searchParams.get('limit')).toBe('10');
  });
});
