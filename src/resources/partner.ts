import { OPERATIONS } from '../operations';
import type { PagePromise } from '../pagination';
import { ownTransport, type Transport } from '../transport';
import type {
  APIResponse,
  Partner,
  Contract,
  Event,
  EventListParams,
  List,
  PartnerUsageListParams,
  RequestOptions,
  UsageList,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookDeliveryListParams,
  WebhookEndpoint,
  WebhookEndpointListParams,
  WebhookEndpointRecoverParams,
} from '../types';

/** The partner this client's credential belongs to. */
export class PartnerResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /**
   * Which partner and environment the credential belongs to (and, for an access token,
   * its account). Works with a key or a token. Its answer is also the partner id the
   * client uses for the calls under `/partners/{ptn}/`, so calling it first saves the
   * lookup those calls would make. It runs with the client's own `maxRetries` and
   * `timeoutMs` per attempt: this call's `timeoutMs` and `signal` only bound how long it
   * waits, and its `maxRetries` does not apply.
   */
  retrieve(options?: RequestOptions): Promise<APIResponse<Partner>> {
    // Shares a lookup in flight, and refills the client's cache of the partner id.
    return this.#t.retrievePartner(options);
  }
}

/** Your contract: limits, prices, capabilities and API version. */
export class ContractResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Reads your current contract. */
  retrieve(options?: RequestOptions): Promise<APIResponse<Contract>> {
    return this.#t.request(OPERATIONS.get_contract, { options });
  }
}

/** The events VibeView recorded for your partner. */
export class EventsResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Lists events, newest first. */
  list(params?: EventListParams, options?: RequestOptions): PagePromise<List<Event>> {
    return this.#t.list(OPERATIONS.list_partner_events, { query: params, options });
  }
}

/** Usage records of every account of yours (scope `partner_usage:read`). */
export class PartnerUsageResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Lists usage records, by day, account and unit. */
  list(params?: PartnerUsageListParams, options?: RequestOptions): PagePromise<UsageList> {
    return this.#t.list(OPERATIONS.list_partner_usage, { query: params, options });
  }
}

/** Your webhook endpoints. */
export class WebhookEndpointsResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Lists your webhook endpoints. */
  list(
    params?: WebhookEndpointListParams,
    options?: RequestOptions,
  ): PagePromise<List<WebhookEndpoint>> {
    return this.#t.list(OPERATIONS.list_webhook_endpoints, { query: params, options });
  }

  /** Reads one webhook endpoint. */
  retrieve(endpoint: string, options?: RequestOptions): Promise<APIResponse<WebhookEndpoint>> {
    return this.#t.request(OPERATIONS.get_webhook_endpoint, { path: { whe: endpoint }, options });
  }

  /** Sends the endpoint every event since `since` again. */
  recover(
    endpoint: string,
    body: WebhookEndpointRecoverParams,
    options?: RequestOptions,
  ): Promise<APIResponse<WebhookEndpoint>> {
    return this.#t.request(OPERATIONS.recover_webhook_endpoint, {
      path: { whe: endpoint },
      body,
      options,
    });
  }
}

/** Deliveries of events to your webhook endpoints. */
export class WebhookDeliveriesResource {
  readonly #t: Transport;

  /** @internal Built by `new VibeView()` only. */
  constructor(transport: Transport) {
    this.#t = ownTransport(transport);
  }

  /** Lists deliveries, newest first. */
  list(
    params?: WebhookDeliveryListParams,
    options?: RequestOptions,
  ): PagePromise<List<WebhookDelivery>> {
    return this.#t.list(OPERATIONS.list_webhook_deliveries, { query: params, options });
  }

  /** Reads one delivery, with its attempts. */
  retrieve(
    delivery: string,
    options?: RequestOptions,
  ): Promise<APIResponse<WebhookDeliveryDetail>> {
    return this.#t.request(OPERATIONS.get_webhook_delivery, { path: { evd: delivery }, options });
  }

  /** Sends a delivery again now. */
  retry(delivery: string, options?: RequestOptions): Promise<APIResponse<WebhookDelivery>> {
    return this.#t.request(OPERATIONS.retry_webhook_delivery, { path: { evd: delivery }, options });
  }
}
