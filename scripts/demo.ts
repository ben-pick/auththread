import {
  createMemoryBuffer,
  createMemoryScheduler,
  createStaticSettings,
  journeyCorpus,
  type TenantSettings,
} from "@auththread/adapter-kit";
import { auth0Adapter } from "@auththread/auth0";
import { sha256Hex } from "@auththread/schema";
import { createWideEventSink } from "@auththread/sink-wide-event";
import { createStitcher } from "@auththread/stitcher";

const fixture = journeyCorpus.find((entry) => entry.name === "auth0 denied");
if (fixture === undefined)
  throw new Error("corpus is missing the auth0 fixture");

const lines: string[] = [];
const tenant: TenantSettings = {
  tenant: "acme",
  provider: "auth0",
  apiKeyHash: sha256Hex("at_demo"),
  salt: "demo-tenant-salt",
  providerSettings: { feedSecret: "demo-feed-secret" },
};

const stitcher = createStitcher({
  providers: [auth0Adapter],
  buffer: createMemoryBuffer(),
  scheduler: createMemoryScheduler(),
  settings: createStaticSettings([tenant]),
  sinks: [createWideEventSink({ write: (line) => lines.push(line) })],
  quietMs: fixture.quietMs,
  captureBatches: true,
  clock: { now: () => fixture.nowMs },
});

for (const span of fixture.spans) await stitcher.ingestSpan(span, tenant);
for (const event of fixture.events) await stitcher.ingestEvent(event, tenant);
await stitcher.runDue(fixture.nowMs + fixture.quietMs + 1);

const batch = stitcher.flush()[0];
if (batch?.wideEvent === undefined) {
  console.error("demo failed: the stitcher produced no wide event");
  process.exit(1);
}

const wide = batch.wideEvent;
if (wide.outcome !== fixture.expectedOutcome) {
  console.error(
    `demo failed: expected ${fixture.expectedOutcome}, got ${wide.outcome}`,
  );
  process.exit(1);
}

console.log(lines[0]);
console.error(
  `demo ok: ${wide.provider} ${wide.outcome} journey with ${wide.steps.length} steps`,
);
