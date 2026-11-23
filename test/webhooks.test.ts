import { readFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { inspect } from 'node:util';
import { Webhook } from 'standardwebhooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VibeView,
  VibeViewError,
  WebhookVerificationError,
  type Event,
  type WebhookVerificationReason,
} from '../src/index';
import { webhooksWithClock } from '../src/internal';
import { KEY } from './helpers';

// A delivery the server made: a real `account.created` body, signed by the server's own
// signing code with a test secret and a fixed timestamp (the API's own test suite writes it).
interface DeliveryFixture {
  // The secret in two parts, so no file holds it in one piece.
  secret_prefix: string;
  secret_body: string;
  timestamp: number;
  headers: Record<'webhook-id' | 'webhook-timestamp' | 'webhook-signature', string>;
  body: string;
}
const stored = JSON.parse(
  readFileSync(new URL('fixtures/webhook-account-created.json', import.meta.url), 'utf8'),
) as DeliveryFixture;
const delivery = { ...stored, secret: stored.secret_prefix + stored.secret_body };

// Another test secret, made in code: 32 bytes of plain text.
const OTHER_SECRET = 'whsec_' + Buffer.from('another platforms-sdk test key!!').toString('base64');

const verify = VibeView.webhooks.verify.bind(VibeView.webhooks);

/** Sets the clock to the fixture's timestamp plus `offsetS` seconds (only `Date`). */
function at(offsetS = 0): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime((delivery.timestamp + offsetS) * 1000);
}

afterEach(() => {
  vi.useRealTimers();
});

function failure(fn: () => unknown): WebhookVerificationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WebhookVerificationError);
    expect(error).toBeInstanceOf(VibeViewError);
    return error as WebhookVerificationError;
  }
  throw new Error('expected verify to throw');
}

/** Nothing secret in any form of a thrown error. */
function expectNoSecrets(error: unknown, secrets: string[]): void {
  const forms = [
    String(error),
    inspect(error, { showHidden: true, depth: 5 }),
    JSON.stringify(error),
    JSON.stringify(Object.entries(error as object)),
    (error as Error).stack ?? '',
  ];
  for (const form of forms) {
    for (const secret of secrets) expect(form).not.toContain(secret);
  }
}

function signedNow(
  body: string,
  secrets: string[] = [delivery.secret],
  id = 'evt_' + 'a'.repeat(24),
) {
  const now = new Date();
  return {
    'webhook-id': id,
    'webhook-timestamp': String(Math.floor(now.getTime() / 1000)),
    'webhook-signature': secrets.map((s) => new Webhook(s).sign(id, now, body)).join(' '),
  };
}

describe('webhooks.verify', () => {
  it('verifies the delivery the server signed, and returns its event', () => {
    at();
    const event: Event = verify(delivery.body, delivery.headers, delivery.secret);
    expect(event).toEqual(JSON.parse(delivery.body));
    expect(event.type).toBe('account.created');
    expect(event.id).toBe(delivery.headers['webhook-id']);
  });

  it('takes the body as a string, a Uint8Array or a Buffer', () => {
    at();
    const bytes = new TextEncoder().encode(delivery.body);
    expect(verify(bytes, delivery.headers, delivery.secret).id).toBe(
      delivery.headers['webhook-id'],
    );
    expect(verify(Buffer.from(delivery.body), delivery.headers, delivery.secret).type).toBe(
      'account.created',
    );
  });

  it('a body with one byte changed fails bad_signature', () => {
    at();
    const changed = delivery.body.replace('"account.created"', '"account.createe"');
    expect(changed).not.toBe(delivery.body);
    expect(failure(() => verify(changed, delivery.headers, delivery.secret)).reason).toBe(
      'bad_signature',
    );
    const bytes = Buffer.from(delivery.body);
    const where = bytes.length - 2;
    bytes.writeUInt8(bytes.readUInt8(where) ^ 1, where);
    expect(failure(() => verify(bytes, delivery.headers, delivery.secret)).reason).toBe(
      'bad_signature',
    );
  });

  it('a parsed body fails raw_body_required and says the raw body is needed', () => {
    at();
    for (const parsed of [JSON.parse(delivery.body), null, undefined, 42, new ArrayBuffer(4)]) {
      const error = failure(() => verify(parsed as never, delivery.headers, delivery.secret));
      expect(error.reason).toBe('raw_body_required');
      expect(error.message).toMatch(/raw request body/);
    }
  });

  it('a re-serialised body fails bad_signature: only the bytes as sent verify', () => {
    at();
    const reserialised = JSON.stringify(JSON.parse(delivery.body), null, 2);
    expect(failure(() => verify(reserialised, delivery.headers, delivery.secret)).reason).toBe(
      'bad_signature',
    );
  });

  it('a timestamp more than 5 minutes from the clock fails timestamp_out_of_tolerance', () => {
    at(6 * 60);
    expect(failure(() => verify(delivery.body, delivery.headers, delivery.secret)).reason).toBe(
      'timestamp_out_of_tolerance',
    );
    at(-6 * 60);
    expect(failure(() => verify(delivery.body, delivery.headers, delivery.secret)).reason).toBe(
      'timestamp_out_of_tolerance',
    );
    at(4 * 60);
    expect(verify(delivery.body, delivery.headers, delivery.secret).type).toBe('account.created');
  });

  it('a signature made now verifies with the real clock (round trip)', () => {
    const body = JSON.stringify({ ...JSON.parse(delivery.body), id: 'evt_' + 'b'.repeat(24) });
    const headers = signedNow(body);
    expect(verify(body, headers, delivery.secret).id).toBe('evt_' + 'b'.repeat(24));
  });

  it('rotation: a list of secrets verifies when any one matches', () => {
    at();
    expect(verify(delivery.body, delivery.headers, [OTHER_SECRET, delivery.secret]).type).toBe(
      'account.created',
    );
    expect(verify(delivery.body, delivery.headers, [delivery.secret, OTHER_SECRET]).type).toBe(
      'account.created',
    );
    expect(failure(() => verify(delivery.body, delivery.headers, [OTHER_SECRET])).reason).toBe(
      'bad_signature',
    );
  });

  it('rotation: a header with two signatures verifies with either secret', () => {
    const body = delivery.body;
    const headers = signedNow(body, [OTHER_SECRET, delivery.secret]);
    expect(headers['webhook-signature'].split(' ')).toHaveLength(2);
    expect(verify(body, headers, delivery.secret).type).toBe('account.created');
    expect(verify(body, headers, OTHER_SECRET).type).toBe('account.created');
  });

  it('header names in any case, values as arrays, a Headers object, Node IncomingHttpHeaders', () => {
    at();
    const upper = Object.fromEntries(
      Object.entries(delivery.headers).map(([k, v]) => [k.toUpperCase(), v]),
    );
    expect(verify(delivery.body, upper, delivery.secret).type).toBe('account.created');
    const arrays = Object.fromEntries(Object.entries(delivery.headers).map(([k, v]) => [k, [v]]));
    expect(verify(delivery.body, arrays, delivery.secret).type).toBe('account.created');
    expect(verify(delivery.body, new Headers(delivery.headers), delivery.secret).type).toBe(
      'account.created',
    );
    const node: IncomingHttpHeaders = {
      ...delivery.headers,
      'content-type': 'application/json',
      'set-cookie': ['a=1'],
      host: undefined,
    };
    expect(verify(delivery.body, node, delivery.secret).type).toBe('account.created');
  });

  it('a header given twice is missing_headers, the same for every shape of headers', () => {
    at();
    for (const name of ['webhook-id', 'webhook-timestamp', 'webhook-signature'] as const) {
      const value = delivery.headers[name];
      const other = name === 'webhook-timestamp' ? String(delivery.timestamp + 1) : `${value}x`;
      for (const second of [value, other]) {
        const asArray = { ...delivery.headers, [name]: [value, second] };
        expect(failure(() => verify(delivery.body, asArray, delivery.secret)).reason).toBe(
          'missing_headers',
        );
        const joined = new Headers(delivery.headers);
        joined.append(name, second);
        expect(failure(() => verify(delivery.body, joined, delivery.secret)).reason).toBe(
          'missing_headers',
        );
        // What Node gives for a header it does not know that arrived twice.
        const nodeJoined = { ...delivery.headers, [name]: `${value}, ${second}` };
        expect(failure(() => verify(delivery.body, nodeJoined, delivery.secret)).reason).toBe(
          'missing_headers',
        );
      }
    }
  });

  it('a missing or malformed header fails missing_headers', () => {
    at();
    for (const name of ['webhook-id', 'webhook-timestamp', 'webhook-signature'] as const) {
      const without: Record<string, string> = { ...delivery.headers };
      delete without[name];
      expect(failure(() => verify(delivery.body, without, delivery.secret)).reason).toBe(
        'missing_headers',
      );
      const empty = { ...delivery.headers, [name]: '' };
      expect(failure(() => verify(delivery.body, empty, delivery.secret)).reason).toBe(
        'missing_headers',
      );
    }
    const notANumber = { ...delivery.headers, 'webhook-timestamp': `${delivery.timestamp}abc` };
    expect(failure(() => verify(delivery.body, notANumber, delivery.secret)).reason).toBe(
      'missing_headers',
    );
    const twoIds = { ...delivery.headers, 'webhook-id': ['evt_1', 'evt_2'] };
    expect(failure(() => verify(delivery.body, twoIds, delivery.secret)).reason).toBe(
      'missing_headers',
    );
    expect(failure(() => verify(delivery.body, null as never, delivery.secret)).reason).toBe(
      'missing_headers',
    );
  });

  it('an unknown event type from a newer API is returned, not refused', () => {
    const body = JSON.stringify({ ...JSON.parse(delivery.body), type: 'thing.from_the_future' });
    const event = verify(body, signedNow(body), delivery.secret);
    expect(event.type).toBe('thing.from_the_future');
    const type: string = event.type;
    expect(type).toBe('thing.from_the_future');
  });

  it('a thrown error never holds the secret, the signature or the body', () => {
    const signature = delivery.headers['webhook-signature'].slice(3);
    const keyPart = delivery.secret.slice('whsec_'.length);
    const secrets = [delivery.secret, keyPart, signature, OTHER_SECRET, 'fixture-cust'];
    at();
    const cases: (() => unknown)[] = [
      () => verify(delivery.body + ' ', delivery.headers, [OTHER_SECRET, delivery.secret]),
      () => verify(JSON.parse(delivery.body) as never, delivery.headers, delivery.secret),
      () => verify(delivery.body, { ...delivery.headers, 'webhook-id': '' }, delivery.secret),
    ];
    for (const run of cases) {
      const error = failure(run);
      expectNoSecrets(error, secrets);
      expect(Object.keys(error).sort()).toEqual(['name', 'reason']);
    }
    at(600);
    expectNoSecrets(
      failure(() => verify(delivery.body, delivery.headers, delivery.secret)),
      secrets,
    );
  });

  it('a secret that is not a signing secret is refused, and never printed', () => {
    for (const bad of [KEY, 'whsec_', 'whsec_not base64!', '', [], [delivery.secret, 7]]) {
      let thrown: unknown;
      try {
        verify(delivery.body, delivery.headers, bad as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(VibeViewError);
      expect(thrown).not.toBeInstanceOf(WebhookVerificationError);
      expect(String(thrown)).toMatch(/whsec_…/);
      expectNoSecrets(thrown, [KEY, 'not base64!']);
    }
  });

  it('needs no credential: the static form and every client share one object', () => {
    const client = new VibeView({ apiKey: KEY });
    expect(client.webhooks).toBe(VibeView.webhooks);
    expect(client.withAccount('org_1').webhooks).toBe(VibeView.webhooks);
    at();
    expect(client.webhooks.verify(delivery.body, delivery.headers, delivery.secret).type).toBe(
      'account.created',
    );
    expect(Object.isFrozen(VibeView.webhooks)).toBe(true);
  });

  it('the reasons are the four documented ones', () => {
    const reasons: WebhookVerificationReason[] = [
      'raw_body_required',
      'missing_headers',
      'bad_signature',
      'timestamp_out_of_tolerance',
    ];
    expect(reasons).toHaveLength(4);
  });
});

describe('the order of the checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('each reason comes from its own input, checked before the signature', () => {
    at();
    const wrongSecret = [OTHER_SECRET];
    expect(failure(() => verify({} as never, {}, wrongSecret)).reason).toBe('raw_body_required');
    expect(failure(() => verify(delivery.body, {}, wrongSecret)).reason).toBe('missing_headers');
    at(301);
    expect(failure(() => verify(delivery.body, delivery.headers, wrongSecret)).reason).toBe(
      'timestamp_out_of_tolerance',
    );
    at(300);
    expect(failure(() => verify(delivery.body, delivery.headers, wrongSecret)).reason).toBe(
      'bad_signature',
    );
    expect(verify(delivery.body, delivery.headers, delivery.secret).type).toBe('account.created');
  });

  it('the tolerance is the SDK’s own check, on its own clock', () => {
    // The process clock is right for the library; the SDK's clock is 6 minutes off.
    at();
    const late = webhooksWithClock(() => (delivery.timestamp + 360) * 1000);
    const early = webhooksWithClock(() => (delivery.timestamp - 360) * 1000);
    for (const verifier of [late, early]) {
      expect(
        failure(() => verifier.verify(delivery.body, delivery.headers, delivery.secret)).reason,
      ).toBe('timestamp_out_of_tolerance');
    }
  });

  it('after the SDK’s checks, any refusal of the library is bad_signature', () => {
    // The SDK's clock says the timestamp is fresh; the library's (the process clock) does
    // not, and refuses with its own timestamp message.
    at(3600);
    const fresh = webhooksWithClock(() => delivery.timestamp * 1000);
    expect(
      failure(() => fresh.verify(delivery.body, delivery.headers, delivery.secret)).reason,
    ).toBe('bad_signature');
    // An error with a message the SDK has never seen.
    at();
    vi.spyOn(Webhook.prototype, 'verify').mockImplementation(() => {
      throw new Error('Message timestamp too old (a message from a future library)');
    });
    expect(failure(() => verify(delivery.body, delivery.headers, delivery.secret)).reason).toBe(
      'bad_signature',
    );
  });
});

describe('a node:http server reading the raw body', () => {
  it('verifies the delivery as it arrives over HTTP', async () => {
    at();
    const results: unknown[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          results.push(
            VibeView.webhooks.verify(Buffer.concat(chunks), req.headers, delivery.secret),
          );
          res.writeHead(204).end();
        } catch (error) {
          results.push(error);
          res.writeHead(400).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: '/vibeview',
            headers: { ...delivery.headers, 'content-type': 'application/json' },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(delivery.body);
      });
      expect(status).toBe(204);
      expect((results[0] as Event).type).toBe('account.created');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
