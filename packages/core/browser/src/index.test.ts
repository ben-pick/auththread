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
      "https://app.example.com/callback?error=access_denied",
    );
    expect(result).toEqual({ ok: false, error: "access_denied" });

    expect(sent.map((span) => span.name)).toEqual([
      "auth.app.login_start",
      "auth.app.callback",
    ]);
    expect(sent[1]?.status.code).toBe("error");
    expect(sent[1]?.attributes["auth.error.code"]).toBe("access_denied");
    expect(sent.every((span) => span.traceId === first.traceId())).toBe(true);
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
    client.abandon("mfa_challenge");

    expect(sent[0]).toMatchObject({
      name: "auth.app.token_exchange",
      durationMs: 120,
      startMs: 880,
    });
    expect(sent[1]?.attributes["auth.abandoned_at"]).toBe("mfa_challenge");
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
