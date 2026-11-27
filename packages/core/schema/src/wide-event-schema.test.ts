import { describe, expect, it } from "vitest";
import v1 from "../schema/wide-event-1.json";
import schema from "../schema/wide-event-2.json";
import {
  AUTH_METHODS,
  AUTH_OUTCOMES,
  AUTH_UI_STAGES,
  JOURNEY_KINDS,
  WIDE_EVENT_EVENT_NAME,
  WIDE_EVENT_SCHEMA_VERSION,
  WIDE_EVENT_STEP_TYPES,
} from "./attributes.ts";

describe("wide-event-2 schema", () => {
  it("derives every enum from the runtime tuples", () => {
    expect(schema.properties.kind.enum).toEqual(JOURNEY_KINDS);
    expect(schema.properties.outcome.enum).toEqual(AUTH_OUTCOMES);
    expect(schema.properties.steps.items.properties.stage.enum).toEqual(
      AUTH_UI_STAGES,
    );
    expect(schema.properties.steps.items.properties.method.enum).toEqual(
      AUTH_METHODS,
    );
    expect(schema.properties.steps.items.properties.type.enum).toEqual(
      WIDE_EVENT_STEP_TYPES,
    );
  });

  it("pins the schema version and event name", () => {
    expect(schema.properties.schemaVersion.const).toBe(
      WIDE_EVENT_SCHEMA_VERSION,
    );
    expect(schema.properties.event.const).toBe(WIDE_EVENT_EVENT_NAME);
  });

  it("keeps the published v1 schema frozen", () => {
    expect(v1.properties.schemaVersion.const).toBe("1");
    expect(v1.properties.kind.enum).toEqual([
      "login",
      "signup",
      "reset",
      "step_up",
    ]);
    expect(v1.properties.outcome.enum).toEqual([
      "success",
      "failed",
      "abandoned",
      "denied",
    ]);
    expect(v1.properties.steps.items.properties.type.enum).toEqual([
      "ui",
      "hook",
      "app",
      "provider",
    ]);
    expect(v1.properties.steps.items.properties).not.toHaveProperty("stage");
  });
});
