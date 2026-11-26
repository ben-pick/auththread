import {
  createMemoryBuffer,
  createMemoryScheduler,
  createStaticSettings,
  journeyCorpus,
  type ProviderAdapter,
  piiCorpus,
  runEndToEndConformance,
  type Sink,
  type SinkBatch,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { encodeSpans } from "@auththread/otlp";
import {
  newTraceId,
  parseSpanId,
  parseTraceId,
  rootSpanId,
  type Span,
  sha256Hex,
  toWideEvent,
} from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { createStitcher, type Stitcher } from "./stitcher.ts";

interface FeedSettings {
  readonly secret: string;
}

const NOW = 1_700_000_000_000;
const traceId = parseTraceId("e5".repeat(16));

const adapter: ProviderAdapter<FeedSettings> = {
  id: "fake",
  capabilities: ["event-feed"],
  authorizeParams: (id) => ({ trace: id }),
  feeds: [
    {
      path: "/feed",
      verify: (request, settings) =>
        request.headers["x-feed-secret"] === settings.secret,
      parse: (body, context) => {
        const logs =
          (body as { logs?: Array<{ id: string; type: string; user: string }> })
            .logs ?? [];
        return logs.map((log) => ({
          id: log.id,
          provider: "fake",
          tenant: "acme",
          type: log.type,
          atMs: NOW,
          hints: { userHash: context.hashUser(log.user) },
          attributes: { "auth.user.hash": context.hashUser(log.user) },
        }));
      },
    },
  ],
  correlate: (event) =>
    event.traceId === undefined
      ? { kind: "hints", hints: event.hints }
      : { kind: "exact", traceId: event.traceId },
  classify: (event) =>
    event.type === "login_failure"
      ? { outcome: "failed", errorCode: "invalid_password" }
      : { outcome: "success" },
};

const tenant: TenantSettings<FeedSettings> = {
  tenant: "acme",
  provider: "fake",
  apiKeyHash: sha256Hex("at_test"),
  salt: "test-salt",
  providerSettings: { secret: "feed-secret" },
};

const captured: SinkBatch[] = [];
const sink: Sink = {
  id: "capture",
  accepts: ["spans", "journey"],
  sampling: { keep: ["all"], successRate: 1 },
  render(journey) {
    return {
      sinkId: "capture",
      journeyId: journey.traceId,
      spans: [journey.root, ...journey.spans],
      wideEvent: toWideEvent(journey),
    };
  },
  async write(batch) {
    captured.push(batch);
  },
};

const spawn = (): Stitcher =>
  createStitcher({
    providers: [adapter],
    buffer: createMemoryBuffer(),
    scheduler: createMemoryScheduler(),
    settings: createStaticSettings([tenant]),
    sinks: [sink],
    quietMs: 1000,
    captureBatches: true,
  });

const span = (
  over: Partial<Span> & Pick<Span, "spanId" | "name" | "startMs">,
): Span => ({
  traceId,
  parentSpanId: rootSpanId(traceId),
  kind: "internal",
  durationMs: 5,
  attributes: { "auth.provider": "fake", "auth.tenant": "acme" },
  status: { code: "unset" },
  events: [],
  ...over,
});

describe("end-to-end conformance", () => {
  it("produces identical journeys for ordered and shuffled delivery", async () => {
    const fixture = journeyCorpus[0];
    if (fixture === undefined) throw new Error("missing fixture");
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
      create: async () => spawn(),
    });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe("stitcher", () => {
  it("joins an event that arrived before any span by hint", async () => {
    const stitcher = spawn();
    await stitcher.ingestEvent(
      {
        id: "evt_before",
        provider: "fake",
        tenant: "acme",
        type: "login_failure",
        atMs: NOW,
        hints: { userHash: "u_alice" },
        attributes: {},
      },
      tenant,
    );

    await stitcher.ingestSpan(
      span({
        spanId: parseSpanId("1111111111111111"),
        name: "auth.app.callback",
        startMs: NOW,
        attributes: {
          "auth.provider": "fake",
          "auth.tenant": "acme",
          "auth.user.hash": "u_alice",
        },
      }),
      tenant,
    );

    await stitcher.runDue(NOW + 5000);
    const batches = stitcher.flush();
    const wide = batches[0]?.wideEvent;
    expect(wide?.outcome).toBe("failed");
    expect(wide?.correlationCounts.inferred).toBe(1);
  });

  it("joins an exact trace event without hints", async () => {
    const stitcher = spawn();
    await stitcher.ingestSpan(
      span({
        spanId: parseSpanId("2222222222222222"),
        name: "auth.app.login_start",
        startMs: NOW,
      }),
      tenant,
    );
    await stitcher.ingestEvent(
      {
        id: "evt_exact",
        provider: "fake",
        tenant: "acme",
        type: "login_success",
        atMs: NOW + 10,
        traceId,
        hints: {},
        attributes: {},
      },
      tenant,
    );

    await stitcher.runDue(NOW + 5000);
    expect(stitcher.flush()[0]?.wideEvent?.outcome).toBe("success");
  });

  it("hashes raw identifiers and keeps them out of the output", async () => {
    const stitcher = spawn();
    await stitcher.ingestSpan(
      span({
        spanId: parseSpanId("3333333333333333"),
        name: "auth.app.login_start",
        startMs: NOW,
        attributes: {
          "auth.provider": "fake",
          "auth.tenant": "acme",
          user_id: "alice@example.com",
        },
      }),
      tenant,
    );
    await stitcher.runDue(NOW + 5000);
    const text = JSON.stringify(stitcher.flush());
    expect(text).not.toContain("alice@example.com");
    expect(text).toContain("u_");
    for (const value of piiCorpus) expect(text).not.toContain(value);
  });

  it("does not finalise before the quiet period when a later span arrives first", async () => {
    const stitcher = spawn();
    const late = span({
      spanId: parseSpanId("7777777777777777"),
      name: "auth.app.login_start",
      startMs: NOW + 1000,
    });
    const early = span({
      spanId: parseSpanId("8888888888888888"),
      name: "auth.ui.screen",
      startMs: NOW,
    });

    await stitcher.ingestSpan(late, tenant);
    await stitcher.ingestSpan(early, tenant);

    await stitcher.runDue(NOW + 1001);
    expect(stitcher.flush()).toHaveLength(0);
    expect(stitcher.stats().finalised).toBe(0);

    await stitcher.runDue(NOW + 3000);
    expect(stitcher.flush()).toHaveLength(1);
  });

  it("survives a sink that throws", async () => {
    const failing = createStitcher({
      providers: [adapter],
      buffer: createMemoryBuffer(),
      scheduler: createMemoryScheduler(),
      settings: createStaticSettings([tenant]),
      sinks: [
        {
          ...sink,
          write: async () => {
            throw new Error("down");
          },
        },
      ],
      quietMs: 1000,
      captureBatches: true,
    });

    await failing.ingestSpan(
      span({
        spanId: parseSpanId("4444444444444444"),
        name: "auth.app.login_start",
        startMs: NOW,
      }),
      tenant,
    );
    await failing.runDue(NOW + 5000);
    expect(failing.stats().writeErrors).toBe(1);
    expect(failing.stats().finalised).toBe(1);
  });
});

describe("http surface", () => {
  const json = (body: unknown, authorization = "Bearer at_test") =>
    new Request("http://stitcher/v1/spans", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rejects a request without a key", async () => {
    const response = await spawn().fetch(
      new Request("http://stitcher/v1/spans", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
  });

  it("ingests an OTLP batch and finalises it", async () => {
    const stitcher = spawn();
    const payload = encodeSpans(
      [
        span({
          spanId: parseSpanId("5555555555555555"),
          name: "auth.app.login_start",
          startMs: NOW,
        }),
      ],
      { serviceName: "example" },
    );

    const response = await stitcher.fetch(json(payload));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: 1 });

    await stitcher.runDue(NOW + 5000);
    expect(stitcher.flush()).toHaveLength(1);
  });

  it("verifies a provider feed before parsing it", async () => {
    const stitcher = spawn();
    const feed = (secret: string) =>
      stitcher.fetch(
        new Request("http://stitcher/v1/providers/fake/feed", {
          method: "POST",
          headers: { authorization: "Bearer at_test", "x-feed-secret": secret },
          body: JSON.stringify({
            logs: [
              { id: "log_1", type: "login_failure", user: "alice@example.com" },
            ],
          }),
        }),
      );

    expect((await feed("wrong")).status).toBe(401);
    const accepted = await feed("feed-secret");
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toEqual({ accepted: 1 });
  });

  it("returns 404 for an unknown route and 405 for the wrong method", async () => {
    const stitcher = spawn();
    const headers = { authorization: "Bearer at_test" };
    expect(
      (
        await stitcher.fetch(
          new Request("http://stitcher/nope", { method: "POST", headers }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await stitcher.fetch(
          new Request("http://stitcher/v1/spans", { method: "GET", headers }),
        )
      ).status,
    ).toBe(405);
  });

  it("answers CORS preflight", async () => {
    const response = await spawn().fetch(
      new Request("http://stitcher/v1/spans", { method: "OPTIONS" }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("abandonment", () => {
  it("marks a quiet journey without a callback as abandoned", async () => {
    const stitcher = spawn();
    const localTrace = newTraceId((length) => new Uint8Array(length).fill(9));
    await stitcher.ingestSpan(
      {
        traceId: localTrace,
        spanId: parseSpanId("6666666666666666"),
        parentSpanId: rootSpanId(localTrace),
        name: "auth.ui.screen",
        kind: "internal",
        startMs: NOW,
        durationMs: 10,
        attributes: {
          "auth.provider": "fake",
          "auth.tenant": "acme",
          "auth.ui.step": "mfa_challenge",
        },
        status: { code: "unset" },
        events: [],
      },
      tenant,
    );
    await stitcher.runDue(NOW + 5000);
    expect(stitcher.flush()[0]?.wideEvent?.outcome).toBe("abandoned");
  });
});
