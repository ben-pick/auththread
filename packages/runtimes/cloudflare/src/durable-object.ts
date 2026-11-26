import type { ProviderAdapter, Sink } from "@auththread/adapter-kit";
import {
  JourneyBuffer,
  Scheduler,
  type SettingsStore,
} from "@auththread/adapter-kit";
import {
  Stitcher,
  type StitcherOptions,
  stitcherLayer,
} from "@auththread/stitcher";
import { Clock, Effect, Layer, ManagedRuntime } from "effect";
import {
  type AlarmScheduler,
  createAlarmScheduler,
  createDurableObjectBuffer,
  type DurableObjectStateLike,
  type DurableObjectStorageLike,
} from "./storage.ts";

export interface JourneyDurableObjectOptions
  extends Omit<StitcherOptions, "providers" | "sinks"> {
  readonly providers: readonly ProviderAdapter<unknown>[];
  readonly sinks: readonly Sink[];
  readonly settings: Layer.Layer<SettingsStore>;
  /** Test seam for the alarm clock. Defaults to the Effect Clock. */
  readonly now?: Effect.Effect<number>;
}

export interface JourneyDurableObjectInstance {
  readonly runtime: ManagedRuntime.ManagedRuntime<Stitcher, never>;
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}

/**
 * Returns the class a Worker exports as its Durable Object. The whole stitcher
 * lives here, so the buffer, the join and the timer share one consistent store.
 */
const FLUSH_RETRY_MS = 60_000;

const report = (
  options: JourneyDurableObjectOptions,
  cause: unknown,
): Effect.Effect<void> =>
  options.onError === undefined
    ? Effect.logError(cause)
    : options.onError(cause);

const flushSinks = (
  options: JourneyDurableObjectOptions,
): Effect.Effect<boolean> =>
  Effect.forEach(
    options.sinks,
    (sink) =>
      (sink.flush ?? Effect.void).pipe(
        Effect.as(true),
        Effect.catchCause((cause) =>
          Effect.andThen(report(options, cause), Effect.succeed(false)),
        ),
      ),
    { concurrency: 1 },
  ).pipe(Effect.map((results) => results.every(Boolean)));

const scheduleFlushRetry = (
  storage: DurableObjectStorageLike,
  nowMs: number,
  options: JourneyDurableObjectOptions,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const retryAt = nowMs + FLUSH_RETRY_MS;
    const getAlarm = storage.getAlarm;
    if (getAlarm !== undefined) {
      const current = yield* Effect.tryPromise({
        try: () => getAlarm.call(storage),
        catch: (cause) => cause,
      });
      if (current !== null && current <= retryAt) return;
    }
    yield* Effect.tryPromise({
      try: () => storage.setAlarm(retryAt),
      catch: (cause) => cause,
    });
  }).pipe(Effect.catchCause((cause) => report(options, cause)));

export const createJourneyDurableObject = (
  options: JourneyDurableObjectOptions,
) => {
  return class JourneyDurableObject implements JourneyDurableObjectInstance {
    readonly runtime: ManagedRuntime.ManagedRuntime<Stitcher, never>;
    readonly storage: DurableObjectStorageLike;

    constructor(state: DurableObjectStateLike) {
      this.storage = state.storage;
      const buffer = createDurableObjectBuffer(state.storage);
      const scheduler: AlarmScheduler = createAlarmScheduler(
        state.storage,
        options.now ?? Clock.currentTimeMillis,
      );

      const layer = stitcherLayer({
        providers: options.providers,
        sinks: options.sinks,
        ...(options.quietMs === undefined ? {} : { quietMs: options.quietMs }),
        ...(options.correlationWindowMs === undefined
          ? {}
          : { correlationWindowMs: options.correlationWindowMs }),
        ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
        ...(options.maxItemsPerTrace === undefined
          ? {}
          : { maxItemsPerTrace: options.maxItemsPerTrace }),
        ...(options.captureBatches === undefined
          ? {}
          : { captureBatches: options.captureBatches }),
        // The alarm flushes sinks. A sleep timer here would keep the object
        // awake between journeys and add idle duration cost.
        flushIntervalMs: options.flushIntervalMs ?? 0,
        ...(options.onError === undefined ? {} : { onError: options.onError }),
        ...(options.now === undefined ? {} : { now: options.now }),
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(JourneyBuffer, buffer),
            Layer.succeed(Scheduler, scheduler),
            options.settings,
          ),
        ),
      );

      this.runtime = ManagedRuntime.make(layer);
    }

    fetch(request: Request): Promise<Response> {
      return this.runtime.runPromise(
        Effect.flatMap(Stitcher, (stitcher) => stitcher.handle(request)),
      );
    }

    alarm(): Promise<void> {
      const storage = this.storage;
      return this.runtime.runPromise(
        Effect.gen(function* () {
          const stitcher = yield* Stitcher;
          const nowMs = yield* options.now ?? Clock.currentTimeMillis;
          yield* stitcher.runDue(nowMs);
          const flushed = yield* flushSinks(options);
          if (!flushed) {
            yield* scheduleFlushRetry(storage, nowMs, options);
          }
        }),
      );
    }
  };
};

export type { ProviderAdapter, Sink };
