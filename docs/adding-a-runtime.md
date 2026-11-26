# Adding a runtime

A runtime supplies a buffer, a scheduler, settings and a way to serve `Request` to
`Response`. The join logic already lives in `@auththread/stitcher`.

## 1. Implement the three interfaces

```ts
interface JourneyBuffer {
  append(traceId, item): Promise<void>;
  read(traceId): Promise<JourneyItem[]>;
  delete(traceId): Promise<void>;
  indexHints(traceId, hints, atMs): Promise<void>;
  findCandidates(hints, windowMs, nowMs): Promise<TraceId[]>;
  prune(beforeMs): Promise<number>;
}

interface Scheduler {
  schedule(traceId, atMs): Promise<void>;
  cancel(traceId): Promise<void>;
  onDue(handler): void;
  runDue(nowMs): Promise<void>;
}
```

Settings implement `SettingsStore.getTenant(apiKeyHash)`. Hash the key, never store it.

The invariants the suite checks: duplicate appends collapse, concurrent appends to one trace
are safe, hints expire outside the window, a cancelled timer never fires, and prune returns
the number of dropped journeys.

## 2. Serve the Fetch port

`createStitcher` returns `fetch(Request)`. The Node runtime adapts `node:http` to it. A
Cloudflare Durable Object forwards to it directly. Anything with a Fetch handler works.

## 3. Prove it

```ts
const report = await runRuntimeConformance({ buffer, scheduler, fixture });
expect(report.failures).toEqual([]);
```

Then run the end-to-end suite. It delivers the corpus in order, reversed, duplicated and
delayed, and requires byte-identical batches. If your runtime disagrees with the Node
runtime, one of them is wrong.

## 4. Document the limits

State where the buffer lives, what happens on restart, how timers survive a deploy, and how
many journeys one instance can hold. A runtime without that paragraph is not supported.
