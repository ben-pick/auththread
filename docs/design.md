# auththread design

This document explains every design decision in the current implementation, the alternative
that was rejected, and what evidence exists for each claim. It is written so you can disagree
with a decision and know exactly what to change.

The source of truth for scope remains `PLAN.md`. This document describes what was actually
built, which is a slice of that plan.

Evidence labels used below: **measured** means a command in this repo produced the number,
**inferred** means it follows from code or tests without a direct measurement, **unverified**
means it has not been run.

---

## 1. The goal

A developer should see one complete login journey in the observability tool they already
use: app, hosted login page, server hooks and provider logs as one ordered story.

The unit is a journey, not a request. A journey starts when the user clicks sign in and ends
when the outcome is known or the journey goes quiet.

auththread ships the instrumentation, the stitching and the adapter framework. It does not ship a
UI or a trace store. It does not ship the paid reliability service.

---

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| Journey | One login attempt, from start to outcome |
| Span | One timed unit inside a journey, in the OpenTelemetry shape |
| Trace ID | 32 hex characters, created once in the browser, carried through the login |
| Root span | `auth.journey`, derived at finalisation, carries the outcome |
| Provider event | A normalised item from a provider feed such as an Auth0 Log Stream |
| Stitcher | The process that joins spans and events into a journey |
| Adapter | A provider, a runtime or a sink. Core never imports one |
| Sink | An output such as OTLP, stdout JSON, a webhook or object storage |
| Wide event | One flat JSON record per journey, for logs and warehouses |

---

## 3. Architecture

```
 Browser SDK ─┐
 Login page  ─┼─ spans ──▶ stitcher ──┬─▶ OTLP sink ──▶ any tracing backend
 Hook wrapper ─┘     (buffer, join,    ├─▶ wide event ──▶ logs or warehouse
 Provider feed ─ events ─┘  finalise)  ├─▶ webhook ─────▶ anything with HTTP
                                       └─▶ object store ─▶ S3/R2 → ClickHouse
```

The stitcher is an Effect service with `handle(request): Effect<Response>`, exposed through
Effect `HttpRouter` routes. The web port remains the platform edge: Cloudflare and Node both
hand it a `Request`. That keeps four hosts (Workers, Node, Bun, Deno) on one code path
without a framework.

Data enters three ways:

| Route | Body | Used by |
| --- | --- | --- |
| `POST /v1/spans` | OTLP/JSON | Any OpenTelemetry SDK, our OTLP exporter |
| `POST /v1/compact-spans` | `{ spans: CompactSpan[] }` | Browser SDK, Action wrapper, page snippet |
| `POST /v1/events` | One event or `{ events: [] }` | Custom integrations |
| `POST /v1/providers/<id><feed.path>` | Provider payload | Auth0 Log Streams |

Every route except `/healthz` needs a tenant key in `Authorization: Bearer <key>`. The
stitcher hashes the key, looks up tenant settings, and rejects unknown keys.

---

## 4. Correlation

The hard problem is that a login crosses four systems that share nothing.

1. The browser SDK creates a W3C trace ID and stores it in `sessionStorage`.
2. The provider adapter decides how the ID travels through `/authorize`.
   - Auth0: `ext-trace_id`, readable by a page template and a post-login Action.
   - Generic OIDC: nothing. The SDK keys the journey on its own state round trip and only
     browser spans exist until a hook or feed joins.
3. Hooks and page plugins read the ID and emit spans.
4. Feed events either carry the ID in their details, a transaction ID, or hints.
5. The stitcher joins an event by exact trace ID or exact transaction ID when present,
   otherwise by user hash inside the same tenant and a two minute window. A client ID alone
   never joins, because a client is shared by every user of an app.
6. Finalisation derives a deterministic root span.

A transaction ID is an exact key, checked before hints. Auth0 supplies one on both the
post-login Action and the log event. Hints are scoped by tenant and matched on the user hash.
A client ID is carried but never enough to join, because a client is shared by every user of
an app. The buffer indexes hint values and transaction IDs when a span arrives, so a later
event can still find the journey.

An event that arrives before any span goes into an in-process pending list. The next span
whose transaction or hints match adopts it. Pending entries expire after the TTL and are
capped at 1000.

**Known limit.** The pending list is per stitcher instance and not persisted. In a
multi-instance deployment an event that arrives before its span, and lands on a different
instance, is lost. The Node runtime is one process, and the Cloudflare runtime is one object
per tenant, so both hide this today. A shared pending store is the fix.

---

## 5. Identifiers and determinism

| Rule | Why |
| --- | --- |
| Trace ID is 32 lower-case hex, never all zero | W3C compatible |
| Span ID is 16 lower-case hex, never all zero | W3C compatible |
| Root span ID is `sha256("root:" + traceId)` truncated to 16 hex | Every emitter agrees without a round trip |
| Provider event span ID is `sha256("event:" + eventId)` truncated to 16 | Replays produce the same ID |
| Spans sort by start time, then name, then span ID | Order-independent input gives identical output |
| Sampling is a hash of the trace ID, not `Math.random` | A sampled journey is stable and testable |

The encoder sorts attribute keys. Times are integer milliseconds internally and nanosecond
strings on the wire.

**Rebuttal point.** Truncating SHA-256 to 64 bits gives a birthday collision around four
billion spans. Fine for design-partner volume, weak for a large deployment. Full 128-bit
span IDs or a random ID with a stored root would trade determinism for collision safety.

---

## 6. Data model

Span:

```ts
interface Span {
  traceId: TraceId;
  spanId: SpanId;
  parentSpanId: SpanId | null;
  name: string;
  kind: "internal" | "server" | "client";
  startMs: number;
  durationMs: number;
  attributes: Attributes;
  status: { code: "unset" | "ok" | "error"; message?: string };
  events: SpanEvent[];
}
```

Journey:

```ts
interface Journey {
  traceId: TraceId;
  root: Span;
  provider: string;
  tenant: string;
  kind: "login" | "signup" | "reset" | "step_up";
  outcome: "success" | "failed" | "abandoned" | "denied";
  startedAt: number;
  endedAt: number;
  spans: Span[];
  events: JoinedEvent[];
}
```

Wide event: one flat record with `schemaVersion: "2"`, `event: "auth.journey"`, root
attributes, `steps[]`, `correlationCounts` and `durationMs`. UI steps carry `stage`, `method`
and `vendorScreen`. The JSON Schema is published at
`packages/core/schema/schema/wide-event-2.json`.

### Outcome derivation

The latest terminal signal wins:

1. A denial is terminal. `denied` regardless of what follows.
2. Otherwise collect success signals (a success event, an ok callback), failure signals (an
   error span, a failure event) and abandonment markers.
3. Sort by time. A later success overrides an earlier failure, and a later failure overrides
   an earlier success.
4. With no signal at all, the journey is `abandoned`.

This matters because a transaction can contain a failed attempt and a successful retry. The
journey outcome is `success`, and both attempts remain as steps.

Outcome is a domain rule expressed once, in `deriveOutcome`. It is not scattered through the
emitters.

### Root attributes

The root aggregates `auth.provider`, `auth.tenant`, `auth.client_id`, `auth.method` and
`auth.user.hash` only when every span that carries the key agrees. A journey that mixes
password and MFA does not claim one method. This keeps dashboards from lying.

---

## 7. Redaction and privacy

Four rules, applied twice, in the emitter and again in the stitcher:

1. Drop keys that look like credentials, unless the key is an allow-listed neutral attribute.
   This is why `auth.error.code` survives while `oauth.code` does not.
2. Replace user identifiers with `auth.user.hash`, a salted SHA-256 truncated to 16 hex.
3. Without a tenant salt, drop identifiers instead of storing them. Fail closed.
4. Strip email addresses and JWT-shaped strings from free text, then cut to 200 characters.

Raw request bodies are never read. The provider feed parser receives a `hashUser` function
bound to the tenant salt, so a raw provider user ID never exists in a normalised event.
Span attributes, span events and status messages all pass through redaction. An
`auth.user.hash` that is not a real hash is rehashed or dropped.

A stitcher stamps `auth.tenant` and `auth.provider` from the authenticated tenant, so a page
or hook span cannot label a journey as someone else's or as `unknown`.

**Rebuttal point.** A salted hash is pseudonymous, not anonymous. Correlating it with a
provider's logs can re-identify a person. The claim is "no PII by default", not "anonymity".

---

## 8. The stitcher

Ingest a span:

1. Redact with the tenant salt and stamp the authenticated tenant.
2. Append to the buffer, keyed by trace ID and item ID. Duplicate IDs collapse.
3. Index hint values and the transaction ID against the trace.
4. Adopt any pending event whose transaction or hints match.
5. Move the finalise deadline forward.

Ingest an event:

1. Ask the adapter to classify it into an outcome and neutral error code.
2. Fill the tenant, hash raw identifiers, redact.
3. If it carries a trace ID, append to that trace as exact.
4. Otherwise, if it carries a transaction ID, look the transaction up exactly and append as
   exact.
5. Otherwise ask the buffer for candidates by tenant and user hash, and append as inferred.
6. If nothing matches, park it as pending.

Finalise:

1. Read all items for the trace.
2. If there are no spans, drop the trace.
3. Derive the outcome, sort, and build the root.
4. Turn each joined event into an `auth.provider.event` span.
5. Ask every sink to render. Write what it returns.
6. Delete the trace.

Deadlines only move forward. A late span with an earlier start time must not pull the quiet
period back before spans already buffered. This is the one bug the first implementation had,
and there is a regression test for it.

Sink writes are isolated. A sink that throws increments a counter and never breaks the
journey or the login. This follows from "never in the login path".

**Rebuttal point.** One quiet period for all traces is blunt. A slow enterprise SSO flow can
take longer than ten minutes, and finalising early splits the journey. A per-journey deadline
driven by the provider's own timeout would be sharper.

---

## 9. Contracts

### Provider

```ts
interface ProviderAdapter<Settings> {
  id: string;
  capabilities: readonly Capability[];
  authorizeParams(traceId: TraceId): Record<string, string>;
  feeds?: readonly Feed<Settings>[];
  correlate(event: ProviderEvent, settings: Settings): Correlation;
  classify(event: ProviderEvent): { outcome?: Outcome; errorCode?: string };
  fetchConfig?(settings: Settings): Effect.Effect<ConfigSnapshot, ProviderError>;
}
```

`Feed.verify` returns `Effect<boolean, FeedError>` and fails closed. `Feed.parse(body,
context)` receives untrusted input, decodes it with Effect `Schema`, and returns
`Effect<ProviderEvent[], FeedError>`.

### Runtime

`JourneyBuffer`, `Scheduler`, `SettingsStore` and `Secrets` are Effect `Context.Service`
classes provided by a runtime `Layer`. The buffer indexes hints and prunes by age. The
scheduler exposes `runDue(now)` so a test can drive time without waiting.

### Sink

```ts
interface Sink {
  id: string;
  accepts: readonly ("spans" | "journey")[];
  sampling?: SamplingPolicy;
  render(journey: Journey): SinkBatch | null;   // pure
  write(batch: SinkBatch): Effect<void, SinkError>; // idempotent
}
```

The split between `render` and `write` is deliberate. Sampling and formatting are testable
without a network, and a conformance suite can check the payload without owning the
transport.

Default sampling keeps failed, denied, abandoned and slow journeys, and keeps 10% of
successful ones. Slow means five seconds. The decision is deterministic from the trace ID,
so a replay keeps the same journeys.

**Rebuttal point.** Sampling inside sinks means the stitcher always computes the full
journey. That is the right trade for quality, but it makes the stitcher's CPU the cost centre
rather than the exporter's. At high volume, sampling earlier is the escape hatch.

---

## 10. Runtimes

### Node

- Memory buffer by default, or SQLite in WAL mode when `AUTHTHREAD_DB` is set.
- A `setTimeout` scheduler with unref'd timers. The SQLite store uses the same scheduler
  contract and polls due deadlines, which also restores them at startup.
- Items, hints, transactions, deadlines and trace owners are written in one
  `BEGIN IMMEDIATE` transaction per append. A crash cannot leave an item without its index.
- `close()` stops accepting, drains in-flight journeys, flushes sinks and closes the store.
- Settings loaded once from a JSON file. Keys are hashed at startup; an empty key is rejected.
- `node:http` adapted to `Request` and `Response`.
- Docker image builds from the repo root.

Missing from the plan's Node row: Redis buffer, SQLite or Postgres settings, multi-arch
build proof, and schema migrations. SQLite removes the restart loss, but it is one writer:
run one replica per database. The pending list is still per stitcher instance.

### Cloudflare

- The whole stitcher lives in a Durable Object. Storage backs the buffer, the hint index and
  the alarm list.
- One object per tenant, not one per journey (ADR-0005). Alarms drive finalisation.
- The Worker resolves the API key with an in-process key directory, then forwards the request
  to the object named after that tenant. The object authenticates the key again before ingest.

**Rebuttal point.** The plan says one Durable Object per login. That needs a directory that
maps hints to trace IDs before a trace ID exists, and provider feeds arrive without one. One
object per tenant is correct but serialises writes for a tenant. Per-journey sharding is the
right later change once a hint directory exists.

---

## 11. Providers

### Generic OIDC

Capability `browser` only. No authorize params, no feed. Correct for any OIDC provider and
the cheapest adapter to pass conformance.

### Auth0

Capabilities `browser`, `event-feed`, `hooks`, `hosted-page`, `config`.

- `authorizeParams` returns `{ "ext-trace_id": traceId }`.
- Log Stream feed: a custom header secret, batched or single payloads, vendor type codes
  mapped to neutral types, errors mapped to neutral codes, identifiers hashed at parse.
- `withTrace` wraps an Action. It proxies `api` to record calls, detects deny, redirect and
  challenge, rethrows the handler's error unchanged, and never throws from the transport.
  HTTP transport has a 250 ms abort. Console transport adds no latency. `stage` and `kind` are
  options, so a pre-registration Action is not labelled `post_auth`.
- Log Stream events for signup carry `auth.journey.kind: "signup"`.
- Page snippet captures screen timing, submit/retry counts, abandonment, visibility, passkey
  results and UI errors from a template-rendered meta tag. It sends the raw Auth0 screen name;
  the adapter maps it to a neutral stage and method in the stitcher.
- `fetchConfig` reads Actions from the Management API.

Known gaps, documented in the page README and the adapter: page templates need a custom
domain, ACUL without `use_page_template` has no Liquid context, reset pages reject `ext-`
params, a failed-only login still relies on the Log Stream for the vendor error code, and the
Action package is not yet published in a
form Auth0 Actions can `require`.

**Rebuttal point.** The Action wrapper imports the schema package for hashing and IDs. If
Auth0 Actions cannot load our package, the wrapper must be inlined or prebuilt. That is open
question 5 in `PLAN.md` and it blocks a real install.

---

## 12. Conformance

Four suites. Each returns a report with every failure instead of throwing on the first.

| Suite | What it proves |
| --- | --- |
| `runProviderConformance` | Feed parsing, verification fails closed, exact and hint correlation, PII absent, classification |
| `runRuntimeConformance` | Append and read, duplicate collapse, concurrent appends, hint windows, timer ordering, cancel, prune, delete |
| `runSinkConformance` | Deterministic render, schema shape, sampling, no PII, stable idempotency key, write twice |
| `runEndToEndConformance` | Ordered versus reversed, duplicated and delayed delivery gives identical batches |

There is a deliberately broken adapter and a broken buffer in the tests, so a suite cannot
pass by doing nothing. A cross-runtime test delivers the corpus to the memory and Durable
Object runtimes and requires identical JSON.

**Rebuttal point.** The end-to-end suite compares a runtime against itself, and the
cross-runtime test covers two buffers. "Identical on every runtime" is true for the two that
ship, not for the whole matrix.

---

## 13. Repository and module boundaries

```
packages/core/{schema,otlp,adapter-kit,browser,stitcher}
packages/providers/{oidc,auth0}
packages/runtimes/{node,cloudflare}
packages/sinks/{otlp,wide-event,webhook,object-store}
packages/tooling/{agents,conformance}
examples/{keycloak-compose,node-docker,cloudflare-worker}
```

Enforced by dependency-cruiser:

- Core never imports an adapter.
- Providers cannot import runtimes or sinks.
- Runtimes cannot import providers or sinks. Composition lives in examples.
- Only the Node runtime, tooling and examples may import `node:*`.
- Only the Cloudflare runtime may import `@cloudflare/*`.
- `schema`, `otlp` and `browser` have no runtime dependency.
- `adapter-kit`, `stitcher`, provider server exports, runtimes and sinks use Effect v4.

### Two-zone module boundary

The edge zone ships to browsers and login pages and is plain, dependency-free TypeScript.
The server zone is Effect v4: `Schema` at every boundary, `Context.Service` and `Layer` for
dependencies, and `Schema.TaggedError` for expected failures. Provider packages expose the
browser helper at `/browser` and the Effect adapter at the package root.

### Why Effect v4 on the server

ADR-0003. The stitcher grew a second store, typed failures, retries and multi-tenant routing.
Effect gives one model for validation, dependency injection, failure and concurrency across
Node and Workers. The cost is a larger server dependency; the browser edge stays plain so
the SDK budget is unaffected.

**Rebuttal point.** Effect is a large dependency for one JSON handler. If the server surface
shrinks back to one route with one store, the layers and schemas become overhead.

---

## 14. Decisions, alternatives and what would change them

| Decision | Alternative rejected | What would flip it |
| --- | --- | --- |
| New MIT repo | Build inside nooks | If the project stays private and commercial |
| Paid service in its own repo | One repo with an open core | If licence friction hurts adoption |
| Plan's folder tiers, not nooks tiers | `products/platform/domain` | If deployables multiply |
| Two-zone boundary: Effect server, plain edge | Effect everywhere | If the browser budget is dropped |
| Effect server plus Fetch port | Hono, Drizzle, plain TS | If the browser budget must cover the server |
| One DO per tenant | One DO per journey | A persistent hint directory |
| In-process pending events | Persistent pending store | Multi-instance Node deployments |
| Deterministic sampling | Random sampling | If statistical fidelity beats replayability |
| Hint join requires a user hash and the same tenant | Join on client ID too | If providers expose a per-session client |
| Exact transaction join when a provider exposes one | Hash hints only | If a provider gives no transaction ID |
| Object store sink for analytics | A vendor-specific warehouse sink | If a warehouse needs a direct connector |
| Latest terminal signal decides the outcome | Any failure wins | Never, once retries share a transaction |
| Deadlines never sit in the past | Trust client timestamps | Never for a quiet period |
| New login attempt rotates the trace | Keep one trace per tab | If an app performs several logins in one redirect |
| Batch browser spans | One request per span | If an edge runtime rejects batched beacons |
| Worker key directory, one object per tenant | Tenant in the URL | If tenant config becomes dynamic without redeploys |
| Fail-closed redaction | Keep raw identifiers when no salt | Never for a default |
| Hash to 64 bits | Full 128-bit IDs | High volume or collision evidence |
| 250 ms Action timeout | No timeout | Never in the login path |
| Wide event from the root plus steps | Full span dump | If warehouses want every attribute |

---

## 15. What this release does not do

- No trace store, UI, alerts, replay tests or AI.
- No Redis, Postgres, D1, Lambda or Kubernetes runtime.
- No deep adapters for Cognito, Okta, Supabase, Clerk, WorkOS or Keycloak.
- No Datadog native, Splunk HEC or Kafka sink.
- No OTLP protobuf.
- No signed page-snippet release or SRI build pipeline.
- No rate limiting on the stitcher.
- No Terraform or Pulumi modules.
- No Playwright end-to-end test against Keycloak.
- No published `auth.*` semantic convention proposal.

---

## 16. Verification

| Claim | Evidence |
| --- | --- |
| Suite green | `pnpm check` exits 0 (**measured**) |
| One ordered journey | `pnpm demo` prints five steps, outcome `denied` (**measured**) |
| Order tolerance | End-to-end conformance with reversed, duplicated, delayed input (**measured**) |
| Cross-runtime equality | Memory versus Durable Object JSON equality for three fixtures (**measured**) |
| Browser budget | SDK 2,482 bytes gzipped against 5 KB; page snippet 3,055 against 8 KB (**measured**) |
| Hook latency under 50 ms p95 | Needs a real tenant (**unverified**) |
| Keycloak compose runs | Docker unavailable during the build (**unverified**) |
| Management API config fetch | No real tenant call (**unverified**) |
| Production installs | Business validation, not code (**unverified**) |

Full detail is in `docs/verification.md`.

---

## 17. Open questions worth arguing about

1. Does one Durable Object per tenant hold at design-partner volume, or does the first
   enterprise tenant serialise too much?
2. Is a 10 minute quiet period right, or should the deadline come from the provider's own
   session timeout?
3. Should the Action wrapper be inlined into the release so Auth0 Actions can load it
   without npm ESM support?
4. Is 64-bit hashing enough for user identifiers and span IDs?
5. Should sampling move before the join once volume is the binding constraint?
6. Does the wide event need the full step array, or is a count plus the root enough for
   logs?
7. Does Effect's runtime cost on Workers stay acceptable as the adapter matrix grows?
