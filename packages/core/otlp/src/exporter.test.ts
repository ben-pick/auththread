import { parseSpanId, parseTraceId, type Span } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import {
  createBatchExporter,
  createBeaconExporter,
  createOtlpExporter,
} from "./exporter.ts";

const span: Span = {
  traceId: parseTraceId("a".repeat(32)),
  spanId: parseSpanId("b".repeat(16)),
  parentSpanId: null,
  name: "auth.journey",
  kind: "internal",
  startMs: 1,
  durationMs: 1,
  attributes: {},
  status: { code: "ok" },
  events: [],
};

describe("createOtlpExporter", () => {
  it("retries a retryable status once", async () => {
    const calls: string[] = [];
    const exporter = createOtlpExporter({
      endpoint: "https://collector/v1/traces",
      serviceName: "auththread",
      fetchImpl: (async (_url, init) => {
        calls.push(String(init?.body));
        return calls.length === 1
          ? new Response("{}", { status: 503 })
          : new Response("{}", { status: 200 });
      }) as typeof fetch,
    });

    await expect(exporter.export([span])).resolves.toEqual({
      ok: true,
      statusCode: 200,
    });
    expect(calls).toHaveLength(2);
  });

  it("does not retry a client error", async () => {
    let calls = 0;
    const exporter = createOtlpExporter({
      endpoint: "https://collector/v1/traces",
      serviceName: "auththread",
      fetchImpl: (async () => {
        calls++;
        return new Response("{}", { status: 400 });
      }) as typeof fetch,
    });

    const result = await exporter.export([span]);
    expect(result.ok).toBe(false);
    expect(calls).toBe(1);
  });

  it("reports a network failure without throwing", async () => {
    const exporter = createOtlpExporter({
      endpoint: "https://collector/v1/traces",
      serviceName: "auththread",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as typeof fetch,
    });

    await expect(exporter.export([span])).resolves.toEqual({
      ok: false,
      reason: "connection refused",
    });
  });

  it("sends nothing for an empty batch", async () => {
    let calls = 0;
    const exporter = createOtlpExporter({
      endpoint: "https://collector/v1/traces",
      serviceName: "auththread",
      fetchImpl: (async () => {
        calls++;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await exporter.export([]);
    expect(calls).toBe(0);
  });
});

describe("createBatchExporter", () => {
  it("flushes when the batch is full", async () => {
    const batches: number[] = [];
    const exporter = createBatchExporter({
      maxSpans: 2,
      exporter: {
        async export(spans) {
          batches.push(spans.length);
          return { ok: true };
        },
      },
    });

    exporter.enqueue(span);
    exporter.enqueue(span);
    await exporter.flush();
    expect(batches).toEqual([2]);
  });

  it("flushes on the timer and on shutdown", async () => {
    const batches: number[] = [];
    const timers: Array<() => void> = [];
    const exporter = createBatchExporter({
      maxSpans: 10,
      flushIntervalMs: 50,
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimer: () => undefined,
      exporter: {
        async export(spans) {
          batches.push(spans.length);
          return { ok: true };
        },
      },
    });

    exporter.enqueue(span);
    expect(batches).toEqual([]);
    timers[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(batches).toEqual([1]);

    exporter.enqueue(span);
    await exporter.shutdown();
    expect(batches).toEqual([1, 1]);
  });
});

describe("createBeaconExporter", () => {
  it("posts the encoded spans through sendBeacon", async () => {
    let sent: Blob | undefined;
    const exporter = createBeaconExporter({
      endpoint: "https://stitcher/v1/spans",
      serviceName: "auththread-web",
      sendBeacon: (_url, data) => {
        sent = data;
        return true;
      },
    });

    await expect(exporter.export([span])).resolves.toEqual({ ok: true });
    if (sent === undefined) throw new Error("sendBeacon was not called");
    const payload = JSON.parse(await sent.text()) as {
      resourceSpans: unknown[];
    };
    expect(payload.resourceSpans).toHaveLength(1);
  });
});
