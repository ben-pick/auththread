# auththread

**See one login journey end to end, in the observability tool you already use.**

[![status](https://img.shields.io/badge/status-v0.1-1f6feb)](#roadmap)
[![license](https://img.shields.io/badge/license-MIT-2ea44f)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D24-339933)](#compatibility)
[![otel](https://img.shields.io/badge/OpenTelemetry-optional-425CC7)](https://opentelemetry.io)

Auththread stitches the app, the hosted login page, server-side hooks and provider logs into
one journey. It emits OTel spans, one wide event, or both. It is the instrumentation and the
adapter framework, not a trace store.

> **Status: v0.1, early.** The packages are not published to npm yet. Use the workspace or
> the examples. Deep integration is available for Auth0. Generic OIDC gets browser-level
> tracing everywhere.

## Contents

- [Why](#why)
- [Quick start](#quick-start)
- [What is available](#what-is-available)
- [Integration points](#integration-points)
- [How it works](#how-it-works)
- [Packages](#packages)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Security and privacy](#security-and-privacy)
- [Contributing](#contributing)
- [License](#license)

## Why

A login crosses four systems that share nothing:

- the app that starts it,
- a hosted login page you cannot see into,
- server hooks with weak logging,
- a provider event feed that arrives after the user is gone.

Every provider has a different event model, so teams rebuild the glue per provider and again
when they migrate. Auththread gives one neutral journey and one set of sinks, so the same
dashboard works across providers.

## Quick start

Requirements: [mise](https://mise.jdx.dev), Node 24 and pnpm 12. `mise install` provides the
last two.

### One journey in thirty seconds

```sh
mise install
mise exec -- pnpm install
mise exec -- pnpm demo
```

`pnpm demo` replays the shared corpus through the real stitcher and prints one wide event:
five ordered steps, outcome `denied`, one inferred join. It exits non-zero if the journey
breaks.

### The HTTP surface

```sh
mise exec -- pnpm smoke
```

This starts the Node runtime, sends spans and an Auth0 feed event over HTTP, checks the 401
paths, and asserts the final journey.

### A real browser login

```sh
mise exec -- pnpm --filter @auththread/example-keycloak build
docker compose -f examples/keycloak-compose/docker-compose.yml up --build
```

Sign in at http://localhost:8080 as `demo` / `demo`. The wide event appears in
`docker compose logs stitcher`. Traces appear in Grafana at http://localhost:3000. The compose
file is provided but has not been run in CI yet.

## What is available

### Providers

| Provider | Level | Status | Notes |
| --- | --- | --- | --- |
| Generic OIDC | L1 | **v0.1** | Any OIDC or OAuth 2.0 provider |
| Auth0 | L1 to L5 | **v0.1** | Browser params, Log Streams, Actions, page snippet, config fetch |
| Keycloak deep | L2, L4 | planned | Admin API events and login theme |
| Cognito, Okta, Supabase, Clerk, WorkOS, Firebase | L1, plus native hooks where available | community | Conformance defines done |

### Runtimes

| Runtime | Storage | Scheduler | Status |
| --- | --- | --- | --- |
| Node / Docker | Memory, or SQLite with WAL when `AUTHTHREAD_DB` is set | In-process timer | **v0.1** |
| Cloudflare Workers | Durable Object storage, one object per tenant | Alarms | **v0.1** |
| Redis or Valkey, Postgres, D1 | | | planned |
| Lambda, Kubernetes, Vercel, Netlify | | | later or community |

### Sinks

| Sink | Output | Status |
| --- | --- | --- |
| OTLP | Spans to any OTLP backend | **v0.1** |
| Wide event | One JSON line per journey to stdout | **v0.1** |
| Webhook | HMAC-SHA256 signed journey JSON | **v0.1** |
| Object store | NDJSON objects in S3, R2 or MinIO | **v0.1** |
| Parquet | Object store with predicate pushdown | planned |
| Native ClickHouse | Direct `JSONEachRow` insert | proposed |
| Datadog native, Splunk HEC, Kafka, OpenID SSF | | community |

### Analytics

The object store is readable by analytics engines without a pipeline.

- **DuckDB** reads the NDJSON directly from local disk, S3, R2 or MinIO. Verified with
  DuckDB 1.4.5, including hive partitions and dynamic attributes.
- **ClickHouse** reads the same files through `s3()` or ClickPipes.
- The same journey rows serve both. See
  [`packages/sinks/object-store/README.md`](packages/sinks/object-store/README.md).

### Capability levels

| Level | Capability | What you get |
| --- | --- | --- |
| L1 | `browser` | Login start, redirect, callback, token timing, abandonment |
| L2 | `event-feed` | Provider events joined to the journey |
| L3 | `hooks` | Per-hook spans: duration, decision, errors |
| L4 | `hosted-page` | Per-screen spans and UI errors |
| L5 | `config` | Hook and config versions for change tracking |

A provider is supported at a level only when its conformance suite is green.

## Integration points

Every extension follows one of these contracts. The compiler and the conformance suites keep
the edges honest.

| Layer | Contract | Add one |
| --- | --- | --- |
| Provider | `ProviderAdapter`, `Feed`, `ParseContext` | [Adding a provider](docs/adding-a-provider.md) |
| Runtime | `JourneyBuffer`, `Scheduler`, `SettingsStore`, `Secrets` | [Adding a runtime](docs/adding-a-runtime.md) |
| Sink | `Sink` with `render`, `write`, optional `flush` and `idempotencyKey` | Copy [`sink-webhook`](packages/sinks/webhook/src/index.ts) or [`sink-object-store`](packages/sinks/object-store/src/index.ts) |
| Browser helper | `BrowserProvider` | Provider package |
| Hook wrapper | `withTrace` | [`auth0/actions`](packages/providers/auth0/src/actions.ts) |
| Object storage | `ObjectStore` with one `put` method | [`packages/sinks/object-store`](packages/sinks/object-store/src/store.ts) |
| HTTP host | `fetch(Request): Promise<Response>` | Mount the stitcher on any Fetch runtime |
| Conformance | Four runners in `adapter-kit` | A green suite is what "supported" means |

Composition happens in examples, not in core:

```ts
const stitcher = createStitcher({
  providers: [oidcAdapter, auth0Adapter],
  buffer: createMemoryBuffer(),
  scheduler: createMemoryScheduler(),
  settings,
  sinks: [createWideEventSink(), createOtlpSink({ exporter })],
});
```

## How it works

```
 Browser SDK ─┐
 Login page  ─┼─ spans ──▶ stitcher ──┬─▶ OTLP ─────────▶ tracing backend
 Hook wrapper ─┘     buffer, join,    ├─▶ wide event ───▶ logs or warehouse
 Provider feed ─ events ─┘  finalise)  ├─▶ webhook ──────▶ anything with HTTP
                                       └─▶ object store ─▶ S3/R2 → DuckDB/ClickHouse
```

1. The browser creates a W3C trace ID and stores it in `sessionStorage`.
2. The provider adapter carries it through `/authorize` when the provider allows it. Auth0 uses
   `ext-trace_id`. Generic OIDC uses the state round trip.
3. Hooks and page plugins emit spans. The browser batches and flushes on redirect, callback
   and page hide.
4. Feed events join by exact trace ID, exact provider transaction ID, or a user hash inside a
   tenant and a two minute window.
5. The stitcher finalises on a quiet period, derives the root span and outcome, and writes to
   every sink.

Every emitter derives the same root span ID from the trace ID, so the browser, the hook and
the stitcher agree without a round trip.

## Packages

| Package | Purpose |
| --- | --- |
| [`@auththread/schema`](packages/core/schema) | Neutral attributes, redaction, ids, journey and wide event |
| [`@auththread/otlp`](packages/core/otlp) | OTLP/HTTP JSON encoder and exporters |
| [`@auththread/adapter-kit`](packages/core/adapter-kit) | Contracts, memory runtime, conformance suites, corpus |
| [`@auththread/stitcher`](packages/core/stitcher) | `createStitcher`, the Fetch handler and the join |
| [`@auththread/config`](packages/core/config) | Shared tenant config parsing for every runtime |
| [`@auththread/sdk`](packages/sdk) | Server SDK facade: neutral core, `./node`, `./cloudflare` |
| [`@auththread/browser`](packages/core/browser) | Provider-neutral browser SDK |
| [`@auththread/oidc`](packages/providers/oidc) | Generic OIDC adapter |
| [`@auththread/auth0`](packages/providers/auth0) | Adapter, browser helper, Action wrapper, page snippet |
| [`@auththread/runtime-node`](packages/runtimes/node) | Node server, timer scheduler, file settings, SQLite buffer |
| [`@auththread/runtime-cloudflare`](packages/runtimes/cloudflare) | Durable Object buffer, alarms, key directory |
| [`@auththread/sink-otlp`](packages/sinks/otlp) | Spans to any OTLP backend |
| [`@auththread/sink-wide-event`](packages/sinks/wide-event) | One JSON journey per line |
| [`@auththread/sink-webhook`](packages/sinks/webhook) | Signed journey JSON |
| [`@auththread/sink-object-store`](packages/sinks/object-store) | NDJSON journeys in S3, R2 or MinIO |

### Deployment and local artifacts

| Artifact | Path | Use |
| --- | --- | --- |
| Docker image | `Dockerfile` | One bundled non-root server image, amd64 and arm64 |
| Local compose | [`examples/local-compose`](examples/local-compose) | Server + Grafana + Tempo + Loki for local development |
| Cloudflare Worker | [`templates/cloudflare-worker`](templates/cloudflare-worker) | Standalone `wrangler deploy` / Deploy button template |

The install contract is in [`docs/install-contract.md`](docs/install-contract.md).
Runtime adapter rules are in [`docs/runtime-adapters.md`](docs/runtime-adapters.md).
Publishing is described in [`docs/publishing.md`](docs/publishing.md). Terraform and Pulumi
are deferred; the install contract is the seam they will wrap.

## Compatibility

- **Node**: 24 or newer for the server. The SQLite runtime needs 22.5 or newer.
- **Source**: the workspace runs TypeScript directly.
- **Package manager**: pnpm 12, through mise.
- **Cloudflare**: Workers with Durable Objects and alarms.
- **Browsers**: `sessionStorage`, `fetch` with keepalive, WebCrypto for hashing.
- **Backends**: any OTLP/HTTP JSON endpoint, log pipeline, HTTP receiver, or S3-compatible
  object store.
- **Not yet**: the first npm publish, Redis or Postgres storage, a UI or trace store.

## Verification

```sh
mise exec -- pnpm check   # types, lint, tests, boundaries, budgets, agent files
mise exec -- pnpm build   # dist output for every public package
mise exec -- pnpm pack:check  # tarball contents, protocols, declaration imports, publint
mise exec -- pnpm demo    # one journey from the corpus
mise exec -- pnpm smoke   # the real HTTP surface
mise exec -- pnpm graph   # package graph; --base <ref> --format markdown for a PR diff
mise exec -- pnpm budget  # browser SDK 2,506 B gzip, snippet 936 B gzip
```

Current status: 28 test files, 142 tests, 108 modules, no boundary violations. See
[`docs/verification.md`](docs/verification.md) for what is proven and what is not.

## Roadmap

### Shipped in v0.1

- [x] Neutral schema, double redaction, wide event v1
- [x] OTLP encoder, batch exporter and OTLP sink
- [x] Stitcher with exact trace and transaction joins, quiet finalisation
- [x] Generic OIDC browser adapter
- [x] Auth0 browser params, Log Stream feed, Action wrapper, page snippet, config fetch
- [x] Node runtime and Cloudflare Durable Object runtime
- [x] SQLite buffer with WAL and restart recovery for the Node runtime
- [x] Wide event, webhook and object store sinks
- [x] Conformance suites, cross-runtime equality, shared corpus
- [x] Keycloak compose, Node image and Worker examples
- [x] Canonical Node runtime entrypoint and bundled server image
- [x] DuckDB queries verified against the object store
- [x] Bundle budgets in CI

### Next

- [x] Publish pipeline: dist builds, Changesets, pack checks, npm provenance and release workflow
- [ ] Keycloak L2 events through the Admin API and L4 through a login theme
- [ ] Auth0 page error detection for failed-only logins
- [x] Ship the Auth0 Action wrapper in a form Actions can require (ESM and CJS)
- [ ] Token exchange error status in the browser SDK
- [ ] Signed page snippet release with SRI
- [ ] Redis, Postgres and D1 storage backends
- [ ] Parquet object store and predicate pushdown
- [ ] Native ClickHouse sink
- [ ] Run the Keycloak compose stack in CI
- [ ] Run the Cloudflare template against published packages in CI

### Later and community

- [ ] Cognito, Okta, Supabase, Clerk, WorkOS and Firebase adapters
- [ ] Lambda, Kubernetes, Vercel and Netlify runtimes
- [ ] Datadog native, Splunk HEC and Kafka sinks
- [ ] OpenID Shared Signals sink
- [ ] Retention and lifecycle guidance per sink

### Out of scope for this repo

- [ ] UI, hosted trace store, alerts
- [ ] Coverage, replay tests, AI root cause
- [ ] A paid reliability service. It lives in a separate repository (ADR-0006)

## Documentation

- [Journey schema](docs/schema.md)
- [Privacy model](docs/privacy.md)
- [Adding a provider](docs/adding-a-provider.md)
- [Adding a runtime](docs/adding-a-runtime.md)
- [Decisions](docs/decisions/INDEX.md)
- [Verification](docs/verification.md)
- [Auth0 correlation research](docs/research/auth0-log-correlation.md)
- [Keycloak example](examples/keycloak-compose/README.md)
- [Node image](examples/node-docker/README.md)
- [Cloudflare Worker](examples/cloudflare-worker/README.md)
- [Object store and DuckDB](packages/sinks/object-store/README.md)

## Security and privacy

- Emitters are fire and forget or hard timed out. Nothing blocks a login.
- No PII by default. Identifiers are salted hashes, secrets are dropped, and redaction runs
  twice.
- A missing salt drops identifiers instead of storing them.
- Report vulnerabilities through [`SECURITY.md`](SECURITY.md).

## Contributing

DCO sign-off is required. Run `mise exec -- pnpm check` before a pull request. A new adapter
ships with fixtures and a conformance suite, and an architecture change gets an ADR. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md).

## License

MIT. See [`LICENSE`](LICENSE).
