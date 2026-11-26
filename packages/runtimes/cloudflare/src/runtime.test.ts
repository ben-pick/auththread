import {
  journeyCorpus,
  runEndToEndConformance,
  runRuntimeConformance,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { sha256Hex, toWideEvent } from "@auththread/schema";
import { describe, expect, it } from "vitest";
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

describe("durable object runtime", () => {
  it("passes runtime conformance", async () => {
    const storage = new FakeStorage();
    const report = await runRuntimeConformance({
      buffer: createDurableObjectBuffer(storage),
      scheduler: createAlarmScheduler(storage, () => fixture.nowMs),
      fixture: {
        traceId: fixture.traceId,
        otherTraceId: "b7".repeat(16) as typeof fixture.traceId,
        spans: fixture.spans,
        nowMs: fixture.nowMs,
      },
    });
    expect(report.failures).toEqual([]);
  });

  it("keeps the earliest alarm across schedules and cancellations", async () => {
    const storage = new FakeStorage();
    const scheduler = createAlarmScheduler(storage, () => fixture.nowMs);
    await scheduler.schedule(fixture.traceId, 300);
    expect(storage.alarmAt).toBe(300);
    await scheduler.schedule("c7".repeat(16) as typeof fixture.traceId, 200);
    expect(storage.alarmAt).toBe(200);
    await scheduler.cancel("c7".repeat(16) as typeof fixture.traceId);
    expect(storage.alarmAt).toBe(300);
  });

  it("finalises a journey from an alarm and exports it", async () => {
    const storage = new FakeStorage();
    let now = fixture.nowMs;
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
          write: async () => undefined,
        },
      ],
      settings: { getTenant: async () => tenant },
      quietMs: 60_000,
      captureBatches: true,
      clock: () => now,
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
                  startTimeUnixNano: String(BigInt(fixture.nowMs) * 1_000_000n),
                  endTimeUnixNano: String(BigInt(fixture.nowMs) * 1_000_000n),
                  attributes: [
                    { key: "auth.provider", value: { stringValue: "oidc" } },
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

    const response = await instance.fetch(
      new Request("https://do/v1/spans", {
        method: "POST",
        headers: {
          authorization: "Bearer at_test",
          "content-type": "application/json",
        },
        body: payload,
      }),
    );
    expect(response.status).toBe(202);
    expect(storage.alarmAt).not.toBeNull();

    now = fixture.nowMs + 61_000;
    await instance.alarm();
    const batches = instance.stitcher.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.wideEvent?.outcome).toBe("abandoned");
    expect(storage.alarmAt).toBeNull();
  });

  it("matches the Node runtime across delivery order", async () => {
    const report = await runEndToEndConformance({
      fixture: {
        provider: fixture.provider,
        tenant: fixture.tenant,
        nowMs: fixture.nowMs,
        quietMs: fixture.quietMs,
        spans: fixture.spans,
        events: fixture.events,
        expectedOutcome: fixture.expectedOutcome,
      },
      create: async () => {
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
              write: async () => undefined,
            },
          ],
          settings: { getTenant: async () => tenant },
          captureBatches: true,
          clock: () => fixture.nowMs,
        });
        return new DurableObject({ storage: new FakeStorage() }).stitcher;
      },
    });
    expect(report.failures).toEqual([]);
  });
});
