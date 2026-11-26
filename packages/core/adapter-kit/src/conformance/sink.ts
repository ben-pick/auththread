import { isWideEvent, type Journey, type Span } from "@auththread/schema";
import { DEFAULT_SAMPLING, type Sink, shouldKeep } from "../sink.ts";
import type { ConformanceReport } from "./report.ts";
import { checker } from "./report.ts";

export interface SinkConformanceInput {
  readonly sink: Sink;
  readonly journeys: readonly Journey[];
  readonly pii: readonly string[];
}

const serialize = (value: unknown): string =>
  JSON.stringify(value).toLowerCase();

export async function runSinkConformance(
  input: SinkConformanceInput,
): Promise<ConformanceReport> {
  const result = checker(`sink:${input.sink.id}`);

  result.check(input.sink.id.length > 0, "sink id is empty");
  result.check(input.sink.accepts.length > 0, "sink accepts nothing");
  result.check(
    input.journeys.length > 0,
    "sink conformance needs at least one journey",
  );

  for (const journey of input.journeys) {
    const policy = input.sink.sampling ?? DEFAULT_SAMPLING;
    const expected = shouldKeep(policy, journey) ? "batch" : "null";
    const batch = input.sink.render(journey);
    const again = input.sink.render(journey);

    result.check(
      JSON.stringify(batch) === JSON.stringify(again),
      `render is not deterministic for ${journey.traceId}`,
    );

    if (expected === "null") {
      result.check(
        batch === null,
        `sampling should have dropped ${journey.traceId}`,
      );
      continue;
    }

    if (batch === null) {
      result.check(false, `sampling should have kept ${journey.traceId}`);
      continue;
    }

    result.check(
      batch.sinkId === input.sink.id,
      "batch carries another sink id",
    );
    result.check(
      batch.journeyId === journey.traceId,
      "batch carries another journey id",
    );

    if (input.sink.accepts.includes("spans")) {
      result.check(
        batch.spans !== undefined,
        "sink declares spans but rendered none",
      );
      const spans: readonly Span[] = batch.spans ?? [];
      result.check(spans.length > 0, "sink rendered an empty span list");
      result.check(
        spans.some((span) => span.name === "auth.journey"),
        "sink rendered spans without the journey root",
      );
      result.check(
        spans.every((span) => span.traceId === journey.traceId),
        "a span belongs to another trace",
      );
    }

    if (input.sink.accepts.includes("journey")) {
      result.check(
        isWideEvent(batch.wideEvent),
        "wide event does not match the published shape",
      );
      result.check(
        batch.wideEvent?.traceId === journey.traceId,
        "wide event belongs to another trace",
      );
      result.check(
        batch.wideEvent?.outcome === journey.outcome,
        "wide event outcome disagrees with the journey",
      );
    }

    if (input.pii.length > 0) {
      const text = serialize(batch);
      for (const secret of input.pii) {
        result.check(
          !text.includes(secret.toLowerCase()),
          `batch leaked ${secret.replace(/./g, "*")}`,
        );
      }
    }

    const key = input.sink.idempotencyKey?.(batch) ?? batch.journeyId;
    result.check(
      key === batch.journeyId,
      "idempotency key is not stable per journey",
    );

    await input.sink.write(JSON.parse(JSON.stringify(batch)) as typeof batch);
    await input.sink.write(batch);
  }

  return result.report();
}
