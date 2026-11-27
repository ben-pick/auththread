import { parseSpanId, parseTraceId, type Span } from "@auththread/schema";
import { describe, expect, it } from "vitest";
import { encodeSpans } from "./encode.ts";

const span: Span = {
  traceId: parseTraceId("a".repeat(32)),
  spanId: parseSpanId("b".repeat(16)),
  parentSpanId: parseSpanId("c".repeat(16)),
  name: "auth.ui.screen",
  kind: "client",
  startMs: 1_700_000_000_000,
  durationMs: 1234,
  attributes: { "auth.ui.stage": "password", "auth.method": "password" },
  status: { code: "ok" },
  events: [],
};

describe("encodeSpans", () => {
  it("produces OTLP JSON with nanosecond strings", () => {
    const payload = encodeSpans([span], { serviceName: "auththread" });
    const encoded = payload.resourceSpans[0]?.scopeSpans[0]?.spans[0];

    expect(encoded?.startTimeUnixNano).toBe("1700000000000000000");
    expect(encoded?.endTimeUnixNano).toBe("1700000001234000000");
    expect(encoded?.kind).toBe(3);
    expect(encoded?.status).toEqual({ code: 1 });
    expect(payload.resourceSpans[0]?.resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "auththread" } },
    ]);
  });

  it("sorts attributes so output is byte stable", () => {
    const encoded = encodeSpans([span], { serviceName: "x" }).resourceSpans[0]
      ?.scopeSpans[0]?.spans[0];
    expect(encoded?.attributes.map((attribute) => attribute.key)).toEqual([
      "auth.method",
      "auth.ui.stage",
    ]);
  });

  it("keeps integers and doubles apart", () => {
    const numeric: Span = {
      ...span,
      attributes: { count: 3, ratio: 0.5, ok: true, tags: ["a", "b"] },
    };
    const encoded = encodeSpans([numeric], { serviceName: "x" })
      .resourceSpans[0]?.scopeSpans[0]?.spans[0];
    expect(encoded?.attributes).toEqual([
      { key: "count", value: { intValue: "3" } },
      { key: "ok", value: { boolValue: true } },
      { key: "ratio", value: { doubleValue: 0.5 } },
      {
        key: "tags",
        value: {
          arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] },
        },
      },
    ]);
  });

  it("maps error status and drops an absent parent", () => {
    const encoded = encodeSpans(
      [
        {
          ...span,
          parentSpanId: null,
          status: { code: "error", message: "denied" },
        },
      ],
      { serviceName: "x" },
    ).resourceSpans[0]?.scopeSpans[0]?.spans[0];

    expect(encoded?.status).toEqual({ code: 2, message: "denied" });
    expect(encoded).not.toHaveProperty("parentSpanId");
  });
});
