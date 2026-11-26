import {
  journeyCorpus,
  journeyOf,
  piiCorpus,
  runSinkConformance,
  SinkError,
} from "@auththread/adapter-kit";
import type { Journey } from "@auththread/schema";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";
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
      put: (key, body, contentType) =>
        Effect.sync(() => {
          puts.push({ key, body, contentType });
        }),
    },
  };
};

describe("object store sink", () => {
  it.effect(
    "passes sink conformance and writes one NDJSON object per journey",
    () =>
      Effect.gen(function* () {
        const { puts, store } = capture();
        const sink = createObjectStoreSink({
          store,
          sampling: keepAll,
          maxRows: 1,
        });

        const report = yield* runSinkConformance({
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

        const replay = puts[1];
        expect(replay?.key).toBe(first.key);
        expect(replay?.body).toBe(first.body);
      }),
  );

  it.effect("batches rows until the size or a flush", () =>
    Effect.gen(function* () {
      const { puts, store } = capture();
      const sink = createObjectStoreSink({
        store,
        sampling: keepAll,
        maxRows: 10,
      });

      for (const journey of journeys) {
        const batch = sink.render(journey);
        if (batch !== null) yield* sink.write(batch);
      }

      expect(puts).toEqual([]);
      yield* sink.flush;
      expect(puts).toHaveLength(1);
      expect(puts[0]?.body.trim().split("\n")).toHaveLength(3);
    }),
  );

  it.effect("keeps rows when a put fails and retries on flush", () =>
    Effect.gen(function* () {
      let failing = true;
      const puts: Put[] = [];
      const store: ObjectStore = {
        put: (key, body, contentType) =>
          failing
            ? Effect.fail(
                new SinkError({
                  sink: "object-store",
                  message: "store down",
                }),
              )
            : Effect.sync(() => {
                puts.push({ key, body, contentType });
              }),
      };
      const sink = createObjectStoreSink({
        store,
        sampling: keepAll,
        maxRows: 1,
      });

      const journey = journeys[0];
      if (journey === undefined) throw new Error("missing journey");
      const batch = sink.render(journey);
      if (batch === null) throw new Error("expected a batch");

      const error = yield* sink.write(batch).pipe(Effect.flip);
      expect(error.message).toContain("store down");
      expect(puts).toHaveLength(0);

      failing = false;
      yield* sink.flush;
      expect(puts).toHaveLength(1);
      expect(puts[0]?.body.trim().split("\n")).toHaveLength(1);
    }),
  );
});
