# AGENTS

auththread makes one login journey visible end to end: app, hosted login page, server hooks
and provider logs, stitched into one trace or one wide event and sent to the observability
tool the team already uses.

## Repo map

- `packages/core/*` is the neutral model and join logic. `browser` and `schema` also ship to
  browsers, so they carry no runtime dependency.
- `packages/providers/*` are provider adapters. They depend on core only.
- `packages/runtimes/*` are buffers, schedulers and servers. They take providers as input.
- `packages/sinks/*` are outputs: OTLP, wide event, webhook.
- `packages/tooling/*` is dev only.
- `examples/*` composes packages into deployable units.
- `docs/decisions/` holds ADRs. `INDEX.md` is generated.

## Verify

- `mise exec -- pnpm check` runs typecheck, lint, tests, boundaries, bundle budgets and agent checks.
- `mise exec -- pnpm demo` replays the shared corpus and prints one wide event.
- `mise exec -- pnpm smoke` drives the Node HTTP surface: auth, feed signature, join, sink.
- `mise exec -- pnpm budget` prints the browser SDK and page snippet sizes against their budgets.

## Invariants

- Nothing sits in the login path. Emitters are fire and forget or hard timed out.
- No PII by default. Raw identifiers are hashed with the tenant salt; secrets are dropped.
- Core never imports a provider, runtime or sink. `pnpm boundaries` enforces it.
- Conformance defines support. An adapter without a green suite is experimental (ADR-0004).

## Skills

Load the skill that matches the task. Repo rules, ADRs and this file win over vendored skills.

Repo-authored workflow skills live in `.agents/skills/`:

- `learn` — after a correction, a non-obvious fact or a repeated workflow; capture it in
  `.agents/learnings/inbox.md` and promote it to the narrowest home.
- `write-adr` — when choosing an option or setting a cross-package convention; write an
  outcome ADR and regenerate the index.
- `review-against-rules` — when reviewing a diff or before opening a PR; report findings as
  `path:line — rule — problem — fix`.
- `write-pr` — when writing or updating a PR description; fill the template verbatim.
- `add-vendor-skill` — when adding or updating a third-party skill; pin it, lock it, check it.

Vendored skills are pinned copies (ADR-0011):

- `cloudflare` — picking Cloudflare products and architecture before a Worker skill.
- `workers-best-practices` — writing, reviewing or configuring Workers.
- `durable-objects` — building, debugging or reviewing Durable Object state and coordination.
- `wrangler` — local dev, config and deploy commands for a Workers project.
- `workers-profiling` — profiling CPU and memory in a deployed Worker or Durable Object.
- `turborepo` — task pipelines, caching, filtering and CI configuration.

auththread uses the pinned `wrangler` from the pnpm catalog. The `cf` CLI guidance in the
vendored Cloudflare skills applies to projects without a Wrangler config, not here.

## Rules index

Read the matching rule before editing those files.

<!-- rules-index:start -->
| Files | Rule |
| --- | --- |
| `**/AGENTS.md`, `.agents/**/*.md`, `docs/decisions/**/*.md` | [agent-files.md](.agents/rules/agent-files.md) |
| `packages/**/*.ts` | [boundaries.md](.agents/rules/boundaries.md) |
| `**/*.test.ts`, `packages/core/adapter-kit/src/conformance/**` | [testing.md](.agents/rules/testing.md) |
| `packages/**/*.ts`, `scripts/**/*.ts` | [typescript.md](.agents/rules/typescript.md) |
<!-- rules-index:end -->
