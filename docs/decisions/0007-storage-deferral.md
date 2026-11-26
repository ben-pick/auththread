---
id: "0007"
title: "v0.1 ships memory and Durable Object storage only"
scope:
  - "packages/runtimes/**"
---

# 0007. v0.1 ships memory and Durable Object storage only

## Outcome

- The Node runtime buffers in memory and reads settings from a JSON file.
- The Cloudflare runtime buffers in Durable Object storage and fires on alarms.
- Redis, Postgres, SQLite and D1 settings are not implemented.
- Unmatched provider events live in the stitcher process, not in the buffer.

## Rules

- A runtime README states what happens on restart, what happens when the process dies with
  pending events, and how many journeys one instance holds.
- Do not claim a storage backend in the README matrix until its conformance job is green.
- Persisting pending events is the first storage change. A multi-instance Node deployment
  can lose an event that arrives before its span today.

## Why

`PLAN.md` lists Redis and D1 in v0.1. Shipping an unverified Redis adapter would make the
runtime matrix a guess. The memory and Durable Object paths are verified by conformance, so
they ship, and the rest is recorded as deferred rather than implied.
