# Verification for v0.1

Every claim in the README is checked here, or labelled as not checked.

## Verified in this repo

Run `mise exec -- pnpm check`. It runs typecheck, Biome, every test, dependency-cruiser,
actionlint and the agent file checks. Current result: 19 test files, 89 tests, no violations.

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
- **Boundaries.** `pnpm boundaries` reports no violation across 70 modules.

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

## Rerun

```sh
mise exec -- pnpm check
mise exec -- pnpm demo
mise exec -- pnpm --filter @auththread/example-keycloak build
```
