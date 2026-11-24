// What a browser bundle gets instead of the client: a partner key or access token must
// never reach a web page. Loading this module throws; it also exports the package's names,
// each throwing too, so a bundler that keeps only what is used still fails loudly.
// (package.json lists this file in `sideEffects`, so bundlers keep its top-level throw.)

const MESSAGE =
  '@vibeview/platforms is server-only: it holds your partner key and must never run in a ' +
  'browser. Call it from your server, and give a browser only a collab credential.';

function refuse(): never {
  throw new Error(MESSAGE);
}

export class VibeView {
  constructor() {
    refuse();
  }
}
export class VibeViewError extends Error {
  constructor() {
    super(MESSAGE);
    refuse();
  }
}
export class APIError extends VibeViewError {}
export class RateLimitError extends APIError {}
export class ConnectionError extends VibeViewError {}
export class TimeoutError extends ConnectionError {}
export class AbortedError extends VibeViewError {}
export class WebhookVerificationError extends VibeViewError {}
export class AccountsResource extends VibeView {}
export class TokensResource extends VibeView {}
export class ContractResource extends VibeView {}
export class PartnerResource extends VibeView {}
export class EventsResource extends VibeView {}
export class PartnerUsageResource extends VibeView {}
export class WebhookEndpointsResource extends VibeView {}
export class SharesResource extends VibeView {}
export class EmbedKeysResource extends VibeView {}
export class WebhookDeliveriesResource extends VibeView {}
export class DevicePoolsResource extends VibeView {}
export class AppsResource extends VibeView {}
export class UsageResource extends VibeView {}
export class SessionsResource extends VibeView {}
export class CollabResource extends VibeView {}
export function signVisitorToken(): never {
  refuse();
}
export const VISITOR_TOKEN_MAX_TTL = 900;
export const ERROR_CODES: Record<string, never> = new Proxy({}, { get: refuse, ownKeys: refuse });
export const EVENT_TYPES: Record<string, never> = new Proxy({}, { get: refuse, ownKeys: refuse });

refuse();
