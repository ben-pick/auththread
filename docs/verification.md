# Verification for v0.1

Every claim in the README is checked here, or labelled as not checked.

## Verified in this repo

Run `mise exec -- pnpm check`. It runs typecheck, Biome, every test, dependency-cruiser,
actionlint and the agent file checks. The suite is green and `pnpm boundaries` is clean.

- **One journey from recorded fragments.** `pnpm demo` replays the Auth0 deny fixture through
  the real stitcher and prints one wide event with five ordered steps: login start, UI screen,
  hook, callback and provider event. Outcome `denied`, one inferred correlation.
- **The HTTP surface.** `pnpm smoke` sends four spans and one Auth0 log stream event through
  the stitcher HTTP handler, and asserts a 401 without a key, a 401 with a bad feed secret,
  one denied journey with five steps, one inferred join, and no raw identifier. The Node
  runtime also has a live-server test that fetches `/healthz` and posts a journey.
- **Order tolerance.** `runEndToEndConformance` delivers the corpus in order, reversed,
  duplicated and delayed, and requires byte-identical batches.
- **Cross runtime equality.** `packages/tooling/conformance` delivers the same corpus to the
  memory buffer and the Durable Object buffer and requires identical JSON for all three
  journeys.
- **Redaction.** Tests cover secret keys, hashed identifiers, missing salt, email and JWT
  stripping, and assert raw identifiers never reach a sink.
- **Publishable packages.** `pnpm build` emits `dist` JavaScript and declarations for every public package. `pnpm pack:check` packs all 14 public packages, rejects test files, source files, `workspace:`/`catalog:` protocols and `.ts` declaration imports, and runs `publint`.
- **Server config boundary.** `apps/server` loads env through Effect Config and Schema, validates numeric ranges, JSON headers and all-or-nothing webhook/S3 groups, and fails before the HTTP server starts.
- **Node image.** The Dockerfile builds a bundled ESM server, runs as a non-root user, and answers `/healthz`. The CI container job builds the image and smokes it.
- **Deployment and local artifacts.** `examples/local-compose` and `templates/cloudflare-worker` carry the local demo and Cloudflare contracts. `pnpm template:check` verifies the Worker template contract and typechecks it against the workspace API.
- **Bundle budgets.** `pnpm budget` runs in `pnpm check` and fails above either budget. The
  browser SDK is bundled alone, without demo app code, and must stay under 5 KB gzipped. The
  page snippet as shipped must stay under 8 KB. The Keycloak example app is measured and
  reported without a budget, because it contains the demo's own page code. Run `pnpm budget`
  for the current sizes. `pnpm budget --base <ref> --format markdown` measures the base in a
  detached worktree and prints the gzipped, minified, budget and change columns. CI uploads
  that markdown and a separate no-checkout job posts one sticky comment; the report is
  informational and the budget gate stays in `pnpm check`. BundleMon was not adopted; see
  [ADR-0011](decisions/0011-bundle-size-pr-report.md).
- **Provider conformance.** OIDC and Auth0 pass `runProviderConformance` against recorded
  payloads, including an adapter that must fail.
- **Runtime conformance.** Memory, Node timer, SQLite and Durable Object alarm runtimes pass
  `runRuntimeConformance`.
- **Dependency graph.** `pnpm graph` collapses dependency-cruiser output to workspace packages
  and prints a Mermaid flowchart. `pnpm graph --base <ref> --format markdown` checks the ref
  out into a detached worktree and reports added and removed packages and edges. The PR job
  uploads the markdown; a separate no-checkout job posts one sticky comment. The graph is
  informational, and `pnpm boundaries` still fails the build on a violation.
- **SQLite restart recovery.** The store runs with WAL, passes runtime conformance, and a
  journey that was still in flight when the first store closed is finalised from the second
  store with the expected outcome. A test also tries to append to another tenant's trace and
  requires the write to fail.
- **Sink conformance.** OTLP, wide event, webhook and object store pass `runSinkConformance`,
  including HMAC verification, webhook retry behaviour, NDJSON formatting and a content-hash
  key that stays stable on replay.
- **Object store signing.** The S3 adapter is checked against the published AWS Signature
  Version 4 example, and a failed put keeps the rows for the next flush.
- **Exact Auth0 transaction join.** Verified on a test tenant, then implemented: the Action
  sends `auth.transaction.id`, the feed parses `details.transaction_id`, and the stitcher
  joins exactly per tenant. Tests cover failure then success, success then failure, pending
  adoption by transaction, and a transaction lookup outside the window.
- **Boundaries.** `pnpm boundaries` reports no violation.
- **Per-tenant routing.** `createKeyDirectory` resolves each tenant key, rejects missing and
  unknown keys, and refuses a directory with a shared key or duplicate tenant.

## Not verified here

- **The Keycloak compose stack was not executed.** Docker was unavailable in the environment
  that built v0.1. The compose file, realm import, page and bundle were written but not run.
  This is the first thing to run in CI or locally.
- **The Node image was not built with Docker here.** Its install step was reproduced from a
  clean copy with `CI=1 pnpm install --frozen-lockfile`, the budget script ran, and the server
  answered `/healthz`. The image layers themselves are unverified.
- **Hook latency under 50 ms at p95 is not measured.** It needs a real Auth0 tenant and an
  Action invocation. The wrapper has a 250 ms abort and never throws, which bounds the
  failure mode but is not a latency measurement.
- **No production installs.** The plan's design partner gate is business validation, not code.
- **SQLite is verified for one writer.** WAL, restart recovery and tenant ownership are
  tested. Multi-process access, migration from an older schema, and pruning under load are
  not. Run one replica per database until the Redis buffer exists.
- **Community provider rows and Redis, Postgres, D1, Lambda and Kubernetes runtimes are not
  implemented.** They are listed as future work in `PLAN.md`, not claimed as shipped.
- **Auth0 Management API config fetch has no integration test.** It is typed and compiled,
  but nothing calls a real tenant. It is optional at runtime.

## Review fixes

An independent review of the first build found defects. These were fixed and are covered by
tests, rather than deferred:

- Hint joins are scoped by tenant and require a matching user hash. A client ID alone cannot
  join, and an event for one tenant cannot attach to another tenant's journey. Candidate
  lookup is an intersection, so a tenant-only index cannot match a user-hash query.
- A trace has one owner. The stitcher and the SQLite store both reject an append from another
  tenant, because a leaked trace ID is not an authorization.
- An empty API key is rejected at config load and at the bearer parser, so a blank header
  cannot authenticate.
- An OTLP timestamp that is not integer nanoseconds returns 400 instead of throwing from
  `BigInt` and returning 500.
- The Node server drains in-flight journeys before it flushes sinks and closes the store, so
  a graceful shutdown does not drop a buffered journey.
- Redaction covers span events and status messages, and an `auth.user.hash` that is not a
  real hash is rehashed or dropped.
- Each login attempt rotates the trace. A pending attempt keeps it across the redirect, and a
  stale attempt older than 15 minutes rotates.
- Finalise deadlines never sit in the past, and a quiet period is re-checked at finalisation.
- Buffer hint timestamps only move forward, so out-of-order delivery matches on both runtimes.
- The stitcher stamps the authenticated tenant and provider, so a page or hook span cannot
  mislabel a journey.
- The Node runtime caps the request body at 256 KB before reading it into memory, and the
  stitcher caps items per journey and pending bytes.
- A span that arrives during the sink write is kept and rescheduled instead of being deleted.
- Conformance now fails on any leaked identifier, requires real fixtures for feed adapters,
  requires a root span in a spans sink, uses 20 distinct concurrent IDs, compares raw output
  without re-sorting, and rejects a stitcher that silently drops provider events.
- Ordering uses code point comparison, not `localeCompare`, so bytes do not depend on ICU.

## Follow-up

After the review, three changes landed:

- `auth.journey.kind` distinguishes `login`, `signup`, `reset` and `step_up` on the journey
  and the root span. The Auth0 feed marks signup events, the Action wrapper takes a `stage`
  and `kind`, and the browser SDK takes a `kind`.
- The browser SDK batches spans, flushes on the redirect, the callback and a page hide, and
  stays under the browser budget when measured on its own. The page snippet is measured as
  shipped and stays under its own budget.
- The Cloudflare Worker resolves the API key with `createKeyDirectory` and routes to one
  Durable Object per tenant, so tenant state is isolated before ingest.

## Rerun

```sh
mise exec -- pnpm check
mise exec -- pnpm demo
mise exec -- pnpm --filter @auththread/example-keycloak build
```
