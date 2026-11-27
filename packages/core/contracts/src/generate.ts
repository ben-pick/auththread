import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import {
  WIDE_EVENT_EVENT_NAME,
  WIDE_EVENT_SCHEMA_VERSION,
  WideEventSchema,
} from "./index.ts";

/** The package owns the output layout: the zero-dep edge package consumes this file. */
const SCHEMA_ROOT = fileURLToPath(new URL("../../schema/", import.meta.url));

export const jsonSchemaPath = (version: string): string =>
  join(SCHEMA_ROOT, `schema/wide-event-${version}.json`);

export const renderJsonSchema = (): string => {
  const generated = Schema.toJsonSchemaDocument(WideEventSchema, {
    onExcessProperty: "error",
  }).schema as {
    readonly required: readonly string[];
    readonly properties: Record<string, Record<string, unknown>>;
  };

  const properties = {
    ...generated.properties,
    schemaVersion: { const: WIDE_EVENT_SCHEMA_VERSION },
    event: { const: WIDE_EVENT_EVENT_NAME },
    startedAt: { type: "string", format: "date-time" },
  };

  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `https://auththread.dev/schema/wide-event-${WIDE_EVENT_SCHEMA_VERSION}.json`,
      title: "auththread wide event",
      type: "object",
      required: generated.required,
      properties,
      additionalProperties: true,
    },
    null,
    2,
  )}\n`;
};

export interface GenerateResult {
  readonly stale: readonly string[];
}

/**
 * Writes the generated JSON Schema, or compares it when `check` is true.
 * `pnpm schema:check` runs this from `pnpm check`.
 */
export function generate(check: boolean): GenerateResult {
  const path = jsonSchemaPath(WIDE_EVENT_SCHEMA_VERSION);
  const body = renderJsonSchema();

  if (check) {
    return { stale: readFileSync(path, "utf8") === body ? [] : [path] };
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return { stale: [] };
}
