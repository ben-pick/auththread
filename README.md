# auththread

Instrument your auth once and see every login end to end: app, hosted login page, server
hooks and provider logs, stitched into one journey and sent to the observability tool you
already use. Any provider, any cloud, any backend. OpenTelemetry by default, never required.

Auth0 is the first deep integration. A generic OIDC adapter covers any standards-based
provider from day one. This repo is the instrumentation, the stitching and the adapter
framework. A paid reliability service comes later in a separate repo (ADR-0006).

## What v0.1 ships

| Area | In this release |
| --- | --- |
| Core | Neutral schema, double redaction, tiny OTLP exporter, adapter contracts, conformance suites, stitcher |
| Providers | `oidc` (browser, any OIDC provider), `auth0` (browser params, Log Stream feed, Action wrapper, page snippet, config fetch) |
| Runtimes | Cloudflare (Durable Object buffer and alarms), Node (memory buffer, timer scheduler, JSON settings) |
| Sinks | OTLP, wide event to stdout, HMAC webhook |
| Examples | Keycloak in Docker, Node image, Cloudflare Worker |
| Docs | Adding a provider, adding a runtime, schema, privacy, decisions |

Out of scope for v0.1: a UI or trace store, alerts, AI, deep adapters beyond Auth0, and
anything that can block or slow a login.

## Quick start

```sh
mise install
pnpm install
pnpm demo
```

`pnpm demo` replays the shared journey corpus through the Auth0 adapter and prints one wide
event with five ordered steps and outcome `denied`. It exits non-zero if the journey breaks.

For the full stack with a real login:

```sh
pnpm --filter @auththread/example-keycloak build
docker compose -f examples/keycloak-compose/docker-compose.yml up --build
```

Then sign in at http://localhost:8080 and read the journey in Grafana at http://localhost:3000.
See `examples/keycloak-compose/README.md`.

## How the trace survives the redirect

1. The browser SDK makes a W3C trace ID and stores it in `sessionStorage`.
2. The provider adapter decides how to carry it through `/authorize`:
   - `auth0`: `ext-trace_id`, which the Universal Login template and a post-login Action can read.
   - `oidc`: nothing. The browser SDK keys the journey on its own state round trip.
3. Hook wrappers and page plugins read the ID and emit spans to the stitcher.
4. Provider feed items are normalised, then joined by an exact trace ID when present,
   otherwise by a user hash inside the same tenant and a two minute window.
5. The stitcher finalises on a quiet period, derives the root span ID as
   `sha256("root:" + traceId)[0..16]`, and writes the journey to every sink.

Every emitter derives the same root span ID without a round trip, and the same recorded
logins produce identical output on every runtime.

## Packages

| Package | What it is |
| --- | --- |
| `@auththread/schema` | Neutral attributes, redaction, hashing, ids, journey and wide event |
| `@auththread/otlp` | OTLP/HTTP JSON encoder, batch and beacon exporters |
| `@auththread/adapter-kit` | Provider, runtime and sink contracts, memory runtime, conformance suites, corpus |
| `@auththread/stitcher` | `createStitcher`: the Fetch handler and the join |
| `@auththread/browser` | Provider-neutral browser SDK |
| `@auththread/oidc` | Generic OIDC adapter and browser helper |
| `@auththread/auth0` | Auth0 adapter, browser helper, Action wrapper, page snippet |
| `@auththread/runtime-node` | Node server, timer scheduler, file settings |
| `@auththread/runtime-cloudflare` | Durable Object buffer and alarm scheduler |
| `@auththread/sink-otlp` | Spans to any OTLP backend |
| `@auththread/sink-wide-event` | One JSON journey per line |
| `@auththread/sink-webhook` | Signed journey JSON |

## Support status

A provider, runtime or sink is supported only when its conformance suite is green
(ADR-0004). Run `pnpm test` to check every row below.

| Adapter | Level | Status |
| --- | --- | --- |
| Generic OIDC | L1 browser | v0.1 |
| Auth0 | L1 to L5 (browser, Log Streams, Actions, page template, Management API config) | v0.1 |
| Cognito, Okta, Supabase, Clerk, WorkOS, Keycloak deep | | community |
| Cloudflare Workers, Node/Docker | buffer, scheduler, settings | v0.1 |
| Redis, Postgres, D1, Lambda, Kubernetes | | next |
| OTLP, wide event, webhook | | v0.1 |
| Object store, Datadog native, Splunk HEC, Kafka | | community |

Storage backends beyond memory and Durable Object storage are deferred by ADR-0007, and the
page snippet supply chain is manual by ADR-0008. Both are recorded rather than implied.

## Neutral attributes

Span names: `auth.journey`, `auth.app.login_start`, `auth.app.callback`,
`auth.app.token_exchange`, `auth.ui.screen`, `auth.hook.execute`, `auth.provider.event`.

Attributes are `auth.*`, for example `auth.method`, `auth.ui.step`, `auth.hook.decision`,
`auth.error.code`, `auth.outcome`. Vendor detail is limited to `auth.method.vendor_name`,
`auth.ui.vendor_screen` and `auth.error.vendor_code`. See `docs/schema.md`.

Redaction runs twice, in the emitter and in the stitcher. A missing salt drops identifiers
instead of storing them. Secrets, tokens, OTPs, cookies and request bodies are never read.

## Principles

- Never in the login path. Emitters are fire and forget or hard timed out.
- No PII by default.
- Core never imports a provider, runtime or sink. `pnpm boundaries` enforces it.
- OpenTelemetry by default, never required. Wide events go straight to logs or a warehouse.
- Conformance over trust.

## Development

```sh
mise exec -- pnpm check   # typecheck, lint, tests, boundaries, agent files
mise exec -- pnpm demo    # replay the corpus and print one journey
```

`docs/verification.md` lists what v0.1 proved and what it did not.

MIT licensed. DCO sign-off on every commit. See `CONTRIBUTING.md` and `SECURITY.md`.
