import { Webhook } from 'standardwebhooks';
import { VibeViewError } from './errors';
import type { Event } from './types';

/** Why a webhook was not verified. */
export type WebhookVerificationReason =
  /** The body given was not the raw request body (a string or bytes). */
  | 'raw_body_required'
  /**
   * `webhook-id`, `webhook-timestamp` and `webhook-signature` are not each present exactly
   * once with a value (a header missing, empty or given twice, in any shape of headers), or
   * `webhook-timestamp` is not a whole number of seconds.
   */
  | 'missing_headers'
  /** No signature matches the body with the secret (or secrets) given. */
  | 'bad_signature'
  /** `webhook-timestamp` is more than 5 minutes from this machine's clock. */
  | 'timestamp_out_of_tolerance';

/**
 * A webhook did not pass verification: answer the request with a `400` and do not act on
 * it. `reason` says why. The error never holds the secret, the signature or the body.
 */
export class WebhookVerificationError extends VibeViewError {
  readonly reason: WebhookVerificationReason;

  constructor(reason: WebhookVerificationReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * A request's headers: a `Headers` object, or a plain object with names in any case and
 * string or string-array values (Node's `IncomingHttpHeaders` is one).
 */
export type WebhookHeaders = Headers | Record<string, string | string[] | undefined>;

const MESSAGES: Record<WebhookVerificationReason, string> = {
  raw_body_required:
    'Pass the raw request body (a string or bytes, exactly as received): a parsed body cannot be verified, and some frameworks parse JSON bodies before your handler runs unless told to keep the raw body.',
  missing_headers:
    'The webhook-id, webhook-timestamp (whole seconds) and webhook-signature headers are each needed exactly once: pass the request headers as received.',
  bad_signature:
    'No signature matches the body with the secret given: check the secret, and pass the raw request body exactly as received.',
  timestamp_out_of_tolerance:
    "The webhook's timestamp is more than 5 minutes from this machine's clock: the request is a replay, or this clock is off.",
};

/** Standard Webhooks' tolerance, both ways (the library checks the same again). */
const TOLERANCE_S = 5 * 60;

const SECRET = /^whsec_(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function fail(reason: WebhookVerificationReason): never {
  throw new WebhookVerificationError(reason, MESSAGES[reason]);
}

function isBytes(value: unknown): value is Uint8Array {
  return (
    value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]'
  );
}

function bodyText(rawBody: unknown): string {
  if (typeof rawBody === 'string') return rawBody;
  if (!isBytes(rawBody)) fail('raw_body_required');
  try {
    // VibeView sends UTF-8 (ASCII) JSON: bytes that are not UTF-8 are not what it signed.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(rawBody);
  } catch {
    return fail('bad_signature');
  }
}

function signers(secret: unknown): Webhook[] {
  const list = Array.isArray(secret) ? (secret as unknown[]) : [secret];
  const refuse = () =>
    new VibeViewError(
      'The secret must be a webhook signing secret (whsec_…), or a list of them during a rotation.',
    );
  if (list.length === 0) throw refuse();
  return list.map((each) => {
    if (typeof each !== 'string' || each.length <= 'whsec_'.length || !SECRET.test(each)) {
      throw refuse();
    }
    try {
      return new Webhook(each);
    } catch {
      throw refuse();
    }
  });
}

/**
 * One header's values, whatever shape the headers come in: each item of a list, and each
 * part of a value an HTTP stack joined from repeated headers with ", " (comma and space: a
 * `Headers` object, and Node for a header it does not know). No value of these three
 * headers holds ", ", so a header repeated in a list or joined with ", " counts as given
 * twice. A gateway that joins repeated headers with a bare "," (no space) is not detected:
 * the joined value is read as one value. `webhook-signature` may legitimately hold several
 * signatures separated by spaces (a secret rotation): that is one value, not a repeat.
 */
function headerValues(headers: unknown, name: string): string[] {
  if (headers === null || typeof headers !== 'object') return [];
  const raw: string[] = [];
  if (typeof (headers as Headers).get === 'function' && !Array.isArray(headers)) {
    const value = (headers as Headers).get(name);
    if (value !== null) raw.push(value);
  } else {
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      if (key.toLowerCase() !== name) continue;
      for (const item of Array.isArray(value) ? value : [value]) {
        if (typeof item === 'string') raw.push(item);
      }
    }
  }
  return raw.flatMap((value) => value.split(/,\s+/)).map((value) => value.trim());
}

/** The header's one value: present exactly once and not empty, else `missing_headers`. */
function exactlyOnce(headers: unknown, name: string): string {
  const values = headerValues(headers, name);
  if (values.length !== 1 || values[0] === '') fail('missing_headers');
  return values[0] as string;
}

/** Verifies the webhooks VibeView sends to your endpoints (Standard Webhooks). */
export interface Webhooks {
  /**
   * Checks a webhook's signature and timestamp, and returns its event.
   *
   * @param rawBody The request body exactly as received, as a string or bytes (a
   *   `Buffer` is fine): never a parsed or re-serialised body.
   * @param headers The request's headers.
   * @param secret The endpoint's signing secret (`whsec_…`). During a rotation, pass
   *   both secrets: a webhook signed with either passes.
   * @throws WebhookVerificationError when the webhook does not pass; `reason` says why.
   */
  verify(rawBody: string | Uint8Array, headers: WebhookHeaders, secret: string | string[]): Event;
}

/**
 * A `Webhooks` object reading the time from `now` (milliseconds). A frozen plain object:
 * it has no constructor a caller could use to build one with another clock.
 */
function createWebhooks(now: () => number): Webhooks {
  function verify(
    rawBody: string | Uint8Array,
    headers: WebhookHeaders,
    secret: string | string[],
  ): Event {
    const body = bodyText(rawBody);
    const keys = signers(secret);
    const id = exactlyOnce(headers, 'webhook-id');
    const timestamp = exactlyOnce(headers, 'webhook-timestamp');
    const signature = exactlyOnce(headers, 'webhook-signature').split(/\s+/).join(' ');
    if (!/^\d{1,15}$/.test(timestamp)) fail('missing_headers');
    const nowS = Math.floor(now() / 1000);
    if (Math.abs(nowS - Number(timestamp)) > TOLERANCE_S) fail('timestamp_out_of_tolerance');
    const required = {
      'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': signature,
    };
    // The headers and the time are checked: any refusal of the library now is the signature's.
    const verified = keys.some((key) => {
      try {
        key.verify(body, required, { jsonParse: false });
        return true;
      } catch {
        return false;
      }
    });
    if (!verified) fail('bad_signature');
    let event: unknown;
    try {
      event = JSON.parse(body);
    } catch {
      event = undefined;
    }
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new VibeViewError('The webhook is signed, but its body is not a JSON event.');
    }
    return event as Event;
  }
  return Object.freeze({ verify });
}

/** The one `Webhooks` object: `VibeView.webhooks`, and every client's `webhooks`. */
export const webhooks: Webhooks = createWebhooks(() => Date.now());

/**
 * @internal For this package's tests only, through `src/internal.ts` (never exported from
 * the package's entry points): a verifier with its own clock (milliseconds).
 */
export const webhooksWithClock = createWebhooks;
