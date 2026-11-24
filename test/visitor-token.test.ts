import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { signVisitorToken, VibeViewError, VISITOR_TOKEN_MAX_TTL } from '../src/index';

// The same token VibeView's verifier accepts: its own tests verify this fixture.
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/visitor-token.json', import.meta.url), 'utf8'),
) as {
  embedKey: string;
  secret: string;
  account: string;
  subject: string;
  ttl: number;
  now: number;
  token: string;
};

function claims(token: string): Record<string, unknown> {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('signVisitorToken', () => {
  it('signs the fixture byte for byte', async () => {
    const { token, ...params } = fixture;
    expect(await signVisitorToken(params)).toBe(token);
  });

  it('names the key, the account and the visitor, for at most 900 seconds', async () => {
    const token = await signVisitorToken({ ...fixture, ttl: undefined });
    expect(claims(token)).toEqual({
      type: 'embed_visitor',
      key: fixture.embedKey,
      acc: fixture.account,
      sub: fixture.subject,
      iat: fixture.now,
      exp: fixture.now + 300,
    });
    expect(VISITOR_TOKEN_MAX_TTL).toBe(900);
    const longest = await signVisitorToken({ ...fixture, ttl: 900 });
    expect(claims(longest).exp).toBe(fixture.now + 900);
  });

  it.each([
    ['embedKey', { embedKey: 'pkey_0123456789abcdef' }],
    ['secret', { secret: 'whsec_abc' }],
    ['account', { account: 'acct-1' }],
    ['subject', { subject: '' }],
    ['subject', { subject: 'a\nb' }],
    ['subject', { subject: 'x'.repeat(201) }],
    ['ttl', { ttl: 901 }],
    ['ttl', { ttl: 0 }],
    ['ttl', { ttl: 1.5 }],
  ])('refuses a bad %s', async (_name, over) => {
    await expect(signVisitorToken({ ...fixture, ...over })).rejects.toBeInstanceOf(VibeViewError);
  });
});
