---
id: "0001"
title: "Repo structure: core, adapters, sinks and tooling"
scope:
  - "packages/**"
enforced-by:
  - ".dependency-cruiser.cjs"
---

# 0001. Repo structure: core, adapters, sinks and tooling

## Outcome

- `packages/core/*` holds the neutral model and the join logic.
- `packages/providers/*`, `packages/runtimes/*` and `packages/sinks/*` are adapters.
- `packages/tooling/*` is dev only.
- `examples/*` composes published packages into something deployable.

## Rules

- The dependency direction is `adapters -> core`. Core never imports an adapter.
- Providers cannot import runtimes or sinks, and runtimes cannot import providers or sinks.
  Composition happens in `examples/*`.
- Only the Node runtime, tooling and examples may import Node built-ins.
- Only the Cloudflare runtime may import `@cloudflare/*`.
- `pnpm boundaries` enforces every rule in `.dependency-cruiser.cjs`.

## Why

A provider author should never need a cloud account, and a runtime author should never
need a provider. The enforced edges are what make a community adapter a package rather
than a fork.
