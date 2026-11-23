import { describe, expect, it } from 'vitest';
import { INTERNAL } from '../src/internal';
import {
  AbortedError,
  APIError,
  type ClientOptions,
  ConnectionError,
  RateLimitError,
  TimeoutError,
  VibeView,
  VibeViewError,
} from '../src/index';
import { account, errorBody, fakeApi, KEY, NOW, ORG, PTN, testClient, TOKEN } from './helpers';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sessionsList = { object: 'list', data: [], has_more: false };
const unavailable = { status: 503, body: errorBody('busy', 'Busy, try again.') };

describe('headers', () => {
  it('sends a partner key as a bearer token, with the package User-Agent', async () => {
    const api = await fakeApi([{ status: 200, body: { object: 'contract' } }]);
    await testClient(api).client.contract.retrieve();
    expect(api.seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(api.seen[0]?.headers['user-agent']).toBe(`vibeview-platforms-node/${VibeView.VERSION}`);
    expect(api.seen[0]?.url.pathname).toBe(`/api/v1/partners/${PTN}/contract`);
  });

  it('sends an access token as a bearer token', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList }]);
    await testClient(api, { accessToken: TOKEN }).client.sessions.list();
    expect(api.seen[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('sends VibeView-Account only from withAccount or the account option', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList }]);
    await testClient(api, { accessToken: TOKEN }).client.sessions.list();
    await testClient(api).client.withAccount(ORG).sessions.list();
    await testClient(api, { account: ORG }).client.sessions.list();
    expect(api.seen.map((s) => s.headers['vibeview-account'])).toEqual([undefined, ORG, ORG]);
  });

  it('never sends VibeView-Account on a partner route (the account is in the path)', async () => {
    const api = await fakeApi([{ status: 200, body: account(ORG) }]);
    await testClient(api, { account: ORG }).client.accounts.retrieve(ORG);
    expect(api.seen[0]?.headers['vibeview-account']).toBeUndefined();
    expect(api.seen[0]?.url.pathname).toBe(`/api/v1/partners/${PTN}/accounts/${ORG}`);
  });

  it('withAccount keeps the original client unchanged', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList }]);
    const { client } = testClient(api);
    client.withAccount(ORG);
    await expect(client.sessions.list()).rejects.toThrow(/acts in an account/);
    expect(api.seen).toHaveLength(0);
  });

  it('an in-account call with a partner key and no account throws before sending', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList }]);
    const error = await testClient(api)
      .client.sessions.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VibeViewError);
    expect((error as Error).message).toMatch(/withAccount/);
    expect(api.seen).toHaveLength(0);
  });

  it('a partner-key call with an access token throws before sending', async () => {
    const api = await fakeApi([{ status: 200, body: account(ORG) }]);
    const { client } = testClient(api, { accessToken: TOKEN });
    for (const call of [() => client.accounts.list(), () => client.contract.retrieve()]) {
      await expect(call()).rejects.toThrow(/needs a partner key/);
    }
    expect(api.seen).toHaveLength(0);
  });
});

describe('idempotency keys', () => {
  it('a POST that creates gets a UUIDv4 key, and the SAME key on each retry', async () => {
    const api = await fakeApi([unavailable, 'drop', { status: 201, body: account(ORG) }]);
    const { client } = testClient(api);
    await client.accounts.create({ external_ref: 'cust_1042' });
    const keys = api.seen.map((s) => s.headers['idempotency-key']);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toMatch(UUID_V4);
    expect(new Set(keys).size).toBe(1);
  });

  it('each call gets its own key', async () => {
    const api = await fakeApi([{ status: 201, body: account(ORG) }]);
    const { client } = testClient(api);
    await client.accounts.create({ external_ref: 'a' });
    await client.accounts.create({ external_ref: 'b' });
    expect(api.seen[0]?.headers['idempotency-key']).not.toBe(
      api.seen[1]?.headers['idempotency-key'],
    );
  });

  it('sends the caller key as given', async () => {
    const api = await fakeApi([{ status: 201, body: account(ORG) }]);
    await testClient(api).client.accounts.create(
      { external_ref: 'a' },
      { idempotencyKey: 'acct-a' },
    );
    expect(api.seen[0]?.headers['idempotency-key']).toBe('acct-a');
  });

  it('the collab PUT takes a key', async () => {
    const api = await fakeApi([{ status: 200, body: { object: 'collab_credential' } }]);
    await testClient(api, { account: ORG }).client.sessions.collab.update('s1', { enabled: true });
    expect(api.seen[0]?.method).toBe('PUT');
    expect(api.seen[0]?.headers['idempotency-key']).toMatch(UUID_V4);
  });

  it('a call that takes no key sends none, and refuses one', async () => {
    const api = await fakeApi([{ status: 200, body: { object: 'session_control' } }]);
    const { client } = testClient(api, { account: ORG });
    await client.sessions.control('s1', { action: 'tap', x: 1, y: 2 } as never);
    expect(api.seen[0]?.headers['idempotency-key']).toBeUndefined();
    await expect(
      client.sessions.control('s1', {} as never, { idempotencyKey: 'k' }),
    ).rejects.toThrow(/takes no idempotencyKey/);
    expect(api.seen).toHaveLength(1);
  });

  it('refuses a key the API would refuse', async () => {
    const api = await fakeApi([{ status: 201, body: account(ORG) }]);
    await expect(
      testClient(api).client.accounts.create(
        { external_ref: 'a' },
        { idempotencyKey: 'has space' },
      ),
    ).rejects.toThrow(/idempotencyKey option/);
    expect(api.seen).toHaveLength(0);
  });
});

describe('retries', () => {
  it.each([
    ['a dropped connection', 'drop' as const],
    ['a 500', { status: 500, body: errorBody('internal_error', 'Something went wrong.') }],
    ['a 503', unavailable],
    ['a 429', { status: 429, body: errorBody('rate_limited', 'Slow down.', { limit: 'partner' }) }],
  ])('GET retries after %s', async (_name, first) => {
    const api = await fakeApi([first, { status: 200, body: sessionsList }]);
    const page = await testClient(api, { account: ORG }).client.sessions.list();
    expect(page.data).toEqual([]);
    expect(api.seen).toHaveLength(2);
  });

  it('DELETE retries after a 503', async () => {
    const api = await fakeApi([unavailable, { status: 200, body: { object: 'session' } }]);
    await testClient(api, { account: ORG }).client.sessions.end('s1');
    expect(api.seen.map((s) => s.method)).toEqual(['DELETE', 'DELETE']);
  });

  it('a POST without a key (a device input) is never retried', async () => {
    const api = await fakeApi([unavailable, { status: 200, body: {} }]);
    await expect(
      testClient(api, { account: ORG }).client.sessions.control('s1', {} as never),
    ).rejects.toBeInstanceOf(APIError);
    expect(api.seen).toHaveLength(1);
  });

  it('a POST without a key is not retried after a dropped connection either', async () => {
    const api = await fakeApi(['drop', { status: 200, body: {} }]);
    await expect(
      testClient(api, { account: ORG }).client.sessions.runAgentTool('s1', {} as never),
    ).rejects.toBeInstanceOf(ConnectionError);
    expect(api.seen).toHaveLength(1);
  });

  it('a PATCH (accounts.update) is retried like a read: the same body again changes nothing', async () => {
    const api = await fakeApi([unavailable, 'drop', { status: 200, body: account(ORG) }]);
    const { client } = testClient(api);
    const updated = await client.accounts.update(ORG, { display_name: 'Northwind' });
    expect(updated.id).toBe(ORG);
    expect(api.seen).toHaveLength(3);
    expect(api.seen.every((seen) => seen.method === 'PATCH')).toBe(true);
    expect(new Set(api.seen.map((seen) => seen.body))).toEqual(
      new Set([JSON.stringify({ display_name: 'Northwind' })]),
    );
    expect(api.seen.every((seen) => seen.headers['idempotency-key'] === undefined)).toBe(true);
  });

  it('a PATCH answered 4xx is not retried', async () => {
    const api = await fakeApi([
      { status: 422, body: errorBody('validation_error', 'Bad.') },
      { status: 200, body: account(ORG) },
    ]);
    await expect(testClient(api).client.accounts.update(ORG, {})).rejects.toBeInstanceOf(APIError);
    expect(api.seen).toHaveLength(1);
  });

  it('409 idempotency_in_progress waits Retry-After and retries with the same key', async () => {
    const api = await fakeApi([
      {
        status: 409,
        body: errorBody('idempotency_in_progress', 'Still running.'),
        headers: { 'Retry-After': '1' },
      },
      { status: 201, body: account(ORG) },
    ]);
    const { client, delays } = testClient(api);
    await client.accounts.create({ external_ref: 'a' });
    expect(delays).toEqual([1000]);
    expect(api.seen[0]?.headers['idempotency-key']).toBe(api.seen[1]?.headers['idempotency-key']);
  });

  it('429 waits Retry-After seconds', async () => {
    const api = await fakeApi([
      {
        status: 429,
        body: errorBody('rate_limited', 'Slow down.'),
        headers: { 'Retry-After': '7' },
      },
      { status: 200, body: sessionsList },
    ]);
    const { client, delays } = testClient(api, { account: ORG });
    await client.sessions.list();
    expect(delays).toEqual([7000]);
  });

  it('a Retry-After of 60 s is waited; a longer one fails the call at once, with retryAfterMs', async () => {
    const sixty = await fakeApi([
      {
        status: 429,
        body: errorBody('rate_limited', 'Slow down.'),
        headers: { 'Retry-After': '60' },
      },
      { status: 200, body: sessionsList },
    ]);
    const waited = testClient(sixty, { account: ORG });
    await waited.client.sessions.list();
    expect(waited.delays).toEqual([60_000]);

    const longer = await fakeApi([
      {
        status: 429,
        body: errorBody('rate_limited', 'Slow down.'),
        headers: { 'Retry-After': '61' },
      },
      { status: 200, body: sessionsList },
    ]);
    const refused = testClient(longer, { account: ORG });
    const error = await refused.client.sessions.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(61_000);
    expect(refused.delays).toEqual([]);
    expect(longer.seen).toHaveLength(1);
  });

  it('without Retry-After, full jitter over 0.5 s x 2^n, capped at 8 s', async () => {
    const api = await fakeApi([unavailable]);
    const { client, delays } = testClient(api, { account: ORG, maxRetries: 6 });
    await expect(client.sessions.list()).rejects.toBeInstanceOf(APIError);
    // random() is 0.5 in tests: half of 500, 1000, 2000, 4000, 8000, 8000 (capped).
    expect(delays).toEqual([250, 500, 1000, 2000, 4000, 4000]);
  });

  it('retries at most maxRetries times (default 2)', async () => {
    const api = await fakeApi([unavailable]);
    await expect(testClient(api, { account: ORG }).client.sessions.list()).rejects.toMatchObject({
      status: 503,
      code: 'busy',
    });
    expect(api.seen).toHaveLength(3);
  });

  it('maxRetries per call overrides the client', async () => {
    const api = await fakeApi([unavailable]);
    const { client } = testClient(api, { account: ORG });
    await expect(client.sessions.list({}, { maxRetries: 0 })).rejects.toBeInstanceOf(APIError);
    expect(api.seen).toHaveLength(1);
  });

  it.each([400, 401, 403, 404, 409, 422])('a %i is never retried', async (status) => {
    const api = await fakeApi([{ status, body: errorBody('some_code', 'No.') }]);
    await expect(testClient(api, { account: ORG }).client.sessions.list()).rejects.toMatchObject({
      status,
    });
    expect(api.seen).toHaveLength(1);
  });

  it('the last 429 is thrown as a RateLimitError', async () => {
    const api = await fakeApi([
      {
        status: 429,
        body: errorBody('rate_limited', 'Slow down.', { limit: 'account' }),
        headers: { 'Retry-After': '2' },
      },
    ]);
    const error = await testClient(api, { account: ORG })
      .client.sessions.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ retryAfterMs: 2000, limit: 'account', code: 'rate_limited' });
  });
});

describe('time limits and aborts', () => {
  it('timeoutMs aborts the attempt and throws TimeoutError', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList, delayMs: 2000 }]);
    const { client } = testClient(api, { account: ORG, timeoutMs: 50, maxRetries: 0 });
    await expect(client.sessions.list()).rejects.toBeInstanceOf(TimeoutError);
  });

  it('a timed-out GET is retried, then throws TimeoutError', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList, delayMs: 2000 }]);
    const { client } = testClient(api, { account: ORG, timeoutMs: 50, maxRetries: 1 });
    await expect(client.sessions.list()).rejects.toBeInstanceOf(TimeoutError);
    expect(api.seen).toHaveLength(2);
  });

  it("a caller's signal aborts the call without a retry", async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList, delayMs: 2000 }]);
    const { client } = testClient(api, { account: ORG });
    const controller = new AbortController();
    const call = client.sessions.list({}, { signal: controller.signal });
    const reason = new Error('caller gave up');
    setTimeout(() => controller.abort(reason), 30);
    const error = await call.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbortedError);
    expect(error).toBeInstanceOf(VibeViewError);
    expect((error as AbortedError).cause).toBe(reason);
    expect(api.seen).toHaveLength(1);
  });

  it('an abort with maxRetries 0 is an AbortedError, not a ConnectionError', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList, delayMs: 2000 }]);
    const { client } = testClient(api, { account: ORG, maxRetries: 0 });
    const controller = new AbortController();
    const call = client.sessions.list({}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    const error = await call.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbortedError);
    expect(error).not.toBeInstanceOf(ConnectionError);
  });

  it('an abort during the back-off wait is an AbortedError, and nothing more is sent', async () => {
    const api = await fakeApi([unavailable]);
    const controller = new AbortController();
    // The injected sleep aborts the signal, as a caller would while the client waits.
    const aborting = new VibeView({
      apiKey: KEY,
      partner: PTN,
      account: ORG,
      baseUrl: api.baseUrl,
      [INTERNAL]: {
        sleep: async (_ms: number, signal: AbortSignal | undefined) => {
          controller.abort();
          if (signal?.aborted) throw signal.reason;
        },
      },
    } as ClientOptions);
    const error = await aborting.sessions
      .list({}, { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AbortedError);
    expect(api.seen).toHaveLength(1);
  });

  it('a TimeoutError is a ConnectionError', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList, delayMs: 2000 }]);
    const { client } = testClient(api, { account: ORG, timeoutMs: 50, maxRetries: 0 });
    const error = await client.sessions.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toBeInstanceOf(ConnectionError);
  });

  it('an already aborted signal sends nothing', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList }]);
    const { client } = testClient(api, { account: ORG });
    await expect(client.sessions.list({}, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(
      AbortedError,
    );
    expect(api.seen).toHaveLength(0);
  });
});

describe('answers', () => {
  it('a non-JSON error body becomes APIError code unspecified with the status', async () => {
    const api = await fakeApi([{ status: 502, raw: '<html>Bad gateway</html>' }]);
    const error = await testClient(api, { account: ORG, maxRetries: 0 })
      .client.sessions.list()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ status: 502, code: 'unspecified' });
    expect((error as APIError).requestId).toMatch(/^req_/);
  });

  it('returns the body as the API sent it, with a non-enumerable lastResponse', async () => {
    const body = account(ORG);
    const api = await fakeApi([{ status: 200, body }]);
    const result = await testClient(api).client.accounts.retrieve(ORG);
    expect(JSON.parse(JSON.stringify(result))).toEqual(body);
    expect(Object.keys(result)).not.toContain('lastResponse');
    expect(result.lastResponse).toMatchObject({
      status: 200,
      requestId: 'req_000000000000000000000000',
    });
    expect(result.lastResponse.headers['content-type']).toBe('application/json');
  });

  it.each(['..', '.', '', 'a/b', 'a%2Fb', 'a?b', 'a#b', 'a\\b', 'a b', 'a\nb', 'é'])(
    'refuses the path id %j, without echoing it',
    async (id) => {
      const api = await fakeApi([{ status: 200, body: account(ORG) }]);
      const { client } = testClient(api, { account: ORG });
      for (const call of [
        () => client.sessions.retrieve(id),
        () => client.accounts.retrieve(id),
        () => client.accounts.tokens.revoke(ORG, id),
      ]) {
        const error = await call().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(VibeViewError);
        // One fixed sentence per parameter: the value is never part of it.
        expect((error as Error).message).toMatch(
          /^The (session_id|org|atok) argument must be an id: visible ASCII without \/ \? # % \\ or spaces\.$/,
        );
      }
      expect(api.seen).toHaveLength(0);
    },
  );

  it('refuses a partner option that is not an id', async () => {
    const api = await fakeApi([{ status: 200, body: {} }]);
    const { client } = testClient(api, { partner: '..' });
    await expect(client.contract.retrieve()).rejects.toThrow(/partner option/);
    expect(api.seen).toHaveLength(0);
  });

  it('sends an opaque id with other punctuation as it is', async () => {
    const api = await fakeApi([{ status: 200, body: { object: 'session' } }]);
    await testClient(api, { account: ORG }).client.sessions.retrieve('a.b-c_d~e');
    expect(api.seen[0]?.url.pathname).toBe('/api/v1/sessions/a.b-c_d~e');
  });

  it('query values go through URLSearchParams', async () => {
    const api = await fakeApi([
      { status: 200, body: { object: 'list', data: [], has_more: false } },
    ]);
    await testClient(api).client.accounts.list({ external_ref: 'a&b=c#d/../e' });
    expect(api.seen[0]?.url.pathname).toBe(`/api/v1/partners/${PTN}/accounts`);
    expect(api.seen[0]?.url.searchParams.get('external_ref')).toBe('a&b=c#d/../e');
  });

  it('a list query value is sent as the key repeated; an empty list is left out', async () => {
    const api = await fakeApi([{ status: 200, body: sessionsList }]);
    const { client } = testClient(api, { account: ORG });
    await client.sessions.list({ status: ['active', 'pending'] });
    await client.sessions.list({ status: [] });
    expect(api.seen[0]?.url.searchParams.getAll('status')).toEqual(['active', 'pending']);
    expect(api.seen[0]?.url.search).toBe('?status=active&status=pending');
    expect(api.seen[1]?.url.search).toBe('');
  });

  it('a base URL at a host root works', async () => {
    const api = await fakeApi([{ status: 200, body: { object: 'contract' } }]);
    const root = new URL(api.baseUrl).origin;
    for (const baseUrl of [root, root + '/']) {
      await testClient({ baseUrl }).client.contract.retrieve();
    }
    expect(api.seen.map((s) => s.url.pathname)).toEqual([
      `/partners/${PTN}/contract`,
      `/partners/${PTN}/contract`,
    ]);
  });
});

describe('redirects', () => {
  it.each([301, 302, 303, 307, 308])(
    'a %i is an error, never followed or retried',
    async (status) => {
      const elsewhere = await fakeApi([{ status: 200, body: { object: 'session' } }]);
      const api = await fakeApi([
        { status, headers: { Location: `${elsewhere.baseUrl}/sessions/` } },
      ]);
      const error = await testClient(api, { account: ORG })
        .client.sessions.create({} as never)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VibeViewError);
      expect(error).not.toBeInstanceOf(APIError);
      expect((error as Error).message).toMatch(/redirect.*baseUrl/);
      expect(api.seen).toHaveLength(1);
      expect(elsewhere.seen).toHaveLength(0);
    },
  );
});

describe('answers from elsewhere', () => {
  function clientWith(fakeFetch: typeof fetch) {
    return new VibeView({
      apiKey: KEY,
      partner: PTN,
      account: ORG,
      baseUrl: 'https://api.example.test/api/v1',
      fetch: fakeFetch,
      maxRetries: 2,
    });
  }

  it('an injected fetch that follows a redirect anyway: the answer is refused, not returned', async () => {
    const elsewhere = await fakeApi([{ status: 201, body: { object: 'session', id: 'evil' } }]);
    let calls = 0;
    const following = (async () => {
      calls += 1;
      // What a fetch that ignores redirect: "manual" hands back after following.
      const response = await fetch(`${elsewhere.baseUrl}/sessions/`, { method: 'POST' });
      Object.defineProperty(response, 'redirected', { value: true });
      // Some fetches leave url empty: `redirected` alone must be enough.
      Object.defineProperty(response, 'url', { value: '' });
      return response;
    }) as typeof fetch;
    const error = await clientWith(following)
      .sessions.create({} as never)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VibeViewError);
    expect((error as Error).message).toMatch(/redirect.*baseUrl/);
    expect(calls).toBe(1);
  });

  it('an answer whose URL is not the one sent is refused', async () => {
    const other = (async () => {
      const response = new Response(JSON.stringify({ object: 'session', id: 'evil' }), {
        status: 200,
      });
      Object.defineProperty(response, 'url', { value: 'https://elsewhere.example.test/x' });
      return response;
    }) as typeof fetch;
    await expect(clientWith(other).sessions.retrieve('s1')).rejects.toThrow(/redirect/);
  });

  it('a status-0 (opaque) answer says redirect or blocked, never "answered 0"', async () => {
    const opaque = (async () => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, 'status', { value: 0 });
      Object.defineProperty(response, 'type', { value: 'opaqueredirect' });
      return response;
    }) as typeof fetch;
    const error = await clientWith(opaque)
      .sessions.retrieve('s1')
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'The API answered with a redirect or a blocked response; check the baseUrl option.',
    );
  });
});

describe('response headers', () => {
  it('never keep cookies (set-cookie), on answers and on errors', async () => {
    const cookie = { 'Set-Cookie': 'lb=abc123; Path=/', 'WWW-Authenticate': 'Bearer' };
    const api = await fakeApi([
      { status: 200, body: account(ORG), headers: cookie },
      { status: 401, body: errorBody('unauthorized', 'No.'), headers: cookie },
    ]);
    const { client } = testClient(api);
    const ok = await client.accounts.retrieve(ORG);
    const error = (await client.accounts.retrieve(ORG).catch((e: unknown) => e)) as APIError;
    for (const headers of [ok.lastResponse.headers, error.headers]) {
      expect(headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(headers)).not.toContain('abc123');
      expect(headers['www-authenticate']).toBe('Bearer');
    }
  });
});

describe('error details', () => {
  it('an APIError carries the headers and Retry-After of any status', async () => {
    for (const [status, code] of [
      [503, 'device_unreachable'],
      [409, 'idempotency_in_progress'],
    ] as const) {
      const api = await fakeApi([
        {
          status,
          body: errorBody(code, 'Later.'),
          headers: { 'Retry-After': '4', RateLimit: 'x' },
        },
      ]);
      const error = (await testClient(api, { account: ORG, maxRetries: 0 })
        .client.sessions.create({} as never)
        .catch((e: unknown) => e)) as APIError;
      expect(error.retryAfterMs).toBe(4000);
      expect(error.headers['retry-after']).toBe('4');
      expect(error.headers.ratelimit).toBe('x');
    }
  });

  it('an HTTP-date Retry-After is read against the clock', async () => {
    const api = await fakeApi([
      {
        status: 429,
        body: errorBody('rate_limited', 'Slow down.'),
        headers: { 'Retry-After': new Date(NOW + 5000).toUTCString() },
      },
      { status: 200, body: sessionsList },
    ]);
    const { client, delays } = testClient(api, { account: ORG });
    await client.sessions.list();
    expect(delays).toEqual([5000]);
  });

  it('an HTTP-date Retry-After more than 60 s ahead fails the call at once, with retryAfterMs', async () => {
    const api = await fakeApi([
      {
        status: 429,
        body: errorBody('rate_limited', 'Slow down.'),
        headers: { 'Retry-After': new Date(NOW + 120_000).toUTCString() },
      },
      { status: 200, body: sessionsList },
    ]);
    const { client, delays } = testClient(api, { account: ORG });
    const error = await client.sessions.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(120_000);
    expect(delays).toEqual([]);
    expect(api.seen).toHaveLength(1);
  });

  it('a body without an error object: the message is a string detail, the code unspecified', async () => {
    const api = await fakeApi([{ status: 400, body: { detail: 'Bad thing.' } }]);
    const error = (await testClient(api, { account: ORG })
      .client.sessions.list()
      .catch((e: unknown) => e)) as APIError;
    expect(error).toMatchObject({ status: 400, code: 'unspecified', message: 'Bad thing.' });
  });

  it('a body without an error object or a string detail: the message is the status line', async () => {
    const api = await fakeApi([{ status: 422, body: { detail: [{ loc: ['query'] }] } }]);
    const error = (await testClient(api, { account: ORG })
      .client.sessions.list()
      .catch((e: unknown) => e)) as APIError;
    expect(error).toMatchObject({ status: 422, code: 'unspecified' });
    expect(error.message).toBe('The API answered 422 Unprocessable Entity.');
    expect(error.error.detail).toEqual([{ loc: ['query'] }]);
  });
});

describe('keepAlive', () => {
  it('is retried like a read (repeating it is harmless), and takes no key', async () => {
    const api = await fakeApi([unavailable, { status: 200, body: { object: 'session_presence' } }]);
    await testClient(api, { account: ORG }).client.sessions.keepAlive('s1');
    expect(api.seen).toHaveLength(2);
    expect(api.seen[0]?.headers['idempotency-key']).toBeUndefined();
  });
});
