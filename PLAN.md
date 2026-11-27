# auththread: open-source auth journey tracing

> Name chosen: auththread. Remaining checks: domain and trademark.
> Plan version: 2026-11-26 (rev 4: provider-, cloud- and observability-agnostic by design)

---

## 🎯 THE v0.1 GOAL (read this first)

> **A developer can see one complete login journey (app → hosted login page → server hooks → provider logs) in the observability tool they already use, within 30 minutes of installing.**

**Timebox:** 6 weeks, starting only after Phase 0 passes (≥5 teams confirm the gap; `ext-trace_id` survives end to end on a real Auth0 tenant).

**In scope**

| Area | v0.1 ships |
| --- | --- |
| Core | Neutral schema + PII stripping, tiny OTLP exporter, adapter interfaces + conformance tests, stitcher |
| Providers | **Generic OIDC** (browser tracing for any standards-based provider) · **Auth0** deep (browser helper with `ext-trace_id`, login-page snippet, `withTrace()` Action wrapper, Log Stream ingest) |
| Runtimes | **Cloudflare** (Worker + one Durable Object per login, no Queue) · **Node/Docker** (memory or Redis) |
| Sinks | **OTLP** · **wide-event JSON** to stdout · **signed webhook** |
| Extras | Grafana + Datadog dashboards, Keycloak example in Docker compose, Auth0 example via Terraform, "adding a provider / runtime" docs |

**Out of scope:** our own UI or trace storage; alerts, testing, coverage, AI (paid, Phase 2+); deep adapters for providers other than Auth0; anything that can block or slow a login beyond the 250 ms Action timeout.

**Rules:** never in the login path · no PII by default · core never imports provider or cloud code · OpenTelemetry by default, never required · MIT licence + DCO sign-off.

**v0.1 is done when ALL of these are true:**

- [ ] The Keycloak example runs on every PR and shows success, failure and abandoned journeys in Grafana
- [ ] A three-screen Auth0 login plus a deny Action produces one ordered trace with screen, Action and Auth0 log events
- [ ] Every provider, runtime and sink passes conformance, and the same recorded logins produce identical output on both runtimes
- [ ] The Action wrapper adds < 50 ms at p95; the browser SDK is < 5 KB gzipped
- [ ] It's in production at 3 design-partner teams before public launch

*Everything below this line explains and supports this goal. If a task doesn't serve it, it waits for v0.2.*

---

## 1. One-liner

**Instrument your auth once and see every login end to end, browser → login page → server hooks → token, in the observability tool you already use. Any auth provider, any cloud, any backend. OpenTelemetry by default, never required.**

Auth0 is the first deep integration. A generic OIDC adapter works with any standards-based provider from day one. The open-source project is the instrumentation, the stitching and the adapter framework. A paid "auth reliability" service (coverage, replay tests, PR checks, AI root cause) comes later and is **out of scope for this repo** (see §14).

## 2. Problem

- Auth providers expose fragments: hosted login pages you can't see into, server-side hooks with poor logging, and event feeds with no link to the browser.
- Auth0 example: Action `console.log` output only shows in a live stream, and execution details aren't in Log Streams. Nothing ties app, hosted page, Actions and tenant logs to one ID. There's no OpenTelemetry export or per-user journey trace (checked Nov 2026).
- Every provider has a different event model, so teams rebuild the same glue per provider, and again when they migrate.

## 3. Goals and non-goals

### v0.1 goals

1. One journey per login attempt, deliverable through pluggable **sinks**:
   - OTLP traces (Datadog, Grafana Tempo, Honeycomb, Jaeger, Elastic, New Relic, Splunk…)
   - a "wide event" (one JSON record per journey) for logs-only and warehouse setups: stdout, HTTP webhook, or NDJSON files to S3/GCS/R2
   - see §6.7
2. **Adapter framework**, published and documented, so a new provider or runtime is a package, not a fork:
   - provider adapters
   - runtime adapters (buffer, scheduler, settings, secrets)
   - sinks (output adapters, §6.7)
   - conformance test kits
3. **Two provider adapters** that prove the framework from both ends:
   - `oidc` (generic): browser-level tracing for *any* OIDC/OAuth 2.0 provider: authorize → callback → token.
   - `auth0` (deep): adds hosted-page snippet, `withTrace()` Action wrapper, Log Stream ingest and config fetch.
4. **Two runtimes** that prove cloud portability:
   - `cloudflare`: Worker + Durable Objects
   - `node`: a Docker image that runs on any cloud or Kubernetes, with in-memory or Redis buffer
5. Ready-made Datadog and Grafana dashboards built only on provider-neutral attributes.
6. Examples: Next.js + Auth0 (Terraform), and Next.js + Keycloak in Docker compose, which needs no cloud account.

### Non-goals (v0.1)

- Our own trace store or UI (customers use their own tool).
- Deep adapters beyond Auth0 (the framework must support them; building them comes next).
- Session replay, alerts (use your tool's monitors), testing and coverage (paid service).
- Anything that sits in the login path or can block a login.

## 4. Principles

1. **Never in the login path.** Every emitter is fire-and-forget or hard-timeout. If auththread is down, users still log in.
2. **No PII by default.** Hash user identifiers (salted, per tenant); never read form values, passwords, tokens, OTPs or credential data. Redact in the emitter *and* the stitcher.
3. **OpenTelemetry by default, never required.** The *internal* data model is the OTel span model with W3C trace IDs, because it's the most portable shape. *Output* goes through sinks, and OTLP is just the default one. Teams without tracing get the same journey as a wide event in their logs or warehouse. If the app already uses an OTel SDK, we join its tracer instead of shipping our own (§6.8). We never invent a proprietary wire format: inbound is OTLP/JSON, outbound is OTLP or documented JSON.
4. **Adapters, not forks.** `core` never imports a provider SDK or a cloud SDK. Enforced in CI with dependency-cruiser rules: `packages/core/**` may not depend on `providers/**`, `runtimes/**` or any vendor package.
5. **Provider-neutral schema.** Attributes describe *auth concepts* (UI screen, server hook, provider event), not vendor features. Vendor detail goes in a small number of `*.type` / `*.vendor_name` attributes.
6. **Graceful capability levels.** Every provider gets *some* tracing (browser-level via OIDC). Deeper capture switches on where the provider allows it.
7. **Conformance over trust.** An adapter is "supported" only if it passes the shared conformance suite in CI.
8. **Approve what we collect.** Any script injected into a hosted login page is versioned and SRI-pinned. Customers upgrade deliberately.

## 5. Architecture

```
 YOUR STACK (any provider)                          STITCHER (any runtime)                        ANY BACKEND (via sinks)
 ┌─────────────────────────────┐
 │ App + @auththread/browser    │─ spans ─┐
 │ + provider helper (trace ID)│         │
 └─────────────────────────────┘         │
 ┌─────────────────────────────┐         │       ┌──────────────────────────────────┐        ┌───────────────────┐
 │ Hosted login page plugin    │─ spans ─┼─────▶ │ stitcher-core                    │─sinks▶ │ OTLP: Datadog,    │
 │ (if provider allows JS)     │         │       │  ├ ProviderAdapter (per provider)│        │ Tempo, Honeycomb… │
 └─────────────────────────────┘         │       │  ├ JourneyBuffer  (per runtime)  │        │ Wide event: logs, │
 ┌─────────────────────────────┐         │       │  ├ Scheduler      (per runtime)  │        │ webhook, S3/GCS → │
 │ Server hook wrapper         │─ spans ─┤       │  ├ SettingsStore  (per runtime)  │        │ warehouse         │
 │ (Actions, Lambda triggers…) │         │       │  └ Sinks          (1..n)         │        └───────────────────┘
 └─────────────────────────────┘         │       └──────────────────────────────────┘
 ┌─────────────────────────────┐         │          runs on: Cloudflare | Node/Docker (any cloud, K8s)
 │ Provider event feed         │─ events ┘                   | later: Lambda, Cloud Run, Azure…
 │ (Log Streams, webhooks…)    │
 └─────────────────────────────┘
```

### Correlation (provider-neutral)

1. The app SDK generates a W3C trace ID (32 hex) and asks the **provider adapter** how to carry it through the authorize request: `adapter.authorizeParams(traceId)`.
   - `auth0`: `{ "ext-trace_id": id }`, readable in page templates and post-login Actions.
   - `oidc`: none needed. The browser SDK keys the journey on its own `state` round-trip and emits browser spans only.
   - Other adapters declare their own mechanism, or `none`.
2. Hook wrappers and page plugins read the ID wherever their provider exposes it.
3. Event-feed items are normalised to `ProviderEvent` and joined via `adapter.correlate(event)`. That returns either an exact trace ID or **hints** (user hash, client, IP/UA, time window) the stitcher scores.
4. **Deterministic root span:** every emitter derives the root span ID as the first 16 hex of `sha256("root:" + traceId)`. The stitcher emits the root span with the outcome when the journey finalises.

## 6. Extension model

### 6.1 Capability levels

| Level | Capability | What you get | Needs from the provider |
| --- | --- | --- | --- |
| L1 | `browser` | Login start, redirect, callback outcome, token timing, abandonment | Standard OIDC/OAuth 2.0 (every provider) |
| L2 | `event-feed` | Provider's own success/failure events and error codes, joined to the trace | Webhooks, log streaming or an events API |
| L3 | `hooks` | Per-hook spans: duration, decision, claims set, errors | Server-side extensibility (Actions, Lambda triggers, blocking functions, inline hooks…) |
| L4 | `hosted-page` | Per-screen spans on the provider's hosted login UI | Ability to inject a script into the hosted page |
| L5 | `config` | Hook/config version history for change tracking | Management/admin API |

### 6.2 Provider adapter interface (`@auththread/adapter-kit`)

```ts
export type Capability = "browser" | "event-feed" | "hooks" | "hosted-page" | "config";

export interface ProviderAdapter<Settings = unknown> {
  id: string;                         // "auth0", "oidc", "cognito", "okta", …
  capabilities: Capability[];

  /** How to carry the trace ID through /authorize. Return {} if unsupported. */
  authorizeParams(traceId: string): Record<string, string>;

  /** L2: one or more ingest endpoints for the provider's event feed. */
  feeds?: Array<{
    path: string;                                        // mounted under /v1/providers/<id>/
    verify(req: Request, settings: Settings): Promise<boolean>;
    parse(body: unknown): ProviderEvent[];               // normalise to the neutral shape
  }>;

  /** Exact trace ID if present, otherwise scored hints. */
  correlate(event: ProviderEvent): Correlation;

  /** Map provider error codes to neutral outcomes. */
  classify(event: ProviderEvent): { outcome?: Outcome; errorCode?: string };

  /** L5: fetch config/hook versions for change tracking. */
  fetchConfig?(settings: Settings): Promise<ConfigSnapshot>;
}
```

Client-side pieces (browser helper, hosted-page plugin, hook wrapper) live in the same provider folder but run in the customer's stack. They only depend on `@auththread/schema` and `@auththread/otlp`.

### 6.3 Runtime interfaces

```ts
export interface JourneyBuffer {          // Durable Object, memory, Redis, DynamoDB…
  append(traceId: string, item: BufferedItem): Promise<void>;
  read(traceId: string): Promise<BufferedItem[]>;
  delete(traceId: string): Promise<void>;
  indexUnmatched(event: ProviderEvent, hints: Correlation): Promise<void>;
  findCandidates(hints: Correlation, windowMs: number): Promise<string[]>;
}
export interface Scheduler {             // DO alarms, Redis sorted set, setTimeout, cron…
  schedule(traceId: string, at: number): Promise<void>;
  onDue(handler: (traceId: string) => Promise<void>): void;
}
export interface SettingsStore {          // D1, Postgres, SQLite, env/JSON file
  getTenant(apiKeyHash: string): Promise<TenantSettings | null>;
}
export interface Secrets { get(name: string): Promise<string | undefined>; }
// Sinks: see §6.7. A stitcher has one or more, each with its own sampling policy.
```

- The HTTP layer is a **Hono** app built by `createStitcher({ providers, buffer, scheduler, settings, secrets, sinks })`, so the same code mounts on Workers, Node, Bun, Deno, Lambda or any Fetch-API host.
- The settings schema uses **Drizzle**, so D1, Postgres and SQLite share one definition.

### 6.4 Conformance kits

- `runProviderConformance(adapter, fixtures)` checks:
  - parsing of recorded feed payloads
  - verification rejects bad signatures
  - `correlate` returns an exact ID when present
  - redaction leaves no PII in normalised events
  - `classify` covers all fixture error codes
- `runRuntimeConformance({ buffer, scheduler, settings })` checks:
  - ordering tolerance
  - duplicate handling
  - timer firing under a fake clock
  - concurrent appends to one journey
  - TTL cleanup
- `runEndToEndConformance(stitcherFactory)` replays the shared journey corpus (shuffled, duplicated, delayed) and asserts identical exported traces across every runtime.

An adapter is **supported** when its conformance job is green in CI. Anything else is **experimental**.

### 6.5 Provider matrix (target)

| Provider | L1 browser | L2 event feed | L3 hooks | L4 hosted page | L5 config | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Generic OIDC (Keycloak, Authentik, Zitadel, Logto…) | ✅ | – | – | – | – | **v0.1** |
| Auth0 | ✅ | Log Streams | Actions | Page template / ACUL | Management API | **v0.1** |
| Amazon Cognito | ✅ | CloudTrail / CloudWatch | Lambda triggers | verify | Admin API | Phase 3 |
| Okta | ✅ | Event hooks / System Log | Inline hooks | verify | Admin API | Phase 3 |
| Supabase Auth | ✅ | Auth logs | Auth hooks (Postgres/HTTP) | n/a (own UI) | – | Phase 3 |
| Firebase / Identity Platform | ✅ | Cloud Logging | Blocking functions | n/a (own UI) | – | Community |
| Clerk | ✅ | Webhooks / Application Logs | – | verify | Backend API | Community |
| WorkOS | ✅ | Events API / webhooks | – | verify | API | Community |
| Descope | ✅ | Audit streaming | Flow connectors (verify) | verify | API | Community |
| Keycloak (deep) | ✅ | Event Listener SPI (Java) | – | Themes | Admin API | Community |
| Better Auth / Auth.js | ✅ | In-process plugin | Hooks/plugins | n/a (own UI) | – | Community |

"verify" means the capability hasn't been confirmed for that provider yet. "Community" means the adapter is welcome and the conformance kit defines done.

### 6.6 Runtime matrix (target)

| Runtime | Buffer | Scheduler | Settings | Status |
| --- | --- | --- | --- | --- |
| Cloudflare Workers | Durable Object per journey | DO alarms | D1 | **v0.1** |
| Node / Docker (any cloud: ECS, Cloud Run, Azure Container Apps, Fly, bare VM) | Memory (single node) or Redis | In-process timer or Redis sorted set | SQLite or Postgres | **v0.1** |
| Kubernetes | Redis | Redis | Postgres | Kubernetes example, deferred |
| AWS Lambda + API Gateway | DynamoDB (TTL) | EventBridge Scheduler or DynamoDB TTL stream | Postgres/DynamoDB | Community |
| Vercel / Netlify functions | Upstash Redis | Redis + cron | Postgres | Community |
| Deno Deploy / Bun | Redis or Deno KV | Redis / KV | Postgres | Community |

Deployment artifacts live in `templates/` and `examples/local-compose`. Terraform and Pulumi are deferred until a named user needs them.

### 6.7 Sinks (observability-agnostic output)

```ts
export interface Sink {
  id: string;                                   // "otlp", "wide-event-stdout", "webhook", "object-store", …
  accepts: Array<"spans" | "journey">;          // raw spans, the finished journey, or both
  sampling?: SamplingPolicy;                    // per sink
  write(batch: SinkBatch): Promise<void>;       // must be idempotent (journey ID + span ID)
}

export interface SamplingPolicy {
  keep: Array<"failed" | "denied" | "abandoned" | "slow" | "all">;  // default: failed, denied, abandoned, slow
  successRate: number;                                              // default 0.1 for successful journeys
  slowMs?: number;                                                  // default 5000
}
```

**Two output shapes from the same journey:**

1. **Spans:** OTel spans with `auth.*` attributes, for tracing backends.
2. **Wide event:** one flat JSON record per finished journey. It carries the root attributes plus a compact `steps[]` array: name, type, start offset, duration, decision, error code. The wide event suits:
   - logs-only stacks (Loki, CloudWatch Logs, Splunk, Elastic)
   - analytics/warehouse stacks (BigQuery, Snowflake, ClickHouse via object-store files)
   - "one event per unit of work" tools

   Its JSON Schema is published in `packages/schema` and versioned with the span schema.

**Sink matrix (target):**

| Sink | Output | Covers | Status |
| --- | --- | --- | --- |
| `otlp` (HTTP/protobuf + JSON) | Spans (+ optional OTLP logs) | Any OTLP backend or Collector: Grafana, Honeycomb, Jaeger, Elastic, New Relic, Splunk Observability, Datadog via Collector/Agent OTLP ingest | **v0.1** |
| `wide-event-stdout` | Journey JSON lines | Any log shipper already scraping containers (Vector, Fluent Bit, CloudWatch, Cloud Logging) | **v0.1** |
| `webhook` | Journey JSON, HMAC-signed | Anything with an HTTP endpoint: Zapier-style tools, custom pipelines, Slack via a relay | **v0.1** |
| `object-store` | NDJSON (Parquet later) per time window | S3 / GCS / Azure Blob / R2 → Athena, BigQuery, Snowflake, ClickHouse | Phase 2 |
| `datadog-native` | Datadog logs/spans API | Teams without a Collector or Agent | Community |
| `splunk-hec` | HEC events | Splunk Enterprise without OTel | Community |
| `kafka` | Journey JSON | Streaming platforms | Community |
| `ssf` | OpenID Shared Signals SETs | Security tooling (session-revoked, credential-change style events) | Later |

**Why sampling lives in sinks:** a team may send *every* journey as a cheap wide event to its warehouse, but only failed and slow journeys as spans to an expensive tracing backend. The stitcher always computes the full journey; each sink decides what it keeps.

**Conformance:** `runSinkConformance(sink)` checks that output for the shared corpus:
- is valid against the published schemas (OTLP proto or JSON Schema)
- is idempotent on retry
- respects the sampling policy
- contains no PII

### 6.8 Bring your own OpenTelemetry (and none at all)

- **App already instrumented with OTel:** `@auththread/browser` and server helpers accept an existing `TracerProvider`/`Tracer`. In that mode they create spans with the customer's SDK and exporter and add only `auth.*` attributes, so there's no second exporter and no duplicate config.
- **Linking to app traces:** after the callback, the app's next request carries a W3C `traceparent` (or an OTel span link) to the auth journey. "User logged in → first API call failed" becomes one connected view.
- **No OTel anywhere:** the browser and hook emitters post compact JSON to the stitcher. The team picks a `wide-event-*` or `webhook` sink and never touches OpenTelemetry.
- **Semantic conventions:** `auth.*` names are ours until accepted upstream. A versioned mapping file (`schema/mappings/`) lets sinks rename attributes for backends with their own conventions (e.g. Elastic ECS), so we're not locked to our own naming either.

## 7. Journey schema v0.1 (draft, provider-neutral)

Namespace `auth.*`, proposed as OpenTelemetry semantic conventions for authentication.

### Spans

| Span name | Emitted by | Notes |
| --- | --- | --- |
| `auth.journey` | stitcher | Root span, created at finalisation; carries outcome |
| `auth.app.login_start` | browser | Click → redirect to authorize |
| `auth.app.callback` | browser | Return to app; success or error |
| `auth.app.token_exchange` | browser / app server | Code → token timing |
| `auth.ui.screen` | hosted-page plugin | One per hosted login screen view |
| `auth.hook.execute` | hook wrapper | One per server-side hook run (Auth0 Action, Lambda trigger, blocking function, inline hook…) |
| `auth.provider.event` | stitcher | Span event for each joined event-feed item |

### Attributes

| Attribute | Example | Notes |
| --- | --- | --- |
| `auth.provider` | `auth0`, `oidc`, `cognito` | Adapter ID |
| `auth.tenant` | `acme-prod` | |
| `auth.client_id` | `abc123` | |
| `auth.user.hash` | `u_9f2c…` | Salted hash only |
| `auth.method` | `password`, `social`, `enterprise_sso`, `passwordless`, `passkey`, `mfa` | Neutral method |
| `auth.method.vendor_name` | `google-oauth2` | Provider's own name |
| `auth.ui.stage` | `identify`, `authenticate`, `verify`, `enroll`, `select`, `consent`, `recover`, `status`, `custom` | Neutral phase |
| `auth.ui.vendor_screen` | `login-password` | Provider's own screen name |
| `auth.hook.name` | `enrich-profile` | |
| `auth.hook.type` | `auth0.action`, `cognito.lambda_trigger`, `firebase.blocking_function`, `okta.inline_hook`, `supabase.hook` | |
| `auth.hook.stage` | `pre_signup`, `post_signup`, `pre_auth`, `post_auth`, `pre_token` | Neutral stage |
| `auth.hook.version` | `v14` | |
| `auth.hook.decision` | `continue`, `deny`, `redirect`, `challenge` | |
| `auth.hook.claims_set` | `["https://x/roles"]` | Names only |
| `auth.error.code` | `invalid_password` | Neutral where mapped, else vendor code |
| `auth.error.vendor_code` | `wp` | Provider's raw code |
| `auth.error.source` | `app`, `ui`, `hook`, `provider` | |
| `auth.outcome` | `success`, `failed`, `abandoned`, `denied` | On root span |
| `auth.abandoned_at` | `verify` | Neutral stage |
| `auth.correlation` | `exact`, `inferred` | How a span/event was joined |
| `auth.passkey.result` | `ok`, `NotAllowedError` | Error name only |

Dashboards and future paid features use **only neutral attributes**, so they work for every provider.

### Redaction rules (enforced in `@auththread/schema`)

- Drop keys matching `/pass|secret|token|otp|code|cookie|authorization/i` unless allow-listed.
- Hash `user_id`, `email` and `username` with a per-tenant salt.
- Truncate free text to 200 chars and strip email-like and token-like substrings.
- Never capture request bodies.

## 8. Repo layout

```
auththread/
├─ packages/
│  ├─ schema/            # neutral attributes, types, redaction, root-span derivation
│  ├─ otlp/              # tiny OTLP/HTTP JSON encoder + exporter
│  ├─ adapter-kit/       # ProviderAdapter + runtime interfaces + conformance kits
│  ├─ stitcher-core/     # createStitcher(): Hono app + join/finalise logic (no vendor deps)
│  └─ browser/           # app SDK (provider-neutral; takes an adapter's browser helper)
├─ providers/
│  ├─ oidc/              # generic OIDC: browser helper + adapter (L1)
│  └─ auth0/
│     ├─ adapter/        # Log Stream feed, correlate, classify, fetchConfig
│     ├─ browser/        # authorizeParams helpers for auth0-spa-js / react / nextjs
│     ├─ page/           # Universal Login snippet (SRI-pinned build)
│     └─ actions/        # withTrace() for Actions
├─ runtimes/
│  ├─ cloudflare/        # Worker + Durable Object buffer/scheduler + D1 settings
│  └─ node/              # Node server + memory/Redis buffer + SQLite/Postgres settings + Dockerfile
├─ sinks/
│  ├─ otlp/              # default; spans (+ optional OTLP logs)
│  ├─ wide-event/        # journey JSON to stdout
│  └─ webhook/           # journey JSON, HMAC-signed
├─ templates/            # Cloudflare Worker and future deployment kits
├─ integrations/         # dashboards + saved queries on neutral attributes
│  ├─ grafana/           # Tempo (spans) + Loki (wide events)
│  ├─ datadog/
│  └─ queries/           # SQL for wide events in BigQuery/ClickHouse/Athena (Phase 2)
├─ fixtures/             # shared journey corpus + recorded provider payloads (redacted)
├─ examples/
│  ├─ nextjs-auth0/  auth0-tenant/   # Terraform
│  └─ nextjs-keycloak/               # docker compose: Keycloak + stitcher-node + Collector + Grafana
├─ docs/
│  ├─ adding-a-provider.md
│  └─ adding-a-runtime.md
└─ PLAN.md  README.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  LICENSE  CODEOWNERS
```

**Tooling:** pnpm workspaces, Turborepo, TypeScript (strict), Vitest, Playwright, Changesets, Biome or ESLint + Prettier, dependency-cruiser (layering rules), GitHub Actions with a **matrix job per adapter and per runtime**.

## 9. Packages: spec and acceptance criteria

### 9.1 Core

- **`@auththread/schema`:** neutral constants and types, `redact()`, `hashUser()`, `rootSpanId()`, `newTraceId()`, and the neutral enums (`auth.method`, `auth.ui.stage`, `auth.hook.stage`, `auth.outcome`). **Done when:** 100% coverage on redaction plus property tests.
- **`@auththread/otlp`:** OTLP/HTTP JSON exporter with batching, timeout and retry-once; works in browsers, Workers, Node and serverless hooks. **Done when:** validated against a real OpenTelemetry Collector in CI, and under 5 KB gzipped.
- **`@auththread/adapter-kit`:** the interfaces in §6 plus the three conformance runners. **Done when:** both v0.1 providers and both v0.1 runtimes pass, and a deliberately broken fake adapter fails.
- **`@auththread/stitcher-core`:** `createStitcher(deps)`. Ingests OTLP spans and provider feeds, redacts again, buffers per trace ID and joins unmatched events by scored hints within ±2 min. It finalises on a terminal event or after a quiet period (default 10 min), then emits the root span and exports. It's idempotent and order-tolerant. **Done when:** the end-to-end conformance corpus produces byte-identical traces on every runtime.
- **`@auththread/browser`:**

```ts
import { auththread } from "@auththread/browser";
import { auth0 } from "@auththread/auth0/browser"; // or: import { oidc } from "@auththread/oidc"

const thread = auththread.init({ endpoint: "https://auth-telemetry.example.com", tenant: "acme", provider: auth0() });

await client.loginWithRedirect({ authorizationParams: { ...thread.authorizeParams() } });
thread.callback(window.location); // on the callback route
```

  - It persists the trace ID across the redirect in `sessionStorage` and transmits with `sendBeacon` or `fetch` keepalive.
  - **Done when:** the same app code works with the `auth0` and `oidc` helpers, verified by Playwright in both examples.

### 9.2 Provider: `oidc` (generic, L1)

- A browser helper that works with any OIDC client library (wraps `oidc-client-ts` and generic redirect flows). It captures authorize → callback (`code`/`error`) → token timing.
- The adapter has no feeds; `correlate` is trace-ID only.
- **Done when:** the Keycloak example shows a full L1 journey (success, wrong password, abandoned) in local Grafana, with no cloud account needed.

### 9.3 Provider: `auth0` (deep, L1-L5)

- **`browser`:** `authorizeParams` → `{ "ext-trace_id": id }`, with helpers for `auth0-spa-js`, `auth0-react` and `nextjs-auth0`.
- **`page`:** a Universal Login page-template snippet (requires a custom domain). Values come in via a `<meta>` tag with `| escape`. It captures:
  - screen view, load/TTFB and time on screen
  - submit attempts, retries and submit-to-next-screen transition
  - screen abandonment, tab-hidden time and visibility changes
  - a coarse first-input and autofill hint, never values or keystrokes
  - passkey `DOMException.name` and duration
  - UI exception class names, never messages
  - social/enterprise delegation
  - The snippet sends `prompt.screen.name` and `location.pathname`; the adapter maps them to `auth.ui.stage` and `auth.method`. ACUL needs `use_page_template: true` until the explicit `window.auththread` handoff lands.
- **`actions`:** `withTrace({ name, version }, handler)` with a recording proxy around `api`, which re-throws errors so behaviour is unchanged. Transports:
  - `http`: awaited, with a 250 ms hard timeout
  - `console`: a structured log line, zero added latency
- **`adapter`:**
  - Log Stream webhook feed (verify an auth header, parse batches)
  - `correlate` (exact trace ID if found in Action execution details, else hints)
  - `classify` (Auth0 log type codes → neutral outcomes)
  - `fetchConfig` (Actions + versions via the Management API)
- **Known gaps** (document in the adapter README):
  - page templates need a custom domain
  - registration Actions don't receive `event.request.query` (use a hidden `ulp-` field)
  - reset-password pages don't accept `ext-` params
  - ACUL without `use_page_template: true` has no Liquid context for the trace ID and screen name
  - Log Stream ordering isn't guaranteed
- **Done when:** a three-screen Auth0 flow (identifier → password → MFA) plus a deny Action yields one trace with UI, hook and provider-event spans in the right order, and the provider conformance kit passes on recorded Log Stream fixtures.

### 9.4 Runtime: `cloudflare`

- `createStitcher` mounted in a Worker, with one Durable Object per trace ID (no Queue). DO alarms act as the Scheduler, and D1 holds settings (never traces).
- Deploy-to-Cloudflare button.
- **Done when:** runtime and end-to-end conformance pass (using Miniflare or workerd in CI), and the example journey lands in Grafana Cloud and Datadog.

### 9.5 Runtime: `node`

- `createStitcher` on `@hono/node-server`.
- Buffer: memory (single instance) or Redis (HA). Scheduler: in-process or Redis sorted set. Settings: SQLite or Postgres.
- Multi-arch Docker image (amd64/arm64), and a `docker-compose.yml` with Redis, an OpenTelemetry Collector and Grafana (Tempo).
- **Done when:** conformance passes for both buffer modes, and the image runs unchanged on at least two clouds in a smoke test (e.g. Cloud Run + ECS Fargate, or Fly + Azure Container Apps).

### 9.6 Sinks

- **`otlp`:** wraps `@auththread/otlp`; HTTP/protobuf and HTTP/JSON; optional OTLP logs output for the wide event.
- **`wide-event`:** JSON lines to stdout, one per journey.
- **`webhook`:** journey JSON, HMAC-SHA256 signed, retry with backoff, idempotency key = journey ID.
- **Done when:** `runSinkConformance` passes for all three, and the Keycloak example shows the same journey as a trace in Tempo and as a wide event in Loki.

### 9.7 Dashboards

- Grafana (Tempo + Loki) and Datadog, built only on neutral attributes, with each panel available for both spans and wide events:
  - success rate by method
  - outcomes
  - abandonment by `auth.ui.stage`
  - journey duration
  - hook duration and errors by name, version and type
  - passkey errors
- **Done when:** the same dashboard renders both example providers.

## 10. Adding a provider or runtime (contributor path)

**New provider:**
1. Copy `providers/_template`.
2. Fill in `capabilities` and implement only what the provider supports.
3. Add redacted recorded payloads to `fixtures/<provider>/`.
4. Map vendor codes to the neutral enums in `classify`, and vendor screens and hooks to `auth.ui.stage` and `auth.hook.stage`.
5. Make `runProviderConformance` pass and add the matrix job.
6. Add an example (docker compose preferred).
7. Add a row to the provider matrix in the README.

**New runtime:**
1. Copy `runtimes/_template`.
2. Implement `JourneyBuffer`, `Scheduler`, `SettingsStore` and `Secrets`.
3. Make `runRuntimeConformance` and `runEndToEndConformance` pass.
4. Add a deploy guide and make the install contract explicit.

**Maintenance:** `CODEOWNERS` assigns each adapter a maintainer. Adapters without one for 90 days drop to "experimental".

## 11. Milestones

### Phase 0: Validate (weeks 1-2)

- [ ] 15 interviews across **at least 3 providers** (mostly Auth0, plus Cognito, Okta, Clerk or Supabase teams). Ask: "You've piped your auth provider into your observability tool. What's still missing?" and "How do you test auth hook changes today?"
- [ ] Auth0 spikes:
  - `ext-trace_id` end to end
  - whether a console-logged ID appears in Log Stream / Action execution details
  - Action `fetch` latency with a 250 ms timeout
  - Log Stream join keys
  - ACUL `ext-*`
- [ ] Framework spike: implement `oidc` against Keycloak in docker compose to validate the adapter interfaces before Auth0 work hardens them
- [ ] Capability check: confirm the "verify" cells in §6.5 for Cognito, Okta and Clerk (docs only)
- **Gate:** at least 5 teams describe the gap (ideally on more than one provider), and the trace ID survives end to end on Auth0. **Kill signal:** teams say their observability tool plus provider logs is enough.

### Phase 1: v0.1 open-source release (weeks 3-8)

- [ ] Week 3: repo scaffold, CI matrix, dependency-cruiser rules, `schema`, `otlp`, `adapter-kit` interfaces
- [ ] Week 4: `stitcher-core` + conformance kits + shared journey corpus; `oidc` provider + Keycloak example on `node` runtime
- [ ] Week 5: `auth0/browser` + `auth0/actions` + `auth0/adapter` (Log Streams)
- [ ] Week 6: `auth0/page` + Terraform example; `cloudflare` runtime
- [ ] Week 7: Redis buffer, multi-cloud smoke test of the Docker image, `wide-event` + `webhook` sinks + sink conformance, bring-your-own-`TracerProvider` mode, dashboards
- [ ] Week 8: docs (including the two "adding a…" guides and the provider/runtime matrices), launch
- **Gate:** about 10 production installs, at least one community adapter PR opened, and inbound requests for coverage or testing.

### Phase 2: Paid wedge (weeks 9-16, separate repo)

Coverage map (open source, here), replay tests and PR checks (paid), built on neutral `auth.hook.*` spans so they extend to every provider with L3 hooks. Deployment artifacts are deferred until a named user needs them.

### Phase 3: Expand (months 5-9)

Official deep adapters: Cognito, then Okta or Supabase. Terraform modules for AWS, GCP and Azure. AI root cause, support lookup, MCP server and CLI (paid). Start SOC 2.

## 12. Testing the project itself

- **Unit:** Vitest everywhere; redaction property tests.
- **Conformance:** a matrix job per provider, per runtime and per sink, on every PR.
- **Simulation:** shuffled, duplicated and delayed corpus with a fake clock; identical output across runtimes.
- **Contract:** OTLP validated by a real OpenTelemetry Collector (Docker service in CI).
- **E2E:**
  - Keycloak example on every PR (no external accounts)
  - Auth0 example nightly against a dedicated test tenant
- **Performance budgets:**
  - browser bundle under 5 KB gzipped
  - page snippet under 8 KB gzipped
  - hook wrapper p95 added latency under 50 ms

## 13. Security, privacy, licensing

- `SECURITY.md` (disclosure address, 90-day policy), and a threat model covering:
  - span injection (per-tenant keys + rate limits)
  - PII leakage (double redaction)
  - page-snippet supply chain (SRI, versioned, signed releases, npm provenance)
  - stitcher downtime (fire-and-forget)
- No third-party runtime deps in browser-side packages.
- **Licence:** MIT for this whole repo. DCO sign-off on every commit. The paid service lives in a separate repo (FSL or proprietary). Never relicense anything already released.

## 14. Paid service boundary (not in this repo)

- **Open (here):** everything above, plus the coverage map later.
- **Paid:** replay tests on PRs, change impact, AI root cause, support lookup, MCP server, hosted multi-tenant stitcher, SSO/RBAC, SOC 2.
- **Design rule:** paid features consume only neutral attributes and adapter interfaces, so every new open-source adapter makes the paid product work on another provider for free.

## 15. Launch checklist

- [ ] README: 60-second GIF (failed login → full trace in Grafana), provider matrix, runtime matrix
- [ ] Quick starts:
  - Keycloak + Docker (2 minutes, no accounts)
  - Auth0 + Cloudflare (deploy button)
  - Auth0 + Docker on your cloud
- [ ] Docs: schema reference, privacy model, "adding a provider", "adding a runtime"
- [ ] `good first issue`s: one per "Community" provider row
- [ ] Posts: Show HN, r/auth0, r/devops, OpenTelemetry Slack, Keycloak and Auth0 communities

## 16. Success metrics

- **Phase 1:**
  - 10 production installs
  - 300+ GitHub stars
  - at least 1 community provider adapter merged
  - 3 external contributors
  - at least 5 requests for testing or coverage
- **Leading signal:** median time from install to first full journey trace under 30 minutes.

## 17. Open questions

1. Name, plus npm scope and domain.
2. Answered 2026-11-26: yes. On a test tenant, `details.transaction_id` matched
   `event.transaction.id`, and `details.session_id` matched `event.session.id`. The
   transaction is the primary join; a session spans logins.
3. Does an un-awaited `fetch` complete after an Auth0 Action returns? (Design assumes no.)
4. Limits on the number and length of Auth0 `ext-*` params.
5. Can each provider's hook runtime `require` our wrapper package? (Auth0 Actions npm deps, Lambda layers, Firebase functions: verify per provider.)
6. Propagate a full `traceparent` instead of only the trace ID?
7. Which hosted login pages allow custom JS (Cognito managed login, Okta, Clerk, WorkOS)? This decides L4 coverage.
8. Should the OpenTelemetry Collector processor (Go) be a Phase 2 runtime for teams standardised on the Collector?
9. Wide-event schema: how much step detail before records get too large for log pipelines (target under 8 KB per journey)?
10. Propose `auth.*` to the OpenTelemetry semantic-conventions SIG after v0.1, or wait for adoption first?

## 18. References

- Auth0 Actions Real-time Logs: https://auth0.com/docs/customize/actions/actions-real-time-logs
- Auth0 log retention: https://auth0.com/docs/deploy-monitor/logs/log-data-retention
- Auth0 Log Streams: https://auth0.com/docs/customize/log-streams
- Universal Login page templates: https://auth0.com/docs/customize/login-pages/universal-login/customize-templates
- ACUL reference (`head_tags`): https://auth0.com/docs/customize/login-pages/advanced-customizations/configure/reference
- Auth0 `ext-` params in templates: https://community.auth0.com/t/pass-additional-parameter-to-the-universal-login-url/140112
- `event.request.query` in post-login Actions: https://community.auth0.com/t/send-custom-parameters-using-loginwithredirect-to-onexecutepostlogin-action/110094
- Action details missing from Log Streams: https://community.auth0.com/t/include-the-details-of-executed-actions-in-log-streams/82608
- Cognito Lambda triggers: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html
- Okta event hooks: https://developer.okta.com/docs/concepts/event-hooks/ · inline hooks: https://developer.okta.com/docs/concepts/inline-hooks/
- Firebase blocking functions: https://firebase.google.com/docs/auth/extend-with-blocking-functions
- Supabase Auth Hooks: https://supabase.com/docs/guides/auth/auth-hooks
- Clerk Application Logs: https://clerk.com/docs/guides/dashboard/logs/application-logs
- WorkOS Events: https://workos.com/docs/events
- Descope audit streaming: https://docs.descope.com/audit-trails-and-integrations/audit-trail-streaming
- OpenID Shared Signals final specs: https://openid.net/press-release-openid-foundation-finalizes-global-standards-for-real-time-identity-security/
- Cloudflare Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Closest commercial comparable, Corbado Observe: https://www.corbado.com/observe
