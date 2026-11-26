import type { JourneyItem } from "@auththread/adapter-kit";
import type {
  Attributes,
  AttributeValue,
  ProviderEvent,
  Span,
  SpanKind,
  SpanStatus,
} from "@auththread/schema";
import { Effect, Schema } from "effect";
import { BadRequest } from "./errors.ts";

const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

export const TraceIdSchema = Schema.String.check(Schema.isPattern(TRACE_ID))
  .check(Schema.makeFilter((value: string) => value !== ZERO_TRACE))
  .pipe(Schema.brand("auththread/TraceId"));

export const SpanIdSchema = Schema.String.check(Schema.isPattern(SPAN_ID))
  .check(Schema.makeFilter((value: string) => value !== ZERO_SPAN))
  .pipe(Schema.brand("auththread/SpanId"));

const AttributeValueSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Array(Schema.String),
]);

export const AttributesSchema = Schema.Record(
  Schema.String,
  AttributeValueSchema,
);

const SpanStatusSchema = Schema.Struct({
  code: Schema.Literals(["unset", "ok", "error"]),
  message: Schema.optionalKey(Schema.String),
});

const SpanEventSchema = Schema.Struct({
  name: Schema.String,
  atMs: Schema.Finite,
  attributes: AttributesSchema,
});

const SpanKindSchema = Schema.Literals(["internal", "server", "client"]);

export const SpanSchema = Schema.Struct({
  traceId: TraceIdSchema,
  spanId: SpanIdSchema,
  parentSpanId: Schema.NullOr(SpanIdSchema),
  name: Schema.String,
  kind: SpanKindSchema,
  startMs: Schema.Finite,
  durationMs: Schema.Finite,
  attributes: AttributesSchema,
  status: SpanStatusSchema,
  events: Schema.Array(SpanEventSchema),
});

export const decodeSpan = (input: unknown): Effect.Effect<Span, BadRequest> =>
  Effect.fromResult(Schema.decodeUnknownResult(SpanSchema)(input)).pipe(
    Effect.mapError((cause) => new BadRequest({ message: cause.message })),
  );

const Nanos = Schema.Union([
  Schema.String.check(Schema.isPattern(/^\d+$/)),
  Schema.Finite,
]);

const nanosToMs = (value: string | number): number => {
  const nanos =
    typeof value === "string" ? BigInt(value) : BigInt(Math.round(value));
  return Number(nanos / 1_000_000n);
};

const OtlpAnyValueSchema = Schema.Struct({
  stringValue: Schema.optionalKey(Schema.String),
  intValue: Schema.optionalKey(Schema.Union([Schema.String, Schema.Finite])),
  doubleValue: Schema.optionalKey(Schema.Finite),
  boolValue: Schema.optionalKey(Schema.Boolean),
  arrayValue: Schema.optionalKey(
    Schema.Struct({
      values: Schema.Array(Schema.Unknown),
    }),
  ),
});

const OtlpAttributeSchema = Schema.Struct({
  key: Schema.String,
  value: OtlpAnyValueSchema,
});

const OtlpAttributesSchema = Schema.Array(OtlpAttributeSchema);

const decodeOtlpValue = (value: unknown): AttributeValue => {
  if (typeof value !== "object" || value === null) return String(value);
  const input = value as Record<string, unknown>;
  if (typeof input.stringValue === "string") return input.stringValue;
  if (typeof input.intValue === "string") return Number(input.intValue);
  if (typeof input.intValue === "number") return input.intValue;
  if (typeof input.doubleValue === "number") return input.doubleValue;
  if (typeof input.boolValue === "boolean") return input.boolValue;
  if (typeof input.arrayValue === "object" && input.arrayValue !== null) {
    const values = (input.arrayValue as { values?: unknown }).values;
    if (Array.isArray(values)) {
      return values.map((entry) => {
        const decoded = decodeOtlpValue(entry);
        return typeof decoded === "string" ? decoded : JSON.stringify(decoded);
      });
    }
  }
  return "";
};

const decodeOtlpAttributes = (
  attributes: ReadonlyArray<{ readonly key: string; readonly value: unknown }>,
): Attributes => {
  const out: Record<string, AttributeValue> = {};
  for (const attribute of attributes) {
    out[attribute.key] = decodeOtlpValue(attribute.value);
  }
  return out;
};

const OtlpSpanSchema = Schema.Struct({
  traceId: TraceIdSchema,
  spanId: SpanIdSchema,
  parentSpanId: Schema.optionalKey(
    Schema.Union([Schema.Literal(""), SpanIdSchema]),
  ),
  name: Schema.String,
  kind: Schema.optionalKey(Schema.Finite),
  startTimeUnixNano: Nanos,
  endTimeUnixNano: Nanos,
  attributes: Schema.optionalKey(OtlpAttributesSchema),
  status: Schema.optionalKey(
    Schema.Struct({
      code: Schema.optionalKey(Schema.Finite),
      message: Schema.optionalKey(Schema.String),
    }),
  ),
  events: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        timeUnixNano: Nanos,
        attributes: Schema.optionalKey(OtlpAttributesSchema),
      }),
    ),
  ),
});

const OtlpEnvelopeSchema = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({
      scopeSpans: Schema.Array(
        Schema.Struct({
          spans: Schema.Array(OtlpSpanSchema),
        }),
      ),
    }),
  ),
});

const KIND: Record<number, SpanKind> = {
  1: "internal",
  2: "server",
  3: "client",
};
const STATUS: Record<number, SpanStatus["code"]> = {
  0: "unset",
  1: "ok",
  2: "error",
};

const spanOfOtlp = (span: typeof OtlpSpanSchema.Type): Span => {
  const startMs = nanosToMs(span.startTimeUnixNano);
  const endMs = nanosToMs(span.endTimeUnixNano);
  const status = span.status ?? {};
  const code =
    status.code === undefined ? "unset" : (STATUS[status.code] ?? "unset");
  const parent = span.parentSpanId;

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: parent === undefined || parent === "" ? null : parent,
    name: span.name,
    kind: KIND[span.kind ?? 1] ?? "internal",
    startMs,
    durationMs: Math.max(0, endMs - startMs),
    attributes: decodeOtlpAttributes(span.attributes ?? []),
    status: {
      code,
      ...(status.message === undefined ? {} : { message: status.message }),
    },
    events: (span.events ?? []).map((event) => ({
      name: event.name,
      atMs: nanosToMs(event.timeUnixNano),
      attributes: decodeOtlpAttributes(event.attributes ?? []),
    })),
  };
};

/** Accepts the OTLP/JSON envelope produced by @auththread/otlp and any OTel SDK. */
export const decodeOtlpSpans = (
  body: unknown,
): Effect.Effect<Span[], BadRequest> =>
  Effect.fromResult(Schema.decodeUnknownResult(OtlpEnvelopeSchema)(body)).pipe(
    Effect.map((envelope) =>
      envelope.resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans.map(spanOfOtlp)),
      ),
    ),
    Effect.mapError((cause) => new BadRequest({ message: cause.message })),
  );

const CompactStatusSchema = Schema.Struct({
  code: Schema.optionalKey(Schema.Literals(["unset", "ok", "error"])),
  message: Schema.optionalKey(Schema.String),
});

const CompactSpanSchema = Schema.Struct({
  traceId: TraceIdSchema,
  spanId: SpanIdSchema,
  parentSpanId: Schema.optionalKey(Schema.NullOr(SpanIdSchema)),
  name: Schema.String,
  startMs: Schema.Finite,
  durationMs: Schema.Finite,
  attributes: Schema.optionalKey(AttributesSchema),
  status: Schema.optionalKey(CompactStatusSchema),
});

const CompactSpansSchema = Schema.Struct({
  spans: Schema.Array(CompactSpanSchema),
});

const spanOfCompact = (span: typeof CompactSpanSchema.Type): Span => ({
  traceId: span.traceId,
  spanId: span.spanId,
  parentSpanId: span.parentSpanId ?? null,
  name: span.name,
  kind: "client",
  startMs: span.startMs,
  durationMs: Math.max(0, span.durationMs),
  attributes: span.attributes ?? {},
  status: {
    code: span.status?.code ?? "unset",
    ...(span.status?.message === undefined
      ? {}
      : { message: span.status.message }),
  },
  events: [],
});

export const decodeCompactSpans = (
  body: unknown,
): Effect.Effect<Span[], BadRequest> =>
  Effect.fromResult(Schema.decodeUnknownResult(CompactSpansSchema)(body)).pipe(
    Effect.map((body) => body.spans.map(spanOfCompact)),
    Effect.mapError((cause) => new BadRequest({ message: cause.message })),
  );

const HintsSchema = Schema.Struct({
  userHash: Schema.optionalKey(Schema.String),
  clientId: Schema.optionalKey(Schema.String),
  ipHash: Schema.optionalKey(Schema.String),
  userAgentHash: Schema.optionalKey(Schema.String),
  transactionId: Schema.optionalKey(Schema.String),
  tenant: Schema.optionalKey(Schema.String),
});

export const ProviderEventSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  provider: Schema.String.check(Schema.isMinLength(1)),
  tenant: Schema.String,
  type: Schema.String.check(Schema.isMinLength(1)),
  atMs: Schema.Finite,
  traceId: Schema.optionalKey(TraceIdSchema),
  hints: Schema.optionalKey(HintsSchema),
  attributes: Schema.optionalKey(AttributesSchema),
});

const eventOf = (event: typeof ProviderEventSchema.Type): ProviderEvent => ({
  id: event.id,
  provider: event.provider,
  tenant: event.tenant,
  type: event.type,
  atMs: event.atMs,
  ...(event.traceId === undefined ? {} : { traceId: event.traceId }),
  hints: event.hints ?? {},
  attributes: event.attributes ?? {},
});

/** The shape hooks and page plugins post: compact JSON, not OTLP. */
export const decodeProviderEvent = (
  value: unknown,
): Effect.Effect<ProviderEvent, BadRequest> =>
  Effect.fromResult(
    Schema.decodeUnknownResult(ProviderEventSchema)(value),
  ).pipe(
    Effect.map(eventOf),
    Effect.mapError((cause) => new BadRequest({ message: cause.message })),
  );

export const ProviderEventBatchSchema = Schema.Union([
  Schema.Struct({
    events: Schema.Array(ProviderEventSchema),
  }),
  ProviderEventSchema,
]);

export const decodeProviderEventBatch = (
  value: unknown,
): Effect.Effect<ProviderEvent[], BadRequest> =>
  Effect.fromResult(
    Schema.decodeUnknownResult(ProviderEventBatchSchema)(value),
  ).pipe(
    Effect.map((body) =>
      "events" in body ? body.events.map(eventOf) : [eventOf(body)],
    ),
    Effect.mapError((cause) => new BadRequest({ message: cause.message })),
  );

const JourneyItemSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("span"),
    id: Schema.String,
    atMs: Schema.Finite,
    span: SpanSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    id: Schema.String,
    atMs: Schema.Finite,
    event: ProviderEventSchema,
  }),
]);

export const decodeJourneyItem = (
  value: unknown,
): Effect.Effect<JourneyItem, BadRequest> =>
  Effect.fromResult(Schema.decodeUnknownResult(JourneyItemSchema)(value)).pipe(
    Effect.map((item) =>
      item.kind === "span" ? item : { ...item, event: eventOf(item.event) },
    ),
    Effect.mapError((cause) => new BadRequest({ message: cause.message })),
  );
