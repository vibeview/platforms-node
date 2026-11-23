import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AbortedError, APIError, VibeViewError } from '../src/index';
import {
  account,
  errorBody,
  fakeApi,
  KEY,
  ORG,
  PTN,
  testClient,
  TOKEN,
  type Reply,
  type Seen,
} from './helpers';

const me = (id = PTN) => ({
  status: 200,
  body: {
    object: 'partner',
    id,
    name: 'Acme',
    environment: 'test',
    livemode: false,
    account: null,
  },
});
const list = (): Reply => ({
  status: 200,
  body: { object: 'list', data: [account(ORG)], has_more: false },
});
const isMe = (seen: Seen) => seen.url.pathname === '/api/v1/partners/me';
const lookups = (seen: Seen[]) => seen.filter(isMe).length;

describe('the partner id, found from the key', () => {
  it('many concurrent first calls share ONE lookup', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? { ...me(), delayMs: 50 } : list()));
    const { client } = testClient(api, { partner: undefined });
    const pages = await Promise.all(Array.from({ length: 5 }, () => client.accounts.list()));
    expect(pages.every((p) => p.data[0]?.id === ORG)).toBe(true);
    expect(lookups(api.seen)).toBe(1);
    for (const seen of api.seen.filter((s) => !isMe(s))) {
      expect(seen.url.pathname).toBe(`/api/v1/partners/${PTN}/accounts`);
    }
    // Later calls reuse it.
    await client.contract.retrieve();
    expect(lookups(api.seen)).toBe(1);
  });

  it('a failed lookup is not kept: the next call tries again', async () => {
    let first = true;
    const api = await fakeApi((seen) => {
      if (isMe(seen)) {
        if (first) {
          first = false;
          return { status: 500, body: errorBody('internal_error', 'Something went wrong.') };
        }
        return me();
      }
      return list();
    });
    const { client } = testClient(api, { partner: undefined, maxRetries: 0 });
    await expect(client.accounts.list()).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
    });
    const page = await client.accounts.list();
    expect(page.data[0]?.id).toBe(ORG);
    expect(lookups(api.seen)).toBe(2);
  });

  it('the partner option skips the lookup', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? me() : list()));
    await testClient(api, { partner: PTN }).client.accounts.list();
    expect(lookups(api.seen)).toBe(0);
  });

  it.each(['..', 'a/b', '', 'ptn x'])(
    'a looked-up id %j that is not an id is refused, and nothing else is sent',
    async (id) => {
      const api = await fakeApi((seen) => (isMe(seen) ? me(id) : list()));
      const { client } = testClient(api, { partner: undefined });
      const error = await client.accounts.list().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VibeViewError);
      expect((error as Error).message).toMatch(/partner id/);
      expect(api.seen.map((s) => s.url.pathname)).toEqual(['/api/v1/partners/me']);
    },
  );

  it('withAccount clients share the cache, both ways', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? me() : list()));
    const { client } = testClient(api, { partner: undefined });
    const child = client.withAccount(ORG);
    await child.accounts.list();
    await client.accounts.list();
    await client.withAccount(ORG).contract.retrieve();
    expect(lookups(api.seen)).toBe(1);
  });

  it('an aborted first caller does not break a concurrent second caller', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? { ...me(), delayMs: 150 } : list()));
    const { client } = testClient(api, { partner: undefined });
    const controller = new AbortController();
    const first = client.accounts.list({}, { signal: controller.signal }).catch((e: unknown) => e);
    const second = client.accounts.list();
    setTimeout(() => controller.abort(), 20);
    expect(await first).toBeInstanceOf(AbortedError);
    expect((await second).data[0]?.id).toBe(ORG);
    expect(lookups(api.seen)).toBe(1);
    // And the result is kept for later calls.
    await client.accounts.list();
    expect(lookups(api.seen)).toBe(1);
  });

  it('a caller timeout ends only that caller’s wait', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? { ...me(), delayMs: 150 } : list()));
    const { client } = testClient(api, { partner: undefined });
    const first = client.accounts.list({}, { timeoutMs: 20 }).catch((e: unknown) => e);
    const second = client.accounts.list();
    expect((await first) as Error).toMatchObject({ name: 'TimeoutError' });
    expect((await second).data[0]?.id).toBe(ORG);
    expect(lookups(api.seen)).toBe(1);
  });

  it('a token client: key-only calls are still refused before anything is sent', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? me() : list()));
    const { client } = testClient(api, { partner: undefined, accessToken: TOKEN });
    await expect(client.accounts.list()).rejects.toThrow(/needs a partner key/);
    expect(api.seen).toHaveLength(0);
  });

  it('partner.retrieve answers with a key or a token', async () => {
    const api = await fakeApi([me()]);
    for (const credential of [{}, { accessToken: TOKEN }]) {
      const partner = await testClient(api, credential).client.partner.retrieve();
      expect(partner).toMatchObject({ object: 'partner', id: PTN, environment: 'test' });
    }
    expect(lookups(api.seen)).toBe(2);
  });

  it.each([
    ['an API error', [{ status: 401, body: errorBody('unauthorized', 'No.') }]],
    ['a dropped connection', ['drop' as const]],
  ])('the lookup’s errors never show the key (%s)', async (_name, replies) => {
    const api = await fakeApi(replies as Reply[]);
    const { client } = testClient(api, { partner: undefined, maxRetries: 0 });
    const error = await client.accounts.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    if (replies[0] !== 'drop') expect(error).toBeInstanceOf(APIError);
    for (const text of [
      inspect(error, { depth: 10, showHidden: true }),
      String(error),
      JSON.stringify(error),
    ]) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('x'.repeat(38));
    }
  });

  it('partner.retrieve fills the cache: the calls after it send no lookup', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? me() : list()));
    const { client } = testClient(api, { partner: undefined });
    const partner = await client.partner.retrieve();
    expect(partner.id).toBe(PTN);
    await client.accounts.list();
    await client.withAccount(ORG).contract.retrieve();
    expect(lookups(api.seen)).toBe(1);
  });

  it('partner.retrieve shares a lookup already in flight', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? { ...me(), delayMs: 50 } : list()));
    const { client } = testClient(api, { partner: undefined });
    const [page, partner] = await Promise.all([client.accounts.list(), client.partner.retrieve()]);
    expect(page.data[0]?.id).toBe(ORG);
    expect(partner.id).toBe(PTN);
    expect(lookups(api.seen)).toBe(1);
  });

  it('partner.retrieve refuses an answer whose id is not an id, and keeps nothing', async () => {
    let answer = '..';
    const api = await fakeApi((seen) => (isMe(seen) ? me(answer) : list()));
    const { client } = testClient(api, { partner: undefined });
    await expect(client.partner.retrieve()).rejects.toThrow(/partner id/);
    answer = PTN;
    await client.accounts.list();
    expect(lookups(api.seen)).toBe(2);
  });

  it('a failed partner.retrieve after a good one keeps the known id', async () => {
    let fail = false;
    const api = await fakeApi((seen) => {
      if (isMe(seen)) {
        return fail ? { status: 404, body: errorBody('not_found', 'Not found.') } : me();
      }
      return list();
    });
    const { client } = testClient(api, { partner: undefined });
    await client.partner.retrieve();
    fail = true;
    await expect(client.partner.retrieve({ maxRetries: 0 })).rejects.toBeInstanceOf(APIError);
    expect(lookups(api.seen)).toBe(2);
    // The next call still knows the id: no third lookup.
    await client.accounts.list();
    expect(lookups(api.seen)).toBe(2);
    expect(api.seen.at(-1)?.url.pathname).toBe(`/api/v1/partners/${PTN}/accounts`);
  });

  it('a good partner.retrieve after a good one replaces the known answer', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? me() : list()));
    const { client } = testClient(api, { partner: undefined });
    await client.partner.retrieve();
    await client.partner.retrieve();
    await client.accounts.list();
    expect(lookups(api.seen)).toBe(2);
  });

  it('concurrent partner.retrieve callers share one request and each get their own object', async () => {
    const api = await fakeApi((seen) => (isMe(seen) ? { ...me(), delayMs: 30 } : list()));
    const { client } = testClient(api, { partner: undefined });
    for (const round of [1, 2]) {
      const [a, b] = await Promise.all([client.partner.retrieve(), client.partner.retrieve()]);
      expect(lookups(api.seen)).toBe(round);
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
      expect(a.lastResponse.status).toBe(200);
      expect(b.lastResponse.status).toBe(200);
      expect(Object.keys(a)).not.toContain('lastResponse');
      expect(a.lastResponse).not.toBe(b.lastResponse);
      expect(a.lastResponse).toEqual(b.lastResponse);
      expect(Object.isFrozen(a.lastResponse)).toBe(true);
      expect(Object.isFrozen(a.lastResponse.headers)).toBe(true);
      expect(a.lastResponse.headers).not.toBe(b.lastResponse.headers);
      (a as { name: string }).name = 'changed';
      expect(b.name).toBe('Acme');
    }
  });
});
