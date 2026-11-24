import { VibeViewError } from '../errors';
import { mintWithRecovery, type OnAlreadyCreated } from '../idempotency';
import { OPERATIONS } from '../operations';
import type { PagePromise } from '../pagination';
import { ownTransport, type Transport } from '../transport';
import type {
  AccessToken,
  AccessTokenCreateParams,
  Account,
  AccountCreateParams,
  AccountDeleteParams,
  AccountDeletion,
  AccountExtraMinutesParams,
  AccountListParams,
  AccountSuspendParams,
  AccountUpdateParams,
  AccountWithUsage,
  APIResponse,
  List,
  RequestOptions,
  RevokedAccessToken,
} from '../types';

/** Options of `accounts.tokens.create`. */
export interface AccessTokenCreateOptions extends RequestOptions {
  /**
   * When the client made the `Idempotency-Key` (you passed none) and a retry of this call
   * answers `409 already_created` (the API minted the token but the answer to an earlier
   * attempt was lost, so nobody holds its secret): `"recover"` (the default) revokes that
   * token and mints a new one with a new key; `"throw"` throws the `APIError`.
   *
   * With your own `idempotencyKey`, a `409 already_created` is always thrown: another call
   * may hold that token. Its `error.id` names it; revoke it and mint with a new key if you
   * no longer hold the secret. If the revoke fails, the `409` is thrown with the revoke's
   * error as its `cause`: the token stays live until it expires or you revoke it.
   */
  onAlreadyCreated?: OnAlreadyCreated;
}

/** Access tokens: short-lived credentials for one account, minted with your partner key. */
export class TokensResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Mints an access token for the account (`POST /partners/{ptn}/accounts/{org}/tokens`). */
  create(
    account: string,
    body: AccessTokenCreateParams,
    options: AccessTokenCreateOptions = {},
  ): Promise<APIResponse<AccessToken>> {
    const { onAlreadyCreated = 'recover', ...request } = options;
    if (onAlreadyCreated !== 'recover' && onAlreadyCreated !== 'throw') {
      throw new VibeViewError('The onAlreadyCreated option must be "recover" or "throw".');
    }
    return mintWithRecovery(
      (idempotencyKey, sent) =>
        this.#t.request<AccessToken>(OPERATIONS.mint_access_token, {
          path: { org: account },
          body,
          options: { ...request, idempotencyKey },
          sent,
        }),
      (id) =>
        this.revoke(account, id, {
          signal: request.signal,
          timeoutMs: request.timeoutMs,
          maxRetries: request.maxRetries,
        }),
      'access_token',
      request.idempotencyKey,
      onAlreadyCreated,
    );
  }

  /** Revokes an access token (`DELETE /partners/{ptn}/accounts/{org}/tokens/{atok}`). */
  revoke(
    account: string,
    token: string,
    options?: RequestOptions,
  ): Promise<APIResponse<RevokedAccessToken>> {
    return this.#t.request(OPERATIONS.revoke_access_token, {
      path: { org: account, atok: token },
      options,
    });
  }
}

/** Your customers' accounts (`/partners/{ptn}/accounts`). */
export class AccountsResource {
  readonly #t: Transport;
  readonly tokens: TokensResource;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
    this.tokens = new TokensResource(transport);
  }

  /** Creates an account. */
  create(body: AccountCreateParams, options?: RequestOptions): Promise<APIResponse<Account>> {
    return this.#t.request(OPERATIONS.create_account, { body, options });
  }

  /** Reads an account, with its usage this period. */
  retrieve(account: string, options?: RequestOptions): Promise<APIResponse<AccountWithUsage>> {
    return this.#t.request(OPERATIONS.get_account, { path: { org: account }, options });
  }

  /** Changes an account's display name or limits. */
  update(
    account: string,
    body: AccountUpdateParams,
    options?: RequestOptions,
  ): Promise<APIResponse<Account>> {
    return this.#t.request(OPERATIONS.update_account, { path: { org: account }, body, options });
  }

  /** Lists your accounts, newest first. */
  list(params?: AccountListParams, options?: RequestOptions): PagePromise<List<Account>> {
    return this.#t.list(OPERATIONS.list_accounts, { query: params, options });
  }

  /** The live account with this `external_ref`, or null when you have none. */
  async findByExternalRef(
    externalRef: string,
    options?: RequestOptions,
  ): Promise<APIResponse<Account> | null> {
    if (typeof externalRef !== 'string' || externalRef.length === 0) {
      throw new VibeViewError('The externalRef argument must be a non-empty string.');
    }
    const page = await this.list({ external_ref: externalRef, limit: 1 }, options);
    const account = page.data[0];
    if (account === undefined) return null;
    Object.defineProperty(account, 'lastResponse', { value: page.lastResponse, enumerable: false });
    return account as APIResponse<Account>;
  }

  /** Suspends an account: ends its sessions and refuses every request in it until you resume it. */
  suspend(
    account: string,
    body?: AccountSuspendParams,
    options?: RequestOptions,
  ): Promise<APIResponse<Account>> {
    return this.#t.request(OPERATIONS.suspend_account, {
      path: { org: account },
      body: body ?? undefined,
      options,
    });
  }

  /**
   * Gives the account extra streaming minutes for one period: used only once that period's
   * monthly minutes are used up, and ending with it (`account.extra.expires_at`). Each call
   * adds `streaming_minutes`; the client sends an `Idempotency-Key`, the same on every
   * retry, so a retry never adds twice. `period_start` defaults to the current period; pass
   * a `session.cutoff_warning`'s `cutoff.period.start` to extend a session that started in
   * the previous period. Answers the account, its `extra` being what is left in that period.
   * Set what is left with `accounts.update(account, { extra: { streaming_minutes } })`.
   */
  addExtraMinutes(
    account: string,
    body: AccountExtraMinutesParams,
    options?: RequestOptions,
  ): Promise<APIResponse<Account>> {
    return this.#t.request(OPERATIONS.add_extra_minutes, { path: { org: account }, body, options });
  }

  /** Resumes an account you suspended. */
  resume(account: string, options?: RequestOptions): Promise<APIResponse<Account>> {
    return this.#t.request(OPERATIONS.resume_account, { path: { org: account }, options });
  }

  /** Deletes an account. Irreversible. */
  del(
    account: string,
    params?: AccountDeleteParams,
    options?: RequestOptions,
  ): Promise<APIResponse<AccountDeletion>> {
    return this.#t.request(OPERATIONS.delete_account, {
      path: { org: account },
      query: params,
      options,
    });
  }
}
