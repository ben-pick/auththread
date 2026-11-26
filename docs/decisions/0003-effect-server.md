---
id: "0003"
title: "Effect v4 on the server, Effect Schema at every boundary"
scope:
  - "packages/core/**"
  - "packages/runtimes/**"
  - "packages/providers/**"
  - "packages/sinks/**"
---

# 0003. Effect v4 on the server, Effect Schema at every boundary

## Outcome

- The server is an Effect program from its entry point. `examples/node-docker` runs a
  `Layer.launch` through `NodeRuntime.runMain`; the Cloudflare Durable Object owns a
  `ManagedRuntime` and runs request and alarm effects through it.
- Services are `Context.Service` classes and are provided with `Layer`. The stitcher depends
  on `JourneyBuffer`, `Scheduler` and `SettingsStore`, never on a concrete runtime.
- Untrusted input is decoded with Effect `Schema` in `stitcher/src/wire.ts`, the auth0 feed and
  the settings loader. The hand-written decoders in `stitcher/src/decode.ts` are gone.
- Expected failures are `Schema.TaggedError` classes in the error channel. Sink and storage
  failures are counted and reported; they do not fail the login path.
- `fetch(Request): Promise<Response>` remains the outer platform port because Node and
  Workers require it. Everything inside that port is Effect.

## Rules

- No `JSON.parse`, `typeof` chain or `Array.isArray` for external input. Decode with
  `Schema.decodeUnknownResult`/`decodeUnknownEffect` and `Schema.fromJsonString`.
- No `throw` in domain code. Raise a tagged error. A configuration failure at process start
  may be a defect, never a business error.
- Domain functions return `Effect`; commands, retries, timeouts and concurrency use Effect
  combinators rather than hand-rolled loops.
- The edge zone does not import Effect (ADR-0002).

## Why

The server grew a second store, typed failures, retries and multi-tenant routing. Hand-written
decoders duplicated the published schema and mixed defects with expected failures. Effect
gives one model for validation, dependency injection, failure and concurrency across Node and
Workers, and lets tests provide a deterministic clock and buffer.
