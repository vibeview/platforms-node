import { APIError, VibeViewError } from './errors';

const KEY = /^[\x21-\x7e]{1,255}$/;

/** A new random `Idempotency-Key` (a UUIDv4). */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

/** Refuses a key the API would refuse (1 to 255 visible ASCII characters). */
export function checkIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || !KEY.test(key)) {
    throw new VibeViewError(
      'The idempotencyKey option must be 1 to 255 visible ASCII characters (a UUID is a good choice).',
    );
  }
  return key;
}

/** What to do when a mint's retry answers `409 already_created`. */
export type OnAlreadyCreated = 'recover' | 'throw';

/**
 * A mint whose `Idempotency-Key` already created an object answers `409 already_created`
 * with the object's `id`, never its secret.
 *
 * Recovery (revoke that object, mint again with a new key, as the API documents for a lost
 * answer) runs only when both hold:
 * - the client made the key for this call (nobody else can hold it), and
 * - this call already sent the request once (so the object is this call's, and its answer
 *   was lost).
 *
 * With a key the caller chose, a `409 already_created` is always thrown: another call may
 * hold that object's secret (two calls at once, or a repeat of a call that succeeded), and
 * only the caller can know. Recovery runs once; a second `already_created` is thrown. When
 * the revoke fails (other than `404`: already gone), the original `409` is thrown with the
 * revoke's error as its `cause`; its `error.id` names the object still live.
 */
export async function mintWithRecovery<T>(
  mint: (idempotencyKey: string, sent: { count: number }) => Promise<T>,
  revoke: (id: string) => Promise<unknown>,
  objectType: string,
  callerKey: string | undefined,
  onAlreadyCreated: OnAlreadyCreated,
): Promise<T> {
  const ownKey = callerKey === undefined;
  const sent = { count: 0 };
  try {
    return await mint(callerKey ?? newIdempotencyKey(), sent);
  } catch (error) {
    const id = alreadyCreatedId(error, objectType);
    const recover = onAlreadyCreated === 'recover' && ownKey && sent.count >= 2 && id !== null;
    if (!recover) throw error;
    try {
      await revoke(id);
    } catch (revokeError) {
      // Already revoked (or expired): nothing is left to revoke.
      if (!(revokeError instanceof APIError && revokeError.status === 404)) {
        Object.defineProperty(error, 'cause', {
          value: revokeError,
          enumerable: false,
          writable: true,
          configurable: true,
        });
        throw error;
      }
    }
    return mint(newIdempotencyKey(), { count: 0 });
  }
}

function alreadyCreatedId(error: unknown, objectType: string): string | null {
  if (!(error instanceof APIError) || error.status !== 409 || error.code !== 'already_created') {
    return null;
  }
  const { object, id } = error.error;
  return object === objectType && typeof id === 'string' && id.length > 0 ? id : null;
}
