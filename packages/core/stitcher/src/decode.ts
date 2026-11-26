import {
  type Attributes,
  type AttributeValue,
  isSpanId,
  isTraceId,
  type ProviderEvent,
  parseSpanId,
  parseTraceId,
  type Span,
  type SpanKind,
  type SpanStatus,
} from "@auththread/schema";
import { BadRequest } from "./errors.ts";

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

const record = (value: unknown, what: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequest(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
};

const array = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new BadRequest(`${what} must be an array`);
  return value;
};

const text = (value: unknown, what: string): string => {
  if (typeof value !== "string")
    throw new BadRequest(`${what} must be a string`);
  return value;
};

const num = (value: unknown, what: string): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new BadRequest(`${what} must be a number`);
  }
  return parsed;
};

const nanosToMs = (value: unknown): number => {
  if (typeof value === "string") {
    if (!/^\d+$/.test(value)) {
      throw new BadRequest("timestamp must be integer nanoseconds");
    }
    return Number(BigInt(value) / 1_000_000n);
  }
  const nanos = Math.round(num(value, "timestamp"));
  return Number(BigInt(nanos) / 1_000_000n);
};

const decodeValue = (value: unknown): AttributeValue => {
  const input = record(value, "attribute value");
  if (typeof input.stringValue === "string") return input.stringValue;
  if (input.intValue !== undefined) return num(input.intValue, "intValue");
  if (typeof input.doubleValue === "number") return input.doubleValue;
  if (typeof input.boolValue === "boolean") return input.boolValue;
  if (input.arrayValue !== undefined) {
    const values = array(
      record(input.arrayValue, "arrayValue").values ?? [],
      "arrayValue.values",
    );
    return values.map((entry) => {
      const decoded = decodeValue(entry);
      return typeof decoded === "string" ? decoded : JSON.stringify(decoded);
    });
  }
  throw new BadRequest("unsupported attribute value");
};

const decodeAttributes = (value: unknown): Attributes => {
  const out: Record<string, AttributeValue> = {};
  for (const entry of array(value ?? [], "attributes")) {
    const attribute = record(entry, "attribute");
    const key = text(attribute.key, "attribute key");
    out[key] = decodeValue(attribute.value);
  }
  return out;
};

const decodeSpan = (value: unknown): Span => {
  const input = record(value, "span");
  const traceId = text(input.traceId, "traceId");
  const spanId = text(input.spanId, "spanId");
  if (!isTraceId(traceId)) throw new BadRequest("invalid trace id");
  if (!isSpanId(spanId)) throw new BadRequest("invalid span id");

  const parent = input.parentSpanId;
  if (parent !== undefined && parent !== "" && !isSpanId(String(parent))) {
    throw new BadRequest("invalid parent span id");
  }

  const startMs = nanosToMs(input.startTimeUnixNano);
  const endMs = nanosToMs(input.endTimeUnixNano);
  const statusCode =
    STATUS[
      num(record(input.status ?? {}, "status").code ?? 0, "status code")
    ] ?? "unset";
  const message = record(input.status ?? {}, "status").message;

  return {
    traceId: parseTraceId(traceId),
    spanId: parseSpanId(spanId),
    parentSpanId:
      parent === undefined || parent === ""
        ? null
        : parseSpanId(String(parent)),
    name: text(input.name, "span name"),
    kind: KIND[num(input.kind ?? 1, "span kind")] ?? "internal",
    startMs,
    durationMs: Math.max(0, endMs - startMs),
    attributes: decodeAttributes(input.attributes),
    status: {
      code: statusCode,
      ...(typeof message === "string" ? { message } : {}),
    },
    events: array(input.events ?? [], "events").map((entry) => {
      const event = record(entry, "span event");
      return {
        name: text(event.name, "event name"),
        atMs: nanosToMs(event.timeUnixNano),
        attributes: decodeAttributes(event.attributes),
      };
    }),
  };
};

/** Accepts the OTLP/JSON envelope produced by @auththread/otlp and any OTel SDK. */
export function decodeOtlpSpans(body: unknown): Span[] {
  const input = record(body, "body");
  const resourceSpans = array(input.resourceSpans, "resourceSpans");
  const spans: Span[] = [];

  for (const resource of resourceSpans) {
    for (const scope of array(
      record(resource, "resourceSpan").scopeSpans,
      "scopeSpans",
    )) {
      for (const span of array(record(scope, "scopeSpan").spans, "spans")) {
        spans.push(decodeSpan(span));
      }
    }
  }

  return spans;
}

const decodeCompactValue = (value: unknown): AttributeValue => {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  ) {
    return value as string[];
  }
  throw new BadRequest("unsupported attribute value");
};

export const decodeCompactAttributes = (value: unknown): Attributes => {
  const out: Record<string, AttributeValue> = {};
  for (const [key, entry] of Object.entries(
    record(value ?? {}, "attributes"),
  )) {
    out[key] = decodeCompactValue(entry);
  }
  return out;
};

const decodeCompactSpan = (value: unknown): Span => {
  const input = record(value, "span");
  const traceId = text(input.traceId, "traceId");
  const spanId = text(input.spanId, "spanId");
  if (!isTraceId(traceId)) throw new BadRequest("invalid trace id");
  if (!isSpanId(spanId)) throw new BadRequest("invalid span id");
  const parent = input.parentSpanId;
  const status = record(input.status ?? {}, "status");

  return {
    traceId: parseTraceId(traceId),
    spanId: parseSpanId(spanId),
    parentSpanId:
      parent === undefined || parent === null
        ? null
        : parseSpanId(text(parent, "parentSpanId")),
    name: text(input.name, "span name"),
    kind: "client",
    startMs: num(input.startMs, "startMs"),
    durationMs: Math.max(0, num(input.durationMs, "durationMs")),
    attributes: decodeCompactAttributes(input.attributes),
    status: {
      code:
        status.code === "ok" || status.code === "error" ? status.code : "unset",
      ...(typeof status.message === "string"
        ? { message: status.message }
        : {}),
    },
    events: [],
  };
};

export function decodeCompactSpans(body: unknown): Span[] {
  const input = record(body, "body");
  return array(input.spans, "spans").map(decodeCompactSpan);
}

/** The shape hooks and page plugins post: compact JSON, not OTLP. */
export function decodeProviderEvent(value: unknown): ProviderEvent {
  const input = record(value, "event");
  const hints = record(input.hints ?? {}, "hints");
  const traceId = input.traceId;
  if (
    traceId !== undefined &&
    (typeof traceId !== "string" || !isTraceId(traceId))
  ) {
    throw new BadRequest("invalid trace id");
  }

  const hint = (key: string): string | undefined => {
    const entry = hints[key];
    if (entry === undefined) return undefined;
    return text(entry, `hints.${key}`);
  };

  const userHash = hint("userHash");
  const clientId = hint("clientId");
  const ipHash = hint("ipHash");
  const userAgentHash = hint("userAgentHash");

  return {
    id: text(input.id, "event id"),
    provider: text(input.provider, "event provider"),
    tenant: text(input.tenant, "event tenant"),
    type: text(input.type, "event type"),
    atMs: num(input.atMs, "event time"),
    ...(typeof traceId === "string" ? { traceId: parseTraceId(traceId) } : {}),
    hints: {
      ...(userHash === undefined ? {} : { userHash }),
      ...(clientId === undefined ? {} : { clientId }),
      ...(ipHash === undefined ? {} : { ipHash }),
      ...(userAgentHash === undefined ? {} : { userAgentHash }),
    },
    attributes: decodeCompactAttributes(input.attributes),
  };
}
