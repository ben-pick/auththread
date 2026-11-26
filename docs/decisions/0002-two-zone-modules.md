---
id: "0002"
title: "Two-zone modules: zero-dependency edge, server zone may adopt Effect"
scope:
  - "packages/core/**"
  - "packages/providers/**"
  - "packages/sinks/**"
enforced-by:
  - ".dependency-cruiser.cjs"
---

# 0002. Two-zone modules: zero-dependency edge, server zone may adopt Effect

## Outcome

- The edge zone is `schema`, `otlp`, `adapter-kit`, `browser`, provider page snippets and
  hook wrappers. It ships to browsers and login pages with no third-party runtime code.
- Server-side internals are `stitcher`, the runtimes and tooling. They may adopt Effect.
- Public contracts (`ProviderAdapter`, `Sink`, `JourneyBuffer`, `Scheduler`) stay plain
  TypeScript and Promise based.

## Rules

- `packages/core/{schema,otlp,adapter-kit,browser}` must not depend on a published package
  at runtime. Tests may use Vitest.
- The browser SDK stays under 5 KB gzipped and the page snippet under 8 KB.
- Hook wrappers add under 50 ms at p95 and never block a login.

## Why

Effect earns its place in retries, layers and typed failures on a server. It cannot fit in a
5 KB browser SDK, and requiring it would raise the bar for every community adapter. Keeping
the contracts Promise based is what lets a provider author work without learning our server
stack.
