import {
  type Attributes,
  buildJourney,
  type Journey,
  type Outcome,
  type ProviderEvent,
  parseSpanId,
  parseTraceId,
  rootSpanId,
  type Span,
  type TraceId,
} from "@auththread/schema";

export interface JourneyFixture {
  readonly name: string;
  readonly provider: string;
  readonly tenant: string;
  readonly nowMs: number;
  readonly quietMs: number;
  readonly traceId: TraceId;
  readonly spans: readonly Span[];
  readonly events: readonly ProviderEvent[];
  readonly expectedOutcome: Outcome;
}

const BASE = 1_700_000_000_000;

const trace = (hex: string): TraceId =>
  parseTraceId(hex.repeat(32 / hex.length));

const span = (
  traceId: TraceId,
  spanId: string,
  name: string,
  startMs: number,
  durationMs: number,
  attributes: Attributes,
  over: Partial<Span> = {},
): Span => ({
  traceId,
  spanId: parseSpanId(spanId.repeat(16 / spanId.length)),
  parentSpanId: rootSpanId(traceId),
  name,
  kind: "internal",
  startMs,
  durationMs,
  attributes,
  status: { code: "unset" },
  events: [],
  ...over,
});

const event = (
  id: string,
  provider: string,
  tenant: string,
  type: string,
  atMs: number,
  over: Partial<ProviderEvent> = {},
): ProviderEvent => ({
  id,
  provider,
  tenant,
  type,
  atMs,
  hints: {},
  attributes: {},
  ...over,
});

const oidcTrace = trace("a1");
const auth0Trace = trace("b2");
const abandonedTrace = trace("c3");

const oidcSuccess: JourneyFixture = {
  name: "oidc success",
  provider: "oidc",
  tenant: "acme",
  nowMs: BASE + 5000,
  quietMs: 10 * 60 * 1000,
  traceId: oidcTrace,
  expectedOutcome: "success",
  spans: [
    span(oidcTrace, "01", "auth.app.login_start", BASE, 2, {
      "auth.provider": "oidc",
      "auth.tenant": "acme",
      "auth.method": "password",
    }),
    span(oidcTrace, "02", "auth.ui.screen", BASE + 120, 900, {
      "auth.ui.step": "identifier",
      "auth.method": "password",
    }),
    span(oidcTrace, "03", "auth.ui.screen", BASE + 1100, 1400, {
      "auth.ui.step": "password",
      "auth.method": "password",
    }),
    span(
      oidcTrace,
      "04",
      "auth.app.callback",
      BASE + 2600,
      80,
      {},
      { status: { code: "ok" } },
    ),
    span(oidcTrace, "05", "auth.app.token_exchange", BASE + 2680, 120, {}),
  ],
  events: [
    event("oidc_evt_1", "oidc", "acme", "login_success", BASE + 2800, {
      traceId: oidcTrace,
      hints: { userHash: "u_oidc_1", clientId: "web" },
    }),
  ],
};

const auth0Denied: JourneyFixture = {
  name: "auth0 denied",
  provider: "auth0",
  tenant: "acme",
  nowMs: BASE + 6000,
  quietMs: 10 * 60 * 1000,
  traceId: auth0Trace,
  expectedOutcome: "denied",
  spans: [
    span(auth0Trace, "11", "auth.app.login_start", BASE + 10, 3, {
      "auth.provider": "auth0",
      "auth.tenant": "acme",
      "auth.method": "social",
      "auth.method.vendor_name": "google-oauth2",
    }),
    span(auth0Trace, "12", "auth.ui.screen", BASE + 140, 800, {
      "auth.ui.step": "identifier",
      "auth.ui.vendor_screen": "login",
    }),
    span(
      auth0Trace,
      "13",
      "auth.hook.execute",
      BASE + 1000,
      45,
      {
        "auth.hook.name": "deny-unverified",
        "auth.hook.type": "auth0.action",
        "auth.hook.stage": "post_auth",
        "auth.hook.version": "v3",
        "auth.hook.decision": "deny",
        "auth.error.code": "access_denied",
        "auth.error.source": "hook",
      },
      { status: { code: "error", message: "denied" } },
    ),
    span(
      auth0Trace,
      "14",
      "auth.app.callback",
      BASE + 1100,
      30,
      {
        "auth.error.code": "access_denied",
        "auth.error.source": "provider",
        "auth.user.hash": "u_0123456789abcdef",
      },
      { status: { code: "error" } },
    ),
  ],
  events: [
    event("auth0_evt_1", "auth0", "acme", "login_failure", BASE + 1200, {
      hints: {
        userHash: "u_0123456789abcdef",
        ipHash: "i_1",
        userAgentHash: "a_1",
      },
      attributes: { "auth.error.vendor_code": "unauthorized" },
    }),
  ],
};

const abandoned: JourneyFixture = {
  name: "abandoned at mfa",
  provider: "oidc",
  tenant: "acme",
  nowMs: BASE + 4000,
  quietMs: 10 * 60 * 1000,
  traceId: abandonedTrace,
  expectedOutcome: "abandoned",
  spans: [
    span(abandonedTrace, "21", "auth.app.login_start", BASE + 20, 2, {
      "auth.provider": "oidc",
      "auth.tenant": "acme",
      "auth.method": "passwordless",
    }),
    span(abandonedTrace, "22", "auth.ui.screen", BASE + 150, 2500, {
      "auth.ui.step": "identifier",
    }),
    span(abandonedTrace, "23", "auth.ui.screen", BASE + 2700, 300, {
      "auth.ui.step": "mfa_challenge",
      "auth.abandoned_at": "mfa_challenge",
    }),
  ],
  events: [],
};

export const journeyCorpus: readonly JourneyFixture[] = [
  oidcSuccess,
  auth0Denied,
  abandoned,
];

export const journeyOf = (fixture: JourneyFixture): Journey =>
  buildJourney({
    traceId: fixture.traceId,
    provider: fixture.provider,
    tenant: fixture.tenant,
    spans: fixture.spans,
    events: fixture.events,
  });

export const piiCorpus: readonly string[] = [
  "alice@example.com",
  "auth0|64f0",
  "hunter2",
  "secret-token-value",
];
