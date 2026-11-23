# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-23

### Added

- `apps.list()` and `apps.retrieve()`: the apps an account can start a session on, its own
  and those your organization shares with your partner (`App`, `AppListParams`; `access` is
  `own` or `shared`). `sessions.create({ app })` accepts a shared app's id.
- The `app_unavailable` session end reason: the app the session was started on is no
  longer shared with the account (its share was removed).
- The `app_blocked` (403: the app is not allowed to run) and `app_cannot_run` (409: the
  app's build cannot run on the device the session asked for) error codes.

### Changed

- The `app_not_found` error now reads "No app this account can use has that id." (its code
  and status are unchanged).

## [0.2.0] - 2026-11-23

Not published on its own: these changes first shipped in 0.3.0.

### Added

- `shares.list()`: the apps your organization shares with your partner (`Share`,
  `ShareListParams`), the `share.created` and `share.deleted` event types (`share.deleted`
  carries `data.reason`), and the `share_not_found` error code.

## [0.1.0] - 2026-11-23

### Added

- `VibeView`, a server-side client for the VibeView Partner API, with a partner key
  (`apiKey`) or an account access token (`accessToken`); `withAccount` acts in one account.
- One method per operation of the API: accounts, access tokens, contract, events, webhook
  endpoints and deliveries, partner and account usage, device pools, sessions (create, start,
  keep alive, control, launch an app, agent tools, end) and collab credentials.
- Request and answer types generated from the API's OpenAPI document.
- Retries of the calls that are safe to repeat, with `Retry-After` honoured (up to 60 seconds)
  and an `Idempotency-Key` sent on every call the API takes one on, the same on each retry.
- Lost-answer recovery for access tokens (`onAlreadyCreated`).
- Pagination: `nextPage()` and `for await` over every item of a list.
- Errors: `APIError` (with `code`, an open set, and `ERROR_CODES`), `RateLimitError`,
  `ConnectionError`, `TimeoutError`, `AbortedError`, all extending `VibeViewError`; no error
  shows a key or a token.
- Webhook verification: `VibeView.webhooks.verify` (Standard Webhooks signatures over the raw
  body, a 5-minute timestamp tolerance, secret rotation) and `WebhookVerificationError`.
- Event types: `EVENT_TYPES`, `KnownEventType` and `EventType` (an open set).
- A server-only guard: a browser bundle gets a stand-in that throws.
- ES module and CommonJS builds, with types, for Node 20 or newer.
