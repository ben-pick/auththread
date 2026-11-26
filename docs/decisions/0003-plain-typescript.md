---
id: "0003"
title: "Plain TypeScript and the Fetch port for v0.1"
scope:
  - "packages/core/**"
  - "packages/runtimes/**"
---

# 0003. Plain TypeScript and the Fetch port for v0.1

## Outcome

- Every package is plain TypeScript. Effect is permitted by ADR-0002 but not adopted yet.
- The stitcher exposes `fetch(Request): Promise<Response>`. The Node runtime adapts
  `node:http` to that port. The Cloudflare runtime uses it directly.
- Hono and Drizzle are deferred.

## Rules

- Runtime code validates untrusted input at the boundary with explicit decoders in
  `stitcher/src/decode.ts`, not with a schema library.
- Do not add a dependency to the edge zone to get a framework feature.

## Why

The whole surface is one JSON handler with three routes. A Fetch port is smaller than
adopting a framework and keeps Workers, Node, Bun and Deno on the same code path. Effect and
Hono become worth their weight when the stitcher grows persistence, retries and multi-tenant
routing. Adopting either now would be scaffolding for a shape we have not measured.
