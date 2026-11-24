import {
  AbortedError,
  APIError,
  ConnectionError,
  RateLimitError,
  TimeoutError,
  VibeViewError,
} from './errors';
import { checkIdempotencyKey, newIdempotencyKey } from './idempotency';
import type { Internals } from './internal';
import { OPERATIONS, type Operation } from './operations';
import {
  makePage,
  makePagePromise,
  type ListBody,
  type Page,
  type PagePromise,
} from './pagination';
import type { APIResponse, LastResponse, Partner, RequestOptions } from './types';
import { VERSION } from './version';

export const MAX_RETRIES_LIMIT = 10;
/** The longest `Retry-After` the client waits for before a retry. */
export const RETRY_AFTER_CAP_MS = 60_000;
/** Back-off without `Retry-After`: full jitter over 0.5 s × 2^attempt, at most 8 s. */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 8_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface TransportConfig {
  credential: string;
  /** Which credential: a partner key, or an account access token. */
  kind: 'key' | 'token';
  baseUrl: string;
  account: string | undefined;
  partner: string | undefined;
  /** The looked-up partner id, shared by a client and its withAccount clients. */
  partnerCache: PartnerCache;
  fetch: typeof fetch;
  maxRetries: number;
  timeoutMs: number;
  internals: Internals;
}

export interface Call {
  /** Path parameters other than `ptn` (which comes from the client). */
  path?: Record<string, string>;
  query?: object;
  body?: unknown;
  options?: RequestOptions;
  /** Counts the requests this call sent (each attempt adds one before it is sent). */
  sent?: { count: number };
}

/** One lookup of the partner id at a time; a failed one is forgotten. */
export interface PartnerCache {
  promise: Promise<APIResponse<Partner>> | null;
  /** The promise has resolved (a pending one is shared by `partner.retrieve`). */
  settled: boolean;
  /**
   * A `partner.retrieve()` made once the id was known, in flight. It replaces `promise`
   * only when it succeeds, so a failed one keeps the id already known.
   */
  refresh: Promise<APIResponse<Partner>> | null;
}

export function checkMaxRetries(value: unknown, option: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_RETRIES_LIMIT
  ) {
    throw new VibeViewError(
      `The ${option} option must be a whole number from 0 to ${MAX_RETRIES_LIMIT}.`,
    );
  }
  return value;
}

export function checkTimeoutMs(value: unknown, option: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new VibeViewError(`The ${option} option must be a number of milliseconds, at least 1.`);
  }
  return value;
}

function defaultSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** `Retry-After` in milliseconds (seconds or an HTTP date), or undefined. */
export function parseRetryAfter(
  value: string | null,
  now: number = Date.now(),
): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Waits for a shared promise, giving up (for this caller only) on its signal or time-out. */
function waitFor<T>(
  shared: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(aborted(signal));
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      done();
      reject(aborted(signal));
    };
    const timer = setTimeout(() => {
      done();
      reject(new TimeoutError(`No answer from the VibeView API within ${timeoutMs} ms.`));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    shared.then(
      (value) => {
        done();
        resolve(value);
      },
      (error: unknown) => {
        done();
        reject(error);
      },
    );
  });
}

function aborted(signal: AbortSignal | undefined): AbortedError {
  return new AbortedError('The call was aborted by its signal.', { cause: signal?.reason });
}

// Ids are opaque: only refuse what would change the URL's meaning (a separator, an
// escape, a dot segment) or cannot be sent.
const PATH_ID = /^[\x21-\x7e]+$/;
const PATH_ID_FORBIDDEN = /[/?#%\\]/;

function isPathId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    PATH_ID.test(value) &&
    !PATH_ID_FORBIDDEN.test(value) &&
    value !== '.' &&
    value !== '..'
  );
}

/**
 * A resource class is built only by `new VibeView()`: its constructor takes the client's
 * transport, which no other code can make.
 */
export function ownTransport(transport: unknown): Transport {
  if (!(transport instanceof Transport)) {
    throw new VibeViewError(
      "Resource classes are created by new VibeView(); use the client's properties (client.accounts, …).",
    );
  }
  return transport;
}

/** The one place this package calls `fetch`: auth, headers, idempotency and retries. */
export class Transport {
  readonly #credential: string;
  readonly #kind: 'key' | 'token';
  readonly baseUrl: string;
  readonly account: string | undefined;
  readonly partner: string | undefined;
  readonly #partnerCache: PartnerCache;
  readonly #fetch: typeof fetch;
  readonly #maxRetries: number;
  readonly #timeoutMs: number;
  readonly #sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => number;

  constructor(config: TransportConfig) {
    this.#credential = config.credential;
    this.#kind = config.kind;
    this.baseUrl = config.baseUrl;
    this.account = config.account;
    this.partner = config.partner;
    this.#partnerCache = config.partnerCache;
    this.#fetch = config.fetch;
    this.#maxRetries = config.maxRetries;
    this.#timeoutMs = config.timeoutMs;
    this.#sleep = config.internals.sleep ?? defaultSleep;
    this.#random = config.internals.random ?? Math.random;
    this.#now = config.internals.now ?? Date.now;
  }

  /** Sends one operation and returns its JSON body with `lastResponse` attached. */
  async request<T>(op: Operation, call: Call = {}): Promise<APIResponse<T>> {
    const { body, meta } = await this.#send(op, call);
    if (body === null || typeof body !== 'object') {
      throw unspecified(
        meta,
        `The API answered ${meta.status} with a body that is not a JSON object.`,
      );
    }
    Object.defineProperty(body, 'lastResponse', { value: meta, enumerable: false });
    return body as APIResponse<T>;
  }

  /** A list operation: the first page, which can fetch the ones after it. */
  list<L extends ListBody>(op: Operation, call: Call = {}): PagePromise<L> {
    const fetchPage = async (startingAfter: string | undefined): Promise<Page<L>> => {
      const query =
        startingAfter === undefined ? call.query : { ...call.query, starting_after: startingAfter };
      const body = await this.request<L>(op, { ...call, query });
      if (!Array.isArray(body.data)) {
        throw unspecified(body.lastResponse, 'The API answered a list without a data array.');
      }
      return makePage<L>(
        body,
        body.lastResponse,
        op.paginated ? (after) => fetchPage(after) : null,
      );
    };
    return makePagePromise(fetchPage(undefined));
  }

  /**
   * The partner id for the paths under `/partners/{ptn}/`: the `partner` option, else the
   * shared lookup's answer (see `#startLookup`).
   */
  async #partnerId(signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
    if (this.partner !== undefined) return this.partner;
    const cache = this.#partnerCache;
    const shared = cache.promise ?? this.#startLookup();
    return (await waitFor(shared, signal, timeoutMs)).id;
  }

  /**
   * `GET /partners/me` (`partner.retrieve`). A lookup already in flight is shared. Once
   * the id is known, a new request runs (one at a time) and refills the cache only when
   * it succeeds. Its retries and time-out per attempt are the client's own; the call's
   * `timeoutMs` and `signal` only bound how long it waits. Each caller gets its own copy
   * of the answer.
   */
  async retrievePartner(options: RequestOptions = {}): Promise<APIResponse<Partner>> {
    const timeoutMs =
      options.timeoutMs === undefined
        ? this.#timeoutMs
        : checkTimeoutMs(options.timeoutMs, 'timeoutMs');
    if (options.idempotencyKey !== undefined) {
      throw new VibeViewError(
        'This call takes no idempotencyKey option: only the calls the API takes an Idempotency-Key on do (see the README).',
      );
    }
    if (options.maxRetries !== undefined) checkMaxRetries(options.maxRetries, 'maxRetries');
    if (options.signal?.aborted) throw aborted(options.signal);
    const cache = this.#partnerCache;
    let shared: Promise<APIResponse<Partner>>;
    if (cache.promise === null) shared = this.#startLookup();
    else if (!cache.settled) shared = cache.promise;
    else shared = cache.refresh ?? this.#startRefresh();
    const partner = await waitFor(shared, options.signal, timeoutMs);
    // A copy per caller, with its own frozen lastResponse: one caller changing its answer
    // never changes another's.
    const meta = partner.lastResponse;
    const lastResponse: LastResponse = Object.freeze({
      ...meta,
      headers: Object.freeze({ ...meta.headers }),
    });
    return Object.defineProperty({ ...partner }, 'lastResponse', {
      value: lastResponse,
      enumerable: false,
    }) as APIResponse<Partner>;
  }

  /** One `GET /partners/me`, its id checked as a path id before anyone uses it. */
  async #lookup(): Promise<APIResponse<Partner>> {
    const partner = await this.request<Partner>(OPERATIONS.get_current_partner);
    if (!isPathId(partner.id)) {
      throw new VibeViewError(
        'The API answered a partner id that is not an id; pass the partner option instead.',
      );
    }
    return partner;
  }

  /**
   * One `GET /partners/me`, shared by every caller of this client and its withAccount
   * clients. It runs with the client's own time-out and retries (at most `1 + maxRetries`
   * requests) and no caller's signal, so one caller giving up never fails it for the
   * others; each caller only stops waiting (its own signal and `timeoutMs`). A failed
   * lookup is forgotten: the next call tries again.
   */
  #startLookup(): Promise<APIResponse<Partner>> {
    const cache = this.#partnerCache;
    const lookup = this.#lookup();
    cache.promise = lookup;
    cache.settled = false;
    lookup.then(
      () => {
        if (cache.promise === lookup) cache.settled = true;
      },
      () => {
        if (cache.promise === lookup) {
          cache.promise = null;
          cache.settled = false;
        }
      },
    );
    return lookup;
  }

  /** `partner.retrieve()` once the id is known: a success replaces it, a failure keeps it. */
  #startRefresh(): Promise<APIResponse<Partner>> {
    const cache = this.#partnerCache;
    const refresh = this.#lookup();
    cache.refresh = refresh;
    refresh.then(
      () => {
        if (cache.refresh !== refresh) return;
        cache.refresh = null;
        cache.promise = refresh;
        cache.settled = true;
      },
      () => {
        if (cache.refresh === refresh) cache.refresh = null;
      },
    );
    return refresh;
  }

  #url(op: Operation, call: Call, partner: string | undefined): string {
    const path = op.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = name === 'ptn' ? partner : call.path?.[name];
      if (!isPathId(value)) {
        throw new VibeViewError(
          name === 'ptn'
            ? 'The partner option must be an id: visible ASCII without / ? # % \\ or spaces.'
            : `The ${name} argument must be an id: visible ASCII without / ? # % \\ or spaces.`,
        );
      }
      return encodeURIComponent(value);
    });
    const base = new URL(this.baseUrl);
    const basePath = base.pathname === '/' ? '' : base.pathname;
    const url = new URL(base.origin + basePath + path);
    // Nothing in an id may move the request elsewhere: the URL keeps exactly this path.
    if (url.origin !== base.origin || url.pathname !== basePath + path) {
      throw new VibeViewError('The request path is not the one this call sends to.');
    }
    const search = new URLSearchParams();
    for (const [name, value] of Object.entries(call.query ?? {})) {
      if (value === undefined || value === null) continue;
      // A list is the key repeated (`status=active&status=queued`); an empty one is left out.
      if (Array.isArray(value)) {
        for (const item of value) search.append(name, String(item));
      } else {
        search.append(name, String(value));
      }
    }
    url.search = search.toString();
    return url.toString();
  }

  async #send(op: Operation, call: Call): Promise<{ body: unknown; meta: LastResponse }> {
    const options = call.options ?? {};
    const maxRetries =
      options.maxRetries === undefined
        ? this.#maxRetries
        : checkMaxRetries(options.maxRetries, 'maxRetries');
    const timeoutMs =
      options.timeoutMs === undefined
        ? this.#timeoutMs
        : checkTimeoutMs(options.timeoutMs, 'timeoutMs');
    const signal = options.signal;
    if (op.keyOnly && this.#kind === 'token') {
      throw new VibeViewError(
        'This call needs a partner key (the apiKey option): an access token cannot make it.',
      );
    }
    if (op.account && this.#kind === 'key' && this.account === undefined) {
      throw new VibeViewError(
        'This call acts in an account: with a partner key, name it with withAccount(account) or the account option.',
      );
    }
    if (signal?.aborted) throw aborted(signal);
    const partner = op.path.includes('{ptn}')
      ? await this.#partnerId(signal, timeoutMs)
      : undefined;
    const url = this.#url(op, call, partner);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#credential}`,
      Accept: 'application/json',
      'User-Agent': `vibeview-platforms-node/${VERSION}`,
    };
    if (op.account && this.account !== undefined) headers['VibeView-Account'] = this.account;
    if (options.idempotencyKey !== undefined && !op.idempotencyKey) {
      throw new VibeViewError(
        'This call takes no idempotencyKey option: only the calls the API takes an Idempotency-Key on do (see the README).',
      );
    }
    if (op.idempotencyKey) {
      // One key for the call: every retry sends the same one.
      headers['Idempotency-Key'] =
        options.idempotencyKey === undefined
          ? newIdempotencyKey()
          : checkIdempotencyKey(options.idempotencyKey);
    }
    let payload: string | undefined;
    if (call.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(call.body);
    }
    // A request that may act twice (a device input) is never retried; one with a key is
    // replayed by the API; GET and DELETE are safe to repeat, and so is a PATCH (the API's
    // only one, accounts.update): the same body again changes nothing and records no event.
    const repeatable =
      op.method === 'GET' ||
      op.method === 'DELETE' ||
      op.method === 'PATCH' ||
      op.idempotencyKey ||
      op.harmlessRepeat;
    const sleep = async (ms: number) => {
      try {
        await this.#sleep(ms, signal);
      } catch {
        throw aborted(signal);
      }
    };

    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw aborted(signal);
      const canRetry = repeatable && attempt < maxRetries;
      let response: Response;
      let text: string;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      let redirected = false;
      try {
        if (call.sent) call.sent.count += 1;
        response = await this.#fetch(url, {
          method: op.method,
          headers,
          body: payload,
          signal: controller.signal,
          // A redirect is never followed: the body and the key stay with this origin.
          redirect: 'manual',
        });
        redirected = isRedirect(response, url);
        if (redirected) {
          await response.body?.cancel();
          text = '';
        } else {
          text = await response.text();
        }
      } catch (cause) {
        if (signal?.aborted) throw aborted(signal);
        const error = timedOut
          ? new TimeoutError(`No answer from the VibeView API within ${timeoutMs} ms.`)
          : new ConnectionError(
              'The request to the VibeView API failed before an answer arrived.',
              {
                cause,
              },
            );
        if (!canRetry) throw error;
        await sleep(this.#backoff(attempt, undefined));
        continue;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }

      if (redirected) {
        throw new VibeViewError(
          response.status === 0 || response.type === 'opaqueredirect'
            ? 'The API answered with a redirect or a blocked response; check the baseUrl option.'
            : `The API answered with a redirect (${response.status}); check the baseUrl option.`,
        );
      }
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.#now());
      const meta = responseMeta(response);
      if (response.ok) {
        try {
          return { body: JSON.parse(text) as unknown, meta };
        } catch {
          throw unspecified(
            meta,
            `The API answered ${response.status} with a body that is not JSON.`,
            retryAfterMs,
          );
        }
      }
      const error = apiError(response.status, response.statusText, text, meta, retryAfterMs);
      const transient =
        response.status >= 500 ||
        response.status === 429 ||
        (response.status === 409 &&
          (error.code === 'idempotency_in_progress' ||
            error.code === 'session_create_in_progress'));
      if (!transient || !canRetry) throw error;
      // Waiting less than the API asked would only be refused again: a longer wait than
      // the cap is the caller's to decide (the error carries retryAfterMs).
      if (retryAfterMs !== undefined && retryAfterMs > RETRY_AFTER_CAP_MS) throw error;
      await sleep(this.#backoff(attempt, retryAfterMs));
    }
  }

  #backoff(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) return retryAfterMs;
    return Math.floor(this.#random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));
  }
}

/**
 * A redirect is never followed, and an answer that came from elsewhere is never returned:
 * a 3xx, an opaque or status-0 answer, or (from an injected fetch that follows anyway) an
 * answer marked redirected or whose URL is not the one sent.
 */
function isRedirect(response: Response, sent: string): boolean {
  if (response.status >= 300 && response.status < 400) return true;
  if (response.status === 0 || response.type === 'opaqueredirect') return true;
  if (response.redirected) return true;
  if (response.url) {
    try {
      const got = new URL(response.url);
      const want = new URL(sent);
      if (got.origin !== want.origin || got.pathname !== want.pathname) return true;
    } catch {
      return true;
    }
  }
  return false;
}

// Never kept on an answer's headers: cookies set by the API or anything in front of it.
const DROPPED_HEADERS = new Set(['set-cookie', 'set-cookie2']);

function responseMeta(response: Response): LastResponse {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (DROPPED_HEADERS.has(name.toLowerCase())) return;
    headers[name] = value;
  });
  return {
    requestId: response.headers.get('x-request-id') ?? undefined,
    status: response.status,
    headers,
  };
}

function unspecified(meta: LastResponse, message: string, retryAfterMs?: number): APIError {
  return new APIError({
    status: meta.status,
    error: { code: 'unspecified', message },
    requestId: meta.requestId,
    message,
    headers: meta.headers,
    retryAfterMs,
  });
}

function apiError(
  status: number,
  statusText: string,
  text: string,
  meta: LastResponse,
  retryAfterMs: number | undefined,
): APIError {
  let parsed: unknown = undefined;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // Not JSON (a proxy's page, an empty body): described below.
  }
  const inner = (parsed as { error?: unknown } | null | undefined)?.error;
  let error: Record<string, unknown>;
  if (
    inner !== null &&
    typeof inner === 'object' &&
    typeof (inner as { code?: unknown }).code === 'string'
  ) {
    error = inner as Record<string, unknown>;
  } else {
    // No error object: a string `detail` is the message, else the status line.
    const detail = (parsed as { detail?: unknown } | null | undefined)?.detail;
    const message =
      typeof detail === 'string' && detail.length > 0
        ? detail
        : `The API answered ${`${status} ${statusText}`.trim()}.`;
    error = { code: 'unspecified', message, ...(detail !== undefined ? { detail } : {}) };
  }
  const init = {
    status,
    error,
    requestId: typeof error.request_id === 'string' ? error.request_id : meta.requestId,
    message: typeof error.message === 'string' ? error.message : `The API answered ${status}.`,
    headers: meta.headers,
    retryAfterMs,
  };
  return status === 429 ? new RateLimitError(init) : new APIError(init);
}
