---
id: "0004"
title: "Conformance defines support"
scope:
  - "packages/core/adapter-kit/**"
  - "packages/providers/**"
  - "packages/runtimes/**"
  - "packages/sinks/**"
enforced-by:
  - "packages/core/adapter-kit/src/conformance/*.ts"
---

# 0004. Conformance defines support

## Outcome

- A provider, runtime or sink is supported only when its conformance job is green in CI.
- `runProviderConformance`, `runRuntimeConformance`, `runSinkConformance` and
  `runEndToEndConformance` return a report instead of asserting, so a failing adapter reports
  every failure at once.
- The shared corpus in `adapter-kit/src/corpus.ts` is the input to end-to-end conformance.

## Rules

- A new adapter ships with fixtures and a conformance test in the same package.
- The end-to-end suite delivers the corpus in order, reversed, duplicated and delayed, and
  requires byte-identical batches.
- A deliberately broken fake adapter must fail its suite. The test suite keeps one.

## Why

Review cannot keep adapter behaviour consistent across providers, clouds and outputs. The
suite can. It also turns "we support Keycloak" into a claim CI can check.
