import {
  JourneyBuffer,
  type JourneyFixture,
  journeyCorpus,
  memoryBufferLayer,
  memorySchedulerLayer,
  Scheduler,
  staticSettingsLayer,
  type TenantSettings,
} from "@auththread/adapter-kit";
import {
  createAlarmScheduler,
  createDurableObjectBuffer,
  type DurableObjectStorageLike,
} from "@auththread/runtime-cloudflare";
import { sha256Hex } from "@auththread/schema";
import { Stitcher, stitcherLayer } from "@auththread/stitcher";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";

class FakeStorage implements DurableObjectStorageLike {
  readonly map = new Map<string, unknown>();
  alarmAt: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.map.delete(key);
  }
  async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    const prefix = options.prefix ?? "";
    return new Map(
      [...this.map.entries()].filter(([key]) =>
        key.startsWith(prefix),
      ) as Array<[string, T]>,
    );
  }
  async setAlarm(atMs: number): Promise<void> {
    this.alarmAt = atMs;
  }
  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

const tenant: TenantSettings = {
  tenant: "acme",
  provider: "oidc",
  apiKeyHash: sha256Hex("at_test"),
  salt: "cross-runtime-salt",
  providerSettings: {},
};

const stitcherOn = (
  fixture: JourneyFixture,
  stores: Layer.Layer<JourneyBuffer | Scheduler>,
) =>
  stitcherLayer({
    providers: [],
    sinks: [
      {
        id: "capture",
        accepts: ["spans", "journey"],
        sampling: { keep: ["all"], successRate: 1 },
        render: (journey) => ({
          sinkId: "capture",
          journeyId: journey.traceId,
          spans: [journey.root, ...journey.spans],
          wideEvent: {
            schemaVersion: "1",
            event: "auth.journey",
            traceId: journey.traceId,
            spanId: journey.root.spanId,
            kind: journey.kind,
            outcome: journey.outcome,
            provider: journey.provider,
            tenant: journey.tenant,
            startedAt: new Date(journey.startedAt).toISOString(),
            durationMs: journey.endedAt - journey.startedAt,
            attributes: journey.root.attributes,
            steps: [],
            correlationCounts: { exact: 0, inferred: 0 },
          },
        }),
        write: () => Effect.void,
      },
    ],
    quietMs: fixture.quietMs,
    captureBatches: true,
    now: Effect.succeed(fixture.nowMs),
  }).pipe(Layer.provide(Layer.mergeAll(stores, staticSettingsLayer([tenant]))));

const memoryLayer = (fixture: JourneyFixture) =>
  stitcherOn(fixture, Layer.mergeAll(memoryBufferLayer, memorySchedulerLayer));

const durableObjectLayer = (fixture: JourneyFixture) => {
  const storage = new FakeStorage();
  return stitcherOn(
    fixture,
    Layer.mergeAll(
      Layer.succeed(JourneyBuffer, createDurableObjectBuffer(storage)),
      Layer.succeed(
        Scheduler,
        createAlarmScheduler(storage, Effect.succeed(fixture.nowMs)),
      ),
    ),
  );
};

const deliver = (fixture: JourneyFixture) =>
  Effect.gen(function* () {
    const stitcher = yield* Stitcher;
    for (const event of [...fixture.events].reverse()) {
      yield* stitcher.ingestEvent(event, tenant);
    }
    for (const span of [...fixture.spans].reverse()) {
      yield* stitcher.ingestSpan(span, tenant);
      yield* stitcher.ingestSpan(span, tenant);
    }
    yield* stitcher.runDue(fixture.nowMs + fixture.quietMs + 1);
    const batches = yield* stitcher.flush;
    return {
      text: JSON.stringify(
        [...batches].sort((a, b) => a.sinkId.localeCompare(b.sinkId)),
      ),
      count: batches.length,
    };
  });

describe("cross-runtime equality", () => {
  for (const fixture of journeyCorpus) {
    it.effect(
      `produces identical output on the memory and Durable Object runtimes: ${fixture.name}`,
      () =>
        Effect.gen(function* () {
          const memory = yield* deliver(fixture).pipe(
            Effect.provide(memoryLayer(fixture)),
          );
          const durableObject = yield* deliver(fixture).pipe(
            Effect.provide(durableObjectLayer(fixture)),
          );

          expect(memory.text).toBe(durableObject.text);
          expect(memory.count).toBe(1);
        }),
    );
  }
});
