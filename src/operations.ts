import type { operations } from './generated/api';

export type OperationId = keyof operations;

/**
 * How to send one operation of the API. test/coverage.test.ts checks every entry against
 * openapi.json: the method, the path, whether it takes `Idempotency-Key`, whether it acts
 * in an account (`VibeView-Account`), whether it pages with `starting_after` and whether
 * only a partner key may call it (its only security scheme is `PartnerKey`).
 */
export interface Operation {
  readonly id: OperationId;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relative to the base URL (`https://vibeview.io/api/v1`). */
  readonly path: string;
  readonly idempotencyKey: boolean;
  readonly account: boolean;
  readonly paginated: boolean;
  /** Only a partner key may call it (the routes under `/partners/{ptn}/`). */
  readonly keyOnly: boolean;
  /**
   * Safe to send again although it takes no key and is not a GET or DELETE (the API
   * documents repeating it as harmless).
   */
  readonly harmlessRepeat: boolean;
}

function op<K extends OperationId>(
  id: K,
  method: Operation['method'],
  path: string,
  flags: {
    idempotencyKey?: boolean;
    account?: boolean;
    paginated?: boolean;
    harmlessRepeat?: boolean;
  } = {},
): Operation & { id: K } {
  return {
    id,
    method,
    path,
    idempotencyKey: flags.idempotencyKey ?? false,
    account: flags.account ?? false,
    paginated: flags.paginated ?? false,
    keyOnly: path.startsWith('/partners/{ptn}'),
    harmlessRepeat: flags.harmlessRepeat ?? false,
  };
}

const keyed = { idempotencyKey: true };
const inAccount = { account: true };

export const OPERATIONS = {
  get_current_partner: op('get_current_partner', 'GET', '/partners/me'),
  get_contract: op('get_contract', 'GET', '/partners/{ptn}/contract'),
  list_accounts: op('list_accounts', 'GET', '/partners/{ptn}/accounts', { paginated: true }),
  create_account: op('create_account', 'POST', '/partners/{ptn}/accounts', keyed),
  get_account: op('get_account', 'GET', '/partners/{ptn}/accounts/{org}'),
  update_account: op('update_account', 'PATCH', '/partners/{ptn}/accounts/{org}'),
  delete_account: op('delete_account', 'DELETE', '/partners/{ptn}/accounts/{org}'),
  suspend_account: op('suspend_account', 'POST', '/partners/{ptn}/accounts/{org}/suspend', keyed),
  resume_account: op('resume_account', 'POST', '/partners/{ptn}/accounts/{org}/resume', keyed),
  mint_access_token: op(
    'mint_access_token',
    'POST',
    '/partners/{ptn}/accounts/{org}/tokens',
    keyed,
  ),
  revoke_access_token: op(
    'revoke_access_token',
    'DELETE',
    '/partners/{ptn}/accounts/{org}/tokens/{atok}',
  ),
  list_partner_usage: op('list_partner_usage', 'GET', '/partners/{ptn}/usage', {
    paginated: true,
  }),
  list_partner_events: op('list_partner_events', 'GET', '/partners/{ptn}/events', {
    paginated: true,
  }),
  list_webhook_endpoints: op('list_webhook_endpoints', 'GET', '/partners/{ptn}/webhook-endpoints', {
    paginated: true,
  }),
  get_webhook_endpoint: op(
    'get_webhook_endpoint',
    'GET',
    '/partners/{ptn}/webhook-endpoints/{whe}',
  ),
  recover_webhook_endpoint: op(
    'recover_webhook_endpoint',
    'POST',
    '/partners/{ptn}/webhook-endpoints/{whe}/recover',
    keyed,
  ),
  list_webhook_deliveries: op(
    'list_webhook_deliveries',
    'GET',
    '/partners/{ptn}/webhook-deliveries',
    { paginated: true },
  ),
  get_webhook_delivery: op(
    'get_webhook_delivery',
    'GET',
    '/partners/{ptn}/webhook-deliveries/{evd}',
  ),
  retry_webhook_delivery: op(
    'retry_webhook_delivery',
    'POST',
    '/partners/{ptn}/webhook-deliveries/{evd}/retry',
    keyed,
  ),
  list_device_pools: op('list_device_pools', 'GET', '/devices/pools', inAccount),
  list_account_usage: op('list_account_usage', 'GET', '/usage', { ...inAccount, paginated: true }),
  list_sessions: op('list_sessions', 'GET', '/sessions/', { ...inAccount, paginated: true }),
  create_session: op('create_session', 'POST', '/sessions/', { ...inAccount, ...keyed }),
  get_session: op('get_session', 'GET', '/sessions/{session_id}', inAccount),
  start_session: op('start_session', 'POST', '/sessions/{session_id}/start', {
    ...inAccount,
    ...keyed,
  }),
  stop_session: op('stop_session', 'DELETE', '/sessions/{session_id}', inAccount),
  touch_session_presence: op(
    'touch_session_presence',
    'POST',
    '/sessions/{session_id}/presence',
    // "…/presence takes no key either; repeating it is harmless" (the errors page).
    { ...inAccount, harmlessRepeat: true },
  ),
  control_session: op('control_session', 'POST', '/sessions/{session_id}/control', inAccount),
  launch_app: op('launch_app', 'POST', '/sessions/{session_id}/launch-app', inAccount),
  run_agent_tool: op('run_agent_tool', 'POST', '/sessions/{session_id}/agent/tools', inAccount),
  get_collab_status: op('get_collab_status', 'GET', '/sessions/{session_id}/collab', inAccount),
  update_collab: op('update_collab', 'PUT', '/sessions/{session_id}/collab', {
    ...inAccount,
    ...keyed,
  }),
} as const satisfies { [K in OperationId]: Operation & { id: K } };
