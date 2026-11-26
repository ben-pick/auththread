---
id: "0005"
title: "Cloudflare runs one Durable Object per tenant in v0.1"
scope:
  - "packages/runtimes/cloudflare/**"
---

# 0005. Cloudflare runs one Durable Object per tenant in v0.1

## Outcome

- `createJourneyDurableObject` returns a class that holds the whole stitcher: buffer,
  scheduler (alarms) and sinks.
- The Worker resolves the API key with `createKeyDirectory` and routes the request to the
  Durable Object named after that tenant.
- Alarms drive finalisation, so there is no queue.
- The object still authenticates the key before ingest. Routing decides where state lives;
  it is not the authorization boundary.

## Rules

- The alert path is the alarm. Nothing finalises on a request thread.
- Storage is only reached through `DurableObjectStorageLike`, so the runtime is testable
  with a fake and portable to another transactional store.
- The key directory is config, built once per isolate. It holds hashes, never raw keys.
- One object per tenant is the target, and the Worker routes to it. Per-journey sharding
  needs a hint directory and is not part of v0.1.

## Why

One object per journey needs a directory that maps hints to traces before a trace ID exists,
and provider feeds arrive without one. One object per tenant is consistent and simple. The
limit is write throughput for a single tenant; per-journey sharding is the v0.2 change once
the hint directory exists.

The Worker could not route by tenant before because it did not authenticate. The key
directory fixes that without a second Durable Object, so routing adds no hop.
