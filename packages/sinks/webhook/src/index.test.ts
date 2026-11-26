import {
  journeyCorpus,
  journeyOf,
  runSinkConformance,
} from "@auththread/adapter-kit";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import { createWebhookSink, hmacSha256Hex } from "./index.ts";

const journeys = journeyCorpus.map(journeyOf);

const TraceIdBody = Schema.Struct({ traceId: Schema.String });

describe("webhook sink", () => {
  it.effect("passes sink conformance and signs the body", () =>
    Effect.gen(function* () {
      const requests: Array<{
        headers: Record<string, string>;
        body: string;
      }> = [];
      const sink = createWebhookSink({
        url: "https://hooks.example.com/auth",
        secret: "shh",
        sampling: { keep: ["all"], successRate: 1 },
        fetchImpl: (async (_url, init) => {
          const headers = Object.fromEntries(
            new Headers(init?.headers).entries(),
          );
          requests.push({ headers, body: String(init?.body) });
          return new Response(null, { status: 200 });
        }) as typeof fetch,
      });

      const report = yield* runSinkConformance({ sink, journeys, pii: [] });
      expect(report.failures).toEqual([]);

      const request = requests[0];
      if (request === undefined) throw new Error("no webhook was sent");
      const expected = yield* Effect.promise(() =>
        hmacSha256Hex("shh", request.body),
      );
      expect(request.headers["x-auththread-signature"]).toBe(
        `sha256=${expected}`,
      );
      const body = yield* Effect.fromResult(
        Schema.decodeUnknownResult(Schema.fromJsonString(TraceIdBody))(
          request.body,
        ),
      );
      expect(request.headers["x-auththread-idempotency-key"]).toBe(
        body.traceId,
      );
    }),
  );

  it.effect("retries once on a server error and then succeeds", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const sink = createWebhookSink({
        url: "https://hooks.example.com/auth",
        secret: "shh",
        retries: 1,
        sampling: { keep: ["all"], successRate: 1 },
        fetchImpl: (async () => {
          attempts++;
          return new Response(null, { status: attempts === 1 ? 503 : 200 });
        }) as typeof fetch,
      });

      const journey = journeys[0];
      if (journey === undefined) throw new Error("missing journey");
      const batch = sink.render(journey);
      if (batch === null) throw new Error("expected a batch");
      yield* sink.write(batch);
      expect(attempts).toBe(2);
    }),
  );

  it.effect("does not retry a client error", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const sink = createWebhookSink({
        url: "https://hooks.example.com/auth",
        secret: "shh",
        retries: 3,
        sampling: { keep: ["all"], successRate: 1 },
        fetchImpl: (async () => {
          attempts++;
          return new Response(null, { status: 400 });
        }) as typeof fetch,
      });

      const journey = journeys[0];
      if (journey === undefined) throw new Error("missing journey");
      const batch = sink.render(journey);
      if (batch === null) throw new Error("expected a batch");
      const error = yield* sink.write(batch).pipe(Effect.flip);
      expect(error.message).toContain("400");
      expect(attempts).toBe(1);
    }),
  );
});
