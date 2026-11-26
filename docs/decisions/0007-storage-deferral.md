---
id: "0007"
title: "v0.1 defers Redis, Postgres and D1 storage"
scope:
  - "packages/runtimes/**"
---

# 0007. v0.1 defers Redis, Postgres and D1 storage

## Outcome

- The Node runtime buffers in memory by default and in SQLite when `AUTHTHREAD_DB` is set
  (ADR-0009). Settings come from a JSON file.
- The Cloudflare runtime buffers in Durable Object storage and fires on alarms.
- Redis, Valkey, Postgres and D1 are not implemented.
- Unmatched provider events live in the stitcher process, not in the buffer.

## Rules

- A runtime README states what happens on restart, what happens when the process dies with
  pending events, and how many journeys one instance holds.
- Do not claim a storage backend in the README matrix until its conformance job is green.
- A shared pending store, not another local buffer, is what makes a multi-instance Node
  deployment safe.

## Why

`PLAN.md` lists Redis and D1 in v0.1. Shipping an unverified Redis adapter would make the
runtime matrix a guess. Memory, SQLite and Durable Object storage are verified by conformance,
so they ship, and the rest is recorded as deferred rather than implied.

SQLite answered the restart question for one process. Redis or Valkey is the next step when a
tenant needs more than one writer; Postgres is for settings and multi-instance coordination,
not the journey buffer.
