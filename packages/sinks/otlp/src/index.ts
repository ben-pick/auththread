import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
  type SinkBatch,
  SinkError,
  shouldKeep,
} from "@auththread/adapter-kit";
import type { Exporter } from "@auththread/otlp";
import type { Journey } from "@auththread/schema";
import { Effect } from "effect";

export interface OtlpSinkOptions {
  readonly exporter: Exporter;
  readonly sampling?: SamplingPolicy;
}

export const createOtlpSink = (options: OtlpSinkOptions): Sink => {
  const sampling = options.sampling ?? DEFAULT_SAMPLING;

  return {
    id: "otlp",
    accepts: ["spans"],
    sampling,
    render(journey: Journey): SinkBatch | null {
      if (!shouldKeep(sampling, journey)) return null;
      return {
        sinkId: "otlp",
        journeyId: journey.traceId,
        spans: [journey.root, ...journey.spans],
      };
    },
    write: (batch) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => options.exporter.export(batch.spans ?? []),
          catch: (cause) =>
            new SinkError({
              sink: "otlp",
              message: "otlp export failed",
              cause,
            }),
        });
        if (!result.ok)
          return yield* new SinkError({
            sink: "otlp",
            message: result.reason ?? "otlp export failed",
          });
      }),
  };
};
