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
`auth.method`, `auth.method.vendor_name`, `auth.ui.step`, `auth.ui.vendor_screen`,
`auth.hook.name`, `auth.hook.type`, `auth.hook.stage`, `auth.hook.version`,
`auth.hook.decision`, `auth.hook.claims_set`, `auth.error.code`, `auth.error.vendor_code`,
`auth.error.source`, `auth.outcome`, `auth.abandoned_at`, `auth.correlation`,
`auth.passkey.result`.

Neutral values: `auth.journey.kind` is `login`, `signup`, `reset` or `step_up`.
`auth.method` is `password`, `social`, `enterprise_sso`, `passwordless`, `passkey` or `mfa`.
`auth.ui.step` is `identifier`, `password`, `mfa_challenge`, `consent`, `signup` or `reset`.
`auth.outcome` is `success`, `failed`, `abandoned` or `denied`.

The journey kind comes from the explicit span attribute, then a signup event, then defaults to
`login`. That keeps a signup and a login from looking identical in a dashboard.

Vendor values go in the three `vendor_*` slots and nowhere else. That is what lets one
dashboard work for every provider.

## Wide event

One flat record per journey, with `kind` alongside the outcome. The published JSON Schema is
`packages/core/schema/schema/wide-event-1.json`. It carries the root attributes plus
`steps[]` with name, type, offset, duration, decision and error code, and
`correlationCounts` with how many provider events joined exactly or by hint.

## Determinism

- A journey sorts spans by start time, then name, then span ID.
- The root span ID is `sha256("root:" + traceId)` truncated to 16 hex characters.
- Provider event spans use `sha256("event:" + eventId)` truncated to 16.
- Sampling is a deterministic function of the trace ID, not random.

Those four rules are why conformance can require byte-identical output across runtimes.
