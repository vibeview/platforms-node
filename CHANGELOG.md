# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.13.0] - 2026-11-24

### Added

- Pinned builds: `sessions.create` takes `build`, a build id of the session's `app` (the
  build's public id, as the organization that uploaded it reads it). The session installs that
  build instead of the app's newest. Every session carries `build` (the pinned build's id;
  `null` without a pin or once the pinned build is deleted), in reads and in `session.*`
  events, and `reuse` matches on it. A build that is not one of the app's, has expired or
  cannot run on the offering is `422 invalid_request` with `field: "build"`.

## [0.12.0] - 2026-11-24

### Added

- Sessions that can leave their app: `sessions.create` takes `confined` (`true` by default).
  `confined: false` asks for a session that is not held in its app (Home, the app switcher and
  the device's other apps work), only when your contract includes it; `app` is still required.
  Every session carries `confined`, in reads and in `session.*` events. A reuse matches it too:
  a confined and an unconfined session are never returned for each other.
- The `unconfined_sessions_not_allowed` error code (403: `confined: false` without it in your
  contract; nothing is created).

## [0.11.0] - 2026-11-24

### Added

- Labels and reuse for sessions: `sessions.create` takes `labels` (up to 10 pairs, keys and
  values 1 to 64 letters, digits and `. _ : -`; a key given twice keeps its last value) and
  `reuse: true` (needs a label), which returns the account's live session created with exactly
  the same labels, app and offering instead of a new one. Its answer is `SessionCreated`: the
  session plus `reused`. Every session carries `labels` (an empty object for none), in reads
  and in `session.*` events.
- The `session_create_in_progress` error code (409: another request with the same labels is
  creating the account's session). The client retries it like `idempotency_in_progress`.

## [0.10.0] - 2026-11-24

### Added

- `signVisitorToken({ embedKey, secret, account, subject, ttl })`: signs the visitor token a
  page passes to a partner embed key's frame (`#visitor_token=…`). The token names the account
  the visitor's session runs in (`acc`); the same `subject` in another account is another
  visitor. Sign it on your server. `VISITOR_TOKEN_MAX_TTL` (900 seconds) is the longest a
  token may live.
- The `visitor_account_required` and `visitor_account_invalid` error codes (403, answered to the
  embed frame): the token has no `acc`, or names no usable account of yours.
- `session.created` of a session one of your embed keys started carries `data.created_via`
  (`embed`), `data.embed_key` and `data.visitor`.

## [0.9.0] - 2026-11-24

### Added

- The `app_lost` session end reason: the session's app kept closing or leaving the screen and
  could not be brought back. A new session may work; if it keeps happening, check the app.

## [0.8.0] - 2026-11-24

### Added

- Extra streaming minutes: `accounts.addExtraMinutes(account, { streaming_minutes, period_start? })`
  gives an account minutes beyond its `streaming_minutes_per_month` for one period (used once
  the period's monthly minutes are used up, ending with the period; sent with an
  `Idempotency-Key`, so a retry never adds twice). `accounts.update(account, { extra: {
  streaming_minutes } })` sets what is left. The account carries `extra` (`streaming_minutes`
  left now, `expires_at`). `AccountExtraMinutesParams`.
- The `extra_not_applicable` error code (409: the account's `streaming_minutes_per_month` is
  `"unlimited"`).
- `session.streaming_seconds`: the session's metered streaming time (also on `session.ended`).
- `cutoff.period` on `session.cutoff_warning`: the account period the session is measured
  against (its `start` is the `period_start` that extends it).

### Changed

- `period_change_blocked` (409) is also answered for a change of anchor day to today's day while a
  session or build that started before today is still running (the rule: anything started before
  the period the change would make current). A change to a later day is refused as before.
- An account's sessions are warned 120 seconds or less before its streaming limit and end at
  it (they were warned after it and ended a minute later). `cutoff.ends_at` is the estimated
  moment the limit is reached at the current rate.


## [0.7.0] - 2026-11-24

### Added

- Account periods: an account's monthly limits now count in its own period, which starts on
  its `period_anchor_day` (1 to 31; the day it was created unless you set another). The
  account carries `period_anchor_day` and `period` (`start`, `end`); `accounts.create` and
  `accounts.update` take `period_anchor_day`. A change cuts the current period at the next
  occurrence of the new day.
- The `period_change_blocked` error code (409: a session or build that started before the
  account's current period is still running; retry once it has ended).

### Changed

- `usage.period`, `current_period` and an account's `usage.threshold` lines are the
  account's period instead of the calendar month. `streaming_minutes_per_month` and
  `build_minutes_per_month` count per period. Usage records and their default range stay
  per calendar month (UTC).
## [0.6.0] - 2026-11-24

### Changed

- `sessions.create()` needs `app`: a session without one is refused (`422 invalid_request`,
  `field: "app"`). The type still marks it optional, so a later change can lift the rule
  without a type change.
- A session stays in its app: `sessions.launchApp()` of another app and `sessions.control()`
  of a button or key that leaves the app (Home, the app switcher, Lock, Siri) answer
  `409 app_not_in_session`. The `press_button` agent tool for those buttons, and `open_url`
  on iOS, answer `ok: false` with `reason: "app_not_in_session"`.
- A session's app must be in front before the device takes input or a screen read: until the
  session has opened its app, and while another app is in front (the app is being brought
  back), `sessions.control()`, `sessions.launchApp()` and `sessions.runAgentTool()` (every
  tool, reads included) answer `409 session_not_ready`. Retry in a few seconds.
- `SessionRunAgentToolResult.reason` is now `string | null` instead of a union of known
  values: new reasons may appear, so handle one you do not know as `action_failed`. The
  known values are listed in its documentation (`app_not_in_session` is new).

### Added

- The `app_not_in_session` and `session_not_ready` error codes (409), and the
  `app_not_in_session` agent tool result reason.

## [0.4.0] - 2026-11-24

### Added

- `embedKeys.list()`: your partner's embed keys on the apps your organization shares with it
  (`EmbedKey`, `EmbedKeyListParams`; scope `accounts:read`). Keys are created and managed on
  the Partner page and start serving sessions with a later release.
- The `embed_key.created`, `embed_key.updated`, `embed_key.revoked` (with `data.reason`:
  `requested`, `share_removed` or `partner_terminated`), `embed_key.secret_rotated` and
  `embed_key.secret_revealed` event types, and the `embed_key_not_found` error code.

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
