import { createServer as createNetServer } from "node:net";
import {
  journeyCorpus,
  journeyOf,
  memoryBufferLayer,
  memorySchedulerLayer,
  type Sink,
  staticSettingsLayer,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { sha256Hex, toWideEvent } from "@auththread/schema";
import { stitcherLayer } from "@auththread/stitcher";
import { it } from "@effect/vitest";
import { Duration, Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import { nodeServerLayer } from "./server.ts";

const fixture = journeyCorpus[0];
if (fixture === undefined) throw new Error("missing fixture");

const tenant: TenantSettings = {
  tenant: "acme",
  provider: "oidc",
  apiKeyHash: sha256Hex("at_test"),
  salt: "salt-salt",
  providerSettings: {},
};

const freePort = Effect.tryPromise(
  () =>
    new Promise<number>((resolve, reject) => {
      const server = createNetServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const port =
          typeof address === "object" && address !== null ? address.port : 0;
        server.close(() => resolve(port));
      });
    }),
);

const request = (port: number, path: string, init?: RequestInit) =>
  Effect.tryPromise(() => fetch(`http://127.0.0.1:${port}${path}`, init));

const waitForHealth = (port: number) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = yield* request(port, "/healthz").pipe(
        Effect.map((response) => response.status),
        Effect.orElseSucceed(() => 0),
      );
      if (status === 200) return;
      yield* Effect.sleep(Duration.millis(10));
    }
    return yield* Effect.die(new Error("the node server did not start"));
  });

describe("node server", () => {
  it.live("serves health and one journey over HTTP", () =>
    Effect.gen(function* () {
      const captured: unknown[] = [];
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
        write: (batch) =>
          Effect.sync(() => {
            captured.push(batch.wideEvent);
          }),
      };

      const port = yield* freePort;
      const http = nodeServerLayer({ port, host: "127.0.0.1" }).pipe(
        Layer.provide(
          stitcherLayer({
            providers: [],
            sinks: [sink],
            quietMs: 20,
            captureBatches: true,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                memoryBufferLayer,
                memorySchedulerLayer,
                staticSettingsLayer([tenant]),
              ),
            ),
          ),
        ),
      );

      yield* Effect.forkScoped(Layer.launch(http));
      yield* waitForHealth(port);

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

      const response = yield* request(port, "/v1/spans", {
        method: "POST",
        headers: {
          authorization: "Bearer at_test",
          "content-type": "application/json",
        },
        body: payload,
      });
      expect(response.status).toBe(202);

      yield* Effect.sleep(Duration.millis(700));
      expect(captured.length).toBe(1);
    }),
  );

  it.live("rejects an unknown key over HTTP", () =>
    Effect.gen(function* () {
      const port = yield* freePort;
      const http = nodeServerLayer({ port, host: "127.0.0.1" }).pipe(
        Layer.provide(
          stitcherLayer({ providers: [], sinks: [] }).pipe(
            Layer.provide(
              Layer.mergeAll(
                memoryBufferLayer,
                memorySchedulerLayer,
                staticSettingsLayer([]),
              ),
            ),
          ),
        ),
      );

      yield* Effect.forkScoped(Layer.launch(http));
      yield* waitForHealth(port);

      const response = yield* request(port, "/v1/spans", {
        method: "POST",
        headers: {
          authorization: "Bearer nope",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(response.status).toBe(401);
    }),
  );
});

describe("journeyOf", () => {
  it("builds the corpus", () => {
    expect(journeyCorpus.map(journeyOf).length).toBe(3);
  });
});
