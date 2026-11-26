---
description: Package tiers and the enforced dependency direction.
paths:
  - "packages/**/*.ts"
---

# Boundaries

| Tier | Path | May depend on |
| --- | --- | --- |
| Core | `packages/core/*` | core |
| Provider | `packages/providers/*` | core |
| Runtime | `packages/runtimes/*` | core |
| Sink | `packages/sinks/*` | core |
| Tooling | `packages/tooling/*` | anything, dev only |

- Core never imports an adapter.
- Providers never import runtimes or sinks.
- Runtimes never import providers or sinks.
- Only the Node runtime, tooling and examples may import Node built-ins.
- Only the Cloudflare runtime may import `@cloudflare/*`.
- `packages/core/{schema,otlp,adapter-kit,browser}` carry no runtime dependency.

`pnpm boundaries` is the source of truth. If a rule can be expressed in
`.dependency-cruiser.cjs`, put it there instead of prose.
