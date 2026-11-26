---
description: Package tiers and the enforced dependency direction.
paths:
  - "packages/**/*.ts"
---

# Boundaries

| Tier | Path | May depend on |
| --- | --- | --- |
| Core | `packages/core/*` | core |
| Provider | `packages/providers/*` | core, Effect |
| Runtime | `packages/runtimes/*` | core |
| Sink | `packages/sinks/*` | core |
| Tooling | `packages/tooling/*` | anything, dev only |

- Core never imports an adapter.
- `packages/sdk` is the one facade allowed to import runtime adapters; keep it a
  re-export layer, not a home for logic.
- `templates/**` and `examples/local-compose/**` are outside the package graph.
- Providers never import runtimes or sinks.
- Runtimes never import providers or sinks.
- Only the Node runtime, tooling and examples may import Node built-ins.
- Only the Cloudflare runtime may import `@cloudflare/*`.
- `packages/core/{schema,otlp,browser}` and provider browser/action helpers carry no runtime
  dependency.
- `adapter-kit`, `stitcher`, provider server exports, runtimes and sinks use Effect v4.

`pnpm boundaries` is the source of truth. If a rule can be expressed in
`.dependency-cruiser.cjs`, put it there instead of prose.
