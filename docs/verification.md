# Verification for v0.1

Every claim in the README is checked here, or labelled as not checked.

## Verified in this repo

Run `mise exec -- pnpm check`. It runs typecheck, Biome, every test, dependency-cruiser,
actionlint and the agent file checks. Current result: 19 test files, 94 tests, no violations.

- **One journey from recorded fragments.** `pnpm demo` replays the Auth0 deny fixture through
  the real stitcher and prints one wide event with five ordered steps: login start, UI screen,
  hook, callback and provider event. Outcome `denied`, one inferred correlation.
- **Order tolerance.** `runEndToEndConformance` delivers the corpus in order, reversed,
  duplicated and delayed, and requires byte-identical batches.
- **Cross runtime equality.** `packages/tooling/conformance` delivers the same corpus to the
  memory buffer and the Durable Object buffer and requires identical JSON for all three
  journeys.
- **Redaction.** Tests cover secret keys, hashed identifiers, missing salt, email and JWT
  stripping, and assert raw identifiers never reach a sink.
- **Browser budget.** `pnpm --filter @auththread/example-keycloak build` reports the minified
  browser bundle and fails above 5 KB gzipped. Measured: 6,215 bytes minified, 3,139 bytes
  gzipped.
- **Provider conformance.** OIDC and Auth0 pass `runProviderConformance` against recorded
  payloads, including an adapter that must fail.
- **Runtime conformance.** Memory, Node timer and Durable Object alarm runtimes pass
  `runRuntimeConformance`.
- **Sink conformance.** OTLP, wide event and webhook pass `runSinkConformance`, including
  HMAC verification and webhook retry behaviour.
- **Boundaries.** `pnpm boundaries` reports no violation across 71 modules.

## Not verified here

- **The Keycloak compose stack was not executed.** Docker was unavailable in the environment
  that built v0.1. The compose file, realm import, page and bundle were written but not run.
  This is the first thing to run in CI or locally.
- **Hook latency under 50 ms at p95 is not measured.** It needs a real Auth0 tenant and an
  Action invocation. The wrapper has a 250 ms abort and never throws, which bounds the
  failure mode but is not a latency measurement.
- **No production installs.** The plan's design partner gate is business validation, not code.
- **Community provider rows and Redis, Postgres, D1, Lambda and Kubernetes runtimes are not
  implemented.** They are listed as future work in `PLAN.md`, not claimed as shipped.
- **Auth0 Management API config fetch has no integration test.** It is typed and compiled,
  but nothing calls a real tenant. It is optional at runtime.

## Review fixes

An independent review of the first build found defects. These were fixed and are covered by
tests, rather than deferred:

- Hint joins are scoped by tenant and require a matching user hash. A client ID alone cannot
  join, and an event for one tenant cannot attach to another tenant's journey.
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

## Rerun

```sh
mise exec -- pnpm check
mise exec -- pnpm demo
mise exec -- pnpm --filter @auththread/example-keycloak build
```
