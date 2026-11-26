import {
  journeyCorpus,
  journeyOf,
  runSinkConformance,
} from "@auththread/adapter-kit";
import { describe, expect, it } from "vitest";
import { createWebhookSink, hmacSha256Hex } from "./index.ts";

const journeys = journeyCorpus.map(journeyOf);

describe("webhook sink", () => {
  it("passes sink conformance and signs the body", async () => {
    const requests: Array<{ headers: Record<string, string>; body: string }> =
      [];
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

    const report = await runSinkConformance({ sink, journeys, pii: [] });
    expect(report.failures).toEqual([]);

    const request = requests[0];
    if (request === undefined) throw new Error("no webhook was sent");
    const expected = await hmacSha256Hex("shh", request.body);
    expect(request.headers["x-auththread-signature"]).toBe(
      `sha256=${expected}`,
    );
    expect(request.headers["x-auththread-idempotency-key"]).toBe(
      (JSON.parse(request.body) as { traceId: string }).traceId,
    );
  });

  it("retries once on a server error and then succeeds", async () => {
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
    await sink.write(batch);
    expect(attempts).toBe(2);
  });

  it("does not retry a client error", async () => {
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
    await expect(sink.write(batch)).rejects.toThrow("400");
    expect(attempts).toBe(1);
  });
});
