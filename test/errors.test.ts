import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APIError,
  ERROR_CODES,
  RateLimitError,
  VibeViewError,
  type ErrorCode,
  type KnownErrorCode,
} from '../src/index';
import { fakeApi, ORG, testClient } from './helpers';

// The `already_created` example of the public errors page.
const alreadyCreated = {
  detail: 'This Idempotency-Key already created the object; its secret is shown only once.',
  error: {
    code: 'already_created',
    message: 'This Idempotency-Key already created the object; its secret is shown only once.',
    request_id: 'req_ae2b7b5e6bbee20ee2fae8f1',
    object: 'access_token',
    id: 'atok_bc803592cfbf69c6',
  },
};

async function errorFrom(status: number, body: unknown, headers?: Record<string, string>) {
  const api = await fakeApi([{ status, body, headers }]);
  return testClient(api, { maxRetries: 0 })
    .client.accounts.retrieve(ORG)
    .catch((e: unknown) => e);
}

describe('APIError', () => {
  it('carries the fields of a real error body', async () => {
    const error = await errorFrom(409, alreadyCreated);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toBeInstanceOf(VibeViewError);
    expect(error).toBeInstanceOf(Error);
    const e = error as APIError;
    expect(e.status).toBe(409);
    expect(e.code).toBe('already_created');
    expect(e.message).toBe(alreadyCreated.error.message);
    expect(e.requestId).toBe('req_ae2b7b5e6bbee20ee2fae8f1');
    expect(e.error).toEqual(alreadyCreated.error);
    expect(e.field).toBeUndefined();
    expect(e.name).toBe('APIError');
  });

  it('carries field when the API names one', async () => {
    const error = (await errorFrom(409, {
      error: {
        code: 'external_ref_taken',
        message: 'Taken.',
        request_id: 'req_1',
        field: 'external_ref',
        account: ORG,
      },
    })) as APIError;
    expect(error.field).toBe('external_ref');
    expect(error.error.account).toBe(ORG);
  });

  it('an unknown code from a newer API parses and is usable', async () => {
    const error = (await errorFrom(400, {
      error: { code: 'a_code_from_the_future', message: 'New.', request_id: 'req_2', extra: 1 },
    })) as APIError;
    expect(error.code).toBe('a_code_from_the_future');
    expect(error.error.extra).toBe(1);
    const code: ErrorCode = error.code;
    expect(code in ERROR_CODES).toBe(false);
  });

  it('a RateLimitError carries limit and retryAfterMs', async () => {
    const error = await errorFrom(
      429,
      {
        error: {
          code: 'rate_limited',
          message: 'Slow down.',
          request_id: 'req_3',
          limit: 'session',
        },
      },
      { 'Retry-After': '3' },
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toBeInstanceOf(APIError);
    expect(error).toMatchObject({ limit: 'session', retryAfterMs: 3000, status: 429 });
  });
});

// Real answers of the API, recorded by the API's own test suite.
interface ErrorFixture {
  status: number;
  headers: Record<string, string>;
  body: { detail: string; error: Record<string, unknown> & { code: string; message: string } };
}
function fixture(code: string): ErrorFixture {
  const name = `fixtures/error-${code.replace(/_/g, '-')}.json`;
  return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')) as ErrorFixture;
}

describe('errors from real API answers', () => {
  it.each(['already_created', 'external_ref_taken', 'rate_limited', 'idempotency_key_reused'])(
    '%s',
    async (code) => {
      const real = fixture(code);
      const error = await errorFrom(real.status, real.body, real.headers);
      expect(error).toBeInstanceOf(APIError);
      const e = error as APIError;
      expect(e.status).toBe(real.status);
      expect(e.code).toBe(code);
      expect(e.message).toBe(real.body.error.message);
      expect(e.requestId).toBe(real.body.error.request_id);
      expect(e.error).toEqual(real.body.error);
      expect(e.field).toBe(real.body.error.field);
      expect(ERROR_CODES[code as KnownErrorCode].status).toBe(real.status);
      if (code === 'rate_limited') {
        expect(error).toBeInstanceOf(RateLimitError);
        const limited = error as RateLimitError;
        expect(limited.limit).toBe(real.body.error.limit);
        expect(limited.retryAfterMs).toBe(Number(real.headers['retry-after']) * 1000);
      } else {
        expect(error).not.toBeInstanceOf(RateLimitError);
      }
    },
  );

  it('already_created names the object it made, external_ref_taken the account', () => {
    expect(fixture('already_created').body.error).toMatchObject({ object: 'access_token' });
    expect(typeof fixture('already_created').body.error.id).toBe('string');
    expect(fixture('external_ref_taken').body.error).toMatchObject({ field: 'external_ref' });
    expect(typeof fixture('external_ref_taken').body.error.account).toBe('string');
  });
});

describe('ERROR_CODES', () => {
  it('lists the codes the API documents, with status and meaning', () => {
    const known: KnownErrorCode = 'already_created';
    expect(ERROR_CODES[known].status).toBe(409);
    expect(ERROR_CODES.rate_limited.status).toBe(429);
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(typeof entry.meaning).toBe('string');
      expect(entry.status === null || typeof entry.status === 'number').toBe(true);
    }
  });
});
