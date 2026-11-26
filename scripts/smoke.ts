import {
  createStaticSettings,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import { createNodeServer } from "@auththread/runtime-node";
import {
  hashUser,
  parseSpanId,
  parseTraceId,
  rootSpanId,
  sha256Hex,
} from "@auththread/schema";
import { createWideEventSink } from "@auththread/sink-wide-event";

const KEY = "at_smoke";
const SALT = "smoke-tenant-salt";
const FEED_SECRET = "smoke-feed-secret";
const USER = "auth0|smoke";
const TRACE = "c1".repeat(16);
const TRACE_ID = parseTraceId(TRACE);
const PARENT = rootSpanId(TRACE_ID);

const fail = (message: string): never => {
  console.error(`smoke failed: ${message}`);
  process.exit(1);
};

const check = (condition: boolean, message: string): void => {
  if (!condition) fail(message);
};

const tenant: TenantSettings = {
  tenant: "smoke",
  provider: "auth0",
  apiKeyHash: sha256Hex(KEY),
  salt: SALT,
  providerSettings: { feedSecret: FEED_SECRET },
};

const lines: string[] = [];
const server = createNodeServer({
  providers: [oidcAdapter, auth0Adapter],
  sinks: [
    createWideEventSink({
      sampling: { keep: ["all"], successRate: 1 },
      write: (line) => lines.push(line),
    }),
  ],
  settings: createStaticSettings([tenant]),
  quietMs: 1000,
  captureBatches: true,
});

const { port } = await server.listen(0, "127.0.0.1");
const base = `http://127.0.0.1:${port}`;
const auth = {
  authorization: `Bearer ${KEY}`,
  "content-type": "application/json",
};

const now = Date.now();
const span = (
  spanId: string,
  name: string,
  startMs: number,
  durationMs: number,
  attributes: Record<string, string>,
  status: "unset" | "ok" | "error" = "unset",
) => ({
  traceId: TRACE,
  spanId: parseSpanId(spanId),
  parentSpanId: PARENT,
  name,
  startMs,
  durationMs,
  attributes,
  status: {
    code: status,
    ...(status === "error" ? { message: "denied" } : {}),
  },
  events: [],
});

const spans = [
  span("1111111111111111", "auth.app.login_start", now - 500, 3, {
    "auth.method": "password",
  }),
  span("2222222222222222", "auth.ui.screen", now - 400, 300, {
    "auth.ui.step": "password",
    "auth.method": "password",
  }),
  span(
    "3333333333333333",
    "auth.hook.execute",
    now - 200,
    40,
    {
      "auth.user.hash": hashUser(USER, SALT),
      "auth.hook.name": "deny-unverified",
      "auth.hook.type": "auth0.action",
      "auth.hook.stage": "post_auth",
      "auth.hook.decision": "deny",
      "auth.error.code": "access_denied",
      "auth.error.source": "hook",
    },
    "error",
  ),
  span(
    "4444444444444444",
    "auth.app.callback",
    now - 100,
    20,
    { "auth.error.code": "access_denied", "auth.error.source": "provider" },
    "error",
  ),
];

const unauthenticated = await fetch(`${base}/v1/compact-spans`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
check(
  unauthenticated.status === 401,
  "an unauthenticated request was accepted",
);

const accepted = await fetch(`${base}/v1/compact-spans`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ spans }),
});
check(accepted.status === 202, `spans returned ${accepted.status}`);

const feed = await fetch(`${base}/v1/providers/auth0/log-stream`, {
  method: "POST",
  headers: { ...auth, "x-auththread-feed-secret": "wrong" },
  body: "{}",
});
check(feed.status === 401, "an unsigned feed request was accepted");

const feedAccepted = await fetch(`${base}/v1/providers/auth0/log-stream`, {
  method: "POST",
  headers: { ...auth, "x-auththread-feed-secret": FEED_SECRET },
  body: JSON.stringify({
    log_id: "smoke_1",
    date: new Date(now - 60).toISOString(),
    type: "fp",
    connection: "Username-Password-Authentication",
    client_id: "client_smoke",
    user_id: USER,
    user_name: "smoke@example.com",
    details: {},
  }),
});
check(feedAccepted.status === 202, `feed returned ${feedAccepted.status}`);

await server.stitcher.runDue(now + 5000);
await server.close();

const line = lines[0];
if (line === undefined) fail("no wide event was written");
const wide = JSON.parse(line) as {
  outcome: string;
  kind: string;
  steps: Array<{ name: string }>;
  correlationCounts: { exact: number; inferred: number };
};

check(wide.outcome === "denied", `outcome was ${wide.outcome}`);
check(wide.kind === "login", `kind was ${wide.kind}`);
check(wide.steps.length === 5, `expected 5 steps, got ${wide.steps.length}`);
check(
  wide.correlationCounts.inferred === 1,
  "the feed event did not join by hint",
);
check(
  !line.includes(USER) && !line.includes("smoke@example.com"),
  "the output contains a raw identifier",
);

console.log(line);
console.error(
  `smoke ok: 401 without a key, 401 with a bad feed secret, one ${wide.outcome} journey with ${wide.steps.length} steps`,
);
