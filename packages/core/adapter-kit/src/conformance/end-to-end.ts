import {
  compareStrings,
  type Outcome,
  type ProviderEvent,
  type Span,
} from "@auththread/schema";
import type { SinkBatch } from "../sink.ts";
import type { ConformanceReport } from "./report.ts";
import { checker } from "./report.ts";

export interface StitcherLike {
  ingestSpan(span: Span): Promise<void>;
  ingestEvent(event: ProviderEvent): Promise<void>;
  runDue(nowMs: number): Promise<void>;
  flush(): SinkBatch[] | Promise<SinkBatch[]>;
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
  readonly create: () => Promise<StitcherLike>;
}

const stable = (batches: readonly SinkBatch[]): string =>
  JSON.stringify(
    [...batches].sort(
      (a, b) =>
        compareStrings(a.sinkId, b.sinkId) ||
        compareStrings(a.journeyId, b.journeyId),
    ),
  );

export async function runEndToEndConformance(
  input: EndToEndInput,
): Promise<ConformanceReport> {
  const result = checker("end-to-end");
  const fixture = input.fixture;

  const ordered = await input.create();
  for (const span of fixture.spans) await ordered.ingestSpan(span);
  for (const event of fixture.events) await ordered.ingestEvent(event);
  await ordered.runDue(fixture.nowMs + fixture.quietMs + 1);
  const orderedBatches = await ordered.flush();

  const delayed = await input.create();
  for (const event of [...fixture.events].reverse())
    await delayed.ingestEvent(event);
  for (const span of [...fixture.spans].reverse()) {
    await delayed.ingestSpan(span);
    await delayed.ingestSpan(span);
  }
  await delayed.runDue(fixture.nowMs + Math.floor(fixture.quietMs / 2));
  const early = await delayed.flush();
  result.check(
    early.length === 0,
    "a journey finalised before its quiet period",
  );

  await delayed.runDue(fixture.nowMs + fixture.quietMs + 1);
  const delayedBatches = await delayed.flush();

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
      wide?.steps.some((step) => step.name === "auth.provider.event") === true,
      "joined provider events produced no step",
    );
  }

  return result.report();
}
