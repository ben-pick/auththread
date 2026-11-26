import { describe, expect, it } from "vitest";
import { newSpanId, newTraceId, rootSpanId } from "./ids.ts";

const fixed = (byte: number) => (length: number) =>
  new Uint8Array(length).fill(byte);

describe("identifiers", () => {
  it("derives the same root span from the same trace", () => {
    const traceId = newTraceId(fixed(7));
    expect(rootSpanId(traceId)).toBe(rootSpanId(traceId));
    expect(rootSpanId(traceId)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("derives different root spans for different traces", () => {
    expect(rootSpanId(newTraceId(fixed(1)))).not.toBe(
      rootSpanId(newTraceId(fixed(2))),
    );
  });

  it("formats random ids as lower-case hex", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });
});
