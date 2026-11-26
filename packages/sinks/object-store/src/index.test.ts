import {
  journeyCorpus,
  journeyOf,
  piiCorpus,
  runSinkConformance,
} from "@auththread/adapter-kit";
import type { Journey } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { createObjectStoreSink, type ObjectStore } from "./index.ts";

const journeys: Journey[] = journeyCorpus.map(journeyOf);
const keepAll = { keep: ["all"] as const, successRate: 1 };

interface Put {
  readonly key: string;
  readonly body: string;
  readonly contentType: string;
}

const capture = (): { puts: Put[]; store: ObjectStore } => {
  const puts: Put[] = [];
  return {
    puts,
    store: {
      async put(key, body, contentType) {
        puts.push({ key, body, contentType });
      },
    },
  };
};

describe("object store sink", () => {
  it("passes sink conformance and writes one NDJSON object per journey", async () => {
    const { puts, store } = capture();
    const sink = createObjectStoreSink({
      store,
      sampling: keepAll,
      maxRows: 1,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });

    const report = await runSinkConformance({
      sink,
      journeys,
      pii: piiCorpus,
    });
    expect(report.failures).toEqual([]);

    const first = puts[0];
    if (first === undefined) throw new Error("nothing was written");
    expect(first.key).toMatch(
      /^auththread\/dt=\d{4}-\d{2}-\d{2}\/hour=\d{2}\/batch-[0-9a-f]{16}\.ndjson$/,
    );
    expect(first.contentType).toBe("application/x-ndjson");
    expect(first.body.endsWith("\n")).toBe(true);
    expect(JSON.parse(first.body.trim())).toMatchObject({
      event: "auth.journey",
    });

    const replay = puts[1];
    expect(replay?.key).toBe(first.key);
    expect(replay?.body).toBe(first.body);
  });

  it("batches rows until the size or a flush", async () => {
    const { puts, store } = capture();
    const sink = createObjectStoreSink({
      store,
      sampling: keepAll,
      maxRows: 10,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });

    for (const journey of journeys) {
      const batch = sink.render(journey);
      if (batch !== null) await sink.write(batch);
    }

    expect(puts).toEqual([]);
    await sink.flush();
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body.trim().split("\n")).toHaveLength(3);
  });

  it("keeps rows when a put fails and retries on flush", async () => {
    let failing = true;
    const puts: Put[] = [];
    const store: ObjectStore = {
      async put(key, body, contentType) {
        if (failing) throw new Error("store down");
        puts.push({ key, body, contentType });
      },
    };
    const sink = createObjectStoreSink({
      store,
      sampling: keepAll,
      maxRows: 1,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });

    const journey = journeys[0];
    if (journey === undefined) throw new Error("missing journey");
    const batch = sink.render(journey);
    if (batch === null) throw new Error("expected a batch");

    await expect(sink.write(batch)).rejects.toThrow("store down");
    expect(puts).toHaveLength(0);

    failing = false;
    await sink.flush();
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body.trim().split("\n")).toHaveLength(1);
  });
});
