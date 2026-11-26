import {
  journeyCorpus,
  journeyOf,
  runSinkConformance,
} from "@auththread/adapter-kit";
import { isWideEvent } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { createWideEventSink } from "./index.ts";

const journeys = journeyCorpus.map(journeyOf);

describe("wide event sink", () => {
  it("passes sink conformance and writes one JSON line per journey", async () => {
    const lines: string[] = [];
    const sink = createWideEventSink({
      sampling: { keep: ["all"], successRate: 1 },
      write: (line) => lines.push(line),
    });

    const report = await runSinkConformance({ sink, journeys, pii: [] });
    expect(report.failures).toEqual([]);

    const parsed = JSON.parse(lines[0] ?? "null") as unknown;
    expect(isWideEvent(parsed)).toBe(true);
    expect(lines[0]?.includes("\n")).toBe(false);
  });

  it("drops successful journeys beyond the sampling rate", () => {
    const sink = createWideEventSink({
      sampling: { keep: [], successRate: 0 },
      write: () => undefined,
    });
    const success = journeys.find((journey) => journey.outcome === "success");
    if (success === undefined) throw new Error("missing success journey");
    expect(sink.render(success)).toBeNull();
  });
});
