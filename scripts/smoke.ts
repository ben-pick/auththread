import {
  memoryBufferLayer,
  memorySchedulerLayer,
  staticSettingsLayer,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { oidcAdapter } from "@auththread/oidc";
import {
  hashUser,
  parseSpanId,
  parseTraceId,
  rootSpanId,
  sha256Hex,
} from "@auththread/schema";
import { createWideEventSink } from "@auththread/sink-wide-event";
import { Stitcher, stitcherLayer } from "@auththread/stitcher";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer, Schema } from "effect";

const KEY = "at_smoke";
const SALT = "smoke-tenant-salt";
const FEED_SECRET = "smoke-feed-secret";
const USER = "auth0|smoke";
const TRACE = "c1".repeat(16);
const TRACE_ID = parseTraceId(TRACE);
const PARENT = rootSpanId(TRACE_ID);

const fail = (message: string): Effect.Effect<never> =>
  Effect.die(new Error(`smoke failed: ${message}`));

const check = (condition: boolean, message: string): Effect.Effect<void> =>
  condition ? Effect.void : fail(message);

const tenant: TenantSettings = {
  tenant: "smoke",
  provider: "auth0",
  apiKeyHash: sha256Hex(KEY),
  salt: SALT,
  providerSettings: { feedSecret: FEED_SECRET },
};

const lines: string[] = [];
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

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

const program = Effect.gen(function* () {
  const stitcher = yield* Stitcher;

  const unauthenticated = yield* stitcher.handle(
    post("/v1/compact-spans", {}, { "content-type": "application/json" }),
  );
  yield* check(
    unauthenticated.status === 401,
    "an unauthenticated request was accepted",
  );

  const accepted = yield* stitcher.handle(
    post("/v1/compact-spans", { spans }, auth),
  );
  yield* check(accepted.status === 202, `spans returned ${accepted.status}`);

  const feed = yield* stitcher.handle(
    post(
      "/v1/providers/auth0/log-stream",
      {},
      {
        ...auth,
        "x-auththread-feed-secret": "wrong",
      },
    ),
  );
  yield* check(feed.status === 401, "an unsigned feed request was accepted");

  const feedAccepted = yield* stitcher.handle(
    post(
      "/v1/providers/auth0/log-stream",
      {
        log_id: "smoke_1",
        date: new Date(now - 60).toISOString(),
        type: "fp",
        connection: "Username-Password-Authentication",
        client_id: "client_smoke",
        user_id: USER,
        user_name: "smoke@example.com",
        details: {},
      },
      { ...auth, "x-auththread-feed-secret": FEED_SECRET },
    ),
  );
  yield* check(
    feedAccepted.status === 202,
    `feed returned ${feedAccepted.status}`,
  );

  yield* stitcher.runDue(now + 5000);

  const line = lines[0];
  if (line === undefined) return yield* fail("no wide event was written");
  const WideEventSummary = Schema.Struct({
    outcome: Schema.String,
    kind: Schema.String,
    steps: Schema.Array(Schema.Struct({ name: Schema.String })),
    correlationCounts: Schema.Struct({
      exact: Schema.Number,
      inferred: Schema.Number,
    }),
  });
  const wide = yield* Effect.fromResult(
    Schema.decodeUnknownResult(Schema.fromJsonString(WideEventSummary))(line),
  ).pipe(Effect.orDie);

  yield* check(wide.outcome === "denied", `outcome was ${wide.outcome}`);
  yield* check(wide.kind === "login", `kind was ${wide.kind}`);
  yield* check(
    wide.steps.length === 5,
    `expected 5 steps, got ${wide.steps.length}`,
  );
  yield* check(
    wide.correlationCounts.inferred === 1,
    "the feed event did not join by hint",
  );
  yield* check(
    !line.includes(USER) && !line.includes("smoke@example.com"),
    "the output contains a raw identifier",
  );

  yield* Console.log(line);
  yield* Console.error(
    `smoke ok: 401 without a key, 401 with a bad feed secret, one ${wide.outcome} journey with ${wide.steps.length} steps`,
  );
});

const dependencies = Layer.mergeAll(
  memoryBufferLayer,
  memorySchedulerLayer,
  staticSettingsLayer([tenant]),
);

const layer = stitcherLayer({
  providers: [oidcAdapter, auth0Adapter],
  sinks: [
    createWideEventSink({
      sampling: { keep: ["all"], successRate: 1 },
      write: (line) => lines.push(line),
    }),
  ],
  quietMs: 1000,
  captureBatches: true,
}).pipe(Layer.provide(dependencies));

NodeRuntime.runMain(program.pipe(Effect.provide(layer)));
