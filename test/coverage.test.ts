import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VibeView } from '../src/index';
import { OPERATIONS } from '../src/operations';
import { KEY, ORG, PTN } from './helpers';

interface SnapshotOperation {
  operationId: string;
  parameters?: {
    in: string;
    name: string;
    schema?: { type?: string; anyOf?: { type?: string }[] };
  }[];
  security?: Record<string, unknown>[];
}
const document = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, SnapshotOperation>>;
};
const PREFIX = '/api/v1';

/** Every operation of the API, the SDK method that sends it, and a call of it. */
const METHODS: Record<string, [string, (c: VibeView) => Promise<unknown>]> = {
  get_current_partner: ['partner.retrieve', (c) => c.partner.retrieve()],
  get_contract: ['contract.retrieve', (c) => c.contract.retrieve()],
  list_accounts: ['accounts.list', (c) => c.accounts.list()],
  create_account: ['accounts.create', (c) => c.accounts.create({ external_ref: 'r' })],
  get_account: ['accounts.retrieve', (c) => c.accounts.retrieve(ORG)],
  update_account: ['accounts.update', (c) => c.accounts.update(ORG, {})],
  delete_account: ['accounts.del', (c) => c.accounts.del(ORG)],
  suspend_account: ['accounts.suspend', (c) => c.accounts.suspend(ORG)],
  resume_account: ['accounts.resume', (c) => c.accounts.resume(ORG)],
  add_extra_minutes: [
    'accounts.addExtraMinutes',
    (c) => c.accounts.addExtraMinutes(ORG, { streaming_minutes: 30 }),
  ],
  mint_access_token: [
    'accounts.tokens.create',
    (c) => c.accounts.tokens.create(ORG, { scopes: ['sessions:read'] }),
  ],
  revoke_access_token: ['accounts.tokens.revoke', (c) => c.accounts.tokens.revoke(ORG, 'atok_1')],
  list_partner_usage: ['partnerUsage.list', (c) => c.partnerUsage.list()],
  list_partner_events: ['events.list', (c) => c.events.list()],
  list_webhook_endpoints: ['webhookEndpoints.list', (c) => c.webhookEndpoints.list()],
  get_webhook_endpoint: ['webhookEndpoints.retrieve', (c) => c.webhookEndpoints.retrieve('whe_1')],
  recover_webhook_endpoint: [
    'webhookEndpoints.recover',
    (c) => c.webhookEndpoints.recover('whe_1', { since: 1 }),
  ],
  list_webhook_deliveries: ['webhookDeliveries.list', (c) => c.webhookDeliveries.list()],
  get_webhook_delivery: [
    'webhookDeliveries.retrieve',
    (c) => c.webhookDeliveries.retrieve('evd_1'),
  ],
  retry_webhook_delivery: ['webhookDeliveries.retry', (c) => c.webhookDeliveries.retry('evd_1')],
  list_shares: ['shares.list', (c) => c.shares.list()],
  list_embed_keys: ['embedKeys.list', (c) => c.embedKeys.list()],
  list_device_pools: ['devicePools.list', (c) => c.devicePools.list()],
  list_apps: ['apps.list', (c) => c.apps.list()],
  get_app: ['apps.retrieve', (c) => c.apps.retrieve('a_1')],
  list_account_usage: ['usage.list', (c) => c.usage.list()],
  list_sessions: ['sessions.list', (c) => c.sessions.list()],
  create_session: ['sessions.create', (c) => c.sessions.create({} as never)],
  get_session: ['sessions.retrieve', (c) => c.sessions.retrieve('s_1')],
  start_session: ['sessions.start', (c) => c.sessions.start('s_1')],
  stop_session: ['sessions.end', (c) => c.sessions.end('s_1')],
  touch_session_presence: ['sessions.keepAlive', (c) => c.sessions.keepAlive('s_1')],
  control_session: ['sessions.control', (c) => c.sessions.control('s_1', {} as never)],
  launch_app: ['sessions.launchApp', (c) => c.sessions.launchApp('s_1', {} as never)],
  run_agent_tool: ['sessions.runAgentTool', (c) => c.sessions.runAgentTool('s_1', {} as never)],
  get_collab_status: ['sessions.collab.retrieve', (c) => c.sessions.collab.retrieve('s_1')],
  update_collab: [
    'sessions.collab.update',
    (c) => c.sessions.collab.update('s_1', { enabled: false }),
  ],
};

const snapshot = Object.entries(document.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, operation]) => ({
    path,
    method: method.toUpperCase(),
    id: operation.operationId,
    params: operation.parameters ?? [],
    security: (operation.security ?? []).flatMap((s) => Object.keys(s)),
  })),
);

describe('every operation of the API has exactly one SDK method', () => {
  it('the table and the API list the same operations', () => {
    expect(Object.keys(METHODS).sort()).toEqual(snapshot.map((o) => o.id).sort());
    expect(Object.keys(OPERATIONS).sort()).toEqual(snapshot.map((o) => o.id).sort());
    const names = Object.values(METHODS).map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(snapshot)('$method $path ($id)', async (expected) => {
    const op = OPERATIONS[expected.id as keyof typeof OPERATIONS];
    expect(op.method).toBe(expected.method);
    expect(PREFIX + op.path).toBe(expected.path);
    const has = (where: string, name: string) =>
      expected.params.some((p) => p.in === where && p.name === name);
    expect(op.idempotencyKey).toBe(has('header', 'Idempotency-Key'));
    expect(op.account).toBe(has('header', 'VibeView-Account'));
    expect(op.paginated).toBe(has('query', 'starting_after'));
    // Only a partner key may call an operation whose only scheme is PartnerKey.
    expect(op.keyOnly).toBe(expected.security.join(',') === 'PartnerKey');
    // Repeated although it takes no key: only presence ("repeating it is harmless").
    expect(op.harmlessRepeat).toBe(expected.id === 'touch_session_presence');

    const sent: { method: string; path: string }[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ method: init?.method ?? 'GET', path: new URL(String(url)).pathname });
      return new Response(
        JSON.stringify({ object: 'list', id: 'x_1', data: [], has_more: false }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }) as typeof fetch;
    const client = new VibeView({
      apiKey: KEY,
      partner: PTN,
      account: ORG,
      baseUrl: 'https://api.example.test/api/v1',
      fetch: fakeFetch,
    });
    const entry = METHODS[expected.id];
    expect(entry).toBeDefined();
    await entry?.[1](client);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe(expected.method);
    const pattern = new RegExp(
      '^' + expected.path.replace(/\{[^}]+\}/g, '[^/]+').replace(/\//g, '\\/') + '$',
    );
    expect(sent[0]?.path).toMatch(pattern);
  });
});

describe('query parameters', () => {
  it('the only list-typed query parameter is sessions.list status (sent repeated; see transport.test.ts)', () => {
    const lists = snapshot.flatMap((o) =>
      o.params
        .filter(
          (p) =>
            p.in === 'query' &&
            (p.schema?.type === 'array' || (p.schema?.anyOf ?? []).some((a) => a.type === 'array')),
        )
        .map((p) => `${o.id}.${p.name}`),
    );
    expect(lists).toEqual(['list_sessions.status']);
  });
});
