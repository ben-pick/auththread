import {
  journeyCorpus,
  memoryBufferLayer,
  memorySchedulerLayer,
  staticSettingsLayer,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { sha256Hex } from "@auththread/schema";
import { createWideEventSink } from "@auththread/sink-wide-event";
import { Stitcher, stitcherLayer } from "@auththread/stitcher";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";

const fixture = journeyCorpus.find((entry) => entry.name === "auth0 denied");
if (fixture === undefined) {
  throw new Error("corpus is missing the auth0 fixture");
}

const lines: string[] = [];
const tenant: TenantSettings = {
  tenant: "acme",
  provider: "auth0",
  apiKeyHash: sha256Hex("at_demo"),
  salt: "demo-tenant-salt",
  providerSettings: { feedSecret: "demo-feed-secret" },
};

const program = Effect.gen(function* () {
  const stitcher = yield* Stitcher;

  for (const span of fixture.spans) yield* stitcher.ingestSpan(span, tenant);
  for (const event of fixture.events)
    yield* stitcher.ingestEvent(event, tenant);
  yield* stitcher.runDue(fixture.nowMs + fixture.quietMs + 1);

  const batch = (yield* stitcher.flush)[0];
  if (batch?.wideEvent === undefined) {
    return yield* Effect.die(
      new Error("demo failed: the stitcher produced no wide event"),
    );
  }

  const wide = batch.wideEvent;
  if (wide.outcome !== fixture.expectedOutcome) {
    return yield* Effect.die(
      new Error(
        `demo failed: expected ${fixture.expectedOutcome}, got ${wide.outcome}`,
      ),
    );
  }

  yield* Console.log(lines[0] ?? "");
  yield* Console.error(
    `demo ok: ${wide.provider} ${wide.outcome} journey with ${wide.steps.length} steps`,
  );
});

const dependencies = Layer.mergeAll(
  memoryBufferLayer,
  memorySchedulerLayer,
  staticSettingsLayer([tenant]),
);

const layer = stitcherLayer({
  providers: [auth0Adapter],
  sinks: [createWideEventSink({ write: (line) => lines.push(line) })],
  quietMs: fixture.quietMs,
  captureBatches: true,
  now: Effect.succeed(fixture.nowMs),
}).pipe(Layer.provide(dependencies));

NodeRuntime.runMain(program.pipe(Effect.provide(layer)));
