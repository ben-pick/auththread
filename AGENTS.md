# AGENTS

auththread makes one login journey visible end to end: app, hosted login page, server hooks
and provider logs, stitched into one trace or one wide event and sent to the observability
tool the team already uses.

## Repo map

- `packages/core/*` is the neutral model and join logic. `browser` and `schema` also ship to
  browsers, so they carry no runtime dependency. `adapter-kit` and `stitcher` are the
  Effect-based server core.
- `packages/providers/*` are provider adapters. They depend on core and Effect only.
- `packages/runtimes/*` are buffers, schedulers and servers. They take providers as input and
  expose Effect layers; the Node example runs them through `NodeRuntime.runMain`.
- `packages/sinks/*` are outputs: OTLP, wide event, webhook.
- `packages/tooling/*` is dev only.
- `examples/*` composes packages into deployable units.
- `docs/decisions/` holds ADRs. `INDEX.md` is generated.

## Verify

- `mise exec -- pnpm check` runs typecheck, lint, tests, boundaries, bundle budgets and agent checks.
- `mise exec -- pnpm demo` replays the shared corpus and prints one wide event.
- `mise exec -- pnpm smoke` drives the HTTP surface: auth, feed signature, join, sink.
- `mise exec -- pnpm budget` prints the browser SDK and page snippet sizes against their budgets.

## Invariants

- Nothing sits in the login path. Emitters are fire and forget or hard timed out.
- No PII by default. Raw identifiers are hashed with the tenant salt; secrets are dropped.
- Core never imports a provider, runtime or sink. `pnpm boundaries` enforces it.
- The server zone uses Effect v4: `Schema` at every boundary, `Context.Service` and `Layer`
  for dependencies, `Schema.TaggedError` for expected failures. The browser edge stays
  dependency free (ADR-0002, ADR-0003).
- Provider packages export the Effect adapter at the root and the browser helper at
  `/browser`.
- Conformance defines support. An adapter without a green suite is experimental (ADR-0004).

## Rules index

Read the matching rule before editing those files.

<!-- rules-index:start -->
| Files | Rule |
| --- | --- |
| `**/AGENTS.md`, `.agents/**/*.md`, `docs/decisions/**/*.md` | [agent-files.md](.agents/rules/agent-files.md) |
| `packages/**/*.ts` | [boundaries.md](.agents/rules/boundaries.md) |
| `packages/core/adapter-kit/**/*.ts`, `packages/core/stitcher/**/*.ts`, `packages/providers/**/*.ts`, `packages/runtimes/**/*.ts`, `packages/sinks/**/*.ts`, `examples/**/*.ts`, `scripts/**/*.ts` | [effect.md](.agents/rules/effect.md) |
| `**/*.test.ts`, `packages/core/adapter-kit/src/conformance/**` | [testing.md](.agents/rules/testing.md) |
| `packages/**/*.ts`, `scripts/**/*.ts` | [typescript.md](.agents/rules/typescript.md) |
<!-- rules-index:end -->
