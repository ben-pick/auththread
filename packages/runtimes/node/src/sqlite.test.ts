import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  journeyCorpus,
  runRuntimeConformance,
  type TenantSettings,
} from "@auththread/adapter-kit";
import {
  parseSpanId,
  parseTraceId,
  rootSpanId,
  type Span,
  type TraceId,
} from "@auththread/schema";
import { createStitcher } from "@auththread/stitcher";
import { describe, expect, it } from "vitest";
import { createSQLiteStore } from "./sqlite.ts";

const NOW = 1_700_000_000_000;
const TRACE = parseTraceId("f1".repeat(16));
const tenant: TenantSettings = {
  tenant: "acme",
  provider: "oidc",
  apiKeyHash: "hash",
  salt: "sqlite-test-salt",
  providerSettings: {},
};

const span = (
  traceId: TraceId,
  spanId: string,
  name: string,
  startMs: number,
  status: "unset" | "ok" = "unset",
): Span => ({
  traceId,
  spanId: parseSpanId(spanId),
  parentSpanId: rootSpanId(traceId),
  name,
  kind: "internal",
  startMs,
  durationMs: 10,
  attributes: {},
  status: { code: status },
  events: [],
});

const dir = (): string => mkdtempSync(join(tmpdir(), "auththread-sqlite-"));

describe("sqlite store", () => {
  it("uses WAL", () => {
    const path = join(dir(), "state.db");
    const store = createSQLiteStore({ path, autoStart: false });
    store.close();

    const db = new DatabaseSync(path);
    const mode = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    db.close();
    expect(mode.journal_mode).toBe("wal");
  });

  it("passes runtime conformance", async () => {
    const fixture = journeyCorpus[0];
    if (fixture === undefined) throw new Error("missing fixture");

    const store = createSQLiteStore({
      path: join(dir(), "state.db"),
      quietMs: fixture.quietMs,
      autoStart: false,
    });

    const report = await runRuntimeConformance({
      buffer: store.buffer,
      scheduler: store.scheduler,
      fixture: {
        traceId: fixture.traceId,
        otherTraceId: "d4".repeat(16) as TraceId,
        tenant: "acme",
        spans: fixture.spans,
        nowMs: fixture.nowMs,
      },
    });

    expect(report.failures).toEqual([]);
    expect(report.ok).toBe(true);
    store.close();
  });

  it("recovers an in-flight journey after a restart", async () => {
    const path = join(dir(), "state.db");
    const first = createSQLiteStore({ path, quietMs: 1000, autoStart: false });
    const firstStitcher = createStitcher({
      providers: [],
      buffer: first.buffer,
      scheduler: first.scheduler,
      settings: { getTenant: async () => tenant },
      sinks: [],
      quietMs: 1000,
      clock: { now: () => NOW },
    });

    await firstStitcher.ingestSpan(
      span(TRACE, "1111111111111111", "auth.app.login_start", NOW),
      tenant,
    );
    await firstStitcher.ingestSpan(
      span(TRACE, "2222222222222222", "auth.app.callback", NOW + 100, "ok"),
      tenant,
    );
    first.close();

    const captured: Array<{ outcome: string }> = [];
    const second = createSQLiteStore({ path, quietMs: 1000, autoStart: false });
    const secondStitcher = createStitcher({
      providers: [],
      buffer: second.buffer,
      scheduler: second.scheduler,
      settings: { getTenant: async () => tenant },
      sinks: [
        {
          id: "capture",
          accepts: ["journey"],
          sampling: { keep: ["all"], successRate: 1 },
          render: (journey) => ({
            sinkId: "capture",
            journeyId: journey.traceId,
            wideEvent: {
              schemaVersion: "1",
              event: "auth.journey",
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
          }),
          write: async (batch) => {
            if (batch.wideEvent !== undefined) {
              captured.push({ outcome: batch.wideEvent.outcome });
            }
          },
        },
      ],
      quietMs: 1000,
      clock: { now: () => NOW },
    });

    await secondStitcher.runDue(NOW + 5000);
    secondStitcher.flush();
    second.close();

    expect(captured).toEqual([{ outcome: "success" }]);
  });

  it("refuses to append to another tenant's trace", async () => {
    const store = createSQLiteStore({
      path: join(dir(), "state.db"),
      autoStart: false,
    });

    await store.buffer.append(TRACE, {
      kind: "span",
      id: "span:1111111111111111",
      atMs: NOW,
      span: {
        ...span(TRACE, "1111111111111111", "auth.app.login_start", NOW),
        attributes: { "auth.tenant": "acme" },
      },
    });

    await expect(
      store.buffer.append(TRACE, {
        kind: "span",
        id: "span:2222222222222222",
        atMs: NOW + 1,
        span: {
          ...span(TRACE, "2222222222222222", "auth.app.callback", NOW + 1),
          attributes: { "auth.tenant": "globex" },
        },
      }),
    ).rejects.toThrow("another tenant");

    store.close();
  });
});
