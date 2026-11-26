---
id: "0011"
title: "Runtime kit plus platform deployment artifacts"
scope:
  - "packages/sdk/**"
  - "packages/runtimes/**"
  - "apps/**"
  - "templates/**"
  - "examples/local-compose/**"
---

# 0011. Runtime kit plus platform deployment artifacts

## Outcome

- The neutral core is `schema`, `adapter-kit`, `config`, `stitcher` and `sdk`.
- A platform adapter supplies a buffer, scheduler and HTTP host. Node and
  Cloudflare are the supported adapters in v0.1.
- `@auththread/sdk` exposes `./node` and `./cloudflare` subpaths. The browser
  SDK stays separate.
- Deployment artifacts are separate from the package graph: a bundled Node
  image, a local Docker Compose demo, and a Cloudflare Worker template. They
  consume the install contract, not package internals.

## Rules

- Core never imports a runtime. Runtimes never import providers or sinks.
- A runtime entrypoint composes providers, sinks and settings from shared
  config; examples are demos, not the canonical entrypoint.
- IaC and templates do not enter the pnpm workspace dependency graph.
- Public Terraform and Pulumi packages are extracted into their own repos when
  they are published; a monorepo subdirectory is not a registry package.
- A platform is supported only when its composed runtime passes the runtime
  conformance suite, not just the buffer and scheduler primitives.

## Why

The stitcher already has the right portability boundary: a Fetch handler plus
`JourneyBuffer`, `Scheduler` and `SettingsStore`. The missing layer was
composition. Keeping composition in `examples/*` would make every deployment
artifact a fork. A small SDK facade and explicit runtime entrypoints keep the
core neutral while letting Docker, Cloudflare and future IaC embed the same
behavior.
