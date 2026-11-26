import {
  buildJourney,
  type Journey,
  type ProviderEvent,
  parseTraceId,
  type Span,
  toWideEvent,
} from "@auththread/schema";
import { describe, expect, it } from "vitest";
import type { StitcherLike } from "./conformance/end-to-end.ts";
import { runEndToEndConformance } from "./conformance/end-to-end.ts";
import { runProviderConformance } from "./conformance/provider.ts";
import { runRuntimeConformance } from "./conformance/runtime.ts";
import { runSinkConformance } from "./conformance/sink.ts";
import { journeyCorpus, journeyOf, piiCorpus } from "./corpus.ts";
import { createMemoryBuffer, createMemoryScheduler } from "./memory.ts";
import type { ProviderAdapter } from "./provider.ts";
import type { Sink } from "./sink.ts";

const fixture = journeyCorpus[0];
if (fixture === undefined) throw new Error("corpus is empty");

const journeys: Journey[] = journeyCorpus.map(journeyOf);

describe("runtime conformance", () => {
  it("passes for the memory buffer and scheduler", async () => {
    const report = await runRuntimeConformance({
      buffer: createMemoryBuffer(),
      scheduler: createMemoryScheduler(),
      fixture: {
        traceId: fixture.traceId,
        otherTraceId: parseTraceId("d4".repeat(16)),
        spans: fixture.spans,
        nowMs: fixture.nowMs,
      },
    });
    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("fails a buffer that drops appends", async () => {
    const buffer = createMemoryBuffer();
    const report = await runRuntimeConformance({
      buffer: { ...buffer, append: async () => undefined },
      scheduler: createMemoryScheduler(),
      fixture: {
        traceId: fixture.traceId,
        otherTraceId: parseTraceId("d4".repeat(16)),
        spans: fixture.spans,
        nowMs: fixture.nowMs,
      },
    });
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain(
      "append then read lost an item",
    );
  });
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
        request.headers["x-secret"] === settings.secret,
      parse: (body, context) => {
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
      },
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
  it("passes for a conforming adapter", async () => {
    const report = await runProviderConformance(fakeAdapter, providerFixtures);
    expect(report.failures).toEqual([]);
  });

  it("fails an adapter that accepts unverified requests and leaks identifiers", async () => {
    const broken: ProviderAdapter<Settings> = {
      ...fakeAdapter,
      feeds: [
        {
          path: "/feed",
          verify: () => true,
          parse: (body, context) => {
            const events = fakeAdapter.feeds?.[0]?.parse(body, context) ?? [];
            return events.map((event) => ({
              ...event,
              attributes: {
                ...event.attributes,
                "auth.notes": "alice@example.com",
              },
            }));
          },
        },
      ],
    };
    const report = await runProviderConformance(broken, providerFixtures);
    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain(
      "accepted an unverified request",
    );
    expect(report.failures.join(" ")).toContain("raw personal data");
  });
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
          schemaVersion: "1",
          event: "auth.journey",
          traceId: journey.traceId,
          spanId: journey.root.spanId,
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
    async write(batch) {
      lines.push(JSON.stringify(batch));
    },
  };

  it("passes for a sink that renders a valid wide event", async () => {
    const report = await runSinkConformance({ sink, journeys, pii: piiCorpus });
    expect(report.failures).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("fails a sink that invents an idempotency key", async () => {
    const broken: Sink = { ...sink, idempotencyKey: () => "random" };
    const report = await runSinkConformance({
      sink: broken,
      journeys,
      pii: [],
    });
    expect(report.ok).toBe(false);
  });
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
      async ingestSpan(span) {
        spans.push(span);
      },
      async ingestEvent() {
        // Silently drops provider events.
      },
      async runDue(at) {
        now = at;
      },
      flush() {
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
      },
    };
  };

  it("fails a stitcher that silently drops provider events", async () => {
    const report = await runEndToEndConformance({
      fixture: {
        provider: withEvents.provider,
        tenant: withEvents.tenant,
        nowMs: withEvents.nowMs,
        quietMs: withEvents.quietMs,
        spans: withEvents.spans,
        events: withEvents.events,
        expectedOutcome: withEvents.expectedOutcome,
      },
      create: async () => droppingStitcher(),
    });

    expect(report.ok).toBe(false);
    expect(report.failures.join(" ")).toContain(
      "provider events were not joined",
    );
  });
});
