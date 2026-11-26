import {
  type AttributeValue,
  type AuthAttribute,
  isAuthHookDecision,
  isAuthUiStep,
  isOutcome,
  type Outcome,
  SPAN_NAMES,
} from "./attributes.ts";
import { parseSpanId, rootSpanId, type TraceId } from "./ids.ts";
import type { JoinedEvent, Journey, ProviderEvent } from "./journey.ts";
import { sha256Hex } from "./sha256.ts";
import { isErrorSpan, type Span, type SpanStatus } from "./span.ts";

const SEVERITY: Record<Outcome, number> = {
  success: 0,
  abandoned: 1,
  failed: 2,
  denied: 3,
};

const ROOT_ATTRIBUTE_KEYS = [
  "auth.provider",
  "auth.tenant",
  "auth.client_id",
  "auth.method",
  "auth.user.hash",
] as const satisfies readonly AuthAttribute[];

export function sortSpans(spans: readonly Span[]): Span[] {
  return [...spans].sort(
    (a, b) =>
      a.startMs - b.startMs ||
      a.name.localeCompare(b.name) ||
      a.spanId.localeCompare(b.spanId),
  );
}

export function sortEvents(events: readonly ProviderEvent[]): ProviderEvent[] {
  return [...events].sort(
    (a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id),
  );
}

export function deriveOutcome(
  spans: readonly Span[],
  events: readonly ProviderEvent[],
): Outcome {
  const explicit = spans
    .map((span) => span.attributes["auth.outcome"])
    .filter(isOutcome)
    .sort((a, b) => SEVERITY[b] - SEVERITY[a]);
  if (explicit[0] !== undefined) return explicit[0];

  const denied = spans.some(
    (span) => span.attributes["auth.hook.decision"] === "deny",
  );
  if (denied) return "denied";

  const failed =
    spans.some(isErrorSpan) ||
    events.some(
      (event) =>
        event.type === "login_failure" || event.type === "signup_failure",
    );
  if (failed) return "failed";

  const abandoned = spans.some(
    (span) => span.attributes["auth.abandoned_at"] !== undefined,
  );
  if (abandoned) return "abandoned";

  const succeeded =
    events.some((event) => event.type === "login_success") ||
    spans.some(
      (span) => span.name === SPAN_NAMES.callback && span.status.code === "ok",
    );
  if (succeeded) return "success";

  return "abandoned";
}

function consistentValue(
  spans: readonly Span[],
  key: AuthAttribute,
): AttributeValue | undefined {
  let found: AttributeValue | undefined;
  for (const span of spans) {
    const value = span.attributes[key];
    if (value === undefined) continue;
    if (found === undefined) found = value;
    else if (JSON.stringify(found) !== JSON.stringify(value)) return undefined;
  }
  return found;
}

function aggregateRootAttributes(
  spans: readonly Span[],
): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};

  for (const key of ROOT_ATTRIBUTE_KEYS) {
    const value = consistentValue(spans, key);
    if (value !== undefined) out[key] = value;
  }

  const abandonedAt = spans
    .map((span) => span.attributes["auth.abandoned_at"])
    .find(isAuthUiStep);
  if (abandonedAt !== undefined) out["auth.abandoned_at"] = abandonedAt;

  const deniedBy = spans.find(
    (span) => span.attributes["auth.hook.decision"] === "deny",
  );
  if (deniedBy?.attributes["auth.hook.decision"] !== undefined) {
    const decision = deniedBy.attributes["auth.hook.decision"];
    if (isAuthHookDecision(decision)) out["auth.hook.decision"] = decision;
  }

  return out;
}

export interface BuildJourneyInput {
  readonly traceId: TraceId;
  readonly provider: string;
  readonly tenant: string;
  readonly spans: readonly Span[];
  readonly events: readonly ProviderEvent[];
}

export function buildJourney(input: BuildJourneyInput): Journey {
  const buffered = sortSpans(input.spans);
  const events = sortEvents(input.events);
  const outcome = deriveOutcome(buffered, events);
  const joined: JoinedEvent[] = events.map((event) => ({
    event,
    correlation: event.traceId === input.traceId ? "exact" : "inferred",
  }));

  const eventSpans: Span[] = joined.map(({ event, correlation }) => ({
    traceId: input.traceId,
    spanId: parseSpanId(sha256Hex(`event:${event.id}`).slice(0, 16)),
    parentSpanId: rootSpanId(input.traceId),
    name: SPAN_NAMES.providerEvent,
    kind: "internal",
    startMs: event.atMs,
    durationMs: 0,
    attributes: {
      ...event.attributes,
      "auth.provider": event.provider,
      "auth.tenant": event.tenant,
      "auth.correlation": correlation,
    },
    status: event.type.includes("failure")
      ? { code: "error", message: event.type }
      : { code: "unset" },
    events: [],
  }));

  const spans = sortSpans([...buffered, ...eventSpans]);

  const startCandidates = [
    ...spans.map((span) => span.startMs),
    ...events.map((event) => event.atMs),
  ];
  const endCandidates = [
    ...spans.map((span) => span.startMs + span.durationMs),
    ...events.map((event) => event.atMs),
  ];
  const startedAt = Math.min(...startCandidates);
  const endedAt = Math.max(...endCandidates);

  const attributes: Record<string, AttributeValue> = {
    ...aggregateRootAttributes(spans),
    "auth.provider": input.provider,
    "auth.tenant": input.tenant,
    "auth.outcome": outcome,
  };

  const root: Span = {
    traceId: input.traceId,
    spanId: rootSpanId(input.traceId),
    parentSpanId: null,
    name: SPAN_NAMES.journey,
    kind: "internal",
    startMs: startedAt,
    durationMs: endedAt - startedAt,
    attributes,
    status: outcomeStatus(outcome),
    events: [],
  };

  return {
    traceId: input.traceId,
    root,
    provider: input.provider,
    tenant: input.tenant,
    outcome,
    startedAt,
    endedAt,
    spans,
    events: joined,
  };
}

const outcomeStatus = (outcome: Outcome): SpanStatus =>
  outcome === "success"
    ? { code: "ok" }
    : outcome === "abandoned"
      ? { code: "unset" }
      : { code: "error", message: outcome };
