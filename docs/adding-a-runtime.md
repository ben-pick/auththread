# Adding a runtime

A runtime supplies a buffer, a scheduler, settings and a way to serve `Request` to
`Response`. The join logic already lives in `@auththread/stitcher`, as Effect services.

## 1. Implement the service contracts

```ts
import { Context, type Effect, type Scope } from "effect";

class JourneyBuffer extends Context.Service<
  JourneyBuffer,
  {
    append(traceId, item): Effect.Effect<void, StorageError>;
    read(traceId): Effect.Effect<JourneyItem[], StorageError>;
    delete(traceId): Effect.Effect<void, StorageError>;
    indexHints(traceId, hints, atMs): Effect.Effect<void, StorageError>;
    findCandidates(hints, windowMs, nowMs): Effect.Effect<TraceId[], StorageError>;
    prune(beforeMs): Effect.Effect<number, StorageError>;
  }
>()("auththread/JourneyBuffer") {}

class Scheduler extends Context.Service<
  Scheduler,
  {
    schedule(traceId, atMs): Effect.Effect<void, StorageError>;
    cancel(traceId): Effect.Effect<void, StorageError>;
    onDue(
      handler: (traceId, nowMs) => Effect.Effect<void, StorageError>,
    ): Effect.Effect<void, never, Scope.Scope>;
    runDue(nowMs): Effect.Effect<void, StorageError>;
  }
>()("auththread/Scheduler") {}
```

Settings implement `SettingsStore.getTenant(apiKeyHash): Effect<TenantSettings | null>`.
Hash the key, never store it. Wrap platform calls with `Effect.tryPromise` and map failures to
`StorageError`.

Provide both services from one `Layer`:

```ts
const sqliteLayer = Layer.effectContext(
  Effect.map(createSQLiteStore(options), (store) =>
    Context.make(JourneyBuffer, store.buffer).pipe(
      Context.add(Scheduler, store.scheduler),
    ),
  ),
);
```

## 2. Serve the routes

`@auththread/stitcher` exports `httpRoutes`, a layer that registers the catch-all route on
Effect's `HttpRouter`. On Node, provide it with `nodeServerLayer`; on Workers, use
`HttpRouter.toWebHandler(httpRoutes.pipe(Layer.provide(stitcherLayer(options))))`.

## 3. Prove it

```ts
const report = yield* runRuntimeConformance({ buffer, scheduler, fixture });
expect(report.failures).toEqual([]);
```

Your runtime must also fire due journeys. Call `stitcher.runDue(now)` from a timer, an
alarm or a worker loop. The Node layer starts a 250 ms poll; the Cloudflare Durable Object
uses its alarm. Without one, journeys never finalise.

Then run the end-to-end suite. It delivers the corpus in order, reversed, duplicated and
delayed, and requires byte-identical batches. If your runtime disagrees with the Node
runtime, one of them is wrong.

## 4. Document the limits

State where the buffer lives, what happens on restart, how timers survive a deploy, and how
many journeys one instance can hold. A runtime without that paragraph is not supported.
