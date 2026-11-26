import { journeyCorpus } from "@auththread/adapter-kit";
import { parseTenantConfig } from "@auththread/config";
import { toWideEvent } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import type { JourneyDurableObjectInstance } from "./durable-object.ts";
import type { DurableObjectIdLike } from "./runtime.ts";
import { type CloudflareEnv, createCloudflareRuntime } from "./runtime.ts";
import type { DurableObjectStorageLike } from "./storage.ts";

const fixture = journeyCorpus[0];
if (fixture === undefined) throw new Error("missing fixture");

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

describe("createCloudflareRuntime", () => {
  it("authenticates, routes to the tenant object and finalises", async () => {
    const runtime = createCloudflareRuntime({
      providers: [],
      sinks: () => [
        {
          id: "capture",
          accepts: ["spans"],
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
      quietMs: () => 60_000,
    });

    const config = parseTenantConfig({
      tenants: [
        {
          tenant: "acme",
          provider: "oidc",
          apiKey: "at_test",
          salt: "salt-salt",
        },
      ],
    });
    const source = JSON.stringify(config);
    const objects = new Map<string, JourneyDurableObjectInstance>();
    const env: CloudflareEnv = {
      AUTHTHREAD_TENANTS: source,
      JOURNEY: {
        idFromName: (name: string): DurableObjectIdLike => ({ name }),
        get: (id: DurableObjectIdLike) => ({
          fetch: async (request: Request) => {
            const name = id.name ?? "";
            let instance = objects.get(name);
            if (instance === undefined) {
              instance = new runtime.JourneyDurableObject(
                { storage: new FakeStorage() },
                env,
              );
              objects.set(name, instance);
            }
            return instance.fetch(request);
          },
        }),
      },
    };

    const rejected = await runtime.fetch(
      new Request("https://example.com/v1/spans", {
        method: "POST",
        body: "{}",
      }),
      env,
    );
    expect(rejected.status).toBe(401);

    const accepted = await runtime.fetch(
      new Request("https://example.com/v1/spans", {
        method: "POST",
        headers: {
          authorization: "Bearer at_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
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
                      endTimeUnixNano: String(
                        BigInt(fixture.nowMs) * 1_000_000n,
                      ),
                      attributes: [
                        {
                          key: "auth.provider",
                          value: { stringValue: "oidc" },
                        },
                        {
                          key: "auth.tenant",
                          value: { stringValue: "acme" },
                        },
                      ],
                      status: { code: 0 },
                    },
                  ],
                },
              ],
            },
          ],
        }),
      }),
      env,
    );
    expect(accepted.status).toBe(202);

    const instance = objects.get("acme");
    expect(instance).toBeDefined();
    await instance?.stitcher.runDue(Date.now() + 61_000);
    expect(instance?.stitcher.stats().finalised).toBe(1);
  });

  it("exports a Durable Object class", () => {
    const runtime = createCloudflareRuntime({
      providers: [],
      sinks: () => [],
    });
    expect(typeof runtime.JourneyDurableObject).toBe("function");
  });
});
