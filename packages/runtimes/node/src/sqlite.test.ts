import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  JourneyBuffer,
  journeyCorpus,
  runRuntimeConformance,
  Scheduler,
  SettingsStore,
  type TenantSettings,
} from "@auththread/adapter-kit";
import {
  parseSpanId,
  parseTraceId,
  rootSpanId,
  type Span,
  type TraceId,
} from "@auththread/schema";
import { Stitcher, stitcherLayer } from "@auththread/stitcher";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
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

const settingsLayer = Layer.succeed(SettingsStore, {
  getTenant: () => Effect.succeed(tenant),
});

const stitcherOn = (
  buffer: JourneyBuffer["Service"],
  scheduler: Scheduler["Service"],
  sinks: Parameters<typeof stitcherLayer>[0]["sinks"],
) =>
  stitcherLayer({
    providers: [],
    sinks,
    quietMs: 1000,
    now: Effect.succeed(NOW),
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(JourneyBuffer, buffer),
        Layer.succeed(Scheduler, scheduler),
        settingsLayer,
      ),
    ),
  );

describe("sqlite store", () => {
  it.effect("uses WAL", () =>
    Effect.gen(function* () {
      const path = join(dir(), "state.db");
      yield* createSQLiteStore({ path, autoStart: false });

      const db = new DatabaseSync(path);
      const mode = db.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      };
      db.close();
      expect(mode.journal_mode).toBe("wal");
    }),
  );

  it.effect("passes runtime conformance", () =>
    Effect.gen(function* () {
      const fixture = journeyCorpus[0];
      if (fixture === undefined) throw new Error("missing fixture");

      const store = yield* createSQLiteStore({
        path: join(dir(), "state.db"),
        quietMs: fixture.quietMs,
        autoStart: false,
      });

      const report = yield* runRuntimeConformance({
        buffer: store.buffer,
        scheduler: store.scheduler,
        fixture: {
          traceId: fixture.traceId,
          otherTraceId: parseTraceId("d4".repeat(16)),
          tenant: "acme",
          spans: fixture.spans,
          nowMs: fixture.nowMs,
        },
      });

      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
    }),
  );

  it.effect("recovers an in-flight journey after a restart", () =>
    Effect.gen(function* () {
      const path = join(dir(), "state.db");

      yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* createSQLiteStore({
            path,
            quietMs: 1000,
            autoStart: false,
          });
          yield* first.buffer.append(TRACE, {
            kind: "span",
            id: "span:1111111111111111",
            atMs: NOW,
            span: {
              ...span(TRACE, "1111111111111111", "auth.app.login_start", NOW),
              attributes: { "auth.tenant": "acme" },
            },
          });
          yield* first.buffer.append(TRACE, {
            kind: "span",
            id: "span:2222222222222222",
            atMs: NOW + 100,
            span: {
              ...span(
                TRACE,
                "2222222222222222",
                "auth.app.callback",
                NOW + 100,
                "ok",
              ),
              attributes: { "auth.tenant": "acme" },
            },
          });
        }),
      );

      const captured: Array<{ outcome: string }> = [];
      yield* Effect.scoped(
        Effect.gen(function* () {
          const second = yield* createSQLiteStore({
            path,
            quietMs: 1000,
            autoStart: false,
          });
          yield* Effect.gen(function* () {
            const stitcher = yield* Stitcher;
            yield* stitcher.runDue(NOW + 5000);
            yield* stitcher.flush;
          }).pipe(
            Effect.provide(
              stitcherOn(second.buffer, second.scheduler, [
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
                  write: (batch) =>
                    Effect.sync(() => {
                      if (batch.wideEvent !== undefined) {
                        captured.push({ outcome: batch.wideEvent.outcome });
                      }
                    }),
                },
              ]),
            ),
          );
        }),
      );

      expect(captured).toEqual([{ outcome: "success" }]);
    }),
  );

  it.effect("refuses to append to another tenant's trace", () =>
    Effect.gen(function* () {
      const store = yield* createSQLiteStore({
        path: join(dir(), "state.db"),
        autoStart: false,
      });

      yield* store.buffer.append(TRACE, {
        kind: "span",
        id: "span:1111111111111111",
        atMs: NOW,
        span: {
          ...span(TRACE, "1111111111111111", "auth.app.login_start", NOW),
          attributes: { "auth.tenant": "acme" },
        },
      });

      const error = yield* store.buffer
        .append(TRACE, {
          kind: "span",
          id: "span:2222222222222222",
          atMs: NOW + 1,
          span: {
            ...span(TRACE, "2222222222222222", "auth.app.callback", NOW + 1),
            attributes: { "auth.tenant": "globex" },
          },
        })
        .pipe(Effect.flip);
      expect(String(error.cause)).toContain("another tenant");
    }),
  );
});
