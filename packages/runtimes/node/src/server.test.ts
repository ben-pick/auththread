import {
  createMemoryBuffer,
  journeyCorpus,
  journeyOf,
  runEndToEndConformance,
  runRuntimeConformance,
} from "@auththread/adapter-kit";
import { sha256Hex, toWideEvent } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { createNodeScheduler } from "./scheduler.ts";
import { createNodeServer } from "./server.ts";

const fixture = journeyCorpus[0];
if (fixture === undefined) throw new Error("missing fixture");

describe("node scheduler", () => {
  it("passes runtime conformance with the memory buffer", async () => {
    const report = await runRuntimeConformance({
      buffer: createMemoryBuffer(),
      scheduler: createNodeScheduler(),
      fixture: {
        traceId: fixture.traceId,
        otherTraceId: "b7".repeat(16) as typeof fixture.traceId,
        spans: fixture.spans,
        nowMs: fixture.nowMs,
      },
    });
    expect(report.failures).toEqual([]);
  });
});

describe("node server", () => {
  const tenant = {
    tenant: "acme",
    provider: "oidc",
    apiKeyHash: sha256Hex("at_test"),
    salt: "salt-salt",
    providerSettings: {},
  };

  it("serves health and one journey over HTTP", async () => {
    const server = createNodeServer({
      providers: [],
      sinks: [
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
      settings: {
        getTenant: async (hash) => (hash === tenant.apiKeyHash ? tenant : null),
      },
      quietMs: 60_000,
      captureBatches: true,
    });

    const { port } = await server.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${port}`;

    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);

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

    const response = await fetch(`${base}/v1/spans`, {
      method: "POST",
      headers: {
        authorization: "Bearer at_test",
        "content-type": "application/json",
      },
      body: payload,
    });
    expect(response.status).toBe(202);

    await server.stitcher.runDue(fixture.nowMs + 61_000);
    server.stitcher.flush();
    expect(server.stitcher.stats().finalised).toBe(1);

    await server.close();
  });

  it("rejects an unknown key over HTTP", async () => {
    const server = createNodeServer({
      providers: [],
      sinks: [],
      settings: { getTenant: async () => null },
    });
    const { port } = await server.listen(0, "127.0.0.1");
    const response = await fetch(`http://127.0.0.1:${port}/v1/spans`, {
      method: "POST",
      headers: {
        authorization: "Bearer nope",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(401);
    await server.close();
  });
});

describe("end-to-end conformance on the node runtime", () => {
  it("matches across delivery order", async () => {
    const tenant = {
      tenant: "acme",
      provider: "oidc",
      apiKeyHash: sha256Hex("at_test"),
      salt: "salt-salt",
      providerSettings: {},
    };
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
        const server = createNodeServer({
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
        });
        return server.stitcher;
      },
    });
    expect(report.failures).toEqual([]);
  });
});

describe("journeyOf", () => {
  it("builds the corpus", () => {
    expect(journeyCorpus.map(journeyOf).length).toBe(3);
  });
});
