import type { components, operations } from './generated/api';
import type { EventType } from './generated/event-types';
import type { OperationId } from './operations';

/** Options every method takes as its last argument. */
export interface RequestOptions {
  /**
   * The `Idempotency-Key` to send. Only the calls the API takes one on accept it (the
   * README lists them); when you give none, the client makes a random one and reuses it
   * on every retry of the call.
   */
  idempotencyKey?: string;
  /** Aborts the call (no retry follows): it throws `AbortedError`. */
  signal?: AbortSignal;
  /**
   * Overrides the client's `timeoutMs` for this call (per attempt). While a call waits for
   * the partner-id lookup (`partner.retrieve()` included), it bounds that whole wait.
   */
  timeoutMs?: number;
  /**
   * Overrides the client's `maxRetries` for this call. The partner-id lookup
   * (`partner.retrieve()` included) always uses the client's own.
   */
  maxRetries?: number;
}

/** What the API answered, beside the object it returned. */
export interface LastResponse {
  /** The answer's `X-Request-ID`: quote it when you contact support. */
  readonly requestId: string | undefined;
  readonly status: number;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * An object as the API sent it, with `lastResponse` added as a non-enumerable property
 * (so `JSON.stringify` gives exactly the API's JSON).
 */
export type APIResponse<T> = T & { readonly lastResponse: LastResponse };

// --- Internal helpers over the generated document (never exported from the package) ---

type Json<R> = R extends { content: { 'application/json': infer T } } ? T : never;

/** The JSON body of an operation's successful answer. */
export type Ok<O extends OperationId> = {
  [K in keyof operations[O]['responses']]: K extends 200 | 201 | 202
    ? Json<operations[O]['responses'][K]>
    : never;
}[keyof operations[O]['responses']];

/** The JSON body an operation takes. */
export type Body<O extends OperationId> = operations[O] extends {
  requestBody?: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** The query parameters an operation takes. */
export type Query<O extends OperationId> = NonNullable<operations[O]['parameters']['query']>;

type Schema<N extends keyof components['schemas']> = components['schemas'][N];

// --- The package's public names for what the API takes and returns ---
// (The server's own model names are not part of this package's API: only these are.)

/** A page of a list, as the API sends it. */
export interface List<T> {
  object?: 'list';
  data: T[];
  has_more: boolean;
}

/** The partner a credential belongs to (its id, name, environment and, for a token, account). */
export type Partner = Schema<'PartnerOut'>;

/** Your contract: limits, prices, capabilities and API version. */
export type Contract = Schema<'ContractOut'>;

/** An account. */
export type Account = Schema<'AccountOut'>;
/** An account, with its usage this period (`accounts.retrieve`). */
export type AccountWithUsage = Schema<'AccountWithUsageOut'>;
/** The answer to deleting an account. */
export type AccountDeletion = Schema<'AccountDeletionOut'>;
export type AccountCreateParams = Body<'create_account'>;
export type AccountUpdateParams = Body<'update_account'>;
export type AccountSuspendParams = NonNullable<Body<'suspend_account'>>;
export type AccountListParams = Query<'list_accounts'>;
export type AccountDeleteParams = Query<'delete_account'>;

/** An access token, with its secret `token` (shown once). */
export type AccessToken = Schema<'AccessTokenOut'>;
/** The answer to revoking an access token. */
export type RevokedAccessToken = Schema<'AccessTokenRevokedOut'>;
export type AccessTokenCreateParams = Body<'mint_access_token'>;

/** A type's named members, without its index signature. */
type Named<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/**
 * An event (`events.list`, `webhooks.verify`). `type` is an open set: a known type
 * (`EVENT_TYPES`), or any other string a newer API sends.
 */
export type Event = Omit<Named<Schema<'EventOut'>>, 'type'> & {
  type: EventType;
  [key: string]: unknown;
};
export type EventListParams = Query<'list_partner_events'>;

/** A webhook endpoint. */
export type WebhookEndpoint = Schema<'WebhookEndpointOut'>;
export type WebhookEndpointListParams = Query<'list_webhook_endpoints'>;
export type WebhookEndpointRecoverParams = Body<'recover_webhook_endpoint'>;

/** A delivery of an event to an endpoint. */
export type WebhookDelivery = Schema<'WebhookDeliveryOut'>;
/** A delivery, with its attempts (`webhookDeliveries.retrieve`). */
export type WebhookDeliveryDetail = Schema<'WebhookDeliveryDetailOut'>;
export type WebhookDeliveryListParams = Query<'list_webhook_deliveries'>;

/** One account's usage on one UTC day, in one unit. */
export type UsageRecord = Schema<'UsageRecord'>;
/** A page of usage records (with `current_period` for one account). */
export type UsageList = Schema<'UsageList'>;
export type UsageListParams = Query<'list_account_usage'>;
export type PartnerUsageListParams = Query<'list_partner_usage'>;

/** A device a session can be started on (one offering of `devicePools.list`). */
export type Device = Schema<'DeviceOut'>;

/** A session. */
export type Session = Schema<'SessionOut'>;
export type SessionCreateParams = Body<'create_session'>;
export type SessionListParams = Query<'list_sessions'>;
/** The answer to `sessions.keepAlive`. */
export type SessionPresence = Schema<'SessionPresenceOut'>;
export type SessionControlParams = Body<'control_session'>;
/** The answer to `sessions.control`. */
export type SessionControlResult = Schema<'SessionControlOut'>;
export type SessionLaunchAppParams = Body<'launch_app'>;
/** The answer to `sessions.launchApp`. */
export type SessionLaunchAppResult = Schema<'AppLaunchOut'>;
export type SessionRunAgentToolParams = Body<'run_agent_tool'>;
/** The answer to `sessions.runAgentTool`. */
export type SessionRunAgentToolResult = Schema<'ToolResultOut'>;

/** Whether collaboration is on for a session (never a credential). */
export type CollabStatus = Schema<'CollabStatusOut'>;
/** A collab credential (its `url` and `token` are shown once), or the answer to turning it off. */
export type CollabCredential = Schema<'CollabCredentialOut'>;
export type CollabUpdateParams = Body<'update_collab'>;
