import { journeyCorpus } from "@auththread/adapter-kit";
import { parseTenantConfig } from "@auththread/config";
import { toWideEvent } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { createNodeRuntime } from "./runtime.ts";

const fixture = journeyCorpus[0];
if (fixture === undefined) throw new Error("missing fixture");

describe("createNodeRuntime", () => {
  it("builds a runtime from shared config and finalises a journey", async () => {
    const runtime = createNodeRuntime({
      config: parseTenantConfig({
        tenants: [
          {
            tenant: "acme",
            provider: "oidc",
            apiKey: "at_test",
            salt: "salt-salt",
          },
        ],
      }),
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
      quietMs: 60_000,
      captureBatches: true,
    });

    const { port } = await runtime.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${port}`;

    const response = await fetch(`${base}/v1/spans`, {
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
      }),
    });
    expect(response.status).toBe(202);

    await runtime.stitcher.runDue(Date.now() + 61_000);
    expect(runtime.stitcher.stats().finalised).toBe(1);
    await runtime.close();
  });

  it("rejects a bad key", async () => {
    const runtime = createNodeRuntime({
      config: parseTenantConfig({
        tenants: [
          {
            tenant: "acme",
            provider: "oidc",
            apiKey: "at_test",
            salt: "salt-salt",
          },
        ],
      }),
      providers: [],
      sinks: [],
    });
    const { port } = await runtime.listen(0, "127.0.0.1");
    const response = await fetch(`http://127.0.0.1:${port}/v1/spans`, {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    await runtime.close();
  });
});
