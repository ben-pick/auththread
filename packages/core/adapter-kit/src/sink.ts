import type { Journey, Span, TraceId, WideEvent } from "@auththread/schema";

export interface SamplingPolicy {
  /** Outcomes that are always kept. Defaults to failed, denied, abandoned and slow. */
  readonly keep: readonly (
    | "failed"
    | "denied"
    | "abandoned"
    | "slow"
    | "all"
  )[];
  /** Share of successful journeys kept, between 0 and 1. */
  readonly successRate: number;
  readonly slowMs?: number;
}

export const DEFAULT_SAMPLING: SamplingPolicy = {
  keep: ["failed", "denied", "abandoned", "slow"],
  successRate: 0.1,
  slowMs: 5000,
};

/**
 * Deterministic from the trace ID, so a journey sampled by the stitcher is the
 * same journey a replay keeps. Math.random would make conformance untestable.
 */
export const sampleScore = (traceId: TraceId): number =>
  Number.parseInt(traceId.slice(0, 8), 16) / 0x1_0000_0000;

export function shouldKeep(policy: SamplingPolicy, journey: Journey): boolean {
  if (policy.keep.includes("all")) return true;
  if (journey.outcome !== "success" && policy.keep.includes(journey.outcome))
    return true;
  if (journey.outcome !== "success") return false;

  const slowMs = policy.slowMs ?? 5000;
  if (
    policy.keep.includes("slow") &&
    journey.endedAt - journey.startedAt >= slowMs
  )
    return true;

  return sampleScore(journey.traceId) < policy.successRate;
}

export interface SinkBatch {
  readonly sinkId: string;
  readonly journeyId: TraceId;
  readonly spans?: readonly Span[];
  readonly wideEvent?: WideEvent;
}

export interface Sink {
  readonly id: string;
  readonly accepts: readonly ("spans" | "journey")[];
  readonly sampling?: SamplingPolicy;
  /** Pure: decides sampling and renders the payload. Null means sampled away. */
  render(journey: Journey): SinkBatch | null;
  /** Must be safe to retry with the same batch. */
  write(batch: SinkBatch): Promise<void>;
  /** Flush any internal buffer. Called by runtimes on shutdown or before eviction. */
  flush?(): Promise<void>;
  /** The key a receiver de-duplicates on. Defaults to the journey ID. */
  idempotencyKey?(batch: SinkBatch): string;
}
