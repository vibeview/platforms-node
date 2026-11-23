// Calls that act in one account: with a partner key they need the client's account
// (`new VibeView({ account })` or `client.withAccount(account)`); an access token is
// bound to its account already.
import { OPERATIONS } from '../operations';
import type { PagePromise } from '../pagination';
import { ownTransport, type Transport } from '../transport';
import type {
  SessionRunAgentToolResult,
  APIResponse,
  App,
  AppListParams,
  CollabCredential,
  CollabStatus,
  CollabUpdateParams,
  Device,
  List,
  RequestOptions,
  Session,
  SessionControlParams,
  SessionControlResult,
  SessionCreateParams,
  SessionLaunchAppParams,
  SessionLaunchAppResult,
  SessionListParams,
  SessionPresence,
  SessionRunAgentToolParams,
  UsageList,
  UsageListParams,
} from '../types';

/** The devices a session can be started on. */
export class DevicePoolsResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Lists the device offerings, one per type, category, model and OS version. */
  list(options?: RequestOptions): PagePromise<List<Device>> {
    return this.#t.list(OPERATIONS.list_device_pools, { options });
  }
}

/**
 * The apps the account can start a session on (scope `apps:read`): its own, and the apps
 * your organization shares with your partner (`access: 'shared'`).
 */
export class AppsResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Lists the apps the account can use, newest first. */
  list(params?: AppListParams, options?: RequestOptions): PagePromise<List<App>> {
    return this.#t.list(OPERATIONS.list_apps, { query: params, options });
  }

  /** One app the account can use; any other id is `404 app_not_found`. */
  retrieve(app: string, options?: RequestOptions): Promise<APIResponse<App>> {
    return this.#t.request(OPERATIONS.get_app, { path: { app_id: app }, options });
  }
}

/** The account's usage records (scope `usage:read`). */
export class UsageResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Lists the account's usage records, by day and unit. */
  list(params?: UsageListParams, options?: RequestOptions): PagePromise<UsageList> {
    return this.#t.list(OPERATIONS.list_account_usage, { query: params, options });
  }
}

/** Browser access to a session: collab credentials. */
export class CollabResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Whether collaboration is on and how many guests are connected. Never a credential. */
  retrieve(session: string, options?: RequestOptions): Promise<APIResponse<CollabStatus>> {
    return this.#t.request(OPERATIONS.get_collab_status, {
      path: { session_id: session },
      options,
    });
  }

  /**
   * Mints a collab credential (`enabled: true`) or revokes every credential of the session
   * (`enabled: false`). A repeat of a mint with the same key answers `409 already_created`,
   * which is thrown: recovering would disconnect every guest of the session.
   */
  update(
    session: string,
    body: CollabUpdateParams,
    options?: RequestOptions,
  ): Promise<APIResponse<CollabCredential>> {
    return this.#t.request(OPERATIONS.update_collab, {
      path: { session_id: session },
      body,
      options,
    });
  }
}

/** Sessions on a device, in the account. */
export class SessionsResource {
  readonly #t: Transport;
  readonly collab: CollabResource;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
    this.collab = new CollabResource(transport);
  }

  /** Creates a session. */
  create(body: SessionCreateParams, options?: RequestOptions): Promise<APIResponse<Session>> {
    return this.#t.request(OPERATIONS.create_session, { body, options });
  }

  /** Lists the account's sessions, newest first. */
  list(params?: SessionListParams, options?: RequestOptions): PagePromise<List<Session>> {
    return this.#t.list(OPERATIONS.list_sessions, { query: params, options });
  }

  /** Reads a session. */
  retrieve(session: string, options?: RequestOptions): Promise<APIResponse<Session>> {
    return this.#t.request(OPERATIONS.get_session, { path: { session_id: session }, options });
  }

  /** Starts a created session on a device. */
  start(session: string, options?: RequestOptions): Promise<APIResponse<Session>> {
    return this.#t.request(OPERATIONS.start_session, { path: { session_id: session }, options });
  }

  /** Ends a session. Ending it twice is safe. */
  end(session: string, options?: RequestOptions): Promise<APIResponse<Session>> {
    return this.#t.request(OPERATIONS.stop_session, { path: { session_id: session }, options });
  }

  /** Holds the session for 60 seconds: call it every 15 seconds. */
  keepAlive(session: string, options?: RequestOptions): Promise<APIResponse<SessionPresence>> {
    return this.#t.request(OPERATIONS.touch_session_presence, {
      path: { session_id: session },
      options,
    });
  }

  /** Sends input to the device. Not idempotent: never retried, a repeat is a second input. */
  control(
    session: string,
    body: SessionControlParams,
    options?: RequestOptions,
  ): Promise<APIResponse<SessionControlResult>> {
    return this.#t.request(OPERATIONS.control_session, {
      path: { session_id: session },
      body,
      options,
    });
  }

  /** Opens an app on the device. Not idempotent: never retried. */
  launchApp(
    session: string,
    body: SessionLaunchAppParams,
    options?: RequestOptions,
  ): Promise<APIResponse<SessionLaunchAppResult>> {
    return this.#t.request(OPERATIONS.launch_app, { path: { session_id: session }, body, options });
  }

  /** Runs one agent tool on the device. Not idempotent: never retried. */
  runAgentTool(
    session: string,
    body: SessionRunAgentToolParams,
    options?: RequestOptions,
  ): Promise<APIResponse<SessionRunAgentToolResult>> {
    return this.#t.request(OPERATIONS.run_agent_tool, {
      path: { session_id: session },
      body,
      options,
    });
  }
}
