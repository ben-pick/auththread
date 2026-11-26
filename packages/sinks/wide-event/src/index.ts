import {
  DEFAULT_SAMPLING,
  type SamplingPolicy,
  type Sink,
  SinkError,
  shouldKeep,
} from "@auththread/adapter-kit";
import { type Journey, toWideEvent } from "@auththread/schema";
import { Effect } from "effect";

export interface WideEventSinkOptions {
  readonly sampling?: SamplingPolicy;
  readonly write?: (line: string) => void;
}

export const createWideEventSink = (
  options: WideEventSinkOptions = {},
): Sink => {
  const sampling = options.sampling ?? DEFAULT_SAMPLING;
  const write = options.write ?? ((line: string) => console.log(line));

  return {
    id: "wide-event-stdout",
    accepts: ["journey"],
    sampling,
    render(journey: Journey) {
      if (!shouldKeep(sampling, journey)) return null;
      return {
        sinkId: "wide-event-stdout",
        journeyId: journey.traceId,
        wideEvent: toWideEvent(journey),
      };
    },
    write: (batch) => {
      if (batch.wideEvent === undefined) return Effect.void;
      return Effect.try({
        try: () => write(JSON.stringify(batch.wideEvent)),
        catch: (cause) =>
          new SinkError({
            sink: "wide-event-stdout",
            message: "stdout write failed",
            cause,
          }),
      });
    },
  };
};
