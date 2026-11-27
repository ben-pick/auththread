# Journey schema

Two outputs come from the same journey: OTel spans and one wide event.

## Spans

| Span | Emitted by |
| --- | --- |
| `auth.journey` | stitcher, at finalisation, carries the outcome |
| `auth.app.login_start` | browser, click to redirect |
| `auth.app.callback` | browser, return to the app |
| `auth.app.token_exchange` | browser or app server |
| `auth.ui.screen` | hosted page snippet |
| `auth.hook.execute` | Action or hook wrapper |
| `auth.provider.event` | stitcher, one per joined feed item |

## Attributes

`auth.provider`, `auth.tenant`, `auth.client_id`, `auth.user.hash`, `auth.journey.kind`,
`auth.transaction.id`, `auth.method`, `auth.method.vendor_name`, `auth.ui.stage`,
`auth.ui.vendor_screen`, `auth.ui.vendor_path`, `auth.ui.locale`, `auth.ui.load_ms`,
`auth.ui.ttfb_ms`, `auth.ui.transition_ms`, `auth.ui.first_input_ms`, `auth.ui.hidden_ms`,
`auth.ui.submits`, `auth.ui.validation_errors`, `auth.ui.exceptions`, `auth.ui.exception`,
`auth.ui.visibility_changes`, `auth.ui.repeat`, `auth.ui.autofill`, `auth.ui.delegated`,
`auth.ui.passkey_ms`, `auth.ui.passkey_attempts`, `auth.hook.name`, `auth.hook.type`,
`auth.hook.stage`, `auth.hook.version`, `auth.hook.decision`, `auth.hook.claims_set`,
`auth.error.code`, `auth.error.vendor_code`, `auth.error.source`, `auth.outcome`,
`auth.abandoned_at`, `auth.abandoned_screen`, `auth.correlation`, `auth.passkey.result`.

Neutral values: `auth.journey.kind` is `login`, `signup`, `reset` or `step_up`.
`auth.method` is `password`, `social`, `enterprise_sso`, `passwordless`, `passkey` or `mfa`.
`auth.ui.stage` is `identify`, `authenticate`, `verify`, `enroll`, `select`, `consent`,
`recover`, `status` or `custom`. `auth.abandoned_at` carries the same stage value.
`auth.outcome` is `success`, `failed`, `abandoned` or `denied`.

The journey kind comes from the explicit span attribute, then a signup event, then defaults to
`login`. That keeps a signup and a login from looking identical in a dashboard.

`auth.transaction.id` is an opaque per-transaction identifier. When both a hook and a provider
event carry it, the stitcher joins exactly and records `auth.correlation: exact`. It is not
customer-settable; Auth0 and the hook both receive it from the provider.

Outcome follows the latest terminal signal. A success after a failed attempt makes the journey
`success`, and both attempts remain as steps. A denial is terminal.

Vendor values go in the `vendor_*` slots and nowhere else. That is what lets one
dashboard work for every provider.

`auth.ui.stage` is the coarse, provider-neutral phase. `auth.method` is how the user proved
identity. `auth.ui.vendor_screen` is the provider's own page name. Keeping the three apart is
what lets a Keycloak theme and an Auth0 prompt land in the same dashboard: `stage` aggregates,
`vendor_screen` explains. The page snippet sends the vendor screen and the path; the adapter
maps them to `stage` and `method` in the stitcher, so a new provider screen does not require a
snippet upgrade.

## Wide event

One flat record per journey, with `kind` alongside the outcome. The published JSON Schema is
`packages/core/schema/schema/wide-event-2.json`, and `schemaVersion` is `"2"`. It is generated
from the private Effect contract in `packages/core/contracts/src/index.ts`; run
`mise exec -- pnpm schema:generate` after changing an enum and `pnpm schema:check` verifies it
in `pnpm check`. The neutral enum tuples are declared in `@auththread/schema` and imported by
the contract, so browser packages never import Effect. It carries the root attributes plus
`steps[]` with name, type, offset, duration, neutral stage and method for UI steps, vendor
screen, decision and error code, and `correlationCounts` with how many provider events joined
exactly or by hint.

## Determinism

- A journey sorts spans by start time, then name, then span ID.
- The root span ID is `sha256("root:" + traceId)` truncated to 16 hex characters.
- Provider event spans use `sha256("event:" + eventId)` truncated to 16.
- Sampling is a deterministic function of the trace ID, not random.

Those four rules are why conformance can require byte-identical output across runtimes.
