import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
  type SinkBatch,
  shouldKeep,
} from "@auththread/adapter-kit";
import type { Exporter } from "@auththread/otlp";
import type { Journey } from "@auththread/schema";

export interface OtlpSinkOptions {
  readonly exporter: Exporter;
  readonly sampling?: SamplingPolicy;
}

export function createOtlpSink(options: OtlpSinkOptions): Sink {
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
    async write(batch) {
      const result = await options.exporter.export(batch.spans ?? []);
      if (!result.ok) throw new Error(result.reason ?? "otlp export failed");
    },
  };
}
