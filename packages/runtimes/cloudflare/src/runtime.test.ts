import {
  journeyCorpus,
  runEndToEndConformance,
  runRuntimeConformance,
  StitcherUnderTest,
  StorageError,
  staticSettingsLayer,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { sha256Hex, toWideEvent } from "@auththread/schema";
import { Stitcher } from "@auththread/stitcher";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { createJourneyDurableObject } from "./durable-object.ts";
import {
  createAlarmScheduler,
  createDurableObjectBuffer,
  type DurableObjectStorageLike,
} from "./storage.ts";

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
  async getAlarm(): Promise<number | null> {
    return this.alarmAt;
  }
  async setAlarm(atMs: number): Promise<void> {
    this.alarmAt = atMs;
  }
  async deleteAlarm(): Promise<void> {
    this.alarmAt = null;
  }
}

const fixture = journeyCorpus[0];
if (fixture === undefined) throw new Error("missing fixture");

const tenant: TenantSettings = {
  tenant: "acme",
  provider: "oidc",
  apiKeyHash: sha256Hex("at_test"),
  salt: "salt-salt",
  providerSettings: {},
};

const settingsLayer = staticSettingsLayer([tenant]);

describe("durable object runtime", () => {
  it.effect("passes runtime conformance", () =>
    Effect.gen(function* () {
      const storage = new FakeStorage();
      const report = yield* runRuntimeConformance({
        buffer: createDurableObjectBuffer(storage),
        scheduler: createAlarmScheduler(storage, Effect.succeed(fixture.nowMs)),
        fixture: {
          traceId: fixture.traceId,
          otherTraceId: "b7".repeat(16) as typeof fixture.traceId,
          tenant: "acme",
          spans: fixture.spans,
          nowMs: fixture.nowMs,
        },
      });
      expect(report.failures).toEqual([]);
    }),
  );

  it.effect("keeps the earliest alarm across schedules and cancellations", () =>
    Effect.gen(function* () {
      const storage = new FakeStorage();
      const scheduler = createAlarmScheduler(
        storage,
        Effect.succeed(fixture.nowMs),
      );
      yield* scheduler.schedule(fixture.traceId, 300);
      expect(storage.alarmAt).toBe(300);
      yield* scheduler.schedule("c7".repeat(16) as typeof fixture.traceId, 200);
      expect(storage.alarmAt).toBe(200);
      yield* scheduler.schedule("d7".repeat(16) as typeof fixture.traceId, 400);
      expect(storage.alarmAt).toBe(200);
      yield* scheduler.cancel("c7".repeat(16) as typeof fixture.traceId);
      expect(storage.alarmAt).toBe(300);
    }),
  );

  it.effect(
    "keeps a deadline when its handler fails so the alarm can retry",
    () =>
      Effect.gen(function* () {
        const storage = new FakeStorage();
        const scheduler = createAlarmScheduler(
          storage,
          Effect.succeed(fixture.nowMs),
        );
        yield* scheduler.schedule(fixture.traceId, 500);
        yield* scheduler.onDue(() =>
          Effect.fail(
            new StorageError({
              operation: "sink",
              cause: new Error("sink unavailable"),
            }),
          ),
        );

        const error = yield* scheduler.runDue(fixture.nowMs).pipe(Effect.flip);
        expect(error.operation).toBe("sink");
        expect(String(error.cause)).toContain("sink unavailable");
        expect(storage.map.has(`a:${fixture.traceId}`)).toBe(true);
        expect(storage.alarmAt).toBe(500);
      }),
  );

  it.effect("finalises a journey from an alarm and exports it", () =>
    Effect.gen(function* () {
      const storage = new FakeStorage();
      let now = fixture.nowMs;
      let flushes = 0;
      const DurableObject = createJourneyDurableObject({
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
              wideEvent: toWideEvent(journey),
            }),
            write: () => Effect.void,
            flush: Effect.sync(() => {
              flushes += 1;
            }),
          },
        ],
        settings: settingsLayer,
        quietMs: 60_000,
        captureBatches: true,
        now: Effect.sync(() => now),
      });
      const instance = new DurableObject({ storage });

      const payload = JSON.stringify({
        resourceSpans: [
          {
            resource: { attributes: [] },
            scopeSpans: [
              {
                scope: { name: "test" },
                spans: [
                  {
                    traceId: fixture.traceId,
                    spanId: "1111111111111111",
                    name: "auth.app.login_start",
                    kind: 1,
                    startTimeUnixNano: String(
                      BigInt(fixture.nowMs) * 1_000_000n,
                    ),
                    endTimeUnixNano: String(BigInt(fixture.nowMs) * 1_000_000n),
                    attributes: [
                      {
                        key: "auth.provider",
                        value: { stringValue: "oidc" },
                      },
                      { key: "auth.tenant", value: { stringValue: "acme" } },
                    ],
                    status: { code: 0 },
                  },
                ],
              },
            ],
          },
        ],
      });

      const response = yield* Effect.promise(() =>
        instance.fetch(
          new Request("https://do/v1/spans", {
            method: "POST",
            headers: {
              authorization: "Bearer at_test",
              "content-type": "application/json",
            },
            body: payload,
          }),
        ),
      );
      expect(response.status).toBe(202);
      expect(storage.alarmAt).not.toBeNull();

      now = fixture.nowMs + 61_000;
      yield* Effect.promise(() => instance.alarm());
      const batches = yield* Effect.promise(() =>
        instance.runtime.runPromise(
          Effect.flatMap(Stitcher, (stitcher) => stitcher.flush),
        ),
      );
      expect(batches).toHaveLength(1);
      expect(batches[0]?.wideEvent?.outcome).toBe("abandoned");
      expect(storage.alarmAt).toBeNull();
      expect(flushes).toBeGreaterThan(0);
    }),
  );

  it.effect("matches the Node runtime across delivery order", () =>
    Effect.gen(function* () {
      const layerFor = () => {
        const storage = new FakeStorage();
        const DurableObject = createJourneyDurableObject({
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
                wideEvent: toWideEvent(journey),
              }),
              write: () => Effect.void,
            },
          ],
          settings: settingsLayer,
          captureBatches: true,
          now: Effect.succeed(fixture.nowMs),
        });
        const instance = new DurableObject({ storage });

        return Layer.succeed(StitcherUnderTest, {
          ingestSpan: (span) =>
            Effect.promise(() =>
              instance.runtime.runPromise(
                Effect.flatMap(Stitcher, (stitcher) =>
                  stitcher.ingestSpan(span).pipe(Effect.orDie),
                ),
              ),
            ),
          ingestEvent: (event) =>
            Effect.promise(() =>
              instance.runtime.runPromise(
                Effect.flatMap(Stitcher, (stitcher) =>
                  stitcher.ingestEvent(event).pipe(Effect.orDie),
                ),
              ),
            ),
          runDue: (nowMs) =>
            Effect.promise(() =>
              instance.runtime.runPromise(
                Effect.flatMap(Stitcher, (stitcher) => stitcher.runDue(nowMs)),
              ),
            ),
          flush: Effect.promise(() =>
            instance.runtime.runPromise(
              Effect.flatMap(Stitcher, (stitcher) => stitcher.flush),
            ),
          ),
        });
      };

      const report = yield* runEndToEndConformance({
        fixture: {
          provider: fixture.provider,
          tenant: fixture.tenant,
          nowMs: fixture.nowMs,
          quietMs: fixture.quietMs,
          spans: fixture.spans,
          events: fixture.events,
          expectedOutcome: fixture.expectedOutcome,
        },
        create: layerFor,
      });
      expect(report.failures).toEqual([]);
    }),
  );
});
