---
name: effect-code
description: Use when writing, reviewing, or debugging TypeScript in the server zone that imports effect, including Schema, Effect, Layer, Config, Context, HttpRouter, HttpServer and ManagedRuntime. Points at the Effect v4 guide shipped in node_modules and the repo rules.
---

# Effect code

Effect v4 is the server programming model (ADR-0002, ADR-0003). The authoritative API guide
ships with the installed package at `node_modules/effect/AGENTS.md`. Read it before using an
API this skill does not cover, and verify imports against `node_modules/effect`.

Repo rules win on conflict: `.agents/rules/effect.md`, `.agents/rules/boundaries.md`,
`.agents/rules/typescript.md`.

## Start with the boundary

Write the data shape first. Every untrusted input gets an Effect `Schema` next to the
capability that owns it.

- JSON text uses `Schema.fromJsonString(Target)`.
- Unknown values use `Schema.decodeUnknownResult` or `Schema.decodeUnknownEffect`.
- Derive types with `typeof Schema.Type` or `typeof Schema.Encoded`.
- Do not annotate a schema as `Schema.Schema<T>` when detail matters. The annotation can
  widen `DecodingServices` to `unknown`; let the schema infer.
- Decode to a `Result` and lift it with `Effect.fromResult` when you want no decoding
  service requirement.

The wire schemas for the server live in `packages/core/stitcher/src/wire.ts`.

## Failures

- Expected failures are `Schema.TaggedError` classes in the error channel.
- Raise with `return yield* new MyError({ ... })`.
- Defects are bugs. Never use a defect for a user, config or provider error.
- No `throw` and no `try`/`catch` in domain code. Wrap throwing code with `Effect.try`,
  `Effect.tryPromise` or `Result.try` and map the cause.
- In Effect 4.1.2 the recovery combinators are `catchTag`, `catchTags`, `catchIf`,
  `catchCause` and `catchDefect`. `Effect.catchAll` is not exported.

## Programs

- Inline programs use `Effect.gen`.
- Reusable functions use `Effect.fn("name")(function* () {})` when tracing helps, otherwise
  `Effect.fnUntraced`.
- Do not write a function that only wraps and returns an `Effect.gen`.
- Do not mix ad-hoc `async` functions into domain code.

## Services and layers

- Declare services with `Context.Service<Self, Shape>()("auththread/Name")`.
- Provide with `Layer.effect`, `Layer.succeed`, `Layer.effectContext`,
  `Layer.effectDiscard` or `Layer.mergeAll`.
- `Layer.scoped` is not in Effect 4.1.2. Use `Layer.effect` for an effect with a scope.
- Compose the stitcher with `stitcherLayer(options)` and provide `JourneyBuffer`,
  `Scheduler` and `SettingsStore`.
- No module-level singletons for state or configuration.

## Runtime entry points

- Node uses `@effect/platform-node`. `NodeRuntime.runMain` runs the `Layer.launch` program
  and `NodeServices.layer` provides `FileSystem`, `Path` and the rest.
- `nodeServerLayer({ port })` calls `HttpRouter.serve` and starts the due-journey poller.
- A Durable Object owns a `ManagedRuntime` and runs request, alarm and retry effects
  through it.
- `fetch(Request): Promise<Response>` is the platform port. Everything inside it is Effect.

## Concurrency and time

- Use `Effect.forEach` with a concurrency option, not `Promise.all` or hand-rolled loops.
- Use `Effect.retry`, `Effect.timeout` and `Schedule`.
- Read time with `Clock.currentTimeMillis`. Tests pass a fixed `now` effect or use
  `TestClock`.
- Use `Effect.forkScoped` for background work so the layer scope owns its lifetime.

## Auththread specifics

- The edge zone must not import effect. That covers `schema`, `otlp`, `browser`, provider
  `browser.ts` and `actions.ts`.
- Provider packages export the Effect adapter at the root and the browser helper at
  `/browser`.
- Sinks, feeds and storage failures are counted and reported. They never fail the login path.
- A custom runtime must call `stitcher.runDue(now)` from a timer or alarm.

## Tests

- Use `it.effect` from `@effect/vitest` for Effect tests.
- Use `it.live` when the test needs real sockets, real timers or a real server.
- Provide deterministic dependencies through layers.
- Assert observable behavior, not internal call order.

## Checklist

- `mise exec -- pnpm --filter <pkg> typecheck test`
- `mise exec -- pnpm lint`
- `mise exec -- pnpm boundaries`
- `mise exec -- pnpm check` before reporting done
