import {
  createMemoryBuffer,
  createMemoryScheduler,
  createStaticSettings,
  type JourneyFixture,
  journeyCorpus,
  type Sink,
  type TenantSettings,
} from "@auththread/adapter-kit";
import {
  createAlarmScheduler,
  createDurableObjectBuffer,
  type DurableObjectStorageLike,
} from "@auththread/runtime-cloudflare";
import { sha256Hex, toWideEvent } from "@auththread/schema";
import { createStitcher, type Stitcher } from "@auththread/stitcher";
import { describe, expect, it } from "vitest";

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

const sink: Sink = {
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
};

const memoryStitcher = (fixture: JourneyFixture): Stitcher =>
  createStitcher({
    providers: [],
    buffer: createMemoryBuffer(),
    scheduler: createMemoryScheduler(),
    settings: createStaticSettings([tenant]),
    sinks: [sink],
    quietMs: fixture.quietMs,
    captureBatches: true,
  });

const durableObjectStitcher = (fixture: JourneyFixture): Stitcher => {
  const storage = new FakeStorage();
  return createStitcher({
    providers: [],
    buffer: createDurableObjectBuffer(storage),
    scheduler: createAlarmScheduler(storage, () => fixture.nowMs),
    settings: createStaticSettings([tenant]),
    sinks: [sink],
    quietMs: fixture.quietMs,
    captureBatches: true,
  });
};

const deliver = async (
  stitcher: Stitcher,
  fixture: JourneyFixture,
): Promise<string> => {
  for (const event of [...fixture.events].reverse()) {
    await stitcher.ingestEvent(event, tenant);
  }
  for (const span of [...fixture.spans].reverse()) {
    await stitcher.ingestSpan(span, tenant);
    await stitcher.ingestSpan(span, tenant);
  }
  await stitcher.runDue(fixture.nowMs + fixture.quietMs + 1);
  return JSON.stringify(
    stitcher.flush().sort((a, b) => a.sinkId.localeCompare(b.sinkId)),
  );
};

describe("cross-runtime equality", () => {
  for (const fixture of journeyCorpus) {
    it(`produces identical output on the memory and Durable Object runtimes: ${fixture.name}`, async () => {
      const memory = await deliver(memoryStitcher(fixture), fixture);
      const durableObject = await deliver(
        durableObjectStitcher(fixture),
        fixture,
      );

      expect(memory).toBe(durableObject);
      expect(JSON.parse(memory)).toHaveLength(1);
    });
  }
});
