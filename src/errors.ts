import type { ErrorCode } from './generated/error-codes';

/**
 * The base class of every error this package throws on purpose.
 *
 * The package ships an ES module and a CommonJS build: if your program loads both,
 * `instanceof` fails across them. Checking `error.name` (and an `APIError`'s `code`) works
 * either way.
 */
export class VibeViewError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** What an `APIError` is built from. */
export interface APIErrorInit {
  status: number;
  error: Record<string, unknown>;
  requestId: string | undefined;
  message: string;
  headers: Readonly<Record<string, string>>;
  retryAfterMs: number | undefined;
}

/**
 * The API answered with an error. `code` is the stable part to branch on (an open set:
 * a newer API may send a code this version does not list); `error` is the whole error
 * object as the API sent it, including the members a code adds (`id`, `object`, `limit`…).
 */
export class APIError extends VibeViewError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId: string | undefined;
  readonly field?: string;
  readonly error: Record<string, unknown>;
  /** The answer's headers, names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  /** The answer's `Retry-After` in milliseconds, when it sent one (any status). */
  readonly retryAfterMs: number | undefined;

  constructor(init: APIErrorInit) {
    super(init.message);
    this.status = init.status;
    this.error = init.error;
    this.code = typeof init.error.code === 'string' ? init.error.code : 'unspecified';
    this.requestId = init.requestId;
    if (typeof init.error.field === 'string') this.field = init.error.field;
    this.headers = init.headers;
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** A `429`. `limit` names the limit that was reached (`partner`, `account`, `session`…). */
export class RateLimitError extends APIError {
  readonly limit?: string;

  constructor(init: APIErrorInit) {
    super(init);
    if (typeof init.error.limit === 'string') this.limit = init.error.limit;
  }
}

/** The request failed before an answer arrived (DNS, connection, TLS, reset). */
export class ConnectionError extends VibeViewError {}

/** No answer arrived within `timeoutMs`. */
export class TimeoutError extends ConnectionError {}

/** The caller's `signal` aborted the call; `cause` is the abort reason. Never retried. */
export class AbortedError extends VibeViewError {}
