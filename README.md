# @vibeview/platforms

The server-side TypeScript client for the [VibeView Partner API](https://vibeview.io/docs/platforms/overview):
create an account for each of your customers, mint access tokens, and run sessions on live
devices from your server.

- Typed requests and answers, generated from the API's OpenAPI document.
- Safe retries: an idempotency key on every call the API takes one on, `Retry-After` honoured.
- Lost-answer recovery for access tokens.
- Webhook verification (Standard Webhooks signatures, checked against the raw body).
- Small: one dependency, [`standardwebhooks`](https://www.npmjs.com/package/standardwebhooks),
  for webhook signatures. Runs on Node 20 or newer.

## Install

```sh
npm install @vibeview/platforms
```

## Server only

This package holds your partner key. It runs on your server, on Node 20 or newer. A bundle built for a browser gets a stand-in that throws "server-only" as soon as it
loads. A browser never gets your key or an access token: give it a collab credential
(`sessions.collab.update`) for one session instead.

Test server code that uses this package in a Node test environment: a browser-like one
(jsdom) resolves the browser entry, which throws "server-only".

## Quickstart

Create a key on the **Partner** page in the dashboard. Only test partners' keys
(`vvp_test_…`) are accepted today; live partners are coming soon. The key is all the client needs: the
first call that needs your partner id (or `partner.retrieve()`, which the client then reuses)
asks the API which partner the key belongs to, once, and the client keeps the answer.

- That lookup is at most `1 + maxRetries` requests, with the client's own `maxRetries` and
  `timeoutMs`. A call's own `timeoutMs` or `signal` only bound how long that call waits for
  it; a call's own `maxRetries` does not apply to it.
- Create the client once per process (or pass the `partner` option, `ptn_…`) so the lookup
  is not repeated.
- When the lookup fails, the call that needed it throws the lookup's error, with the same
  classes as any call (`APIError`, `ConnectionError`, …); the next call tries again.

```ts
import { VibeView } from '@vibeview/platforms';

const vibeview = new VibeView({ apiKey: process.env.VIBEVIEW_KEY }); // vvp_test_…

// Which partner and environment this key belongs to.
const me = await vibeview.partner.retrieve();
console.log(me.id, me.environment);

// One account per customer. Find it again by your own id before you create one.
// period_anchor_day: the day of the month its limits reset (defaults to the day it is created).
const account =
  (await vibeview.accounts.findByExternalRef('cust_1042')) ??
  (await vibeview.accounts.create({
    external_ref: 'cust_1042',
    display_name: 'Northwind',
    period_anchor_day: 15,
  }));
console.log(account.period.start, account.period.end); // its current period, unix seconds

// A short-lived access token for that account only.
const token = await vibeview.accounts.tokens.create(account.id, {
  scopes: ['sessions:read', 'sessions:write'],
  ttl_seconds: 3600,
});
console.log(token.expires_at);

// Every account of yours, page after page.
for await (const each of vibeview.accounts.list({ limit: 100 })) {
  console.log(each.id, each.external_ref, each.status);
}
```

## Acting in an account

Calls under `/partners/{ptn}` (accounts, tokens, contract, shares, embed keys, events, webhook endpoints and
deliveries, `partnerUsage`) take your partner key. Calls that act in
one account (`sessions`, `devicePools`, `apps`, `usage`) need that account: with a partner key, name
it with `withAccount` (sent as the `VibeView-Account` header); an access token is bound to
its account already.

```ts
import { VibeView } from '@vibeview/platforms';

const vibeview = new VibeView({ apiKey: process.env.VIBEVIEW_KEY });
const customer = vibeview.withAccount('org_95aa9b33d49e3752');
const sessions = await customer.sessions.list({ limit: 10 });
// The apps the account can start a session on: its own and those you share with your partner.
const apps = await customer.apps.list();

// Or with an access token minted for the account:
const scoped = new VibeView({ accessToken: process.env.VIBEVIEW_TOKEN });
const pools = await scoped.devicePools.list();
console.log(sessions.data.length, apps.data.length, pools.data.length);
```

## Extra minutes

Give an account streaming minutes beyond its `streaming_minutes_per_month` for its current
period: they are used once the period's monthly minutes are used up, and end with the period
(`extra.expires_at`). Add a slice when a session starts and another when it is warned; the
client sends an `Idempotency-Key` with each, so a retry never adds twice.

```ts
import { VibeView } from '@vibeview/platforms';

const vibeview = new VibeView({ apiKey: process.env.VIBEVIEW_KEY });
const account = await vibeview.accounts.addExtraMinutes('org_95aa9b33d49e3752', {
  streaming_minutes: 30,
});
console.log(account.extra.streaming_minutes, account.extra.expires_at);

// On session.cutoff_warning: add to the period the warning names (a session that started
// in the previous period is still measured against it).
const periodStart = 1794700800; // the event's data.cutoff.period.start
await vibeview.accounts.addExtraMinutes(account.id, {
  streaming_minutes: 30,
  period_start: periodStart,
});

// At session.ended: settle with session.streaming_seconds, then set what is left. The set
// applies to the whole account: keep what its other running sessions still hold (0 only when
// none is running), or they lose those minutes and end.
const stillHeldByOtherSessions = 0; // your own record of the slices the other sessions hold
await vibeview.accounts.update(account.id, {
  extra: { streaming_minutes: stillHeldByOtherSessions },
});
```

## Labels and reuse

Tag a session with `labels` (up to 10 pairs of 1 to 64 letters, digits and `. _ : -`; not for
personal data). With `reuse: true`, a live session of the account (pending, starting or
active) created through `sessions.create` with exactly the same labels, app and device
offering is returned instead of a new one, with `reused: true`, however many of your
workers ask at once. Its `launch_params` are not applied again.

```ts
import { VibeView } from '@vibeview/platforms';

const customer = new VibeView({ apiKey: process.env.VIBEVIEW_KEY }).withAccount('org_95aa9b33d49e3752');
const preview = await customer.sessions.create({
  device_type: 'ios',
  device_category: 'phone',
  model: 'iPhone 16',
  os_version: 'iOS 18.6',
  app: 'app_3f9c2a1b7d',
  labels: { project: 'p-42', purpose: 'preview' },
  reuse: true,
});
// Always start: a reused session may never have been started by the worker that created it,
// and starting a session that is already starting or active returns it as it is.
const started = await customer.sessions.start(preview.id);
console.log(preview.reused, started.status, started.labels);
```

## Errors

A failed call throws. Branch on `code`, which is stable; `message` is a sentence for people.
New codes may be added, so keep a default branch.

```ts
import { APIError, RateLimitError, VibeView } from '@vibeview/platforms';

const vibeview = new VibeView({ apiKey: process.env.VIBEVIEW_KEY });
try {
  await vibeview.accounts.create({ external_ref: 'cust_1042' });
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log('rate limited', error.limit, error.retryAfterMs);
  } else if (error instanceof APIError && error.code === 'external_ref_taken') {
    console.log('already have it:', error.error.account);
  } else if (error instanceof APIError) {
    console.log(error.status, error.code, error.message, error.requestId);
  } else {
    throw error;
  }
}
```

| Class                      | When                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `APIError`                 | The API answered with an error: `status`, `code`, `message`, `requestId`, `field`, `error` |
| `RateLimitError`           | A `429` (an `APIError`): also `retryAfterMs` and `limit`                                   |
| `ConnectionError`          | No answer: the connection failed or was cut                                                |
| `TimeoutError`             | No answer within `timeoutMs` (a `ConnectionError`)                                         |
| `AbortedError`             | Your `signal` aborted the call; `cause` is the abort reason                                |
| `WebhookVerificationError` | A webhook did not verify (`webhooks.verify`): `reason` says why                            |
| `VibeViewError`            | The base class of all of the above, of a bad option or argument, and of a redirect         |

`ERROR_CODES` lists the codes the API documents, each with its status and meaning. An
`APIError` also carries the answer's `headers` and, when the API sent `Retry-After`,
`retryAfterMs`.

The package ships an ES module and a CommonJS build. If your program loads both (one part
imports it, another requires it), `instanceof` fails across the two: check `error.name` and
`error.code` instead when that can happen.

## Retries and idempotency

A call is retried (at most `maxRetries` times, 2 by default) when the connection fails, the
attempt times out, or the API answers `5xx`, `429` or `409 idempotency_in_progress`. It waits
`Retry-After` when the API sends one, else a random back-off. The client waits at most 60
seconds: when `Retry-After` asks for longer, the call fails at once with that error, and its
`retryAfterMs` says how long to wait before you try again.

Only a call that is safe to repeat is retried:

- reads, deletes and `sessions.keepAlive`;
- `accounts.update`: sending the same change again leaves the account as it is and sends no
  second event. If another writer changed the account between two attempts, the retry writes
  this call's values again (the last writer wins). For `extra`, a retry sets what is left again
  at the time of the retry: it replaces an add made between the two attempts and gives back
  the seconds used between them;
- the calls the API takes an `Idempotency-Key` on: `accounts.create`, `accounts.suspend`,
  `accounts.resume`, `accounts.addExtraMinutes`, `accounts.tokens.create`, `webhookEndpoints.recover`,
  `webhookDeliveries.retry`, `sessions.create`, `sessions.start` and `sessions.collab.update`.
  The client sends a key with each, the same one on every retry, so a retry never acts twice;
  pass `idempotencyKey` to choose it yourself. No other call takes one.

Device inputs (`sessions.control`, `sessions.launchApp`, `sessions.runAgentTool`) are never
retried: a repeated tap is a second tap. A redirect is never followed: it throws a
`VibeViewError` (check `baseUrl`).

The `baseUrl` option (default `https://vibeview.io/api/v1`) must be an absolute `https` URL,
without a query, a fragment, or a user name or password; `http` is accepted only to this
machine (`localhost`, `127.0.0.1` or `[::1]`), for local testing.

An access token is shown once. When the client made the key and the answer to a mint is
lost, the retry answers `409 already_created`: `accounts.tokens.create` then revokes that token
and mints a new one with a new key. Pass `onAlreadyCreated: 'throw'` to handle it yourself.
With your own `idempotencyKey`, a repeat of a mint answers `409 already_created` naming the
token (`error.id`), and that is always thrown: if you no longer hold its secret, revoke it with
`accounts.tokens.revoke` and mint again with a new key.

A collab credential is shown once too, but a repeated mint (`sessions.collab.update` with
`enabled: true`, answered `409 already_created`) is always thrown, never recovered: a collab
credential cannot be revoked on its own, only with every credential of the session
(`enabled: false`, or `regenerate: true` on the next mint), which disconnects every guest
already watching. Decide yourself whether to do that, then mint again with a new key.

When recovery cannot run, a token whose secret nobody holds stays live until its
`ttl_seconds` end. If the revoke failed, the thrown `409` names it (`error.id`, with the
revoke's error as `cause`): revoke it with `accounts.tokens.revoke`. If the call's retries ran
out before any answer, the API may still have made one.

```ts
import { VibeView } from '@vibeview/platforms';

const vibeview = new VibeView({
  apiKey: process.env.VIBEVIEW_KEY,
  maxRetries: 3,
  timeoutMs: 10_000,
});
const controller = new AbortController();
const created = await vibeview.accounts.create(
  { external_ref: 'cust_1043' },
  { idempotencyKey: 'create-cust_1043', signal: controller.signal, timeoutMs: 5_000 },
);
console.log(created.id, created.lastResponse.requestId);
```

## Pagination

A list call returns the first page: the API's answer (`data`, `has_more`), plus `hasMore`
and `nextPage()`. Iterate the call with `for await` to walk every page.

```ts
import { VibeView } from '@vibeview/platforms';

const vibeview = new VibeView({ apiKey: process.env.VIBEVIEW_KEY });
let page = await vibeview.events.list({ limit: 50 });
for (;;) {
  for (const event of page.data) console.log(event.id, event.type);
  const next = page.nextPage();
  if (next === null) break;
  page = await next;
}
```

## Embedding

A partner embed key's frame starts each visitor's session in the account their visitor
token names. Sign the token on your server for each page load and put it in the frame URL's
fragment; the visitor secret never reaches the browser.

```ts
import { signVisitorToken } from '@vibeview/platforms';

const token = await signVisitorToken({
  embedKey: 'ek_test_0a1b2c3d4e5f6g7h8i9j0k1l',
  secret: process.env.VIBEVIEW_VISITOR_SECRET ?? '',
  account: 'org_0123456789abcdef',
  subject: 'customer-42',
  ttl: 300,
});
// The frame's address, for your page: the token is a credential, so never log it.
export const embedSrc = `https://vibeview.io/embed/ek_test_0a1b2c3d4e5f6g7h8i9j0k1l#visitor_token=${token}`;
```

## Webhooks

Verify every delivery before you trust it. `VibeView.webhooks.verify` checks the signature
and the timestamp (at most 5 minutes from your clock) and returns the event; it needs no
partner key, only your endpoint's signing secret (`whsec_…`, from the **Partner** page). Pass
the **raw request body** exactly as received: a body your framework already parsed, or one
serialised again, does not verify.

```ts
import { createServer } from 'node:http';
import { VibeView, WebhookVerificationError } from '@vibeview/platforms';

const secret = process.env.VIBEVIEW_WEBHOOK_SECRET; // whsec_…
if (!secret) throw new Error('Set VIBEVIEW_WEBHOOK_SECRET.');

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    try {
      const event = VibeView.webhooks.verify(Buffer.concat(chunks), req.headers, secret);
      console.log(event.id, event.type);
      res.writeHead(204).end();
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        console.log('refused a webhook:', error.reason);
        res.writeHead(400).end();
      } else {
        // A wrong secret setting, or a bug: never throw out of the callback.
        console.error('webhook handler failed:', error instanceof Error ? error.name : error);
        res.writeHead(500).end();
      }
    }
  });
}).listen(3000);
```

A failure throws `WebhookVerificationError` with a `reason`: `raw_body_required`,
`missing_headers`, `bad_signature` or `timestamp_out_of_tolerance`. Answer it with a `400`.
A delivery can be repeated: de-duplicate on the `webhook-id` header (it is the event's `id`)
and skip one you have already handled.

Getting the raw body in a framework:

- Express: `express.raw({ type: 'application/json' })` on the webhook route, before any JSON
  parser runs for it; `req.body` is then a `Buffer`.
- Next.js route handlers: `await request.text()`.
- Fastify: in a plugin that holds only the webhook route, call `removeAllContentTypeParsers()`,
  then `addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => done(null, body))`;
  `request.body` is then a `Buffer`.

Event types are an open set: `EVENT_TYPES` lists the ones this version knows, and a newer
API may send a `type` it does not, so keep a `default` branch. Some known types were not sent
yet as of this package version (`EVENT_TYPES[type].sent` is `false`); the API may start
sending them later, so handle a type by its name, never by its `sent` flag.

```ts
import type { Event } from '@vibeview/platforms';

function handle(event: Event): void {
  switch (event.type) {
    case 'account.created':
    case 'account.updated':
      console.log('account changed', event.account?.id);
      break;
    case 'session.ended':
      console.log('session ended', event.data.object);
      break;
    default:
      // A type this code does not handle, or one a newer API added.
      console.log('ignored', event.type);
  }
}
```

While you rotate the signing secret, pass both secrets (`[newSecret, oldSecret]`): a
delivery signed with either one verifies.

## Answers

Every answer is the API's JSON object as it was sent (field names as in the
[API reference](https://vibeview.io/docs/platforms/api-reference)). Each also has a
non-enumerable `lastResponse` (`requestId`, `status`, `headers`): quote the `requestId` when
you contact support.

## Licence

MIT
