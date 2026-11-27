import { AUTH_UI_STAGES } from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { renderJsonSchema } from "./generate.ts";
import { WIDE_EVENT_EVENT_NAME, WIDE_EVENT_SCHEMA_VERSION } from "./index.ts";

describe("contract generation", () => {
  it.effect("renders a JSON Schema from the shared enum source", () =>
    Effect.sync(() => {
      const schema = JSON.parse(renderJsonSchema()) as {
        $id: string;
        properties: {
          schemaVersion: { const: string };
          event: { const: string };
          steps: {
            items: { properties: { stage: { enum: readonly string[] } } };
          };
        };
      };
      expect(schema.$id).toBe(
        `https://auththread.dev/schema/wide-event-${WIDE_EVENT_SCHEMA_VERSION}.json`,
      );
      expect(schema.properties.schemaVersion.const).toBe(
        WIDE_EVENT_SCHEMA_VERSION,
      );
      expect(schema.properties.event.const).toBe(WIDE_EVENT_EVENT_NAME);
      expect(schema.properties.steps.items.properties.stage.enum).toEqual(
        AUTH_UI_STAGES,
      );
    }),
  );
});
