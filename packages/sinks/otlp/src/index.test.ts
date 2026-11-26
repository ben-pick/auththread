import {
  journeyCorpus,
  journeyOf,
  runSinkConformance,
} from "@auththread/adapter-kit";
import type { Span } from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
import { createOtlpSink } from "./index.ts";

const journeys = journeyCorpus.map(journeyOf);

describe("otlp sink", () => {
  it.effect(
    "passes sink conformance and exports the root span with its children",
    () =>
      Effect.gen(function* () {
        const batches: Span[][] = [];
        const sink = createOtlpSink({
          sampling: { keep: ["all"], successRate: 1 },
          exporter: {
            export: async (spans) => {
              batches.push([...spans]);
              return { ok: true };
            },
          },
        });

        const report = yield* runSinkConformance({ sink, journeys, pii: [] });
        expect(report.failures).toEqual([]);

        const first = batches[0] ?? [];
        expect(first[0]?.name).toBe("auth.journey");
        expect(first.length).toBeGreaterThan(1);
      }),
  );

  it.effect("surfaces an exporter failure so the stitcher can count it", () =>
    Effect.gen(function* () {
      const sink = createOtlpSink({
        sampling: { keep: ["all"], successRate: 1 },
        exporter: {
          export: async () => ({ ok: false, reason: "collector down" }),
        },
      });
      const journey = journeys[0];
      if (journey === undefined) throw new Error("missing journey");
      const batch = sink.render(journey);
      if (batch === null) throw new Error("expected a batch");
      const error = yield* sink.write(batch).pipe(Effect.flip);
      expect(error.message).toContain("collector down");
    }),
  );
});
