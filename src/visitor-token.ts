import { VibeViewError } from './errors';

/** What `signVisitorToken` needs. */
export interface VisitorTokenParams {
  /** The embed key's id (`ek_test_…` or `ek_live_…`): the key in the embed URL. */
  embedKey: string;
  /** The embed key's visitor secret (`vvis_…`), from `embedKeys` create, rotate or reveal. */
  secret: string;
  /** The account the visitor's session runs in (`org_…`). */
  account: string;
  /**
   * Your own id for the visitor (1 to 200 characters, no control characters). The same
   * `subject` in the same account gets their session back after a reload; in another account
   * it is another visitor.
   */
  subject: string;
  /** Seconds the token is valid, 1 to 900 (default 300). Sign a fresh one for each page load. */
  ttl?: number;
  /** The signing time in seconds (default: now). For tests. */
  now?: number;
}

/** The longest a visitor token may live, in seconds. */
export const VISITOR_TOKEN_MAX_TTL = 900;
const DEFAULT_TTL = 300;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ACCOUNT = /^org_[0-9a-f]{16}$/;
const EMBED_KEY = /^ek_(?:live|test)_[a-z0-9]{24}$/;

function invalid(message: string): never {
  throw new VibeViewError(message);
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Sign the visitor token a page passes to a partner embed key's frame
 * (`#visitor_token=…` on the embed URL): an HS256 JWT signed with the key's visitor secret,
 * naming the account the session runs in (`acc`) and your id for the visitor (`sub`).
 * Sign it on your server, never in the browser: the secret must not reach a web page.
 *
 * Throws `VibeViewError` for an input the embed would refuse. Uses the Web Crypto API
 * (Node 20 and later, and edge runtimes).
 */
export async function signVisitorToken(params: VisitorTokenParams): Promise<string> {
  const { embedKey, secret, account, subject } = params;
  const ttl = params.ttl ?? DEFAULT_TTL;
  if (typeof embedKey !== 'string' || !EMBED_KEY.test(embedKey)) {
    invalid('embedKey must be an embed key id (ek_live_… or ek_test_…).');
  }
  if (typeof secret !== 'string' || !secret.startsWith('vvis_')) {
    invalid("secret must be the embed key's visitor secret (vvis_…).");
  }
  if (typeof account !== 'string' || !ACCOUNT.test(account)) {
    invalid('account must be an account id (org_…).');
  }
  if (
    typeof subject !== 'string' ||
    subject.length < 1 ||
    subject.length > 200 ||
    CONTROL.test(subject)
  ) {
    invalid('subject must be 1 to 200 characters with no control characters.');
  }
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > VISITOR_TOKEN_MAX_TTL) {
    invalid(`ttl must be a whole number of seconds from 1 to ${VISITOR_TOKEN_MAX_TTL}.`);
  }
  const iat = params.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(iat) || iat < 0) invalid('now must be a whole number of seconds.');
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({
    type: 'embed_visitor',
    key: embedKey,
    acc: account,
    sub: subject,
    iat,
    exp: iat + ttl,
  });
  const signingInput = `${header}.${payload}`;
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}
