---
description: Effect v4 conventions for the server zone (adapter-kit, stitcher, providers' server exports, runtimes, sinks).
paths:
  - "packages/core/adapter-kit/**/*.ts"
  - "packages/core/stitcher/**/*.ts"
  - "packages/providers/**/*.ts"
  - "packages/runtimes/**/*.ts"
  - "packages/sinks/**/*.ts"
  - "examples/**/*.ts"
  - "scripts/**/*.ts"
---

# Effect v4

The authoritative guide ships with the installed package at `node_modules/effect/AGENTS.md`.
Read it before using an API this rule does not cover. The shape of a server program:

```ts
const program = Effect.gen(function* () {
  const stitcher = yield* Stitcher;
  return yield* stitcher.handle(request);
});

const live = stitcherLayer(options).pipe(
  Layer.provide(Layer.mergeAll(memoryBufferLayer, memorySchedulerLayer, settingsLayer)),
);
```

## Rules

1. **Schema at boundaries.** Decode untrusted input with `Schema.decodeUnknownResult` or
   `Schema.fromJsonString`. Never `JSON.parse`, `typeof` chains or `Array.isArray` parsers.
   The wire schemas live in `packages/core/stitcher/src/wire.ts`.
2. **Tagged errors.** Expected failures are `Schema.TaggedError` classes in the error
   channel. Raise with `return yield* new MyError({ ... })`. Defects are bugs only.
3. **No throw, no try/catch.** Wrap throwing libraries with `Effect.try`, `Effect.tryPromise`
   or `Result.try` and map the cause to a tagged error.
4. **Services and layers.** Declare `Context.Service` classes with a string identity. Provide
   them with `Layer.effect`, `Layer.succeed` or `Layer.scoped`. No module-level singletons.
5. **Config and time.** Read the environment with `Config`, not `process.env`. Read time with
   `Clock.currentTimeMillis`, not `Date.now`; tests may pass a fixed `now` effect.
6. **Concurrency and retries.** Use `Effect.forEach` with a concurrency option, `Effect.retry`,
   `Effect.timeout` and `Schedule`. No hand-rolled retry loops.
7. **Sinks and storage never fail the login path.** Catch their errors, count them and log
   with the supplied `onError`. A telemetry failure must not turn a login into a 500.

## Boundaries

- Browser helpers (`schema`, `otlp`, `browser`, provider `browser.ts`, `actions.ts`) must not
  import `effect`. See ADR-0002.
- Provider packages split entry points: root is the Effect server adapter, `/browser` is the
  dependency-free helper.

## Checklist

- `mise exec -- pnpm --filter <pkg> typecheck test`
- `mise exec -- pnpm lint` and `mise exec -- pnpm boundaries`
