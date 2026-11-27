import {
  type AttributeValue,
  type AuthAttribute,
  isAuthHookDecision,
  isAuthUiStage,
  isJourneyKind,
  isOutcome,
  isSignupEventType,
  type JourneyKind,
  type Outcome,
  outcomeOfProviderEvent,
  SPAN_NAMES,
} from "./attributes.ts";
import { compareStrings } from "./compare.ts";
import { parseSpanId, rootSpanId, type TraceId } from "./ids.ts";
import type { JoinedEvent, Journey, ProviderEvent } from "./journey.ts";
import { sha256Hex } from "./sha256.ts";
import { isErrorSpan, type Span, type SpanStatus } from "./span.ts";

const ROOT_ATTRIBUTE_KEYS = [
  "auth.provider",
  "auth.tenant",
  "auth.client_id",
  "auth.method",
  "auth.journey.kind",
  "auth.user.hash",
] as const satisfies readonly AuthAttribute[];

export function sortSpans(spans: readonly Span[]): Span[] {
  return [...spans].sort(
    (a, b) =>
      a.startMs - b.startMs ||
      compareStrings(a.name, b.name) ||
      compareStrings(a.spanId, b.spanId),
  );
}

export function sortEvents(events: readonly ProviderEvent[]): ProviderEvent[] {
  return [...events].sort(
    (a, b) => a.atMs - b.atMs || compareStrings(a.id, b.id),
  );
}

export function deriveOutcome(
  spans: readonly Span[],
  events: readonly ProviderEvent[],
): Outcome {
  if (
    spans.some(
      (span) =>
        span.attributes["auth.hook.decision"] === "deny" ||
        span.attributes["auth.outcome"] === "denied",
    )
  ) {
    return "denied";
  }

  const signals: Array<{
    outcome: "success" | "failed" | "abandoned";
    at: number;
  }> = [];

  for (const span of spans) {
    const at = span.startMs + span.durationMs;
    const explicit = span.attributes["auth.outcome"];
    if (isOutcome(explicit) && explicit !== "denied") {
      signals.push({ outcome: explicit, at });
    }
    if (isErrorSpan(span)) signals.push({ outcome: "failed", at });
    if (span.attributes["auth.abandoned_at"] !== undefined) {
      signals.push({ outcome: "abandoned", at });
    }
    if (span.name === SPAN_NAMES.callback && span.status.code === "ok") {
      signals.push({ outcome: "success", at });
    }
  }

  for (const event of events) {
    const outcome = outcomeOfProviderEvent(event.type);
    if (outcome === "failed" || outcome === "success") {
      signals.push({ outcome, at: event.atMs });
    }
  }

  if (signals.length === 0) return "abandoned";

  const rank = (outcome: "success" | "failed" | "abandoned"): number =>
    outcome === "failed" ? 2 : outcome === "success" ? 1 : 0;

  signals.sort((a, b) => b.at - a.at || rank(b.outcome) - rank(a.outcome));
  return (signals[0] as { outcome: Outcome }).outcome;
}

export function deriveKind(
  spans: readonly Span[],
  events: readonly ProviderEvent[],
): JourneyKind {
  const explicit = spans
    .map((span) => span.attributes["auth.journey.kind"])
    .find(isJourneyKind);
  if (explicit !== undefined) return explicit;

  if (events.some((event) => isSignupEventType(event.type))) return "signup";
  return "login";
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
    .find(isAuthUiStage);
  if (abandonedAt !== undefined) out["auth.abandoned_at"] = abandonedAt;

  const abandonedScreen = spans
    .map((span) => span.attributes["auth.abandoned_screen"])
    .find((value) => typeof value === "string");
  if (abandonedScreen !== undefined)
    out["auth.abandoned_screen"] = abandonedScreen;

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
  /** Defaults to the explicit span attribute, then a signup event, then login. */
  readonly kind?: JourneyKind;
  readonly spans: readonly Span[];
  readonly events: readonly ProviderEvent[];
}

export function buildJourney(input: BuildJourneyInput): Journey {
  const buffered = sortSpans(input.spans);
  const events = sortEvents(input.events);
  const outcome = deriveOutcome(buffered, events);
  const kind = input.kind ?? deriveKind(buffered, events);
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
    "auth.journey.kind": kind,
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
    kind,
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
