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
- A Worker forwards requests to one Durable Object per tenant rather than one per journey.
- Alarms drive finalisation, so there is no queue.

## Rules

- The alert path is the alarm. Nothing finalises on a request thread.
- Storage is only reached through `DurableObjectStorageLike`, so the runtime is testable
  with a fake and portable to another transactional store.

## Why

One object per journey needs a directory that maps hints to traces before a trace ID exists,
and provider feeds arrive without one. Shipping a router without that directory would lose
events. One object per tenant is consistent and simple. The limit is write throughput for a
single tenant; per-journey sharding is the v0.2 change once the hint directory exists.
