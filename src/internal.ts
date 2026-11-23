// Hooks for this package's own tests (time and randomness). Not part of the public API:
// nothing here is exported from the package's entry point.

export const INTERNAL: unique symbol = Symbol('vibeview.platforms.internal');

import type { PartnerCache } from './transport';

export interface Internals {
  /** Shared by a client and its withAccount clients (not a test hook). */
  partnerCache?: PartnerCache;
  /** Waits `ms` (rejects with the signal's reason when it aborts). */
  sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** A number in [0, 1), for the back-off jitter. */
  random?: () => number;
  /** The current time in milliseconds (for an HTTP-date `Retry-After`). */
  now?: () => number;
}

/** A webhook verifier with its own clock (milliseconds), for the webhook tests. */
export { webhooksWithClock } from './webhooks';
