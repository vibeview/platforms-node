import { VibeViewError } from './errors';
import { INTERNAL, type Internals } from './internal';
import { AccountsResource } from './resources/accounts';
import {
  AppsResource,
  DevicePoolsResource,
  SessionsResource,
  UsageResource,
} from './resources/account-scoped';
import {
  ContractResource,
  EventsResource,
  PartnerResource,
  PartnerUsageResource,
  WebhookDeliveriesResource,
  WebhookEndpointsResource,
  SharesResource,
  EmbedKeysResource,
} from './resources/partner';
import { checkMaxRetries, checkTimeoutMs, Transport } from './transport';
import { VERSION } from './version';
import { webhooks, type Webhooks } from './webhooks';

export const DEFAULT_BASE_URL = 'https://vibeview.io/api/v1';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 30_000;

const PARTNER_KEY = /^vvp_(live|test)_[0-9A-Za-z]+$/;
const ACCESS_TOKEN = /^vvat_[0-9A-Za-z]+$/;
// An id is sent in a path or a header: visible ASCII only.
const ID = /^[\x21-\x7e]+$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface ClientOptions {
  /** A partner key (`vvp_live_…` or `vvp_test_…`). Give this or `accessToken`. */
  apiKey?: string;
  /** An account access token (`vvat_…`). Give this or `apiKey`. */
  accessToken?: string;
  /**
   * Your partner id (`ptn_…`), for the calls under `/partners/{ptn}/`. Optional: without
   * it, the first such call asks the API once (`GET /partners/me`) and the client keeps
   * the answer.
   */
  partner?: string;
  /** The account (`org_…`) a partner key acts in, sent as `VibeView-Account`. */
  account?: string;
  /** Default `https://vibeview.io/api/v1`. */
  baseUrl?: string;
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  /** Retries of a call that can be repeated safely. Default 2. */
  maxRetries?: number;
  /** How long one attempt may take. Default 30000. */
  timeoutMs?: number;
}

function optionalId(value: unknown, option: string, example: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ID.test(value)) {
    throw new VibeViewError(`The ${option} option must be an id (${example}).`);
  }
  return value;
}

function credentialOf(options: ClientOptions): string {
  const { apiKey, accessToken } = options;
  if ((apiKey === undefined) === (accessToken === undefined)) {
    throw new VibeViewError('Pass exactly one of the apiKey and accessToken options.');
  }
  if (apiKey !== undefined) {
    if (typeof apiKey === 'string' && apiKey.startsWith('vvat_')) {
      throw new VibeViewError(
        'The apiKey option holds an access token: pass it as accessToken. apiKey takes a partner key (vvp_live_… or vvp_test_…).',
      );
    }
    if (typeof apiKey !== 'string' || !PARTNER_KEY.test(apiKey)) {
      throw new VibeViewError(
        'The apiKey option must be a partner key (vvp_live_… or vvp_test_…); an access token goes in accessToken.',
      );
    }
    return apiKey;
  }
  if (typeof accessToken === 'string' && accessToken.startsWith('vvp_')) {
    throw new VibeViewError(
      'The accessToken option holds a partner key: pass it as apiKey. accessToken takes an access token (vvat_…).',
    );
  }
  if (typeof accessToken !== 'string' || !ACCESS_TOKEN.test(accessToken)) {
    throw new VibeViewError(
      'The accessToken option must be an access token (vvat_…); a partner key goes in apiKey.',
    );
  }
  return accessToken;
}

function baseUrlOf(value: unknown): string {
  if (value === undefined) return DEFAULT_BASE_URL;
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new VibeViewError('The baseUrl option must be an absolute URL.');
  }
  if (typeof value !== 'string' || /[?#]/.test(value)) {
    throw new VibeViewError('The baseUrl option must be an absolute URL without a query.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new VibeViewError('The baseUrl option must not hold a user name or password.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new VibeViewError(
      'The baseUrl option must use https (http only to this machine): it carries your credential.',
    );
  }
  // The normalised form, so every request's path can be compared with it.
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

/** Shows a credential's kind and never its secret part. */
function redact(credential: string): string {
  const prefix = /^(vvp_(?:live|test)_|vvat_)/.exec(credential)?.[1] ?? '';
  return `${prefix}…(redacted)`;
}

/**
 * A client of the VibeView Partner API, for your server only.
 *
 * ```ts
 * const vibeview = new VibeView({ apiKey: process.env.VIBEVIEW_KEY });
 * ```
 */
export class VibeView {
  /** This package's version. */
  static readonly VERSION: string = VERSION;

  /**
   * Verifies the webhooks VibeView sends to your endpoints. Needs no client and no
   * credential: only the endpoint's signing secret. Every client's `webhooks` is this
   * same object.
   */
  static readonly webhooks: Webhooks = webhooks;

  readonly #credential: string;
  readonly #options: Omit<ClientOptions, 'apiKey' | 'accessToken'>;
  readonly #kind: 'apiKey' | 'accessToken';
  readonly #internals: Internals;
  readonly #transport: Transport;

  readonly accounts: AccountsResource;
  readonly partner: PartnerResource;
  readonly contract: ContractResource;
  readonly events: EventsResource;
  readonly partnerUsage: PartnerUsageResource;
  readonly webhookEndpoints: WebhookEndpointsResource;
  /** The apps your organization shares with your partner. */
  readonly shares: SharesResource;
  /** Your partner's embed keys on the apps your organization shares with it. */
  readonly embedKeys: EmbedKeysResource;
  readonly webhookDeliveries: WebhookDeliveriesResource;
  readonly devicePools: DevicePoolsResource;
  /** The apps the account can start a session on: its own and those shared with your partner. */
  readonly apps: AppsResource;
  readonly usage: UsageResource;
  readonly sessions: SessionsResource;
  /** The same object as `VibeView.webhooks`. */
  readonly webhooks: Webhooks = webhooks;

  constructor(options: ClientOptions) {
    if (options === null || typeof options !== 'object') {
      throw new VibeViewError('Pass the client options: { apiKey } or { accessToken }.');
    }
    this.#credential = credentialOf(options);
    this.#kind = options.apiKey !== undefined ? 'apiKey' : 'accessToken';
    const partner = optionalId(options.partner, 'partner', 'ptn_…');
    const account = optionalId(options.account, 'account', 'org_…');
    const baseUrl = baseUrlOf(options.baseUrl);
    if (options.fetch !== undefined && typeof options.fetch !== 'function') {
      throw new VibeViewError('The fetch option must be a function.');
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new VibeViewError('No fetch: run on Node 20 or newer, or pass the fetch option.');
    }
    const maxRetries =
      options.maxRetries === undefined
        ? DEFAULT_MAX_RETRIES
        : checkMaxRetries(options.maxRetries, 'maxRetries');
    const timeoutMs =
      options.timeoutMs === undefined
        ? DEFAULT_TIMEOUT_MS
        : checkTimeoutMs(options.timeoutMs, 'timeoutMs');
    const internals = (options as { [INTERNAL]?: Internals })[INTERNAL] ?? {};
    this.#internals = {
      ...internals,
      partnerCache: internals.partnerCache ?? { promise: null, settled: false, refresh: null },
    };
    this.#options = {
      partner,
      account,
      baseUrl,
      fetch: options.fetch,
      maxRetries,
      timeoutMs,
    };
    this.#transport = new Transport({
      credential: this.#credential,
      kind: this.#kind === 'apiKey' ? 'key' : 'token',
      baseUrl,
      account,
      partner,
      partnerCache: this.#internals.partnerCache ?? {
        promise: null,
        settled: false,
        refresh: null,
      },
      fetch: fetchImpl,
      maxRetries,
      timeoutMs,
      internals: this.#internals,
    });
    this.accounts = new AccountsResource(this.#transport);
    this.partner = new PartnerResource(this.#transport);
    this.contract = new ContractResource(this.#transport);
    this.events = new EventsResource(this.#transport);
    this.partnerUsage = new PartnerUsageResource(this.#transport);
    this.webhookEndpoints = new WebhookEndpointsResource(this.#transport);
    this.shares = new SharesResource(this.#transport);
    this.embedKeys = new EmbedKeysResource(this.#transport);
    this.webhookDeliveries = new WebhookDeliveriesResource(this.#transport);
    this.devicePools = new DevicePoolsResource(this.#transport);
    this.apps = new AppsResource(this.#transport);
    this.usage = new UsageResource(this.#transport);
    this.sessions = new SessionsResource(this.#transport);
  }

  /** A client like this one that acts in `account` (sends `VibeView-Account`). */
  withAccount(account: string): VibeView {
    if (typeof account !== 'string' || !ID.test(account)) {
      throw new VibeViewError('The account argument must be an account id (org_…).');
    }
    return new VibeView({
      ...this.#options,
      account,
      [this.#kind]: this.#credential,
      [INTERNAL]: this.#internals,
    } as ClientOptions);
  }

  /** The client's settings, with the credential redacted. */
  toJSON(): { baseUrl: string; partner?: string; account?: string; credential: string } {
    return {
      baseUrl: this.#transport.baseUrl,
      ...(this.#options.partner !== undefined ? { partner: this.#options.partner } : {}),
      ...(this.#options.account !== undefined ? { account: this.#options.account } : {}),
      credential: redact(this.#credential),
    };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    const fields = Object.entries(this.toJSON())
      .map(([name, value]) => `${name}: ${JSON.stringify(value)}`)
      .join(', ');
    return `VibeView { ${fields} }`;
  }
}
