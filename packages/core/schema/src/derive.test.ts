import { describe, expect, it } from "vitest";
import { buildJourney, deriveOutcome, sortSpans } from "./derive.ts";
import { newTraceId, parseSpanId, rootSpanId } from "./ids.ts";
import type { ProviderEvent } from "./journey.ts";
import type { Span } from "./span.ts";

const traceId = newTraceId((length) => new Uint8Array(length).fill(3));
const at = 1_700_000_000_000;

const span = (
  over: Partial<Span> & Pick<Span, "spanId" | "name" | "startMs">,
): Span => ({
  traceId,
  parentSpanId: rootSpanId(traceId),
  kind: "internal",
  durationMs: 10,
  attributes: {},
  status: { code: "unset" },
  events: [],
  ...over,
});

const loginStart = span({
  spanId: parseSpanId("1111111111111111"),
  name: "auth.app.login_start",
  startMs: at,
  attributes: { "auth.method": "password" },
});

const screen = span({
  spanId: parseSpanId("2222222222222222"),
  name: "auth.ui.screen",
  startMs: at + 100,
  durationMs: 900,
  attributes: { "auth.ui.step": "password", "auth.method": "password" },
});

const callback = span({
  spanId: parseSpanId("3333333333333333"),
  name: "auth.app.callback",
  startMs: at + 1_100,
  status: { code: "ok" },
});

const event = (over: Partial<ProviderEvent>): ProviderEvent => ({
  id: "evt_1",
  provider: "oidc",
  tenant: "acme",
  type: "login_success",
  atMs: at + 1_200,
  hints: {},
  attributes: {},
  ...over,
});

describe("deriveOutcome", () => {
  it("reads a completed login as success", () => {
    expect(deriveOutcome([loginStart, screen, callback], [event({})])).toBe(
      "success",
    );
  });

  it("prefers a denial over everything else", () => {
    const deny = span({
      spanId: parseSpanId("4444444444444444"),
      name: "auth.hook.execute",
      startMs: at + 500,
      attributes: { "auth.hook.decision": "deny" },
      status: { code: "error" },
    });
    expect(deriveOutcome([loginStart, deny, callback], [event({})])).toBe(
      "denied",
    );
  });

  it("reads an error span as failure", () => {
    const failure = span({
      spanId: parseSpanId("5555555555555555"),
      name: "auth.app.callback",
      startMs: at,
      status: { code: "error" },
      attributes: { "auth.error.code": "access_denied" },
    });
    expect(deriveOutcome([failure], [])).toBe("failed");
  });

  it("reads a quiet journey as abandoned", () => {
    const abandoned = span({
      spanId: parseSpanId("6666666666666666"),
      name: "auth.ui.screen",
      startMs: at,
      attributes: { "auth.abandoned_at": "mfa_challenge" },
    });
    expect(deriveOutcome([loginStart, abandoned], [])).toBe("abandoned");
  });
});

describe("buildJourney", () => {
  it("is order tolerant and puts the root span first", () => {
    const a = buildJourney({
      traceId,
      provider: "oidc",
      tenant: "acme",
      spans: [callback, loginStart, screen],
      events: [event({})],
    });
    const b = buildJourney({
      traceId,
      provider: "oidc",
      tenant: "acme",
      spans: [screen, loginStart, callback],
      events: [event({})],
    });

    expect(a).toEqual(b);
    expect(a.root.name).toBe("auth.journey");
    expect(a.root.spanId).toBe(rootSpanId(traceId));
    expect(a.spans.map((s) => s.name)).toEqual([
      "auth.app.login_start",
      "auth.ui.screen",
      "auth.app.callback",
      "auth.provider.event",
    ]);
    expect(a.events[0]?.correlation).toBe("inferred");
    expect(a.spans.at(-1)?.attributes["auth.correlation"]).toBe("inferred");
    expect(a.startedAt).toBe(at);
    expect(a.endedAt).toBe(at + 1_200);
    expect(a.root.attributes["auth.outcome"]).toBe("success");
    expect(a.root.attributes["auth.method"]).toBe("password");
  });

  it("keeps the explicit kind and defaults to login", () => {
    const signedUp = buildJourney({
      traceId,
      provider: "oidc",
      tenant: "acme",
      spans: [loginStart, screen],
      events: [event({ type: "signup_success" })],
    });
    expect(signedUp.kind).toBe("signup");
    expect(signedUp.root.attributes["auth.journey.kind"]).toBe("signup");

    const explicit = buildJourney({
      traceId,
      provider: "oidc",
      tenant: "acme",
      kind: "step_up",
      spans: [loginStart],
      events: [event({ type: "signup_success" })],
    });
    expect(explicit.kind).toBe("step_up");

    const login = buildJourney({
      traceId,
      provider: "oidc",
      tenant: "acme",
      spans: [loginStart],
      events: [event({})],
    });
    expect(login.kind).toBe("login");
  });

  it("collapses conflicting methods instead of picking one", () => {
    const other = span({
      spanId: parseSpanId("7777777777777777"),
      name: "auth.ui.screen",
      startMs: at + 200,
      attributes: { "auth.method": "mfa" },
    });
    const journey = buildJourney({
      traceId,
      provider: "oidc",
      tenant: "acme",
      spans: [loginStart, other],
      events: [],
    });
    expect(journey.root.attributes["auth.method"]).toBeUndefined();
  });
});

describe("sortSpans", () => {
  it("breaks ties deterministically", () => {
    const left = span({
      spanId: parseSpanId("bbbbbbbbbbbbbbbb"),
      name: "auth.ui.screen",
      startMs: at,
    });
    const right = span({
      spanId: parseSpanId("aaaaaaaaaaaaaaaa"),
      name: "auth.ui.screen",
      startMs: at,
    });
    expect(sortSpans([left, right]).map((s) => s.spanId)).toEqual([
      "aaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbb",
    ]);
  });
});
