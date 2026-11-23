import { describe, expect, it } from 'vitest';
import { APIError } from '../src/index';
import { errorBody, fakeApi, ORG, PTN, testClient, TOKEN, type Reply, type Seen } from './helpers';

// No test here depends on time: a lost answer is a dropped connection (the API "minted",
// the client never heard), and back-off waits are recorded, not slept.

const tokensPath = `/api/v1/partners/${PTN}/accounts/${ORG}/tokens`;
const minted = (id: string): Reply => ({
  status: 201,
  body: {
    object: 'access_token',
    id,
    token: TOKEN,
    account: ORG,
    scopes: ['sessions:write'],
    expires_at: 1795270629,
  },
});
const alreadyCreated = (id: string): Reply => ({
  status: 409,
  body: errorBody(
    'already_created',
    'This Idempotency-Key already created the object; its secret is shown only once.',
    { object: 'access_token', id },
  ),
});
const revoked = (id: string): Reply => ({
  status: 200,
  body: { object: 'access_token', id, revoked: true },
});
const summary = (seen: Seen[]) => seen.map((s) => `${s.method} ${s.url.pathname}`);
const body = { scopes: ['sessions:write'] };

describe('accounts.tokens.create', () => {
  it('after a lost answer: revokes the token the first attempt made, then mints with a NEW key', async () => {
    const api = await fakeApi([
      'drop', // the answer to the first attempt is lost
      alreadyCreated('atok_first'),
      revoked('atok_first'),
      minted('atok_second'),
    ]);
    const token = await testClient(api).client.accounts.tokens.create(ORG, body);

    expect(token.id).toBe('atok_second');
    expect(summary(api.seen)).toEqual([
      `POST ${tokensPath}`,
      `POST ${tokensPath}`,
      `DELETE ${tokensPath}/atok_first`,
      `POST ${tokensPath}`,
    ]);
    const keys = api.seen.map((s) => s.headers['idempotency-key']);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBeUndefined();
    expect(keys[3]).toBeDefined();
    expect(keys[3]).not.toBe(keys[0]);
    expect(api.seen[3]?.body).toBe(api.seen[0]?.body);
  });

  it('with a caller key, a retry that answers already_created is thrown (a repeat of a call that succeeded): no revoke', async () => {
    // A first call with the key succeeded (another process holds atok_first). This later
    // call's first attempt drops, its retry answers already_created: the SDK cannot tell
    // the token is not someone else's, so it must not revoke it.
    const api = await fakeApi(['drop', alreadyCreated('atok_first')]);
    const error = await testClient(api)
      .client.accounts.tokens.create(ORG, body, { idempotencyKey: 'mint-user-7' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'already_created' });
    expect((error as APIError).error.id).toBe('atok_first');
    expect(summary(api.seen).filter((s) => s.startsWith('DELETE'))).toEqual([]);
    expect(api.seen).toHaveLength(2);
  });

  it("two calls at once sharing a caller key: neither revokes the other's token", async () => {
    // The API's rules for one key: the first call holds it (in progress), then completes;
    // the second gets idempotency_in_progress, then already_created naming the first's token.
    let state: 'free' | 'running' | 'done' = 'free';
    let releaseFirst: () => void = () => {};
    const firstDone = new Promise<void>((resolve) => (releaseFirst = resolve));
    const api = await fakeApi((seen) => {
      if (seen.method === 'DELETE') return revoked('atok_a');
      if (state === 'free') {
        state = 'running';
        return minted('atok_a');
      }
      if (state === 'running') {
        state = 'done';
        releaseFirst();
        return {
          status: 409,
          body: errorBody('idempotency_in_progress', 'Still running.'),
          headers: { 'Retry-After': '1' },
        };
      }
      return alreadyCreated('atok_a');
    });
    const { client } = testClient(api);
    const a = await client.accounts.tokens.create(ORG, body, { idempotencyKey: 'mint-user-7' });
    const b = client.accounts.tokens
      .create(ORG, body, { idempotencyKey: 'mint-user-7' })
      .catch((e: unknown) => e);
    await firstDone;
    const error = await b;
    expect(a.id).toBe('atok_a');
    expect(error).toMatchObject({ status: 409, code: 'already_created' });
    expect(summary(api.seen).filter((s) => s.startsWith('DELETE'))).toEqual([]);
  });

  it('an already_created to the FIRST attempt (a caller key used before) is thrown, even with "recover"', async () => {
    const api = await fakeApi([alreadyCreated('atok_elsewhere')]);
    const error = await testClient(api)
      .client.accounts.tokens.create(ORG, body, {
        idempotencyKey: 'mint-1',
        onAlreadyCreated: 'recover',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ status: 409, code: 'already_created' });
    expect((error as APIError).error.id).toBe('atok_elsewhere');
    expect(api.seen).toHaveLength(1);
  });

  it('with onAlreadyCreated "throw", throws the 409 of a retry', async () => {
    const api = await fakeApi(['drop', alreadyCreated('atok_first')]);
    const error = await testClient(api)
      .client.accounts.tokens.create(ORG, body, { onAlreadyCreated: 'throw' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'already_created' });
    expect((error as APIError).error.id).toBe('atok_first');
    expect(api.seen).toHaveLength(2);
  });

  it('a 404 on the revoke (already gone) is ignored', async () => {
    const api = await fakeApi([
      'drop',
      alreadyCreated('atok_first'),
      { status: 404, body: errorBody('access_token_not_found', 'No such token.') },
      minted('atok_second'),
    ]);
    const token = await testClient(api).client.accounts.tokens.create(ORG, body);
    expect(token.id).toBe('atok_second');
  });

  it('another revoke failure throws the ORIGINAL 409, with the revoke error as cause; nothing is minted', async () => {
    const api = await fakeApi([
      'drop',
      alreadyCreated('atok_first'),
      { status: 403, body: errorBody('insufficient_scope', 'No.') },
    ]);
    const error = await testClient(api)
      .client.accounts.tokens.create(ORG, body)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'already_created' });
    expect((error as APIError).error.id).toBe('atok_first');
    expect((error as APIError).cause).toMatchObject({ status: 403, code: 'insufficient_scope' });
    expect(api.seen).toHaveLength(3);
  });

  it("the revoke uses the call's own maxRetries", async () => {
    const busy: Reply = { status: 503, body: errorBody('busy', 'Busy.') };
    const api = await fakeApi([
      'drop',
      alreadyCreated('atok_first'),
      busy,
      busy,
      revoked('atok_first'), // a third revoke attempt would pass with the default (2)
      minted('atok_second'),
    ]);
    const error = await testClient(api)
      .client.accounts.tokens.create(ORG, body, { maxRetries: 1 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 409, code: 'already_created' });
    expect((error as APIError).cause).toMatchObject({ status: 503 });
    expect(api.seen).toHaveLength(4);
  });

  it('recovery runs once: a second already_created is thrown', async () => {
    const api = await fakeApi([
      'drop',
      alreadyCreated('atok_first'),
      revoked('atok_first'),
      'drop',
      alreadyCreated('atok_second'),
    ]);
    await expect(testClient(api).client.accounts.tokens.create(ORG, body)).rejects.toMatchObject({
      code: 'already_created',
    });
    expect(summary(api.seen).filter((s) => s.startsWith('DELETE'))).toHaveLength(1);
    expect(api.seen).toHaveLength(5);
  });

  it('an already_created naming another kind of object is thrown, not recovered', async () => {
    const api = await fakeApi([
      'drop',
      {
        status: 409,
        body: errorBody('already_created', 'Created.', { object: 'collab_credential', id: 'x' }),
      },
    ]);
    await expect(testClient(api).client.accounts.tokens.create(ORG, body)).rejects.toMatchObject({
      code: 'already_created',
    });
    expect(api.seen).toHaveLength(2);
  });
});
