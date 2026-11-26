import {
  compareStrings,
  type Outcome,
  type ProviderEvent,
  type Span,
} from "@auththread/schema";
import { Context, Effect, type Layer } from "effect";
import type { SinkBatch } from "../sink.ts";
import type { ConformanceReport } from "./report.ts";
import { checker } from "./report.ts";

export class StitcherUnderTest extends Context.Service<
  StitcherUnderTest,
  StitcherLike
>()("auththread/StitcherUnderTest") {}

export interface StitcherLike {
  ingestSpan(span: Span): Effect.Effect<void>;
  ingestEvent(event: ProviderEvent): Effect.Effect<void>;
  runDue(nowMs: number): Effect.Effect<void>;
  flush: Effect.Effect<SinkBatch[]>;
}

export interface EndToEndFixture {
  readonly provider: string;
  readonly tenant: string;
  readonly nowMs: number;
  readonly quietMs: number;
  readonly spans: readonly Span[];
  readonly events: readonly ProviderEvent[];
  readonly expectedOutcome: Outcome;
}

export interface EndToEndInput {
  readonly fixture: EndToEndFixture;
  readonly create: () => Layer.Layer<StitcherUnderTest>;
}

const stable = (batches: readonly SinkBatch[]): string =>
  JSON.stringify(
    [...batches].sort(
      (a, b) =>
        compareStrings(a.sinkId, b.sinkId) ||
        compareStrings(a.journeyId, b.journeyId),
    ),
  );

export const runEndToEndConformance = (
  input: EndToEndInput,
): Effect.Effect<ConformanceReport> =>
  Effect.gen(function* () {
    const result = checker("end-to-end");
    const fixture = input.fixture;

    const orderedBatches = yield* Effect.gen(function* () {
      const ordered = yield* StitcherUnderTest;
      for (const span of fixture.spans) yield* ordered.ingestSpan(span);
      for (const event of fixture.events) yield* ordered.ingestEvent(event);
      yield* ordered.runDue(fixture.nowMs + fixture.quietMs + 1);
      return yield* ordered.flush;
    }).pipe(Effect.provide(input.create()));

    const delayedBatches = yield* Effect.gen(function* () {
      const delayed = yield* StitcherUnderTest;
      for (const event of [...fixture.events].reverse())
        yield* delayed.ingestEvent(event);
      for (const span of [...fixture.spans].reverse()) {
        yield* delayed.ingestSpan(span);
        yield* delayed.ingestSpan(span);
      }
      yield* delayed.runDue(fixture.nowMs + Math.floor(fixture.quietMs / 2));
      const early = yield* delayed.flush;
      result.check(
        early.length === 0,
        "a journey finalised before its quiet period",
      );

      yield* delayed.runDue(fixture.nowMs + fixture.quietMs + 1);
      return yield* delayed.flush;
    }).pipe(Effect.provide(input.create()));

    result.check(orderedBatches.length > 0, "the stitcher emitted no batches");
    result.check(
      stable(orderedBatches) === stable(delayedBatches),
      "delivery order and duplicates changed the output",
    );

    const wide = orderedBatches.find(
      (batch) => batch.wideEvent !== undefined,
    )?.wideEvent;
    result.check(wide !== undefined, "no sink produced a wide event");
    result.check(
      wide?.outcome === fixture.expectedOutcome,
      `outcome was ${wide?.outcome}`,
    );
    result.check(
      wide?.provider === fixture.provider,
      "provider did not reach the output",
    );
    result.check(
      wide?.tenant === fixture.tenant,
      "tenant did not reach the output",
    );

    const spans =
      orderedBatches.find((batch) => batch.spans !== undefined)?.spans ?? [];
    result.check(
      spans.some((span) => span.name === "auth.journey"),
      "the root span was not exported",
    );

    if (fixture.events.length > 0) {
      const counts = wide?.correlationCounts;
      result.check(
        counts !== undefined &&
          counts.exact + counts.inferred === fixture.events.length,
        "provider events were not joined into the journey",
      );
      result.check(
        wide?.steps.some((step) => step.name === "auth.provider.event") ===
          true,
        "joined provider events produced no step",
      );
    }

    return result.report();
  });
