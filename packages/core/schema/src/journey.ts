import type {
  Attributes,
  AuthMethod,
  AuthUiStage,
  CorrelationKind,
  JourneyKind,
  Outcome,
  SpanName,
  WideEventSchemaVersion,
  WideEventStepType,
} from "./attributes.ts";
import type { SpanId, TraceId } from "./ids.ts";
import type { Span } from "./span.ts";

export interface CorrelationHints {
  readonly userHash?: string;
  readonly clientId?: string;
  readonly ipHash?: string;
  readonly userAgentHash?: string;
  /** Opaque per-transaction identifier. An exact join, not a hint. */
  readonly transactionId?: string;
  /** Scopes the hint index so one tenant can never join another tenant's journey. */
  readonly tenant?: string;
}

export interface ProviderEvent {
  readonly id: string;
  readonly provider: string;
  readonly tenant: string;
  /** Neutral type, for example login_success or login_failure. */
  readonly type: string;
  readonly atMs: number;
  readonly traceId?: TraceId;
  readonly hints: CorrelationHints;
  readonly attributes: Attributes;
}

export interface JoinedEvent {
  readonly event: ProviderEvent;
  readonly correlation: CorrelationKind;
}

export interface Journey {
  readonly traceId: TraceId;
  readonly root: Span;
  readonly provider: string;
  readonly tenant: string;
  readonly kind: JourneyKind;
  readonly outcome: Outcome;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly spans: readonly Span[];
  readonly events: readonly JoinedEvent[];
}

export interface WideEventStep {
  readonly name: SpanName | string;
  readonly type: WideEventStepType;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  /** Neutral UI stage, for auth.ui.screen spans. */
  readonly stage?: AuthUiStage;
  /** Neutral auth method, when known. */
  readonly method?: AuthMethod;
  /** Provider's own screen name, for auth.ui.screen spans. */
  readonly vendorScreen?: string;
  readonly decision?: string;
  readonly errorCode?: string;
}

export interface WideEvent {
  readonly schemaVersion: WideEventSchemaVersion;
  readonly event: "auth.journey";
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly kind: JourneyKind;
  readonly outcome: Outcome;
  readonly provider: string;
  readonly tenant: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly attributes: Attributes;
  readonly steps: readonly WideEventStep[];
  readonly correlationCounts: Readonly<Record<CorrelationKind, number>>;
}
