import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import {
  AuthUiStageSchema,
  WIDE_EVENT_EVENT_NAME,
  WIDE_EVENT_SCHEMA_VERSION,
  WideEventSchema,
  WideEventStepTypeSchema,
} from "./index.ts";

const event = {
  schemaVersion: WIDE_EVENT_SCHEMA_VERSION,
  event: WIDE_EVENT_EVENT_NAME,
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  kind: "login",
  outcome: "success",
  provider: "auth0",
  tenant: "acme",
  startedAt: "2026-11-27T10:00:00.000Z",
  durationMs: 1000,
  attributes: {},
  steps: [
    {
      name: "auth.ui.screen",
      type: "ui",
      startOffsetMs: 0,
      durationMs: 500,
      stage: "authenticate",
      method: "password",
      vendorScreen: "login-password",
    },
  ],
  correlationCounts: { exact: 0, inferred: 0 },
};

describe("contracts", () => {
  it.effect("decodes a wide event", () =>
    Effect.sync(() => {
      expect(Schema.decodeUnknownSync(WideEventSchema)(event)).toMatchObject({
        schemaVersion: WIDE_EVENT_SCHEMA_VERSION,
        steps: [{ stage: "authenticate" }],
      });
    }),
  );

  it.effect("rejects a legacy step as a stage", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownResult(AuthUiStageSchema)("password");
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("keeps the step type vocabulary closed", () =>
    Effect.sync(() => {
      expect(
        Schema.decodeUnknownResult(WideEventStepTypeSchema)("trace"),
      ).toMatchObject({ _tag: "Failure" });
    }),
  );
});
