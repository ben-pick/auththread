import {
  buildJourney,
  type WideEvent as EdgeWideEvent,
  type WideEventStep as EdgeWideEventStep,
  parseSpanId,
  parseTraceId,
  rootSpanId,
  type Span,
  toWideEvent,
} from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import {
  WIDE_EVENT_SCHEMA_VERSION,
  WideEventSchema,
  type WideEventStepSchema,
} from "./index.ts";

type ContractWideEvent = Schema.Schema.Type<typeof WideEventSchema>;
type ContractWideEventStep = Schema.Schema.Type<typeof WideEventStepSchema>;

// Contract → edge assignability is the direction that matters: the stitcher
// emits contract-shaped values and the zero-dependency package consumes them.
const event: EdgeWideEvent = {} as ContractWideEvent;
const step: EdgeWideEventStep = {} as ContractWideEventStep;
void event;
void step;

describe("wide event contract", () => {
  it.effect("decodes the event emitted by the zero-dependency builder", () =>
    Effect.sync(() => {
      const traceId = parseTraceId("a".repeat(32));
      const span: Span = {
        traceId,
        spanId: parseSpanId("b".repeat(16)),
        parentSpanId: rootSpanId(traceId),
        name: "auth.ui.screen",
        kind: "client",
        startMs: 1_700_000_000_000,
        durationMs: 500,
        attributes: {
          "auth.ui.stage": "authenticate",
          "auth.method": "password",
          "auth.ui.vendor_screen": "login-password",
        },
        status: { code: "unset" },
        events: [],
      };
      const wide = toWideEvent(
        buildJourney({
          traceId,
          provider: "auth0",
          tenant: "acme",
          spans: [span],
          events: [],
        }),
      );

      expect(Schema.decodeUnknownSync(WideEventSchema)(wide)).toMatchObject({
        schemaVersion: WIDE_EVENT_SCHEMA_VERSION,
        steps: [{ stage: "authenticate", method: "password" }],
      });
    }),
  );
});
