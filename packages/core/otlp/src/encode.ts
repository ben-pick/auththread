import type {
  Attributes,
  AttributeValue,
  Span,
  SpanKind,
} from "@auththread/schema";
import { compareStrings } from "@auththread/schema";

const KIND: Record<SpanKind, number> = { internal: 1, server: 2, client: 3 };
const STATUS: Record<string, number> = { unset: 0, ok: 1, error: 2 };

export interface OtlpValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpValue[] };
}

export interface OtlpAttribute {
  key: string;
  value: OtlpValue;
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: { code: number; message?: string };
  events: Array<{
    name: string;
    timeUnixNano: string;
    attributes: OtlpAttribute[];
  }>;
}

const toNanos = (ms: number): string =>
  (BigInt(Math.round(ms)) * 1_000_000n).toString();

const toValue = (value: AttributeValue): OtlpValue => {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  return {
    arrayValue: { values: value.map((item) => ({ stringValue: item })) },
  };
};

export const encodeAttributes = (attributes: Attributes): OtlpAttribute[] =>
  Object.entries(attributes)
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([key, value]) => ({ key, value: toValue(value) }));

export const encodeSpan = (span: Span): OtlpSpan => ({
  traceId: span.traceId,
  spanId: span.spanId,
  ...(span.parentSpanId === null ? {} : { parentSpanId: span.parentSpanId }),
  name: span.name,
  kind: KIND[span.kind],
  startTimeUnixNano: toNanos(span.startMs),
  endTimeUnixNano: toNanos(span.startMs + span.durationMs),
  attributes: encodeAttributes(span.attributes),
  status: {
    code: STATUS[span.status.code] ?? 0,
    ...(span.status.message === undefined
      ? {}
      : { message: span.status.message }),
  },
  events: span.events.map((event) => ({
    name: event.name,
    timeUnixNano: toNanos(event.atMs),
    attributes: encodeAttributes(event.attributes),
  })),
});

export interface EncodeOptions {
  readonly serviceName: string;
  readonly scopeVersion?: string;
}

export interface OtlpPayload {
  readonly resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: { name: string; version?: string };
      spans: OtlpSpan[];
    }>;
  }>;
}

export function encodeSpans(
  spans: readonly Span[],
  options: EncodeOptions,
): OtlpPayload {
  const attributes: Attributes = { "service.name": options.serviceName };

  return {
    resourceSpans: [
      {
        resource: { attributes: encodeAttributes(attributes) },
        scopeSpans: [
          {
            scope: {
              name: "@auththread/otlp",
              ...(options.scopeVersion === undefined
                ? {}
                : { version: options.scopeVersion }),
            },
            spans: [...spans]
              .sort(
                (a, b) =>
                  a.startMs - b.startMs || compareStrings(a.spanId, b.spanId),
              )
              .map(encodeSpan),
          },
        ],
      },
    ],
  };
}
