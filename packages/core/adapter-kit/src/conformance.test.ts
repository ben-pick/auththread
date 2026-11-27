import {
  buildJourney,
  type Journey,
  type ProviderEvent,
  parseTraceId,
  type Span,
  toWideEvent,
  WIDE_EVENT_EVENT_NAME,
  WIDE_EVENT_SCHEMA_VERSION,
} from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import type { StitcherLike } from "./conformance/end-to-end.ts";
import {
  runEndToEndConformance,
  StitcherUnderTest,
} from "./conformance/end-to-end.ts";
import { runProviderConformance } from "./conformance/provider.ts";
import { runRuntimeConformance } from "./conformance/runtime.ts";
import { runSinkConformance } from "./conformance/sink.ts";
import { journeyCorpus, journeyOf, piiCorpus } from "./corpus.ts";
import { memoryBuffer, memoryScheduler } from "./memory.ts";
import type { ProviderAdapter } from "./provider.ts";
import type { Sink } from "./sink.ts";

const fixture = journeyCorpus[0];
if (fixture === undefined) throw new Error("corpus is empty");

const journeys: Journey[] = journeyCorpus.map(journeyOf);

const runtimeFixture = {
  traceId: fixture.traceId,
  otherTraceId: parseTraceId("d4".repeat(16)),
  tenant: "acme",
  spans: fixture.spans,
  nowMs: fixture.nowMs,
};

describe("runtime conformance", () => {
  it.effect("passes for the memory buffer and scheduler", () =>
    Effect.gen(function* () {
      const report = yield* runRuntimeConformance({
        buffer: memoryBuffer(),
        scheduler: memoryScheduler(),
        fixture: runtimeFixture,
      });
      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
    }),
  );

  it.effect("fails a buffer that drops appends", () =>
    Effect.gen(function* () {
      const buffer = memoryBuffer();
      const report = yield* runRuntimeConformance({
        buffer: { ...buffer, append: () => Effect.void },
        scheduler: memoryScheduler(),
        fixture: runtimeFixture,
      });
      expect(report.ok).toBe(false);
      expect(report.failures.join(" ")).toContain(
        "append then read lost an item",
      );
    }),
  );
});

interface Settings {
  readonly secret: string;
}

const fakeAdapter: ProviderAdapter<Settings> = {
  id: "fake",
  capabilities: ["event-feed"],
  authorizeParams: (traceId) => ({ trace: traceId }),
  feeds: [
    {
      path: "/feed",
      verify: (request, settings) =>
        Effect.succeed(request.headers["x-secret"] === settings.secret),
      parse: (body, context) =>
        Effect.sync(() => {
          const logs = (
            body as { logs: Array<{ id: string; user: string; type: string }> }
          ).logs;
          return logs.map(
            (log): ProviderEvent => ({
              id: log.id,
              provider: "fake",
              tenant: "acme",
              type: log.type,
              atMs: fixture.nowMs,
              hints: { userHash: context.hashUser(log.user) },
              attributes: { "auth.user.hash": context.hashUser(log.user) },
            }),
          );
        }),
    },
  ],
  correlate: (event) =>
    event.traceId === undefined
      ? { kind: "hints", hints: event.hints }
      : { kind: "exact", traceId: event.traceId },
  classify: (event) =>
    event.type === "login_failure"
      ? { outcome: "failed", errorCode: "bad" }
      : { outcome: "success" },
};

const providerFixtures = {
  settings: { secret: "s3cret" },
  valid: [
    {
      request: { headers: { "x-secret": "s3cret" } },
      body: {
        logs: [{ id: "1", user: "alice@example.com", type: "login_failure" }],
      },
    },
  ],
  invalid: [{ headers: { "x-secret": "wrong" } }],
  classify: [
    {
      event: {
        id: "e1",
        provider: "fake",
        tenant: "acme",
        type: "login_failure",
        atMs: fixture.nowMs,
        hints: {},
        attributes: {},
      },
      outcome: "failed" as const,
      errorCode: "bad",
    },
  ],
  pii: ["alice@example.com"],
  exact: [
    {
      id: "e2",
      provider: "fake",
      tenant: "acme",
      type: "login_success",
      atMs: fixture.nowMs,
      traceId: fixture.traceId,
      hints: {},
      attributes: {},
    },
  ],
  hints: [
    {
      id: "e3",
      provider: "fake",
      tenant: "acme",
      type: "login_success",
      atMs: fixture.nowMs,
      hints: { userHash: "u_abc" },
      attributes: {},
    },
  ],
};

describe("provider conformance", () => {
  it.effect("passes for a conforming adapter", () =>
    Effect.gen(function* () {
      const report = yield* runProviderConformance(
        fakeAdapter,
        providerFixtures,
      );
      expect(report.failures).toEqual([]);
    }),
  );

  it.effect(
    "fails an adapter that accepts unverified requests and leaks identifiers",
    () =>
      Effect.gen(function* () {
        const broken: ProviderAdapter<Settings> = {
          ...fakeAdapter,
          feeds: [
            {
              path: "/feed",
              verify: () => Effect.succeed(true),
              parse: (body, context) =>
                Effect.gen(function* () {
                  const feed = fakeAdapter.feeds?.[0];
                  const events =
                    feed === undefined ? [] : yield* feed.parse(body, context);
                  return events.map((event) => ({
                    ...event,
                    attributes: {
                      ...event.attributes,
                      "auth.notes": "alice@example.com",
                    },
                  }));
                }),
            },
          ],
        };
        const report = yield* runProviderConformance(broken, providerFixtures);
        expect(report.ok).toBe(false);
        expect(report.failures.join(" ")).toContain(
          "accepted an unverified request",
        );
        expect(report.failures.join(" ")).toContain("raw personal data");
      }),
  );
});

describe("sink conformance", () => {
  const lines: string[] = [];
  const sink: Sink = {
    id: "capture",
    accepts: ["journey"],
    sampling: { keep: ["all"], successRate: 1 },
    render(journey) {
      return {
        sinkId: "capture",
        journeyId: journey.traceId,
        wideEvent: {
          schemaVersion: WIDE_EVENT_SCHEMA_VERSION,
          event: WIDE_EVENT_EVENT_NAME,
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
      };
    },
    write: (batch) =>
      Effect.sync(() => {
        lines.push(JSON.stringify(batch));
      }),
  };

  it.effect("passes for a sink that renders a valid wide event", () =>
    Effect.gen(function* () {
      const report = yield* runSinkConformance({
        sink,
        journeys,
        pii: piiCorpus,
      });
      expect(report.failures).toEqual([]);
      expect(lines.length).toBeGreaterThan(0);
    }),
  );

  it.effect("fails a sink that invents an idempotency key", () =>
    Effect.gen(function* () {
      const broken: Sink = { ...sink, idempotencyKey: () => "random" };
      const report = yield* runSinkConformance({
        sink: broken,
        journeys,
        pii: [],
      });
      expect(report.ok).toBe(false);
    }),
  );
});

describe("journeyOf", () => {
  it("builds deterministic journeys from the corpus", () => {
    const left = journeyCorpus.map(journeyOf);
    const right = journeyCorpus.map(journeyOf);
    expect(left).toEqual(right);
    expect(left.map((journey) => journey.outcome)).toEqual(
      journeyCorpus.map((entry) => entry.expectedOutcome),
    );
  });
});

describe("buildJourney", () => {
  it("keeps the corpus honest", () => {
    const built = buildJourney({
      traceId: fixture.traceId,
      provider: fixture.provider,
      tenant: fixture.tenant,
      spans: fixture.spans,
      events: fixture.events,
    });
    expect(built.outcome).toBe(fixture.expectedOutcome);
  });
});

describe("end-to-end conformance", () => {
  const withEvents = journeyCorpus.find((entry) => entry.events.length > 0);
  if (withEvents === undefined) throw new Error("corpus has no events");

  const droppingStitcher = (): StitcherLike => {
    const spans: Span[] = [];
    let now = 0;
    let flushed = false;
    return {
      ingestSpan: (span) =>
        Effect.sync(() => {
          spans.push(span);
        }),
      ingestEvent: () => Effect.void,
      runDue: (at) =>
        Effect.sync(() => {
          now = at;
        }),
      flush: Effect.sync(() => {
        if (flushed || now < withEvents.nowMs + withEvents.quietMs) return [];
        flushed = true;
        const journey = buildJourney({
          traceId: withEvents.traceId,
          provider: withEvents.provider,
          tenant: withEvents.tenant,
          spans,
          events: [],
        });
        return [
          {
            sinkId: "capture",
            journeyId: journey.traceId,
            spans: [journey.root, ...journey.spans],
            wideEvent: toWideEvent(journey),
          },
        ];
      }),
    };
  };

  it.effect("fails a stitcher that silently drops provider events", () =>
    Effect.gen(function* () {
      const report = yield* runEndToEndConformance({
        fixture: {
          provider: withEvents.provider,
          tenant: withEvents.tenant,
          nowMs: withEvents.nowMs,
          quietMs: withEvents.quietMs,
          spans: withEvents.spans,
          events: withEvents.events,
          expectedOutcome: withEvents.expectedOutcome,
        },
        create: () => Layer.succeed(StitcherUnderTest, droppingStitcher()),
      });

      expect(report.ok).toBe(false);
      expect(report.failures.join(" ")).toContain(
        "provider events were not joined",
      );
    }),
  );
});
