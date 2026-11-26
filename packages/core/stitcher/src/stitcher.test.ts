import {
  journeyCorpus,
  memoryBufferLayer,
  memorySchedulerLayer,
  type ProviderAdapter,
  runEndToEndConformance,
  type Sink,
  type SinkBatch,
  SinkError,
  StitcherUnderTest,
  staticSettingsLayer,
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
import { it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { describe, expect } from "vitest";
import { Stitcher, type StitcherOptions, stitcherLayer } from "./stitcher.ts";

interface FeedSettings {
  readonly secret: string;
}

const NOW = 1_700_000_000_000;
const traceId = parseTraceId("e5".repeat(16));
const USER_HASH = `u_${"a".repeat(16)}`;

const adapter: ProviderAdapter<FeedSettings> = {
  id: "fake",
  capabilities: ["event-feed"],
  authorizeParams: (id) => ({ trace: id }),
  feeds: [
    {
      path: "/feed",
      verify: (request, settings) =>
        Effect.succeed(request.headers["x-feed-secret"] === settings.secret),
      parse: (body, context) =>
        Effect.sync(() => {
          const logs =
            (
              body as {
                logs?: Array<{ id: string; type: string; user: string }>;
              }
            ).logs ?? [];
          return logs.map((log) => ({
            id: log.id,
            provider: "fake",
            tenant: "acme",
            type: log.type,
            atMs: NOW,
            hints: { userHash: context.hashUser(log.user) },
            attributes: { "auth.user.hash": context.hashUser(log.user) },
          }));
        }),
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

const captureSink = (captured: SinkBatch[]): Sink => ({
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
  write: (batch) =>
    Effect.sync(() => {
      captured.push(batch);
    }),
});

const dependencies = Layer.mergeAll(
  memoryBufferLayer,
  memorySchedulerLayer,
  staticSettingsLayer([tenant]),
);

type TestOptions = Partial<StitcherOptions> & { readonly sink?: Sink };

const withStitcher = <A, E>(
  body: (
    stitcher: Stitcher["Service"],
    captured: SinkBatch[],
  ) => Effect.Effect<A, E>,
  options: TestOptions = {},
): Effect.Effect<A, E> => {
  const { sink, ...stitcherOptions } = options;
  const captured: SinkBatch[] = [];
  const layer = stitcherLayer({
    providers: [adapter],
    sinks: [sink ?? captureSink(captured)],
    quietMs: 1000,
    captureBatches: true,
    now: Effect.succeed(NOW),
    ...stitcherOptions,
  }).pipe(Layer.provide(dependencies));

  return Effect.provide(
    Effect.gen(function* () {
      const stitcher = yield* Stitcher;
      return yield* body(stitcher, captured);
    }),
    layer,
  );
};

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

const providerEvent = (
  id: string,
  type: string,
  over: Partial<{
    atMs: number;
    traceId: typeof traceId;
    hints: { userHash?: string };
    attributes: Record<string, string>;
  }> = {},
) => ({
  id,
  provider: "fake",
  tenant: "acme",
  type,
  atMs: over.atMs ?? NOW,
  ...(over.traceId === undefined ? {} : { traceId: over.traceId }),
  hints: over.hints ?? {},
  attributes: over.attributes ?? {},
});

describe("end-to-end conformance", () => {
  it.effect(
    "produces identical journeys for ordered and shuffled delivery",
    () =>
      Effect.gen(function* () {
        const fixture = journeyCorpus[0];
        if (fixture === undefined) throw new Error("missing fixture");

        const layerFor = (quietMs: number) =>
          Layer.effect(
            StitcherUnderTest,
            Effect.map(Stitcher, (stitcher) => ({
              ingestSpan: (span) =>
                stitcher.ingestSpan(span).pipe(Effect.orDie),
              ingestEvent: (event) =>
                stitcher.ingestEvent(event).pipe(Effect.orDie),
              runDue: (nowMs) => stitcher.runDue(nowMs),
              flush: stitcher.flush,
            })),
          ).pipe(
            Layer.provide(
              stitcherLayer({
                providers: [adapter],
                sinks: [captureSink([])],
                quietMs,
                captureBatches: true,
                now: Effect.succeed(NOW),
              }).pipe(Layer.provide(dependencies)),
            ),
          );

        const report = yield* runEndToEndConformance({
          fixture: {
            provider: fixture.provider,
            tenant: fixture.tenant,
            nowMs: fixture.nowMs,
            quietMs: fixture.quietMs,
            spans: fixture.spans,
            events: fixture.events,
            expectedOutcome: fixture.expectedOutcome,
          },
          create: () => layerFor(fixture.quietMs),
        });
        expect(report.failures).toEqual([]);
        expect(report.ok).toBe(true);
      }),
  );
});

describe("stitcher", () => {
  it.effect("joins an event that arrived before any span by hint", () =>
    withStitcher((stitcher, captured) =>
      Effect.gen(function* () {
        yield* stitcher.ingestEvent(
          providerEvent("evt_before", "login_failure", {
            hints: { userHash: USER_HASH },
          }),
          tenant,
        );
        yield* stitcher.ingestSpan(
          span({
            spanId: parseSpanId("1111111111111111"),
            name: "auth.app.callback",
            startMs: NOW,
            attributes: {
              "auth.provider": "fake",
              "auth.tenant": "acme",
              "auth.user.hash": USER_HASH,
            },
          }),
          tenant,
        );

        yield* stitcher.runDue(NOW + 5000);
        const wide = (yield* stitcher.flush)[0]?.wideEvent;
        expect(captured.length).toBe(1);
        expect(wide?.outcome).toBe("failed");
        expect(wide?.correlationCounts.inferred).toBe(1);
      }),
    ),
  );

  it.effect("joins an exact trace event without hints", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        yield* stitcher.ingestSpan(
          span({
            spanId: parseSpanId("2222222222222222"),
            name: "auth.app.login_start",
            startMs: NOW,
          }),
          tenant,
        );
        yield* stitcher.ingestEvent(
          providerEvent("evt_exact", "login_success", {
            atMs: NOW + 10,
            traceId,
          }),
          tenant,
        );

        yield* stitcher.runDue(NOW + 5000);
        expect((yield* stitcher.flush)[0]?.wideEvent?.outcome).toBe("success");
      }),
    ),
  );

  it.effect("hashes raw identifiers and keeps them out of the output", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        yield* stitcher.ingestSpan(
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
        yield* stitcher.runDue(NOW + 5000);
        const text = JSON.stringify(yield* stitcher.flush);
        expect(text).not.toContain("alice@example.com");
        expect(text).toContain("u_");
      }),
    ),
  );

  it.effect(
    "does not finalise before the quiet period when a later span arrives first",
    () =>
      withStitcher((stitcher) =>
        Effect.gen(function* () {
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

          yield* stitcher.ingestSpan(late, tenant);
          yield* stitcher.ingestSpan(early, tenant);

          yield* stitcher.runDue(NOW + 1001);
          expect(yield* stitcher.flush).toHaveLength(0);
          expect((yield* stitcher.stats).finalised).toBe(0);

          yield* stitcher.runDue(NOW + 3000);
          expect(yield* stitcher.flush).toHaveLength(1);
        }),
      ),
  );

  it.effect("joins by transaction exactly when no user hash is shared", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        yield* stitcher.ingestSpan(
          span({
            spanId: parseSpanId("aaaaaaaaaaaaaaaa"),
            name: "auth.app.login_start",
            startMs: NOW,
            attributes: {
              "auth.provider": "fake",
              "auth.tenant": "acme",
              "auth.transaction.id": "tx-1",
            },
          }),
          tenant,
        );
        yield* stitcher.ingestEvent(
          providerEvent("evt_tx", "login_success", {
            atMs: NOW + 10,
            attributes: { "auth.transaction.id": "tx-1" },
          }),
          tenant,
        );

        yield* stitcher.runDue(NOW + 5000);
        const wide = (yield* stitcher.flush)[0]?.wideEvent;
        expect(wide?.outcome).toBe("success");
        expect(wide?.correlationCounts).toEqual({ exact: 1, inferred: 0 });
      }),
    ),
  );

  it.effect("adopts a transaction event that arrived before the span", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        yield* stitcher.ingestEvent(
          providerEvent("evt_pending_tx", "login_failure", {
            attributes: { "auth.transaction.id": "tx-2" },
          }),
          tenant,
        );
        yield* stitcher.ingestSpan(
          span({
            spanId: parseSpanId("bbbbbbbbbbbbbbbb"),
            name: "auth.app.login_start",
            startMs: NOW + 1,
            attributes: {
              "auth.provider": "fake",
              "auth.tenant": "acme",
              "auth.transaction.id": "tx-2",
            },
          }),
          tenant,
        );

        yield* stitcher.runDue(NOW + 5000);
        const wide = (yield* stitcher.flush)[0]?.wideEvent;
        expect(wide?.outcome).toBe("failed");
        expect(wide?.correlationCounts).toEqual({ exact: 1, inferred: 0 });
      }),
    ),
  );

  it.effect(
    "treats a failure and a later success in one transaction as success",
    () =>
      withStitcher((stitcher) =>
        Effect.gen(function* () {
          yield* stitcher.ingestEvent(
            providerEvent("evt_retry_fail", "login_failure", {
              attributes: { "auth.transaction.id": "tx-3" },
            }),
            tenant,
          );
          yield* stitcher.ingestEvent(
            providerEvent("evt_retry_success", "login_success", {
              atMs: NOW + 100,
              attributes: { "auth.transaction.id": "tx-3" },
            }),
            tenant,
          );
          yield* stitcher.ingestSpan(
            span({
              spanId: parseSpanId("cccccccccccccccc"),
              name: "auth.app.login_start",
              startMs: NOW + 200,
              attributes: {
                "auth.provider": "fake",
                "auth.tenant": "acme",
                "auth.transaction.id": "tx-3",
              },
            }),
            tenant,
          );

          yield* stitcher.runDue(NOW + 5000);
          const wide = (yield* stitcher.flush)[0]?.wideEvent;
          expect(wide?.outcome).toBe("success");
          expect(wide?.correlationCounts).toEqual({ exact: 2, inferred: 0 });
        }),
      ),
  );

  it.effect("does not join an event by tenant or client alone", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        yield* stitcher.ingestSpan(
          span({
            spanId: parseSpanId("eeeeeeeeeeeeeeee"),
            name: "auth.app.login_start",
            startMs: NOW,
          }),
          tenant,
        );
        yield* stitcher.ingestEvent(
          providerEvent("evt_no_user", "login_failure", {
            atMs: NOW + 10,
            hints: { userHash: "u_someone_else" },
          }),
          tenant,
        );

        yield* stitcher.runDue(NOW + 5000);
        const wide = (yield* stitcher.flush)[0]?.wideEvent;
        expect(wide?.outcome).toBe("abandoned");
        expect(wide?.correlationCounts).toEqual({ exact: 0, inferred: 0 });
      }),
    ),
  );

  it.effect("refuses a span from another tenant on the same trace", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        yield* stitcher.ingestSpan(
          span({
            spanId: parseSpanId("ffffffffffffffff"),
            name: "auth.app.login_start",
            startMs: NOW,
          }),
          tenant,
        );

        const exit = yield* stitcher
          .ingestSpan(
            span({
              spanId: parseSpanId("abababababababab"),
              name: "auth.app.callback",
              startMs: NOW + 1,
            }),
            { ...tenant, tenant: "globex" },
          )
          .pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }),
    ),
  );

  it.effect("drains in-flight journeys", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        yield* stitcher.ingestSpan(
          span({
            spanId: parseSpanId("dddddddddddddddd"),
            name: "auth.app.login_start",
            startMs: NOW,
          }),
          tenant,
        );

        yield* stitcher.drain;
        const wide = (yield* stitcher.flush)[0]?.wideEvent;
        expect(wide?.outcome).toBe("abandoned");
      }),
    ),
  );

  it.effect("survives a sink that fails", () =>
    withStitcher(
      (stitcher) =>
        Effect.gen(function* () {
          yield* stitcher.ingestSpan(
            span({
              spanId: parseSpanId("4444444444444444"),
              name: "auth.app.login_start",
              startMs: NOW,
            }),
            tenant,
          );
          yield* stitcher.runDue(NOW + 5000);
          expect((yield* stitcher.stats).writeErrors).toBe(1);
          expect((yield* stitcher.stats).finalised).toBe(1);
        }),
      {
        sink: {
          ...captureSink([]),
          write: () =>
            Effect.fail(new SinkError({ sink: "capture", message: "down" })),
        },
      },
    ),
  );
});

describe("http surface", () => {
  const json = (body: unknown, authorization = "Bearer at_test") =>
    new Request("http://stitcher/v1/spans", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it.effect("rejects a request without a key", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        const response = yield* stitcher.handle(
          new Request("http://stitcher/v1/spans", {
            method: "POST",
            body: "{}",
          }),
        );
        expect(response.status).toBe(401);
      }),
    ),
  );

  it.effect("rejects an empty bearer key", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        const response = yield* stitcher.handle(
          new Request("http://stitcher/v1/spans", {
            method: "POST",
            headers: { authorization: "Bearer " },
            body: "{}",
          }),
        );
        expect(response.status).toBe(401);
      }),
    ),
  );

  it.effect("rejects an oversized streamed body with 400", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        const response = yield* stitcher.handle(
          new Request("http://stitcher/v1/spans", {
            method: "POST",
            headers: {
              authorization: "Bearer at_test",
              "content-type": "application/json",
            },
            body: "x".repeat(300 * 1024),
          }),
        );
        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.json())).toMatchObject({
          error: "bad_request",
        });
      }),
    ),
  );

  it.effect("rejects a non-integer OTLP timestamp with 400", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        const payload = encodeSpans(
          [
            span({
              spanId: parseSpanId("9999999999999999"),
              name: "auth.app.login_start",
              startMs: NOW,
            }),
          ],
          { serviceName: "example" },
        );
        const first = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];
        if (first === undefined) throw new Error("missing span");
        first.startTimeUnixNano = "1.5";

        const response = yield* stitcher.handle(json(payload));
        expect(response.status).toBe(400);
      }),
    ),
  );

  it.effect("ingests an OTLP batch and finalises it", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
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

        const response = yield* stitcher.handle(json(payload));
        expect(response.status).toBe(202);
        expect(yield* Effect.promise(() => response.json())).toEqual({
          accepted: 1,
        });

        yield* stitcher.runDue(NOW + 5000);
        expect(yield* stitcher.flush).toHaveLength(1);
      }),
    ),
  );

  it.effect("verifies a provider feed before parsing it", () =>
    withStitcher((stitcher) => {
      const feed = (secret: string) =>
        stitcher.handle(
          new Request("http://stitcher/v1/providers/fake/feed", {
            method: "POST",
            headers: {
              authorization: "Bearer at_test",
              "x-feed-secret": secret,
            },
            body: JSON.stringify({
              logs: [
                {
                  id: "log_1",
                  type: "login_failure",
                  user: "alice@example.com",
                },
              ],
            }),
          }),
        );

      return Effect.gen(function* () {
        expect((yield* feed("wrong")).status).toBe(401);
        const accepted = yield* feed("feed-secret");
        expect(accepted.status).toBe(202);
        expect(yield* Effect.promise(() => accepted.json())).toEqual({
          accepted: 1,
        });
      });
    }),
  );

  it.effect(
    "returns 404 for an unknown route and 405 for the wrong method",
    () =>
      withStitcher((stitcher) =>
        Effect.gen(function* () {
          const headers = { authorization: "Bearer at_test" };
          expect(
            (yield* stitcher.handle(
              new Request("http://stitcher/nope", {
                method: "POST",
                headers,
              }),
            )).status,
          ).toBe(404);
          expect(
            (yield* stitcher.handle(
              new Request("http://stitcher/v1/spans", {
                method: "GET",
                headers,
              }),
            )).status,
          ).toBe(405);
        }),
      ),
  );

  it.effect("answers CORS preflight", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        const response = yield* stitcher.handle(
          new Request("http://stitcher/v1/spans", { method: "OPTIONS" }),
        );
        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
      }),
    ),
  );
});

describe("abandonment", () => {
  it.effect("marks a quiet journey without a callback as abandoned", () =>
    withStitcher((stitcher) =>
      Effect.gen(function* () {
        const localTrace = newTraceId((length) =>
          new Uint8Array(length).fill(9),
        );
        yield* stitcher.ingestSpan(
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
        yield* stitcher.runDue(NOW + 5000);
        expect((yield* stitcher.flush)[0]?.wideEvent?.outcome).toBe(
          "abandoned",
        );
      }),
    ),
  );
});
