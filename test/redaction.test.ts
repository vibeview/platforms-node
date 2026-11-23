import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { VibeView } from '../src/index';
import { errorBody, fakeApi, KEY, ORG, PTN, testClient, TOKEN } from './helpers';

const SECRETS = [KEY, TOKEN, 'x'.repeat(38), 'y'.repeat(38)];

function expectNoSecret(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

function printed(value: unknown): string[] {
  const out = [inspect(value, { depth: 10, showHidden: true }), String(value)];
  try {
    out.push(JSON.stringify(value) ?? '');
  } catch {
    // Not serialisable.
  }
  if (value instanceof Error) {
    out.push(value.message, value.stack ?? '', JSON.stringify({ ...value }));
  }
  return out;
}

describe('the client never shows its credential', () => {
  it.each([
    ['a partner key', { apiKey: KEY }, 'vvp_test_…(redacted)'],
    ['an access token', { accessToken: TOKEN }, 'vvat_…(redacted)'],
  ])('%s', (_name, credential, shown) => {
    const client = new VibeView({ ...credential, partner: PTN, account: ORG });
    for (const text of [...printed(client), ...printed(client.withAccount(ORG))]) {
      expectNoSecret(text);
    }
    expect(inspect(client)).toBe(
      `VibeView { baseUrl: "https://vibeview.io/api/v1", partner: "${PTN}", account: "${ORG}", credential: "${shown}" }`,
    );
    expect(JSON.parse(JSON.stringify(client))).toEqual({
      baseUrl: 'https://vibeview.io/api/v1',
      partner: PTN,
      account: ORG,
      credential: shown,
    });
    expect(
      Object.values(client)
        .map((v) => inspect(v, { depth: 10 }))
        .join('\n'),
    ).not.toContain('x'.repeat(38));
  });
});

describe('errors never show the credential', () => {
  it.each([
    ['an API error', [{ status: 403, body: errorBody('insufficient_scope', 'Missing scope.') }]],
    ['a non-JSON answer', [{ status: 502, raw: '<html>bad gateway</html>' }]],
    [
      'a rate limit',
      [{ status: 429, body: errorBody('rate_limited', 'Slow.', { limit: 'partner' }) }],
    ],
    ['a dropped connection', ['drop' as const]],
    ['a time-out', [{ status: 200, body: {}, delayMs: 1000 }]],
  ])('%s', async (_name, replies) => {
    for (const credential of [{ apiKey: KEY }, { accessToken: TOKEN }]) {
      const api = await fakeApi(replies);
      const { client } = testClient(api, {
        ...credential,
        account: ORG,
        maxRetries: 0,
        timeoutMs: 50,
      });
      const error = await client.sessions.list().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      for (const text of printed(error)) expectNoSecret(text);
    }
  });

  it('constructor errors never echo the value given', () => {
    const attempts = [
      () => new VibeView({ apiKey: TOKEN }),
      () => new VibeView({ accessToken: KEY }),
      () => new VibeView({ apiKey: KEY, accessToken: TOKEN }),
      () => new VibeView({ apiKey: KEY + ' ' }),
      () => new VibeView({ apiKey: KEY, baseUrl: `http://example.com/${KEY}` }),
    ];
    for (const attempt of attempts) {
      const error = (() => {
        try {
          attempt();
        } catch (e) {
          return e;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(Error);
      for (const text of printed(error)) expectNoSecret(text);
    }
  });
});
