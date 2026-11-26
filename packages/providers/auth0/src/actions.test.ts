import { describe, expect, it, vi } from "vitest";
import { withTrace } from "./actions.ts";

const TRACE = "a1".repeat(16);

describe("withTrace", () => {
  it("returns the handler result unchanged and records the decision", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const calls: Array<{ name: string; version: string }> = [];
    const wrapped = withTrace(
      { name: "deny-unverified", version: "v3" },
      async (
        event: { name: string; request: { query: Record<string, string> } },
        api: { access: { deny: (code?: string, message?: string) => void } },
      ) => {
        calls.push({
          name: event.name,
          version:
            typeof api.access.deny === "function" ? "has-deny" : "no-deny",
        });
        api.access.deny("access_denied", "email not verified");
        return "done";
      },
    );

    const result = await wrapped(
      { name: "event", request: { query: { ext_trace_id: TRACE } } },
      { access: { deny: () => undefined } },
    );

    expect(result).toBe("done");
    expect(calls).toEqual([{ name: "event", version: "has-deny" }]);
    const line = log.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toMatchObject({
      event: "auth.hook",
      traceId: TRACE,
      decision: "deny",
      hook: { name: "deny-unverified", version: "v3" },
    });
    log.mockRestore();
  });

  it("rethrows the handler error unchanged", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const boo = new Error("boom");
    const wrapped = withTrace({ name: "x", version: "1" }, () => {
      throw boo;
    });

    await expect(wrapped({}, {})).rejects.toBe(boo);
    vi.restoreAllMocks();
  });

  it("posts one hook span and never throws when the stitcher is down", async () => {
    const bodies: string[] = [];
    const wrapped = withTrace(
      {
        name: "enrich-profile",
        version: "v7",
        transport: "http",
        endpoint: "https://stitcher.example.com/",
        token: "at_test",
        fetchImpl: (async (_url, init) => {
          bodies.push(String(init?.body));
          throw new Error("down");
        }) as typeof fetch,
      },
      async (
        _event: unknown,
        api: {
          idToken: { setCustomClaim: (name: string, value: unknown) => void };
        },
      ) => {
        api.idToken.setCustomClaim("https://x/roles", ["admin"]);
        return "ok";
      },
    );

    await expect(
      wrapped(
        { request: { query: { ext_trace_id: TRACE } } },
        { idToken: { setCustomClaim: () => undefined } },
      ),
    ).resolves.toBe("ok");

    const body = JSON.parse(bodies[0] ?? "{}") as {
      spans: Array<{ attributes: Record<string, unknown>; name: string }>;
    };
    expect(body.spans[0]?.name).toBe("auth.hook.execute");
    expect(body.spans[0]?.attributes).toMatchObject({
      "auth.hook.name": "enrich-profile",
      "auth.hook.version": "v7",
      "auth.hook.stage": "post_auth",
      "auth.hook.decision": "continue",
      "auth.hook.claims_set": ["https://x/roles"],
    });
  });

  it("uses the configured stage and kind for non-login triggers", async () => {
    const bodies: string[] = [];
    const wrapped = withTrace(
      {
        name: "notify-signup",
        version: "v1",
        stage: "pre_signup",
        kind: "signup",
        transport: "http",
        endpoint: "https://stitcher.example.com",
        fetchImpl: (async (_url, init) => {
          bodies.push(String(init?.body));
          return new Response("{}", { status: 202 });
        }) as typeof fetch,
      },
      () => undefined,
    );

    await wrapped({ request: { query: { ext_trace_id: TRACE } } }, {});
    const body = JSON.parse(bodies[0] ?? "{}") as {
      spans: Array<{ attributes: Record<string, unknown> }>;
    };
    expect(body.spans[0]?.attributes).toMatchObject({
      "auth.hook.stage": "pre_signup",
      "auth.journey.kind": "signup",
    });
  });

  it("skips the network when the trace ID is absent", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    let called = 0;
    const wrapped = withTrace(
      {
        name: "x",
        version: "1",
        transport: "http",
        endpoint: "https://stitcher.example.com",
        fetchImpl: (async () => {
          called++;
          return new Response("{}", { status: 200 });
        }) as typeof fetch,
      },
      () => "ok",
    );

    await wrapped({}, {});
    expect(called).toBe(0);
    vi.restoreAllMocks();
  });
});
