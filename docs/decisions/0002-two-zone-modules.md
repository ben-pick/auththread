---
id: "0002"
title: "Two-zone modules: zero-dependency edge, Effect v4 server zone"
scope:
  - "packages/core/**"
  - "packages/providers/**"
  - "packages/sinks/**"
enforced-by:
  - ".dependency-cruiser.cjs"
---

# 0002. Two-zone modules: zero-dependency edge, Effect v4 server zone

## Outcome

- The edge zone is `schema`, `otlp`, `browser`, provider browser helpers and hook wrappers.
  It ships to browsers and login pages with no third-party runtime code.
- The server zone is `adapter-kit`, `stitcher`, the providers' server exports, the runtimes,
  the sinks and tooling. It is written with Effect v4.
- Server contracts (`ProviderAdapter`, `Sink`, `JourneyBuffer`, `Scheduler`, `SettingsStore`)
  return `Effect` values. Browser helpers stay plain TypeScript and Promise free.
- Provider packages expose the browser helper at `<package>/browser` and the Effect adapter
  at the package root, so a bundled page never pulls Effect in.

## Rules

- `packages/core/{schema,otlp,browser}` and `packages/providers/*/src/{browser,actions}.ts`
  must not depend on a published package at runtime. Tests may use Vitest and Effect.
- `adapter-kit`, `stitcher`, runtimes and sinks depend on `effect` and use `Context.Service`,
  `Layer`, `Schema` and `Schema.TaggedError`.
- The browser SDK stays under 5 KB gzipped and the page snippet under 8 KB.
- Hook wrappers never block a login. The target is under 50 ms at p95, measured against a
  real Action. That measurement has not been taken (see `docs/verification.md`).

## Why

Effect earns its place in the stitcher, runtimes and sinks: typed errors, dependency
injection, schema decoding and structured concurrency. It cannot fit in a 5 KB browser SDK,
so the edge stays plain. Splitting provider packages by entry point keeps both properties:
the browser helper is dependency free, and the server adapter is fully Effect.
