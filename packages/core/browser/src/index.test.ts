import { isTraceId, type Span } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { init, type StorageLike } from "./index.ts";

const storage = (): StorageLike & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

const provider = {
  id: "fake",
  authorizeParams: (traceId: string) => ({ ext_trace_id: traceId }),
};

describe("browser SDK", () => {
  it("keeps one trace across the redirect and emits the redirect and callback spans", () => {
    const store = storage();
    const sent: Span[] = [];
    const options = {
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      storage: store,
      send: (body: string) => {
        const parsed = JSON.parse(body) as { spans: Span[] };
        sent.push(...parsed.spans);
      },
    };

    const first = init(options);
    const params = first.authorizeParams();
    expect(params.ext_trace_id).toBe(first.traceId());
    expect(isTraceId(first.traceId())).toBe(true);

    const second = init(options);
    expect(second.traceId()).toBe(first.traceId());

    const result = second.callback(
      "https://app.example.com/callback?code=abc&state=xyz",
    );
    expect(result).toEqual({ ok: true });

    expect(sent.map((span) => span.name)).toEqual([
      "auth.app.login_start",
      "auth.app.callback",
    ]);
    expect(sent[1]?.status.code).toBe("ok");
    expect(sent.every((span) => span.traceId === first.traceId())).toBe(true);
  });

  it("starts a new trace for a second login attempt", () => {
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      storage: storage(),
      send: () => undefined,
    });

    const first = client.authorizeParams();
    const firstTrace = client.traceId();
    expect(first.ext_trace_id).toBe(firstTrace);
    expect(
      client.callback("https://app.example.com/callback?code=abc"),
    ).toEqual({ ok: true });

    const second = client.authorizeParams();
    expect(second.ext_trace_id).not.toBe(firstTrace);
    expect(client.traceId()).toBe(second.ext_trace_id);
  });

  it("keeps the trace across a redirect and rotates a stale pending attempt", () => {
    const store = storage();
    let now = 1000;
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      storage: store,
      now: () => now,
      send: () => undefined,
    });

    const first = client.authorizeParams();
    const again = client.authorizeParams();
    expect(again.ext_trace_id).toBe(first.ext_trace_id);

    now += 16 * 60 * 1000;
    const stale = client.authorizeParams();
    expect(stale.ext_trace_id).not.toBe(first.ext_trace_id);
  });

  it("treats a callback with neither code nor error as a failure", () => {
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      storage: storage(),
      send: () => undefined,
    });

    expect(client.callback("https://app.example.com/callback")).toEqual({
      ok: false,
      error: "missing_code",
    });
  });

  it("records a provider error code", () => {
    const sent: Span[] = [];
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      storage: storage(),
      send: (body: string) => {
        sent.push(...(JSON.parse(body) as { spans: Span[] }).spans);
      },
    });

    expect(
      client.callback("https://app.example.com/callback?error=access_denied"),
    ).toEqual({ ok: false, error: "access_denied" });
    expect(sent[0]?.attributes["auth.error.code"]).toBe("access_denied");
  });

  it("records a token exchange duration and an abandonment step", () => {
    const sent: Span[] = [];
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      storage: storage(),
      now: () => 1000,
      send: (body: string) => {
        sent.push(...(JSON.parse(body) as { spans: Span[] }).spans);
      },
    });

    client.tokenExchange(120);
    client.abandon("verify");
    client.flush();

    expect(sent[0]).toMatchObject({
      name: "auth.app.token_exchange",
      durationMs: 120,
      startMs: 880,
    });
    expect(sent[1]?.attributes["auth.abandoned_at"]).toBe("verify");
  });

  it("batches spans until the size or a flush", () => {
    const batches: Span[][] = [];
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      batchSize: 5,
      storage: storage(),
      setTimer: () => 1,
      clearTimer: () => undefined,
      send: (body: string) => {
        batches.push((JSON.parse(body) as { spans: Span[] }).spans);
      },
    });

    client.tokenExchange(10);
    client.tokenExchange(20);
    client.tokenExchange(30);
    expect(batches).toEqual([]);

    client.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((span) => span.name)).toEqual([
      "auth.app.token_exchange",
      "auth.app.token_exchange",
      "auth.app.token_exchange",
    ]);
  });

  it("tags the journey kind", () => {
    const sent: Span[] = [];
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      kind: "signup",
      storage: storage(),
      send: (body: string) => {
        sent.push(...(JSON.parse(body) as { spans: Span[] }).spans);
      },
    });

    client.authorizeParams();
    expect(sent[0]?.attributes["auth.journey.kind"]).toBe("signup");
  });

  it("survives a send failure", () => {
    const client = init({
      endpoint: "https://stitcher.example.com",
      key: "at_pub",
      tenant: "acme",
      provider,
      storage: storage(),
      send: () => {
        throw new Error("network down");
      },
    });

    expect(() => client.authorizeParams()).not.toThrow();
  });
});
