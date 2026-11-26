import type { Attributes, SpanName } from "./attributes.ts";
import type { SpanId, TraceId } from "./ids.ts";

export type SpanKind = "internal" | "server" | "client";
export type SpanStatusCode = "unset" | "ok" | "error";

export interface SpanStatus {
  readonly code: SpanStatusCode;
  readonly message?: string;
}

export interface SpanEvent {
  readonly name: string;
  readonly atMs: number;
  readonly attributes: Attributes;
}

export interface Span {
  readonly traceId: TraceId;
  readonly spanId: SpanId;
  readonly parentSpanId: SpanId | null;
  readonly name: SpanName | string;
  readonly kind: SpanKind;
  readonly startMs: number;
  readonly durationMs: number;
  readonly attributes: Attributes;
  readonly status: SpanStatus;
  readonly events: readonly SpanEvent[];
}

export const isErrorSpan = (span: Span): boolean =>
  span.status.code === "error" ||
  typeof span.attributes["auth.error.code"] === "string";

export const spanEnd = (span: Span): number => span.startMs + span.durationMs;
