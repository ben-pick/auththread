import {
  journeyCorpus,
  journeyOf,
  runSinkConformance,
} from "@auththread/adapter-kit";
import type { Span } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { createOtlpSink } from "./index.ts";

const journeys = journeyCorpus.map(journeyOf);

describe("otlp sink", () => {
  it("passes sink conformance and exports the root span with its children", async () => {
    const batches: Span[][] = [];
    const sink = createOtlpSink({
      sampling: { keep: ["all"], successRate: 1 },
      exporter: {
        async export(spans) {
          batches.push([...spans]);
          return { ok: true };
        },
      },
    });

    const report = await runSinkConformance({ sink, journeys, pii: [] });
    expect(report.failures).toEqual([]);

    const first = batches[0] ?? [];
    expect(first[0]?.name).toBe("auth.journey");
    expect(first.length).toBeGreaterThan(1);
  });

  it("surfaces an exporter failure so the stitcher can count it", async () => {
    const sink = createOtlpSink({
      sampling: { keep: ["all"], successRate: 1 },
      exporter: {
        async export() {
          return { ok: false, reason: "collector down" };
        },
      },
    });
    const journey = journeys[0];
    if (journey === undefined) throw new Error("missing journey");
    const batch = sink.render(journey);
    if (batch === null) throw new Error("expected a batch");
    await expect(sink.write(batch)).rejects.toThrow("collector down");
  });
});
