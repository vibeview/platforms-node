import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach } from 'vitest';
import { VibeView, type ClientOptions } from '../src/index';
import { INTERNAL, type Internals } from '../src/internal';

// Obviously fake credentials, built in code.
export const KEY = 'vvp_test_' + 'x'.repeat(38);
export const TOKEN = 'vvat_' + 'y'.repeat(38);
export const PTN = 'ptn_' + '0'.repeat(16);
export const ORG = 'org_' + '1'.repeat(16);
/** The clock of test clients: 2026-11-22T12:00:00Z. */
export const NOW = Date.UTC(2026, 10, 22, 12, 0, 0);

export interface Seen {
  method: string;
  url: URL;
  headers: IncomingMessage['headers'];
  body: string;
}

/** What the fake API does with one request; `undefined` drops the connection. */
export type Reply =
  | {
      status: number;
      body?: unknown;
      raw?: string;
      headers?: Record<string, string>;
      delayMs?: number;
    }
  | 'drop';

export interface FakeApi {
  baseUrl: string;
  seen: Seen[];
  /** Replies in order; the last one repeats. */
  replies: Reply[];
  close(): Promise<void>;
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

/** A fake API on 127.0.0.1 (a free port), closed after each test. */
export async function fakeApi(
  replies: Reply[] | ((seen: Seen, index: number) => Reply),
): Promise<FakeApi> {
  const seen: Seen[] = [];
  const api: FakeApi = {
    baseUrl: '',
    seen,
    replies: Array.isArray(replies) ? replies : [],
    close: async () => {},
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const entry: Seen = {
        method: req.method ?? '',
        url: new URL(req.url ?? '/', 'http://127.0.0.1'),
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      seen.push(entry);
      const index = seen.length - 1;
      const reply =
        typeof replies === 'function'
          ? replies(entry, index)
          : (api.replies[Math.min(index, api.replies.length - 1)] as Reply);
      if (reply === 'drop') {
        req.socket.destroy();
        return;
      }
      const send = () => {
        if (res.destroyed) return;
        const payload = reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
        res.writeHead(reply.status, {
          'Content-Type': reply.raw === undefined ? 'application/json' : 'text/html',
          'X-Request-ID': `req_${String(index).padStart(24, '0')}`,
          ...reply.headers,
        });
        res.end(payload);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  api.baseUrl = `http://127.0.0.1:${port}/api/v1`;
  return api;
}

export interface TestClient {
  client: VibeView;
  delays: number[];
}

/** A client of the fake API whose back-off waits are recorded, not slept. */
export function testClient(
  api: { baseUrl: string },
  options: Partial<ClientOptions> = {},
): TestClient {
  const delays: number[] = [];
  const internals: Internals = {
    sleep: async (ms) => {
      delays.push(ms);
    },
    random: () => 0.5,
    now: () => NOW,
  };
  const client = new VibeView({
    ...(options.accessToken === undefined ? { apiKey: KEY } : {}),
    partner: PTN,
    baseUrl: api.baseUrl,
    ...options,
    [INTERNAL]: internals,
  } as ClientOptions);
  return { client, delays };
}

export function errorBody(code: string, message: string, extra: Record<string, unknown> = {}) {
  return {
    detail: message,
    error: { code, message, request_id: 'req_ae2b7b5e6bbee20ee2fae8f1', ...extra },
  };
}

export const account = (id: string, externalRef = 'cust_1042') => ({
  object: 'account',
  id,
  external_ref: externalRef,
  display_name: externalRef,
  status: 'active',
  suspended_by: [],
  suspended_reason: null,
  limits: {},
  livemode: false,
  created: 1795270000,
});
