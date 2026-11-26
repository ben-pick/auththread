import type { CorrelationKind, Outcome, SpanName } from "./attributes.ts";
import type { Journey, WideEvent, WideEventStep } from "./journey.ts";

const stepType = (name: string): WideEventStep["type"] => {
  if (name.startsWith("auth.ui.")) return "ui";
  if (name.startsWith("auth.hook.")) return "hook";
  if (name.startsWith("auth.provider.")) return "provider";
  return "app";
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export function toWideEvent(journey: Journey): WideEvent {
  const steps = journey.spans.map((span): WideEventStep => {
    const decision = readString(span.attributes["auth.hook.decision"]);
    const errorCode = readString(span.attributes["auth.error.code"]);
    return {
      name: span.name as SpanName | string,
      type: stepType(span.name),
      startOffsetMs: span.startMs - journey.startedAt,
      durationMs: span.durationMs,
      ...(decision === undefined ? {} : { decision }),
      ...(errorCode === undefined ? {} : { errorCode }),
    };
  });

  const correlationCounts: Record<CorrelationKind, number> = {
    exact: 0,
    inferred: 0,
  };
  for (const joined of journey.events)
    correlationCounts[joined.correlation] += 1;

  return {
    schemaVersion: "1",
    event: "auth.journey",
    traceId: journey.traceId,
    spanId: journey.root.spanId,
    outcome: journey.outcome,
    provider: journey.provider,
    tenant: journey.tenant,
    startedAt: new Date(journey.startedAt).toISOString(),
    durationMs: journey.endedAt - journey.startedAt,
    attributes: journey.root.attributes,
    steps,
    correlationCounts,
  };
}

export const isWideEvent = (value: unknown): value is WideEvent => {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === "1" &&
    record.event === "auth.journey" &&
    typeof record.traceId === "string" &&
    typeof record.spanId === "string" &&
    typeof record.outcome === "string" &&
    typeof record.startedAt === "string" &&
    typeof record.durationMs === "number" &&
    Array.isArray(record.steps)
  );
};

export type { Outcome };
